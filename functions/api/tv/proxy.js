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
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);

          const res = await fetch(candidateUrl, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
              'User-Agent': ua,
              'Accept': '*/*',
              'Accept-Language': 'es,en;q=0.9',
              'Connection': 'keep-alive'
            }
          });

          clearTimeout(timeoutId);

          if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            const isTextOrM3u = contentType.includes('mpegurl') ||
                                contentType.includes('m3u') ||
                                contentType.includes('text') ||
                                targetUrl.includes('.m3u') ||
                                targetUrl.includes('.m3u8');

            if (isTextOrM3u) {
              const bodyText = await res.text();

              // If it is an HLS sub-manifest or stream playlist (contains #EXT-X-STREAM-INF, #EXT-X-TARGETDURATION)
              // Rewrite relative URLs to absolute proxied URLs so they can be loaded over HTTPS without CORS or mixed content issues
              if (bodyText.includes('#EXTM3U') && (bodyText.includes('#EXT-X-TARGETDURATION') || bodyText.includes('#EXT-X-STREAM-INF'))) {
                const lines = bodyText.split(/\r?\n/);
                const rewritten = lines.map(line => {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith('#')) return line;
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
                'Cache-Control': 'public, max-age=30'
              }
            });
          }

          lastResponse = res;
          if (res.status !== 403 && res.status !== 401 && res.status !== 406) {
            break;
          }
        } catch (err) {
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
      const isTimeout = lastError.name === 'AbortError' || lastError.message?.toLowerCase().includes('abort');
      const msg = isTimeout
        ? 'El servidor de la lista IPTV tardó más de 20 segundos en responder (Tiempo de espera agotado).'
        : `No se pudo conectar con el servidor de la lista: ${lastError.message}`;
      return jsonError(msg, 400);
    }

    return jsonError('No se pudo obtener la lista M3U.', 400);

  } catch (err) {
    return jsonError('Error interno en el proxy: ' + err.message, 400);
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
