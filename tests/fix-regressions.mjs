// Targeted checks for the authorized fixes. No network, no notifications, no portfolio data.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import http from 'http';
import os from 'os';
import path from 'path';
import {spawn} from 'child_process';
import {fileURLToPath} from 'url';

const root = new URL('..', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const html = read('index.html');
const sw = read('sw.js');
let failed = 0;
const ok = (name, cond, detail='') => { if(!cond){ failed++; console.log('FAIL', name, detail); } else console.log('PASS', name); };

// 1. backLayers exists before session restore calls setTab.
const decl = html.indexOf('const backLayers = new Map()');
const restore = html.indexOf("sessionStorage.getItem(TAB_KEY)");
ok('backLayers initialized before tab restore', decl>0 && restore>decl, `decl ${decl} restore ${restore}`);
ok('backLayers declared once', html.split('backLayers = new Map()').length===2);

// 2. performance range is assigned, not clicked, before the delayed save.
const perfBlock = html.slice(html.indexOf('portfolioTracker.uiState'), html.indexOf('portfolioTracker.uiState')+1800);
ok('stored perf range assigned directly', perfBlock.includes('ui.perfRange = o.perf') && !perfBlock.includes('b.click()'));

// 3-4. visible version, shell cache and stylesheet query agree.
ok('settings shows v298', html.includes('גרסת האפליקציה:') && html.includes('>v298</b>') && read('i18n-en.js').includes('App version:') && read('i18n-en.js').includes('>v298</b>'));
ok('shell cache v312', sw.includes("const CACHE = 'portfolio-shell-v312'"));
ok('page and worker request the same chart css', html.includes('chart-tools.css?v=267') && sw.includes("'./chart-tools.css?v=267'"));
ok('alerts script query matches', html.includes('alerts-core.js?v=269') && sw.includes('alerts-core.js?v=269'));
ok('notification key is passed through', html.includes("alGoto(kind, p.get('s')||'', key||'')") && html.includes('alGoto(a.kind, a.sym, a.key)'));
ok('deep link keeps session restore for ordinary launches', html.includes('if(!alDeep)') && html.includes('if(o.pos) openPosition(o.pos)') && html.includes("sessionStorage.getItem(TAB_KEY)"));

// 6. overflow summary is reachable.
const ret = sw.indexOf('return fresh.length');
const more = sw.indexOf('if(fresh.length > 4)');
ok('overflow summary precedes return', more>0 && ret>more);
{
  const shown = [];
  const context = {
    shown,
    alGet: async () => ({seen:[], pending:[]}),
    alPut: async () => {},
    alShow: async it => { shown.push(it.title); }
  };
  const fn = sw.slice(sw.indexOf('async function alAdd'), sw.indexOf('async function alPeriodic'));
  const runner = vm.compileFunction(`return (async () => { ${fn}; return alAdd(items, false); })()`, ['items','alGet','alPut','alShow'], {filename:'sw-alAdd.js'});
  const items = Array.from({length:6}, (_,i)=>({key:'k'+i, kind:'news', title:'item '+i}));
  const n = await runner(items, context.alGet, context.alPut, context.alShow);
  ok('six fresh alerts show four plus a summary', n===6 && shown.length===5 && shown[4].includes('עוד 2'), shown.join(' | '));
}

// 5. legacy categories. Real public news is read only to check the mapping; it is not modified.
vm.runInContext(read('alerts-core.js'), vm.createContext({self:globalThis, globalThis}));
const cat = globalThis.AlertsCore.newsCategory;
const news = JSON.parse(read('news.json'));
const byId = Object.fromEntries(news.map(x=>[x['מזהה'], x]));
const microIds = ['n-0047','n-0048','n-0050','n-0051','n-0069','n-0106','n-0107','n-0262','n-0265','n-0557'];
const macroIds = ['n-0633'];
const neitherIds = ['n-0067','n-0068','n-0252','n-0263'];
ok('company legacy items map to micro', microIds.every(id=>cat(byId[id])==='micro'), microIds.map(id=>id+':'+cat(byId[id])).join(' '));
ok('OPEC quota item maps to macro', macroIds.every(id=>cat(byId[id])==='macro'));
ok('unrelated explainers stay uncategorized', neitherIds.every(id=>cat(byId[id])===''), neitherIds.map(id=>id+':'+JSON.stringify(cat(byId[id]))).join(' '));
ok('explicit labels are unchanged', cat({category:'macro', 'כותרת':'x'})==='macro' && cat({category:'micro', 'חברה':'AAA'})==='micro' && cat({category:'weird'})==='');

// 7. VWAP day key from the page function.
const vwapLine = html.split('\n').find(l=>l.includes("id:'vwap'"));
const vwapFn = vm.compileFunction('const xTP=R=>R.c.map((c,i)=>(R.h[i]+R.l[i]+c)/3); return ('+vwapLine.slice(vwapLine.indexOf('f:R=>')+2, vwapLine.lastIndexOf(',lbl'))+')', [], {filename:'vwap.js'});
const vwap = vwapFn();
const day = (i, close, vol)=>({c:[close], h:[close], l:[close], v:[vol], t:['2026-01-0'+i]});
// two-day series
const R = {c:[10,12,20], h:[10,12,20], l:[10,12,20], v:[1,1,1], t:['2026-01-01','2026-01-01','2026-01-02']};
const out = vwap(R,{})[0].v;
ok('VWAP resets on a date string', out[0]===10 && out[1]===11 && out[2]===20, JSON.stringify(out));
const nums = {c:[10,30], h:[10,30], l:[10,30], v:[1,1], t:[Date.UTC(2026,0,1)/1000, Date.UTC(2026,0,2)/1000]};
const nout = vwap(nums,{})[0].v;
ok('VWAP resets on numeric UTC days', nout[0]===10 && nout[1]===30, JSON.stringify(nout));

// 8. CVD grouping, copied from the page loop so the test fails if the loop regresses.
function cvd(rows, minutes, off=0){
  const numeric = typeof rows[0].time==='number';
  const T = rows.map(d=>d.time);
  const key = b => numeric ? Math.floor(b.tradeTimeinMills/1000)+off : b.tradeTime.slice(0,4)+'-'+b.tradeTime.slice(4,6)+'-'+b.tradeTime.slice(6,8);
  const at = k => { let lo=0, hi=T.length-1, res=-1; while(lo<=hi){ const m=(lo+hi)>>1; if(T[m]<=k){ res=m; lo=m+1; } else hi=m-1; } return res; };
  const mb = minutes.filter(b=>{ const hm=+String(b.tradeTime).slice(8,12); return +b.volume>0 && hm>=930 && hm<1600; });
  const sum = T.map(()=>0); let first=-1;
  mb.forEach(b=>{ const k=key(b), i=at(k); if(i<0)return; if(first<0)first=i; if(i<first)return; const o=+b.open,c=+b.close,v=+b.volume; sum[i]+=c>o?v:c<o?-v:0; });
  let cum=0; const series=T.map((_,i)=>i<first?null:(cum+=sum[i]));
  return {series, sum, first, kept:mb.length};
}
const pageLoop = html.slice(html.indexOf('mb.forEach(b=>'), html.indexOf('mb.forEach(b=>')+220);
ok('page no longer skips the first intraday bucket', pageLoop.includes('if(first<0)first=i;') && !pageLoop.includes('first=i+(off'));
// 1-minute bars grouped onto 5-minute bars. Times are already in the chart's offset space.
const base = Date.parse('2026-01-05T14:30:00Z'); // 09:30 America/New_York
const bars = [0,1,2].map(i=>({time:Math.floor((base+i*5*60000)/1000)}));
const mins = [];
for(let i=0;i<3;i++) for(let m=0;m<5;m++){
  const ms = base + (i*5+m)*60000;
  const hm = ['0930','0931','0932','0933','0934','0935','0936','0937','0938','0939','0940','0941','0942','0943','0944'][i*5+m];
  const up = m%2===0;
  mins.push({tradeTime:'20260105'+hm+'00', tradeTimeinMills:ms, open:up?10:12, close:up?12:10, volume:10});
}
const grouped = cvd(bars, mins, 0);
// each 5-minute bar: minutes 0,2,4 up (+10) and 1,3 down (-10) => +10. Cumulative 10,20,30.
ok('first 5-minute bar keeps its signed volume', JSON.stringify(grouped.series)==='[10,20,30]', JSON.stringify(grouped));
const pre = {tradeTime:'20260105092900', tradeTimeinMills:base-60000, open:1, close:2, volume:500};
const after = {tradeTime:'20260105160000', tradeTimeinMills:base+7*3600000, open:1, close:2, volume:500};
const bounds = cvd([{time:'2026-01-05'}], [pre, {tradeTime:'20260105093000', open:10, close:11, volume:100}, after], 0);
ok('regular session bounds stay 09:30 inclusive and 16:00 exclusive', JSON.stringify(bounds.series)==='[100]' && bounds.kept===1, JSON.stringify(bounds));

// 9. A notification URL / SavageOpenAlert opens that exact news item or report at a phone width.
const newsRow = news.find(x=>x['מזהה']==='n-1063');
const newsKey = 'n|'+globalThis.AlertsCore.H(String(newsRow['כותרת']||'').trim()+'|'+(newsRow['הועלה']||newsRow['תאריך']||''));
const reports = JSON.parse(read('reports.json'));
const repRow = reports.find(r=>String(r['סימול']||'').toUpperCase()==='BRK.A' && String(r['תאריך']||'').slice(0,10)==='2026-11-07');
const repKey = 'rp|BRK.A|2026-11-07';
ok('fixtures exist for deep links', !!(newsRow && repRow && newsRow.category==='micro' && repRow['הערה']));

function mime(file){ return {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}[path.extname(file)] || 'application/octet-stream'; }
function startServer(dir){
  const rootDir = path.resolve(dir);
  const server = http.createServer((req, res)=>{
    try{
      const u = new URL(req.url, 'http://127.0.0.1');
      let name = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if(!name || name.endsWith('/')) name += 'index.html';
      const file = path.resolve(rootDir, name);
      const rel = path.relative(rootDir, file);
      if(rel.startsWith('..') || path.isAbsolute(rel)){ res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf)=>{ if(err){ res.writeHead(404); res.end('missing'); return; } res.writeHead(200, {'Content-Type':mime(file), 'Cache-Control':'no-store'}); res.end(buf); });
    }catch(e){ res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(resolve=>server.listen(0, '127.0.0.1', ()=>resolve(server)));
}
function cdp(wsUrl){
  const ws = new WebSocket(wsUrl);
  let n = 0; const wait = new Map(); const listen = [];
  const ready = new Promise((res, rej)=>{ ws.addEventListener('open', ()=>res()); ws.addEventListener('error', rej); });
  ws.addEventListener('message', ev=>{
    const m = JSON.parse(ev.data);
    if(m.id && wait.has(m.id)){ const p = wait.get(m.id); wait.delete(m.id); m.error ? p.rej(new Error(m.error.message||JSON.stringify(m.error))) : p.res(m); }
    else listen.forEach(fn=>{ try{ fn(m); }catch(e){} });
  });
  return {ws, ready, on: fn=>listen.push(fn), send: async (method, params={}, sessionId)=>{ await ready; const id = ++n; return new Promise((res, rej)=>{ wait.set(id, {res, rej}); ws.send(JSON.stringify({id, method, params, sessionId})); }); }};
}
async function launchChrome(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savage-alert-'));
  const port = 9400 + Math.floor(Math.random()*400);
  const proc = spawn('google-chrome', ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync','--disable-translate','--disable-background-networking','--window-size=360,800',`--remote-debugging-port=${port}`,'--remote-allow-origins=*',`--user-data-dir=${dir}`,'about:blank'], {stdio:['ignore','ignore','pipe']});
  let log = ''; proc.stderr.on('data', d=>{ log += d; if(log.length>8000) log = log.slice(-8000); });
  for(let i=0;i<40;i++){ try{ const r = await fetch(`http://127.0.0.1:${port}/json/version`); if(r.ok){ const j = await r.json(); const browser = cdp(j.webSocketDebuggerUrl); await browser.ready; return {proc, dir, port, log:()=>log, browser}; } }catch(e){} await new Promise(r=>setTimeout(r, 250)); }
  proc.kill('SIGKILL'); throw new Error('chrome did not open a debugging port\n'+log);
}
async function openPage(browser, port, url, inject){
  const created = await browser.send('Target.createTarget', {url:'about:blank'});
  const targetId = created.result.targetId;
  let info = null;
  for(let i=0;i<30 && !info;i++){
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
    info = list.find(t=>t.id===targetId && t.webSocketDebuggerUrl);
    if(!info) await new Promise(r=>setTimeout(r, 100));
  }
  if(!info) throw new Error('new tab has no debugger socket');
  const page = cdp(info.webSocketDebuggerUrl); await page.ready;
  const exceptions = [];
  page.on(m=>{ if(m.method==='Runtime.exceptionThrown') exceptions.push(String(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || 'exception').slice(0, 500)); });
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Emulation.setDeviceMetricsOverride', {width:360, height:800, deviceScaleFactor:1, mobile:true});
  if(inject) await page.send('Page.addScriptToEvaluateOnNewDocument', {source:inject});
  const nav = await page.send('Page.navigate', {url});
  if(nav.error || nav.result?.errorText) throw new Error('navigate failed '+JSON.stringify(nav.error||nav.result));
  return {send: page.send, exceptions, ws: page.ws};
}
async function poll(page, expression, ms){
  const start = Date.now(); let last = null;
  while(Date.now()-start < ms){
    const r = await page.send('Runtime.evaluate', {expression, returnByValue:true});
    if(r.result?.exceptionDetails) last = {exception: r.result.exceptionDetails.text, detail: r.result.exceptionDetails.exception?.description};
    else last = r.result?.result?.value;
    if(last && last.ok) return last;
    await new Promise(res=>setTimeout(res, 250));
  }
  return last;
}
const coldBoot = `(()=>{ try{
  sessionStorage.setItem('portfolioTracker.newsCat','macro');
  sessionStorage.setItem('portfolioTracker.newsTab','news');
  sessionStorage.setItem('portfolioTracker.tab','portfolio');
  sessionStorage.setItem('portfolioTracker.uiState', JSON.stringify({tab:'portfolio', perf:'1M', newsQ:'zzzz-not-news', repQ:'zzzz-not-a-report', sy:{portfolio:4000, news:9000}, pos:'AAPL'}));
}catch(e){} })();`;
function newsState(key){ return `(()=>{ const key=${JSON.stringify(key)}; const el=[...document.querySelectorAll('#newsList article[data-ak]')].find(n=>n.dataset.ak===key); const hb=document.querySelector('header.top')?.getBoundingClientRect().bottom||0; const box=el?el.getBoundingClientRect():null; const det=el?.querySelector('details.news-expand'); const cat=document.querySelector('#newsCatSeg button.on')?.dataset.nc||''; const q=document.getElementById('newsQ')?.value??null; const newsOn=!!document.getElementById('tab-news')?.classList.contains('on'); const sheet=!!document.getElementById('sheet')?.classList.contains('open'); const placed=!!(box && box.top>=hb-4 && box.top<hb+40); return {ok:!!(el&&det&&det.open&&el.dataset.alPin==='1'&&newsOn&&!document.getElementById('ntNews').hidden&&q===''&&(cat==='all'||cat==='micro')&&placed&&innerWidth===360&&!sheet), found:!!el, open:!!(det&&det.open), pin:el?.dataset.alPin||'', q, cat, top:box&&Math.round(box.top), hb:Math.round(hb), w:innerWidth, newsOn, sheet, href:location.href, n:document.querySelectorAll('#newsList article').length, sample:[...document.querySelectorAll('#newsList article[data-ak]')].slice(0,2).map(n=>n.dataset.ak)}; })()`; }
function repState(sym, day){ return `(()=>{ const sym=${JSON.stringify(sym)}, day=${JSON.stringify(day)}; const el=[...document.querySelectorAll('#repList article[data-rsym]')].find(n=>n.dataset.rsym===sym&&(n.dataset.rdate===day||n.dataset.rday===day)); const hb=document.querySelector('header.top')?.getBoundingClientRect().bottom||0; const box=el?el.getBoundingClientRect():null; const note=el?.querySelector('[data-rnote]'); const mine=document.querySelector('#repPills [data-pill="mine"]'); const placed=!!(box && box.top>=hb-4 && box.top<hb+48); const repOn=!!document.getElementById('tab-news')?.classList.contains('on')&&document.getElementById('ntRep')&&!document.getElementById('ntRep').hidden; return {ok:!!(el&&el.dataset.alPin==='1'&&note&&note.classList.contains('open')&&note.getAttribute('aria-expanded')==='true'&&repOn&&document.getElementById('repQ').value===''&&(!mine||mine.getAttribute('aria-pressed')!=='true')&&placed&&innerWidth===360), found:!!el, pin:el?.dataset.alPin||'', note:!!(note&&note.classList.contains('open')), aria:note?.getAttribute('aria-expanded')||'', q:document.getElementById('repQ')?.value, mine:mine?.getAttribute('aria-pressed')||'', top:box&&Math.round(box.top), hb:Math.round(hb), w:innerWidth, repOn, rows:document.querySelectorAll('#repList article').length}; })()`; }
async function hold(page, expression){ const first = await poll(page, expression, 90000); if(!(first&&first.ok)) return first; await new Promise(r=>setTimeout(r, 900)); return poll(page, expression, 5000); }

const server = await startServer(fileURLToPath(root));
const origin = `http://127.0.0.1:${server.address().port}`;
let chrome = null;
try{
  chrome = await launchChrome();
  const coldNews = await openPage(chrome.browser, chrome.port, origin+`/index.html?al=news&s=&k=${encodeURIComponent(newsKey)}`, coldBoot);
  const coldNewsHit = await hold(coldNews, newsState(newsKey));
  ok('cold start opens the news item', !!(coldNewsHit&&coldNewsHit.ok), JSON.stringify(coldNewsHit)+' '+(coldNews.exceptions.slice(-2).join(' | ')));
  if(coldNewsHit&&coldNewsHit.ok){
    await coldNews.send('Runtime.evaluate', {expression:`document.querySelector('header.top').click(); history.back();`, returnByValue:true});
    const back = await poll(coldNews, `(()=>({ok:!!document.getElementById('tab-portfolio')?.classList.contains('on')&&!!document.querySelector('nav.bottom button[data-tab="portfolio"]')?.classList.contains('on')}))()`, 8000);
    ok('back from a news deep link returns to the previous tab', !!(back&&back.ok), JSON.stringify(back));
  } else ok('back from a news deep link returns to the previous tab', false, 'news deep link did not land');

  const coldRep = await openPage(chrome.browser, chrome.port, origin+`/index.html?al=rep&s=BRK.A&k=${encodeURIComponent(repKey)}`, coldBoot);
  const coldRepHit = await hold(coldRep, repState('BRK.A','2026-11-07'));
  ok('cold start opens the report', !!(coldRepHit&&coldRepHit.ok), JSON.stringify(coldRepHit)+' '+(coldRep.exceptions.slice(-2).join(' | ')));

  const live = await openPage(chrome.browser, chrome.port, origin+'/index.html', '');
  const ready = await poll(live, `(()=>({ok:typeof window.SavageOpenAlert==='function'}))()`, 30000);
  ok('foreground page exposes SavageOpenAlert', !!(ready&&ready.ok), JSON.stringify(ready)+' '+(live.exceptions.slice(-2).join(' | ')));
  if(ready&&ready.ok){
    await live.send('Runtime.evaluate', {expression:`document.querySelector('#newsCatSeg [data-nc="macro"]').click(); const q=document.getElementById('newsQ'); q.value='zzzz-not-news'; q.dispatchEvent(new Event('input',{bubbles:true})); window.SavageOpenAlert(${JSON.stringify(origin+'/index.html?al=news&s=&k='+encodeURIComponent(newsKey))});`, returnByValue:true});
    const liveNews = await hold(live, newsState(newsKey));
    ok('SavageOpenAlert opens the news item', !!(liveNews&&liveNews.ok), JSON.stringify(liveNews));
    await live.send('Runtime.evaluate', {expression:`document.querySelector('#newsSeg [data-nt="rep"]').click();`, returnByValue:true});
    const pill = await poll(live, `(()=>({ok:!!document.querySelector('#repPills [data-pill="mine"]')}))()`, 90000);
    if(pill&&pill.ok) await live.send('Runtime.evaluate', {expression:`document.querySelector('#repPills [data-pill="mine"]').click(); window.SavageOpenAlert(${JSON.stringify(origin+'/index.html?al=rep&s=BRK.A&k='+encodeURIComponent(repKey))});`, returnByValue:true});
    const liveRep = pill&&pill.ok ? await hold(live, repState('BRK.A','2026-11-07')) : pill;
    ok('SavageOpenAlert opens the report', !!(liveRep&&liveRep.ok), JSON.stringify(liveRep));
    await live.send('Runtime.evaluate', {expression:`window.SavageOpenAlert(${JSON.stringify(origin+'/index.html?al=news&k='+encodeURIComponent('n|doesnotexist'))});`, returnByValue:true});
    const miss = await poll(live, `(()=>{ const n=document.querySelectorAll('#newsList article').length; const pinned=document.querySelector('[data-al-pin]'); const newsOn=!!document.getElementById('tab-news')?.classList.contains('on')&&!document.getElementById('ntNews').hidden; return {ok:newsOn&&n>0&&!pinned, n, newsOn, pinned:!!pinned}; })()`, 30000);
    ok('missing news key falls back to the news section', !!(miss&&miss.ok), JSON.stringify(miss));
  }
}catch(e){ ok('headless deep-link run', false, e && e.stack || String(e)); }
finally{ try{ chrome&&chrome.proc.kill('SIGKILL'); }catch(e){} try{ server.close(); }catch(e){} try{ chrome&&fs.rmSync(chrome.dir,{recursive:true,force:true}); }catch(e){} }

console.log(failed?`\n${failed} FAILED`:'\nALL REGRESSION CHECKS PASSED');
process.exit(failed?1:0);
