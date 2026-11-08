import assert from 'node:assert/strict';import {createRequire}from'node:module';const require=createRequire(import.meta.url);const {FxBook,evaluate}=require('../portfolio-currency.js');
const close=(a,b)=>assert.ok(a!=null&&Math.abs(a-b)<1e-7,`${a} != ${b}`);
const dates=['2026-01-01','2026-01-02','2026-01-03'];const book=new FxBook({ILS:dates.map((date,i)=>({date,rate:[4,3.6,3.2][i],source:'reference fixture'})),JPY:dates.map((date,i)=>({date,rate:[100,100/0.9,125][i],source:'reference fixture'}))},{ILS:{from:dates[0],to:dates[2]},JPY:{from:dates[0],to:dates[2]}});const fx=book.rate.bind(book),run=(tx,q={},base='USD',date=dates[1])=>evaluate(tx,q,fx,base,date);
const dep=(currency,amount,date=dates[0])=>({type:'deposit',date,currency,amount});const trade=(type,symbol,currency,qty,price,date=dates[0],fee=0)=>({type,date,symbol,currency,qty,price,fee});
const original=[dep('JPY',10000),trade('buy','BANK-JP','JPY',100,100)];const saved=JSON.stringify(original);let r=run(original,{'BANK-JP':{price:110,currency:'JPY'}});close(r.equity,99);close(r.profit,-1);close(r.unrealized,-1);close(r.contributions['BANK-JP'].returnPct,-1);assert.equal(JSON.stringify(original),saved);assert.equal(r.estimated,true);
r=run(original,{'BANK-JP':{price:110,currency:'JPY'}},'JPY');close(r.profit,1000);close(r.equity,11000);
// Mixed currencies: USD security unchanged, yen security +10% local with -10% FX.
r=run([...original,dep('USD',100),trade('buy','US','USD',1,100)],{'BANK-JP':{price:110,currency:'JPY'},US:{price:100,currency:'USD'}});close(r.equity,199);close(r.profit,-1);close(r.contributions.US.unrealized,0);
// USD holding flat in dollars, but ILS fell10%: returns differ in each base.
let tx=[dep('USD',100),trade('buy','US','USD',1,100)];r=run(tx,{US:{price:100,currency:'USD'}},'ILS');close(r.profit,-40);close(r.unrealized,-40);close(r.contributions.US.returnPct,-10);r=run(tx,{US:{price:100,currency:'USD'}});close(r.profit,0);
// Realized gain values buy cost and sell proceeds on their own dates, not current FX.
tx=[dep('JPY',10000),trade('buy','J','JPY',100,100),trade('sell','J','JPY',100,110,dates[1])];r=run(tx,{},'USD',dates[2]);close(r.realized,-1);close(r.cashValue,88);close(r.profit,-12); // cash also loses value after sale
// Dividends/fees/taxes use date-specific FX; native cash reconciles.
tx=[dep('USD',100),{type:'dividend',date:dates[0],currency:'ILS',amount:40},{type:'tax',taxKind:'cgt',date:dates[1],currency:'ILS',amount:3.6},{type:'fee',date:dates[1],currency:'ILS',amount:3.6}];r=run(tx,{},'USD');close(r.dividend,10);close(r.taxPaid,1);close(r.cgtPaid,1);close(r.fees,1);close(r.cash.ILS,32.8);
// FIFO and explicit LIFO, partial sells, fee allocation.
tx=[dep('USD',1000),trade('buy','X','USD',2,10,dates[0],2),trade('buy','X','USD',2,20,dates[0],2),trade('sell','X','USD',1,30,dates[1],1)];r=run(tx,{X:{price:30,currency:'USD'}});close(r.realized,18);close(r.positions.X.cost,53);r=run(tx.map(t=>t.type==='sell'?{...t,lotMethod:'lifo'}:t),{X:{price:30,currency:'USD'}});close(r.realized,8);close(r.positions.X.cost,43);
// Shorts and covering, including fees, remain in base units.
tx=[dep('USD',100),trade('sell','X','USD',2,20,dates[0],2),trade('buy','X','USD',1,10,dates[1],1)];r=run(tx,{X:{price:10,currency:'USD'}});close(r.realized,8);close(r.unrealized,9);close(r.profit,17);close(r.positions.X.qty,-1);
// Corporate actions preserve original dated base cost.
tx=[...original,{type:'split',date:dates[1],symbol:'BANK-JP',ratio:2},{type:'symchange',date:dates[1],symbol:'BANK-JP',toSymbol:'NEW',ratio:.5}];r=run(tx,{NEW:{price:110,currency:'JPY'}});close(r.positions.NEW.cost,100);close(r.unrealized,-1);
// Executed FX conversion uses the recorded two legs/rate, not reference or today's FX.
r=run([dep('ILS',400),{type:'convert',date:dates[0],from:'ILS',amount:400,rate:4,fee:0}],{},'USD');close(r.cash.USD,100);close(r.cash.ILS,0);close(r.profit,0);
// No historical FX means no invented history. Current USD value can still be known.
const empty=new FxBook({},{});r=evaluate([dep('JPY',10000),trade('buy','J','JPY',100,100)],{J:{price:1,currency:'USD'}},empty.rate.bind(empty),'USD',dates[1]);assert.equal(r.netDeposits,null);assert.equal(r.unrealized,null);assert.equal(r.profit,null);close(r.equity,100);assert.ok(r.issues.some(x=>x.reason==='missing-dated-fx'));
assert.equal(book.rate('JPY','USD','2025-12-31').value,null);assert.equal(book.rate('JPY','USD','2026-02-01').value,null);assert.equal(book.rate('JPY','USD','2026-99-01').value,null);
assert.equal(book.rate('JPY','USD',dates[0],{kind:'execution',verified:false,date:dates[0],from:'JPY',to:'USD',rate:.02}).estimated,true);const exact=book.rate('JPY','USD',dates[0],{kind:'execution',verified:true,date:dates[0],from:'JPY',to:'USD',rate:.02,source:'broker fixture'});close(exact.value,.02);assert.equal(exact.estimated,false);
r=run(original,{});assert.equal(r.equity,null);assert.ok(r.issues.some(x=>x.reason==='missing-native-quote'));r=run([{type:'deposit',currency:'USD',amount:100,date:'2026-02-30'}]);assert.equal(r.equity,null);
console.log('PASS immutable originals, multiplicative FX, mixed bases, dated sale/flows/cash, fees/FIFO/LIFO/shorts/actions, execution legs, missing coverage and provenance');
// Incremental daily replay must match a full immutable replay at each valuation date.
const sess={};let accumulated=[];for(const date of dates){const input=[...original,{type:'sell',date:dates[1],symbol:'BANK-JP',currency:'JPY',qty:40,price:110}].filter(t=>t.date===date);accumulated.push(...input);const incremental=evaluate(input,{'BANK-JP':{price:110,currency:'JPY'}},fx,'USD',date,sess),full=run(accumulated,{'BANK-JP':{price:110,currency:'JPY'}},'USD',date);for(const field of ['equity','realized','unrealized','netDeposits','profit','fees'])close(incremental[field],full[field]);}
console.log('PASS incremental daily replay equals full replay');
tx=[dep('USD',1000),trade('sell','S','USD',1,10),trade('sell','S','USD',1,30),trade('buy','S','USD',1,15,dates[1])];r=run(tx,{S:{price:15,currency:'USD'}});close(r.realized,5);close(r.unrealized,5);console.log('PASS original average-short compatibility');
r=run([dep('USD',100),{type:'convert',date:dates[0],from:'USD',to:'ILS',fromAmount:100,toAmount:400,fee:2}],{},'USD');close(r.cash.USD,-2);close(r.cash.ILS,400);close(r.fees,2);console.log('PASS explicit conversion legs charge separate source fee');
