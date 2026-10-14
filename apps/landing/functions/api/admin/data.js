/**
 * Cloudflare Pages Function: /api/admin/data
 * GET: Retrieve full configuration for the admin panel (requires valid session token)
 * POST: Save updated configuration to Cloudflare KV (requires valid session token)
 */
import defaultConfig from '../../../default-config.json';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getStoredConfig(context) {
  if (context.env && context.env.HOME_KV) {
    try {
      const raw = await context.env.HOME_KV.get('landing_config');
      if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
    } catch {}
  }
  return { ...defaultConfig };
}

async function checkAuthorization(context, config) {
  const authHeader = context.request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  if (!context.env || !context.env.HOME_KV) return false;

  const raw = await context.env.HOME_KV.get(`landing_session_${token}`);
  if (!raw) return false;

  try {
    const session = JSON.parse(raw);
    const expectedPin = (config.adminPin || defaultConfig.adminPin || '1234').trim();
    return session.pinHash === (await sha256Hex(expectedPin));
  } catch {
    return false;
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

export async function onRequestGet(context) {
  try {
    const config = await getStoredConfig(context);
    const isAuthed = await checkAuthorization(context, config);

    if (!isAuthed) {
      return json({ success: false, error: 'Sesión no válida o expirada. Inicia sesión de nuevo.' }, 401);
    }

    const wantsDefaults = new URL(context.request.url).searchParams.get('defaults') === '1';
    if (wantsDefaults) {
      return json({ success: true, data: defaultConfig });
    }

    return json({ success: true, data: config });
  } catch (err) {
    return json({ success: false, error: 'Error del servidor: ' + err.message }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const currentConfig = await getStoredConfig(context);
    const isAuthed = await checkAuthorization(context, currentConfig);

    if (!isAuthed) {
      return json({ success: false, error: 'Sesión no válida o expirada.' }, 401);
    }

    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json({ success: false, error: 'Datos no válidos' }, 400);
    }

    const newConfig = {
      ...currentConfig,
      brand: { ...currentConfig.brand, ...(body.brand || {}) },
      hero: { ...currentConfig.hero, ...(body.hero || {}) },
      stats: Array.isArray(body.stats) ? body.stats : currentConfig.stats,
      services: Array.isArray(body.services) ? body.services : currentConfig.services,
      contact: { ...currentConfig.contact, ...(body.contact || {}) },
      footer: { ...currentConfig.footer, ...(body.footer || {}) }
    };

    // Si se solicitó cambio de contraseña
    if (body.newAdminPin && typeof body.newAdminPin === 'string') {
      const cleanNewPin = body.newAdminPin.trim();
      if (cleanNewPin.length < 4) {
        return json({ success: false, error: 'La nueva contraseña debe tener al menos 4 caracteres.' }, 400);
      }
      newConfig.adminPin = cleanNewPin;
    }

    if (context.env && context.env.HOME_KV) {
      await context.env.HOME_KV.put('landing_config', JSON.stringify(newConfig));
    }

    return json({
      success: true,
      message: 'Configuración guardada exitosamente.',
      data: newConfig
    });
  } catch (err) {
    return json({ success: false, error: 'Error al guardar: ' + err.message }, 500);
  }
}
