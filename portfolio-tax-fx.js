/* Statutory BOI USD/ILS references only. Never falls back to market/ECB rates. */
(function(root){'use strict';
const KEY='portfolioTracker.taxBoi.v1',shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
class TaxFx{
 constructor({storage,fetchJSON,now=()=>new Date().toISOString().slice(0,10)}={}){this.storage=storage;this.fetchJSON=fetchJSON;this.now=now;this.inflight=null;this.lastAttempt=0;this.version=0;this.cache=null;try{const c=JSON.parse(storage?.getItem(KEY));if(c?.provider==='boi'&&Array.isArray(c.rows))this.cache=c}catch(_){}}
 async ensure(from,to=this.now()){
  if(!from||from>to)return false;if(this.inflight)return this.inflight;
  const c=this.cache;if(c?.from<=from&&c.to>=to&&Date.now()-c.fetched<300000)return true;
  if(Date.now()-this.lastAttempt<15000)return false;this.lastAttempt=Date.now();
  this.inflight=(async()=>{try{const rows=[];for(let start=shift(from,-7);start<=to;){const end=to<start.slice(0,4)+'-12-31'?to:start.slice(0,4)+'-12-31',url='https://api.frankfurter.dev/v2/providers/boi/rates?base=USD&quotes=ILS&from='+start+'&to='+end;
   const data=await this.fetchJSON(url,15000);if(!Array.isArray(data)||!data.length)throw Error('BOI references unavailable');const part=data.filter(r=>r.base==='USD'&&r.quote==='ILS'&&r.date>=start&&r.date<=end&&Number(r.rate)>0).map(r=>({date:r.date,rate:Number(r.rate)}));if(!part.length)throw Error('No BOI observations');rows.push(...part);start=shift(end,1)}
   this.cache={provider:'boi',from,to,rows:[...new Map(rows.map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date)),fetched:Date.now()};this.version++;try{this.storage?.setItem(KEY,JSON.stringify(this.cache))}catch(_){}return true;
  }catch(_){return false}finally{this.inflight=null}})();return this.inflight;
 }
}
root.PortfolioTaxFx={TaxFx};if(typeof module!=='undefined'&&module.exports)module.exports={TaxFx};
})(typeof window!=='undefined'?window:globalThis);
