/**
 * Cloudflare Pages Function: functions/[[catchall]].js
 * Handles all requests that do NOT match an existing static file or specific API function.
 * Automatically issues a 302 Found redirect back to "/" (home).
 */
export async function onRequest(context) {
  const targetUrl = new URL('/', context.request.url);
  return Response.redirect(targetUrl, 302);
}
