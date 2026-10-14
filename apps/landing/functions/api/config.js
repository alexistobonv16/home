/**
 * Cloudflare Pages Function: /api/config
 * Public endpoint that returns the active landing page configuration
 * (excluding adminPin for security).
 */
import defaultConfig from '../../default-config.json';

export async function onRequestGet(context) {
  let config = { ...defaultConfig };

  if (context.env && context.env.HOME_KV) {
    try {
      const stored = await context.env.HOME_KV.get('landing_config');
      if (stored) {
        config = { ...config, ...JSON.parse(stored) };
      }
    } catch (err) {
      console.warn('Error reading landing_config from KV:', err);
    }
  }

  // Sanitizar: nunca exponer adminPin
  const { adminPin, ...publicConfig } = config;

  return new Response(JSON.stringify({ success: true, data: publicConfig }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
