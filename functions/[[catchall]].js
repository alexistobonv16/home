/**
 * Cloudflare Pages Function: functions/[[catchall]].js
 * Intercepts all requests that are not root, static assets, or API endpoints,
 * and returns an explicit 302 Found redirect back to "/".
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. Root / homepage
  if (pathname === '/' || pathname === '/index.html') {
    return context.next();
  }

  // 2. Specific API routes
  if (pathname.startsWith('/api/')) {
    return context.next();
  }

  // 3. Static assets with extensions (.css, .js, .png, .ico, .svg, .xml, .txt, etc.)
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
    return context.next();
  }

  // 4. Any nonexistent route (e.g. /mijo, /proyectos, /test) -> 302 redirect to "/"
  return Response.redirect(new URL('/', context.request.url), 302);
}
