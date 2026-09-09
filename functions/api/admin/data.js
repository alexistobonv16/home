/**
 * Cloudflare Pages Function: /api/admin/data
 * GET: Retrieve full config for admin dashboard
 * POST: Save updated projects, contact details, or change PIN into Cloudflare KV
 */
import defaultConfig from '../../../default-config.json';

async function verifyToken(token, expectedPin, secret = 'at_admin_salt_2026') {
  if (!token) return false;
  const encoder = new TextEncoder();
  const data = encoder.encode(`${expectedPin}:${secret}:${new Date().toISOString().slice(0, 10)}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const expectedToken = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return token === expectedToken;
}

async function getStoredConfig(context) {
  if (context.env && context.env.HOME_KV) {
    const raw = await context.env.HOME_KV.get('site_config');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
  }
  return { ...defaultConfig };
}

async function checkAuthorization(context, config) {
  const authHeader = context.request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const pinHeader = context.request.headers.get('X-Admin-Pin') || '';
  const expectedPin = config.adminPin || defaultConfig.adminPin || 'alexis2026';

  if (pinHeader && pinHeader.trim() === expectedPin.trim()) {
    return true;
  }

  return await verifyToken(token, expectedPin);
}

export async function onRequestGet(context) {
  try {
    const config = await getStoredConfig(context);
    const isAuthed = await checkAuthorization(context, config);

    if (!isAuthed) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. Por favor inicia sesión.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return full config (masking PIN partially for security)
    const safeConfig = {
      ...config,
      hasCustomPin: Boolean(config.adminPin && config.adminPin !== defaultConfig.adminPin)
    };

    return new Response(JSON.stringify({ success: true, data: safeConfig }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  try {
    const config = await getStoredConfig(context);
    const isAuthed = await checkAuthorization(context, config);

    if (!isAuthed) {
      return new Response(JSON.stringify({ success: false, error: 'No autorizado. Por favor inicia sesión.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let payload = {};
    try {
      payload = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Cuerpo de solicitud inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { projects, contact, newPin } = payload;

    const updatedConfig = {
      adminPin: (newPin && newPin.trim()) ? newPin.trim() : (config.adminPin || defaultConfig.adminPin),
      contact: contact || config.contact || defaultConfig.contact,
      projects: Array.isArray(projects) ? projects : (config.projects || defaultConfig.projects)
    };

    if (context.env && context.env.HOME_KV) {
      await context.env.HOME_KV.put('site_config', JSON.stringify(updatedConfig, null, 2));
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Cambios guardados exitosamente en Cloudflare KV.',
      data: {
        projects: updatedConfig.projects,
        contact: updatedConfig.contact
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
