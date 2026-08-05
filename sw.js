/*
 * Pathway — service worker (2026-07-29).
 *
 * Kontrakt: NETWORK-FIRST dla nawigacji. Właściciel produktu wielokrotnie
 * dostawał starą wersję z cache'u, więc gdy jest sieć, świeży dokument ZAWSZE
 * wygrywa; cache jest wyłącznie zapasem na tryb offline. Nazwa cache'u niesie
 * wersję — aktywacja kasuje wszystkie poprzednie. skipWaiting + clients.claim
 * sprawiają, że nowy worker przejmuje stronę od razu, bez zamykania kart.
 */
const VERSION = "v79";
const CACHE = `pathway-${VERSION}`;
const OFFLINE_FALLBACK = "./index.html";

// GitHub Pages wysyła `Cache-Control: max-age=600`, a zwykły fetch()
// respektuje cache HTTP przeglądarki — przez 10 minut po deployu network-first
// oddawałby STARY dokument mimo działającej sieci, czyli dokładnie ten ból,
// przed którym ten worker ma chronić. `cache: "no-cache"` wymusza rewalidację
// (tanią: przy braku zmian wraca 304 bez treści), a NIE "reload", który
// ściągałby ~14 MB (gzip) przy każdym otwarciu apki.
const revalidating = (request) => new Request(request.url, {
  cache: "no-cache",
  credentials: "same-origin",
  redirect: "follow",
});

self.addEventListener("install", (event) => {
  // Nie precache'ujemy listy plików: apka to jeden dokument, a 404 na
  // brakującym wpisie wywróciłby całą instalację.
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const response = await fetch(new Request(OFFLINE_FALLBACK, { cache: "no-cache" }));
        if (response && response.ok) await cache.put(OFFLINE_FALLBACK, response);
      } catch {
        // Bez sieci przy instalacji tryb offline dojrzeje przy pierwszej nawigacji.
      }
    })(),
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

// Dokument waży ~21 MB (gzip ~14 MB), więc na słabym LTE albo w captive
// portalu fetch
// potrafi wisieć dziesiątki sekund — a zainstalowana apka stoi wtedy na
// splashu, mimo że kompletna kopia leży w cache'u. Po SLOW_NETWORK_MS
// oddajemy cache, ale pobieranie leci dalej i i tak odświeży cache.
const SLOW_NETWORK_MS = 6000;
const afterTimeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

const networkFirst = async (request, fallbackToDocument) => {
  const networkPromise = fetch(revalidating(request)).then((response) => {
    if (response && response.ok) putInCache(request, response.clone());
    return response;
  });

  if (fallbackToDocument) {
    try {
      const winner = await Promise.race([networkPromise, afterTimeout(SLOW_NETWORK_MS)]);
      if (winner) return winner;
    } catch {
      // Sieć padła — niżej próbujemy cache'u.
    }
    const cached = await caches.match(request, { ignoreSearch: true })
      || await caches.match(OFFLINE_FALLBACK, { ignoreSearch: true });
    if (cached) return cached;
    return networkPromise;
  }

  try {
    return await networkPromise;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
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
