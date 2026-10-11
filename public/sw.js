/*
 * Santetrace patient service worker (internal cache prefix kept as "hackcure-").
 *
 * - Versioned caches; old "hackcure-*" caches are deleted on activate.
 * - /_next/static/** (content-hashed): cache-first in production,
 *   network-first when registered with ?mode=dev (Next dev assets change).
 * - Patient page navigations (/patient, /patient/*): network-first with the
 *   cached copy as fallback, then a small bilingual offline page.
 *   Pages are client-gated shells: they contain no patient data.
 * - /api/** is NEVER cached and never served from cache: always network,
 *   no offline fallback (private data, honest failures).
 * - React Server Component fetches are not cached (they vary on router headers);
 *   offline, Next falls back to a full navigation, which is served from cache.
 */
// v4: Santetrace name correction — drops shells cached under earlier brand spellings.
const VERSION = "v4";
const PREFIX = "hackcure-";
const PAGE_CACHE = `${PREFIX}pages-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const DEV = new URL(self.location.href).searchParams.get("mode") === "dev";
const NAVIGATION_TIMEOUT_MS = 8000;
const SHELL_ASSETS = ["/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-maskable.svg"];

const isApi = (url) => url.pathname === "/api" || url.pathname.startsWith("/api/");
const isPatientPath = (pathname) => pathname === "/patient" || pathname.startsWith("/patient/");
const isRsc = (request, url) => request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
const pageKey = (url) => `${url.origin}${url.pathname}`;
const cacheable = (response) => response && response.ok && response.type === "basic" && !response.redirected;

/*
 * Navigation (HTML) responses are stored only when they are clearly not
 * personalised: never with Set-Cookie (browsers usually hide that header from
 * workers, so this is a backstop) and never when Cache-Control says
 * no-store or private. Future server-rendered patient pages that declare
 * themselves private will therefore never reach the cache.
 */
const storableNavigation = (response) => {
  if (!cacheable(response)) return false;
  if (response.headers.has("Set-Cookie")) return false;
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !/(^|[,\s])(no-store|private)([,\s=]|$)/.test(cacheControl);
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== PAGE_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function offlinePage() {
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Santetrace — hors ligne</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f0f4f5;color:#212b32;font-family:system-ui,sans-serif;padding:24px}
main{max-width:420px;border:2px dashed #768692;border-radius:8px;background:#ffffff;border-top:4px solid #005eb8;padding:24px;line-height:1.5}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 12px}a{color:#005eb8;font-weight:600}
[lang=ar]{font-family:"SF Arabic","Geeza Pro","Noto Sans Arabic",Tahoma,sans-serif;line-height:1.8}</style></head>
<body><main>
<h1>Page non disponible hors ligne</h1>
<p>Cette page n’a pas encore été enregistrée sur cet appareil. Aucune donnée n’a été envoyée.</p>
<p dir="rtl" lang="ar">هذه الصفحة غير محفوظة على هذا الجهاز بعد، ولا تعمل دون اتصال. لم يُرسل أي شيء.</p>
<p><a href="/patient">Accueil patient · الرئيسية</a></p>
</main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function patientNavigation(request, url) {
  const key = pageKey(url);
  try {
    const response = await withTimeout(fetch(request), NAVIGATION_TIMEOUT_MS);
    if (storableNavigation(response)) {
      const cache = await caches.open(PAGE_CACHE);
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(key, { cacheName: PAGE_CACHE, ignoreVary: true });
    return cached || offlinePage();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Private API: never intercepted, never cached, no fallback.
  if (isApi(url)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(DEV ? networkFirst(request) : cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (request.mode === "navigate" && isPatientPath(url.pathname) && !isRsc(request, url)) {
    event.respondWith(patientNavigation(request, url));
  }
});

/* ---------- Warm-up / status messages from the patient app ---------- */

const STATIC_ASSET_PATTERN = /\/_next\/static\/[^"'\\\s<>)]+/g;

async function warmRoute(route, pages, statics) {
  try {
    const url = new URL(route, self.location.origin);
    const response = await fetch(url.href, { credentials: "same-origin", cache: "no-store" });
    if (!storableNavigation(response)) return false;
    const html = await response.clone().text();
    await pages.put(pageKey(url), response);
    const assets = Array.from(new Set(html.match(STATIC_ASSET_PATTERN) || []));
    await Promise.allSettled(
      assets.map(async (asset) => {
        if (await statics.match(asset, { ignoreVary: true })) return;
        const assetResponse = await fetch(asset, { credentials: "same-origin" });
        if (cacheable(assetResponse)) await statics.put(asset, assetResponse);
      }),
    );
    return true;
  } catch {
    return false;
  }
}

async function warm(routes) {
  const pages = await caches.open(PAGE_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const results = await Promise.all(routes.map((route) => warmRoute(route, pages, statics)));
  return results.length > 0 && results.every(Boolean);
}

async function cachedStatus(routes) {
  const pages = await caches.open(PAGE_CACHE);
  const hits = await Promise.all(
    routes.map((route) => pages.match(pageKey(new URL(route, self.location.origin)), { ignoreVary: true })),
  );
  return hits.length > 0 && hits.every(Boolean);
}

self.addEventListener("message", (event) => {
  const data = event.data;
  const port = event.ports && event.ports[0];
  if (!data || typeof data !== "object" || !port) return;
  const routes = Array.isArray(data.urls)
    ? data.urls.filter((route) => typeof route === "string" && isPatientPath(route))
    : [];
  if (data.type === "warm") {
    event.waitUntil(warm(routes).then((ok) => port.postMessage({ type: "warmed", ok })));
  } else if (data.type === "status") {
    event.waitUntil(cachedStatus(routes).then((ok) => port.postMessage({ type: "status", ok })));
  }
});
