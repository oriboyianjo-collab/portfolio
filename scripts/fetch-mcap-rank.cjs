#!/usr/bin/env node
/* Ranked US-listed common-stock universe for the Finance tab (מיון שווי שוק / א-ב) -> data/mcap-rank.json
 * Source: Yahoo Finance screener (no key; cookie+crumb, same pattern as fetch-fundamentals.cjs).
 * Universe: region=us, quoteType=EQUITY, exchanges NMS/NYQ/NGM/NCM (Nasdaq tiers), ASE (NYSE American),
 *           NYQ is NYSE; PCX (NYSE Arca), BTS (Cboe BZX - CBOE itself lists there).
 * NOTHING is silently dropped: non-common-stock-looking records land in `excluded` with a reason,
 * and EQUITY records without a market cap land in `nocap`; both stay in the file (recoverable).
 * `ranked` is the UI list (verified company stocks only): [symbol, marketCap, shortName] sorted by cap desc. Dupe symbols keep the
 * highest-cap record (e.g. GOOGL/GOOG both stay - separate classes, never summed).
 * Live price / daily-change are NOT stored here - the app batches quotes at render time like elsewhere.
 * Usage: node scripts/fetch-mcap-rank.cjs [--out data/mcap-rank.json] [--page 250]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg('--out', 'mcap-rank.json'));
const PAGE = Math.min(250, +arg('--page', 250));
const UA = 'Mozilla/5.0';
const EXCHANGES = ['NMS', 'NYQ', 'NGM', 'NCM', 'ASE', 'PCX', 'BTS'];
const log = (...a) => console.log(...a), sleep = ms => new Promise(r => setTimeout(r, ms));

async function crumb(){
  const r = await fetch('https://fc.yahoo.com', { headers: { 'user-agent': UA }, redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const c = await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': UA, cookie } })).text();
  if (!c || c.length > 64) throw new Error('bad crumb');
  return { cookie, crumb: c };
}

async function page(auth, offset){
  const body = JSON.stringify({
    size: PAGE, offset, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY',
    query: { operator: 'and', operands: [
      { operator: 'eq', operands: ['region', 'us'] },
      { operator: 'or', operands: EXCHANGES.map(e => ({ operator: 'eq', operands: ['exchange', e] })) },
    ]},
    userId: '', userIdType: 'guid',
  });
  for (let k = 0; k < 4; k++){
    try{
      const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(auth.crumb)}`,
        { method: 'POST', headers: { 'user-agent': UA, cookie: auth.cookie, 'content-type': 'application/json' }, body });
      if (r.status === 429 || r.status >= 500){ await sleep(2000 * (k + 1)); continue; }
      const j = await r.json();
      const res = j.finance && j.finance.result && j.finance.result[0];
      if (!res) throw new Error('bad screener payload: ' + JSON.stringify(j).slice(0, 200));
      return res;
    }catch(e){ if (k === 3) throw e; await sleep(2000 * (k + 1)); }
  }
}

/* Common-stock screen. Keeps ADRs (names rarely say "depositary"; NYSE ADR symbols are plain).
 * Excludes: preferreds ("preferred/preference", "-P" suffixes, ".PR"/dot-suffixed classes),
 * warrants/rights/units, notes/baby bonds ("% ... due"), SPAC acquisition vehicles (units/blank-check). */
const JUNK = [
  [/\.[A-Z]{1,2}$/i, 'dot-class symbol'],
  [/-P[A-Z]?$/i, 'preferred symbol suffix'],
  [/-UN(T)?$/i, 'unit symbol suffix'],
  [/\bpreferred\b|\bpreference\b|\bdepositary shares\b/i, 'preferred/depositary shares'],
  [/\bwarrants?\b/i, 'warrant'],
  [/\brights?\b/i, 'rights'],
  [/\bunits?\b/i, 'unit'],
  [/\bnotes? due\b|\d+(\.\d+)?% (senior|subordinated|notes)/i, 'notes/baby bond'],
  [/\bacquisition corp\.?.*\b(unit|warrant|right)\b/i, 'SPAC paper'],
];
function classify(q){
  const sym = q.symbol || '', name = q.shortName || q.longName || '';
  for (const [re, reason] of JUNK) if (re.test(sym) || re.test(name)) return reason;
  return null;
}

(async () => {
  const auth = await crumb();
  const first = await page(auth, 0);
  const total = first.total;
  log(`screener total: ${total}`);
  const all = [...first.quotes];
  for (let off = PAGE; off < total; off += PAGE){
    const res = await page(auth, off);
    all.push(...res.quotes);
    await sleep(350);
  }
  log(`fetched rows: ${all.length}`);
  const seen = new Map();   // symbol -> record (highest cap wins)
  for (const q of all){
    const sym = (q.symbol || '').toUpperCase();
    if (!sym) continue;
    const cap = q.intradaymarketcap ?? q.marketCap ?? null;
    const name = q.shortName || q.longName || '';
    const rec = { sym, cap, name, exch: q.exchange || '', reason: classify({ symbol: sym, shortName: name }) };
    const prev = seen.get(sym);
    if (!prev || (rec.cap || 0) > (prev.cap || 0)) seen.set(sym, rec);
  }
  const excluded = [];
  /* Instrument qualification (evidence-based; funds are NOT counted as company stocks):
   *  - securities-us.json (nasdaqtrader.com symbol directory): etf=1 -> fund (ETF/ETV).
   *  - fundamentals.json (SEC 10-K/10-Q filer universe, includes BDC/REIT): membership -> company stock.
   *  - name evidence of an investment fund ("Fund"/"Closed End Fund") without 10-K membership -> fund suspect.
   *  Anything neither fund-flagged nor 10-K-verified stays in `unverified` (recoverable, not in the UI list). */
  const secUS = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'securities-us.json'), 'utf8'));
  const fund10k = new Set(Object.keys(JSON.parse(fs.readFileSync(path.resolve(ROOT, 'fundamentals.json'), 'utf8')).d));
  const secBySym = new Map(secUS.d.map(r => [r[0], r]));
  const secLookup = sym => secBySym.get(sym) || secBySym.get(sym.replace('-', '/'));
  const is10k = sym => fund10k.has(sym) || fund10k.has(sym.replace('-', '/')) || fund10k.has(sym.replace('-', '.'));
  const ranked = [], funds = [], unverified = [];
  for (const r of seen.values()){
    if (r.reason) { excluded.push({ sym: r.sym, name: r.name, cap: r.cap, exch: r.exch, reason: r.reason }); continue; }
    const s = secLookup(r.sym), etf = s ? s[2] : null, secName = s ? s[1] : r.name;
    const why = etf === 1 ? 'ETF/ETV (nasdaqtrader)' : (/\bFunds?\b|Closed End Fund/i.test(secName || '') && !is10k(r.sym) ? 'fund (name evidence, no 10-K)' : null);
    if (r.cap == null){
      if (why) funds.push({ sym: r.sym, name: secName, cap: null, reason: why + '; no cap' });
      else if (!s && !is10k(r.sym)) unverified.push({ sym: r.sym, name: r.name, cap: null, exch: r.exch });
      else ranked.push([r.sym, null, secName || r.name]);   // qualified company stock, market cap unknown - never silently absent
      continue;
    }
    if (why) { funds.push({ sym: r.sym, name: secName, cap: r.cap, reason: why }); continue; }
    if (!s && !is10k(r.sym)) { unverified.push({ sym: r.sym, name: r.name, cap: r.cap, exch: r.exch }); continue; }   // in no official directory and not a 10-K filer
    ranked.push([r.sym, r.cap, secName || r.name]);
  }
  ranked.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const out = {
    generated: new Date().toISOString(),
    source: 'yahoo-finance-screener (unofficial; region=us, EQUITY)',
    exchanges: EXCHANGES,
    note_he: 'דירוג שווי שוק נכון למועד הבנייה; מחירים ושינוי יומי מוצגים חי מהציטוטים הרגילים של האפליקציה.',
    stats: { raw_rows: all.length, unique_symbols: seen.size, ranked: ranked.length, with_cap: ranked.filter(r => r[1] != null).length, funds: funds.length, unverified: unverified.length, excluded: excluded.length },
    ranked, funds, unverified, excluded,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  log(`wrote ${OUT}: stocks=${ranked.length} (cap ${ranked.filter(r=>r[1]!=null).length}) funds=${funds.length} unverified=${unverified.length} excluded=${excluded.length}`);
})().catch(e => { console.error(e.message); process.exit(1); });
