(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    root.ProhibitedProperties=api;
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',api.mount,{once:true});
    else api.mount();
  }
})(globalThis,function(root){
  'use strict';
  const API='/api/prohibited';
  const PAGE_SIZE=25;
  const STATUS={ready:'Parsed',not_published:'Not published',not_provided:'Not provided',error:'Could not load'};

  function selectionQuery(location,propertyType,category){
    return new URLSearchParams({
      dist_code:location.district_code,
      mand_code:location.mandal_code,
      vill_code:location.village_code,
      sro_code:location.sro_code||'',
      prohib_type:propertyType,
      category
    });
  }
  function filterRows(rows,query){
    const needle=String(query||'').trim().toLocaleLowerCase();
    return needle?rows.filter(row=>row.some(cell=>String(cell).toLocaleLowerCase().includes(needle))):rows;
  }
  function pageRows(rows,page,size=PAGE_SIZE){
    const pageCount=Math.max(1,Math.ceil(rows.length/size));
    const current=Math.min(Math.max(0,page),pageCount-1);
    return {rows:rows.slice(current*size,(current+1)*size),page:current,pageCount,total:rows.length};
  }
  function cacheLabel(report){
    if(report.refresh_error)return 'Saved copy; refresh failed';
    if(report.status==='error')return 'Could not load';
    return `${report.cached?'Saved':'Fetched'} - ${STATUS[report.status]||'Unknown state'}`;
  }

  function mount(){
    const document=root.document;
    const host=document.getElementById('prohibitedWorkspace');
    const tab=document.querySelector('[data-page="prohibited"]');
    if(!host||!tab||host.dataset.mounted)return;
    host.dataset.mounted='true';
    host.innerHTML=`
      <!--
      THESIS: A source-first property lookup, not a clearance verdict.
      OWN-WORLD: Inherit HomePlanner's light/dark tokens, native controls and compact workbench.
      STORY: Select a location, read saved records, deliberately request fresh evidence.
      FIRST VIEWPORT: Location form at left; report state, provenance and readable records at right.
      FORM: A portal-style cascading form joined to a document workbench; user-pinned familiar flow.
      -->
      <section class="prop-workspace" aria-labelledby="propHeading">
        <div class="prop-heading">
          <div><h2 id="propHeading">Prohibited properties</h2>
            <p>Look up Telangana registration restrictions. Read saved village records or fetch and parse a fresh report.</p></div>
          <a href="https://registration.telangana.gov.in/prohibitionPublicList.htm" target="_blank" rel="noopener noreferrer">Official Telangana portal</a>
        </div>
        <div class="prop-layout">
          <form id="propForm" class="prop-controls">
            <fieldset><legend>Location</legend>
              <label for="propDistrict">District</label>
              <select id="propDistrict" name="dist_code" required disabled><option value="">Loading districts...</option></select>
              <label for="propMandal">Mandal</label>
              <select id="propMandal" name="mand_code" required disabled><option value="">Choose a district first</option></select>
              <label for="propVillage" id="propVillageLabel">Village / town</label>
              <select id="propVillage" name="vill_code" required disabled><option value="">Choose a mandal first</option></select>
              <div id="propSroRow" hidden><label for="propSro">SRO office</label>
                <select id="propSro" name="sro_code" disabled><option value="">Choose an SRO office</option></select></div>
            </fieldset>
            <fieldset><legend>Report</legend>
              <label for="propType">Property type</label>
              <select id="propType" name="prohib_type"><option value="AGRI">Agriculture</option><option value="NONAGRI">Non-Agriculture</option></select>
              <label for="propCategory">Category</label>
              <select id="propCategory" name="category"><option value="all">All categories</option></select>
            </fieldset>
            <label class="prop-force" for="propForce"><input type="checkbox" id="propForce">
              <span>Force refresh<small>Fetch from the portal and run OCR again, even if saved Markdown exists.</small></span></label>
            <button id="propSubmit" class="prop-submit" type="submit" disabled>View properties</button>
            <p class="prop-small prop-consent">First fetch and forced refresh contact the Telangana portal. PDF extraction and Tesseract OCR run on this computer; no documents are sent to an AI service.</p>
            <div class="prop-engine"><strong>Local Tesseract OCR</strong>
              <p class="prop-small" id="propEngineStatus">Only needed for PDF reports that have not been parsed.</p>
              <button class="prop-text-button" type="button" id="propCheckEngine">Check local OCR</button>
            </div>
          </form>
          <div class="prop-output" id="propOutput">
            <p id="propStatus" class="prop-status" role="status" aria-live="polite">Loading the local location catalog.</p>
            <div id="propFeedback" class="prop-notice" role="alert" hidden></div>
            <button id="propRetrySetup" class="prop-text-button" type="button" hidden>Retry connection</button>
            <div id="propProgress" class="prop-progress" hidden>
              <label for="propProgressBar" id="propProgressLabel">Preparing reports</label>
              <progress id="propProgressBar" max="1" value="0"></progress>
              <p id="propProgressText" class="prop-small" role="status" aria-live="polite"></p>
            </div>
            <div id="propEmpty" class="prop-empty">
              <h3>Start with a village</h3>
              <p>Choose a district, mandal and village to see Section 22A reports and Court cases &amp; Others.</p>
              <p>Scanned PDFs are parsed locally with Tesseract into a readable document and searchable tables. Original source reports remain available for comparison.</p>
              <p class="prop-cache-fact" id="propCatalogInfo">Saved Markdown is reused until you choose Force refresh.</p>
            </div>
            <section id="propResults" aria-label="Property reports" hidden>
              <div class="prop-result-heading"><div>
                <h3 id="propResultTitle"></h3><p id="propResultLocation"></p>
              </div><span id="propResultOrigin"></span></div>
              <div class="prop-report-list" id="propReportList" role="group" aria-label="Choose a report"></div>
              <div id="propReportError" class="prop-notice" data-tone="error" hidden></div>
              <div id="propReportBody" hidden>
                <div class="prop-report-title"><div><h4 id="propReportTitle"></h4><p id="propReportSummary"></p></div>
                  <div class="prop-downloads" id="propDownloads">
                    <a id="propPdfLink" target="_blank" rel="noopener noreferrer" hidden>Source PDF</a>
                    <a id="propMarkdownLink">Download Markdown</a>
                    <a id="propCsvLink" hidden>Download CSV</a>
                  </div>
                </div>
                <dl class="prop-source-meta">
                  <div><dt>Source fetched</dt><dd id="propFetchedAt"></dd></div>
                  <div><dt>Extraction</dt><dd id="propEngine"></dd></div>
                  <div><dt>Saved under prohibited-properties / parsed</dt><dd><code id="propCachePath"></code></dd></div>
                  <div><dt>Scope</dt><dd id="propScope"></dd></div>
                </dl>
                <div id="propReportNotice" class="prop-notice" hidden></div>
                <div class="prop-view-tools">
                  <button id="propShowTable" type="button" aria-pressed="true">Extracted tables</button>
                  <button id="propShowDocument" type="button" aria-pressed="false">Saved document</button>
                </div>
                <div id="propTablePane">
                  <div class="prop-table-tools">
                    <div><label for="propTableChoice">Table / source page</label><select id="propTableChoice"></select></div>
                    <div><label for="propTableSearch">Search this table</label><input id="propTableSearch" type="search" placeholder="Survey number, name or reference" autocomplete="off"></div>
                  </div>
                  <div class="prop-table-scroll" tabindex="0" role="region" aria-label="Extracted property rows">
                    <table><caption class="prop-small" id="propTableCaption"></caption><thead id="propTableHead"></thead><tbody id="propTableRows"></tbody></table>
                  </div>
                  <div class="prop-pagination"><span id="propRowCount" role="status"></span>
                    <div><button id="propPrevious" type="button">Previous</button><button id="propNext" type="button">Next</button></div></div>
                </div>
                <article class="prop-document" id="propDocumentPane" aria-label="Saved Markdown document" hidden></article>
              </div>
            </section>
            <p class="prop-disclaimer">HomePlanner is not the official registration portal. OCR can misread survey numbers, names and extents. Verify the original report with the registration authority before making a property decision. An unpublished report is not evidence that a property is unrestricted. Saved reports are not automatically reconciled with later portal changes.</p>
          </div>
        </div>
      </section>`;

    const $=id=>document.getElementById(id);
    const state={
      initialized:false,booting:null,locationEpoch:0,searchEpoch:0,pollTimer:null,
      busy:false,sroRequired:false,locationReady:false,reports:[],result:null,activeCategory:null,
      tableIndex:0,page:0,mode:'table',documentLoaded:false,controllers:new Set()
    };
    const controls={district:$('propDistrict'),mandal:$('propMandal'),village:$('propVillage'),sro:$('propSro')};
    const text=(id,value)=>{$(id).textContent=value;};
    function feedback(message,tone='error'){
      text('propFeedback',message);$('propFeedback').hidden=!message;$('propFeedback').dataset.tone=tone;
    }
    function resetSelect(select,placeholder){
      select.replaceChildren(new root.Option(placeholder,''));select.disabled=true;
    }
    function populate(select,options,placeholder){
      resetSelect(select,placeholder);
      options.forEach(option=>select.add(new root.Option(option.name,option.code)));
      select.disabled=!options.length;
    }
    function submitState(){
      $('propSubmit').disabled=!state.initialized||state.busy||!state.locationReady||!controls.village.value||
        (state.sroRequired&&!controls.sro.value);
      text('propSubmit',state.busy?'Loading reports...':'View properties');
    }
    function invalidateResults(){
      state.searchEpoch++;
      if(state.pollTimer)root.clearTimeout(state.pollTimer);
      state.pollTimer=null;state.busy=false;
      state.reports=[];state.result=null;state.activeCategory=null;
      $('propResults').hidden=true;$('propProgress').hidden=true;$('propEmpty').hidden=false;
      feedback('');submitState();
      if(state.initialized)text('propStatus','Select a location and choose View properties. Saved reports are read first.');
    }
    function invalidateLocation(){
      state.locationEpoch++;
      state.controllers.forEach(controller=>controller.abort());state.controllers.clear();
      state.sroRequired=false;state.locationReady=false;$('propSroRow').hidden=true;controls.sro.required=false;
      resetSelect(controls.sro,'Choose an SRO office');
      invalidateResults();
      return state.locationEpoch;
    }
    async function request(path,options={}){
      const response=await root.fetch(`${API}${path}`,options);
      let body;
      try{body=await response.json();}
      catch(error){
        throw new Error('The Flask API is unavailable. Start HomePlanner with .venv\\\\Scripts\\\\python.exe app.py and open its localhost URL.');
      }
      if(!response.ok)throw new Error(body.error?.message||body.message||`Request failed (${response.status}).`);
      return body;
    }
    async function locationRequest(path,epoch){
      const controller=new root.AbortController();
      state.controllers.add(controller);
      try{
        const data=await request(path,{signal:controller.signal});
        return epoch===state.locationEpoch?data:null;
      }finally{state.controllers.delete(controller);}
    }
    function locationParams(){
      return new URLSearchParams({
        dist_code:controls.district.value,mand_code:controls.mandal.value,vill_code:controls.village.value
      });
    }
    function reportLocationError(error,epoch){
      if(error.name!=='AbortError'&&epoch===state.locationEpoch){
        root.console.error('Location lookup failed',error);
        feedback(error.message);text('propStatus','The location list could not be loaded. Select the parent field again to retry.');
      }
      submitState();
    }
    async function boot(){
      if(state.initialized||state.booting)return state.booting;
      $('propRetrySetup').hidden=true;feedback('');
      state.booting=(async()=>{
        if(root.location.protocol==='file:'){
          throw new Error('This feature requires the local Flask server. Run .venv\\\\Scripts\\\\python.exe app.py in HomePlanner, then open http://127.0.0.1:8000/?workspace=prohibited. Existing planning tools still work offline.');
        }
        const data=await request('/options');
        populate(controls.district,data.districts,'Choose a district');
        data.categories.forEach(category=>$('propCategory').add(new root.Option(category.label,category.code)));
        state.initialized=true;
        text('propCatalogInfo',`${data.counts.districts} districts, ${data.counts.mandals} mandals and ${data.counts.villages.toLocaleString()} villages/divisions in the local lookup export.`);
        text('propStatus','Location lists are local. Nothing is fetched from the portal until you request a report.');
        submitState();
      })().catch(error=>{
        root.console.error('Prohibited-property setup failed',error);
        feedback(error.message);text('propStatus','The report API is not connected.');
        $('propRetrySetup').hidden=false;
      }).finally(()=>{state.booting=null;});
      return state.booting;
    }
    controls.district.addEventListener('change',async()=>{
      const epoch=invalidateLocation();
      resetSelect(controls.mandal,'Choose a district first');
      resetSelect(controls.village,'Choose a mandal first');
      text('propVillageLabel',controls.district.value==='16_1'?'Division':'Village / town');
      submitState();
      if(!controls.district.value)return;
      resetSelect(controls.mandal,'Loading mandals...');
      try{
        const data=await locationRequest(`/mandals?${locationParams()}`,epoch);
        if(!data)return;
        populate(controls.mandal,data.options,data.options.length?'Choose a mandal':'No mandals in the export');
        if(controls.district.value==='16_1'&&data.options.some(option=>option.code==='00')){
          controls.mandal.value='00';controls.mandal.dispatchEvent(new root.Event('change'));
        }
      }catch(error){reportLocationError(error,epoch);}
    });
    controls.mandal.addEventListener('change',async()=>{
      const epoch=invalidateLocation();resetSelect(controls.village,'Choose a mandal first');submitState();
      if(!controls.mandal.value)return;
      resetSelect(controls.village,'Loading villages...');
      try{
        const data=await locationRequest(`/villages?${locationParams()}`,epoch);
        if(!data)return;
        populate(controls.village,data.options,data.options.length?'Choose a village / division':'No villages in the export');
      }catch(error){reportLocationError(error,epoch);}
    });
    controls.village.addEventListener('change',async()=>{
      const epoch=invalidateLocation();
      if(!controls.village.value)return;
      $('propSubmit').disabled=true;
      try{
        const data=await locationRequest(`/sros?${locationParams()}`,epoch);
        if(!data)return;
        state.sroRequired=data.required;$('propSroRow').hidden=!data.required;controls.sro.required=data.required;
        if(data.required)populate(controls.sro,data.options,'Choose an SRO office');
        state.locationReady=true;
        submitState();
      }catch(error){reportLocationError(error,epoch);}
    });
    controls.sro.addEventListener('change',invalidateResults);
    $('propType').addEventListener('change',invalidateResults);
    $('propCategory').addEventListener('change',invalidateResults);
    $('propRetrySetup').addEventListener('click',boot);
    tab.addEventListener('click',boot);
    $('propCheckEngine').addEventListener('click',async()=>{
      $('propCheckEngine').disabled=true;text('propEngineStatus','Checking Tesseract and its languages...');
      try{
        const data=await request('/ocr-status');text('propEngineStatus',data.message);
      }catch(error){
        text('propEngineStatus',`${error.message} Saved Markdown can still be read.`);
      }finally{$('propCheckEngine').disabled=false;}
    });

    function activeReport(){
      return state.reports.find(report=>report.category===state.activeCategory)||null;
    }
    function setMode(mode){
      const report=activeReport();if(!report)return;
      state.mode=mode;
      $('propTablePane').hidden=mode!=='table';
      $('propDocumentPane').hidden=mode!=='document';
      $('propShowTable').setAttribute('aria-pressed',String(mode==='table'));
      $('propShowDocument').setAttribute('aria-pressed',String(mode==='document'));
      if(mode==='document'&&!state.documentLoaded){
        // The API strips scripts, event attributes, embedded objects and remote images.
        $('propDocumentPane').innerHTML=report.html;
        $('propDocumentPane').querySelectorAll('a').forEach(link=>{
          link.target='_blank';link.rel='noopener noreferrer';
        });
        state.documentLoaded=true;
      }
    }
    function renderTable(){
      const report=activeReport(),table=report?.tables[state.tableIndex];
      if(!table)return;
      const filtered=filterRows(table.rows,$('propTableSearch').value);
      const result=pageRows(filtered,state.page);state.page=result.page;
      const heading=document.createElement('tr');
      table.columns.forEach(column=>{
        const cell=document.createElement('th');cell.scope='col';cell.textContent=column;heading.append(cell);
      });
      $('propTableHead').replaceChildren(heading);
      const fragment=document.createDocumentFragment();
      result.rows.forEach(row=>{
        const tr=document.createElement('tr');
        row.forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});
        fragment.append(tr);
      });
      if(!result.rows.length){
        const row=document.createElement('tr'),cell=document.createElement('td');
        cell.colSpan=table.columns.length;cell.textContent='No rows match this search.';row.append(cell);fragment.append(row);
      }
      $('propTableRows').replaceChildren(fragment);
      const first=result.total?result.page*PAGE_SIZE+1:0,last=Math.min(result.total,(result.page+1)*PAGE_SIZE);
      text('propRowCount',`${first.toLocaleString()}-${last.toLocaleString()} of ${result.total.toLocaleString()} extracted rows`);
      text('propTableCaption',`Table ${table.number}${table.page?` - source PDF page ${table.page}`:''}`);
      $('propPrevious').disabled=result.page===0;
      $('propNext').disabled=result.page+1>=result.pageCount;
    }
    function selectReport(category){
      state.activeCategory=category;state.tableIndex=0;state.page=0;state.documentLoaded=false;
      $('propDocumentPane').replaceChildren();$('propTableSearch').value='';
      $('propReportList').querySelectorAll('button').forEach(button=>{
        button.setAttribute('aria-pressed',String(button.dataset.category===category));
      });
      const report=activeReport();if(!report)return;
      $('propReportError').hidden=report.status!=='error';
      $('propReportBody').hidden=report.status==='error';
      if(report.status==='error'){text('propReportError',report.error);return;}
      text('propReportTitle',report.label);
      text('propReportSummary',`${cacheLabel(report)}${report.page_count?` - ${report.page_count} PDF pages`:''}`);
      text('propFetchedAt',new Date(report.fetched_at).toLocaleString());
      text('propEngine',report.engine);text('propCachePath',report.cache_path);
      text('propScope',`${state.result.property_type_label}${state.result.location.sro_name?` / ${state.result.location.sro_name}`:''}`);
      const query=selectionQuery(state.result.location,state.result.prohib_type,report.category);
      $('propMarkdownLink').href=`${API}/download?${query}&format=markdown`;
      $('propCsvLink').href=`${API}/download?${query}&format=csv`;
      $('propCsvLink').hidden=!report.tables.length;
      $('propPdfLink').href=`${API}/download?${query}&format=pdf`;$('propPdfLink').hidden=!report.has_pdf;
      let notice='';
      if(report.refresh_error)notice=`Refresh failed: ${report.refresh_error} The previous saved document is shown below.`;
      else if(report.status==='not_published')notice='No available report was published for this selection when it was fetched. This does not establish that the land is unrestricted.';
      else if(report.status==='not_provided')notice='This category is not exposed as a report by the public portal.';
      else if(!report.tables.length)notice='No structured table was returned. Read the saved document and verify the source; no property rows have been invented.';
      text('propReportNotice',notice);$('propReportNotice').hidden=!notice;
      $('propReportNotice').dataset.tone=report.refresh_error?'warning':'info';
      $('propTableChoice').replaceChildren();
      report.tables.forEach((table,index)=>{
        $('propTableChoice').add(new root.Option(`Table ${table.number}${table.page?` / PDF page ${table.page}`:''} (${table.rows.length} rows)`,String(index)));
      });
      $('propShowTable').disabled=!report.tables.length;
      if(report.tables.length){renderTable();setMode('table');}else setMode('document');
    }
    function renderResults(result){
      state.result=result;state.reports=result.reports||[];
      if(!state.reports.length)return;
      $('propResults').hidden=false;$('propEmpty').hidden=true;
      text('propResultTitle',result.location.village_name);
      text('propResultLocation',`${result.location.district_name} / ${result.location.mandal_name} / ${result.property_type_label}`);
      text('propResultOrigin',result.served_from==='cache'?'Read from repository Markdown':`${state.reports.filter(report=>report.cached).length} saved / ${state.reports.filter(report=>!report.cached&&report.status!=='error').length} fetched`);
      const buttons=document.createDocumentFragment();
      state.reports.forEach(report=>{
        const button=document.createElement('button');button.type='button';button.className='prop-report-choice';
        button.dataset.category=report.category;button.dataset.status=report.status;button.setAttribute('aria-pressed','false');
        const label=document.createElement('strong');label.textContent=report.label;
        const status=document.createElement('span');status.textContent=cacheLabel(report);
        button.append(label,status);button.addEventListener('click',()=>selectReport(report.category));buttons.append(button);
      });
      $('propReportList').replaceChildren(buttons);
      const active=state.reports.find(report=>report.category===state.activeCategory)||
        state.reports.find(report=>report.status==='ready')||state.reports[0];
      selectReport(active.category);
    }
    function applyJob(result,epoch){
      if(epoch!==state.searchEpoch)return;
      const running=['queued','running'].includes(result.state);
      state.busy=running;submitState();$('propProgress').hidden=!running;
      text('propStatus',result.message||'');
      if(running){
        const progress=result.progress;
        text('propProgressLabel',result.state==='queued'?'Queued for processing':'Fetching and parsing reports');
        $('propProgressBar').max=progress.reports_total;$('propProgressBar').value=progress.reports_done;
        text('propProgressText',`${progress.reports_done} of ${progress.reports_total} reports complete${progress.pages_total?`; current PDF: ${progress.pages_done} of ${progress.pages_total} pages`:''}`);
        state.pollTimer=root.setTimeout(()=>poll(result.job_id,epoch),1500);
      }else{
        renderResults(result);
        if(result.errors?.length)feedback(`${result.errors.length} report(s) could not be fetched or parsed. Choose the report below for its error. Saved files were preserved.`,'warning');
        if(root.innerWidth<761)$('propOutput').scrollIntoView({block:'start',behavior:'auto'});
      }
    }
    async function poll(jobId,epoch){
      if(epoch!==state.searchEpoch)return;
      try{applyJob(await request(`/jobs/${encodeURIComponent(jobId)}`),epoch);}
      catch(error){
        if(epoch!==state.searchEpoch)return;
        state.busy=false;submitState();$('propProgress').hidden=true;feedback(error.message);
        text('propStatus','Progress could not be loaded. Search again to read any completed, saved reports.');
      }
    }
    $('propForm').addEventListener('submit',async event=>{
      event.preventDefault();if(!$('propForm').reportValidity())return;
      const epoch=++state.searchEpoch;
      if(state.pollTimer)root.clearTimeout(state.pollTimer);
      state.busy=true;submitState();feedback('');
      const payload={
        dist_code:controls.district.value,mand_code:controls.mandal.value,vill_code:controls.village.value,
        sro_code:controls.sro.value,prohib_type:$('propType').value,category:$('propCategory').value,
        force_refresh:$('propForce').checked
      };
      $('propForce').checked=false;text('propStatus',payload.force_refresh?'Refreshing from the portal. Existing files are kept until parsing succeeds.':'Checking for saved village Markdown...');
      try{
        const result=await request('/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        applyJob(result,epoch);
      }catch(error){
        if(epoch!==state.searchEpoch)return;
        state.busy=false;submitState();feedback(error.message);text('propStatus','The request could not be completed.');
      }
    });
    $('propTableChoice').addEventListener('change',()=>{state.tableIndex=Number($('propTableChoice').value);state.page=0;renderTable();});
    $('propTableSearch').addEventListener('input',()=>{state.page=0;renderTable();});
    $('propPrevious').addEventListener('click',()=>{state.page--;renderTable();});
    $('propNext').addEventListener('click',()=>{state.page++;renderTable();});
    $('propShowTable').addEventListener('click',()=>setMode('table'));
    $('propShowDocument').addEventListener('click',()=>setMode('document'));
    if(new URLSearchParams(root.location.search).get('workspace')==='prohibited')tab.click();
    else if(tab.classList.contains('on'))boot();
  }
  return {mount,selectionQuery,filterRows,pageRows,cacheLabel};
});
