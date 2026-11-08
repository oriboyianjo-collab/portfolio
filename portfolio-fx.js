/* Provider-specific dated reference rates. Never infer history from a live quote. */
(function(root){'use strict';
const KEY='portfolioTracker.datedFx.v1',DAY=864e5;
const validDate=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return false;const t=Date.parse(d+'T12:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d};
const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*DAY).toISOString().slice(0,10);
class DatedFx{
 constructor({storage,fetchJSON,now=()=>new Date().toISOString().slice(0,10)}={}){this.storage=storage;this.fetchJSON=fetchJSON;this.now=now;this.inflight=new Map();this.version=0;try{this.cache=JSON.parse(storage?.getItem(KEY))||{}}catch(_){this.cache={}}this.rebuild();}
 rebuild(){const series={},coverage={};for(const [cur,c]of Object.entries(this.cache)){if(!c.rows?.length)continue;series[cur]=c.rows;coverage[cur]={from:c.from,to:c.to}}this.book=new root.PortfolioCurrency.FxBook(series,coverage);this.version++;}
 save(){try{this.storage?.setItem(KEY,JSON.stringify(this.cache))}catch(_){/* no quota-based data deletion */}}
 rate(...args){return this.book.rate(...args)}
 async ensure(currencies,from,to=this.now()){
  if(!validDate(from)||!validDate(to)||from>to)return;
  await Promise.all([...new Set(currencies)].filter(c=>c&&c!=='USD'&&/^[A-Z]{3}$/.test(c)).map(cur=>this.ensureCurrency(cur,from,to)));
 }
 async ensureCurrency(cur,from,to){
  const c=this.cache[cur];if(c&&c.from<=from&&c.to>=to)return true;
  const key=cur+'|'+from+'|'+to;if(this.inflight.has(key))return this.inflight.get(key);
  const work=(async()=>{const rows=[];let all=true;
   // One consistent provider for the whole requested series; no blended rates.
   for(const provider of ['boi','ecb']){rows.length=0;all=true;
    for(let start=shift(from,-7);start<=to;){const end=to<start.slice(0,4)+'-12-31'?to:start.slice(0,4)+'-12-31';
     const url='https://api.frankfurter.dev/v2/providers/'+provider+'/rates?base=USD&quotes='+encodeURIComponent(cur)+'&from='+start+'&to='+end;
     try{const data=await this.fetchJSON(url,15000);if(!Array.isArray(data)||!data.length)throw new Error('no dated observations');const part=data.filter(r=>r.base==='USD'&&r.quote===cur&&Number.isFinite(Number(r.rate))&&Number(r.rate)>0&&r.date>=start&&r.date<=end).map(r=>({date:r.date,rate:Number(r.rate),source:provider.toUpperCase()+' via Frankfurter',url}));if(!part.length)throw new Error('no matching observations');rows.push(...part)}catch(_){all=false;break}start=shift(end,1);
    }
    if(all&&rows.length){this.cache[cur]={from,to,provider,rows:[...new Map(rows.map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date)),fetched:Date.now()};this.rebuild();this.save();return true}
   }return false;
  })().finally(()=>this.inflight.delete(key));this.inflight.set(key,work);return work;
 }
}
root.PortfolioDatedFx={DatedFx};if(typeof module!=='undefined'&&module.exports)module.exports={DatedFx};
})(typeof window!=='undefined'?window:globalThis);
