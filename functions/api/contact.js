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
        status: 400,
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
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Forward silently to FormSubmit API in the background
    const formSubmitUrl = 'https://formsubmit.co/ajax/admin@alexistobon.com';
    const formResponse = await fetch(formSubmitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Referer': 'https://alexistobon.com'
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

    if (!formResponse.ok) {
      const errorText = await formResponse.text();
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No se pudo enviar el correo en este momento.', 
        details: errorText 
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const data = await formResponse.json();

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

  } catch (err) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: err.message || 'Error interno al procesar el mensaje.' 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
