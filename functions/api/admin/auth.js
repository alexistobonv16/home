/**
 * Cloudflare Pages Function: /api/admin/auth
 * Authenticates admin via PIN / Password and generates a session token.
 */
import defaultConfig from '../../../default-config.json';

async function generateToken(pin, secret = 'at_admin_salt_2026') {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${pin}:${secret}:${new Date().toISOString().slice(0, 10)}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Cuerpo de solicitud inválido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { pin } = body;
    if (!pin) {
      return new Response(JSON.stringify({ success: false, error: 'Por favor ingresa la clave de administrador.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Read stored config
    let config = defaultConfig;
    if (context.env && context.env.HOME_KV) {
      const raw = await context.env.HOME_KV.get('site_config');
      if (raw) {
        try { config = JSON.parse(raw); } catch {}
      }
    }

    const expectedPin = config.adminPin || defaultConfig.adminPin || 'alexis2026';

    if (pin.trim() !== expectedPin.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'Clave o PIN incorrecto.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const token = await generateToken(expectedPin);

    return new Response(JSON.stringify({
      success: true,
      message: 'Autenticación exitosa.',
      token
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
