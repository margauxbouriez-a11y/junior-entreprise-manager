/* Leclercq des étoiles — service worker de l'appli (PWA)
   - Le contenu (page, app.js, data.js) vient toujours du réseau en priorité :
     les mises à jour publiées depuis l'Espace liste arrivent tout de suite.
   - Hors ligne, l'appli affiche la dernière version enregistrée.
   - Les envois (commandes, cotisations, concours, publication GitHub) ne passent
     jamais par ici : seules les lectures GET de ce site et des polices sont gérées.
   Changer VERSION force le renouvellement du cache sur tous les téléphones. */
const VERSION = 'v2';
const CACHE = `leclercq-${VERSION}`;
const FONTS = `leclercq-fonts-${VERSION}`;

const PRECACHE = [
  './',
  'index.html',
  'app.js',
  'data.js',
  'manifest.webmanifest',
  'assets/logo.jpg',
  'assets/logo-180.png',
  'assets/favicon.png',
  'assets/app/icon-192.png',
  'assets/app/icon-512.png',
];

// Fichiers qui changent souvent : réseau d'abord
const LIVE = /\/(index\.html|app\.js|data\.js|manifest\.webmanifest|sitemap\.xml)?$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('leclercq-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Clé de cache sans les paramètres anti-cache (?v=…, ?source=app…)
function cacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (request.mode === 'navigate') return new URL('./', self.registration.scope).href;
  return url.href;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(cacheKey(request), res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(cacheKey(request));
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const home = await cache.match(new URL('index.html', self.registration.scope).href);
      if (home) return home;
    }
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: cacheName === CACHE });
  const network = fetch(request)
    .then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()); return res; })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Polices Google : servies depuis le cache, rafraîchies en arrière-plan
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONTS));
    return;
  }

  // Tout le reste hors de ce site (n8n, GitHub…) : on ne touche à rien
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (request.mode === 'navigate' || LIVE.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Images et autres fichiers du site
  event.respondWith(staleWhileRevalidate(request, CACHE));
});
