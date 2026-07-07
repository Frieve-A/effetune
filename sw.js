importScripts('./sw-precache.js');

const CACHE_VERSION = self.EFFECTUNE_CACHE_VERSION || 'effetune-v-dev';
const PRECACHE_URLS = self.EFFECTUNE_PRECACHE_URLS || [];
const APP_SHELL_URL = './effetune.html';

function isAppShellNavigation(url) {
    const appShellUrl = new URL(APP_SHELL_URL, self.location.href);
    return url.origin === appShellUrl.origin && url.pathname === appShellUrl.pathname;
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_VERSION && key.startsWith('effetune-v'))
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        if (isAppShellNavigation(url)) {
            event.respondWith(
                fetch(request)
                    .then(async response => {
                        if (response.ok) {
                            try {
                                const copy = response.clone();
                                const cache = await caches.open(CACHE_VERSION);
                                await cache.put(APP_SHELL_URL, copy);
                            } catch (_) {
                                // Cache updates are best-effort; never fail a live navigation.
                            }
                        }
                        return response;
                    })
                    .catch(() => caches.match(APP_SHELL_URL))
            );
            return;
        }

        event.respondWith(
            fetch(request)
                .then(async response => {
                    if (response.ok) {
                        try {
                            const copy = response.clone();
                            const cache = await caches.open(CACHE_VERSION);
                            await cache.put(request, copy);
                        } catch (_) {
                            // Cache updates are best-effort; never fail a live navigation.
                        }
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response.ok && (url.pathname.includes('/docs/') || url.pathname.endsWith('.html'))) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
                }
                return response;
            });
        })
    );
});
