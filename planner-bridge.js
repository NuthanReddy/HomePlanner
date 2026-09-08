(function(root){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const FLOOR_FIELDS=['wallEdits','doorEdits','windowEdits','furnitureEdits','obstacles','electrical'];
  const freshId=prefix=>`${prefix}-${root.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  function freeze(value){
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.values(value).forEach(freeze);Object.freeze(value);
    }
    return value;
  }
  function finite(value,label,positive=false){
    if(!Number.isFinite(value)||(positive&&value<=0))throw new Error(`${label} must be ${positive?'positive and ':''}finite.`);
    return value;
  }
  function remapFloor(value,oldId,newId,key='id'){
    const scoped=text=>text===oldId||text.startsWith(oldId+':')||text.startsWith(oldId+'/');
    if(typeof value==='string'){
      if((key==='id'||/Ids?$/.test(key)||scoped(key))&&scoped(value))
        return newId+value.slice(oldId.length);
      return value;
    }
    if(Array.isArray(value))return value.map(item=>remapFloor(item,oldId,newId,key));
    if(value&&typeof value==='object')
      return Object.fromEntries(Object.entries(value).map(([field,item])=>[
        scoped(field)?newId+field.slice(oldId.length):field,remapFloor(item,oldId,newId,field)]));
    return value;
  }

  function createController(adapter,Model){
    let project=Model.createProject(),selection=null,busy=false,gesture=null;
    let history=[],future=[],listeners=new Set(),cachedProject=null,cachedScenes=null;
    const initialLegacy=clone(adapter.capture());
    function normalize(doc){
      doc.name=doc.name||'HomePlanner project';
      doc.revision=Number.isInteger(doc.revision)?doc.revision:0;
      doc.floors=doc.floors?.length?doc.floors:[{id:freshId('floor'),name:'Ground floor',heightM:3}];
      doc.activeFloorId=doc.activeFloorId||doc.floors[0].id;
      doc.legacy=doc.legacy?.controls?doc.legacy:clone(initialLegacy);
      FLOOR_FIELDS.forEach(key=>{if(!doc[key])doc[key]=['obstacles','electrical'].includes(key)?[]:{};});
      return doc;
    }
    normalize(project);
    project.legacy=clone(initialLegacy);
    function active(doc){return doc.floors.find(floor=>floor.id===doc.activeFloorId);}
    function syncActive(doc){
      const floor=active(doc);
      if(!floor)throw new Error('The selected floor no longer exists.');
      floor.legacy=clone(doc.legacy);
      floor.wallHeightM=doc.building.wallHeightM;
      FLOOR_FIELDS.forEach(key=>{floor[key]=clone(doc[key]);});
    }
    function loadFloor(doc,floor){
      doc.activeFloorId=floor.id;doc.legacy=clone(floor.legacy||initialLegacy);
      FLOOR_FIELDS.forEach(key=>{doc[key]=clone(floor[key]||(['obstacles','electrical'].includes(key)?[]:{}));});
      doc.building.wallHeightM=floor.wallHeightM||floor.legacy?.context?.cfg?.ceilingHeight||2.7432;
    }
    syncActive(project);
    const defaults=clone(project);
    function invalidate(){cachedProject=null;cachedScenes=null;}
    function getProject(){
      if(!cachedProject)cachedProject=freeze(clone(project));
      return cachedProject;
    }
    function sceneFor(context,doc=project){
      if(!context?.g||context.g.error||!Number.isFinite(context.g.W)||!Number.isFinite(context.g.D))return null;
      return Model.buildScene(context,doc);
    }
    function getScenes(){
      if(!cachedScenes){
        cachedScenes=freeze(project.floors.map(floor=>{
          const doc=clone(project);loadFloor(doc,floor);
          return sceneFor(floor.id===project.activeFloorId?project.legacy.context:floor.legacy?.context,doc);
        }).filter(Boolean));
      }
      return cachedScenes;
    }
    function getScene(){
      return getScenes().find(scene=>scene.floorId===project.activeFloorId)||
        (project.legacy.context?freeze(sceneFor(project.legacy.context)):null);
    }
    function emit(type){
      const event={type,project:getProject(),scene:getScene(),selection};
      listeners.forEach(listener=>listener(event));
    }
    function capture(){
      project.legacy=clone(adapter.capture());
      if(project.legacy.context?.cfg?.ceilingHeight)
        project.building.wallHeightM=project.legacy.context.cfg.ceilingHeight;
      syncActive(project);invalidate();
    }
    function commit(label,work,{restore=false,render=true,remember=true}={}){
      if(busy)throw new Error('A project edit is already in progress.');
      const before=clone(project);
      busy=true;project=clone(project);invalidate();
      try{
        work(project);
        syncActive(project);
        invalidate();
        Model.validateProject(project);
        if(restore)adapter.restore(project.legacy);
        if(render)adapter.render();
        capture();
        project.revision=before.revision+1;
        project.updatedAt=new Date().toISOString();
        syncActive(project);Model.validateProject(project);invalidate();
        if(remember){history.push({label,project:before});if(history.length>40)history.shift();future=[];}
      }catch(error){
        project=before;invalidate();
        adapter.restore(before.legacy);adapter.render();
        throw error;
      }finally{busy=false;}
      emit(restore?'restore':'change');
      return getProject();
    }
    function acceptLegacy(label='Edit layout'){
      if(busy||gesture)return;
      const next=adapter.capture();
      if(JSON.stringify(next)===JSON.stringify(project.legacy))return;
      commit(label,()=>{},{render:false});
    }
    function find(kind,id){
      const scene=getScene();
      const collection=kind==='room'?scene?.rooms:kind==='furniture'?scene?.furniture:
        kind==='wall'?scene?.walls:scene?.openings;
      const entity=collection?.find(item=>item.id===id);
      if(!entity)throw new Error('The selected object is no longer on this floor.');
      return entity;
    }
    function execute(command){
      if(!command||typeof command.type!=='string')throw new Error('Choose a valid editor action.');
      acceptLegacy();
      const type=command.type;
      const render=!['update-site','update-solar-inputs','set-environment','rename-project'].includes(type);
      const restore=['select-floor','add-floor','delete-floor'].includes(type);
      const entityTypes={'update-room':'room','update-furniture':'furniture','rotate-furniture':'furniture',
        'delete-furniture':'furniture','update-door':'door','update-window':'window','delete-opening':'opening',
        'open-wall':'wall','restore-wall':'wall'};
      const entity=entityTypes[type]?find(entityTypes[type],command.id):null;
      return commit(type,doc=>{
        if(type==='rename-project'){
          if(typeof command.name!=='string'||!command.name.trim())throw new Error('Enter a project name.');
          doc.name=command.name.trim().slice(0,150);
        }else if(type==='update-site'){
          Object.assign(doc.site,command.patch);
        }else if(type==='update-solar-inputs'){
          Object.assign(doc.site,command.site);
          doc.environment={...doc.environment,sunSelection:clone(command.sunSelection)};
        }else if(type==='update-building'){
          Object.assign(doc.building,command.patch);
          if(command.patch.wallHeightM!==undefined)adapter.setCeiling(command.patch.wallHeightM);
        }else if(type==='set-obstacles'||type==='set-electrical'){
          if(!Array.isArray(command.value))throw new Error('The item list must be an array.');
          doc[type==='set-obstacles'?'obstacles':'electrical']=clone(command.value);
        }else if(type==='set-environment'){
          if(!command.patch||typeof command.patch!=='object'||Array.isArray(command.patch))throw new Error('Provide a valid analysis configuration.');
          doc.environment={...doc.environment,...clone(command.patch)};
        }else if(type==='reset-floor-layout'){
          ['wallEdits','doorEdits','windowEdits','furnitureEdits'].forEach(key=>{doc[key]={};});
          adapter.resetLayout();
        }else if(type==='select-floor'){
          syncActive(doc);
          const floor=doc.floors.find(item=>item.id===command.id);
          if(!floor)throw new Error('Choose an existing floor.');
          loadFloor(doc,floor);selection=null;
        }else if(type==='add-floor'){
          syncActive(doc);
          const source=command.copyFromId?doc.floors.find(item=>item.id===command.copyFromId):null;
          if(command.copyFromId&&!source)throw new Error('The floor to duplicate no longer exists.');
          const id=freshId('floor');
          const floor=source?remapFloor(clone(source),source.id,id):
            {id,heightM:3,wallHeightM:doc.building.wallHeightM,legacy:clone(doc.legacy)};
          floor.id=id;floor.name=typeof command.name==='string'&&command.name.trim()?command.name.trim():`Floor ${doc.floors.length}`;
          if(!source){
            floor.legacy.manualLayouts=[];floor.legacy.context=null;
            Object.keys(floor.legacy.controls).filter(key=>/^(living|bed|kitchen|bath|pooja|balcony|lift|stair)Count$/.test(key))
              .forEach(key=>{floor.legacy.controls[key]={value:'0'};});
            FLOOR_FIELDS.forEach(key=>{floor[key]=['obstacles','electrical'].includes(key)?[]:{};});
          }
          doc.floors.push(floor);loadFloor(doc,floor);selection=null;
        }else if(type==='update-floor'){
          const floor=doc.floors.find(item=>item.id===command.id);
          if(!floor)throw new Error('Choose an existing floor.');
          if(command.patch?.heightM!==undefined)floor.heightM=finite(command.patch.heightM,'Storey height',true);
          if(command.patch?.name!==undefined){
            if(typeof command.patch.name!=='string'||!command.patch.name.trim())throw new Error('Enter a floor name.');
            floor.name=command.patch.name.trim().slice(0,100);
          }
        }else if(type==='delete-floor'){
          if(doc.floors.length===1)throw new Error('Keep at least one floor.');
          const index=doc.floors.findIndex(floor=>floor.id===command.id);
          if(index<0)throw new Error('Choose an existing floor.');
          syncActive(doc);doc.floors.splice(index,1);
          loadFloor(doc,doc.floors[Math.min(index,doc.floors.length-1)]);selection=null;
        }else if(type==='update-door'||type==='update-window'){
          const record={...(doc[type==='update-door'?'doorEdits':'windowEdits'][entity.id]||{})};
          const keys=type==='update-door'?['hinge','swing','widthM','openFraction']:['widthM','sillM','heightM','openFraction'];
          keys.forEach(key=>{if(command[key]!==undefined)record[key]=command[key];});
          if(record.widthM!==undefined)finite(record.widthM,'Opening width',true);
          if(record.heightM!==undefined)finite(record.heightM,'Opening height',true);
          if(record.sillM!==undefined&&finite(record.sillM,'Sill height')<0)throw new Error('Sill height cannot be negative.');
          if(record.openFraction!==undefined&&(!Number.isFinite(record.openFraction)||record.openFraction<0||record.openFraction>1))
            throw new Error('Opening fraction must be between zero and one.');
          if(record.hinge!==undefined&&!['start','end'].includes(record.hinge))throw new Error('Choose a valid hinge end.');
          if(record.swing!==undefined&&!['left','right'].includes(record.swing))throw new Error('Choose a valid swing side.');
          const wall=find('wall',entity.wallId),length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
          if(entity.offsetM+(record.widthM??entity.widthM)>length+1e-7)throw new Error('The opening would extend past its wall.');
          const sill=record.sillM??entity.sillM,height=record.heightM??entity.heightM;
          if(sill+height>wall.heightM+1e-7)throw new Error('The opening would extend above its wall.');
          const overlap=getScene().openings.some(other=>other.id!==entity.id&&other.wallId===wall.id&&
            other.kind!=='passage'&&entity.offsetM<other.offsetM+other.widthM-1e-7&&
            entity.offsetM+(record.widthM??entity.widthM)>other.offsetM+1e-7&&
            sill<other.sillM+other.heightM-1e-7&&sill+height>other.sillM+1e-7);
          if(overlap)throw new Error('The opening would overlap another door or window.');
          doc[type==='update-door'?'doorEdits':'windowEdits'][entity.id]=record;
        }else if(type==='delete-opening'){
          adapter.deleteOpening(entity);
          delete doc.doorEdits[entity.id];delete doc.windowEdits[entity.id];
        }else if(type==='open-wall'){
          if(entity.exterior||entity.structuralRole==='structural')throw new Error('Exterior or protected walls cannot be removed.');
          if(command.confirmConceptual!==true)throw new Error('Confirm this is a conceptual internal partition edit, not permission to demolish.');
          const length=Math.hypot(entity.end.x-entity.start.x,entity.end.y-entity.start.y);
          const offsetM=command.full?0:finite(command.offsetM,'Opening offset');
          const widthM=command.full?length:finite(command.widthM,'Opening width',true);
          if(offsetM<0||offsetM+widthM>length+1e-7)throw new Error('The open connection must remain within the wall span.');
          doc.wallEdits[entity.id]={full:!!command.full,offsetM,widthM};
        }else if(type==='restore-wall'){
          const authored=Object.prototype.hasOwnProperty.call(doc.wallEdits,entity.id);
          delete doc.wallEdits[entity.id];
          const restored=adapter.restoreWall(entity);
          if(!authored&&!restored)throw new Error('There is no removed partition to restore. Edit or remove the hosted opening instead.');
        }else if(type==='add-window'){
          adapter.addWindow(command,find('wall',command.wallId));
        }else if(entityTypes[type]){
          adapter.edit(command,entity,doc);
        }else throw new Error('This editor action is not supported.');
      },{restore,render,remember:type!=='select-floor'});
    }
    function restoreHistory(from,to){
      if(!from.length)return false;
      const target=from.pop(),before=clone(project);
      busy=true;
      try{
        project=clone(target.project);invalidate();adapter.restore(project.legacy);adapter.render();
        capture();project.revision=before.revision+1;syncActive(project);invalidate();
        to.push({label:target.label,project:before});selection=null;
      }catch(error){
        project=before;from.push(target);invalidate();adapter.restore(before.legacy);adapter.render();throw error;
      }finally{busy=false;}
      emit('restore');return true;
    }
    function replaceProject(next){
      Model.validateProject(next);
      const prepared=normalize(clone(next));syncActive(prepared);
      const previous=clone(project),previousHistory=history,previousFuture=future;
      busy=true;
      try{
        project=prepared;invalidate();adapter.restore(project.legacy);adapter.render();capture();
        Model.validateProject(project);history=[];future=[];selection=null;invalidate();
      }catch(error){
        project=previous;history=previousHistory;future=previousFuture;invalidate();
        adapter.restore(previous.legacy);adapter.render();throw error;
      }finally{busy=false;}
      emit('project');return getProject();
    }
    const api={
      getProject,getScene,getScenes,getSelection:()=>selection,execute,
      select(ref){
        if(ref!==null&&(!ref||typeof ref.id!=='string'||typeof ref.kind!=='string'))throw new Error('Choose a valid object.');
        if(selection?.kind===ref?.kind&&selection?.id===ref?.id)return;
        selection=ref?Object.freeze({kind:ref.kind,id:ref.id}):null;emit('selection');
      },
      subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
      undo:()=>restoreHistory(history,future),redo:()=>restoreHistory(future,history),
      canUndo:()=>history.length>0,canRedo:()=>future.length>0,
      exportProject:()=>JSON.stringify(getProject(),null,2),
      importProject:text=>replaceProject(Model.parseProject(text)),replaceProject,
      newProject(){
        const doc=clone(defaults);doc.id=freshId('project');doc.name='Untitled project';doc.revision=0;
        doc.floors=doc.floors.map(floor=>remapFloor(floor,floor.id,freshId('floor')));
        doc.activeFloorId=doc.floors[0].id;
        doc.site={latitude:17.385,longitude:78.4867,timeZone:'Asia/Kolkata'};
        return replaceProject(doc);
      },
      acceptLegacy,isBusy:()=>busy,
      sceneForRender:(plate,g,plan,cfg)=>sceneFor({plate,g,plan,cfg}),
      beginLegacyGesture(){if(!gesture)gesture=clone(project);},
      endLegacyGesture(cancel=false){
        const before=gesture;gesture=null;
        if(cancel&&before){busy=true;try{adapter.restore(before.legacy);adapter.render();}finally{busy=false;}return;}
        acceptLegacy('Move or resize');
      },
      selectSource(kind,sourceId){
        const scene=getScene(),list=kind==='room'?scene?.rooms:kind==='furniture'?scene?.furniture:scene?.openings;
        const item=list?.find(value=>value.sourceId===sourceId||value.id===sourceId);
        if(item)api.select({kind,id:item.id});
      },
      refresh(){capture();emit('change');}
    };
    Model.validateProject(project);
    return api;
  }

  if(typeof module==='object'&&module.exports){module.exports={createController,remapFloor};return;}
  if(!root.document)return;
  const Model=root.HomePlannerModel;
  if(!Model){
    const host=document.getElementById('plannerPersistence');
    if(host)host.textContent='The shared planner model could not load. Reload with all local scripts present.';
    return;
  }
  const controls=()=>[...document.querySelectorAll('#page-optimizer input[id],#page-optimizer select[id],#page-rooms input[id],#page-rooms select[id]')]
    .filter(el=>!el.closest('#plannerInspector,#plannerProjectTools,#plannerPersistence,#planner3d'));
  const readControls=()=>Object.fromEntries(controls().map(el=>[el.id,el.type==='checkbox'?{checked:el.checked}:{value:el.value}]));
  const initialControls=readControls();
  let controller,scheduled=false,pendingRoomChoices=null,pendingZoom=null;
  function contextSnapshot(){
    const ctx=root.__roomPlanner;
    if(!ctx||ctx.g.error||!Number.isFinite(ctx.g.W)||!Number.isFinite(ctx.g.D))return null;
    return clone({plate:ctx.plate,g:ctx.g,cfg:ctx.cfg,plan:{
      placed:ctx.plan.placed,unmet:ctx.plan.unmet,free:ctx.plan.free,flexSpaces:ctx.plan.flexSpaces,
      openings:ctx.plan.openings,wallOpenings:ctx.plan.wallOpenings,customOpenings:ctx.plan.customOpenings,
      furniture:ctx.plan.furniture
    }});
  }
  function scheduleCapture(){
    if(!controller||controller.isBusy()||scheduled)return;
    scheduled=true;
    queueMicrotask(()=>{
      scheduled=false;
      try{controller.acceptLegacy();}
      catch(error){
        const status=document.getElementById('plannerBridgeStatus');
        if(status)status.textContent=`The layout edit could not be saved: ${error.message}`;
        else throw error;
      }
    });
  }
  const adapter={
    capture(){
      const roads=Object.fromEntries([...document.querySelectorAll('#roadInputs input[data-dir]')].map(input=>{
        const unit=document.querySelector(`#roadInputs select[data-dir="${input.dataset.dir}"]`);
        return [input.dataset.dir,{width:input.value,unit:unit.value}];
      }));
      return {controls:readControls(),roads,splitAxis:splitAxisEdge()||null,
        manualLayouts:clone([...roomManualLayouts.entries()]),context:contextSnapshot()};
    },
    restore(legacy){
      const states={...initialControls,...legacy?.controls};
      if(states.face?.value!==undefined){
        const face=document.getElementById('face');
        if(![...face.options].some(option=>option.value===states.face.value))throw new Error('The saved plot-facing choice is not supported.');
        face.value=states.face.value;
      }
      document.getElementById('roadInputs').replaceChildren();
      document.getElementById('splitControls').replaceChildren();
      buildRoadInputs();
      for(const input of document.querySelectorAll('#roadInputs input[data-dir]')){
        const road=legacy.roads?.[input.dataset.dir];
        if(legacy.roads&&!road)throw new Error('The saved road inputs do not match the selected plot frontage.');
        if(!road)continue;
        if(typeof road.width!=='string'||!['0.3048','1'].includes(road.unit))throw new Error('The saved road width or unit is invalid.');
        input.value=road.width;
        if(road.width&&input.value==='')throw new Error('The saved road width is not a valid number.');
        document.querySelector(`#roadInputs select[data-dir="${input.dataset.dir}"]`).value=road.unit;
      }
      const axis=legacy.splitAxis??null;
      if(axis!==null&&!['N','E','S','W'].includes(axis))throw new Error('The saved split direction is invalid.');
      const choices=[...document.querySelectorAll('#splitControls .splitAxis')];
      if(axis!==null&&!choices.some(input=>input.value===axis))throw new Error('The saved split direction does not face an abutting road.');
      choices.forEach(input=>{input.checked=input.value===axis;});
      pendingRoomChoices={};
      pendingZoom=states.roomZoom?.value??null;
      controls().forEach(el=>{
        const state=states[el.id];if(!state)return;
        if(el.id==='roomTarget'||el.id==='roomFloor'){
          if(typeof state.value!=='string')throw new Error('The saved floor reference is invalid.');
          pendingRoomChoices[el.id]=state.value;
          return;
        }
        if(el.type==='checkbox'){
          if(typeof state.checked!=='boolean')throw new Error(`The saved flag for ${el.id} is invalid.`);
          el.checked=state.checked;
        }
        else if(typeof state.value==='string'){
          if(el.tagName==='SELECT'&&![...el.options].some(option=>option.value===state.value))
            throw new Error(`The saved choice for ${el.id} is unavailable.`);
          el.value=state.value;
          if(state.value&&el.value==='')throw new Error(`The saved value for ${el.id} is invalid.`);
        }else throw new Error(`The saved value for ${el.id} is invalid.`);
      });
      roomManualLayouts.clear();
      (legacy.manualLayouts||[]).forEach(([key,value])=>roomManualLayouts.set(key,clone(value)));
      roomFixUndoStack.length=0;
    },
    render(){
      const choices=pendingRoomChoices,zoom=pendingZoom;
      pendingRoomChoices=null;pendingZoom=null;
      root.render();
      // Target choices depend on the restored plot, and floor choices on that target.
      for(const id of ['roomTarget','roomFloor']){
        if(choices?.[id]===undefined)continue;
        const el=document.getElementById(id),value=choices[id];
        if(![...el.options].some(option=>option.value===value))
          throw new Error(`The saved ${id==='roomTarget'?'plot target':'regulatory floor'} is unavailable for this plot.`);
        if(el.value!==value){el.value=value;root.render();}
      }
      if(zoom!==null){
        const value=Number(zoom);
        if(!Number.isFinite(value)||value<50||value>300)throw new Error('The saved plan zoom is invalid.');
        roomSetZoom(value/100,null,true);
      }
    },
    resetLayout(){
      const ctx=root.__roomPlanner;
      if(!ctx)throw new Error('There is no valid layout to reset.');
      roomManualLayouts.delete(ctx.signature);
    },
    deleteOpening(entity){
      const ctx=root.__roomPlanner;
      const source=[entity.sourceId,...(entity.sourceIds||[])].find(id=>ctx?.plan.customOpenings?.some(opening=>opening.id===id));
      const item=ctx&&source&&roomFindEditable(ctx,source);
      if(!item||item.kind!=='opening')throw new Error('Only added openings can be deleted. Generated access openings follow the room programme.');
      roomDeleteOpening(ctx,item);
    },
    setCeiling(height){document.getElementById('ceilingHeight').value=String(finite(height,'Wall height',true)/.3048);},
    restoreWall(wall){
      const ctx=root.__roomPlanner;if(!ctx)return false;
      const before=(ctx.plan.wallOpenings||[]).length;
      const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
      ctx.plan.wallOpenings=(ctx.plan.wallOpenings||[]).filter(opening=>
        roomPointToSegmentDistance(wall.start,opening.segment)>length+1e-5||
        !roomSegmentsOverlap(opening.segment,{x1:wall.start.x,y1:wall.start.y,x2:wall.end.x,y2:wall.end.y},0));
      const changed=ctx.plan.wallOpenings.length!==before;
      if(changed)roomSaveManualLayout(ctx);
      return changed;
    },
    edit(command,entity,doc){
      const ctx=root.__roomPlanner;if(!ctx)throw new Error('Generate a valid floor plate first.');
      if(command.type==='update-room'){
        const room=ctx.plan.placed.find(item=>item.req.id===entity.sourceId);
        if(!room)throw new Error('The room is no longer available.');
        const rect=command.rect;
        for(const key of ['x','y','w','h'])finite(rect?.[key],key,key==='w'||key==='h');
        if(!roomCommitManual(ctx,room,rect,false,false))throw new Error(ctx.editError);
      }else{
        const item=roomFindEditable(ctx,entity.sourceId);
        if(!item||item.kind!=='furniture')throw new Error('The component is no longer available.');
        if(command.type==='delete-furniture'){roomDeleteFurniture(ctx,item);delete doc.furnitureEdits[entity.id];return;}
        if(command.type==='rotate-furniture'){
          if(!roomRotateFurniture(ctx,item))throw new Error(ctx.editError||'This component cannot rotate here.');
        }else{
          let rect={...item.rect,...command.rect};
          if(command.headLocal!==undefined){
            if(item.furniture.type!=='bed'||!['N','E','S','W'].includes(command.headLocal))throw new Error('Choose a bed head direction.');
            const prior=item.furniture.headLocal||(item.rect.w<=item.rect.h?'N':'W');
            if(('NS'.includes(prior))!==('NS'.includes(command.headLocal))){
              const cx=rect.x+rect.w/2,cy=rect.y+rect.h/2;
              rect={...rect,x:cx-rect.h/2,y:cy-rect.w/2,w:rect.h,h:rect.w};
            }
            rect.headLocal=command.headLocal;rect.rotated='EW'.includes(command.headLocal);
          }
          if(command.pinned!==undefined)rect.pinned=!!command.pinned;
          for(const key of ['x','y','w','h'])finite(rect[key],key,key==='w'||key==='h');
          if(!roomCommitFurniture(ctx,item.furniture,item.parent,rect,false,false))throw new Error(ctx.editError);
        }
        doc.furnitureEdits[entity.id]={pinned:!!item.furniture.pinned};
        if(item.furniture.headLocal!==undefined)doc.furnitureEdits[entity.id].headLocal=item.furniture.headLocal;
      }
      roomSaveManualLayout(ctx);
    },
    addWindow(command,wall){
      const ctx=root.__roomPlanner;if(!ctx)throw new Error('Generate a valid floor plate first.');
      if(!wall.exterior||wall.removed)throw new Error('Choose a surviving exterior wall.');
      const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
      const offset=finite(command.offsetM,'Window offset'),width=finite(command.widthM,'Window width',true);
      if(offset<0||offset+width>length)throw new Error('The window must fit within the wall.');
      const roomId=wall.roomIds[0],scene=controller.getScene(),room=scene.rooms.find(item=>item.id===roomId);
      if(!room)throw new Error('This exterior wall is not attached to an editable room.');
      const p=ctx.plan.placed.find(item=>item.req.id===room.sourceId);
      const point=Model.wallPoint(wall,offset+width/2);
      const candidate=['N','E','S','W'].map(edge=>roomPointToEdge(p.module,edge,point)).sort((a,b)=>a.distance-b.distance)[0];
      if(!roomExteriorEdges(p.module,ctx.g).includes(candidate.edge))throw new Error('That room edge is not exterior.');
      const height=finite(command.heightM,'Window height',true),sill=finite(command.sillM,'Window sill');
      if(sill<0||sill+height>controller.getProject().building.wallHeightM)throw new Error('The window must fit vertically in the wall.');
      const fraction=command.openFraction;
      if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw new Error('Window opening fraction must be between zero and one.');
      const record={id:freshId('window'),type:'window',roomId:p.req.id,edge:candidate.edge,
        fraction:candidate.fraction,width,height,sillM:sill,openFraction:fraction,
        operability:ctx.cfg.window.operability,windowType:'manual',label:`${p.req.label} window`};
      const built=roomOpeningSegmentFromRecord(record,p);
      ctx.plan.customOpenings=[...(ctx.plan.customOpenings||[]),{...record,...built,custom:true}];
      roomSaveManualLayout(ctx);
    }
  };
  controller=createController(adapter,Model);
  root.HomePlanner=controller;
  function renderContext(g,plan,cfg){
    const plate=root.__roomPlanner?.plate||{id:'whole',frontEdge:g.frontEdge,width:g.W,depth:g.D};
    return {plate:{...plate,frontEdge:g.frontEdge,width:g.W,depth:g.D},g,plan,cfg};
  }
  controller.preparePartitions=(g,plan,cfg)=>{
    plan.wallOpenings=(plan.wallOpenings||[]).filter(item=>!item.projectOverlay);
    const scene=Model.buildScene(renderContext(g,plan,cfg),controller.getProject());
    const edits=controller.getProject().wallEdits;
    scene.walls.filter(wall=>edits[wall.id]&&!wall.exterior).forEach(wall=>{
      const edit=edits[wall.id],length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
      const width=edit.full?length:edit.widthM,offset=edit.full?0:edit.offsetM;
      const start=Model.wallPoint(wall,offset),end=Model.wallPoint(wall,offset+width);
      const rooms=wall.roomIds.map(id=>scene.rooms.find(room=>room.id===id)).filter(Boolean);
      rooms.forEach(room=>{
        const placed=plan.placed.find(item=>item.req.id===room.sourceId);
        if(!placed)return;
        const mid={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
        const nearest=['N','E','S','W'].map(edge=>roomPointToEdge(placed.module,edge,mid)).sort((a,b)=>a.distance-b.distance)[0];
        const target=rooms.find(item=>item.id!==room.id);
        plan.wallOpenings.push({id:`project-${wall.id}-${room.id}`,projectOverlay:true,
          type:'wall-opening',roomId:room.sourceId,targetRoomId:target?.sourceId||null,
          edge:nearest.edge,fraction:nearest.fraction,width,full:edit.full,
          segment:{x1:start.x,y1:start.y,x2:end.x,y2:end.y},
          targetLabel:target?.label||'Internal passage',label:'Open internal partition'});
      });
    });
  };
  controller.applyOpeningEdits=(g,plan,cfg)=>{
    const scene=Model.buildScene(renderContext(g,plan,cfg),controller.getProject());
    for(const record of [...(plan.openings?.doors||[]),...(plan.openings?.windows||[])]){
      const opening=scene.openings.find(item=>item.sourceId===record.id||item.sourceIds?.includes(record.id));
      if(!opening)continue;
      record.width=opening.widthM;record.segment={...opening.segment};
      record.hinge=opening.hinge;record.swing=opening.swing;
      if(opening.kind==='window'){
        record.height=opening.heightM;record.sillM=opening.sillM;
        record.area=opening.widthM*opening.heightM;
        record.openableArea=record.area*record.operability;
        record.openFraction=opening.openFraction;
      }else if(opening.kind==='hinged'){
        const wall=scene.walls.find(item=>item.id===opening.wallId);
        if(wall)record.sweep=Model.doorGeometry(opening,wall);
      }
    }
  };
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  controller.renderLayer=(scene,point,scale,layer)=>{
    let out='';
    const selected=controller.getSelection();
    const attrs=(kind,id,label)=>`data-planner-kind="${kind}" data-planner-id="${escape(id)}" tabindex="0" role="button" aria-label="${escape(label)}"`;
    const line=(segment,color,width,extra='')=>{
      const a=point(segment.x1,segment.y1),b=point(segment.x2,segment.y2);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${width}" ${extra}/>`;
    };
    if(layer==='walls'){
      scene.walls.forEach(wall=>{
        const color=selected?.kind==='wall'&&selected.id===wall.id?'var(--acc)':'var(--svg-wall)';
        const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
        const segments=wall.removed?[{startM:0,endM:length}]:wall.solidSegments;
        const openPartition=wall.removed&&!scene.openings.some(opening=>opening.wallId===wall.id&&opening.kind!=='passage');
        out+=`<g ${attrs('wall',wall.id,wall.exterior?'Exterior wall':'Internal partition')}>`;
        segments.forEach(part=>{
          const a=Model.wallPoint(wall,part.startM),b=Model.wallPoint(wall,part.endM),s={x1:a.x,y1:a.y,x2:b.x,y2:b.y};
          out+=line(s,wall.removed?(openPartition?'var(--ok)':'transparent'):color,wall.removed?1.2:Math.max(1,wall.thicknessM*scale),
            openPartition?'stroke-dasharray="5 4"':'stroke-linecap="butt"');
          out+=line(s,'transparent',Math.max(12,wall.thicknessM*scale),'pointer-events="stroke"');
        });
        out+=`<title>${escape(openPartition?'Open partition: select to inspect':wall.exterior?'Exterior wall':'Internal boundary: structural role unverified')}</title></g>`;
      });
      return out;
    }
    scene.openings.forEach(opening=>{
      const wall=scene.walls.find(item=>item.id===opening.wallId);
      if(!wall||opening.kind==='passage')return;
      const kind=opening.kind==='window'?'window':'door';
      const label=`${kind==='door'?'Door':'Window'}: ${opening.widthM.toFixed(2)} m${kind==='door'?' nominal schematic span':''}`;
      const customSource=[opening.sourceId,...(opening.sourceIds||[])].find(id=>
        root.__roomPlanner?.plan.customOpenings?.some(item=>item.id===id));
      const custom=!!customSource,sourceId=customSource||opening.sourceId;
      out+=`<g ${attrs(kind,opening.id,label)} data-room-id="${escape(sourceId)}">`;
      out+=line(opening.segment,'var(--svg-deep)',Math.max(4,wall.thicknessM*scale+1),'stroke-linecap="butt"');
      if(kind==='window'){
        out+=line(opening.segment,'var(--acc)',4)+line(opening.segment,'var(--svg-on-color)',1.1);
      }else if(opening.kind==='sliding'){
        const a=point(opening.segment.x1,opening.segment.y1),b=point(opening.segment.x2,opening.segment.y2);
        const length=Math.hypot(b.x-a.x,b.y-a.y),tx=(b.x-a.x)/length,ty=(b.y-a.y)/length;
        const nx=-ty*2,ny=tx*2,mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
        out+=`<line x1="${a.x+nx}" y1="${a.y+ny}" x2="${mx+nx+4*tx}" y2="${my+ny+4*ty}" stroke="var(--warn)" stroke-width="3"/>`+
          `<line x1="${mx-nx-4*tx}" y1="${my-ny-4*ty}" x2="${b.x-nx}" y2="${b.y-ny}" stroke="var(--warn)" stroke-width="3"/>`;
      }else{
        const geometry=Model.doorGeometry(opening,wall);
        const hinge=point(geometry.hinge.x,geometry.hinge.y);
        const closed=point(geometry.closedEnd.x,geometry.closedEnd.y),open=point(geometry.openEnd.x,geometry.openEnd.y);
        const radius=geometry.radiusM*scale;
        out+=`<path d="M${closed.x} ${closed.y} A${radius} ${radius} 0 0 ${geometry.arcSweep} ${open.x} ${open.y}" fill="none" stroke="var(--warn)" stroke-width="1.2" pointer-events="none"/>`+
          `<line x1="${hinge.x}" y1="${hinge.y}" x2="${open.x}" y2="${open.y}" stroke="var(--warn)" stroke-width="2"/>`;
      }
      out+=line(opening.segment,selected?.id===opening.id?'var(--acc)':'transparent',12,
        selected?.id===opening.id?'opacity=".2"':'pointer-events="stroke"');
      if(custom){
        const middle=point((opening.segment.x1+opening.segment.x2)/2,(opening.segment.y1+opening.segment.y2)/2);
        out+=`<g data-action="delete" data-room-id="${escape(sourceId)}" role="button" aria-label="Delete ${escape(kind)}">`+
          `<circle cx="${middle.x}" cy="${middle.y}" r="6" fill="var(--panel)" stroke="var(--bad)"/>`+
          `<path d="M${middle.x-2} ${middle.y-2}L${middle.x+2} ${middle.y+2}M${middle.x+2} ${middle.y-2}L${middle.x-2} ${middle.y+2}" stroke="var(--bad)" pointer-events="none"/></g>`;
      }
      out+=`<title>${escape(label)}</title></g>`;
    });
    return out;
  };
  for(const name of ['renderRoomPlanner','roomSaveManualLayout']){
    const original=root[name];
    root[name]=function(...args){const result=original.apply(this,args);scheduleCapture();return result;};
  }
  const solarIds=['sunLatitude','sunLongitude','sunTimeZone','sunDate','sunTime','sunOccurrence'];
  const syncSolar=()=>{
    const latitude=document.getElementById('sunLatitude').valueAsNumber;
    const longitude=document.getElementById('sunLongitude').valueAsNumber;
    const timeZone=document.getElementById('sunTimeZone').value.trim();
    const sunSelection={date:document.getElementById('sunDate').value,time:document.getElementById('sunTime').value,
      occurrence:document.getElementById('sunOccurrence').value};
    if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180)return;
    try{root.HomeSun.calculate({latitude,longitude,timeZone,...sunSelection});}
    catch(error){if(error instanceof root.HomeSun.InputError)return;throw error;}
    const current=controller.getProject().site;
    if(current.latitude!==latitude||current.longitude!==longitude||current.timeZone!==timeZone||
      JSON.stringify(controller.getProject().environment.sunSelection)!==JSON.stringify(sunSelection))
      controller.execute({type:'update-solar-inputs',site:{latitude,longitude,timeZone},sunSelection});
  };
  solarIds.forEach(id=>document.getElementById(id)?.addEventListener('input',syncSolar));
  document.addEventListener('homeplanner:sun-change',syncSolar);
  controller.subscribe(event=>{
    if(event.type==='selection'){
      const focused=document.activeElement,within=focused?.closest?.('#roomPlan');
      const source=within?focused.closest('[data-planner-id],[data-room-id]'):null;
      const semantic=source?.dataset.plannerId,sourceId=source?.dataset.roomId;
      const ctx=root.__roomPlanner;
      if(ctx)roomSvgPlan(ctx.plate,ctx.g,ctx.plan);
      const target=semantic?document.querySelector(`#roomPlan [data-planner-id="${CSS.escape(semantic)}"]`):
        sourceId?document.querySelector(`#roomPlan [data-room-id="${CSS.escape(sourceId)}"][tabindex]`):null;
      target?.focus({preventScroll:true});
      return;
    }
    const site=event.project.site;
    const saved=event.project.environment.sunSelection;
    const values=[String(site.latitude),String(site.longitude),site.timeZone,
      saved?.date||document.getElementById('sunDate').value,
      saved?.time||document.getElementById('sunTime').value,saved?.occurrence||''];
    let changed=false;
    solarIds.forEach((id,i)=>{const el=document.getElementById(id);if(el&&el.value!==values[i]){el.value=values[i];changed=true;}});
    if(changed)document.getElementById('sunLatitude').dispatchEvent(new Event('input',{bubbles:true}));
    const status=document.getElementById('plannerBridgeStatus'),floor=event.project.floors.find(item=>item.id===event.project.activeFloorId);
    if(status&&floor){
      const limit=root.__roomPlanner?.plate.floors;
      status.textContent=`Editing ${floor.name}. ${event.project.floors.length} independent floor layout(s). ${
        Number.isFinite(limit)&&event.project.floors.length>limit?'The floor count exceeds the currently selected regulatory allowance. ':''}Stacked layouts do not establish structural safety or an approved building height.`;
    }
  });
  root.renderRoomPlanner(root.__last);
  controller.refresh();
})(globalThis);
