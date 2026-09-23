/**
 * Cloudflare Pages Function: /api/tv/auth
 * Authenticates TV app access via PIN and returns a random session token
 * stored in Cloudflare KV. No hardcoded fallback PINs are accepted.
 * Includes per-IP brute-force rate limiting.
 */
import defaultConfig from '../../default-config.json';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 31; // 31 días (equivalente al token mensual anterior)
const MAX_FAILED_ATTEMPTS = 5;
const RATE_WINDOW_SECONDS = 300;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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

async function isRateLimited(env, ip) {
  if (!env || !env.HOME_KV) return false;
  try {
    const raw = await env.HOME_KV.get(`rl_tv_auth_${ip}`);
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
    const key = `rl_tv_auth_${ip}`;
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
  try { await env.HOME_KV.delete(`rl_tv_auth_${ip}`); } catch {}
}

async function getExpectedPin(env) {
  let expectedPin = defaultConfig.adminPin || '';
  if (env && env.HOME_KV) {
    const raw = await env.HOME_KV.get('site_config');
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        if (cfg.tvPin) {
          expectedPin = cfg.tvPin;
        } else if (cfg.adminPin) {
          expectedPin = cfg.adminPin;
        }
      } catch {}
    }
  }
  return (expectedPin || '').trim();
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
      return json({ success: false, error: 'Solicitud inválida.' }, 400);
    }

    const { pin } = body;
    if (!pin || typeof pin !== 'string') {
      return json({ success: false, error: 'Por favor ingresa tu clave o PIN.' }, 400);
    }

    const expectedPin = await getExpectedPin(context.env);

    // Sin bypass: solo el PIN vigente (tvPin o adminPin) es válido.
    if (!expectedPin || pin.trim() !== expectedPin) {
      await registerFailure(context.env, ip);
      return json({ success: false, error: 'PIN o clave incorrecta.' }, 401);
    }

    await clearFailures(context.env, ip);

    if (!context.env || !context.env.HOME_KV) {
      return json({ success: false, error: 'Almacenamiento no disponible. Intenta más tarde.' }, 503);
    }

    const token = randomToken();
    await context.env.HOME_KV.put(
      `tv_session_${token}`,
      JSON.stringify({ pinHash: await sha256Hex(expectedPin), createdAt: Date.now() }),
      { expirationTtl: SESSION_TTL_SECONDS }
    );

    return json({ success: true, message: 'Acceso autorizado a Alexis TV.', token }, 200);
  } catch {
    return json({ success: false, error: 'Error interno del servidor.' }, 500);
  }
}

export async function onRequestPut(context) {
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

    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return json({ success: false, error: 'Ingresa la contraseña actual y la nueva contraseña.' }, 400);
    }

    if (newPassword.trim().length < 6 || newPassword.trim().length > 64) {
      return json({ success: false, error: 'La nueva contraseña debe tener entre 6 y 64 caracteres.' }, 400);
    }

    if (!context.env || !context.env.HOME_KV) {
      return json({ success: false, error: 'Almacenamiento no disponible.' }, 503);
    }

    // Read stored config from KV
    let config = { ...defaultConfig };
    const raw = await context.env.HOME_KV.get('site_config');
    if (raw) {
      try { config = JSON.parse(raw); } catch {}
    }

    const expectedPin = (config.tvPin || config.adminPin || defaultConfig.adminPin || '').trim();

    // Sin bypass: exige la contraseña vigente (sin 'alexis2026' hardcoded).
    if (!expectedPin || currentPassword.trim() !== expectedPin) {
      await registerFailure(context.env, ip);
      return json({ success: false, error: 'La contraseña actual no es correcta.' }, 401);
    }

    await clearFailures(context.env, ip);

    // Actualiza SOLO la clave de la TV. La clave de administrador
    // solo cambia desde /api/admin/data para no sincronizar privilegios.
    config.tvPin = newPassword.trim();

    await context.env.HOME_KV.put('site_config', JSON.stringify(config, null, 2));

    const token = randomToken();
    await context.env.HOME_KV.put(
      `tv_session_${token}`,
      JSON.stringify({ pinHash: await sha256Hex(config.tvPin), createdAt: Date.now() }),
      { expirationTtl: SESSION_TTL_SECONDS }
    );

    return json({ success: true, message: '¡Contraseña actualizada correctamente!', token }, 200);
  } catch {
    return json({ success: false, error: 'Error interno del servidor.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
