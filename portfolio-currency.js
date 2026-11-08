/* Dated portfolio accounting. Original transactions are read-only inputs. */
(function(root){'use strict';
const EPS=1e-9,number=v=>v==null||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const validDate=d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return false;const t=Date.parse(d+'T12:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d};
const days=(a,b)=>(Date.parse(b)-Date.parse(a))/864e5;
const add=(a,b)=>a==null||b==null?null:a+b;
class FxBook{
 constructor(series={},coverage={}){this.series={};this.coverage=coverage;for(const [cur,rows]of Object.entries(series))this.series[cur]=rows.filter(x=>validDate(x.date)&&number(x.rate)>0).map(x=>({...x,rate:Number(x.rate)})).sort((a,b)=>a.date.localeCompare(b.date));}
 observation(cur,date){if(cur==='USD')return{rate:1,date,source:'identity',kind:'identity'};const rows=this.series[cur],c=this.coverage[cur];if(!validDate(date)||!rows?.length||!c||date<c.from||date>c.to)return null;let lo=0,hi=rows.length-1,result=null;while(lo<=hi){const m=(lo+hi)>>1;if(rows[m].date<=date){result=rows[m];lo=m+1}else hi=m-1}return result&&days(result.date,date)<=7?result:null;}
 rate(from,to,date,evidence){if(!from||!to||!validDate(date))return{value:null,reason:'missing-currency-or-date'};if(from===to)return{value:1,estimated:false,source:'identity',date};
  if(evidence?.verified===true&&evidence.kind==='execution'&&evidence.date===date&&number(evidence.rate)>0){if(evidence.from===from&&evidence.to===to)return{value:Number(evidence.rate),estimated:false,date,source:evidence.source||'recorded execution'};if(evidence.to===from&&evidence.from===to)return{value:1/Number(evidence.rate),estimated:false,date,source:evidence.source||'recorded execution'};}
  const a=this.observation(from,date),b=this.observation(to,date);if(!a||!b)return{value:null,reason:'missing-dated-fx',from,to,date};return{value:b.rate/a.rate,estimated:true,date,rateDates:[a.date,b.date],source:[...new Set([a.source,b.source].filter(x=>x&&x!=='identity'))].join(' / ')};
 }
}
function evaluate(transactions,quotes,fx,base,asOf,session){
 const state=session||( {} );
 const cash=state.cash||(state.cash={}),positions=state.positions||(state.positions={}),metrics=state.metrics||(state.metrics={netDeposits:0,realized:0,unrealized:0,fees:0,dividend:0,interest:0,bonus:0,taxPaid:0,cgtPaid:0}),issues=state.issues||(state.issues=[]),references=state.references||(state.references=[]);
 metrics.unrealized=0;
 const mark=(metric,detail)=>issues.push({metric,...detail});
 const cv=(value,cur,date,metric,evidence)=>{if(value===0)return 0;const r=fx(cur,base,date,evidence,metric);if(r.value==null||!Number.isFinite(r.value)){mark(metric,{reason:r.reason||'missing-dated-fx',currency:cur,date});return null}if(r.estimated)references.push({metric,currency:cur,date,source:r.source,rateDates:r.rateDates});return value*r.value;};
 const money=(metric,value,cur,date,evidence)=>{metrics[metric]=add(metrics[metric],cv(value,cur,date,metric,evidence));};
 const cashAdd=(cur,value)=>{if(!cur){mark('equity',{reason:'missing-currency'});cash['?']=null;return}cash[cur]=add(Object.hasOwn(cash,cur)?cash[cur]:0,value);};
 const pos=sym=>positions[sym]||(positions[sym]={symbol:sym,lots:[],realized:0,fees:0});
 const take=(p,qty,sign,lifo=false)=>{const result=[];let need=qty;const list=lifo?[...p.lots].reverse():[...p.lots];for(const l of list){if(need<EPS)break;if(Math.sign(l.qty)!==sign)continue;const q=Math.min(need,Math.abs(l.qty));result.push({...l,qty:q*sign});l.qty-=q*sign;need-=q}p.lots=p.lots.filter(l=>Math.abs(l.qty)>EPS);return{lots:result,remaining:Math.max(0,need)};};
 const list=transactions.map((tx,i)=>({tx,i})).sort((a,b)=>String(a.tx.date).localeCompare(String(b.tx.date))||(number(a.tx.ts)||0)-(number(b.tx.ts)||0)||a.i-b.i);
 for(const {tx:t}of list){if(t.voided&&(t.type==='split'||t.type==='sharebonus')||t.type==='split'&&t.dupSkip)continue;
  const date=t.date,cur=t.currency,amount=number(t.amount),fee=number(t.fee)||0,evidence=t.fxEvidence;
  if(!validDate(date)){mark('all',{reason:'invalid-transaction-date',id:t.id});continue}if(date>asOf)continue;
  if(t.type==='taxacct'||t.type==='shareadj')continue;
  if(t.type==='deposit'||t.type==='withdraw'){if(amount==null){mark('all',{reason:'missing-amount',id:t.id});continue}const value=(t.type==='deposit'?1:-1)*amount;cashAdd(cur,value);money('netDeposits',value,cur,date,evidence);continue;}
  const flow={dividend:1,interest:1,bonus:1,tax:-1,taxrefund:1,fee:-1}[t.type];
  if(flow){if(amount==null){mark('all',{reason:'missing-amount',id:t.id});continue}const value=flow*amount;cashAdd(cur,value);if(t.type==='fee')money('fees',amount,cur,date,evidence);else if(t.type==='tax'||t.type==='taxrefund'){money('taxPaid',-value,cur,date,evidence);if(t.taxKind==='cgt')money('cgtPaid',-value,cur,date,evidence)}else money(t.type,value,cur,date,evidence);continue;}
  if(t.type==='convert'){const from=t.from||t.fromCurrency,to=t.to||t.toCurrency||(from==='ILS'?'USD':from==='USD'?'ILS':null),rate=number(t.rate),gross=number(t.fromAmount)??amount;let received=number(t.toAmount);if(received==null&&rate>0&&gross!=null&&['USD','ILS'].includes(from)&&['USD','ILS'].includes(to))received=from==='ILS'?(gross-fee)/rate:(gross-fee)*rate;
   cashAdd(from,gross==null?null:-(gross+(number(t.toAmount)!=null?fee:0)));cashAdd(to,received);money('fees',fee,from,date,evidence);if(received==null)mark('equity',{reason:'missing-executed-conversion-amount',id:t.id});continue;}
  if(!t.symbol){mark('all',{reason:'missing-symbol',id:t.id});continue}const p=pos(t.symbol);
  if(t.type==='split'||t.type==='sharebonus'){let ratio=t.ratio==null?1:number(t.ratio);if(t.type==='sharebonus'){const q=p.lots.reduce((v,l)=>v+l.qty,0),extra=number(t.qty)||0;if(q>EPS)ratio=Math.max(0,(q+extra)/q);else if(extra>0){p.lots.push({qty:extra,unit:0,date,currency:cur});continue}else continue}if(!(ratio>=0)){mark('all',{reason:'invalid-split',id:t.id});continue}if(ratio===0){if(t.type!=='sharebonus')mark('all',{reason:'unresolved-corporate-action',id:t.id});p.lots=[];continue}p.lots.forEach(l=>{l.qty*=ratio;if(l.unit!=null)l.unit/=ratio});continue;}
  if(t.type==='symchange'){const ratio=t.ratio==null?1:number(t.ratio),q=number(t.qty)||p.lots.reduce((v,l)=>v+Math.max(0,l.qty),0);if(!(ratio>0)||!t.toSymbol){mark('all',{reason:'invalid-symbol-change',id:t.id});continue}const taken=take(p,q,1);const dest=pos(t.toSymbol);taken.lots.forEach(l=>dest.lots.push({...l,qty:l.qty*ratio,unit:l.unit==null?null:l.unit/ratio}));continue;}
  if(t.type==='fraczero'){const q=number(t.qty)||p.lots.reduce((v,l)=>v+Math.max(0,l.qty),0),taken=take(p,q,1);for(const l of taken.lots){const value=l.unit==null?null:-l.qty*l.unit;p.realized=add(p.realized,value);metrics.realized=add(metrics.realized,value)}continue;}
  if(t.type!=='buy'&&t.type!=='sell'){mark('all',{reason:'unsupported-transaction',type:t.type,id:t.id});continue}
  const qty=number(t.qty),price=number(t.price);if(!(qty>0)||!(price>=0)){mark('all',{reason:'invalid-trade',id:t.id});continue}const sign=t.type==='buy'?1:-1;
  cashAdd(cur,-sign*qty*price-fee);money('fees',fee,cur,date,evidence);p.fees=add(p.fees,cv(fee,cur,date,'fees',evidence));const unit=cv(price+sign*fee/qty,cur,date,'cost',evidence),taken=take(p,qty,-sign,t.lotMethod==='lifo');
  for(const l of taken.lots){const value=l.unit==null||unit==null?null:Math.abs(l.qty)*(sign===1?l.unit-unit:unit-l.unit);p.realized=add(p.realized,value);metrics.realized=add(metrics.realized,value)}
  if(taken.remaining>EPS){p.lots.push({qty:sign*taken.remaining,unit,date,currency:cur,transactionId:t.id});if(sign<0){const shorts=p.lots.filter(l=>l.qty<0),total=shorts.reduce((v,l)=>v-l.qty,0),cost=shorts.reduce((v,l)=>add(v,l.unit==null?null:-l.qty*l.unit),0);p.lots=p.lots.filter(l=>l.qty>=0);p.lots.push({qty:-total,unit:cost==null?null:cost/total,date,currency:cur,transactionId:t.id})}}
 }
 const issueCheckpoint=issues.length,referenceCheckpoint=references.length;
 let cashValue=0,marketValue=0;const contributions={};
 for(const [cur,value]of Object.entries(cash))cashValue=add(cashValue,value==null?null:cv(value,cur,asOf,'equity'));
 for(const p of Object.values(positions)){p.qty=p.lots.reduce((v,l)=>v+l.qty,0);if(Math.abs(p.qty)<EPS){p.marketValue=0;p.unrealized=0;continue}const q=typeof quotes==='function'?quotes(p.symbol):quotes[p.symbol];let unit=null;
  if(q&&number(q.price)!=null&&q.currency)unit=cv(Number(q.price),q.currency,asOf,'equity');else mark('equity',{reason:'missing-native-quote',symbol:p.symbol});
  p.marketValue=unit==null?null:p.qty*unit;p.cost=p.lots.reduce((v,l)=>add(v,l.unit==null?null:l.qty*l.unit),0);p.unrealized=unit==null||p.cost==null?null:p.marketValue-p.cost;p.returnPct=Math.abs(p.cost)>EPS&&p.unrealized!=null?p.unrealized/Math.abs(p.cost)*100:null;
  marketValue=add(marketValue,p.marketValue);metrics.unrealized=add(metrics.unrealized,p.unrealized);contributions[p.symbol]={marketValue:p.marketValue,cost:p.cost,realized:p.realized,unrealized:p.unrealized,returnPct:p.returnPct};
 }
 const invalid=issues.some(i=>i.metric==='all');const equity=invalid?null:add(cashValue,marketValue),profit=equity==null||metrics.netDeposits==null?null:equity-metrics.netDeposits;
 if(invalid)for(const k of Object.keys(metrics))metrics[k]=null;
 const result={base,date:asOf,cash,positions,contributions,...metrics,cashValue:invalid?null:cashValue,marketValue:invalid?null:marketValue,equity,profit,issues:issues.slice(),references:references.slice(),estimated:references.length>0};
 issues.length=issueCheckpoint;references.length=referenceCheckpoint;return result;
}
const api={FxBook,evaluate};root.PortfolioCurrency=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
