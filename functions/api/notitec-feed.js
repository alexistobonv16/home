/**
 * Cloudflare Pages Function: /api/notitec-feed
 * Proxies and edge-caches the RSS feed from notitec.co to avoid CORS issues
 */
export async function onRequest(context) {
  try {
    const rssResponse = await fetch('https://www.notitec.co/rss.xml', {
      headers: {
        'User-Agent': 'AlexisTobonHome-Worker/1.0 (+https://alexistobon.com)'
      },
      cf: {
        cacheTtl: 1800,
        cacheEverything: true
      }
    });

    if (!rssResponse.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch RSS from notitec.co' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const xmlText = await rssResponse.text();

    return new Response(xmlText, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=1800, s-maxage=3600',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
