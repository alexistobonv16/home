/**
 * Cloudflare Pages Function: /api/admin/auth
 * Authenticates admin via PIN / Password and issues a random session token
 * stored in Cloudflare KV (no longer a forgeable SHA-256 of the PIN).
 * Includes per-IP brute-force rate limiting.
 */
import defaultConfig from '../../default-config.json';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días
const MAX_FAILED_ATTEMPTS = 5;                // intentos fallidos por ventana
const RATE_WINDOW_SECONDS = 300;              // ventana de 5 minutos

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Ventana deslizante simple por IP basada en KV (mejor que nada; no es atómica).
async function isRateLimited(env, ip) {
  if (!env || !env.HOME_KV) return false;
  try {
    const raw = await env.HOME_KV.get(`rl_admin_auth_${ip}`);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    if (Date.now() > rec.resetAt) return false;
    return rec.count >= MAX_FAILED_ATTEMPTS;
  } catch {
    return false;
  }
}

async function registerFailure(env, ip) {
  if (!env || !env.HOME_KV) return;
  try {
    const key = `rl_admin_auth_${ip}`;
    const raw = await env.HOME_KV.get(key);
    const now = Date.now();
    let rec = { count: 0, resetAt: now + RATE_WINDOW_SECONDS * 1000 };
    if (raw) {
      const parsed = JSON.parse(raw);
      if (now <= parsed.resetAt) rec = parsed;
    }
    rec.count += 1;
    await env.HOME_KV.put(key, JSON.stringify(rec), { expirationTtl: RATE_WINDOW_SECONDS });
  } catch {}
}

async function clearFailures(env, ip) {
  if (!env || !env.HOME_KV) return;
  try { await env.HOME_KV.delete(`rl_admin_auth_${ip}`); } catch {}
}

export async function onRequestPost(context) {
  try {
    const ip = context.request.headers.get('cf-connecting-ip') || 'unknown';

    if (await isRateLimited(context.env, ip)) {
      return json({ success: false, error: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' }, 429);
    }

    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return json({ success: false, error: 'Cuerpo de solicitud inválido.' }, 400);
    }

    const { pin } = body;
    if (!pin || typeof pin !== 'string') {
      return json({ success: false, error: 'Por favor ingresa la clave de administrador.' }, 400);
    }

    // Read stored config
    let config = defaultConfig;
    if (context.env && context.env.HOME_KV) {
      const raw = await context.env.HOME_KV.get('site_config');
      if (raw) {
        try { config = JSON.parse(raw); } catch {}
      }
    }

    const expectedPin = (config.adminPin || defaultConfig.adminPin || '').trim();
    if (!expectedPin || pin.trim() !== expectedPin) {
      await registerFailure(context.env, ip);
      return json({ success: false, error: 'Clave o PIN incorrecto.' }, 401);
    }

    await clearFailures(context.env, ip);

    // Token aleatorio guardado en KV: no se puede forjar sin acceder a la KV.
    if (!context.env || !context.env.HOME_KV) {
      return json({ success: false, error: 'Almacenamiento no disponible. Intenta más tarde.' }, 503);
    }

    const token = randomToken();
    await context.env.HOME_KV.put(
      `admin_session_${token}`,
      JSON.stringify({ pinHash: await sha256Hex(expectedPin), createdAt: Date.now() }),
      { expirationTtl: SESSION_TTL_SECONDS }
    );

    return json({ success: true, message: 'Autenticación exitosa.', token }, 200);
  } catch {
    // No filtrar detalles internos del error al cliente
    return json({ success: false, error: 'Error interno del servidor.' }, 500);
  }
}

// Logout: revoca la sesión en KV para que el token deje de ser válido.
export async function onRequestDelete(context) {
  try {
    const authHeader = context.request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token && /^[a-f0-9]{64}$/.test(token) && context.env && context.env.HOME_KV) {
      await context.env.HOME_KV.delete(`admin_session_${token}`);
    }
    return json({ success: true, message: 'Sesión cerrada.' }, 200);
  } catch {
    return json({ success: false, error: 'Error interno del servidor.' }, 500);
  }
}
