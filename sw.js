/* =============================================================================
   GymOS — sw.js (PRO)
   PWA Service Worker: Offline cache + sane update strategy (GitHub Pages friendly)

   Strategy
   - App Shell (html/css/js/manifest/icons): stale-while-revalidate
   - Navigation (SPA): serve cached index.html, update in background
   - Runtime (same-origin GET): network-first w/ cache fallback
   - Versioned caches + cleanup on activate
   - Supports SKIP_WAITING via postMessage

   Notes
   - Rutas alineadas a tu estructura: ./icons/
   - Si cambias nombres/paths, actualiza APP_SHELL y matchers.
============================================================================= */

'use strict';

const SW_VERSION = 'gymos-v1.1.0'; // ⬅️ súbelo cuando hagas cambios
const PREFIX = 'gymos';
const CACHE_APP = `${PREFIX}-app-${SW_VERSION}`;
const CACHE_RUNTIME = `${PREFIX}-runtime-${SW_VERSION}`;

// App shell: lo mínimo para que la app arranque offline sí o sí
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',

  // JS (tu orden real)
  './db.js',
  './seed.js',
  './app.js',

  // Icons (tu estructura real: /icons)
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* =========================
   UTILITIES
========================= */

const isGET = (req) => req.method === 'GET';
const isNavigation = (req) => req.mode === 'navigate';

const sameOrigin = (url) => url.origin === self.location.origin;

function isAppShellRequest(req) {
  const url = new URL(req.url);

  if (!sameOrigin(url)) return false;

  const p = url.pathname;

  // GitHub Pages: a veces el path incluye el repo, por eso usamos endsWith/includes.
  return (
    p.endsWith('/') ||
    p.endsWith('/index.html') ||
    p.endsWith('/styles.css') ||
    p.endsWith('/app.js') ||
    p.endsWith('/db.js') ||
    p.endsWith('/seed.js') ||
    p.endsWith('/manifest.webmanifest') ||
    p.includes('/icons/')
  );
}

async function safeCachePut(cache, req, res) {
  // Solo cachea si es "buena" respuesta
  if (!res) return;
  if (!res.ok) return;

  // Ojo con opaque responses (cross-origin sin CORS): mejor no cachear aquí
  // (igual no debería llegar porque filtramos same-origin)
  if (res.type === 'opaque') return;

  try {
    await cache.put(req, res.clone());
  } catch (_) {
    // A veces cache.put falla con Requests raros, mejor no tumbar el SW por eso
  }
}

/**
 * stale-while-revalidate
 * - responde cache inmediato si existe
 * - en paralelo trae de red y actualiza cache
 */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true });

  const fetchPromise = fetch(req)
    .then(async (res) => {
      await safeCachePut(cache, req, res);
      return res;
    })
    .catch(() => null);

  // Si hay cache, responde de una; si no, espera red; si no hay red, devuelve cache (null si nada)
  return cached || (await fetchPromise) || cached;
}

/**
 * network-first
 * - intenta red
 * - si falla: cache
 * - si es navegación: fallback a index.html
 */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const res = await fetch(req);
    await safeCachePut(cache, req, res);
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    if (isNavigation(req)) {
      const shell = await caches.open(CACHE_APP);
      const index = await shell.match('./index.html', { ignoreSearch: true });
      if (index) return index;
    }
    throw err;
  }
}

/* =========================
   LIFECYCLE
========================= */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP);

      // addAll es sensible: si un archivo falta, falla todo.
      // Así que hacemos un preload más tolerante:
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            const req = new Request(url, { cache: 'reload' });
            const res = await fetch(req);
            await safeCachePut(cache, req, res);
          } catch (_) {
            // Si algo no existe (por ejemplo icon faltante), no matamos el install.
          }
        })
      );

      // Activar de una la nueva versión
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map((k) => {
          // Borra cualquier cache viejo de GymOS
          if (k.startsWith(`${PREFIX}-`) && k !== CACHE_APP && k !== CACHE_RUNTIME) {
            return caches.delete(k);
          }
        })
      );

      await self.clients.claim();
    })()
  );
});

/* =========================
   MESSAGES (update flow)
========================= */

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* =========================
   FETCH
========================= */

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET
  if (!isGET(req)) return;

  const url = new URL(req.url);

  // No tocamos cross-origin (CDNs, fonts, etc.)
  if (!sameOrigin(url)) return;

  // Navegación: sirve index.html desde cache (y lo revalida)
  if (isNavigation(req)) {
    event.respondWith(staleWhileRevalidate('./index.html', CACHE_APP));
    return;
  }

  // App shell assets
  if (isAppShellRequest(req)) {
    event.respondWith(staleWhileRevalidate(req, CACHE_APP));
    return;
  }

  // Todo lo demás same-origin: network-first
  event.respondWith(networkFirst(req, CACHE_RUNTIME));
});
