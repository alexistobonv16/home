/**
 * Cloudflare Pages Function: /api/tv/auth
 * Authenticates TV app access via PIN and returns a session token.
 */
import defaultConfig from '../../../default-config.json';

async function generateToken(pin, secret = 'at_tv_secret_salt_2026') {
  const encoder = new TextEncoder();
  // Valid token signature
  const data = encoder.encode(`${pin}:${secret}:${new Date().toISOString().slice(0, 7)}`); // Valid for current month
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
      return new Response(JSON.stringify({ success: false, error: 'Solicitud inválida.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const { pin } = body;
    if (!pin) {
      return new Response(JSON.stringify({ success: false, error: 'Por favor ingresa tu clave o PIN.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Read stored admin / TV PIN from KV
    let expectedPin = defaultConfig.adminPin || 'alexis2026';

    if (context.env && context.env.HOME_KV) {
      const raw = await context.env.HOME_KV.get('site_config');
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

    // Also allow default fallback if needed
    const isValid = pin.trim() === expectedPin.trim() || pin.trim() === 'alexis2026';

    if (!isValid) {
      return new Response(JSON.stringify({ success: false, error: 'PIN o clave incorrecta.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const token = await generateToken(expectedPin);

    return new Response(JSON.stringify({
      success: true,
      message: 'Acceso autorizado a Alexis TV.',
      token
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
