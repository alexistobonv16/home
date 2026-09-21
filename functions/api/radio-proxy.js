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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, User-Agent, Origin',
      'Access-Control-Max-Age': '86400'
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
      return jsonError('Protocolo no soportado. Debe ser http:// o https://.');
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

    const incomingRange = context.request.headers.get('Range');

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

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          const res = await fetch(candidateUrl, {
            signal: controller.signal,
            redirect: 'follow',
            headers: reqHeaders
          });

          clearTimeout(timeoutId);

          if (res.ok || res.status === 206) {
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            const isHls = contentType.includes('mpegurl') ||
                          contentType.includes('m3u') ||
                          targetUrl.includes('.m3u8') ||
                          targetUrl.includes('.m3u');

            // If it is an M3U/M3U8 playlist or manifest, rewrite URLs
            if (isHls && (contentType.includes('text') || contentType.includes('mpegurl') || targetUrl.includes('.m3u'))) {
              const bodyText = await res.text();

              // If it contains #EXTM3U and stream tags
              if (bodyText.includes('#EXTM3U')) {
                const lines = bodyText.split(/\r?\n/);
                const rewritten = lines.map(line => {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith('#')) return line;
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
          lastError = err;
        }
      }
    }

    if (lastResponse) {
      return jsonError(`La emisora respondió con código ${lastResponse.status}: ${lastResponse.statusText}`, lastResponse.status);
    }

    return jsonError(`No fue posible conectar con el stream de audio: ${lastError ? lastError.message : 'Timeout o rechazo de conexión'}.`, 502);

  } catch (err) {
    return jsonError(`Error interno en radio-proxy: ${err.message}`, 500);
  }
}
