/* Original report connections only. No financial data extraction or calculations. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportConnections=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PERIODS=new Set(['FY','Q1','Q2','Q3','Q4']);
  const cikKey=v=>/^\d{1,10}$/.test(String(v))?String(v).padStart(10,'0'):null;
  const symbolKey=v=>String(v||'').trim().toUpperCase();
  function inspectDocument(d){
    const issues=[];
    if(!d||typeof d!=='object')return ['missing_document'];
    let url;try{url=new URL(d.url);if(url.protocol!=='https:')issues.push('non_https_url');}catch(_){issues.push('invalid_url');}
    if(!['original_pdf','original_html'].includes(d.format))issues.push('not_original_format');
    if(!d.content_verified)issues.push('content_unverified');
    if(!d.issuer_verified)issues.push('issuer_unverified');
    if(!d.period_verified||!PERIODS.has(d.period)||!Number.isInteger(d.fiscal_year))issues.push('period_unverified');
    if(!d.url_observed)issues.push('url_unverified');
    if(!d.verified_at)issues.push('missing_verification_time');
    if(d.blocked)issues.push('blocked');
    if(d.format==='original_html'&&!d.html_fallback_checked)issues.push('pdf_preference_not_checked');
    return [...new Set(issues)];
  }
  function createRegistry(data){
    if(!data||data.version!==1||!Array.isArray(data.issuers)||!Array.isArray(data.documents))throw Error('Unsupported registry');
    const byCIK=new Map(),bySymbol=new Map(),docs=new Map();
    for(const raw of data.issuers){
      const cik=cikKey(raw.cik);if(!cik||byCIK.has(cik))throw Error('Duplicate/invalid issuer CIK');
      const issuer={...raw,cik,symbols:[...new Set((raw.symbols||[]).map(symbolKey))]};byCIK.set(cik,issuer);
      for(const sym of issuer.symbols){if(!bySymbol.has(sym))bySymbol.set(sym,[]);bySymbol.get(sym).push(issuer);}
    }
    for(const d of data.documents){
      if(!byCIK.has(cikKey(d.cik)))throw Error('Document issuer absent from registry');
      const k=cikKey(d.cik)+'|'+d.fiscal_year+'|'+d.period;if(!docs.has(k))docs.set(k,[]);docs.get(k).push(Object.freeze({...d}));
    }
    const directDocs=new Map();
    for(const d of data.direct_period_documents||[]){
      if(!byCIK.has(cikKey(d.cik)))throw Error('Direct document issuer absent from registry');
      const k=cikKey(d.cik)+'|'+d.fiscal_year+'|'+d.period;if(!directDocs.has(k))directDocs.set(k,[]);directDocs.get(k).push(Object.freeze({...d}));
    }
    function findIssuer(input){
      const c=cikKey(input);if(c&&byCIK.has(c))return {status:'found',issuer:byCIK.get(c)};
      const matches=bySymbol.get(symbolKey(input))||[];
      if(matches.length===1)return {status:'found',issuer:matches[0]};
      return matches.length?{status:'ambiguous',issuers:matches}:{status:'not_found'};
    }
    function resolveConnection(input){
      const found=findIssuer(input);if(found.status!=='found')return found;
      if(found.issuer.eligibility==='excluded_preferred_only')return {status:'excluded',reason:'Preferred-only US listing outside user-approved scope',issuer:found.issuer};
      if(found.issuer.eligibility==='excluded_bdc')return {status:'excluded',reason:'BDC outside user-approved scope',issuer:found.issuer};
      const sources=found.issuer.connections||{};
      const validRoot=r=>r&&r.identity_verified===true&&r.reports_directory_verified===true&&r.observed_at&&/^https?:\/\//.test(r.url);
      const roots=(sources.official_report_roots||[]).filter(validRoot);const eligibleRoots=roots.filter(r=>r.equity_eligibility_verified===true&&r.directory_content_verified!==false);
      return {status:eligibleRoots.length?'root_ready':roots.some(r=>r.directory_content_verified===false)?'directory_review':roots.length?'eligibility_review':'root_pending',issuer:found.issuer,official_report_roots:eligibleRoots,review_roots:roots.filter(r=>r.equity_eligibility_verified!==true||r.directory_content_verified===false),
        sec:sources.sec?.observed_at?sources.sec:null,history_status:coverage(input).status,
        eligibility:found.issuer.eligibility||'review_required'};
    }
    function resolveReport(input,year,period,options={}){
      if(!Number.isInteger(year)||!PERIODS.has(period))return {status:'invalid_period'};
      const found=findIssuer(input);if(found.status!=='found')return found;
      if(found.issuer.eligibility==='excluded_preferred_only')return {status:'excluded',reason:'Preferred-only US listing outside user-approved scope',issuer:found.issuer};
      if(found.issuer.eligibility==='excluded_bdc')return {status:'excluded',reason:'BDC outside user-approved scope',issuer:found.issuer};
      const issuer=found.issuer,candidates=docs.get(issuer.cik+'|'+year+'|'+period)||[];
      const verified=candidates.filter(d=>inspectDocument(d).length===0&&!d.superseded);
      const usable=verified.filter(d=>!d.amendment||options.includeAmendments===true);
      const pdf=usable.filter(d=>d.format==='original_pdf');const preferred=pdf.length?pdf:usable.filter(d=>d.format==='original_html');
      if(preferred.length===1)return {status:'ready',issuer,document:preferred[0]};
      if(preferred.length>1)return {status:'review_required',issuer,reason:'multiple_verified_originals',documents:preferred};
      return {status:candidates.some(d=>d.blocked)?'blocked':'not_ready',issuer,year,period,candidates:candidates.map(d=>({document:d,issues:inspectDocument(d)}))};
    }
    // This lookup never changes reusable-root or history readiness.
    function resolveDirectReport(input,year,period){
      if(!Number.isInteger(year)||!PERIODS.has(period))return {status:'invalid_period'};
      const found=findIssuer(input);if(found.status!=='found')return found;
      if(['excluded_bdc','excluded_preferred_only'].includes(found.issuer.eligibility))return {status:'excluded',issuer:found.issuer};
      const candidates=directDocs.get(found.issuer.cik+'|'+year+'|'+period)||[];
      const verified=candidates.filter(d=>inspectDocument(d).length===0&&d.equity_eligibility_verified===true&&!d.superseded);
      if(verified.length===1)return {status:'direct_period_ready',connection_category:'verified_direct_period_document',issuer:found.issuer,document:verified[0],directory_status:verified[0].directory_status,history_status:'not_established_by_this_document'};
      if(verified.length>1)return {status:'review_required',issuer:found.issuer,reason:'multiple_verified_direct_originals',documents:verified};
      return {status:'not_ready',issuer:found.issuer,year,period};
    }
    function coverage(input,years=[2021,2022,2023,2024,2025],currentYear=2026,publishedPeriods=['Q1','Q2','Q3']){
      const found=findIssuer(input);if(found.status!=='found')return found;
      const slots=years.flatMap(y=>['FY','Q1','Q2','Q3','Q4'].map(p=>({year:y,period:p}))).concat(publishedPeriods.map(p=>({year:currentYear,period:p})));
      const results=slots.map(s=>({...s,...resolveReport(input,s.year,s.period)}));
      return {status:results.every(r=>r.status==='ready')?'ready':'partial',issuer:found.issuer,ready_periods:results.filter(r=>r.status==='ready').length,total_periods:slots.length,results};
    }
    return Object.freeze({findIssuer,resolveConnection,resolveReport,resolveDirectReport,coverage,directDocumentCount:(data.direct_period_documents||[]).length,issuerCount:byCIK.size,documentCount:data.documents.length});
  }
  // Submission metadata is discovery input, never a verified report or a fiscal-period decision.
  function discoverCandidates(submission,{calendarFloor='2020-01-01'}={}){
    const r=submission?.filings?.recent||submission;const forms=r?.form;if(!Array.isArray(forms))throw Error('Missing filing arrays');
    const out=[],seen=new Set();
    for(let i=0;i<forms.length;i++){
      const form=forms[i],base=form.replace(/\/A$/,'');
      if(!['10-K','10-Q','20-F','40-F','6-K','8-K'].includes(base))continue;
      const date=r.reportDate?.[i]||'';if(date&&date<calendarFloor)continue;
      if(base==='8-K'&&!String(r.items?.[i]||'').includes('2.02'))continue;
      const accession=r.accessionNumber?.[i],primaryDocument=r.primaryDocument?.[i];if(!accession||!primaryDocument)continue;
      const key=accession+'|'+primaryDocument;if(seen.has(key))continue;seen.add(key);
      out.push({cik:cikKey(submission.cik),form,accession,primary_document:primaryDocument,report_date_candidate:date,filing_date:r.filingDate?.[i],amendment:form.endsWith('/A'),requires_exhibit_classification:['6-K','8-K'].includes(base),fiscal_year:null,period:null,status:'candidate',url:null});
    }
    return out;
  }
  // Callers provide an approved read transport. This module neither changes network identity nor retries a denial.
  async function collectQueue(queue,read,checkpoint,{delayMs=700,signal}={}){
    const result={records:[],blocked:[],errors:[],remaining:[]};
    for(let i=0;i<queue.length;i++){
      if(signal?.aborted){result.remaining=queue.slice(i);break;}
      const item=queue[i];
      try{
        const record=await read(item);
        if([403,429].includes(record.status)){
          result.blocked.push({item,status:record.status,url:record.url});result.remaining=queue.slice(i+1);await checkpoint(result);break;
        }
        if(record.status!==200)result.errors.push({item,status:record.status,url:record.url});else result.records.push(record);
      }catch(error){result.errors.push({item,error:String(error)});}
      await checkpoint(result);
      if(i+1<queue.length&&delayMs>0)await new Promise(r=>setTimeout(r,delayMs));
    }
    return result;
  }
  // Read only original-document identity and period tags. Never financial concepts or values.
  function inspectInlineOriginal(html,source,issuer,DOMParserClass){
    const Parser=DOMParserClass||(typeof DOMParser!=='undefined'?DOMParser:null);
    if(!Parser)throw Error('HTML parser unavailable: supply DOMParser');
    const d=new Parser().parseFromString(html,'text/html'),facts={};
    for(const e of d.querySelectorAll('[name]')){
      const tag=e.getAttribute('name');
      if(/^dei:(DocumentFiscalYearFocus|DocumentFiscalPeriodFocus|DocumentPeriodEndDate|EntityRegistrantName|EntityCentralIndexKey|TradingSymbol|DocumentType|AmendmentFlag)$/.test(tag)){
        if(!facts[tag])facts[tag]=[];const value=e.textContent.trim();if(!facts[tag].includes(value))facts[tag].push(value);
      }
    }
    const values=k=>facts['dei:'+k]||[],norm=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const symbols=new Set((issuer.symbols||[]).map(norm)),names=new Set([issuer.name,...(issuer.former_names||[])].map(norm));
    const namedIdentity=values('TradingSymbol').some(s=>symbols.has(norm(s)))||values('EntityRegistrantName').some(n=>names.has(norm(n)));
    const ciks=values('EntityCentralIndexKey');const identity=namedIdentity&&(!ciks.length||ciks.every(c=>cikKey(c)===cikKey(issuer.cik)));
    const years=values('DocumentFiscalYearFocus'),periods=values('DocumentFiscalPeriodFocus'),ends=values('DocumentPeriodEndDate');
    const types=values('DocumentType');const formMatchesPeriod=types.length===1&&(types[0].replace(/\/A$/,'')==='10-Q'?['Q1','Q2','Q3'].includes(periods[0]):['10-K','20-F','40-F'].includes(types[0].replace(/\/A$/,''))&&periods[0]==='FY');
    const validPeriod=formMatchesPeriod&&years.length===1&&/^\d{4}$/.test(years[0])&&periods.length===1&&PERIODS.has(periods[0])&&ends.length>0;
    const allowedType=values('DocumentType').some(t=>['10-K','10-K/A','10-Q','10-Q/A','20-F','20-F/A','40-F','40-F/A'].includes(t));
    return {cik:cikKey(issuer.cik),url:source.url,format:'original_html',url_observed:source.url_observed===true,
      fiscal_year:validPeriod?Number(years[0]):null,period:validPeriod?periods[0]:null,
      issuer_verified:identity,period_verified:validPeriod,content_verified:identity&&validPeriod&&allowedType,
      verified_at:source.verified_at||null,html_fallback_checked:false,amendment:values('AmendmentFlag').some(v=>v.toLowerCase()==='true'),evidence:facts};
  }
  return Object.freeze({createRegistry,inspectDocument,inspectInlineOriginal,discoverCandidates,collectQueue});
});
