(function(root,factory){
  'use strict';
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?require('./environment-ui.js'):root.EnvironmentUI,
    common?require('./building-physics.js'):root.BuildingPhysics,
    common?require('./planner-drafts.js'):root.HomePlannerDrafts);
  if(common)module.exports=api;else root.HomePlannerReducedUI=api;
})(globalThis,function(Environment,Physics,Drafts){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const json=value=>JSON.stringify(value??null);
  const definitions={
    pressure:{title:'Expert pressure network',template:Environment.buildAirflowTemplate,validate:Environment.validatePressureInput,
      solve:Physics.solveAirflow,scope:'Uncalibrated steady network; not single-sided turbulent exchange, two-way flow or CFD',
      instructions:'Review plan-estimated volumes and operating opening areas. Supply density (kg/m³), Cd, signed imposed pressure (Pa) and their sources. Weather does not supply facade pressure coefficients.',
      action:'Solve stated pressure network'},
    thermal:{title:'Thermal & energy · sensible RC',template:Environment.buildThermalTemplate,validate:Environment.validateThermalInput,
      solve:Physics.simulateThermal,scope:'Uncalibrated sensible RC experiment, NOT actual site temperature or a comfort forecast',
      instructions:'Supply capacity (J/K), initial °C, conductance (W/K), step duration (s), outdoor °C and each zone’s gains (W). Shared materials and weather are references, not automatic thermal mass, gains or HVAC.',
      action:'Simulate stated RC scenario'}
  };
  function createController(planner,name){
    const definition=definitions[name];
    if(!definition||!planner?.getScenes||!planner?.execute)throw new Error('A current shared Design project is required.');
    const store=Drafts.createStore(planner,definition.title),listeners=new Set();
    let disposed=false,saving=false;
    const scope=()=>({projectId:planner.getProject().id,floorId:planner.getProject().activeFloorId,entityId:`native-${name}`});
    const shape=()=>Environment.geometryKey(planner.getProject(),planner.getScenes());
    const saved=()=>planner.getProject().environment?.[name]??null;
    function draft(){
      const pending=store.get(scope());
      if(pending)return pending;
      const value=saved();
      return {text:value?.input?JSON.stringify(value.input,null,2):'',notes:value?.notes||'',acknowledged:false,
        geometryKey:value?.geometryKey??null,base:json(value),dirty:false};
    }
    function getState(){
      const project=planner.getProject(),value=draft(),scenario=saved(),key=shape();
      const entry=project.environment?.results?.[name];
      const weather=project.environment?.weather;
      const conflict=value.dirty&&value.base!==json(scenario);
      const current=!value.dirty&&scenario?.acknowledged&&scenario.geometryKey===key&&entry?.geometryKey===key&&
        json(entry.input)===json(scenario.input)&&entry.notes===scenario.notes;
      return copy({name,...value,projectId:project.id,floorId:project.activeFloorId,
        floorName:project.floors.find(floor=>floor.id===project.activeFloorId)?.name??project.activeFloorId,
        conflict,geometryCurrent:value.geometryKey===key,result:current?entry:null,
        status:value.dirty?'Pending draft — previous evidence is not current.':current?'Saved matching evidence — no calculation rerun.':
          entry?'Saved output is stale or unavailable. Review and evaluate explicitly.':'Not evaluated. Prepare inputs from the current floor.',
        context:{site:project.site,weather:weather?{source:weather.source??null,coverage:weather.coverage??null,
          units:weather.units??null,recordCount:weather.records?.length??null,firstInterval:weather.records?.[0]??null}:null,
          materials:project.environment?.materials??null,
          glazing:project.environment?.glazing??null}});
    }
    function announce(){if(!disposed)for(const listener of listeners)listener(getState());}
    function setDraft(patch){
      const current=draft();
      store.put(scope(),{...current,...patch,dirty:true});
      announce();
    }
    function transact(patch){
      saving=true;
      try{planner.execute({type:'set-environment',patch:{schemaVersion:1,...patch}});store.remove(scope());}
      finally{saving=false;}
      announce();
    }
    function prepare(){
      const input=definition.template(planner.getScene());
      transact({[name]:{input,notes:'',geometryKey:shape(),acknowledged:false}});
    }
    function apply(evaluate){
      const value=draft(),state=getState();
      if(state.conflict)throw new Error('Saved inputs changed. Keep your draft for review or reload saved inputs before applying.');
      let input;
      try{input=JSON.parse(value.text);}catch{throw new Error('Scenario input is not valid JSON. Prepare the current-floor template and replace required nulls.');}
      if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Save a JSON input object.');
      const notes=value.notes.trim(),geometryKey=value.geometryKey;
      const scenario={input,notes,geometryKey,acknowledged:false};
      if(!evaluate){transact({[name]:scenario});return;}
      if(!value.acknowledged)throw new Error('Review the complete physical inputs and acknowledge the experimental scope before evaluating.');
      if(geometryKey!==shape())throw new Error('Geometry changed or no template is prepared. Prepare/review the current-floor template first.');
      if(!notes)throw new Error('Document physical input sources, operation and omitted physics.');
      definition.validate(input,planner.getScene());
      const output=definition.solve(input),project=planner.getProject();
      const entry={schemaVersion:1,calculatedAt:new Date().toISOString(),projectRevision:project.revision,
        geometryKey,geometrySnapshot:{site:copy(project.site),building:copy(project.building),scenes:copy(planner.getScenes())},
        input:copy(input),output:copy(output),notes,acknowledged:true,scope:definition.scope};
      transact({[name]:{...scenario,acknowledged:true},results:{...project.environment?.results,[name]:entry}});
    }
    const unsubscribe=planner.subscribe(event=>{
      if(saving||event?.type==='selection')return;
      const value=store.get(scope());
      if(value?.acknowledged&&value.geometryKey!==shape())store.put(scope(),{...value,acknowledged:false});
      announce();
    });
    return {
      getState,setDraft,prepare,save:()=>apply(false),run:()=>apply(true),
      discard(){store.remove(scope());announce();},
      keepDraft(){setDraft({base:json(saved()),acknowledged:false});},
      subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
      exportData(){
        const state=getState(),project=planner.getProject();
        return {schema:'homeplanner.reduced-analysis',schemaVersion:1,kind:name,
          project:{id:project.id,name:project.name,revision:project.revision,activeFloorId:project.activeFloorId},
          geometryKey:shape(),scenes:copy(planner.getScenes()),site:copy(project.site),building:copy(project.building),
          environment:copy(project.environment||{}),currentResult:state.result,
          resultCurrent:!!state.result,unappliedDraft:state.dirty?{inputText:state.text,notes:state.notes}:null,
          scope:definition.scope,externalSolverExecuted:false};
      },
      dispose(){disposed=true;unsubscribe();store.dispose();listeners.clear();}
    };
  }
  function mount(host,planner,name,runtime=globalThis){
    if(!host)return null;
    const controller=createController(planner,name),definition=definitions[name];
    const id=`native-${name}`;
    host.classList.add('env-workspace','native-reduced');
    host.innerHTML=`<header><h2>${definition.title}</h2><p>${definition.instructions}</p></header>
      <div class="native-reduced-toolbar"><button type="button" data-action="prepare">Prepare current-floor template</button>
      <button type="button" data-action="export">Export analysis JSON</button><span data-floor></span></div>
      <p data-error role="alert" hidden></p><p data-status role="status"></p>
      <div data-conflict hidden role="alert">Saved inputs changed; your draft is retained.
      <button type="button" data-action="keep">Keep draft for review</button>
      <button type="button" data-action="discard">Reload saved inputs</button></div>
      <div class="native-reduced-grid"><section aria-label="Current result"><div data-result></div></section>
      <form><label for="${id}-input">Scenario JSON · null means required, not zero</label>
      <textarea id="${id}-input" data-input rows="12" spellcheck="false"></textarea>
      <label for="${id}-notes">Input sources, operation and omissions</label>
      <textarea id="${id}-notes" data-notes rows="3"></textarea>
      <label class="env-check"><input type="checkbox" data-ack> I supplied complete conditions and understand this is an uncalibrated reduced model, not CFD, measured temperature, comfort or certification.</label>
      <div class="env-actions"><button type="button" data-action="save">Save unevaluated draft</button>
      <button type="submit">${definition.action}</button><button type="button" data-action="discard">Discard draft / reload</button></div></form></div>
      <details><summary>Shared Site, weather and materials · read-only source context</summary><p>No second location entry, automatic weather-to-boundary conversion or automatic material-to-zone assignment. Change source inputs in Site / Materials.</p><pre data-context></pre></details>
      <details><summary>Method and persistence</summary><p>${definition.scope}. Local JavaScript BuildingPhysics reuse adapter; no Python or external engine is substituted. Save/Evaluate is one shared-project Undo entry. Export the Design JSON to retain committed inputs. Unapplied drafts remain session-only.</p></details>`;
    const by=selector=>host.querySelector(selector),form=by('form');
    const render=state=>{
      by('[data-floor]').textContent=state.floorName;
      by('[data-status]').textContent=state.status;
      by('[data-conflict]').hidden=!state.conflict;
      for(const [selector,value] of [['[data-input]',state.text],['[data-notes]',state.notes]]){
        const node=by(selector);if(node.value!==value)node.value=value;
      }
      by('[data-ack]').checked=state.acknowledged;
      by('[data-result]').innerHTML=state.result?Environment.reducedResultMarkup(name,state.result):
        '<p>No current numerical result. Use the prepared room template, replace required unknowns and explicitly evaluate.</p>';
      by('[data-context]').textContent=JSON.stringify(state.context,null,2);
    };
    const action=work=>{by('[data-error]').hidden=true;try{work();}catch(error){by('[data-error]').textContent=error.message;by('[data-error]').hidden=false;}};
    const input=()=>controller.setDraft({text:by('[data-input]').value,notes:by('[data-notes]').value,acknowledged:by('[data-ack]').checked});
    const click=event=>{
      const button=event.target.closest('[data-action]');if(!button)return;
      action(()=>{
        const kind=button.dataset.action;
        if(['prepare','discard'].includes(kind)&&controller.getState().dirty&&!runtime.confirm('Replace this pending scenario draft?'))return;
        if(kind==='prepare')controller.prepare();
        if(kind==='discard')controller.discard();
        if(kind==='keep')controller.keepDraft();
        if(kind==='save')controller.save();
        if(kind==='export'){
          const url=runtime.URL.createObjectURL(new runtime.Blob([JSON.stringify(controller.exportData(),null,2)],{type:'application/json'}));
          const link=host.ownerDocument.createElement('a');link.href=url;link.download=`homeplanner-${name}-analysis.json`;link.click();
          runtime.setTimeout(()=>runtime.URL.revokeObjectURL(url),1000);
        }
      });
    };
    const submit=event=>{event.preventDefault();action(()=>controller.run());};
    host.addEventListener('click',click);form.addEventListener('input',input);form.addEventListener('submit',submit);
    const unsubscribe=controller.subscribe(render);render(controller.getState());
    return {...controller,dispose(){unsubscribe();host.removeEventListener('click',click);form.removeEventListener('input',input);
      form.removeEventListener('submit',submit);controller.dispose();host.replaceChildren();}};
  }
  return Object.freeze({createController,mount});
});
