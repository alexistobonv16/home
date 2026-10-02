/**
 * Cloudflare Pages Function: /api/radio-proxy
 * Proxies live radio audio streams (MP3, AAC, OGG, Icecast, Shoutcast, HLS M3U8)
 * and remote M3U playlists to bypass CORS, Mixed Content (HTTP on HTTPS),
 * and Cloudflare Error 1003 (direct IP access).
 */

const USER_AGENTS = [
  'VLC/3.0.18 LibVLC/3.0.18',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'RadioPlayer/1.0 (Linux; Android 13)',
  'okhttp/4.9.0'
];

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
}

// --- Rate limit por IP (KV, suave y no atómico, igual que auth/sync) ---------
// Evita usar el proxy como relay abierto de gran volumen. El límite es
// generoso (~10 req/s sostenidas) para jamás afectar la reproducción real.
const RATE_LIMIT = { max: 600, windowSec: 60 };

function clientIp(context) {
  return context.request.headers.get('cf-connecting-ip') || 'unknown';
}

async function isRateLimited(context, bucket) {
  const env = context.env;
  if (!env || !env.HOME_KV) return false;
  try {
    const raw = await env.HOME_KV.get(`rl_${bucket}_${clientIp(context)}`);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    if (Date.now() > rec.resetAt) return false;
    return rec.count >= RATE_LIMIT.max;
  } catch {
    return false;
  }
}

async function registerHit(context, bucket) {
  const env = context.env;
  if (!env || !env.HOME_KV) return;
  try {
    const key = `rl_${bucket}_${clientIp(context)}`;
    const raw = await env.HOME_KV.get(key);
    const now = Date.now();
    let rec = { count: 0, resetAt: now + RATE_LIMIT.windowSec * 1000 };
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (now <= parsed.resetAt) rec = parsed;
      } catch {}
    }
    rec.count += 1;
    await env.HOME_KV.put(key, JSON.stringify(rec), { expirationTtl: RATE_LIMIT.windowSec });
  } catch {}
}

// --- Protección SSRF: bloquea destinos internos/privados -------------------

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;                // 0/8, 10/8, 127/8
  if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                          // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                 // 172.16/12
  if (a === 192 && (b === 0 || b === 168)) return true;             // 192.0.0/24, 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true;             // benchmarking
  if (a >= 224) return true;                                        // multicast + reservados
  return false;
}

function isBlockedHostname(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;

  // sslip.io / nip.io: si la IP embebida es privada, también se bloquea
  const dotMatch = h.match(/^(\d{1,3}(?:\.\d{1,3}){3})\.(?:sslip\.io|nip\.io)$/);
  if (dotMatch) return isPrivateIPv4(dotMatch[1]);

  // IPv4 literal (WHATWG URL ya normaliza hex/octal/decimal a dotted-quad)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return isPrivateIPv4(h);

  // IPv6
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
    if (h.startsWith('::ffff:')) return true; // IPv4-mapped
  }
  return false;
}

function blockedError() {
  const err = new Error('La URL apunta a una dirección interna o privada.');
  err.code = 'BLOCKED';
  return err;
}

// fetch que sigue redirects manualmente validando cada salto (máx. 5).
async function fetchValidated(initialUrl, init, timeoutMs) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= 5; hop++) {
    let u;
    try {
      u = new URL(currentUrl);
    } catch {
      throw blockedError();
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw blockedError();
    if (isBlockedHostname(u.hostname)) throw blockedError();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(currentUrl, { ...init, signal: controller.signal, redirect: 'manual' });
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      if (!location) return res;
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        throw blockedError();
      }
      continue;
    }
    return res;
  }
  const err = new Error('Demasiados redirects.');
  err.code = 'TOO_MANY_REDIRECTS';
  throw err;
}

// Reescribe URI="..." en tags #EXT-X-KEY / #EXT-X-MAP para pasar por el proxy.
function rewriteTagUris(line, candidateUrl, proxyPath) {
  if (!/URI="/i.test(line)) return line;
  return line.replace(/URI="([^"]+)"/gi, (match, uri) => {
    try {
      const resolved = new URL(uri, candidateUrl).toString();
      return `URI="${proxyPath}?url=${encodeURIComponent(resolved)}"`;
    } catch {
      return match;
    }
  });
}

function parseAudioBufferBitrate(buffer) {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length - 4; i++) {
    // Check MPEG audio syncword (0xFF followed by 3 bits set)
    if (bytes[i] === 0xFF && (bytes[i + 1] & 0xE0) === 0xE0) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];

      const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
      const layerBits = (b1 >> 1) & 0x03;   // 1 = Layer3, 2 = Layer2, 3 = Layer1
      const bitrateIdx = (b2 >> 4) & 0x0F;

      if (bitrateIdx > 0 && bitrateIdx < 15) {
        if (versionBits === 3 && layerBits === 1) {
          const mpeg1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
          return { bitrate: mpeg1L3[bitrateIdx], codec: 'MP3' };
        }
        if ((versionBits === 2 || versionBits === 0) && layerBits === 1) {
          const mpeg2L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
          return { bitrate: mpeg2L3[bitrateIdx], codec: 'MP3' };
        }
        if (versionBits === 3 && layerBits === 2) {
          const mpeg1L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
          return { bitrate: mpeg1L2[bitrateIdx], codec: 'MP2' };
        }
      }
    }
    // Check AAC ADTS syncword (0xFFF)
    if (bytes[i] === 0xFF && (bytes[i + 1] & 0xF0) === 0xF0) {
      return { bitrate: 128, codec: 'AAC' };
    }
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, User-Agent, Origin, Icy-MetaData',
      'Access-Control-Expose-Headers': '*',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestGet(context) {
  try {
    if (await isRateLimited(context, 'radio_proxy')) {
      return jsonError('Demasiadas solicitudes al proxy. Intenta de nuevo en un minuto.', 429);
    }
    await registerHit(context, 'radio_proxy');

    const { searchParams } = new URL(context.request.url);
    let targetUrl = (searchParams.get('url') || '').trim();
    const isProbe = searchParams.get('probe') === '1';

    if (!targetUrl) {
      return jsonError('Falta el parámetro url.');
    }

    // Auto-fix protocol if missing
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'http://' + targetUrl;
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return jsonError('URL no válida o mal formada.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return jsonError('Protocolo no soportado. Debe ser http:// o https://.');
    }

    if (isBlockedHostname(parsed.hostname)) {
      return jsonError('La URL apunta a una dirección interna o privada, que no está permitida.', 403);
    }

    // Check for direct IPv4 to avoid Cloudflare Error 1003
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const candidateUrls = [];

    if (ipv4Regex.test(parsed.hostname)) {
      const uSslip = new URL(targetUrl);
      uSslip.hostname = `${parsed.hostname}.sslip.io`;
      candidateUrls.push(uSslip.toString());

      const uNip = new URL(targetUrl);
      uNip.hostname = `${parsed.hostname}.nip.io`;
      candidateUrls.push(uNip.toString());
    }

    candidateUrls.push(targetUrl);
    if (targetUrl.startsWith('https://')) {
      candidateUrls.push(targetUrl.replace(/^https:\/\//i, 'http://'));
    }

    let lastResponse = null;
    let lastError = null;

    const incomingRange = isProbe ? 'bytes=0-8192' : context.request.headers.get('Range');

    for (const candidateUrl of candidateUrls) {
      for (const ua of USER_AGENTS) {
        try {
          const reqHeaders = {
            'User-Agent': ua,
            'Accept': '*/*',
            'Icy-MetaData': '1', // Request Icecast stream metadata
            'Connection': 'keep-alive'
          };

          if (incomingRange) {
            reqHeaders['Range'] = incomingRange;
          }

          const res = await fetchValidated(candidateUrl, {
            headers: reqHeaders
          }, 15000);

          if (res.ok || res.status === 206) {
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            const isHls = contentType.includes('mpegurl') ||
                          contentType.includes('m3u') ||
                          targetUrl.includes('.m3u8') ||
                          targetUrl.includes('.m3u');

            // Probe Request: return JSON with bitrate, codec and stream info
            if (isProbe) {
              let detectedBitrate = null;
              let detectedCodec = contentType.includes('aac') ? 'AAC' : 'MP3';

              const icyBr = res.headers.get('icy-br') || res.headers.get('ice-bitrate') || res.headers.get('x-bitrate');
              if (icyBr) {
                detectedBitrate = parseInt(icyBr, 10);
              }

              const icyName = res.headers.get('icy-name');
              const icyGenre = res.headers.get('icy-genre');

              if (!detectedBitrate && !isHls) {
                try {
                  const chunk = await res.arrayBuffer();
                  const parsedAudio = parseAudioBufferBitrate(chunk);
                  if (parsedAudio) {
                    detectedBitrate = parsedAudio.bitrate;
                    detectedCodec = parsedAudio.codec;
                  }
                } catch (e) {}
              }

              if (isHls) {
                detectedCodec = 'HLS';
              }

              return new Response(JSON.stringify({
                success: true,
                bitrate: detectedBitrate || (isHls ? 128 : 128),
                codec: detectedCodec,
                contentType,
                icyName: icyName || null,
                icyGenre: icyGenre || null
              }), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'GET, OPTIONS',
                  'Cache-Control': 'public, max-age=1800'
                }
              });
            }

            // If it is an M3U/M3U8 playlist or manifest, rewrite URLs
            if (isHls && (contentType.includes('text') || contentType.includes('mpegurl') || targetUrl.includes('.m3u'))) {
              const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
              if (contentLength > 10_000_000) {
                return jsonError('El archivo de lista es demasiado grande.', 413);
              }
              const bodyText = await res.text();

              // If it contains #EXTM3U and stream tags
              if (bodyText.includes('#EXTM3U')) {
                const lines = bodyText.split(/\r?\n/);
                const rewritten = lines.map(line => {
                  const trimmed = line.trim();
                  if (!trimmed) return line;
                  if (trimmed.startsWith('#')) {
                    // Tags con URI embebida (#EXT-X-KEY, #EXT-X-MAP, ...):
                    // reescribir para que la petición pase por el proxy.
                    if (/^#(EXT-X-KEY|EXT-X-SESSION-KEY|EXT-X-MAP|EXT-X-MEDIA)\b/i.test(trimmed)) {
                      return rewriteTagUris(line, candidateUrl, '/api/radio-proxy');
                    }
                    return line;
                  }
                  try {
                    const resolved = new URL(trimmed, candidateUrl).toString();
                    return `/api/radio-proxy?url=${encodeURIComponent(resolved)}`;
                  } catch {
                    return line;
                  }
                }).join('\n');

                return new Response(rewritten, {
                  status: 200,
                  headers: {
                    'Content-Type': contentType || 'application/vnd.apple.mpegurl; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Expose-Headers': '*',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                  }
                });
              }

              // Plain M3U list (e.g. user importing remote playlist)
              return new Response(bodyText, {
                status: 200,
                headers: {
                  'Content-Type': 'audio/x-mpegurl; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'GET, OPTIONS',
                  'Cache-Control': 'public, max-age=300'
                }
              });
            }

            // Continuous live audio stream (MP3, AAC, OGG, audio chunks)
            // Pipe response body directly to avoid buffering endless stream into memory
            const outHeaders = new Headers();
            outHeaders.set('Access-Control-Allow-Origin', '*');
            outHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            outHeaders.set('Access-Control-Expose-Headers', '*');
            outHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');

            // Forward content-type, icecast metadata, range
            if (contentType) outHeaders.set('Content-Type', contentType);
            const icyName = res.headers.get('icy-name');
            if (icyName) outHeaders.set('X-Icy-Name', icyName);
            const icyGenre = res.headers.get('icy-genre');
            if (icyGenre) outHeaders.set('X-Icy-Genre', icyGenre);
            const icyBr = res.headers.get('icy-br');
            if (icyBr) outHeaders.set('X-Icy-Bitrate', icyBr);

            if (res.status === 206) {
              const contentRange = res.headers.get('Content-Range');
              if (contentRange) outHeaders.set('Content-Range', contentRange);
            }

            return new Response(res.body, {
              status: res.status,
              headers: outHeaders
            });
          }

          lastResponse = res;
        } catch (err) {
          if (err && err.code === 'BLOCKED') {
            return jsonError('La URL apunta a una dirección interna o privada, que no está permitida.', 403);
          }
          lastError = err;
          // Timeout o rechazo de conexión: probar otro host, no otra UA.
          break;
        }
      }
    }

    if (lastResponse) {
      return jsonError(`La emisora respondió con código ${lastResponse.status}: ${lastResponse.statusText}`, lastResponse.status);
    }

    const isTimeout = lastError && (lastError.name === 'AbortError' || (lastError.message || '').toLowerCase().includes('abort'));
    return jsonError(
      isTimeout
        ? 'El servidor de la emisora tardó demasiado en responder (Tiempo de espera agotado).'
        : 'No fue posible conectar con el stream de audio. Verifica el enlace o intenta más tarde.',
      502
    );

  } catch (err) {
    if (err && err.code === 'BLOCKED') {
      return jsonError('La URL apunta a una dirección interna o privada, que no está permitida.', 403);
    }
    return jsonError('Error interno en radio-proxy.', 500);
  }
}
