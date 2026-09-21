/**
 * Cloudflare Pages Function: /api/radio-sync
 * GET: Retrieve synchronized radio stations from Cloudflare KV
 * POST: Upload & save radio stations and sync across devices
 */

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Key, X-Admin-Pin',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

function getCleanKey(rawKey) {
  const key = (rawKey || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return key || 'alexis2026';
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Key, X-Admin-Pin',
      'Access-Control-Max-Age': '86400'
    }
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const queryKey = url.searchParams.get('key') || url.searchParams.get('code') || '';
    const headerKey = context.request.headers.get('X-Sync-Key') || context.request.headers.get('X-Admin-Pin') || '';
    const syncKey = getCleanKey(queryKey || headerKey);

    if (!context.env || !context.env.HOME_KV) {
      // In-memory / graceful fallback if KV is not bound locally
      return jsonResponse({
        success: true,
        fallback: true,
        stations: null,
        message: 'Almacenamiento Cloudflare KV no detectado en entorno local. Utilizando almacenamiento local del navegador.'
      });
    }

    const kvKey = `radio_sync_${syncKey}`;
    const raw = await context.env.HOME_KV.get(kvKey);

    if (!raw) {
      return jsonResponse({
        success: true,
        stations: null,
        message: 'No se encontraron emisoras guardadas en la nube para este código o PIN.'
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    return jsonResponse({
      success: true,
      stations: parsed ? (parsed.stations || parsed) : null,
      updatedAt: parsed && parsed.updatedAt ? parsed.updatedAt : null,
      message: 'Emisoras sincronizadas correctamente desde la nube.'
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse({ success: false, error: 'JSON de solicitud inválido.' }, 400);
    }

    const headerKey = context.request.headers.get('X-Sync-Key') || context.request.headers.get('X-Admin-Pin') || '';
    const syncKey = getCleanKey(body.key || headerKey);
    const stations = body.stations;
    const generateShareCode = !!body.generateCode;

    if (!Array.isArray(stations)) {
      return jsonResponse({ success: false, error: 'El campo stations debe ser un array válido de emisoras.' }, 400);
    }

    // Sanitize and preserve fields: id, name, url, genre, freq, logo, isStarred, isDefault
    const sanitizedStations = stations.slice(0, 500).map((s, idx) => ({
      id: s.id || `st-${Date.now()}-${idx}`,
      name: (s.name || 'Emisora').trim(),
      url: (s.url || '').trim(),
      genre: (s.genre || 'Música').trim(),
      freq: (s.freq || 'WEB STREAM').trim(),
      logo: (s.logo || '').trim(),
      isStarred: !!s.isStarred,
      isDefault: !!s.isDefault
    }));

    const now = new Date().toISOString();
    const payload = {
      key: syncKey,
      stations: sanitizedStations,
      count: sanitizedStations.length,
      updatedAt: now
    };

    let generatedCode = null;

    if (context.env && context.env.HOME_KV) {
      const kvKey = `radio_sync_${syncKey}`;
      await context.env.HOME_KV.put(kvKey, JSON.stringify(payload));

      if (generateShareCode) {
        // Generate a random 6-character code e.g. RAD-8421
        const randNum = Math.floor(1000 + Math.random() * 9000);
        generatedCode = `RAD-${randNum}`;
        await context.env.HOME_KV.put(`radio_sync_${generatedCode.toLowerCase()}`, JSON.stringify(payload), {
          expirationTtl: 60 * 60 * 24 * 30 // 30 days
        });
      }
    }

    return jsonResponse({
      success: true,
      message: `¡${sanitizedStations.length} emisoras sincronizadas en la nube con éxito!`,
      count: sanitizedStations.length,
      updatedAt: now,
      shareCode: generatedCode
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
