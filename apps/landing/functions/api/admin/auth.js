/**
 * Cloudflare Pages Function: /api/admin/auth
 * Handles admin authentication via PIN and issues a cryptographically secure session token.
 */
import defaultConfig from '../../../default-config.json';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días
const MAX_FAILED_ATTEMPTS = 5;
const RATE_WINDOW_SECONDS = 300; // 5 minutos

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
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
    const raw = await env.HOME_KV.get(`rl_landing_auth_${ip}`);
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
    const key = `rl_landing_auth_${ip}`;
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
  try {
    await env.HOME_KV.delete(`rl_landing_auth_${ip}`);
  } catch {}
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestPost(context) {
  try {
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';

    if (await isRateLimited(context.env, ip)) {
      return json({
        success: false,
        error: 'Demasiados intentos fallidos. Espera 5 minutos antes de reintentar.'
      }, 429);
    }

    const body = await context.request.json().catch(() => ({}));
    const pin = (body.pin || '').toString().trim();

    if (!pin) {
      return json({ success: false, error: 'Ingresa la contraseña de administrador.' }, 400);
    }

    // Obtener PIN esperado desde KV o default
    let expectedPin = (defaultConfig.adminPin || '1234').trim();
    if (context.env && context.env.HOME_KV) {
      const stored = await context.env.HOME_KV.get('landing_config');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.adminPin) expectedPin = parsed.adminPin.trim();
        } catch {}
      }
    }

    if (pin !== expectedPin) {
      await registerFailure(context.env, ip);
      return json({ success: false, error: 'Contraseña incorrecta.' }, 401);
    }

    await clearFailures(context.env, ip);

    // Generar token de sesión seguro
    const token = randomToken();
    const pinHash = await sha256Hex(expectedPin);

    if (context.env && context.env.HOME_KV) {
      const sessionData = {
        token,
        pinHash,
        createdAt: Date.now(),
        ip
      };
      await context.env.HOME_KV.put(
        `landing_session_${token}`,
        JSON.stringify(sessionData),
        { expirationTtl: SESSION_TTL_SECONDS }
      );
    }

    return json({
      success: true,
      token,
      expiresIn: SESSION_TTL_SECONDS
    });
  } catch (err) {
    return json({ success: false, error: 'Error del servidor: ' + err.message }, 500);
  }
}
