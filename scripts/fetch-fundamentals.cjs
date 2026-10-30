#!/usr/bin/env node
/* Daily PUBLIC company fundamentals for the app's stock sheet -> fundamentals.json (+ fundamentals/state.json = bookkeeping).
 * Public company data only – the universe is every US-listed (Nasdaq / NYSE / Cboe) ticker in SEC's company_tickers_exchange.json; it never
 * sees portfolio / watchlist data. Zero cost: runs in a scheduled GitHub Action, no keys.
 *  - BVPS  = (StockholdersEquity – PreferredStockValue) / shares outstanding, from the company's LATEST 10-Q / 10-K on SEC EDGAR (XBRL companyfacts).
 *            Shares = cover-page dei:EntityCommonStockSharesOutstanding of that same filing; multi-class companies (META, GOOGL, BRK ...) are not in
 *            companyfacts (classes are dimensions) → the filing's XBRL instance is read and the classes are summed.
 *  - Float = Yahoo quoteSummary floatShares (no key, cookie+crumb) ; fallback = SEC cover EntityPublicFloat ÷ the close on that date.   Also Yahoo beta (5Y monthly).
 *  - Incremental: EDGAR daily-index (new 10-Q/10-K filers since the last run) first, then never-seen companies, then the oldest-checked. SEC limit: < 10 req/s (we use ~6/s).
 * Usage: node scripts/fetch-fundamentals.cjs [--only META,TSLA] [--out fundamentals.json] [--state fundamentals/state.json] [--sec-min 1500] [--yahoo-max 1500]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg('--out', 'fundamentals.json')), STATE = path.resolve(ROOT, arg('--state', 'fundamentals/state.json'));
const ONLY = arg('--only', '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const SEC_MIN = +arg('--sec-min', 38), YAHOO_MIN = +arg('--yahoo-min', 22), YAHOO_MAX = +arg('--yahoo-max', 1500);   // minutes of budget per source / max Yahoo calls
const SEC_UA = process.env.SEC_UA || 'SavageTracker oriboyianjo-collab@example.org';   // SEC wants "Name contact"; set repo variable SEC_UA to a real contact
const YUA = 'Mozilla/5.0';   // (a long fake-Chrome UA gets 429 from Yahoo; the short one works)
const EXCH = new Set(['Nasdaq', 'NYSE', 'CBOE', 'TXSE']);
const log = (...a) => console.log(...a), sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = d => (Date.now() - Date.parse(d)) / 864e5;

// ---------- SEC fetch (rate-limited, ~6 req/s, retries on 429/5xx) ----------
let nextSlot = 0;
async function sec(url, o = {}){
  for(let k = 0; k < 4; k++){
    const now = Date.now(); nextSlot = Math.max(nextSlot, now) + 165; const wait = nextSlot - 165 - now; if(wait > 0) await sleep(wait);
    try{ const c = new AbortController(), t = setTimeout(() => c.abort(), 60000);
      const r = await fetch(url, {headers: {'User-Agent': SEC_UA, 'Accept-Encoding': 'gzip, deflate'}, signal: c.signal}); clearTimeout(t);
      if(r.status === 404 || (r.status === 403 && o.soft403)) return null;   // (EDGAR answers 403 for a daily-index file that is not published yet / a holiday)
      if(r.status === 429 || r.status === 403 || r.status >= 500){ await sleep(2500 * (k + 1)); continue; }
      if(!r.ok) return null;
      return o.text ? await r.text() : await r.json(); }
    catch(e){ await sleep(1500 * (k + 1)); } }
  return undefined; }   // undefined = failed (retry next run), null = does not exist

// ---------- pick values out of companyfacts ----------
const FORMS = new Set(['10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT', '10-QT']);
function latest(units, filter){ let best = null;
  for(const r of units || []){ if(!FORMS.has(r.form) || r.start || !r.end || (filter && !filter(r))) continue;
    if(!best || r.end > best.end || (r.end === best.end && (r.filed || '') > (best.filed || ''))) best = r; }
  return best; }
const U = (facts, tax, tag, unit) => (((facts[tax] || {})[tag] || {}).units || {})[unit] || null;
// every dei:EntityCommonStockSharesOutstanding in an XBRL instance (one per class) – summed. Inline-XBRL filings publish "<primary>_htm.xml".
function instanceShares(xml){ const ctxAll = new Map(); let m;
  const re = /<(?:dei:)?EntityCommonStockSharesOutstanding\b[^>]*?contextRef="([^"]+)"[^>]*>\s*([\d,\.]+)\s*</g;
  while((m = re.exec(xml))) ctxAll.set(m[1], +m[2].replace(/,/g, ''));
  const vals = [...ctxAll.values()].filter(v => v > 0); return vals.length ? vals.reduce((a, b) => a + b, 0) : null; }

async function company(cik, st){
  const id = String(cik).padStart(10, '0'), j = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`);
  if(j === undefined) return false;               // transient: leave as is
  const old = st.co[cik] || {}, rec = {chk: today()};
  if(j === null || !j.facts){ st.co[cik] = Object.assign(old, rec, {nf: 1}); return true; }
  const F = j.facts;
  let eqRow = latest(U(F, 'us-gaap', 'StockholdersEquity', 'USD')) ;
  if(!eqRow) eqRow = latest(U(F, 'us-gaap', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'USD'));
  if(!eqRow){ st.co[cik] = Object.assign(old, rec, {nf: 2}); return true; }   // no equity tag (funds, LPs...)
  const acc = eqRow.accn, pr = latest(U(F, 'us-gaap', 'PreferredStockValue', 'USD'), r => r.end === eqRow.end && r.accn === acc), pref = pr ? Math.max(0, pr.val) : 0;
  let shRow = latest(U(F, 'dei', 'EntityCommonStockSharesOutstanding', 'shares'), r => r.accn === acc), sh = shRow ? shRow.val : null, shd = shRow ? shRow.end : '', how = 'dei';
  if(!sh){   // multi-class: read the filing's instance document
    const sub = await sec(`https://data.sec.gov/submissions/CIK${id}.json`); const rc = sub && sub.filings && sub.filings.recent;
    const i = rc ? rc.accessionNumber.indexOf(acc) : -1;
    if(i >= 0 && rc.primaryDocument[i]){ const doc = rc.primaryDocument[i].replace(/\.html?$/i, '_htm.xml'), xml = await sec(`https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, '')}/${doc}`, {text: true});
      const v = xml && instanceShares(xml); if(v){ sh = v; shd = eqRow.end; how = 'xbrl-classes'; } } }
  if(!sh){ const g = latest(U(F, 'us-gaap', 'CommonStockSharesOutstanding', 'shares'), r => r.end === eqRow.end && r.accn === acc); if(g){ sh = g.val; shd = g.end; how = 'balance-sheet'; } }
  const pf = latest(U(F, 'dei', 'EntityPublicFloat', 'USD'));
  const eq = eqRow.val - pref;
  st.co[cik] = Object.assign(old, rec, {nf: 0, acc, form: eqRow.form.startsWith('10-K') ? 'K' : 'Q', filed: eqRow.filed, asof: eqRow.end, eq, sh: sh || null, shd, how: sh ? how : 'none', pf: pf ? pf.val : null, pfd: pf ? pf.end : ''});
  return true; }

// EDGAR daily index -> CIKs that filed a 10-Q / 10-K on that day
async function indexCiks(day){ const [y, m, d] = day.split('-'), q = Math.ceil(+m / 3), t = await sec(`https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${y}${m}${d}.idx`, {text: true, soft403: true});
  if(t === undefined) return undefined; if(!t) return [];
  const out = new Set(); for(const l of t.split('\n')){ const m2 = l.match(/^(10-K|10-Q|10-K\/A|10-Q\/A|10-KT|10-QT)\s+.*?\s(\d{3,10})\s+\d{8}\s+edgar\//); if(m2) out.add(+m2[2]); } return [...out]; }

// ---------- Yahoo (float + beta) ----------
let crumb = '', cookie = '';
async function yInit(){ try{ const r = await fetch('https://fc.yahoo.com', {headers: {'User-Agent': YUA}, redirect: 'manual'}); const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    cookie = sc.map(c => c.split(';')[0]).join('; '); if(!cookie) return false;
    const c = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {headers: {'User-Agent': YUA, Cookie: cookie}}); crumb = (await c.text()).trim(); return !!crumb && crumb.length < 30 && !/</.test(crumb); }catch(e){ return false; } }
async function yStats(tk){ for(let k = 0; k < 2; k++){ try{
    const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(tk)}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(crumb)}`, {headers: {'User-Agent': YUA, Cookie: cookie}});
    if(r.status === 404) return null; if(r.status === 429 || r.status === 401){ await sleep(2500); continue; } if(!r.ok) return undefined;
    const j = await r.json(), s = (((j.quoteSummary || {}).result || [])[0] || {}).defaultKeyStatistics; if(!s) return null; const v = x => x && typeof x.raw === 'number' ? x.raw : null;
    return {fl: v(s.floatShares), so: v(s.sharesOutstanding), beta: v(s.beta)}; }catch(e){ await sleep(1500); } } return undefined; }
async function yClose(tk, day){ try{ const t = Date.parse(day + 'T12:00:00Z') / 1000;
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?period1=${t - 5 * 86400}&period2=${t + 86400}&interval=1d`, {headers: {'User-Agent': YUA}});
    if(!r.ok) return null; const j = (await r.json()).chart.result[0], ts = j.timestamp || [], cl = j.indicators.quote[0].close || []; let c = null;
    ts.forEach((x, i) => { if(cl[i] != null && new Date(x * 1000).toISOString().slice(0, 10) <= day) c = cl[i]; }); return c; }catch(e){ return null; } }

(async () => {
  const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {v: 1, lastIdx: '', co: {}, fl: {}};
  st.co = st.co || {}; st.fl = st.fl || {};
  const u = await sec('https://www.sec.gov/files/company_tickers_exchange.json'); if(!u || !u.data){ log('company_tickers_exchange.json unavailable'); process.exit(0); }
  const tk2cik = {}, cik2tk = {}; for(const [cik, , tk, ex] of u.data){ if(!EXCH.has(ex)) continue; const T = String(tk).toUpperCase(); tk2cik[T] = cik; (cik2tk[cik] = cik2tk[cik] || []).push(T); }
  log('universe', Object.keys(tk2cik).length, 'tickers /', Object.keys(cik2tk).length, 'companies');
  // ----- SEC queue -----
  let q = [], idxOk = true;
  if(ONLY.length) q = [...new Set(ONLY.map(t => tk2cik[t]).filter(Boolean))];
  else {
    const seen = new Set(), add = c => { if(cik2tk[c] && !seen.has(c)){ seen.add(c); q.push(c); } };
    if(st.lastIdx){ const from = Math.max(Date.parse(st.lastIdx) - 2 * 86400e3, Date.now() - 12 * 864e5); for(let t = from; t <= Date.now(); t += 864e5){ const d = new Date(t), day = d.toISOString().slice(0, 10); if(d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; const r = await indexCiks(day); if(r === undefined){ idxOk = false; continue; } r.forEach(add); }
      log('daily-index filers queued:', q.length, idxOk ? '' : '(some days failed – will retry next run)'); }
    Object.keys(cik2tk).filter(c => !st.co[c]).forEach(add);                                   // never seen
    Object.keys(cik2tk).filter(c => st.co[c] && !st.co[c].nf && daysAgo(st.co[c].chk) > 7 && daysAgo(st.co[c].asof) > 95).sort((a, b) => st.co[a].chk < st.co[b].chk ? -1 : 1).forEach(add);   // overdue report: look again weekly
    Object.keys(cik2tk).filter(c => st.co[c] && daysAgo(st.co[c].chk) > 30).sort((a, b) => st.co[a].chk < st.co[b].chk ? -1 : 1).forEach(add);   // safety net: everything re-checked at least monthly
  }
  const t0 = Date.now(); let done = 0, fail = 0;
  for(const c of q){ if(Date.now() - t0 > SEC_MIN * 60e3){ log('SEC time budget reached'); break; }
    const ok = await company(c, st).catch(e => (log('  err', c, e.message), false)); ok ? done++ : fail++;
    if(done % 200 === 0 && done) { fs.mkdirSync(path.dirname(STATE), {recursive: true}); fs.writeFileSync(STATE, JSON.stringify(st)); log('  ...', done, 'of', q.length); } }
  log('SEC processed', done, 'failed', fail, 'queued', q.length);
  if(!ONLY.length && idxOk) st.lastIdx = today();
  // ----- Yahoo float / beta -----
  const tickers = Object.keys(tk2cik).filter(T => { const c = st.co[tk2cik[T]]; return c && c.sh && c.eq != null && (!ONLY.length || ONLY.includes(T)); });
  tickers.sort((a, b) => ((st.fl[a] || {}).chk || '') < ((st.fl[b] || {}).chk || '') ? -1 : 1);
  const have = await yInit(); log('yahoo session', have ? 'ok' : 'FAILED (SEC-derived fallback only)');
  let yc = 0, yf = 0; const y0 = Date.now();
  if(have) for(const T of tickers){ if(yc >= (ONLY.length ? 50 : YAHOO_MAX) || Date.now() - y0 > YAHOO_MIN * 60e3 || yf >= 40) break;
    if(!ONLY.length && (st.fl[T] || {}).chk === today()) continue;
    const r = await yStats(T.replace(/\./g, '-')); yc++; await sleep(220);
    if(r === undefined){ yf++; continue; } yf = 0; const so = st.co[tk2cik[T]].sh;
    const o = st.fl[T] = st.fl[T] || {}; o.chk = today();
    // sanity: a float below 2% of the shares is a multi-class artefact
    if(r && r.fl > 0 && r.fl <= (r.so || so) * 1.02 && r.fl >= (r.so || so) * 0.02){ o.v = Math.round(r.fl); o.s = 'Y'; o.d = today(); o.so = r.so ? Math.round(r.so) : null; }
    if(r && r.beta != null && isFinite(r.beta)) o.beta = Math.round(r.beta * 100) / 100; }
  log('yahoo calls', yc, yf >= 40 ? '(stopped: repeated failures)' : '');
  // SEC-derived float for tickers Yahoo has no float for (needs the close on the public-float date)
  let fb = 0; for(const T of tickers){ const o = st.fl[T] || (st.fl[T] = {}), c = st.co[tk2cik[T]]; if(o.v || !o.chk || o.fbTry === today() || !c.pf || !c.pfd || fb >= 200) continue; o.fbTry = today(); fb++;
    const px = await yClose(T.replace(/\./g, '-'), c.pfd); if(px > 0){ const f = Math.min(c.sh, Math.round(c.pf / px)); if(f > c.sh * 0.02){ o.v = f; o.s = 'S'; o.d = c.pfd; } } }
  log('sec-derived float fallbacks tried', fb);
  // ----- output -----
  const d = {}; let n = 0;
  for(const T of Object.keys(tk2cik)){ const c = st.co[tk2cik[T]]; if(!c || !c.sh || !(c.eq != null) || c.sh <= 0 || daysAgo(c.asof) > 400) continue; const o = st.fl[T] || {}, bv = c.eq / c.sh;
    d[T] = [Math.round(bv * 100) / 100, c.asof, c.filed, c.form === 'K' ? 1 : 0, Math.round(c.sh), o.v || null, o.v ? o.d : null, o.v ? o.s : null, o.beta != null ? o.beta : null]; d[T].length = 9; n++; }
  const body = {v: 1, note: 'Public company data only (SEC EDGAR XBRL, Yahoo Finance). Row = [BVPS, balance-sheet date, filing date, 1=10-K 0=10-Q, shares outstanding, float shares, float as-of, float source Y=Yahoo S=SEC-derived, beta 5Y monthly]', d};
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const same = prev && JSON.stringify(prev.d) === JSON.stringify(d);
  if(!same){ body.generated = new Date().toISOString(); fs.writeFileSync(OUT, JSON.stringify(body)); } else log('fundamentals.json unchanged');
  fs.mkdirSync(path.dirname(STATE), {recursive: true}); fs.writeFileSync(STATE, JSON.stringify(st));
  log('written', n, 'tickers;', Object.values(d).filter(r => r[5]).length, 'with float;', Object.values(d).filter(r => r[8] != null).length, 'with beta');
})().catch(e => { console.error(e); process.exit(1); });
