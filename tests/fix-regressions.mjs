// Targeted checks for the authorized fixes. No network, no notifications, no portfolio data.
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';

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
ok('settings shows v296', html.includes('גרסת האפליקציה: <b class="ltr">v296</b>'));
ok('shell cache v296', sw.includes("const CACHE = 'portfolio-shell-v296'"));
ok('page and worker request the same chart css', html.includes('chart-tools.css?v=267') && sw.includes("'./chart-tools.css?v=267'"));
ok('alerts script query matches', html.includes('alerts-core.js?v=269') && sw.includes('alerts-core.js?v=269'));

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

console.log(failed?`\n${failed} FAILED`:'\nALL REGRESSION CHECKS PASSED');
process.exit(failed?1:0);
