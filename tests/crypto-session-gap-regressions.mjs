import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const s=fs.readFileSync('index.html','utf8');let q=null;
const ctx={iq:()=>q,instCache:{},withLive:()=>[],wlDayView:()=>({pct:1,extO:q?.ext}),esc:x=>x,logoHtml:()=>'',watchSparkHtml:()=>'',capT:()=>'',cls:()=>'',fmtPct:x=>x+'%',chgInst:()=>({sub:''}),extLineHtml:e=>e?'<span class="xl">night</span>':'<span class="xl"></span>',fmtPrice:x=>'$'+x,fmtInst:(_,x)=>String(x),staleTag:()=>'',I18n:{p:(_,x)=>x}};vm.createContext(ctx);vm.runInContext(s.slice(s.indexOf('function wlRowHtml('),s.indexOf('// v112: lists are horizontal')),ctx);
for(const price of [null,10]){q=price==null?null:{price,prev:9};for(const sym of ['BTC','ETH','SOL','XRP'])assert.ok(!ctx.wlRowHtml({sym,type:'crypto'},0,1).includes('class="xl"'));}
for(const type of ['stock','etf','index','fx','future']){q={price:10,prev:9};assert.ok(ctx.wlRowHtml({sym:'TEST',type},0,1).includes('<span class="xl"></span>'));q.ext={price:11};assert.ok(ctx.wlRowHtml({sym:'TEST',type},0,1).includes('night'));}
assert.match(s,/html\.ext-sess #wlLists \.wr\[data-continuous="true"\]>\.pc-d\{padding-block:7\.5px\}/);
console.log('PASS crypto-only watchlist session-gap removal: BTC/ETH/SOL/XRP explicit crypto; initial/missing quotes; equities/crypto ETFs/indices/FX/futures retain empty or real stage rows');
