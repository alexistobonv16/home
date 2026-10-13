/**
 * Cloudflare Pages Function: /api/projects
 * Public endpoint to fetch active projects and current contact information.
 */
import defaultConfig from '../default-config.json';

export async function onRequestGet(context) {
  try {
    let config = null;

    if (context.env && context.env.HOME_KV) {
      const raw = await context.env.HOME_KV.get('site_config');
      if (raw) {
        try {
          config = JSON.parse(raw);
        } catch {}
      }
    }

    if (!config) {
      config = defaultConfig;
    }

    // Filter projects to only active ones for the public frontend
    const activeProjects = (config.projects || [])
      .filter(p => p.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // Exclude sensitive admin fields
    const publicData = {
      projects: activeProjects,
      contact: config.contact || defaultConfig.contact
    };

    return new Response(JSON.stringify(publicData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      projects: defaultConfig.projects,
      contact: defaultConfig.contact,
      fallback: true
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
