// Simple service worker: caches the app shell for offline use. Price APIs are never cached.
// Company logos (Parqet / FMP image URLs – only a ticker in the URL) go to their own runtime cache, cache-first, capped at
// LOGO_MAX entries (oldest dropped). It survives app updates (not tied to the shell version).
const CACHE = 'portfolio-shell-v262';
const LOGO_CACHE = 'portfolio-logos-v1', LOGO_MAX = 120;
const AL_CACHE = 'savage-alerts-v1', AL_CFG = './__alerts/cfg';   // v187: alerts state shared with the page (prefs, ticker lists, seen keys, pending items) – on this device only
const SHELL = ['./chart-tools.css?v=193','./', './index.html', './manifest.json', './icon-192.png?v=33', './icon-512.png?v=33', './icon-maskable-512.png?v=33', './apple-touch-icon.png?v=33', './logo.svg?v=33', './favicon-32.png?v=33', './tax-data.json?v=33', './alerts-core.js?v=249', './badge-mono-96.png',
  'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'];   // Excel reader for the bank-file import (code only; files are parsed on the device)
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, {cache: 'reload'})).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== LOGO_CACHE && k !== AL_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'assets.parqet.com' && url.pathname.startsWith('/logos/') || url.hostname === 'financialmodelingprep.com' && url.pathname.startsWith('/image-stock/')) {
    e.respondWith(caches.open(LOGO_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      // <img> requests are no-cors → opaque (status unknown); a missing logo fails to decode, the page moves on and never asks again
      if (res.ok || res.type === 'opaque') c.put(req, res.clone()).then(() => c.keys()).then(k => Promise.all(k.slice(0, Math.max(0, k.length - LOGO_MAX)).map(r => c.delete(r)))).catch(() => null);
      return res;
    }))));
    return;
  }
  // Orientation metadata must not stay on a previous app-wide 'any' manifest.
  if (url.origin === self.location.origin && url.pathname.endsWith('/manifest.json')) {
    e.respondWith(fetch(req, {cache:'no-cache'}).then(r => { if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r; }).catch(()=>caches.match(req)));return;
  }
  const isShell = url.origin === self.location.origin || url.href.startsWith('https://cdn.jsdelivr.net/') || url.href.startsWith('https://cdn.sheetjs.com/');
  if (!isShell) return; // live data (prices/FX): straight to network
  if (/\/news\.(json|md)$/.test(url.pathname)) return; // v53: owner-edited news – always from the network, never cached
  if (/\/holdings\/[^/]+\.json$/.test(url.pathname)) return; // v111: daily issuer-holdings file (public ETF data) – always from the network, never cached
  if (/\/fundamentals\.json$/.test(url.pathname)) return; // v112: daily public fundamentals file (SEC / Yahoo company data) – always from the network, never cached
  if (url.pathname.includes('/news-images/')) {   // v55: owner-uploaded images – network-first (a replaced file shows), cache as offline fallback
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; }).catch(() => caches.match(req)));
    return;
  }
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

// ---- v187: alerts (news / earnings reports / price moves) ----
try{ importScripts('./alerts-core.js?v=249'); }catch(e){}
const alGet = () => caches.open(AL_CACHE).then(c=>c.match(AL_CFG)).then(r=>r ? r.json() : null).catch(()=>null);
const alPut = cfg => caches.open(AL_CACHE).then(c=>c.put(AL_CFG, new Response(JSON.stringify(cfg), {headers:{'Content-Type':'application/json'}}))).catch(()=>null);
const alShow = it => self.registration.showNotification(it.title, {body: it.body||'', icon:'icon-192.png', badge:'badge-mono-96.png', tag: it.key, lang:'he', dir:'rtl',
  data:{url: self.registration.scope + '?al=' + encodeURIComponent(it.kind||'') + '&s=' + encodeURIComponent(it.sym||'') + '&k=' + encodeURIComponent(it.key||'')}});
async function alAdd(items, fromPush){   // record in the shared state (the page merges “pending” into its in-app list) and notify
  const cfg = (await alGet()) || {}; cfg.seen = cfg.seen||[]; cfg.pending = cfg.pending||[];
  const fresh = items.filter(it=>it && it.key && !cfg.seen.includes(it.key));
  fresh.forEach(it=>{ cfg.seen.push(it.key); cfg.pending.push(Object.assign({t:Date.now()}, it)); });
  cfg.seen = cfg.seen.slice(-800); cfg.pending = cfg.pending.slice(-60);
  await alPut(cfg);
  await Promise.all(fresh.slice(0, 4).map(alShow));
  return fresh.length;
  if(fresh.length > 4) await alShow({key:'more|'+Date.now(), kind:'news', title:'🔔 עוד '+(fresh.length-4)+' התראות', body:'פתחו את האפליקציה לרשימה המלאה'});
}
async function alPeriodic(){   // background check (Chrome/Android installed PWA only; the browser decides how often)
  const cfg = await alGet(); if(!cfg || !cfg.prefs || !cfg.prefs.on || !self.AlertsCore) return;
  const get = f => fetch(f, {cache:'no-store'}).then(r=>r.ok ? r.json() : []).catch(()=>[]);
  const [news, reports] = await Promise.all([get('./news.json'), get('./reports.json')]);
  let items = self.AlertsCore.detect({news, reports, prefs:cfg.prefs, hold:cfg.hold, watch:cfg.watch, muted:cfg.muted});
  if(!cfg.init){ cfg.init = true; cfg.seen = (cfg.seen||[]).concat(items.filter(i=>i.base).map(i=>i.key)); await alPut(cfg); items = items.filter(i=>!i.base); }   // first run: don't flood with old news
  await alAdd(items, false);
}
self.addEventListener('periodicsync', e => { if(e.tag === 'savage-alerts') e.waitUntil(alPeriodic()); });
self.addEventListener('push', e => {   // Web Push from the Cloudflare Worker: {key, kind, sym, title, body}
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(_){ d = {title: e.data ? e.data.text() : ''}; }
  if(!d.title) d.title = 'Savage Tracker'; if(!d.key) d.key = 'p|' + Date.now();
  e.waitUntil(alAdd([d], true).then(n => n ? null : alShow(d)));   // already shown by the page / periodic check (same key) -> not shown twice
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if(c){ c.postMessage({alertOpen: url}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
