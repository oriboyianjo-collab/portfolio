#!/usr/bin/env node
/* Adds one ETF ticker to holdings/extra-funds.json (used by the "ETF: <TICKER>" issue / manual dispatch). Public fund tickers only. */
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, '..', 'holdings', 'extra-funds.json');
const t = String(process.argv[2] || '').toUpperCase().trim();
if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)){ console.log('invalid ticker'); process.exit(2); }
let j = {tickers: []}; try{ j = JSON.parse(fs.readFileSync(F, 'utf8')); }catch(e){}
j.tickers = Array.isArray(j.tickers) ? j.tickers.map(x => String(x).toUpperCase()) : [];
if(j.tickers.includes(t)){ console.log('already listed'); process.exit(0); }
if(j.tickers.length >= 60){ console.log('list full (60)'); process.exit(3); }
j.tickers.push(t); j.tickers.sort();
fs.writeFileSync(F, JSON.stringify(j, null, 2) + '\n'); console.log('added', t);
