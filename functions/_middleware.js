/**
 * Cloudflare Pages Middleware: functions/_middleware.js
 * Intercepts requests and issues a 302 redirect to "/" for any nonexistent route
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. Allow root and index.html
  if (pathname === '/' || pathname === '/index.html') {
    return context.next();
  }

  // 2. Allow API functions (/api/contact, /api/notitec-feed, etc.)
  if (pathname.startsWith('/api/')) {
    return context.next();
  }

  // 3. For any other route (like /mijo, /abc, /foo), return an explicit 302 redirect to home
  return Response.redirect(new URL('/', context.request.url), 302);
}
