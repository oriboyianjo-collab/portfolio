// Total net assets (AUM) per ETF from the issuers' own public fund data. Used by fetch-issuer-holdings.cjs -> holdings/issuer.json "netAssets".
// Only values an issuer publishes together with an as-of date. Any failure of one issuer leaves the previous values in place.
// Sources: iShares product screener (all US iShares ETFs), SSGA/SPDR fund finder, Global X and First Trust fund pages (one page per ticker).
const fs = require('fs'), path = require('path');
const UA = {'User-Agent': 'Mozilla/5.0 (compatible; savage-tracker-netassets)', 'Accept': '*/*'};
const iso8 = n => { const s = String(n); return /^\d{8}$/.test(s) ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : null; };
const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const parseDate = t => { const m = String(t||'').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); return m && MON[m[1].toLowerCase()] ? `${m[3]}-${String(MON[m[1].toLowerCase()]).padStart(2,'0')}-${m[2].padStart(2,'0')}` : null; };
const get = async (url, ms = 30000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try{ const r = await fetch(url, {headers: UA, signal: c.signal}); if(!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } finally { clearTimeout(t); } };
const plain = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
const money = s => { const m = String(s||'').match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BMK]?)/i); if(!m) return null; const k = {B:1e9, M:1e6, K:1e3}[m[2].toUpperCase()] || 1; return Math.round(parseFloat(m[1].replace(/,/g,'')) * k); };
async function ishares(){ const out = {}, j = JSON.parse(await get('https://www.ishares.com/us/product-screener/product-screener-v3.1.jsn?dcrPath=/templatedata/config/product-screener-v3/data/en/us-ishares/ishares-product-screener-backend-config&siteEntryPassthrough=true', 60000));
  for(const id of Object.keys(j)){ const x = j[id]; if(!x || !Array.isArray(x.productView) || !x.productView.includes('etf')) continue; const t = String(x.localExchangeTicker||'').trim().toUpperCase(), v = x.totalNetAssetsFund && x.totalNetAssetsFund.r, d = x.totalNetAssetsFundAsOf && iso8(x.totalNetAssetsFundAsOf.r);
    if(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) && v > 0 && d) out[t] = {v: Math.round(v), asOf: d, issuer: 'iShares', src: `https://www.ishares.com/us/products/${id}/`}; } return out; }
async function ssga(){ const out = {}, j = JSON.parse(await get('https://www.ssga.com/bin/v1/ssmp/fund/fundfinder?country=us&language=en&role=intermediary&product=etfs&ui=fund-finder', 60000));
  for(const f of (((j.data||{}).funds||{}).etfs||{}).datas || []){ const t = String(f.fundTicker||'').replace(/[^A-Za-z0-9.\-]/g, '').toUpperCase(), a = f.aum, d = f.asOfDate && f.asOfDate[1];
    if(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) && Array.isArray(a) && a[1] > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d||'')) out[t] = {v: Math.round(a[1] * 1e6), asOf: d, issuer: 'SSGA (SPDR)', src: 'https://www.ssga.com' + (f.fundUri || '')}; } return out; }
async function globalx(t){ const url = `https://www.globalxetfs.com/funds/${t.toLowerCase()}/`, p = plain(await get(url)), m = p.match(/Net Assets\s+(\$[\d.,]+\s*[BMK]?)\s+As of\s+([A-Za-z]{3}[a-z]*\.? \d{1,2}, \d{4})/); if(!m) return null; const v = money(m[1]), d = parseDate(m[2]); return v && d ? {v, asOf: d, issuer: 'Global X', src: url} : null; }
async function firsttrust(t){ const url = `https://www.ftportfolios.com/retail/etf/etfsummary.aspx?Ticker=${t}`, p = plain(await get(url, 40000)), m = p.match(/Total Net Assets\s+\$([\d,]+)\s+Outstanding Shares/), d = p.match(/Total Net Assets[\s\S]{0,400}?As of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i) || p.match(/as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if(!m) return null; const v = parseInt(m[1].replace(/,/g,''), 10), dm = d && d[1].match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return v > 0 && dm ? {v, asOf: `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`, issuer: 'First Trust', src: url} : null; }
async function pool(items, n, fn){ const res = []; let i = 0; await Promise.all(Array.from({length: n}, async () => { while(i < items.length){ const k = items[i++]; try{ const r = await fn(k); if(r) res.push([k, r]); }catch(e){} } })); return res; }
module.exports = async function fetchNetAssets(root, log = console.log){ const out = {};
  for(const [name, fn] of [['iShares', ishares], ['SSGA', ssga]]){ try{ const r = await fn(); Object.assign(out, r); log('NA   ' + name, Object.keys(r).length); }catch(e){ log('NA   ' + name + ' error', e.message); } }
  let names = []; try{ names = JSON.parse(fs.readFileSync(path.join(root, 'securities-us.json'), 'utf8')).d || []; }catch(e){}
  const etfs = names.filter(x => x && x[2] === 1);
  for(const [name, rx, fn] of [['Global X', /^Global X\b/i, globalx], ['First Trust', /^(First Trust|FT )/i, firsttrust]]){ const ts = etfs.filter(x => rx.test(x[1])).map(x => x[0]).filter(t => !out[t]);
    try{ const r = await pool(ts, 6, fn); r.forEach(([t, e]) => { out[t] = e; }); log('NA   ' + name, r.length + '/' + ts.length); }catch(e){ log('NA   ' + name + ' error', e.message); } }
  return out; };
