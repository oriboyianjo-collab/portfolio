#!/usr/bin/env node
// Sends the news / reports that just changed to the Savage Tracker alerts Worker (POST /push/news) so alerts go out within seconds
// instead of waiting for the app's own check. Public data only (titles / dates / tickers of news.json, a few columns of changed reports.json rows).
// No secrets in this file: the shared key comes from the env var PUSH_NEWS_KEY (GitHub Actions secret, or a local file outside the repo).
// Usage: node scripts/push-news.cjs [--before <sha>] [--after <sha=HEAD>] [--test "title"]
// Never fails the caller (exit code 0 always): the Worker's */15 cron + the app's own checks are the fallback.
const { execFileSync } = require('child_process');
const fs = require('fs');
require('../alerts-core.js');
const URL_ = process.env.PUSH_NEWS_URL || 'https://savage-orderbook.oriboyianjo.workers.dev/push/news';
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : ''; };
const warn = (m) => console.log('::warning::push-news: ' + m);
let key = process.env.PUSH_NEWS_KEY || '';
if (!key && process.env.PUSH_NEWS_KEY_FILE) { try { key = fs.readFileSync(process.env.PUSH_NEWS_KEY_FILE, 'utf8').trim(); } catch (e) {} }
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } };
const show = (sha, f) => { if (!sha || /^0+$/.test(sha)) return null; const t = git('show', sha + ':' + f); if (t == null) return null; try { return JSON.parse(t); } catch (e) { return null; } };
const fromDisk = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

(async () => {
  if (!key) { console.log('push-news: no PUSH_NEWS_KEY – skipped'); return; }
  const after = arg('after') || 'HEAD', before = arg('before');
  let news = [], reports = [];
  if (arg('test')) news = [{ 'כותרת': arg('test'), 'תאריך': new Date().toISOString().slice(0, 16).replace('T', ' '), 'הועלה': new Date().toISOString().slice(0, 16).replace('T', ' ') }];
  else {
    const n = show(after, 'news.json') || fromDisk('news.json');
    // newest 80 (same window the app / Worker look at): the Worker de-duplicates, so a run that was lost or re-sent is harmless
    if (Array.isArray(n)) news = globalThis.AlertsCore.newestNews(n).map((x) => ({ 'כותרת': x['כותרת'], 'תאריך': x['תאריך'], 'הועלה': x['הועלה'], 'חברה': x['חברה'] }));
    const r1 = show(after, 'reports.json') || fromDisk('reports.json'), r0 = show(before, 'reports.json');
    if (Array.isArray(r1) && Array.isArray(r0)) {   // only rows that are new or changed since the previous commit
      const k = (x) => x['סימול'] + '|' + x['תאריך'], old = new Map(r0.map((x) => [k(x), JSON.stringify(x)]));
      reports = r1.filter((x) => old.get(k(x)) !== JSON.stringify(x)).slice(0, 400);
    }
  }
  if (!news.length && !reports.length) { console.log('push-news: nothing to send'); return; }
  const body = JSON.stringify({ news, reports });
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Push-Key': key }, body, signal: AbortSignal.timeout(25000) });
      const t = await r.text();
      if (r.ok) { console.log('push-news: ok ' + t.slice(0, 300)); return; }
      if (r.status === 404 || r.status === 401 || r.status === 503) { warn('Worker answered ' + r.status + ' ' + t.slice(0, 120) + ' (not deployed yet / wrong key / not configured) – cron fallback stays'); return; }
      console.log('push-news: attempt ' + i + ' HTTP ' + r.status + ' ' + t.slice(0, 120));
    } catch (e) { console.log('push-news: attempt ' + i + ' ' + e.message); }
    await new Promise((x) => setTimeout(x, 2000 * i));
  }
  warn('gave up after 3 attempts – cron fallback stays');
})().catch((e) => { warn(e.message); }).then(() => process.exit(0));
