/* W Studio service worker: запуск без интернета.
   Стратегия «сначала сеть»: при подключении всегда загружается свежая версия
   приложения, кэш используется только офлайн. Шрифты — из кэша (они не меняются).
   Медиа пользователя хранится в IndexedDB и сюда не попадает. */
const CACHE = 'w-studio-shell-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll(SHELL).then(() =>
          // Скрипты и стили сборки (имена с хэшем) — сразу в кэш, чтобы приложение
          // запускалось без интернета уже после первого открытия.
          fetch('./index.html', { cache: 'no-cache' })
            .then((r) => r.text())
            .then((html) => {
              const assets = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => './' + m[1]);
              return c.addAll(assets);
            }),
        ),
      )
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function putInCache(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Шрифты Google: кэш, затем сеть
  if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => putInCache(req, res))));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Свои файлы: сеть (с проверкой свежести, мимо HTTP-кэша), при отсутствии сети — кэш
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => putInCache(req.mode === 'navigate' ? './index.html' : req, res))
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
      .then((res) => res || new Response('Нет соединения', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
  );
});
