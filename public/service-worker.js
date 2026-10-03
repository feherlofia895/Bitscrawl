// A Bitscrawl mindig a hálózatról tölti a játékot és az adatokat.
// Szándékosan nincs offline cache: így egy régi kliens nem keveredhet az élő multiplayerrel.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request))
  }
})
