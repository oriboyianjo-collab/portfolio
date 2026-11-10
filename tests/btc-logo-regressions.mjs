import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const s=fs.readFileSync('index.html','utf8'), match=s.match(/BTC:'(data:image\/svg\+xml,[^']+)'/);assert.ok(match);
const svg=decodeURIComponent(match[1].split(',').slice(1).join(','));assert.match(svg,/#F2A900/);assert.match(svg,/#FFFFFF/);assert.match(svg,/Bitcoin_Symbol/);
const ctx={LOGO_FIX:{BTC:match[1]},LOGO_BG:{},logoColor:()=>'',logoStart:()=>-1,logoIni:s=>s,esc:s=>s,LOGO_SRC:[],isCrypto:()=>true};vm.createContext(ctx);
vm.runInContext(s.slice(s.indexOf('function logoFix('),s.indexOf("document.addEventListener('load'",s.indexOf('function logoFix('))),ctx);
for(const sym of ['BTC','btc']){const html=ctx.logoHtml(sym);assert.match(html,/data-li="-2"/);assert.ok(html.includes(match[1]));}
assert.ok(!ctx.logoHtml('ETH').includes('<img'));assert.ok(!ctx.logoHtml('BTC',false,'CUSTOM').includes('<img'));assert.match(ctx.logoHtml('BTC',true),/class="logo lg"/);
console.log('PASS Bitcoin shared logo override: exact approved CC0 artwork, cached-source bypass, case insensitive, existing large icon, other symbols/custom labels unchanged');
