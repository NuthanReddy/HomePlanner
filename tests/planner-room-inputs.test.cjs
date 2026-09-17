'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Model=require('../planner-model.js');
const Drafts=require('../planner-drafts.js');
const Inputs=require('../planner-room-inputs.js');
const Persistence=require('../planner-persistence.js');
const Storage=require('../planner-storage.js');
const {createController}=require('../planner-bridge.js');
const copy=value=>JSON.parse(JSON.stringify(value));

function dom(){
  const roots=[],viewListeners=new Map();
  let document;
  class Element{
    constructor(tag){
      this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};
      this.dataset={};this.listeners=new Map();this.value='';this.type='';this.text='';this.hidden=false;
      this.classList={add(){}};
    }
    get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
    set textContent(value){this.text=String(value);this.children=[];}
    get options(){return this.children.filter(child=>child.tagName==='OPTION');}
    setAttribute(key,value){this.attributes[key]=String(value);}
    getAttribute(key){return Object.hasOwn(this.attributes,key)?this.attributes[key]:null;}
    hasAttribute(key){return key==='data-room-setting'?Object.hasOwn(this.dataset,'roomSetting'):Object.hasOwn(this.attributes,key);}
    removeAttribute(key){delete this.attributes[key];}
    appendChild(child){child.parentNode=this;this.children.push(child);return child;}
    append(...children){children.forEach(child=>this.appendChild(child));}
    replaceChildren(...children){this.text='';this.children=[];this.append(...children);}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
    addEventListener(type,listener){
      if(!this.listeners.has(type))this.listeners.set(type,[]);
      this.listeners.get(type).push(listener);
    }
    removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==listener));}
    dispatch(type,extra={}){
      const event={target:this,defaultPrevented:false,isComposing:false,
        preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};
      for(const listener of this.listeners.get(type)||[])listener(event);
    }
    click(){if(!this.disabled)this.dispatch('click');}
    focus(){document.activeElement=this;}
    setCustomValidity(value){this.validationMessage=value;}
  }
  const all=(node)=>[node,...node.children.flatMap(all)];
  const view={setTimeout,clearTimeout,Blob,URL,addEventListener(type,listener){viewListeners.set(type,listener);},
    removeEventListener(type){viewListeners.delete(type);}};
  document={defaultView:view,activeElement:null,createElement:tag=>new Element(tag),
    createTextNode(text){const node=new Element('#text');node.textContent=text;return node;},
    getElementById:id=>roots.flatMap(all).find(node=>node.id===id)||null,
    querySelectorAll:selector=>selector==='[data-room-setting]'?roots.flatMap(all).filter(node=>node.hasAttribute('data-room-setting')):[]};
  function element(tag,id){const node=document.createElement(tag);node.id=id;roots.push(node);return node;}
  function input(id,value,min,max,step='0.5'){
    const node=element('input',id);node.type='number';node.value=value;
    node.setAttribute('value',value);node.setAttribute('aria-label',id);
    if(min!==null)node.setAttribute('min',min);
    if(max!==null)node.setAttribute('max',max);
    node.setAttribute('step',step);Inputs.bind(node);return node;
  }
  return {document,view,viewListeners,input,element,all:()=>roots.flatMap(all)};
}

function fixture({startupDraft=null}={}){
  const ui=dom();
  const fields={
    bedCount:ui.input('bedCount','3',0,8,'1'),
    bedMinW:ui.input('bedMinW','9',5,null),
    bedMaxW:ui.input('bedMaxW','12',5,null),
    ceilingHeight:ui.input('ceilingHeight','9',7,null),
    windowHeadHeight:ui.input('windowHeadHeight','7',4,null)
  };
  const host=ui.element('section','roomProgrammeDrafts');
  const context={plate:{frontEdge:'N'},cfg:{ceilingHeight:9*.3048,walls:{external:.2,internal:.1},counts:{bedroom:3}},
    g:{W:24,D:20,outerX:.5,outerY:.5,outerW:23,outerD:19,coreX:.7,coreY:.7,coreW:22.6,coreD:18.6,balconies:[]},
    plan:{placed:[],furniture:[],openings:{doors:[],windows:[]},wallOpenings:[],customOpenings:[],flexSpaces:[],unmet:[]}};
  const room=(id,index)=>({req:{id,type:'bedroom',label:id},
    module:{x:.7+index*4,y:.7,w:3.2,h:4.2},carpet:{x:.75+index*4,y:.75,w:3.1,h:4.1}});
  context.plan.placed=[0,1,2].map(index=>room(`bed-${index+1}`,index));
  context.plan.furniture=[{id:'kept-bed',roomId:'bed-1',type:'bed',label:'Keep',x:1,y:1,w:1.2,h:2,headLocal:'S',pinned:true}];
  let live={controls:{},manualLayouts:[],roomIdentities:{bed:{next:4,ids:['bed-1','bed-2','bed-3']}},context:copy(context)};
  let planner,fail=false,applyCalls=0;
  const phases=[];
  const controls=()=>Object.fromEntries(Object.entries(fields).map(([id,input])=>[id,{value:Inputs.readCommitted(input)}]));
  const adapter={
    capture:()=>({...copy(live),controls:{...live.controls,...controls()}}),
    restore(value){
      phases.push({phase:'restore',forward:planner?.isApplyingRoomControls(),busy:planner?.isBusy()});
      live=copy(value);
      for(const [id,input] of Object.entries(fields))
        if(live.controls[id])Inputs.writeCommitted(input,live.controls[id].value);
    },
    roomControlSpecifications:()=>Inputs.specifications(ui.document),
    applyRoomControls(values){
      phases.push({phase:'apply',forward:planner.isApplyingRoomControls(),busy:planner.isBusy()});applyCalls++;
      for(const [id,value] of Object.entries(values))Inputs.writeCommitted(fields[id],value);
    },
    render(){
      phases.push({phase:'render',forward:planner?.isApplyingRoomControls(),busy:planner?.isBusy()});
      if(!live.context){live.context=copy(context);live.context.plan.placed=[];live.context.plan.furniture=[];}
      const count=Inputs.readNumber(fields.bedCount);
      if(!live.roomIdentities)live.roomIdentities={bed:{next:1,ids:[]}};
      const identity=live.roomIdentities.bed;
      while(identity.ids.length<count)identity.ids.push(`bed-${identity.next++}`);
      identity.ids=identity.ids.slice(0,count);
      live.context.plan.placed=identity.ids.map((id,index)=>live.context.plan.placed.find(item=>item.req.id===id)||room(id,index));
      live.context.plan.furniture=live.context.plan.furniture.filter(item=>identity.ids.includes(item.roomId));
      live.context.cfg.counts.bedroom=count;
      live.context.cfg.ceilingHeight=Inputs.readNumber(fields.ceilingHeight)*.3048;
      live.context.cfg.bed={minW:Inputs.readNumber(fields.bedMinW)*.3048,maxW:Inputs.readNumber(fields.bedMaxW)*.3048};
      if(fail&&planner?.isApplyingRoomControls()){
        fail=false;live.context.plan.placed[0].carpet.x+=.2;live.context.plan.placed[0].module.x+=.2;
      }
    },
    edit(command,entity){
      const item=live.context.plan.placed.find(room=>room.req.id===entity.sourceId);
      const dx=command.rect.x-item.carpet.x,dy=command.rect.y-item.carpet.y;
      item.carpet=copy(command.rect);item.module.x+=dx;item.module.y+=dy;
    },
    setCeiling(value){Inputs.writeCommitted(fields.ceilingHeight,value/.3048);}
  };
  adapter.render();
  if(startupDraft!==null){fields.bedCount.value=startupDraft;fields.bedCount.dispatch('input');}
  planner=createController(adapter,Model);
  planner.refresh();
  const handle=Inputs.connect(planner,ui.document),controller=handle.controller;
  return {ui,host,fields,planner,adapter,controller,handle,phases,
    failNext(){fail=true;},get applyCalls(){return applyCalls;},
    type(id,value,type='input'){fields[id].value=value;fields[id].dispatch(type);}};
}

function command(planner,patch){
  const project=planner.getProject();
  return {type:'update-room-controls',projectId:project.id,floorId:project.activeFloorId,patch,
    expected:Object.fromEntries(Object.keys(patch).map(id=>[id,project.legacy.controls[id]?.value??'not-saved']))};
}

test('room numbers obey integer quantities, continuous steps and ordered ranges without clamping',()=>{
  const quantity={id:'bedCount',label:'Bedroom quantity',min:0,max:8,step:1,stepBase:0,integer:true};
  const length={id:'bedMinW',label:'Width',min:0,max:null,step:.1,stepBase:0,integer:false};
  assert.equal(Inputs.parse('.3',length),.3);
  assert.equal(Inputs.parse('7',quantity),7);
  for(const raw of ['','-','Infinity','NaN','3 rooms','3.5','9','-1'])
    assert.throws(()=>Inputs.parse(raw,quantity));
  assert.throws(()=>Inputs.parse('.31',length),/increments/);
  assert.equal(Inputs.parse('9.5',{...length,step:.5}),9.5);
  assert.throws(()=>Inputs.parse('9.25',{...length,step:.5}),/increments/);
  assert.throws(()=>Inputs.validatePatch({bedMinW:13},[length,{...length,id:'bedMaxW'}],
    {bedMaxW:{value:'12'}}),{code:'RoomControlsValidationError'});
});

test('startup typing is retained as an owned draft without entering the first project snapshot',t=>{
  const f=fixture({startupDraft:'-'});t.after(()=>f.handle.destroy());
  assert.equal(f.fields.bedCount.type,'text');
  assert.equal(f.fields.bedCount.inputMode,'numeric');
  assert.equal(f.fields.bedCount.value,'-');
  assert.equal(Inputs.readNumber(f.fields.bedCount),3);
  assert.equal(f.planner.getProject().legacy.controls.bedCount.value,'3');
  assert.equal(f.planner.getScene().rooms.length,3);
  assert.equal(Drafts.pending(f.planner,f.planner.getProject().id).length,1);
});

test('blank, intermediate and blur/change input preserve geometry, identities, source controls and history',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const before=f.planner.getProject(),scene=f.planner.getScene();
  for(const raw of ['','1','12','-']){
    f.type('bedCount',raw);f.fields.bedCount.dispatch('blur');f.fields.bedCount.dispatch('change');
    assert.equal(f.planner.getProject(),before);
    assert.equal(f.planner.getScene(),scene);
    assert.equal(Inputs.readNumber(f.fields.bedCount),3);
    assert.equal(f.planner.canUndo(),false);
    assert.equal(f.fields.bedCount.value,raw);
  }
  assert.equal(f.controller.apply(),false);
  assert.equal(f.applyCalls,0);
  assert.match(f.controller.getState().error,/not applied/);
  assert.equal(f.fields.bedCount.value,'-');
  assert.deepEqual(JSON.parse(f.planner.exportProject()),before);
});

test('Apply validates every supplied field before one incremental room/default transaction',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const before=f.planner.getProject(),rooms=f.planner.getScene().rooms,furniture=f.planner.getScene().furniture;
  f.type('bedCount','4');f.type('bedMinW','13');
  assert.equal(f.controller.apply(),false);
  assert.equal(f.applyCalls,0);
  assert.equal(f.planner.getProject(),before);
  assert.equal(f.controller.getState().pending.length,2);
  f.type('bedMaxW','14');
  f.fields.bedMaxW.dispatch('keydown',{key:'Enter'});
  assert.equal(f.applyCalls,1);
  assert.equal(f.planner.getProject().revision,before.revision+1);
  assert.equal(f.planner.getProject().legacy.controls.bedCount.value,'4');
  assert.equal(f.planner.getProject().legacy.controls.bedMinW.value,'13');
  assert.equal(f.planner.getProject().legacy.controls.bedMaxW.value,'14');
  assert.deepEqual(f.planner.getScene().rooms.slice(0,3).map(room=>room.rect),rooms.map(room=>room.rect));
  assert.deepEqual(f.planner.getScene().furniture,furniture);
  assert.equal(f.controller.getState().pending.length,0);
  assert.ok(f.phases.some(phase=>phase.phase==='render'&&phase.forward&&phase.busy));
  assert.equal(f.planner.isApplyingRoomControls(),false);
  f.planner.undo();
  assert.deepEqual(f.planner.getScene().rooms,rooms);
  assert.equal(f.planner.getProject().legacy.controls.bedMinW.value,'9');
  assert.equal(f.planner.canUndo(),false);
  f.planner.redo();
  assert.equal(f.planner.getScene().rooms.length,4);
});

test('numeric no-op Apply clears its draft without normalizing the project or adding history',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const before=f.planner.getProject();
  f.type('bedCount','3.0');
  assert.equal(f.controller.apply(),true);
  assert.equal(f.applyCalls,0);
  assert.equal(f.planner.getProject(),before);
  assert.equal(f.planner.canUndo(),false);
  assert.equal(f.controller.getState().pending.length,0);
  assert.equal(f.fields.bedCount.value,'3');
});

test('unrelated rename and room movement never capture an unfinished quantity or dimension',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('bedCount','');f.type('bedMinW','-');
  f.planner.execute({type:'rename-project',name:'Unrelated rename'});
  const room=f.planner.getScene().rooms[0];
  f.planner.execute({type:'update-room',id:room.id,rect:{...room.rect,x:room.rect.x+.1}});
  assert.equal(f.planner.getProject().legacy.controls.bedCount.value,'3');
  assert.equal(f.planner.getProject().legacy.controls.bedMinW.value,'9');
  assert.equal(f.planner.getScene().rooms.length,3);
  assert.equal(f.fields.bedCount.value,'');
  assert.equal(f.fields.bedMinW.value,'-');
  assert.equal(f.controller.getState().pending.length,2);
  assert.equal(f.controller.getState().pending.some(item=>item.conflict),false);
});

test('deliberate writes use committed quantities, preserve drafts and require review before overwriting changed values',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('bedCount','5');
  Inputs.writeCommitted(f.fields.bedCount,Inputs.readNumber(f.fields.bedCount)+1);
  f.adapter.render();f.planner.acceptLegacy();
  assert.equal(f.planner.getScene().rooms.length,4);
  assert.equal(f.fields.bedCount.value,'5');
  assert.equal(f.controller.getState().pending[0].base,'3');
  assert.equal(f.controller.getState().pending[0].current,'4');
  assert.equal(f.controller.getState().pending[0].conflict,true);
  const before=f.planner.getProject();
  assert.equal(f.controller.apply(),false);
  assert.equal(f.planner.getProject(),before);
  const reviewed=f.controller.getState();
  assert.equal(f.controller.reviewConflicts(reviewed),true);
  assert.equal(f.planner.getProject(),before);
  assert.equal(f.controller.apply(),true);
  assert.equal(f.planner.getScene().rooms.length,5);
  assert.equal(f.planner.getProject().revision,before.revision+1);
});

test('owner drafts survive floors/projects and same-ID restoration without being written into saved controls',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('bedCount','4');
  const original=f.planner.getProject(),floor=original.activeFloorId;
  f.planner.execute({type:'add-floor'});
  assert.equal(f.fields.bedCount.value,'0');
  assert.equal(f.controller.getState().pending.length,0);
  f.type('bedCount','2');
  f.planner.execute({type:'select-floor',id:floor});
  assert.equal(f.fields.bedCount.value,'4');
  assert.equal(f.planner.getProject().legacy.controls.bedCount.value,'3');
  f.planner.newProject();
  assert.equal(f.controller.getState().pending.length,0);
  assert.equal(Drafts.hasPending(f.planner,original.id),true);
  f.planner.replaceProject(original);
  assert.equal(f.fields.bedCount.value,'4');
  assert.equal(f.controller.getState().pending[0].conflict,false);
  const replacement=copy(f.planner.getProject());
  replacement.legacy.controls.bedCount.value='2';
  replacement.legacy.context.cfg.counts.bedroom=2;
  replacement.legacy.context.plan.placed.pop();
  replacement.legacy.roomIdentities.bed.ids.pop();
  f.planner.replaceProject(replacement);
  assert.equal(f.fields.bedCount.value,'4');
  assert.equal(f.controller.getState().pending[0].conflict,true);
  assert.equal(f.controller.apply(),false);
  f.controller.discard();
  assert.equal(f.fields.bedCount.value,'2');
  assert.equal(f.controller.getState().pending.length,0);
});

test('a failed programme edit rolls back with the forward-only preservation signal disabled',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const before=f.planner.getProject(),rooms=f.planner.getScene().rooms;
  f.type('bedCount','4');f.failNext();
  assert.equal(f.controller.apply(),false);
  assert.deepEqual(f.planner.getProject(),before);
  assert.deepEqual(f.planner.getScene().rooms,rooms);
  assert.equal(Inputs.readNumber(f.fields.bedCount),3);
  assert.equal(f.fields.bedCount.value,'4');
  assert.equal(f.planner.canUndo(),false);
  assert.equal(f.controller.getState().pending.length,1);
  assert.match(f.controller.getState().error,/re-layout/);
  assert.equal(f.phases.at(-1).phase,'render');
  assert.equal(f.phases.at(-1).forward,false);
  assert.equal(f.phases.at(-1).busy,true);
  assert.equal(f.planner.isApplyingRoomControls(),false);
});

test('typed room-control commands reject stale owners, bases, invalid limits and unknown fields before applying',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const before=f.planner.getProject();
  for(const patch of [{bedCount:3.5},{bedCount:9},{bedMinW:13},{bedCount:'4'},{siteLatitude:0},{bedCount:NaN}]){
    assert.throws(()=>f.planner.execute(command(f.planner,patch)));
    assert.deepEqual(f.planner.getProject(),before);
  }
  assert.throws(()=>f.planner.execute({...command(f.planner,{bedCount:4}),floorId:'other'}),/owner/);
  assert.throws(()=>f.planner.execute({...command(f.planner,{bedCount:4}),expected:{bedCount:'2'}}),/changed/);
  assert.equal(f.applyCalls,0);
  assert.equal(f.planner.canUndo(),false);
});

test('trusted ceiling writes preserve a pending draft and the canonical metre value without applying room step rounding',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('ceilingHeight','');
  f.planner.execute({type:'update-building',patch:{wallHeightM:3.1}});
  assert.equal(f.planner.getProject().building.wallHeightM,3.1);
  assert.equal(f.planner.getProject().legacy.controls.ceilingHeight.value,String(3.1/.3048));
  assert.equal(f.fields.ceilingHeight.value,'');
  assert.equal(f.controller.getState().pending[0].conflict,true);
});

test('actual persistence sees room drafts, saves committed values and guards unload including parked owners',async t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const records=new Map(),store={
    async list(){return [...records.values()];},async getSetting(){},
    async setSetting(key,value){return value;},
    async save(project){const record=Storage.createRecord(project,records.get(project.id));records.set(project.id,record);return record;},
    close(){}
  };
  const host=f.ui.element('section','plannerPersistence');
  const mounted=Persistence.mount(host,f.planner,{openStore:async()=>store});
  t.after(()=>mounted.destroy());
  await mounted.controller.ready;await mounted.controller.saveNow();
  f.type('bedCount','');
  assert.equal(mounted.controller.getState().dirty,false);
  assert.equal(mounted.controller.getState().draftCount,1);
  await mounted.controller.saveNow();
  const project=f.planner.getProject();
  assert.equal(records.get(project.id).document.legacy.controls.bedCount.value,'3');
  assert.equal(JSON.parse(mounted.controller.exportJSON().text).legacy.controls.bedCount.value,'3');
  let prevented=false;
  f.ui.viewListeners.get('beforeunload')({preventDefault(){prevented=true;},returnValue:null});
  assert.equal(prevented,true);
  f.planner.newProject();await mounted.controller.saveNow();
  assert.equal(mounted.controller.getState().dirty,false);
  assert.equal(mounted.controller.getState().draftCount,0);
  prevented=false;
  f.ui.viewListeners.get('beforeunload')({preventDefault(){prevented=true;},returnValue:null});
  assert.equal(prevented,true);
});

test('the mounted Apply/Discard controls use the same transaction and keep unrelated owner drafts',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  const button=action=>f.ui.all().find(node=>node.dataset.roomProgrammeAction===action);
  const before=f.planner.getProject();
  f.type('bedCount','4');
  button('apply').click();
  assert.equal(f.planner.getProject().revision,before.revision+1);
  assert.equal(f.planner.getScene().rooms.length,4);
  f.type('bedCount','-');
  const after=f.planner.getProject();
  button('discard').click();
  assert.equal(f.planner.getProject(),after);
  assert.equal(f.fields.bedCount.value,'4');
  assert.equal(f.controller.getState().pending.length,0);
});

test('deliberate quantity writes reject fractional/out-of-range values without adopting a UI draft',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('bedCount','7');
  for(const value of [-1,3.5,9,NaN]){
    assert.throws(()=>Inputs.writeCommitted(f.fields.bedCount,value));
    assert.equal(Inputs.readCount(f.fields.bedCount,8),3);
    assert.equal(f.fields.bedCount.value,'7');
  }
  assert.throws(()=>Inputs.readCount(f.fields.bedCount,2),/supported range/);
});

test('source review refuses another unseen saved-value change and does not rebase the draft',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('bedCount','6');
  Inputs.writeCommitted(f.fields.bedCount,4);f.adapter.render();f.planner.acceptLegacy();
  const review=f.controller.getState();
  Inputs.writeCommitted(f.fields.bedCount,5);f.adapter.render();f.planner.acceptLegacy();
  const before=f.planner.getProject();
  assert.equal(f.controller.reviewConflicts(review),false);
  assert.equal(f.controller.getState().pending[0].base,'3');
  assert.equal(f.controller.getState().pending[0].raw,'6');
  assert.equal(f.planner.getProject(),before);
});

test('programme-preservation permission is off for Undo, Redo, import and New initialization',t=>{
  const f=fixture();t.after(()=>f.handle.destroy());
  f.type('bedCount','4');f.controller.apply();
  f.phases.length=0;
  f.planner.undo();f.planner.redo();
  const saved=f.planner.getProject();
  f.planner.replaceProject(saved);f.planner.newProject();
  assert.ok(f.phases.length>0);
  assert.ok(f.phases.every(phase=>phase.forward===false));
});

test('failed room draft UI construction releases its project subscription and can be retried',t=>{
  const f=fixture();f.handle.destroy();
  const original=f.ui.document.createElement,subscribe=f.planner.subscribe;
  let subscriptions=0;
  f.planner.subscribe=listener=>{
    subscriptions++;
    const remove=subscribe(listener);
    return ()=>{subscriptions--;remove();};
  };
  f.ui.document.createElement=()=>{throw new Error('Synthetic room UI failure');};
  assert.throws(()=>Inputs.connect(f.planner,f.ui.document),/Synthetic room UI failure/);
  assert.equal(subscriptions,0);
  assert.equal(f.host.homePlannerRoomInputs,undefined);
  f.ui.document.createElement=original;
  const recovered=Inputs.connect(f.planner,f.ui.document);
  t.after(()=>recovered.destroy());
  assert.equal(subscriptions,1);
  assert.equal(recovered.controller.getState().pending.length,0);
});
