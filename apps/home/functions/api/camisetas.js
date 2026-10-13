/**
 * Cloudflare Pages Function: /api/camisetas
 * Almacenamiento en la nube para el sistema de Camisetas Soporte Técnico UNAL
 * Persistencia respaldada en Cloudflare KV (HOME_KV) con soporte CORS
 */

const DEFAULT_PIN = '1608';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pin, x-pin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function getValidPin(env) {
  if (!env || !env.HOME_KV) return DEFAULT_PIN;
  try {
    const savedPin = await env.HOME_KV.get('unal_camisetas_pin');
    return savedPin || DEFAULT_PIN;
  } catch (e) {
    return DEFAULT_PIN;
  }
}

async function checkAuth(request, env) {
  const pin = request.headers.get('X-Pin') || request.headers.get('x-pin');
  const validPin = await getValidPin(env);
  return pin === validPin;
}

// Rate limiting por IP sobre intentos fallidos (PIN de 4 dígitos enumerable).
const RL_MAX_FAILS = 5;
const RL_WINDOW_SEC = 300;

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

async function isAuthBlocked(env, request) {
  if (!env || !env.HOME_KV) return false;
  try {
    const raw = await env.HOME_KV.get(`rl_cam_${clientIp(request)}`);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    if (Date.now() > rec.resetAt) return false;
    return rec.count >= RL_MAX_FAILS;
  } catch {
    return false;
  }
}

async function registerAuthFailure(env, request) {
  if (!env || !env.HOME_KV) return;
  try {
    const key = `rl_cam_${clientIp(request)}`;
    const raw = await env.HOME_KV.get(key);
    const now = Date.now();
    let rec = { count: 0, resetAt: now + RL_WINDOW_SEC * 1000 };
    if (raw) {
      const parsed = JSON.parse(raw);
      if (now <= parsed.resetAt) rec = parsed;
    }
    rec.count += 1;
    await env.HOME_KV.put(key, JSON.stringify(rec), { expirationTtl: RL_WINDOW_SEC });
  } catch {}
}

async function clearAuthFailures(env, request) {
  if (!env || !env.HOME_KV) return;
  try { await env.HOME_KV.delete(`rl_cam_${clientIp(request)}`); } catch {}
}

// Devuelve true si está autorizado; registra y bloquea intentos fallidos.
async function authorize(context) {
  if (await isAuthBlocked(context.env, context.request)) {
    return { blocked: true };
  }
  const isAuth = await checkAuth(context.request, context.env);
  if (isAuth) {
    await clearAuthFailures(context.env, context.request);
  } else {
    await registerAuthFailure(context.env, context.request);
  }
  return { isAuth };
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: CORS_HEADERS
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const { isAuth, blocked } = await authorize(context);

    if (blocked) {
      return new Response(JSON.stringify({ success: false, error: 'Demasiados intentos. Espera unos minutos.' }), {
        status: 429,
        headers: CORS_HEADERS
      });
    }

    // Fast PIN verification endpoint
    if (url.searchParams.get('action') === 'verify') {
      if (isAuth) {
        return new Response(JSON.stringify({ success: true, valid: true }), {
          headers: CORS_HEADERS
        });
      } else {
        return new Response(JSON.stringify({ success: false, valid: false, error: 'PIN incorrecto' }), {
          status: 401,
          headers: CORS_HEADERS
        });
      }
    }

    if (!isAuth) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. PIN inválido.' }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    if (!context.env.HOME_KV) {
      return new Response(JSON.stringify({ success: false, error: 'KV no configurado en el entorno.' }), {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    const raw = await context.env.HOME_KV.get('unal_camisetas_db');
    const currentPin = await getValidPin(context.env);

    if (!raw) {
      return new Response(JSON.stringify({ success: true, data: null, pin: currentPin }), {
        headers: CORS_HEADERS
      });
    }

    const parsed = JSON.parse(raw);
    return new Response(JSON.stringify({ success: true, data: parsed, pin: currentPin }), {
      headers: {
        ...CORS_HEADERS,
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}

export async function onRequestPost(context) {
  try {
    const { isAuth, blocked } = await authorize(context);

    if (blocked) {
      return new Response(JSON.stringify({ success: false, error: 'Demasiados intentos. Espera unos minutos.' }), {
        status: 429,
        headers: CORS_HEADERS
      });
    }

    if (!isAuth) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. PIN inválido.' }), {
        status: 401,
        headers: CORS_HEADERS
      });
    }

    if (!context.env.HOME_KV) {
      return new Response(JSON.stringify({ success: false, error: 'KV no configurado en el entorno.' }), {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    const body = await context.request.json();
    if (!body) {
      return new Response(JSON.stringify({ success: false, error: 'Cuerpo de solicitud inválido.' }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    if (JSON.stringify(body).length > 2_000_000) {
      return new Response(JSON.stringify({ success: false, error: 'Payload demasiado grande.' }), {
        status: 413,
        headers: CORS_HEADERS
      });
    }

    // 1. Update PIN if requested
    if (body.newPin && typeof body.newPin === 'string' && body.newPin.length === 4) {
      await context.env.HOME_KV.put('unal_camisetas_pin', body.newPin);
    }

    // 2. Save orders & settings config
    let dataToSave = null;
    if (Array.isArray(body.orders)) {
      dataToSave = {
        orders: body.orders,
        unitCost: body.unitCost || 28000,
        config: body.config || null,
        updatedAt: new Date().toISOString()
      };
      await context.env.HOME_KV.put('unal_camisetas_db', JSON.stringify(dataToSave));
    } else if (body.config) {
      const raw = await context.env.HOME_KV.get('unal_camisetas_db');
      const existing = raw ? JSON.parse(raw) : { orders: [], unitCost: 28000 };
      existing.config = body.config;
      if (body.unitCost) existing.unitCost = body.unitCost;
      existing.updatedAt = new Date().toISOString();
      dataToSave = existing;
      await context.env.HOME_KV.put('unal_camisetas_db', JSON.stringify(dataToSave));
    }

    const currentPin = await getValidPin(context.env);

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Guardado en la nube exitosamente.', 
      updatedAt: dataToSave?.updatedAt || new Date().toISOString(),
      pin: currentPin
    }), {
      headers: CORS_HEADERS
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }
}
