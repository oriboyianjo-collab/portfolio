/* App language display preferences. */
(()=>{'use strict';
const KEY='portfolioTracker.language.v1';
let language='he';try{language=localStorage.getItem(KEY)==='en'?'en':'he'}catch(_){}
const ids=Object.create(null),bindings=[];
const dictionaries={en:Object.create(null)},missing=new Set(),staticNodes=[],staticAttrs=[];
function register(values){for(const [k,v]of Object.entries(values)){if(typeof v!=='string')throw new TypeError('Translation must be text');if(dictionaries.en[k]!==undefined&&dictionaries.en[k]!==v)throw new Error('Conflicting translation: '+k);dictionaries.en[k]=v}}
function t(source){source=String(source);if(language!=='en')return source;const value=dictionaries.en[source];if(value!==undefined)return value;const key=source.trim(),trimmed=dictionaries.en[key];if(trimmed!==undefined)return source.replace(key,trimmed);if(/[\u0590-\u05ff]/.test(source))missing.add(source);return source}
function registerIds(values){Object.assign(ids,values)}
function p(id,source){if(language==='he')return source;if(ids[id]!==undefined)return ids[id];missing.add(id);return source}
function bind(fn){bindings.push(fn)}
function applyDirection(){document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl'}
function captureStatic(root=document.body){
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
 while(node=walker.nextNode()){
  if(node.parentElement.closest('script,style'))continue;
  if(/[\u0590-\u05ff]/.test(node.nodeValue))staticNodes.push({node,source:node.nodeValue});
 }
 for(const node of root.querySelectorAll('[placeholder],[title],[aria-label],[alt]'))for(const key of ['placeholder','title','aria-label','alt']){
  const source=node.getAttribute(key);if(source&&/[\u0590-\u05ff]/.test(source))staticAttrs.push({node,key,source});
 }
 applyStatic();
}
function applyStatic(){for(const {node,source}of staticNodes)if(node.isConnected)node.nodeValue=t(source);for(const {node,key,source}of staticAttrs)if(node.isConnected)node.setAttribute(key,t(source))}
function select(value){if(!['he','en'].includes(value))throw new Error('Unsupported language');if(value===language)return false;language=value;try{localStorage.setItem(KEY,language)}catch(_){}for(const fn of bindings)fn();applyDirection();applyStatic();return true}
applyDirection();
window.I18n=Object.freeze({t,p,bind,registerIds,register,captureStatic,applyStatic,select,get language(){return language},get locale(){return language==='en'?'en-US':'he-IL'},get missing(){return [...missing]},clearMissing(){missing.clear()}});
})();
