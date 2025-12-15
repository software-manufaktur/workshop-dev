const CACHE_VERSION = "v2.1";
const STATIC_CACHE = `workshop-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `workshop-runtime-${CACHE_VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./static/logo.png",
  "./static/bg.jpg",
  "./static/icons/logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

const ASSET_EXT = /\.(?:js|css|png|jpg|jpeg|svg|webmanifest)$/i;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const allowedSchemes = ["http:", "https:"];
  if (!allowedSchemes.includes(url.protocol)) return;
  const accept = req.headers.get("accept") || "";

  try {
    // Navigation / HTML -> network-first
    if (req.mode === "navigate" || accept.includes("text/html")) {
      event.respondWith(networkFirst(req));
      return;
    }

    // Static assets -> cache-first
    if (ASSET_EXT.test(url.pathname) || PRECACHE.some((p) => url.pathname.endsWith(p.replace("./", "/")))) {
      event.respondWith(cacheFirst(req));
      return;
    }

    // Default: try cache, then network
    event.respondWith(cacheFirst(req, true));
  } catch (err) {
    // Fallback: try network, then cache
    event.respondWith(
      fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then((res) => res || caches.match("./index.html")))
    );
  }
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (_err) {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    return caches.match("./index.html");
  }
}

async function cacheFirst(req, fallbackToNetwork = false) {
  const cached = await caches.match(req, { ignoreSearch: true });
  if (cached) return cached;
  if (!fallbackToNetwork) {
    try {
      const res = await fetch(req);
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
      return res;
    } catch (_err) {
      return caches.match("./index.html");
    }
  }
  try {
    const res = await fetch(req);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(req, res.clone());
    return res;
  } catch (_err) {
    return caches.match("./index.html");
  }
}
