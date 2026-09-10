/**
 * Cloudflare Pages Function: /api/tv/sync
 * GET: Retrieve playlists, favorites and last channel from Cloudflare KV
 * POST: Save and synchronize playlists, favorites and settings across devices
 */
import defaultConfig from '../../../default-config.json';

async function verifyToken(token, expectedPin, secret = 'at_tv_secret_salt_2026') {
  if (!token) return false;
  const encoder = new TextEncoder();
  const data = encoder.encode(`${expectedPin}:${secret}:${new Date().toISOString().slice(0, 7)}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const expectedToken = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // Also verify against fallback pin if changed
  if (token === expectedToken) return true;

  // Fallback check
  const dataFallback = encoder.encode(`alexis2026:${secret}:${new Date().toISOString().slice(0, 7)}`);
  const hashBufferFb = await crypto.subtle.digest('SHA-256', dataFallback);
  const hashArrayFb = Array.from(new Uint8Array(hashBufferFb));
  const expectedTokenFb = hashArrayFb.map(b => b.toString(16).padStart(2, '0')).join('');
  return token === expectedTokenFb;
}

async function checkAuth(context) {
  let expectedPin = defaultConfig.adminPin || 'alexis2026';
  if (context.env && context.env.HOME_KV) {
    const raw = await context.env.HOME_KV.get('site_config');
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        if (cfg.tvPin) expectedPin = cfg.tvPin;
        else if (cfg.adminPin) expectedPin = cfg.adminPin;
      } catch {}
    }
  }

  const pinHeader = context.request.headers.get('X-Admin-Pin') || '';
  if (pinHeader && (pinHeader.trim() === expectedPin.trim() || pinHeader.trim() === 'alexis2026')) {
    return true;
  }

  const authHeader = context.request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return await verifyToken(token, expectedPin);
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

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
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

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Pin'
    }
  });
}
