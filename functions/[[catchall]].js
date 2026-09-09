/**
 * Cloudflare Pages Function: functions/[[catchall]].js
 * Intercepts requests, tries to serve the static asset / specific route,
 * and if not found (404), returns a 302 redirect back to "/".
 */
export async function onRequest(context) {
  const response = await context.next();

  if (response.status === 404) {
    return Response.redirect(new URL('/', context.request.url), 302);
  }

  return response;
}
