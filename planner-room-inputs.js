(function(root,factory){
  'use strict';
  const commonJS=typeof module==='object'&&module.exports;
  const api=factory(root,commonJS?require('./planner-drafts.js'):null);
  if(commonJS){module.exports=api;return;}
  root.HomePlannerRoomInputs=api;
  if(root.document){
    const start=()=>{
      if(root.HomePlanner&&root.document.getElementById('roomProgrammeDrafts'))
        api.connect(root.HomePlanner,root.document);
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(root,sharedDrafts){
  'use strict';
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const documents=new WeakMap(),bindings=new WeakMap();
  const COUNT_TYPES=Object.freeze({livingCount:'living',bedCount:'bedroom',kitchenCount:'kitchen',
    bathCount:'bathroom',poojaCount:'pooja',liftCount:'lift',stairCount:'staircase',balconyCount:'balcony'});
  const RANGE_PAIRS=Object.freeze([
    ['bedMinW','bedMaxW'],['bedMinD','bedMaxD'],['kitMinW','kitMaxW'],['kitMinD','kitMaxD'],
    ['poojaMinW','poojaMaxW'],['poojaMinD','poojaMaxD'],['windowHeadHeight','ceilingHeight']
  ].map(pair=>Object.freeze(pair)));

  function failure(code,message,issues={}){
    const error=new Error(message);error.code=code;error.issues=issues;return error;
  }
  function numeric(value,label='Room setting'){
    if((typeof value!=='string'&&typeof value!=='number')||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value).trim()))
      throw failure('RoomControlValueError',`${label}: enter a complete number without units.`);
    const number=Number(value);
    if(!Number.isFinite(number))throw failure('RoomControlValueError',`${label}: enter a finite number.`);
    return number;
  }
  function stepAligned(value,base,step){
    const parts=[value,base,step].map(number=>{
      const [mantissa,exponent='0']=String(number).toLowerCase().split('e');
      const fraction=mantissa.split('.')[1]||'';
      return {digits:BigInt(mantissa.replace('.','')),power:Number(exponent)-fraction.length};
    });
    const power=Math.min(...parts.map(part=>part.power));
    const integers=parts.map(part=>part.digits*10n**BigInt(part.power-power));
    return (integers[0]-integers[1])%integers[2]===0n;
  }
  function validateSpecification(spec){
    if(!spec||typeof spec.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(spec.id)||
      ['constructor','prototype'].includes(spec.id))
      throw failure('RoomControlSpecificationError','A room input needs a supported stable field ID.');
    for(const key of ['min','max'])
      if(spec[key]!==null&&!Number.isFinite(spec[key]))throw failure('RoomControlSpecificationError',`${spec.id}: invalid ${key} limit.`);
    if(spec.min!==null&&spec.max!==null&&spec.min>spec.max)
      throw failure('RoomControlSpecificationError',`${spec.id}: minimum exceeds maximum.`);
    if(spec.step!=='any'&&(!Number.isFinite(spec.step)||spec.step<=0))
      throw failure('RoomControlSpecificationError',`${spec.id}: invalid numeric step.`);
    if(!Number.isFinite(spec.stepBase)||typeof spec.integer!=='boolean')
      throw failure('RoomControlSpecificationError',`${spec.id}: invalid input constraints.`);
    return spec;
  }
  function parse(value,spec){
    validateSpecification(spec);
    const label=spec.label||spec.id,number=numeric(value,label);
    if(spec.integer&&!Number.isSafeInteger(number))
      throw failure('RoomControlValueError',`${label}: quantity must be a whole number.`);
    if(spec.min!==null&&number<spec.min)throw failure('RoomControlValueError',`${label}: minimum is ${spec.min}.`);
    if(spec.max!==null&&number>spec.max)throw failure('RoomControlValueError',`${label}: maximum is ${spec.max}.`);
    if(spec.step!=='any'&&!stepAligned(number,spec.stepBase,spec.step))
      throw failure('RoomControlValueError',`${label}: use increments of ${spec.step} from ${spec.stepBase}.`);
    return number;
  }
  function validatePatch(patch,specifications,controls,{typed=true}={}){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))
      throw failure('RoomControlsValidationError','Provide a room-control value map.');
    const specs=new Map();
    for(const spec of specifications){
      validateSpecification(spec);
      if(specs.has(spec.id))throw failure('RoomControlSpecificationError',`Duplicate room setting ${spec.id}.`);
      specs.set(spec.id,spec);
    }
    const values={},issues={};
    for(const [id,value] of Object.entries(patch)){
      const spec=specs.get(id);
      if(!spec){issues[id]=`Unknown room setting ${id}.`;continue;}
      try{
        if(typed&&typeof value!=='number')throw failure('RoomControlValueError',`${spec.label||id}: the command requires a number.`);
        values[id]=parse(value,spec);
      }catch(error){issues[id]=error.message;}
    }
    for(const [minimum,maximum] of RANGE_PAIRS){
      if((!own(patch,minimum)&&!own(patch,maximum))||!specs.has(minimum)||!specs.has(maximum))continue;
      if(issues[minimum]||issues[maximum])continue;
      try{
        const low=own(values,minimum)?values[minimum]:numeric(controls[minimum]?.value,specs.get(minimum).label||minimum);
        const high=own(values,maximum)?values[maximum]:numeric(controls[maximum]?.value,specs.get(maximum).label||maximum);
        if(low>high){
          const message=`${specs.get(minimum).label||minimum} must not exceed ${specs.get(maximum).label||maximum}.`;
          issues[minimum]=message;issues[maximum]=message;
        }
      }catch(error){issues[minimum]=error.message;issues[maximum]=error.message;}
    }
    if(Object.keys(issues).length)
      throw failure('RoomControlsValidationError','Room settings were not applied. Correct the supplied values and ranges.',issues);
    return values;
  }

  function documentState(document){
    if(!documents.has(document))documents.set(document,{inputs:new Map(),controller:null,handle:null});
    return documents.get(document);
  }
  function resolve(input,document=root.document){
    const result=typeof input==='string'?document?.getElementById(input):input;
    if(!result?.id||!result.ownerDocument)throw failure('RoomControlUnavailableError','The requested room input is unavailable.');
    return result;
  }
  function specification(input){
    const attribute=name=>input.getAttribute(name);
    const limit=name=>attribute(name)===null||attribute(name)===''?null:numeric(attribute(name),`${input.id} ${name}`);
    const min=limit('min'),max=limit('max'),step=attribute('step');
    const original=attribute('value');
    const label=input.getAttribute('aria-label')||input.dataset.roomSettingLabel||
      `${input.labels?.[0]?.textContent?.trim()||'Room setting'} (${input.id})`;
    return validateSpecification({id:input.id,label,min,max,step:step==='any'?'any':step?numeric(step):1,
      stepBase:min??(original!==null&&original!==''?numeric(original):0),
      integer:own(COUNT_TYPES,input.id)||input.dataset.roomQuantity==='true'});
  }
  function display(binding){
    const state=documentState(binding.input.ownerDocument);
    const pending=state.controller?.draftFor(binding.input.id);
    const value=pending?pending.raw:binding.startupRaw!==null?binding.startupRaw:binding.committed;
    if(binding.input.value!==value)binding.input.value=value;
  }
  function register(input){
    input=resolve(input);
    if(bindings.has(input))return bindings.get(input);
    const spec=specification(input),committed=String(input.value);
    numeric(committed,spec.label);
    if(spec.integer)parse(committed,spec);
    const state=documentState(input.ownerDocument);
    if(state.inputs.has(input.id)&&state.inputs.get(input.id).input!==input)
      throw failure('RoomControlSpecificationError',`A different room input already owns ${input.id}.`);
    input.dataset.roomSetting='';
    input.type='text';input.inputMode=spec.integer?'numeric':'decimal';
    // Only this committed projection is captured; input.value may be an incomplete draft.
    const binding={input,committed,startupRaw:null,bound:false};
    bindings.set(input,binding);state.inputs.set(input.id,binding);
    return binding;
  }
  function isSetting(input){
    return !!input&&(bindings.has(input)||input.hasAttribute?.('data-room-setting'));
  }
  function readCommitted(input,document=root.document){
    return register(resolve(input,document)).committed;
  }
  function readNumber(input,document=root.document){
    input=resolve(input,document);
    const number=numeric(readCommitted(input),input.id);
    if(own(COUNT_TYPES,input.id)&&!Number.isSafeInteger(number))
      throw failure('RoomControlValueError',`${input.id}: the committed quantity is not a whole number.`);
    return number;
  }
  function readCount(input,maximum,document=root.document){
    input=resolve(input,document);
    const value=parse(readCommitted(input),specification(input));
    if(!Number.isSafeInteger(value)||value<0||
      maximum!==undefined&&(!Number.isSafeInteger(maximum)||value>maximum))
      throw failure('RoomControlValueError',`${input.id}: the committed quantity is outside its supported range.`);
    return value;
  }
  function writeCommitted(input,value,document=root.document){
    input=resolve(input,document);
    const binding=register(input),number=numeric(value,input.id);
    if(specification(input).integer)parse(value,specification(input));
    binding.committed=String(value);
    display(binding);
    return number;
  }
  function specifications(document=root.document){
    return [...documentState(document).inputs.values()].map(binding=>specification(binding.input));
  }
  function bind(input){
    const binding=register(input);
    if(binding.bound)return binding;
    binding.bound=true;
    const state=documentState(binding.input.ownerDocument);
    const stage=()=>{
      if(state.controller)state.controller.stage(binding.input.id,binding.input.value);
      else binding.startupRaw=binding.input.value===binding.committed?null:binding.input.value;
    };
    binding.input.addEventListener('input',stage);
    binding.input.addEventListener('change',stage);
    binding.input.addEventListener('keydown',event=>{
      if(event.isComposing||event.defaultPrevented)return;
      if(event.key==='Enter'){
        event.preventDefault();event.stopPropagation();
        if(state.controller)state.controller.apply();
        else{
          const host=binding.input.ownerDocument.getElementById('roomProgrammeDrafts');
          if(host)host.textContent='The project is still loading. Room drafts are retained; apply them when the controls are ready.';
        }
      }else if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();
        if(state.controller)state.controller.discard(binding.input.id);
        else{binding.startupRaw=null;display(binding);}
      }
    });
    return binding;
  }

  function createController(planner,options={}){
    const Drafts=options.drafts||sharedDrafts||root.HomePlannerDrafts;
    if(!Drafts||typeof Drafts.createStore!=='function')
      throw failure('MissingDraftsError','Load planner-drafts.js before connecting room input drafts.');
    if(!planner||['getProject','execute','subscribe'].some(key=>typeof planner[key]!=='function'))
      throw failure('MissingPlannerError','Load the shared planner before connecting room input drafts.');
    const getSpecifications=options.getSpecifications||(()=>planner.getRoomControlSpecifications());
    const store=Drafts.createStore(planner,'Room quantities and defaults'),listeners=new Set();
    let error='',issues={},notice='',applying=false,disposed=false;
    const owner=()=>{const project=planner.getProject();return {projectId:project.id,floorId:project.activeFloorId};};
    const scope=(id,identity=owner())=>({projectId:identity.projectId,floorId:identity.floorId,collection:'room-controls',entityId:id});
    function pending(){
      const identity=owner(),project=planner.getProject(),specs=new Map(getSpecifications().map(spec=>[spec.id,spec]));
      return store.scopes().filter(item=>item.projectId===identity.projectId&&item.floorId===identity.floorId)
        .map(item=>{
          const draft=store.get(item),current=project.legacy.controls[item.entityId]?.value,spec=specs.get(item.entityId);
          return {id:item.entityId,label:spec?.label||item.entityId,...draft,current:typeof current==='string'?current:null,
            conflict:draft.base!==current,unavailable:!spec||typeof current!=='string',issue:issues[item.entityId]||''};
        });
    }
    function getState(){
      return {...owner(),pending:pending(),error,issues:{...issues},notice,applying};
    }
    function emit(){
      if(disposed)return;
      const report=()=>root.console?.error('RoomInputsObserverError: A room draft view could not update. Other observers were notified.');
      for(const listener of [...listeners]){
        try{
          const completion=listener(getState());
          if(completion&&typeof completion.then==='function')Promise.resolve(completion).catch(report);
        }catch(error){report();}
      }
    }
    const api={
      getState,
      subscribe(listener){
        if(typeof listener!=='function')throw failure('RoomInputsObserverError','A room input observer must be a function.');
        listeners.add(listener);return()=>listeners.delete(listener);
      },
      draftFor(id){return store.get(scope(id));},
      stage(id,raw){
        if(typeof raw!=='string')throw failure('RoomControlValueError','Room input drafts must retain raw text.');
        if(!getSpecifications().some(spec=>spec.id===id))throw failure('RoomControlUnavailableError',`Unknown room setting ${id}.`);
        const current=planner.getProject().legacy.controls[id]?.value,identity=scope(id),prior=store.get(identity);
        if(typeof current!=='string')throw failure('RoomControlUnavailableError',`The saved value for ${id} is unavailable.`);
        if(raw===current)store.remove(identity);
        else store.put(identity,{raw,base:prior?prior.base:current});
        delete issues[id];error='';notice='Pending room inputs are not part of the project or its saved copies.';
        emit();
      },
      discard(id){
        for(const item of pending())if(id===undefined||item.id===id)store.remove(scope(item.id));
        issues={};error='';notice=id?'This field draft was discarded.':'Current-floor room drafts were discarded; other owners were kept.';
        emit();
      },
      reviewConflicts(expected){
        const state=getState();
        if(!expected||expected.projectId!==state.projectId||expected.floorId!==state.floorId||
          state.pending.some(item=>item.current!==expected.pending.find(prior=>prior.id===item.id)?.current)){
          error='Saved room values changed again. Review the displayed values before keeping these drafts.';emit();return false;
        }
        if(state.pending.some(item=>item.unavailable)){
          error='A saved room input is unavailable. Copy or discard that draft; it cannot be reassigned automatically.';emit();return false;
        }
        for(const item of state.pending)if(item.conflict)store.put(scope(item.id),{raw:item.raw,base:item.current});
        error='';issues={};notice='Drafts retained against the reviewed saved values. Apply still validates every pending field.';
        emit();return true;
      },
      apply(){
        const state=getState(),project=planner.getProject();
        if(applying){error='Room inputs are already being applied.';emit();return false;}
        if(!state.pending.length){error='';notice='There are no pending room inputs to apply.';emit();return true;}
        if(state.pending.some(item=>item.conflict||item.unavailable)){
          error='Saved room values changed. Review the differences or discard the affected drafts before applying.';
          emit();return false;
        }
        try{
          const raw=Object.fromEntries(state.pending.map(item=>[item.id,item.raw]));
          const values=validatePatch(raw,getSpecifications(),project.legacy.controls,{typed:false});
          const expected=Object.fromEntries(state.pending.map(item=>[item.id,item.base]));
          applying=true;
          planner.execute({type:'update-room-controls',projectId:state.projectId,floorId:state.floorId,expected,patch:values});
          for(const item of state.pending){
            const identity=scope(item.id,state),current=store.get(identity);
            if(current&&current.raw===item.raw&&current.base===item.base)store.remove(identity);
          }
          error='';issues={};notice='Room inputs applied to the project. Use Save now for a browser copy.';
          return true;
        }catch(failure){
          error=failure.message||'Room inputs could not be applied. Your drafts were retained.';
          issues={...(failure.issues||{})};
          return false;
        }finally{applying=false;emit();}
      },
      dispose(){
        if(disposed)return;
        disposed=true;unsubscribe();store.dispose();listeners.clear();
      }
    };
    let unsubscribe;
    try{
      unsubscribe=planner.subscribe(event=>{
        if(event?.type==='selection')return;
        error='';issues={};notice='';emit();
      });
    }catch(error){store.dispose();throw error;}
    return api;
  }

  function mountView(controller,planner,document,host,state){
    const node=(tag,text)=>{
      const result=document.createElement(tag);
      if(text!==undefined)result.textContent=text;
      return result;
    };
    const heading=node('h3','Room quantities and defaults');
    const help=node('p','Typing stays a draft. Apply or Enter validates all pending room inputs together; leaving a field does not apply it.');
    help.className='mini';
    const status=node('p');status.id='roomProgrammeStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const alert=node('p');alert.id='roomProgrammeError';alert.setAttribute('role','alert');alert.hidden=true;
    const actions=node('div');actions.className='split-snaps';
    const apply=node('button','Apply room settings'),discard=node('button','Discard room drafts');
    const review=node('button','Keep drafts against reviewed saved values');
    for(const [button,action] of [[apply,'apply'],[discard,'discard'],[review,'review']]){
      button.type='button';button.dataset.roomProgrammeAction=action;actions.appendChild(button);
    }
    const list=node('ul');list.className='mini';
    host.classList.add('card');
    host.replaceChildren(heading,help,status,alert,actions,list);
    let latest;
    const render=snapshot=>{
      latest=snapshot;
      const project=planner.getProject();
      for(const binding of state.inputs.values()){
        const value=project.legacy.controls[binding.input.id]?.value;
        if(typeof value==='string')binding.committed=value;
        display(binding);
        const message=snapshot.issues[binding.input.id]||'';
        binding.input.setCustomValidity(message);
        if(message)binding.input.setAttribute('aria-invalid','true');
        else binding.input.removeAttribute('aria-invalid');
      }
      status.textContent=snapshot.notice||`${snapshot.pending.length} pending room input(s). Saved and exported projects include committed values only.`;
      alert.textContent=snapshot.error;alert.hidden=!snapshot.error;
      const conflicts=snapshot.pending.some(item=>item.conflict||item.unavailable);
      apply.disabled=snapshot.applying||!snapshot.pending.length||conflicts;
      discard.disabled=snapshot.applying||!snapshot.pending.length;
      review.hidden=!conflicts;review.disabled=snapshot.applying||snapshot.pending.some(item=>item.unavailable);
      list.replaceChildren();
      for(const item of snapshot.pending){
        const line=node('li',`${item.label}: draft "${item.raw}", saved "${item.current??'unavailable'}"`+
          (item.conflict?` (was "${item.base}"; review required)`:'')+(item.issue?` - ${item.issue}`:''));
        list.appendChild(line);
      }
    };
    apply.addEventListener('click',()=>controller.apply());
    discard.addEventListener('click',()=>controller.discard());
    review.addEventListener('click',()=>controller.reviewConflicts(latest));
    const unsubscribe=controller.subscribe(render);
    let destroyed=false;
    const handle={planner,controller,requestApply:()=>controller.apply(),requestDiscard:()=>controller.discard(),
      destroy(){
        if(destroyed)return;
        destroyed=true;unsubscribe();controller.dispose();state.controller=null;state.handle=null;
        delete host.homePlannerRoomInputs;host.replaceChildren();
      }};
    state.handle=handle;host.homePlannerRoomInputs=controller;
    for(const binding of state.inputs.values()){
      if(binding.startupRaw!==null){
        const raw=binding.startupRaw;binding.startupRaw=null;controller.stage(binding.input.id,raw);
      }
    }
    render(controller.getState());
    return handle;
  }
  function connect(planner,document=root.document){
    const state=documentState(document);
    if(state.handle){
      if(state.handle.planner!==planner)throw failure('RoomInputsOwnerError','Room controls already belong to another coordinator.');
      return state.handle;
    }
    const host=document.getElementById('roomProgrammeDrafts');
    if(!host)throw failure('MissingRoomProgrammeHostError','Add #roomProgrammeDrafts for Apply, Discard and room-input errors.');
    for(const input of document.querySelectorAll('[data-room-setting]'))bind(input);
    const previous=Array.from(host.childNodes||host.children||[]);
    const startup=[...state.inputs.values()].map(binding=>({binding,raw:binding.startupRaw}));
    let controller;
    try{
      controller=createController(planner,{getSpecifications:()=>specifications(document)});
      state.controller=controller;
      return mountView(controller,planner,document,host,state);
    }catch(error){
      controller?.dispose();state.controller=null;state.handle=null;
      if(host.homePlannerRoomInputs===controller)delete host.homePlannerRoomInputs;
      for(const {binding,raw} of startup)if(raw!==null){binding.startupRaw=raw;display(binding);}
      host.replaceChildren(...previous);
      throw error;
    }
  }
  return {COUNT_TYPES,RANGE_PAIRS,numeric,parse,validatePatch,validateSpecification,
    bind,isSetting,readCommitted,readNumber,readCount,writeCommitted,specifications,createController,connect};
});
