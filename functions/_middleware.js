/**
 * Cloudflare Pages Middleware: functions/_middleware.js
 * Enrutamiento multidominio para la suite de aplicaciones de Alexis Tobón:
 * - radio.alexistobon.com -> Sirve Alexis Radio (radio.html) como raíz con PWA aislada.
 * - tv.alexistobon.com    -> Sirve Alexis TV (tv.html) como raíz con PWA aislada.
 * - alexistobon.com       -> Redirige /radio y /tv a sus respectivos subdominios
 *                            y sirve el portfolio principal en la raíz.
 */

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const hostname = url.hostname.toLowerCase();

  // -------------------------------------------------------------
  // 1. SUBDOMINIO: radio.alexistobon.com
  // -------------------------------------------------------------
  if (hostname === 'radio.alexistobon.com') {
    // Si acceden con el path redundante /radio o /radio.html, redirige limpiamente a la raíz /
    if (url.pathname === '/radio' || url.pathname === '/radio/' || url.pathname === '/radio.html') {
      const target = new URL('/', url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 301);
    }

    // Raíz de la app de Radio: sirve el asset canonical /radio sin 308 redirect
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const assetUrl = new URL('/radio', url.origin);
      assetUrl.search = url.search;
      return context.env.ASSETS.fetch(new Request(assetUrl, context.request));
    }

    // Alias estándar de PWA Manifest
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/manifest.json') {
      const assetUrl = new URL('/radio.webmanifest', url.origin);
      return context.env.ASSETS.fetch(new Request(assetUrl, context.request));
    }

    // Alias estándar de Service Worker
    if (url.pathname === '/sw.js') {
      const assetUrl = new URL('/radio-sw.js', url.origin);
      return context.env.ASSETS.fetch(new Request(assetUrl, context.request));
    }

    // API endpoints y recursos estáticos pasan directamente
    return context.next();
  }

  // -------------------------------------------------------------
  // 2. SUBDOMINIO: tv.alexistobon.com
  // -------------------------------------------------------------
  if (hostname === 'tv.alexistobon.com') {
    // Si acceden con el path redundante /tv o /tv.html, redirige limpiamente a la raíz /
    if (url.pathname === '/tv' || url.pathname === '/tv/' || url.pathname === '/tv.html') {
      const target = new URL('/', url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 301);
    }

    // Raíz de la app de TV: sirve el asset canonical /tv sin 308 redirect
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const assetUrl = new URL('/tv', url.origin);
      assetUrl.search = url.search;
      return context.env.ASSETS.fetch(new Request(assetUrl, context.request));
    }

    // Alias estándar de PWA Manifest
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/manifest.json') {
      const assetUrl = new URL('/tv.webmanifest', url.origin);
      return context.env.ASSETS.fetch(new Request(assetUrl, context.request));
    }

    // Alias estándar de Service Worker
    if (url.pathname === '/sw.js') {
      const assetUrl = new URL('/tv-sw.js', url.origin);
      return context.env.ASSETS.fetch(new Request(assetUrl, context.request));
    }

    // API endpoints y recursos estáticos pasan directamente
    return context.next();
  }

  // -------------------------------------------------------------
  // 3. DOMINIO PRINCIPAL: alexistobon.com (y www.alexistobon.com)
  // -------------------------------------------------------------
  if (hostname === 'alexistobon.com' || hostname === 'www.alexistobon.com') {
    if (url.pathname === '/radio' || url.pathname === '/radio/' || url.pathname === '/radio.html') {
      const target = new URL('https://radio.alexistobon.com/');
      target.search = url.search;
      return Response.redirect(target.toString(), 301);
    }
    if (url.pathname === '/tv' || url.pathname === '/tv/' || url.pathname === '/tv.html') {
      const target = new URL('https://tv.alexistobon.com/');
      target.search = url.search;
      return Response.redirect(target.toString(), 301);
    }
  }

  // Cualquier otra ruta o entorno (localhost, *.pages.dev) continúa por defecto
  return context.next();
}
