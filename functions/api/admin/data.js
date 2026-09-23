/**
 * Cloudflare Pages Function: /api/admin/data
 * GET: Retrieve full config for admin dashboard
 * POST: Save updated projects, contact details, or change PIN into Cloudflare KV
 *
 * Auth: only session tokens issued by /api/admin/auth (stored in KV) are valid.
 * The PIN is never accepted directly via header (avoids bypassing rate limiting).
 */
import defaultConfig from '../../default-config.json';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  if (!context.env || !context.env.HOME_KV) return false;

  const raw = await context.env.HOME_KV.get(`admin_session_${token}`);
  if (!raw) return false;

  try {
    const session = JSON.parse(raw);
    // Invalida todas las sesiones emitidas con un PIN anterior.
    const expectedPin = (config.adminPin || defaultConfig.adminPin || '').trim();
    return session.pinHash === (await sha256Hex(expectedPin));
  } catch {
    return false;
  }
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

    // Nunca devolver el PIN en claro al cliente.
    const safeConfig = {
      contact: config.contact || defaultConfig.contact,
      projects: Array.isArray(config.projects) ? config.projects : defaultConfig.projects,
      hasCustomPin: Boolean(config.adminPin && config.adminPin !== defaultConfig.adminPin)
    };

    return new Response(JSON.stringify({ success: true, data: safeConfig }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
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

    if (newPin !== undefined && newPin !== null && newPin !== '') {
      if (typeof newPin !== 'string' || newPin.trim().length < 4 || newPin.trim().length > 64) {
        return new Response(JSON.stringify({ success: false, error: 'La nueva clave debe tener entre 4 y 64 caracteres.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Preservar campos adicionales existentes (p. ej. tvPin) y validar tamaño.
    if (projects !== undefined && !Array.isArray(projects)) {
      return new Response(JSON.stringify({ success: false, error: 'Formato de proyectos inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (JSON.stringify(payload).length > 500_000) {
      return new Response(JSON.stringify({ success: false, error: 'Payload demasiado grande.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const updatedConfig = {
      ...config, // conserva tvPin y cualquier otro campo
      adminPin: (newPin && newPin.trim()) ? newPin.trim() : (config.adminPin || defaultConfig.adminPin),
      contact: contact || config.contact || defaultConfig.contact,
      projects: Array.isArray(projects) ? projects : (config.projects || defaultConfig.projects)
    };

    if (context.env && context.env.HOME_KV) {
      await context.env.HOME_KV.put('site_config', JSON.stringify(updatedConfig, null, 2));
    } else {
      return new Response(JSON.stringify({ success: false, error: 'Almacenamiento no disponible.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
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

  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Error interno del servidor.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
