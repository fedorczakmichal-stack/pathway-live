/*
 * Pathway — service worker (2026-07-29).
 *
 * Kontrakt: NETWORK-FIRST dla nawigacji. Właściciel produktu wielokrotnie
 * dostawał starą wersję z cache'u, więc gdy jest sieć, świeży dokument ZAWSZE
 * wygrywa; cache jest wyłącznie zapasem na tryb offline. Nazwa cache'u niesie
 * wersję — aktywacja kasuje wszystkie poprzednie. skipWaiting + clients.claim
 * sprawiają, że nowy worker przejmuje stronę od razu, bez zamykania kart.
 */
const VERSION = "v60";
const CACHE = `pathway-${VERSION}`;
const OFFLINE_FALLBACK = "./index.html";

self.addEventListener("install", (event) => {
  // Nie precache'ujemy listy plików: apka to jeden dokument, a 404 na
  // brakującym wpisie wywróciłby całą instalację. Dokument trafia do
  // cache'u przy pierwszym udanym pobraniu.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_FALLBACK)).catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

const putInCache = async (request, response) => {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch {
    // Brak miejsca albo tryb prywatny — offline po prostu nie zadziała.
  }
};

const networkFirst = async (request, fallbackToDocument) => {
  try {
    const response = await fetch(request);
    if (response && response.ok) putInCache(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackToDocument) {
      const document = await caches.match(OFFLINE_FALLBACK, { ignoreSearch: true });
      if (document) return document;
    }
    throw error;
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nawigacja (otwarcie apki, odświeżenie, start z ikony na ekranie głównym).
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, true));
    return;
  }

  // Ikony i manifest — też network-first, żeby podmiana ikony nie wymagała
  // usuwania apki z ekranu głównego; offline lecą z cache'u.
  event.respondWith(networkFirst(request, false));
});
