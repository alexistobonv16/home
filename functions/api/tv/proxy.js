/**
 * Cloudflare Pages Function: /api/tv/proxy
 * Proxies remote M3U / M3U8 text playlists to bypass browser CORS restrictions.
 * Features:
 * - URL normalization (auto-add protocol, trim)
 * - IPTV User-Agent rotation (IPTVSmartersPro, VLC, Chrome, okhttp)
 * - HTTPS -> HTTP auto-fallback for IPTV servers with invalid SSL
 * - 20s timeout abort controller
 * - Streaming response body to prevent Cloudflare Worker memory exhaustion
 * - Descriptive Spanish error messages
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

    // Prepare candidate URLs: original and HTTP fallback if original was HTTPS
    const candidateUrls = [targetUrl];
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
            const contentType = res.headers.get('content-type') || 'text/plain; charset=utf-8';
            return new Response(res.body, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            });
          }

          lastResponse = res;
          // If status is not authorization-related, trying other user agents won't help
          if (res.status !== 403 && res.status !== 401 && res.status !== 406) {
            break;
          }
        } catch (err) {
          lastError = err;
          // If fetch failed (e.g. SSL error or connection reset), break to try HTTP candidate
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
      return jsonError(friendlyMessage, 502);
    }

    // If a network/timeout error occurred
    if (lastError) {
      const isTimeout = lastError.name === 'AbortError' || lastError.message?.toLowerCase().includes('abort');
      const msg = isTimeout
        ? 'El servidor de la lista IPTV tardó más de 20 segundos en responder (Tiempo de espera agotado).'
        : `No se pudo conectar con el servidor de la lista: ${lastError.message}`;
      return jsonError(msg, 504);
    }

    return jsonError('No se pudo obtener la lista M3U.', 500);

  } catch (err) {
    return jsonError('Error interno en el proxy: ' + err.message, 500);
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
