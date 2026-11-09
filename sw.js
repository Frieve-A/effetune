importScripts('./sw-precache.js');

const CACHE_VERSION = self.EFFECTUNE_CACHE_VERSION || 'effetune-v-dev';
const PRECACHE_URLS = self.EFFECTUNE_PRECACHE_URLS || [];
const PRECACHE_INTEGRITY = self.EFFECTUNE_PRECACHE_INTEGRITY || {};
const PRECACHE_HTML_URLS = new Map(PRECACHE_URLS
    .filter(url => url.endsWith('.html'))
    .map(url => [new URL(url, self.location.href).pathname, url]));
const DSP_WASM_URLS = {
    simd: './plugins/dsp/effetune-dsp.simd.wasm',
    baseline: './plugins/dsp/effetune-dsp.wasm'
};
const PRECACHE_CONCURRENCY = 8;

// Mirrors detectWasmExceptionHandlingSupport and detectSimdSupport in
// js/audio/dsp-wasm-loader.js; the generator copies its SIMD probe bytes.
function selectDspWasmUrl() {
    const webAssembly = self.WebAssembly;
    if (typeof webAssembly?.Tag !== 'function' || typeof webAssembly.Exception !== 'function') return null;
    try {
        if (webAssembly.validate(new Uint8Array(self.EFFECTUNE_SIMD_PROBE_BYTES || []))) return DSP_WASM_URLS.simd;
    } catch (_) {
        // An unvalidatable probe means the baseline build is used.
    }
    return DSP_WASM_URLS.baseline;
}

async function computeIntegrity(response) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()));
    return `sha256-${btoa(String.fromCharCode(...digest))}`;
}

async function precacheEntry(cache, previousCaches, url) {
    const integrity = PRECACHE_INTEGRITY[url];
    if (!integrity) throw new Error(`Precache integrity is unavailable: ${url}`);
    // Deploys change every HTTP validator, so reuse unchanged bytes from the previous release.
    for (const previous of previousCaches) {
        const cached = await previous.match(url);
        if (cached && await computeIntegrity(cached.clone()) === integrity) {
            await cache.put(url, cached);
            return;
        }
    }
    // Revalidate instead of reloading so files the page just loaded come from the HTTP cache.
    const response = await fetch(new Request(url, { cache: 'no-cache', integrity }));
    if (!response.ok) throw new Error(`Precache request failed (${response.status}): ${url}`);
    await cache.put(url, response);
}

async function precache() {
    const dspWasmUrl = selectDspWasmUrl();
    const urls = PRECACHE_URLS.filter(url =>
        url === dspWasmUrl || (url !== DSP_WASM_URLS.simd && url !== DSP_WASM_URLS.baseline));
    const previousKeys = (await caches.keys())
        .filter(key => key !== CACHE_VERSION && key.startsWith('effetune-v'));
    const previousCaches = await Promise.all(previousKeys.map(key => caches.open(key)));
    const cache = await caches.open(CACHE_VERSION);
    let next = 0;
    let failure = null;
    const worker = async () => {
        while (!failure && next < urls.length) {
            try {
                await precacheEntry(cache, previousCaches, urls[next++]);
            } catch (error) {
                failure ??= error;
            }
        }
    };
    await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, worker));
    if (failure) {
        // Like cache.addAll, leave no partial release behind.
        await caches.delete(CACHE_VERSION);
        throw failure;
    }
}

self.addEventListener('install', event => {
    event.waitUntil(precache());
});

self.addEventListener('message', event => {
    if (event.data?.type === 'GET_BUILD') {
        event.ports?.[0]?.postMessage({ build: CACHE_VERSION });
    } else if (event.data?.type === 'ACTIVATE_UPDATE' && event.data.build === CACHE_VERSION) {
        event.waitUntil(self.skipWaiting());
    }
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
        const precacheUrl = PRECACHE_HTML_URLS.get(url.pathname);
        if (precacheUrl) {
            event.respondWith(
                caches.open(CACHE_VERSION)
                    .then(cache => cache.match(precacheUrl))
                    .then(cached => cached || fetch(request))
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
                .catch(() => caches.open(CACHE_VERSION).then(cache => cache.match(request)))
        );
        return;
    }

    event.respondWith(
        caches.open(CACHE_VERSION).then(cache => cache.match(request)).then(cached => {
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
