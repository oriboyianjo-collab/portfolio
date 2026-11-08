// App content display: raw source objects remain untouched.
((g)=>{'use strict';
// App content translation contract v1.

const NEWS_K = {up:['uploaded','הועלה'], title:['title','כותרת'], date:['date','תאריך'], text:['text','טקסט','תוכן'], link:['link','קישור','url'], company:['company','חברה'], cat:['category','סוג','קטגוריה']};
const REP_K = {company:['company','חברה'], symbol:['symbol','סימול'], quarter:['quarter','רבעון'], date:['date','תאריך'], time:['time','מועד','שעה'], releaseTime:['release_time_il','שעת_פרסום_ישראל'], releaseApprox:['release_time_approx','שעת_פרסום_משוערת'],
  epsEst:['eps_est','epsEst','eps_estimate','EPS_צפי','EPS צפי','צפי רווח למניה','צפי_eps','צפי EPS'], eps:['eps','eps_actual','epsActual','actual_eps','eps_בפועל','EPS בפועל','EPS_בפועל_','רווח_למניה','רווח למניה','רווח למניה בפועל','בפועל_EPS'], revEst:['revenueEst','revenue_est','revenue_estimate','revEst','rev_est','צפי_הכנסות','צפי הכנסות'], rev:['revenue','rev','revenue_actual','revenueActual','actual_revenue','rev_actual','הכנסות','הכנסות_בפועל','הכנסות בפועל'], note:['note','הערה'], link:['link','קישור','reportUrl','report_url','reportLink','קישור_לדוח'],
  // v81: comparability (checked separately for EPS and revenue) – a surprise % is shown only when it is verified
  epsEstB:['בסיס_צפי_EPS','eps_est_basis'], epsB:['בסיס_בפועל_EPS','eps_basis'], epsCur:['מטבע_EPS','eps_currency'], epsEstCur:['מטבע_צפי_EPS','eps_est_currency'], epsActCur:['מטבע_בפועל_EPS','eps_actual_currency'], epsCmp:['השוואה_EPS','eps_comparable'], epsWhy:['הסבר_EPS','eps_explain'],
  revEstB:['בסיס_צפי_הכנסות','rev_est_basis'], revB:['בסיס_בפועל_הכנסות','rev_basis'], revCur:['מטבע_הכנסות','rev_currency'], revEstCur:['מטבע_צפי_הכנסות','rev_est_currency'], revActCur:['מטבע_בפועל_הכנסות','rev_actual_currency'], revCmp:['השוואה_הכנסות','rev_comparable'], cap:['שווי_שוק','market_cap','marketCap','mcap'], revWhy:['הסבר_הכנסות','rev_explain']};
const CAL_K = {date:['date','תאריך'], time:['time','שעה'], country:['country','מדינה'], event:['event','אירוע'], period:['period','תקופה'], imp:['importance','חשיבות'],
  forecast:['forecast','צפי'], previous:['previous','קודם'], actual:['actual','בפועל'], good:['good','טוב'], note:['note','הערה']};
const schemaVersion=1;
const aliases={news:NEWS_K,reports:REP_K,calendar:CAL_K};
const fields={
 news:['title','text','preview','company','date','link','cat','sources'],
 reports:Object.keys(REP_K).filter(k=>k!=='cap'),
 calendar:Object.keys(CAL_K)
};
function norm(v){return String(v).normalize('NFC').replace(/\r\n?/g,'\n').trim()}
function pick(o,K,k,upper){for(const n of K[k])for(const key of upper?[n,n.toUpperCase()]:[n])if(o[key]!=null&&String(o[key]).trim()!=='')return norm(o[key]);return ''}
// Matches current sources/preview consumer precedence, including truthy empty-array behavior.
function newsSources(o){const a=o.sources||o['מקורות'];if(!Array.isArray(a))return [];return a.filter(x=>x&&typeof x==='object'&&/^https?:\/\//i.test(x.url||'')&&String(x.label||'').trim()).map(x=>{const z={label:norm(x.label),url:norm(x.url)};if(String(x.role||'').trim())z.role=norm(x.role);return z})}
function sourceObject(kind,o){
 if(!aliases[kind])throw new Error('Unknown collection '+kind);
 const v={};for(const k of fields[kind]){
  if(kind==='news'&&k==='preview')v[k]=norm(o.summary||o['תקציר']||'');
  else if(kind==='news'&&k==='sources')v[k]=newsSources(o);
  else v[k]=pick(o,aliases[kind],k,kind!=='news');
 }
 return {schema:'app-content-en-v1',kind,values:v};
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
function canonicalSource(kind,o){return JSON.stringify(canonical(sourceObject(kind,o)))}
async function sourceHash(kind,o){const bytes=new TextEncoder().encode(canonicalSource(kind,o));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function hashMatches(kind,o){return o._translation?.en?.schema_version===1&&o._translation.en.source_hash===await sourceHash(kind,o)}

const HUMAN={news:['title','text','preview','company'],reports:['company','note','epsWhy','revWhy','epsEstB','epsB','revEstB','revB'],calendar:['event','period','note','forecast','previous','actual']};
function englishValue(kind,o,k){
 if(!HUMAN[kind]?.includes(k))throw new Error('Not a translated display field: '+kind+'.'+k);
 const names=k==='preview'?['summary','תקציר']:aliases[kind][k];
 // Same source alias precedence as Hebrew. Never substitute a different legacy alias silently.
 for(const name of names)for(const key of kind==='news'?[name]:[name,name.toUpperCase()]){
  if(o[key]!=null&&String(o[key]).trim()!==''){
   const val=String(o[key]),en=o[key+'_en'];
   if(en!=null&&String(en).trim()!=='')return String(en);
   // Intrinsically Latin/numeric/empty content needs no invented translation.
   if(!/[\u0590-\u05ff]/.test(val))return val;
   return null;
  }
 }
 return '';
}
function completeFields(kind,o){
 const missing=HUMAN[kind].filter(k=>englishValue(kind,o,k)===null);
 if(kind==='news'){
  const a=o.sources||o['מקורות'];
  if(Array.isArray(a))a.forEach((s,i)=>{if(!s||!/^https?:\/\//i.test(s.url||'')||!String(s.label||'').trim())return;
   for(const k of ['label','role'])if(/[\u0590-\u05ff]/.test(String(s[k]||''))&&!String(s[k+'_en']||'').trim())missing.push('sources.'+i+'.'+k);
  });
 }
 return missing;
}
async function readiness(kind,o){const missing=completeFields(kind,o);const fresh=await hashMatches(kind,o);return {ready:fresh&&!missing.length,fresh,missing};}
function originalIdentity(kind,o){
 if(typeof o['מזהה']==='string'&&o['מזהה'].trim())return o['מזהה'];
 const v=sourceObject(kind,o).values;
 return kind==='news'?'legacy-news|'+(v.title||v.text.slice(0,120))+'|'+v.date:kind==='reports'?'legacy-report|'+v.symbol+'|'+v.date:'legacy-calendar|'+v.date+'|'+v.event;
}
function legacyNewsSeenKey(o){const v=sourceObject('news',o).values;return (v.title||v.text.slice(0,120))+'|'+v.date;}
function migrateNewsSeen(raw,seen){const next={...seen};for(const o of raw){const old=legacyNewsSeenKey(o),id=originalIdentity('news',o);if(next[id]==null&&next[old]!=null)next[id]=next[old];}return next;}
const prepared=new WeakMap();
async function prepare(kind,records){await Promise.all(records.map(async o=>prepared.set(o,await readiness(kind,o))));return coverage(kind,records)}
function coverage(kind,records){const pending=[];let ready=0;for(const o of records){const r=prepared.get(o);if(r?.ready)ready++;else pending.push({id:originalIdentity(kind,o),fresh:r?.fresh||false,missing:r?.missing||['not-checked']})}return {total:records.length,ready,pending};}
function displayText(kind,o,k,lang){if(lang!=='en')return k==='preview'?norm(o.summary||o['תקציר']||''):pick(o,aliases[kind],k,kind!=='news');if(!prepared.get(o)?.ready)return k==='preview'?norm(o.summary||o['תקציר']||''):pick(o,aliases[kind],k,kind!=='news');return englishValue(kind,o,k)}
function displaySources(o,lang){const a=o.sources||o['מקורות'];if(!Array.isArray(a))return [];return a.filter(x=>x&&typeof x==='object'&&/^https?:\/\//i.test(x.url||'')&&String(x.label||'').trim()).map(x=>({url:String(x.url),label:lang==='en'&&prepared.get(o)?.ready?String(x.label_en||x.label):String(x.label),role:lang==='en'&&prepared.get(o)?.ready?String(x.role_en||x.role||''):String(x.role||'')}));}
g.ContentLanguage=Object.freeze({prepare,coverage,displayText,displaySources,schemaVersion,aliases,fields,HUMAN,sourceObject,canonicalSource,sourceHash,hashMatches,englishValue,completeFields,readiness,originalIdentity,legacyNewsSeenKey,migrateNewsSeen});
})(typeof window!=='undefined'?window:self);
