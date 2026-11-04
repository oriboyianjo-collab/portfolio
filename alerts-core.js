// Savage Tracker alerts – shared detection rules (v187). Used by index.html, sw.js (importScripts) and copied into the Cloudflare Worker.
// Input is only the public news.json / reports.json plus the user's own ticker lists; nothing here is stored on the site.
(function(g){
  const TK = /^[A-Z][A-Z0-9.\-]{0,9}$/;
  const H = s => { let h = 5381; for(let i=0;i<s.length;i++) h = ((h*33) ^ s.charCodeAt(i))>>>0; return h.toString(36); };
  const ilDate = off => new Date(Date.now() + (off||0)*864e5).toLocaleDateString('en-CA', {timeZone:'Asia/Jerusalem'});
  const ilHour = () => (+new Date().toLocaleString('en-US', {timeZone:'Asia/Jerusalem', hour:'numeric', hour12:false})) % 24;
  function newsSyms(x){ const s = new Set();
    String(x['חברה']||'').split(/[,\s/]+/).forEach(t=>{ t=t.trim().toUpperCase(); if(TK.test(t)) s.add(t); });
    (String(x['כותרת']||'').match(/\(([A-Z][A-Z0-9.\-]{0,9})\)/g)||[]).forEach(m=>s.add(m.slice(1,-1)));
    return [...s]; }
  const has = v => v!=null && String(v).trim()!=='' && !/^(לא|n\/?a|-|—)$/i.test(String(v).trim());
  const when = m => m==='before' ? 'לפני פתיחת המסחר' : m==='after' ? 'אחרי סגירת המסחר' : '';
  // -> [{key, kind:'news'|'rep', sym, title, body, base}]  (base=true: “already happened” type, swallowed on the very first run)
  function detect(o){
    const P = o.prefs||{}, hold = new Set(o.hold||[]), watch = new Set(o.watch||[]), muted = new Set(o.muted||[]), out = [];
    const want = sym => !muted.has(sym) && (hold.has(sym) || watch.has(sym));
    (Array.isArray(o.news)?o.news:[]).slice(0, 80).forEach(x=>{
      const syms = newsSyms(x).filter(s=>!muted.has(s) && ((P.newsHold && hold.has(s)) || (P.newsWatch && watch.has(s))));
      if(!syms.length) return;
      const t = String(x['כותרת']||'').trim(); if(!t) return;
      out.push({key:'n|'+H(t+'|'+(x['הועלה']||x['תאריך']||'')), kind:'news', sym:syms[0], title:'📰 חדשה על '+syms.join(', '), body:t.slice(0,180), base:true});
    });
    const today = ilDate(0), tmr = ilDate(1), old = ilDate(-3), hr = ilHour();
    (Array.isArray(o.reports)?o.reports:[]).forEach(r=>{
      const sym = String(r['סימול']||'').toUpperCase(), d = String(r['תאריך']||'').slice(0,10); if(!sym || !d || !want(sym)) return;
      const pub = has(r['בפועל_EPS']) || has(r['הכנסות_בפועל']), nm = r['חברה']||sym;
      if(!pub && P.repBefore && d===tmr) out.push({key:'rb|'+sym+'|'+d, kind:'rep', sym, title:'⏰ מחר דוח: '+sym, body:[nm, when(r['מועד']), has(r['צפי_EPS'])?'צפי EPS '+r['צפי_EPS']:''].filter(Boolean).join(' · ')});
      if(!pub && P.repMorning && d===today && hr>=7) out.push({key:'rm|'+sym+'|'+d, kind:'rep', sym, title:'📊 דוח היום: '+sym, body:[nm, when(r['מועד']), has(r['צפי_EPS'])?'צפי EPS '+r['צפי_EPS']:''].filter(Boolean).join(' · ')});
      if(pub && P.repPub && d>=old && d<=today) out.push({key:'rp|'+sym+'|'+d, kind:'rep', sym, title:'✅ דוח פורסם: '+sym, body:[nm, has(r['בפועל_EPS'])?'EPS '+r['בפועל_EPS']+(has(r['צפי_EPS'])?' מול צפי '+r['צפי_EPS']:''):''].filter(Boolean).join(' · '), base:true});
    });
    return out;
  }
  g.AlertsCore = {detect, newsSyms, ilDate, H};
})(typeof self!=='undefined' ? self : globalThis);
