/**
 * Cloudflare Pages Function: /api/contact
 * Handles background contact form submissions to admin@alexistobon.com
 */

// Rate limit por IP: 3 envíos cada 10 minutos (anti-spam / anti-abuso de coste).
const RL_MAX = 3;
const RL_WINDOW_SEC = 600;

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function isRateLimited(context) {
  const env = context.env;
  if (!env || !env.HOME_KV) return false;
  try {
    const raw = await env.HOME_KV.get(`rl_contact_${clientIp(context.request)}`);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    if (Date.now() > rec.resetAt) return false;
    return rec.count >= RL_MAX;
  } catch {
    return false;
  }
}

async function registerHit(context) {
  const env = context.env;
  if (!env || !env.HOME_KV) return;
  try {
    const key = `rl_contact_${clientIp(context.request)}`;
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

export async function onRequestPost(context) {
  try {
    if (await isRateLimited(context)) {
      return jsonOk({ success: false, error: 'Demasiados mensajes en poco tiempo. Intenta de nuevo en unos minutos.' });
    }

    const contentType = context.request.headers.get('content-type') || '';
    let body = {};

    if (contentType.includes('application/json')) {
      body = await context.request.json();
    } else {
      const formData = await context.request.formData();
      body = Object.fromEntries(formData.entries());
    }

    const { name, email, subject, message } = body;

    if (!name || !email || !message) {
      return jsonOk({ success: false, error: 'Todos los campos obligatorios deben ser completados.' });
    }

    // Límites de tamaño (evita payloads gigantes)
    if (String(name).length > 200 || String(email).length > 320 ||
        String(subject || '').length > 300 || String(message).length > 5000) {
      return jsonOk({ success: false, error: 'El mensaje supera el tamaño máximo permitido.' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonOk({ success: false, error: 'Por favor ingresa un correo electrónico válido.' });
    }

    await registerHit(context);

    // Forward silently to FormSubmit API
    const formSubmitUrl = 'https://formsubmit.co/ajax/admin@alexistobon.com';
    const formResponse = await fetch(formSubmitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://alexistobon.com',
        'Referer': 'https://alexistobon.com/'
      },
      body: JSON.stringify({
        _subject: `[${subject || 'Consulta'}] Mensaje de ${name} vía alexistobon.com`,
        _replyto: email,
        Nombre: name,
        Email: email,
        Asunto: subject || 'Consulta general',
        Mensaje: message,
        _template: 'table'
      })
    });

    const resText = await formResponse.text();
    let data = {};
    try {
      data = JSON.parse(resText);
    } catch {
      data = { message: resText };
    }

    // Check if initial FormSubmit activation is needed
    if (data.message && typeof data.message === 'string' && data.message.toLowerCase().includes('activation')) {
      return jsonOk({
        success: false,
        needsActivation: true,
        message: 'FormSubmit requiere activación inicial: se ha enviado un correo a admin@alexistobon.com con el enlace "Activate Form". Solo debes hacer clic una vez para activar la recepción.'
      });
    }

    if (data.success === 'true' || data.success === true) {
      return jsonOk({
        success: true,
        message: 'Mensaje enviado exitosamente a admin@alexistobon.com',
        data
      });
    }

    return jsonOk({
      success: false,
      error: 'No se pudo enviar el correo en este momento.',
      data
    });

  } catch {
    return jsonOk({
      success: false,
      error: 'Error interno al procesar el mensaje.'
    });
  }
}
