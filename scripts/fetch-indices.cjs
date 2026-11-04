// Country indices that CNBC does not carry -> indices.json (read by the app, same origin). Free: Yahoo Finance public chart endpoint, server-side (no CORS needed here).
// Snapshot, NOT live: each quote carries the provider's own quote time (ts, ms). Writes only indices.json; never touches reports/news/calendar.
const fs = require('fs');
const OUT = process.argv[2] || 'indices.json';
const LIST = [   // key = app key; sym = Yahoo symbol; every entry is a PRICE index (not total return); identity verified from Yahoo's own name/type/currency
  {k:'tasi', sym:'^TASI.SR', name:'Tadawul All Shares Index', cur:'SAR'},
  {k:'qe',   sym:'^GNRI.QA', name:'QE Index', cur:'QAR'},
  {k:'sensex', sym:'^BSESN', name:'S&P BSE SENSEX', cur:'INR'}];
const UA = 'Mozilla/5.0 (compatible; savage-tracker-indices)';
async function one(e){
  const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(e.sym)+'?range=5d&interval=1d', {headers:{'User-Agent':UA}});
  if(!r.ok) throw new Error(e.sym+' HTTP '+r.status);
  const d = (await r.json()).chart.result[0], m = d.meta;
  if(m.instrumentType !== 'INDEX' || m.currency !== e.cur || String(m.longName || m.shortName).toLowerCase() !== e.name.toLowerCase()) throw new Error(e.sym+' identity mismatch: '+[m.instrumentType, m.currency, m.longName || m.shortName].join('/'));
  const price = m.regularMarketPrice, ts = m.regularMarketTime * 1000;
  if(!(price > 0) || !(ts > 0)) throw new Error(e.sym+' no price/time');
  const day = t => new Date(t + (m.gmtoffset || 0) * 1000).toISOString().slice(0, 10), today = day(ts);
  let prev = null; const T = d.timestamp || [], C = (d.indicators.quote[0] || {}).close || [];
  for(let i = T.length - 1; i >= 0; i--) if(C[i] > 0 && day(T[i] * 1000) < today){ prev = C[i]; break; }   // last completed session before the quote's day
  if(prev == null && m.chartPreviousClose > 0) prev = m.chartPreviousClose;
  return {price, prev: prev == null ? null : Math.round(prev * 100) / 100, ts, cur: e.cur, name: e.name};
}
(async () => {
  let old = {}; try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')).quotes || {}; } catch(e) {}
  const quotes = Object.assign({}, old); let ok = 0;
  for(const e of LIST){ try { quotes[e.k] = await one(e); ok++; } catch(err){ console.error('skip', e.k, err.message); } }   // a failed index keeps its previous snapshot (with its own old time)
  if(!ok) { console.error('nothing fetched'); process.exit(0); }
  fs.writeFileSync(OUT, JSON.stringify({source:'Yahoo Finance', quotes}, null, 1) + '\n');
  console.log('ok', ok, Object.keys(quotes).join(','));
})();
