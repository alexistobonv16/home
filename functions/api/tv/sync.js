/**
 * Cloudflare Pages Function: /api/tv/sync
 * GET: Retrieve playlists, favorites and last channel from Cloudflare KV
 * POST: Save and synchronize playlists, favorites and settings across devices
 *
 * Auth: only session tokens issued by /api/tv/auth (stored in KV) are valid.
 * No hardcoded fallback PINs or plain-PIN headers are accepted.
 */
import defaultConfig from '../../default-config.json';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkAuth(context) {
  const authHeader = context.request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  if (!context.env || !context.env.HOME_KV) return false;

  // PIN vigente (tvPin o adminPin como respaldo inicial)
  let expectedPin = defaultConfig.adminPin || '';
  const raw = await context.env.HOME_KV.get('site_config');
  if (raw) {
    try {
      const cfg = JSON.parse(raw);
      if (cfg.tvPin) expectedPin = cfg.tvPin;
      else if (cfg.adminPin) expectedPin = cfg.adminPin;
    } catch {}
  }
  expectedPin = (expectedPin || '').trim();
  if (!expectedPin) return false;

  const sessionRaw = await context.env.HOME_KV.get(`tv_session_${token}`);
  if (!sessionRaw) return false;

  try {
    const session = JSON.parse(sessionRaw);
    // Invalida sesiones emitidas con un PIN anterior.
    return session.pinHash === (await sha256Hex(expectedPin));
  } catch {
    return false;
  }
}

export async function onRequestGet(context) {
  try {
    const isAuthed = await checkAuth(context);
    if (!isAuthed) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. Por favor ingresa tu PIN.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let tvData = null;
    if (context.env && context.env.HOME_KV) {
      const raw = await context.env.HOME_KV.get('tv_data');
      if (raw) {
        try {
          tvData = JSON.parse(raw);
        } catch {}
      }
    }

    if (!tvData) {
      tvData = {
        playlists: [],
        activePlaylistId: null,
        favorites: [],
        lastChannel: null
      };
    }

    return new Response(JSON.stringify({
      success: true,
      data: tvData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestPost(context) {
  try {
    const isAuthed = await checkAuth(context);
    if (!isAuthed) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. Por favor ingresa tu PIN.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Cuerpo de solicitud inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Límite de tamaño: KV soporta 25 MB, pero evitamos payloads absurdos.
    if (JSON.stringify(body).length > 5_000_000) {
      return new Response(JSON.stringify({ success: false, error: 'Payload demasiado grande.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { playlists, activePlaylistId, favorites, lastChannel, recentChannels, epgUrl, hiddenGroups } = body;

    const payloadToSave = {
      playlists: Array.isArray(playlists) ? playlists : [],
      activePlaylistId: activePlaylistId || null,
      favorites: Array.isArray(favorites) ? favorites : [],
      recentChannels: Array.isArray(recentChannels) ? recentChannels.slice(0, 15) : [],
      lastChannel: lastChannel || null,
      epgUrl: typeof epgUrl === 'string' ? epgUrl : null,
      hiddenGroups: Array.isArray(hiddenGroups) ? hiddenGroups : [],
      updatedAt: new Date().toISOString()
    };

    if (context.env && context.env.HOME_KV) {
      await context.env.HOME_KV.put('tv_data', JSON.stringify(payloadToSave));
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Listas y favoritos sincronizados en Cloudflare KV.',
      data: payloadToSave
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
