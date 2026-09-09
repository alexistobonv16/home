/**
 * Cloudflare Pages Middleware: functions/_middleware.js
 * Intercepts all requests and returns a 302 redirect to "/" for any nonexistent route
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. Allow homepage
  if (pathname === '/' || pathname === '/index.html') {
    return context.next();
  }

  // 2. Allow API endpoints
  if (pathname.startsWith('/api/')) {
    return context.next();
  }

  // 3. For any path without a file extension (e.g. /mijo, /proyectos, /test),
  // return an immediate 302 redirect back to the home root "/"
  if (!/\.[a-zA-Z0-9]+$/.test(pathname)) {
    return Response.redirect(new URL('/', context.request.url), 302);
  }

  // 4. For paths with file extensions, fetch the asset
  const response = await context.next();

  // 5. If the asset does not exist (404), redirect 302 back to "/"
  if (response.status === 404) {
    return Response.redirect(new URL('/', context.request.url), 302);
  }

  return response;
}
