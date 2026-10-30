#!/usr/bin/env node
/* Fetches PUBLIC ETF holdings straight from each issuer's official daily file / fund page and writes holdings/issuer.json.
 * Public fund data only – never portfolio data. Zero cost: runs in a scheduled GitHub Action (no keys, no paid services).
 * Funds = built-in list (below) + tickers in holdings/extra-funds.json. Per ticker the adapters are tried until one returns holdings:
 *   ishares (all iShares ETFs via the public product screener), roundhill (daily CSV, all Roundhill funds), ssga (SPDR daily xlsx),
 *   ark (daily CSV), direxion (daily CSV), defiance (full-holdings page), firsttrust (holdings page), nuxt (Range / xETFs fund pages).
 * Usage: node scripts/fetch-issuer-holdings.cjs [--out holdings/issuer.json] [--only XLI,NCLD]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = argv('--out') || path.join(ROOT, 'holdings', 'issuer.json');
const ONLY = (argv('--only') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
function argv(k){ const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; }
// built-in = the app's 19 heat-map funds (hint = adapter to try first; funds without a working adapter just stay on TickerInside / ETFIQ in the app)
const BUILTIN = {XLI:'ssga',XLY:'ssga',XLF:'ssga',XLE:'ssga',XAR:'ssga',XLU:'ssga',XLB:'ssga',XLV:'ssga',XLC:'ssga',XLP:'ssga',IGV:'ishares',SOXX:'ishares',NCLD:'roundhill',DRAM:'roundhill',JEDI:'defiance',PRAM:'defiance',NUKZ:'nuxt',NECK:'nuxt',DRNZ:''};
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const log = (...a) => console.log(...a);
async function get(url, o = {}){
  for(let k = 0; k < 2; k++){
    try{ const c = new AbortController(), t = setTimeout(() => c.abort(), o.ms || 40000);
      const r = await fetch(url, {headers: Object.assign({'User-Agent': UA, 'Accept': '*/*'}, o.headers || {}), redirect: 'follow', signal: c.signal}); clearTimeout(t);
      if(!r.ok){ if(r.status === 404 || r.status === 403) return null; throw new Error('HTTP ' + r.status); }
      return o.bin ? Buffer.from(await r.arrayBuffer()) : await r.text(); }
    catch(e){ if(k) { log('   fetch fail', url.slice(0, 90), e.message); return null; } await new Promise(r => setTimeout(r, 1500)); } }
  return null; }
// ---------- helpers ----------
const BBG = {US:'',UN:'',UW:'',UQ:'',UA:'',UP:'',KS:'KR',KQ:'KR',TT:'TW',TWO:'TW',JP:'JP',JT:'JP',C1:'CN',C2:'CN',CH:'CN',CG:'CN',HK:'HK',AU:'AU',AT:'AU',LN:'GB',ID:'GB',FP:'FR',GR:'DE',GY:'DE',SS:'SE',SM:'ES',IM:'IT',IT:'IL',IJ:'IL',NA:'NL',SW:'CH',DC:'DK',FH:'FI',NO:'NO',CN:'CA',CT:'CA',BB:'BE',PL:'PT',AV:'AT',SP:'SG',NZ:'NZ',SJ:'ZA',CP:'CZ',BZ:'BR',MM:'MX',IN:'IN',TB:'TH',MK:'MY',IJ2:'ID'};
function fixSym(s){ s = String(s || '').trim().toUpperCase(); const m = s.match(/^([A-Z0-9.\-]+)\s+([A-Z0-9]{2,4})$/); if(m){ const cc = BBG[m[2]]; return cc === '' ? m[1] : m[1] + '.' + (cc || m[2].slice(0, 2)); } return s.replace(/\s+/g, '.'); }
const FUT = /^[A-Z]{2,4}[FGHJKMNQUVXZ]\d$/;
const NOTSTOCK = /\b(swap|treasury|t-bill|money market|govern(ment)? obligations|cash|futures?|e-?mini|contra|repurchase|margin|collateral|index-\w+-trs)\b|\bTRS\b/i;
const CCY = /^(US DOLLAR|DOLLAR|EURO|YEN|POUND|WON|YUAN|FRANC|KRONA|KRONE|PESO|RUPEE|RAND|BAHT|[A-Z ]*(DOLLAR|CURRENCY|WON|YUAN|YEN|STERLING|FRANC))$/i;
const num = x => { const v = parseFloat(String(x == null ? '' : x).replace(/[%,$\s]/g, '')); return isFinite(v) ? v : NaN; };
const iso = (m, d, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const mdy = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? iso(m[1], m[2], m[3]) : ''; };
const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function csv(text){ const rows = []; let r = [], f = '', q = false;   // RFC-4180 CSV
  for(let i = 0; i < text.length; i++){ const c = text[i];
    if(q){ if(c === '"'){ if(text[i + 1] === '"'){ f += '"'; i++; } else q = false; } else f += c; }
    else if(c === '"') q = true; else if(c === ','){ r.push(f); f = ''; } else if(c === '\n'){ r.push(f); rows.push(r); r = []; f = ''; } else if(c !== '\r') f += c; }
  if(f || r.length){ r.push(f); rows.push(r); } return rows; }
function done(adapter, issuer, src, asOf, rows, name){   // rows: [sym, name, weight%] – stocks only, weights > 0
  const m = new Map();
  rows.forEach(([s, n, w]) => { w = +w; if(!(w > 0) || w > 100) return; s = fixSym(s); if(FUT.test(s) && w < 1) return; if(NOTSTOCK.test(n || '') || CCY.test((n || '').trim())) return; if(/^\d{5,}[A-Z]$/.test(s)) return;
    const k = s || '~' + (n || ''); const o = m.get(k); if(o) o[2] += w; else m.set(k, [s, String(n || '').trim().slice(0, 70), w]); });
  const out = [...m.values()].map(r => [r[0], r[1], Math.round(r[2] * 1e4) / 1e4]).sort((a, b) => b[2] - a[2]);
  return out.length ? {adapter, issuer, src, asOf, name: name || '', n: out.length, rows: out} : null; }
// ---------- adapters (each: (ticker, ctx) => entry | null) ----------
let XLSX = null; try{ XLSX = require('xlsx'); }catch(e){ log('xlsx module missing – ssga adapter disabled'); }
const adapters = {
  async ssga(t){ if(!XLSX) return null; const url = `https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${t.toLowerCase()}.xlsx`;
    const buf = await get(url, {bin: true}); if(!buf || buf[0] !== 0x50) return null;
    const wb = XLSX.read(buf, {type: 'buffer'}), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: false, defval: ''});
    const hi = rows.findIndex(r => String(r[0]).trim() === 'Name'); if(hi < 0) return null; const H = rows[hi].map(x => String(x).trim());
    const iN = H.indexOf('Name'), iT = H.indexOf('Ticker'), iS = H.indexOf('SEDOL'), iW = H.indexOf('Weight'); let asOf = '';
    rows.slice(0, hi).forEach(r => { const m = String(r[1] || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/); if(m) asOf = iso(MON[m[2].toLowerCase()], m[1], m[3]); });
    const out = rows.slice(hi + 1).filter(r => r[iN] && String(r[iS]).trim() && String(r[iS]).trim() !== '-' && String(r[iT]).trim() !== '-').map(r => [r[iT], r[iN], num(r[iW])]);
    return done('ssga', 'SSGA (SPDR)', url, asOf, out); },
  async ishares(t, ctx){ if(!ctx.ish){ const txt = await get('https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true', {ms: 60000}); ctx.ish = {}; try{ const j = JSON.parse(txt); Object.keys(j).forEach(id => { const v = j[id]; if(v && v.localExchangeTicker) ctx.ish[String(v.localExchangeTicker).toUpperCase()] = id; }); }catch(e){} }
    const id = ctx.ish[t]; if(!id) return null; const url = `https://www.ishares.com/us/products/${id}/x/latest-holdings.csv`;
    const txt = await get(url); if(!txt) return null; const rows = csv(txt.replace(/^\uFEFF/, '')), hi = rows.findIndex(r => r[0] === 'Ticker'); if(hi < 0) return null;
    const H = rows[hi], iT = 0, iN = H.indexOf('Name'), iA = H.indexOf('Asset Class'), iW = ['Weight (%)', 'Market Weight', 'Notional Weight'].map(k => H.indexOf(k)).find(i => i >= 0);
    const asOfRow = rows.find(r => /Fund Holdings as of/i.test(r[0] || '')); const dm = asOfRow && String(asOfRow[1]).match(/([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})/); const asOf = dm ? iso(MON[dm[1].toLowerCase()], dm[2], dm[3]) : '';
    let body = rows.slice(hi + 1).filter(r => r[iT] && r[iN]); const eq = body.filter(r => r[iA] === 'Equity');
    if(eq.length) body = eq; else body = body.filter(r => !/Cash|Futures|Money Market|FX/i.test(r[iA]));
    return done('ishares', 'iShares', url, asOf, body.map(r => [r[iT], r[iN], num(r[iW])])); },
  async roundhill(t, ctx){ if(ctx.rh === undefined){ ctx.rh = null; const now = new Date();   // the daily file is named holdings_MMDDYYYY.csv (previous business day) – probe back a week
      for(let d = 0; d < 8 && !ctx.rh; d++){ const x = new Date(now.getTime() - d * 864e5), s = String(x.getUTCMonth() + 1).padStart(2, '0') + String(x.getUTCDate()).padStart(2, '0') + x.getUTCFullYear();
        const url = `https://www.roundhillinvestments.com/assets/data/filepointroundhill.40ru.ru_holdings_${s}.csv`, txt = await get(url); if(txt && /StockTicker/.test(txt.slice(0, 300))) ctx.rh = {url, rows: csv(txt)}; } }
    if(!ctx.rh) return null; const R = ctx.rh.rows, H = R[0], iA = H.indexOf('Account'), iT = H.indexOf('StockTicker'), iN = H.indexOf('SecurityName'), iW = H.indexOf('Weightings'), iD = H.indexOf('Date'), iM = H.indexOf('MoneyMarketFlag');
    const mine = R.slice(1).filter(r => r[iA] === t); if(!mine.length) return null; const asOf = mdy(mine[0][iD]);
    return done('roundhill', 'Roundhill', ctx.rh.url, asOf, mine.filter(r => !/ TRS /.test(r[iT]) && !r[iM] && !/^(912797|FGXXX|Cash&Other)/.test(r[iT]) && !/CASH[A-Z]{3}/.test(r[iT + 1] || '')).map(r => [r[iT], r[iN], num(r[iW])])); },
  async ark(t){ const F = {ARKK:'ARK_INNOVATION_ETF_ARKK',ARKW:'ARK_NEXT_GENERATION_INTERNET_ETF_ARKW',ARKG:'ARK_GENOMIC_REVOLUTION_ETF_ARKG',ARKQ:'ARK_AUTONOMOUS_TECH._&_ROBOTICS_ETF_ARKQ',ARKF:'ARK_FINTECH_INNOVATION_ETF_ARKF',ARKX:'ARK_SPACE_&_DEFENSE_INNOVATION_ETF_ARKX'}[t]; if(!F) return null;
    const url = `https://assets.ark-funds.com/fund-documents/funds-etf-csv/${F}_HOLDINGS.csv`, txt = await get(url); if(!txt) return null; const rows = csv(txt), H = rows[0].map(x => x.trim().toLowerCase());
    const iD = H.indexOf('date'), iN = H.indexOf('company'), iT = H.indexOf('ticker'), iW = H.indexOf('weight (%)'); const body = rows.slice(1).filter(r => r[iN] && r[iW]);
    return done('ark', 'ARK Invest', url, mdy(body[0] && body[0][iD]), body.map(r => [r[iT], r[iN], num(r[iW])])); },
  async direxion(t){ const url = `https://www.direxion.com/holdings/${t}.csv`, txt = await get(url); if(!txt || !/StockTicker/.test(txt)) return null; const rows = csv(txt), hi = rows.findIndex(r => r.includes('StockTicker')); if(hi < 0) return null; const H = rows[hi];
    const iT = H.indexOf('StockTicker'), iN = H.indexOf('SecurityDescription'), iW = H.indexOf('HoldingsPercent'), iD = H.indexOf('TradeDate'); const body = rows.slice(hi + 1).filter(r => r[iT]);
    return done('direxion', 'Direxion', url, mdy(body[0] && body[0][iD]), body.map(r => [r[iT], r[iN], num(r[iW])])); },
  async defiance(t){ const url = `https://www.defianceetfs.com/${t.toLowerCase()}-full-holdings/`, html = await get(url); if(!html || !/<th|Ticker/.test(html)) return null; const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    const cells = tr => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(c => c.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim());
    const rows = trs.map(cells).filter(c => c.length >= 4 && /%$/.test(c[3])); const am = html.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    return done('defiance', 'Defiance', url, mdy(am && am[1]), rows.map(c => [c[0], c[1], num(c[3])])); },
  async firsttrust(t){ const url = `https://www.ftportfolios.com/Retail/Etf/EtfHoldings.aspx?Ticker=${t}`, html = await get(url); if(!html || !/fundSilverGrid/.test(html)) return null;
    const trs = (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []), cells = tr => (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(c => c.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    const rows = trs.map(cells).filter(c => c.length === 7 && /%$/.test(c[6])); const am = html.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
    return done('firsttrust', 'First Trust', url, mdy(am && am[1]), rows.map(c => [c[1], c[0], num(c[6])])); },
  async nuxt(t){ for(const base of [`https://rangeetfs.com/${t.toLowerCase()}/`, `https://funds.xetfs.com/${t.toLowerCase()}`]){   // Range / xETFs (same Nuxt platform): the full holdings table is in the page's __NUXT_DATA__
      const html = await get(base); if(!html) continue; const m = html.match(/<script type="application\/json" data-nuxt-data="nuxt-app"[^>]*id="__NUXT_DATA__">([\s\S]*?)<\/script>/); if(!m) continue; let arr; try{ arr = JSON.parse(m[1]); }catch(e){ continue; }
      const RX = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']), memo = new Map();
      const res = i => { if(memo.has(i)) return memo.get(i); const v = arr[i]; let o;
        if(Array.isArray(v)){ if(v.length === 2 && RX.has(v[0])) o = res(v[1]); else if(typeof v[0] === 'string' && ['Set', 'Map', 'Date', 'null', 'undefined', 'NaN', 'BigInt', 'RegExp'].includes(v[0])) o = null; else { o = []; memo.set(i, o); v.forEach(x => o.push(typeof x === 'number' ? res(x) : x)); } }
        else if(v && typeof v === 'object'){ o = {}; memo.set(i, o); Object.keys(v).forEach(k => { o[k] = typeof v[k] === 'number' ? res(v[k]) : v[k]; }); } else o = v; memo.set(i, o); return o; };
      let fin = null; const seen = new Set(), walk = (o, d) => { if(!o || typeof o !== 'object' || seen.has(o) || d > 12 || fin) return; seen.add(o);
        if(Array.isArray(o) && o.length > 5 && o[0] && typeof o[0] === 'object' && 'percent_of_nav' in o[0] && 'ticker' in o[0]){ fin = o; return; } (Array.isArray(o) ? o : Object.values(o)).forEach(x => walk(x, d + 1)); };
      walk(res(0), 0); if(!fin) continue; const am = html.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
      const ttl = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
      return done('nuxt', /xetfs/.test(base) ? 'xETFs' : 'Range Funds', base, mdy(am && am[1]), fin.filter(r => r.ticker && !/^(USD|CASH|MMF)/i.test(r.ticker) && !/\bUS DOLLAR|CASH\b/i.test(r.description || '')).map(r => [r.ticker, r.description, num(r.percent_of_nav)]), ttl.split('|')[0].trim()); } return null; },
};
const ORDER = ['ishares', 'roundhill', 'ssga', 'ark', 'direxion', 'defiance', 'firsttrust', 'nuxt'];
(async () => {
  let prev = {}; try{ prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); }catch(e){}
  let extra = []; try{ const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'holdings', 'extra-funds.json'), 'utf8')); extra = (j.tickers || j.funds || []).map(x => String(x).toUpperCase().trim()).filter(x => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)); }catch(e){}
  const list = [...new Set([...Object.keys(BUILTIN), ...extra])].filter(t => !ONLY.length || ONLY.includes(t)), ctx = {}, funds = Object.assign({}, prev.funds || {}), missing = [];
  for(const t of list){ const hint = BUILTIN[t], order = hint ? [hint, ...ORDER.filter(a => a !== hint)] : ORDER; let e = null, tried = [];
    for(const a of order){ try{ e = await adapters[a](t, ctx); }catch(err){ log('  ', t, a, 'error', err.message); e = null; } tried.push(a); if(e) break; }
    if(e){ funds[t] = e; log(`OK   ${t.padEnd(6)} ${e.adapter.padEnd(10)} ${String(e.n).padStart(4)} rows  asOf ${e.asOf}  ${e.issuer}`); }
    else { missing.push(t); log(`MISS ${t.padEnd(6)} (tried ${tried.join(',')})${funds[t] ? ' – keeping previous ' + funds[t].asOf : ''}`); } }
  Object.keys(funds).forEach(t => { if(!BUILTIN.hasOwnProperty(t) && !extra.includes(t)) delete funds[t]; });
  const out = {version: 1, generated: prev.generated || new Date().toISOString(), note: 'Public ETF holdings from each issuer\'s official file – see holdings/README.md. rows = [symbol, name, weight % of net assets]', funds, missing: missing.filter(t => !funds[t] || funds[t].stale)};
  const same = JSON.stringify(prev.funds || {}) === JSON.stringify(funds) && JSON.stringify(prev.missing || []) === JSON.stringify(out.missing);
  if(!same) out.generated = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), {recursive: true}); fs.writeFileSync(OUT, JSON.stringify(out) + '\n'); log(same ? 'no change' : 'written', OUT, Object.keys(funds).length, 'funds');
})();
