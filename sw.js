// Simple service worker: caches the app shell for offline use. Price APIs are never cached.
const CACHE = 'portfolio-shell-v16';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png?v=16', './icon-512.png?v=16', './icon-maskable-512.png?v=16', './apple-touch-icon.png?v=16', './logo.svg?v=16', './favicon-32.png?v=16',
  'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'];   // Excel reader for the bank-file import (code only; files are parsed on the device)
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin || url.href.startsWith('https://cdn.jsdelivr.net/') || url.href.startsWith('https://cdn.sheetjs.com/');
  if (!isShell) return; // live data (prices/FX): straight to network
  // network-first for the page itself (so updates arrive), cache-first for the rest
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(fetch(req.url, {cache: 'no-cache', credentials: 'same-origin'}).then(r => { const cp = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return res;
  })));
});
