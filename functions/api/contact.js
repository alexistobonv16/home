/**
 * Cloudflare Pages Function: /api/contact
 * Handles background contact form submissions to admin@alexistobon.com
 */
export async function onRequestPost(context) {
  try {
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
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Todos los campos obligatorios deben ser completados.' 
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Por favor ingresa un correo electrónico válido.' 
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

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
      return new Response(JSON.stringify({ 
        success: false,
        needsActivation: true,
        message: 'FormSubmit requiere activación inicial: se ha enviado un correo a admin@alexistobon.com con el enlace "Activate Form". Solo debes hacer clic una vez para activar la recepción.'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (data.success === 'true' || data.success === true) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Mensaje enviado exitosamente a admin@alexistobon.com',
        data 
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: data.message || 'No se pudo enviar el correo en este momento.',
      data
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: err.message || 'Error interno al procesar el mensaje.' 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
