// Cloudflare Pages Function: /api/chat
// Supports GET (fetch latest messages) and POST (post new message) with memory and KV persistence

let inMemoryMessages = [
  { id: 1, apodo: "Alexis", pais: "Colombia", texto: "¡Bienvenidos a Alexis TV! Señales deportivas y canales en vivo verificados.", canal: "Alexis TV", tipo: "mensaje", creado: Date.now() - 3600000 },
  { id: 2, apodo: "Carlos", pais: "Colombia", texto: "🟢 Se ve fluido", canal: "ESPN Latin America", tipo: "fluido", creado: Date.now() - 1800000 },
  { id: 3, apodo: "Andrés", pais: "México", texto: "Excelente calidad de transmisión", canal: "ESPN 2 Latin America", tipo: "mensaje", creado: Date.now() - 900000 },
  { id: 4, apodo: "Felipe", pais: "Argentina", texto: "⚽ ¡GOOOL!", canal: "ESPN Latin America", tipo: "gol", creado: Date.now() - 300000 }
];

export async function onRequestGet(context) {
  const { env } = context;
  let mensajes = inMemoryMessages;

  if (env && env.ALEXIS_TV_KV) {
    try {
      const stored = await env.ALEXIS_TV_KV.get('chat_mensajes', { type: 'json' });
      if (Array.isArray(stored) && stored.length > 0) {
        mensajes = stored;
      }
    } catch (e) {
      // ignore and use memory
    }
  }

  return new Response(JSON.stringify({ mensajes: mensajes.slice(-40) }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const data = await request.json();
    if (!data.apodo || !data.texto) {
      return new Response(JSON.stringify({ error: 'Faltan campos requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const nuevo = {
      id: Date.now(),
      apodo: String(data.apodo).trim().slice(0, 24),
      pais: String(data.pais || 'Colombia').trim().slice(0, 30),
      texto: String(data.texto).trim().slice(0, 180),
      tipo: data.tipo || 'mensaje',
      canal: String(data.canal || '').trim().slice(0, 50),
      creado: Date.now()
    };

    inMemoryMessages.push(nuevo);
    if (inMemoryMessages.length > 80) {
      inMemoryMessages = inMemoryMessages.slice(-80);
    }

    if (env && env.ALEXIS_TV_KV) {
      try {
        await env.ALEXIS_TV_KV.put('chat_mensajes', JSON.stringify(inMemoryMessages.slice(-50)));
      } catch (e) {
        // ignore
      }
    }

    return new Response(JSON.stringify({ ok: true, id: nuevo.id }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
