/**
 * Cloudflare Pages Function: /api/tv/proxy
 * Proxies remote M3U / M3U8 playlists and HLS video streams to bypass CORS,
 * Mixed Content (HTTP on HTTPS), and Cloudflare Error 1003 (direct IP access).
 */

const USER_AGENTS = [
  'IPTVSmartersPro/3.1.5.1 (Linux; Android 12) ExoPlayerLib/2.18.5',
  'VLC/3.0.18 LibVLC/3.0.18',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

export async function onRequestGet(context) {
  try {
    const { searchParams } = new URL(context.request.url);
    let targetUrl = (searchParams.get('url') || '').trim();

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
      return jsonError('Protocolo no soportado. Debe ser http:// o https://.', 400);
    }

    if (isBlockedHostname(parsed.hostname)) {
      return jsonError('La URL apunta a una dirección interna o privada, que no está permitida.', 403);
    }

    // Prepare candidate URLs:
    // If hostname is a direct IPv4 (e.g. 186.33.57.100), Cloudflare Workers blocks it with Error 1003.
    // Converting to an sslip.io / nip.io domain resolves to the exact same IP while satisfying Cloudflare!
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

    for (const candidateUrl of candidateUrls) {
      for (const ua of USER_AGENTS) {
        try {
          const res = await fetchValidated(candidateUrl, {
            headers: {
              'User-Agent': ua,
              'Accept': '*/*',
              'Accept-Language': 'es,en;q=0.9',
              'Connection': 'keep-alive'
            }
          }, 20000);

          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            const isXml = contentType.includes('xml') || targetUrl.includes('.xml');
            const isTextOrM3u = isXml ||
                                contentType.includes('mpegurl') ||
                                contentType.includes('m3u') ||
                                contentType.includes('text') ||
                                targetUrl.includes('.m3u') ||
                                targetUrl.includes('.m3u8');

            if (isTextOrM3u) {
              const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
              if (contentLength > 10_000_000) {
                return jsonError('El archivo de lista es demasiado grande.', 413);
              }
              const bodyText = await res.text();

              if (isXml) {
                return new Response(bodyText, {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Cache-Control': 'public, max-age=3600'
                  }
                });
              }

              // If it is an HLS sub-manifest or stream playlist (contains #EXT-X-STREAM-INF, #EXT-X-TARGETDURATION)
              // Rewrite relative URLs to absolute proxied URLs so they can be loaded over HTTPS without CORS or mixed content issues
              if (bodyText.includes('#EXTM3U') && (bodyText.includes('#EXT-X-TARGETDURATION') || bodyText.includes('#EXT-X-STREAM-INF'))) {
                const lines = bodyText.split(/\r?\n/);
                const rewritten = lines.map(line => {
                  const trimmed = line.trim();
                  if (!trimmed) return line;
                  if (trimmed.startsWith('#')) {
                    // Tags con URI embebida (#EXT-X-KEY, #EXT-X-MAP, ...):
                    // reescribir para que la petición pase por el proxy.
                    if (/^#(EXT-X-KEY|EXT-X-SESSION-KEY|EXT-X-MAP|EXT-X-MEDIA)\b/i.test(trimmed)) {
                      return rewriteTagUris(line, candidateUrl, '/api/tv/proxy');
                    }
                    return line;
                  }
                  try {
                    const resolved = new URL(trimmed, candidateUrl).toString();
                    return `/api/tv/proxy?url=${encodeURIComponent(resolved)}`;
                  } catch {
                    return line;
                  }
                }).join('\n');

                return new Response(rewritten, {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                  }
                });
              }

              // Return channel playlist as text/plain
              return new Response(bodyText, {
                status: 200,
                headers: {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Methods': 'GET, OPTIONS',
                  'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
              });
            }

            // Binary TS video chunks or other media streams: pass stream directly
            return new Response(res.body, {
              status: 200,
              headers: {
                'Content-Type': contentType || 'video/MP2T',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'public, max-age=60, must-revalidate'
              }
            });
          }

          lastResponse = res;
          if (res.status !== 403 && res.status !== 401 && res.status !== 406) {
            break;
          }
        } catch (err) {
          if (err && err.code === 'BLOCKED') {
            return jsonError('La URL apunta a una dirección interna o privada, que no está permitida.', 403);
          }
          lastError = err;
          break;
        }
      }
    }

    // If we received an HTTP error response from the upstream IPTV server
    if (lastResponse) {
      const status = lastResponse.status;
      let friendlyMessage = `El servidor remoto respondió con estado ${status}.`;
      if (status === 401 || status === 403) {
        friendlyMessage = `El servidor IPTV denegó el acceso (Error ${status}). Comprueba que tu usuario y contraseña sean correctos o que tu suscripción siga activa.`;
      } else if (status === 404) {
        friendlyMessage = `No se encontró la lista en la dirección proporcionada (Error 404). Verifica que el enlace esté bien escrito.`;
      } else if (status >= 500) {
        friendlyMessage = `El servidor de tu proveedor IPTV tiene problemas internos (Error ${status}). Intenta más tarde.`;
      }
      return jsonError(friendlyMessage, 400);
    }

    // If a network/timeout error occurred
    if (lastError) {
      const isTimeout = lastError.name === 'AbortError' || (lastError.message || '').toLowerCase().includes('abort');
      const msg = isTimeout
        ? 'El servidor de la lista IPTV tardó más de 20 segundos en responder (Tiempo de espera agotado).'
        : 'No se pudo conectar con el servidor de la lista. Verifica el enlace o intenta más tarde.';
      return jsonError(msg, 400);
    }

    return jsonError('No se pudo obtener la lista M3U.', 400);

  } catch (err) {
    if (err && err.code === 'BLOCKED') {
      return jsonError('La URL apunta a una dirección interna o privada, que no está permitida.', 403);
    }
    return jsonError('Error interno en el proxy.', 400);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
