/**
 * Cloudflare Pages Function: /api/radio-sync
 * GET: Retrieve synchronized radio stations from Cloudflare KV
 * POST: Upload & save radio stations and sync across devices
 *
 * Acceso por clave compartida (sync key). No se aceptan claves vacías:
 * el cliente siempre envía una clave explícita.
 */

const GET_LIMIT = { max: 120, windowSec: 300 };
const POST_LIMIT = { max: 60, windowSec: 300 };

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
  return (rawKey || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
}

function clientIp(context) {
  return context.request.headers.get('cf-connecting-ip') || 'unknown';
}

// Rate limit suave por IP (KV, mejor que nada; no es atómico).
async function isRateLimited(context, bucket, { max, windowSec }) {
  const env = context.env;
  if (!env || !env.HOME_KV) return false;
  try {
    const raw = await env.HOME_KV.get(`rl_${bucket}_${clientIp(context)}`);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    if (Date.now() > rec.resetAt) return false;
    return rec.count >= max;
  } catch {
    return false;
  }
}

async function registerHit(context, bucket, { windowSec }) {
  const env = context.env;
  if (!env || !env.HOME_KV) return;
  try {
    const key = `rl_${bucket}_${clientIp(context)}`;
    const raw = await env.HOME_KV.get(key);
    const now = Date.now();
    let rec = { count: 0, resetAt: now + windowSec * 1000 };
    if (raw) {
      const parsed = JSON.parse(raw);
      if (now <= parsed.resetAt) rec = parsed;
    }
    rec.count += 1;
    await env.HOME_KV.put(key, JSON.stringify(rec), { expirationTtl: windowSec });
  } catch {}
}

// Limpia campos de texto: sin HTML, longitudes razonables.
function cleanText(value, fallback, maxLen) {
  return String(value ?? fallback)
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

// Solo http(s) o data:image para logos.
function cleanMediaUrl(value, maxLen, allowDataImage) {
  const raw = String(value ?? '').trim().slice(0, maxLen);
  if (/^https?:\/\//i.test(raw)) return raw;
  if (allowDataImage && /^data:image\//i.test(raw)) return raw;
  return '';
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
    if (await isRateLimited(context, 'radio_get', GET_LIMIT)) {
      return jsonResponse({ success: false, error: 'Demasiadas solicitudes. Espera unos minutos.' }, 429);
    }
    await registerHit(context, 'radio_get', GET_LIMIT);

    const url = new URL(context.request.url);
    const queryKey = url.searchParams.get('key') || url.searchParams.get('code') || '';
    const headerKey = context.request.headers.get('X-Sync-Key') || context.request.headers.get('X-Admin-Pin') || '';
    const syncKey = getCleanKey(queryKey || headerKey);

    if (!syncKey) {
      return jsonResponse({ success: false, error: 'Falta la clave de sincronización.' }, 400);
    }

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

  } catch {
    return jsonResponse({ success: false, error: 'Error interno del servidor.' }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    if (await isRateLimited(context, 'radio_post', POST_LIMIT)) {
      return jsonResponse({ success: false, error: 'Demasiadas solicitudes. Espera unos minutos.' }, 429);
    }

    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse({ success: false, error: 'JSON de solicitud inválido.' }, 400);
    }

    if (JSON.stringify(body).length > 2_000_000) {
      return jsonResponse({ success: false, error: 'Payload demasiado grande.' }, 413);
    }

    const headerKey = context.request.headers.get('X-Sync-Key') || context.request.headers.get('X-Admin-Pin') || '';
    const syncKey = getCleanKey(body.key || headerKey);
    const stations = body.stations;
    const generateShareCode = !!body.generateCode;

    if (!syncKey) {
      return jsonResponse({ success: false, error: 'Falta la clave de sincronización.' }, 400);
    }

    if (!Array.isArray(stations)) {
      return jsonResponse({ success: false, error: 'El campo stations debe ser un array válido de emisoras.' }, 400);
    }

    await registerHit(context, 'radio_post', POST_LIMIT);

    // Sanitize and preserve fields: id, name, url, genre, freq, logo, isStarred, isDefault
    const sanitizedStations = stations.slice(0, 500).map((s, idx) => ({
      id: cleanText(s.id, `st-${Date.now()}-${idx}`, 64).replace(/[^a-zA-Z0-9_-]/g, '') || `st-${Date.now()}-${idx}`,
      name: cleanText(s.name, 'Emisora', 120) || 'Emisora',
      url: cleanMediaUrl(s.url, 2048, false),
      genre: cleanText(s.genre, 'Música', 60),
      freq: cleanText(s.freq, 'WEB STREAM', 40),
      logo: cleanMediaUrl(s.logo, 4096, true),
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
        // Código aleatorio con criptografía fuerte, p. ej. RAD-8F3KQ2XZ
        // (8 caracteres base32 ≈ 40 bits, no enumerable como RAD-####).
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        const code = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
        generatedCode = `RAD-${code}`;
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

  } catch {
    return jsonResponse({ success: false, error: 'Error interno del servidor.' }, 500);
  }
}
