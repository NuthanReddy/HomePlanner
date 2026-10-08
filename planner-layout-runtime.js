(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerLayoutRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const helpers=[
    'roomEscapeMarkup','roomEdgeSegment','roomStairEntryEdge','roomUsableArea','roomFurnitureResizable',
    'roomOccupiedBounds','roomCarpetModule','roomFindEditable','roomPointerLocal',
    'roomWallProjectionM','roomOpeningDragCandidate','roomMoveCandidate','roomResizeCandidate',
    'roomEditableError','roomCommitEditable','roomDeleteFurniture','roomDeleteOpening',
    'roomRotateFromPlan','roomSaveManualLayout','roomManualHint','renderRoomPlanner','f0','f1'
  ];
  const callbacks=['getElement','getContext','getPlanner','getModel','getLastResult','setView','getInternalWallM','resetLayout'];
  const rendererHelpers=helpers.slice(0,5).concat(['f0','f1']);
  const rendererCallbacks=['getElement','getContext','getPlanner','setView','getInternalWallM'];
  const mounts=new WeakMap();

  function mount(host,adapter,{editing=true}={}){
    if(!host?.ownerDocument||host.namespaceURI!=='http://www.w3.org/2000/svg')
      throw new Error('Layout runtime requires the actual room-plan SVG host.');
    if(mounts.has(host))throw new Error('Destroy the existing layout mount before mounting this SVG again.');
    for(const name of [...(editing?callbacks:rendererCallbacks),...(editing?helpers:rendererHelpers)])
      if(typeof adapter?.[name]!=='function')throw new Error(`Layout runtime adapter ${name} is unavailable.`);
    for(const name of ['FT','M2SF','ROOM_EPS'])
      if(!Number.isFinite(adapter[name])||adapter[name]<=0)throw new Error(`Layout runtime adapter ${name} must be positive.`);
    if(!adapter.ROOM_COLORS||!adapter.DIRNAME)throw new Error('Layout runtime requires the incumbent palette and direction names.');
    const document=host.ownerDocument,browser=document.defaultView;
    if(!browser)throw new Error('Layout runtime requires a browser document.');
    const $=id=>id==='roomPlan'?host:adapter.getElement(id);
    if(editing&&!($('roomEditHint')&&$('roomReset')))
      throw new Error('Layout editing requires actual roomEditHint and roomReset controls.');
    const {
      FT,M2SF,ROOM_EPS,ROOM_COLORS,DIRNAME,
      roomEscapeMarkup,roomEdgeSegment,roomStairEntryEdge,roomUsableArea,roomFurnitureResizable,
      roomOccupiedBounds,roomCarpetModule,roomFindEditable,roomPointerLocal,
      roomWallProjectionM,roomOpeningDragCandidate,roomMoveCandidate,roomResizeCandidate,
      roomEditableError,roomCommitEditable,roomDeleteFurniture,roomDeleteOpening,
      roomRotateFromPlan,roomSaveManualLayout,roomManualHint,renderRoomPlanner,f0,f1
    }=adapter;
    let view=null,destroyed=false,disposeEditing=()=>{};
    const window={
      get HomePlanner(){return adapter.getPlanner();},
      get HomePlannerModel(){return adapter.getModel();},
      get __roomPlanner(){return adapter.getContext();},
      get __last(){return adapter.getLastResult();},
      get __roomView(){return view;},
      set __roomView(value){view=value;adapter.setView(value);}
    };
    const CSS=browser.CSS;
    const requestAnimationFrame=callback=>browser.requestAnimationFrame(callback);
    const cancelAnimationFrame=id=>browser.cancelAnimationFrame(id);
    const listeners=[];
    const on=(target,type,callback,options)=>{
      target.addEventListener(type,callback,options);
      listeners.push(()=>target.removeEventListener(type,callback,options));
    };

function initRoomEditing(){
  const svg=$('roomPlan');
  let drag=null,frame=0,suppressClick=false,preview=null,openingPreview=null,clickTimer=0;
  const clearPreview=()=>{preview?.remove();preview=null;openingPreview?.remove();openingPreview=null;};
  const showPreview=(item,rect,problem)=>{
    if(!window.__roomView?.box)return;
    if(!preview?.isConnected){
      preview=document.createElementNS('http://www.w3.org/2000/svg','rect');
      preview.setAttribute('class','room-move-preview');
      preview.setAttribute('aria-hidden','true');
      svg.appendChild(preview);
    }
    const bounds=item.kind==='room'
      ? roomOccupiedBounds({req:item.room.req,carpet:rect,module:roomCarpetModule(rect)}):rect;
    const box=window.__roomView.box(bounds);
    for(const [key,value] of Object.entries({x:box.x,y:box.y,width:box.w,height:box.h}))
      preview.setAttribute(key,String(value));
    preview.setAttribute('aria-invalid',String(!!problem));
    $('roomEditHint').textContent=problem||'Release to place here. Moving across other objects does not change them; Escape cancels.';
  };
  const showOpeningPreview=(current,candidate)=>{
    const view=window.__roomView,model=window.HomePlannerModel;
    if(!view?.point||!model||!candidate)return;
    openingPreview?.remove();
    openingPreview=document.createElementNS('http://www.w3.org/2000/svg','g');
    openingPreview.setAttribute('class','room-opening-preview');
    openingPreview.setAttribute('aria-hidden','true');
    const start=model.wallPoint(current.wall,candidate.offsetM);
    const end=model.wallPoint(current.wall,candidate.offsetM+candidate.widthM);
    const wallStart=view.point(current.wall.start.x,current.wall.start.y);
    const a=view.point(start.x,start.y),b=view.point(end.x,end.y);
    const dx=a.x-wallStart.x,dy=a.y-wallStart.y,length=Math.max(Math.hypot(dx,dy),1);
    const nx=-dy/length*12,ny=dx/length*12;
    const guideStart={x:wallStart.x+nx,y:wallStart.y+ny},guideEnd={x:a.x+nx,y:a.y+ny};
    openingPreview.innerHTML=`<line class="candidate" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`+
      `<line class="guide" x1="${guideStart.x}" y1="${guideStart.y}" x2="${guideEnd.x}" y2="${guideEnd.y}"/>`+
      `<line class="guide" x1="${wallStart.x}" y1="${wallStart.y}" x2="${guideStart.x}" y2="${guideStart.y}"/>`+
      `<line class="guide" x1="${a.x}" y1="${a.y}" x2="${guideEnd.x}" y2="${guideEnd.y}"/>`+
      `<text x="${(guideStart.x+guideEnd.x)/2}" y="${(guideStart.y+guideEnd.y)/2-5}" text-anchor="middle">${f1(candidate.offsetM/FT)} ft offset</text>`+
      `<text x="${(a.x+b.x)/2}" y="${(a.y+b.y)/2-8}" text-anchor="middle">${f1(candidate.widthM/FT)} ft wide</text>`;
    svg.appendChild(openingPreview);
    $('roomEditHint').textContent=`Release to apply ${f1(candidate.offsetM/FT)} ft offset and ${f1(candidate.widthM/FT)} ft width. Values snap to 0.1 ft; Escape cancels.`;
  };
  const applyPending=()=>{
    frame=0;
    if(!drag||!drag.point)return;
    const pt=drag.point;drag.point=null;
    const ctx=window.__roomPlanner;if(!ctx)return;
    if(drag.kind==='opening'){
      const scene=window.HomePlanner?.getScene();
      const opening=scene?.openings.find(item=>item.id===drag.id);
      const wall=scene?.walls.find(item=>item.id===opening?.wallId);
      if(!opening||!wall)return;
      drag.previewOpening=roomOpeningDragCandidate(opening,wall,pt,drag.action,drag.grabM);
      showOpeningPreview({opening,wall},drag.previewOpening);
      return;
    }
    const item=roomFindEditable(ctx,drag.id);if(!item)return;
    const dx=pt.x-drag.start.x,dy=pt.y-drag.start.y,g=ctx.g,c=drag.rect;
    drag.previewRect=drag.action==='move'?roomMoveCandidate(item,c,dx,dy,g):
      roomResizeCandidate(item,c,dx,dy,g,drag.edge);
    showPreview(item,drag.previewRect,roomEditableError(ctx,item,drag.previewRect));
  };
  on(svg,'pointerdown',ev=>{
    if(ev.button!==0)return;
    const semanticOpening=ev.target.closest?.('[data-planner-kind="door"],[data-planner-kind="window"]');
    const resizeHandle=ev.target.closest?.('[data-opening-resize]');
    if(semanticOpening&&!ev.target.closest?.('[data-action="delete"]')&&
      (semanticOpening.dataset.plannerKind==='door'||resizeHandle)){
      const scene=window.HomePlanner?.getScene(),pt=roomPointerLocal(svg,ev);
      const opening=scene?.openings.find(item=>item.id===semanticOpening.dataset.plannerId);
      const wall=scene?.walls.find(item=>item.id===opening?.wallId);
      if(!opening||!wall||!pt)return;
      const projected=roomWallProjectionM(wall,pt);
      drag={id:opening.id,kind:'opening',
        action:opening.kind==='window'?`resize-window-${resizeHandle.dataset.openingResize}`:'move-door',
        start:pt,screenStart:{x:ev.clientX,y:ev.clientY},threshold:ev.pointerType==='touch'?8:4,
        activated:false,pointerId:ev.pointerId,point:null,signature:window.__roomPlanner?.signature,
        project:window.HomePlanner?.getProject(),grabM:opening.kind==='window'?0:projected-opening.offsetM,
        opening:{offsetM:opening.offsetM,widthM:opening.widthM}};
      try{svg.setPointerCapture(ev.pointerId);}catch(e){}
      ev.preventDefault();ev.stopPropagation();
      return;
    }
    const target=ev.target.closest&&ev.target.closest('[data-room-id][data-action]');
    const ctx=window.__roomPlanner,pt=roomPointerLocal(svg,ev);
    if(!target||!ctx||!pt)return;
    const item=roomFindEditable(ctx,target.dataset.roomId);if(!item)return;
    if(target.dataset.action==='delete'||target.dataset.action==='rotate'){
      ev.stopPropagation();
      return;
    }
    drag={id:item.id,kind:item.kind,action:target.dataset.action,edge:target.dataset.edge,start:pt,
      screenStart:{x:ev.clientX,y:ev.clientY},threshold:ev.pointerType==='touch'?8:4,activated:false,
      rect:{...item.rect},pointerId:ev.pointerId,point:null,signature:ctx.signature,
      project:window.HomePlanner?.getProject()};
    try{svg.setPointerCapture(ev.pointerId);}catch(e){}
    ev.preventDefault();
  });
  on(svg,'click',ev=>{
    if(suppressClick)return;
    const semantic=ev.target.closest?.('[data-planner-id][data-planner-kind]');
    if(semantic&&window.HomePlanner&&!ev.target.closest?.('[data-action="delete"],[data-action="rotate"]')){
      window.HomePlanner.select({kind:semantic.dataset.plannerKind,id:semantic.dataset.plannerId});
      ev.preventDefault();return;
    }
    const target=ev.target.closest&&ev.target.closest('[data-room-id][data-action="delete"],[data-room-id][data-action="rotate"]');
    const ctx=window.__roomPlanner;if(!target||!ctx)return;
    const item=roomFindEditable(ctx,target.dataset.roomId);
    if(item){
      if(target.dataset.action==='delete'){
        if(semantic&&window.HomePlanner&&item.kind==='opening'){
          window.HomePlanner.execute({type:'delete-opening',id:semantic.dataset.plannerId});
          ev.preventDefault();ev.stopPropagation();return;
        }
        if(item.kind==='furniture')roomDeleteFurniture(ctx,item);
        else roomDeleteOpening(ctx,item);
      }
      else roomRotateFromPlan(ctx,item);
    }
    ev.preventDefault();ev.stopPropagation();
  });
  on(svg,'pointermove',ev=>{
    if(!drag||ev.pointerId!==drag.pointerId)return;
    if(!drag.activated){
      if(Math.hypot(ev.clientX-drag.screenStart.x,ev.clientY-drag.screenStart.y)<drag.threshold)return;
      drag.activated=true;svg.classList.add('is-editing');
      if(drag.kind!=='opening')window.HomePlanner?.beginLegacyGesture();
    }
    const pt=roomPointerLocal(svg,ev);if(!pt)return;
    drag.point=pt;
    if(!frame)frame=requestAnimationFrame(applyPending);
    ev.preventDefault();
  });
  const finish=ev=>{
    if(!drag||ev.pointerId!==drag.pointerId)return;
    const cancelled=ev.type==='pointercancel'||ev.type==='lostpointercapture';
    if(frame){cancelAnimationFrame(frame);frame=0;if(!cancelled)applyPending();}
    const ctx=window.__roomPlanner,pointerId=drag.pointerId;
    const ended=drag;
    drag=null;
    clearPreview();
    svg.classList.remove('is-editing');
    try{svg.releasePointerCapture(pointerId);}catch(e){}
    const current=window.HomePlanner?.getProject();
    if(ctx?.signature!==ended.signature||ended.project&&
      (!current||current.id!==ended.project.id||current.activeFloorId!==ended.project.activeFloorId||
        current.revision!==ended.project.revision)){
      if(ended.kind!=='opening')window.HomePlanner?.endLegacyGesture();
      $('roomEditHint').textContent='The project or floor changed during the drag. The preview was discarded.';
      return;
    }
    if(cancelled){
      if(window.HomePlanner&&ended.kind!=='opening')window.HomePlanner.endLegacyGesture(true);
      else if(ended.activated)renderRoomPlanner(window.__last);
      return;
    }
    let changed=false,error='';
    if(ended.activated&&ended.kind==='opening'&&ended.previewOpening&&window.HomePlanner){
      const command={type:ended.action==='move-door'?'update-door':'update-window',id:ended.id,
        offsetM:ended.previewOpening.offsetM};
      if(ended.action!=='move-door')command.widthM=ended.previewOpening.widthM;
      try{
        if(Math.abs(command.offsetM-ended.opening.offsetM)>ROOM_EPS||
          command.widthM!==undefined&&Math.abs(command.widthM-ended.opening.widthM)>ROOM_EPS){
          window.HomePlanner.execute(command);
          changed=true;
        }
      }catch(problem){
        $('roomEditHint').textContent=`Opening change could not be applied: ${problem.message}`;
        return;
      }
    }else if(ended.activated&&ended.previewRect&&ctx){
      const item=roomFindEditable(ctx,ended.id);
      try{
        if(item&&['x','y','w','h'].some(key=>Math.abs(ended.previewRect[key]-ended.rect[key])>ROOM_EPS))
          changed=roomCommitEditable(ctx,item,ended.previewRect,false,false);
      }catch(problem){
        if(window.HomePlanner)window.HomePlanner.endLegacyGesture(true);
        else renderRoomPlanner(window.__last);
        $('roomEditHint').textContent=`Move could not be applied: ${problem.message}`;
        return;
      }
      error=ctx.editError;
    }
    if(changed&&ctx&&ended.kind!=='opening'){roomSaveManualLayout(ctx);roomManualHint();}
    if(ended.activated){
      renderRoomPlanner(window.__last);
      if(ended.kind!=='opening')window.HomePlanner?.endLegacyGesture();
      suppressClick=true;clickTimer=browser.setTimeout(()=>{suppressClick=false;},0);
    }else if(window.HomePlanner){
      if(ended.kind==='opening'){
        const opening=window.HomePlanner.getScene().openings.find(item=>item.id===ended.id);
        window.HomePlanner.select({kind:opening?.kind==='window'?'window':'door',id:ended.id});
      }else window.HomePlanner.selectSource(ended.kind==='room'?'room':ended.kind==='furniture'?'furniture':ended.kind,ended.id);
    }
    if(error)$('roomEditHint').innerHTML=`<b style="color:var(--bad)">Move blocked.</b> ${roomEscapeMarkup(error)}`;
  };
  on(svg,'pointerup',finish);
  on(svg,'pointercancel',finish);
  on(svg,'lostpointercapture',finish);
  on(document,'keydown',event=>{
    if(event.key==='Escape'&&drag&&!event.isComposing){
      finish({type:'pointercancel',pointerId:drag.pointerId});
      event.preventDefault();event.stopPropagation();
    }
  },true);
  on(svg,'focusin',ev=>{
    if(!window.HomePlanner)return;
    const semantic=ev.target.closest?.('[data-planner-id][data-planner-kind]');
    if(semantic){window.HomePlanner.select({kind:semantic.dataset.plannerKind,id:semantic.dataset.plannerId});return;}
    const holder=ev.target.closest?.('[data-room-id]'),ctx=window.__roomPlanner;
    const item=holder&&ctx&&roomFindEditable(ctx,holder.dataset.roomId);
    if(item)window.HomePlanner.selectSource(item.kind,item.id);
  });
  on(svg,'keydown',ev=>{
    const semantic=ev.target.closest?.('[data-planner-id][data-planner-kind]');
    if(semantic&&(ev.key==='Enter'||ev.key===' ')&&window.HomePlanner){
      window.HomePlanner.select({kind:semantic.dataset.plannerKind,id:semantic.dataset.plannerId});
      ev.preventDefault();return;
    }
    if(ev.key==='Escape'&&drag){finish({type:'pointercancel',pointerId:drag.pointerId});ev.preventDefault();return;}
    const holder=ev.target.closest&&ev.target.closest('[data-room-id]');
    const ctx=window.__roomPlanner;if(!holder||!ctx)return;
    const item=roomFindEditable(ctx,holder.dataset.roomId);if(!item)return;
    if((ev.key==='Delete'||ev.key==='Backspace')&&['furniture','opening','wall-opening'].includes(item.kind)){
      if(semantic&&window.HomePlanner&&item.kind==='opening'){
        window.HomePlanner.execute({type:'delete-opening',id:semantic.dataset.plannerId});ev.preventDefault();return;
      }
      if(item.kind==='furniture')roomDeleteFurniture(ctx,item);else roomDeleteOpening(ctx,item);
      ev.preventDefault();return;
    }
    if((ev.key==='r'||ev.key==='R')&&item.kind==='furniture'){
      roomRotateFromPlan(ctx,item);
      ev.preventDefault();return;
    }
    const step=ev.altKey?.05:.15;
    const dx=ev.key==='ArrowLeft'?-step:ev.key==='ArrowRight'?step:0;
    const dy=ev.key==='ArrowUp'?-step:ev.key==='ArrowDown'?step:0;
    if(!dx&&!dy)return;
    if(ev.shiftKey&&item.kind==='furniture'&&!roomFurnitureResizable(item.furniture))return;
    const next=ev.shiftKey
      ? roomResizeCandidate(item,item.rect,dx,dy,ctx.g)
      : roomMoveCandidate(item,item.rect,dx,dy,ctx.g);
    roomCommitEditable(ctx,item,next,true);ev.preventDefault();
  });
  on($('roomReset'),'click',()=>{
    const ctx=window.__roomPlanner;if(!ctx)return;
    if(window.HomePlanner){window.HomePlanner.execute({type:'reset-floor-layout'});return;}
    adapter.resetLayout(ctx);
    renderRoomPlanner(window.__last);
  });
  disposeEditing=()=>{
    if(frame)cancelAnimationFrame(frame);
    browser.clearTimeout(clickTimer);
    if(drag)finish({type:'pointercancel',pointerId:drag.pointerId});
    clearPreview();
  };
}

function roomStairGlyph(stair,g,point){
  const r=stair.carpet,horizontal=r.w>=r.h,length=horizontal?r.w:r.h,across=horizontal?r.h:r.w;
  const entry=roomStairEntryEdge(stair,g),reverse=entry==='E'||entry==='S';
  const map=(u,v)=>horizontal?point(r.x+(reverse?length-u:u),r.y+v):point(r.x+v,r.y+(reverse?length-u:u));
  const line=(a,b,extra='')=>`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${extra}/>`;
  const landing=Math.min(across/2,length*.4),run=length-landing,margin=across*.05;
  let out=`<g data-stair-symbol="${roomEscapeMarkup(stair.req.id)}" pointer-events="none" aria-hidden="true" fill="none" stroke="var(--svg-on-color)" stroke-width="1.1">`;
  out+='<title>Schematic two-flight stair with landing and up direction; tread marks are not a measured riser schedule.</title>';
  out+=line(map(run,margin),map(run,across-margin));
  out+=line(map(length*.04,across/2),map(run,across/2));
  for(let i=1;i<=6;i++){
    const u=run*i/7;
    out+=line(map(u,margin),map(u,across*.46),'data-stair-tread="schematic"');
    out+=line(map(u,across*.54),map(u,across-margin),'data-stair-tread="schematic"');
  }
  const route=[[run*.12,across*.76],[run+landing*.5,across*.76],[run+landing*.5,across*.24],[run*.12,across*.24]].map(([u,v])=>map(u,v));
  out+=`<polyline points="${route.map(p=>`${p.x},${p.y}`).join(' ')}" stroke-width="1.8"/>`;
  out+=line(map(run*.12,across*.24),map(run*.23,across*.15),'stroke-width="1.8"');
  out+=line(map(run*.12,across*.24),map(run*.23,across*.33),'stroke-width="1.8"');
  const up=map(run*.13,across*.88);
  out+=`<text x="${up.x}" y="${up.y}" stroke="none" fill="var(--svg-on-color)" font-size="9" text-anchor="middle">UP</text>`;
  return out+'</g>';
}

function roomSvgPlan(plate,g,plan){
  const svg=$('roomPlan'), VW=800,VH=560,PAD=72;
  const focused=svg.contains(document.activeElement)?document.activeElement.closest('[data-planner-id],[data-room-id]'):null;
  const focusId=focused?.dataset.plannerId,focusSource=focused?.dataset.roomId;
  const showDims=$('showPlanDims')?$('showPlanDims').checked:true;
  if (!g||g.error){
    window.__roomView=null;
    svg.innerHTML=`<rect width="${VW}" height="${VH}" fill="var(--svg-bg)"/>`+
      `<text x="${VW/2}" y="${VH/2}" fill="var(--bad)" text-anchor="middle" font-size="15">${g?g.error:'No floor plate'}</text>`;
    return;
  }
  const effective=window.HomePlanner?.sceneForRender(plate,g,plan,window.__roomPlanner?.cfg||{});
  const angle={N:0,E:90,S:180,W:-90}[plate.frontEdge]||0;
  const rotated=angle===90||angle===-90;
  const balconyZone=g.balconyPolicy&&g.balconyPolicy.zone;
  const minX=Math.min(0,balconyZone?balconyZone.x:0),maxX=Math.max(g.W,balconyZone?balconyZone.x+balconyZone.w:g.W);
  const minY=Math.min(0,balconyZone?balconyZone.y:0),maxY=Math.max(g.D,balconyZone?balconyZone.y+balconyZone.h:g.D);
  const layoutW=maxX-minX,layoutH=maxY-minY,layoutCx=(minX+maxX)/2,layoutCy=(minY+maxY)/2;
  const visualW=rotated?layoutH:layoutW, visualH=rotated?layoutW:layoutH;
  const scale=Math.min((VW-2*PAD)/Math.max(visualW,.01),(VH-2*PAD)/Math.max(visualH,.01));
  const cx=VW/2,cy=VH/2+4,rad=angle*Math.PI/180,co=Math.cos(rad),si=Math.sin(rad);
  const point=(x,y)=>{
    const dx=(x-layoutCx)*scale,dy=(y-layoutCy)*scale;
    return {x:cx+dx*co-dy*si,y:cy+dx*si+dy*co};
  };
  const toLocal=(x,y)=>{
    const dx=x-cx,dy=y-cy;
    return {x:(dx*co+dy*si)/scale+layoutCx,y:(-dx*si+dy*co)/scale+layoutCy};
  };
  const box=r=>{
    const pts=[point(r.x,r.y),point(r.x+r.w,r.y),point(r.x,r.y+r.h),point(r.x+r.w,r.y+r.h)];
    const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
    return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
  };
  window.__roomView={toLocal,point,scale,box};
  const rect=(r,fill,stroke='var(--svg-line)',extra='')=>{
    const b=box(r); return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
  };
  const label=(r,top,bottom,color='var(--svg-on-color)')=>{
    top=roomEscapeMarkup(top);bottom=roomEscapeMarkup(bottom);
    const b=box(r),x=b.x+b.w/2,y=b.y+b.h/2;
    if (b.w<35||b.h<22) return '';
    const second=showDims&&bottom&&b.w>62&&b.h>38?`<text x="${x}" y="${y+10}" text-anchor="middle" fill="var(--svg-soft-text)" font-size="7.2" pointer-events="none">${bottom}</text>`:'';
    return `<text x="${x}" y="${y+(second?-3:3)}" text-anchor="middle" fill="${color}" font-size="${b.w>85?10:8.5}" font-weight="600" pointer-events="none">${top}</text>${second}`;
  };
  const corridorLabel=(r,name,second='')=>{
    const b=box(r);
    if(b.w>=b.h*1.45)return label(r,name,second,'var(--svg-on-color)');
    const x=b.x+b.w/2,y=b.y+b.h/2;
    return `<g transform="rotate(-90 ${x} ${y})"><text x="${x}" y="${y-(second?3:0)}" text-anchor="middle" dominant-baseline="middle" fill="var(--svg-on-color)" font-size="10.5" font-weight="650">${name}</text>`+
      (second?`<text x="${x}" y="${y+8}" text-anchor="middle" dominant-baseline="middle" fill="var(--svg-soft-text)" font-size="7.2">${second}</text>`:'')+`</g>`;
  };
  const resizeHandles=(r,id,name)=>{
    id=roomEscapeMarkup(id);name=roomEscapeMarkup(name);
    return ['N','E','S','W'].map(edge=>{
      const edgeLength=(edge==='N'||edge==='S')?r.w:r.h;
      const hit=roomEdgeSegment(r,edge,edgeLength*.86),h1=point(hit.x1,hit.y1),h2=point(hit.x2,hit.y2);
      const horizontal=Math.abs(h2.x-h1.x)>=Math.abs(h2.y-h1.y);
      return `<line x1="${h1.x}" y1="${h1.y}" x2="${h2.x}" y2="${h2.y}" stroke="transparent" stroke-width="14" class="room-resize" data-room-id="${id}" data-action="resize" data-edge="${edge}" style="cursor:${horizontal?'ns-resize':'ew-resize'}" pointer-events="stroke"><title>Resize ${name} from ${edge} edge</title></line>`;
    }).join('');
  };
  const deleteHandle=(r,id,name)=>{
    id=roomEscapeMarkup(id);name=roomEscapeMarkup(name);
    const b=box(r),x=b.x+b.w-6,y=b.y+6;
    return `<g class="room-delete" data-room-id="${id}" data-action="delete" role="button" aria-label="Delete ${name}">`+
      `<circle cx="${x}" cy="${y}" r="5" fill="var(--svg-surface)" stroke="var(--bad)" stroke-width="1"/>`+
      `<path d="M ${x-1.8} ${y-1.8} L ${x+1.8} ${y+1.8} M ${x+1.8} ${y-1.8} L ${x-1.8} ${y+1.8}" stroke="#ff7b72" stroke-width="1.1" stroke-linecap="round" pointer-events="none"/>`+
      `<title>Delete ${name}</title></g>`;
  };
  const openingDeleteHandle=(segment,id,name)=>{
    id=roomEscapeMarkup(id);name=roomEscapeMarkup(name);
    const p1=point(segment.x1,segment.y1),p2=point(segment.x2,segment.y2);
    const x=(p1.x+p2.x)/2,y=(p1.y+p2.y)/2;
    return `<g class="room-delete" data-room-id="${id}" data-action="delete" role="button" aria-label="Delete ${name}">`+
      `<circle cx="${x}" cy="${y}" r="6" fill="var(--svg-surface)" stroke="var(--bad)" stroke-width="1.2"/>`+
      `<path d="M ${x-2} ${y-2} L ${x+2} ${y+2} M ${x+2} ${y-2} L ${x-2} ${y+2}" stroke="#ff7b72" stroke-width="1.25" stroke-linecap="round" pointer-events="none"/>`+
      `<title>Delete ${name}</title></g>`;
  };
  const rotateHandle=(r,id,name)=>{
    id=roomEscapeMarkup(id);name=roomEscapeMarkup(name);
    const b=box(r),x=b.x+6,y=b.y+6;
    return `<g class="room-rotate" data-room-id="${id}" data-action="rotate" role="button" aria-label="Rotate ${name}">`+
      `<circle cx="${x}" cy="${y}" r="5" fill="var(--svg-surface)" stroke="var(--acc)" stroke-width="1"/>`+
      `<path d="M ${x-2.3} ${y+.4} A 2.7 2.7 0 1 0 ${x-.2} ${y-2.5} M ${x-2.4} ${y+.5} L ${x-2.2} ${y-2.1} L ${x+.2} ${y-.8}" fill="none" stroke="#79c0ff" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`+
      `<title>Rotate ${name} 90 degrees</title></g>`;
  };
  const outer={x:0,y:0,w:g.W,h:g.D};
  const building={x:g.outerX,y:g.outerY,w:g.outerW,h:g.outerD};
  let out=`<rect width="${VW}" height="${VH}" fill="var(--svg-bg)"/>`;
  if(g.balconyPolicy.allowed&&balconyZone){
    out+=rect(balconyZone,'rgba(27,124,131,.08)','#39c5cf','stroke-width="1.2" stroke-dasharray="5 4"');
    out+=label(balconyZone,'Permitted projection',showDims?`max ${f1(g.balconyPolicy.maxDepth/FT)} ft`:'','#39c5cf');
  }
  out+=rect(outer,'var(--svg-surface)','var(--svg-line-strong)','stroke-width="1.5"');
  g.corridors.forEach(c=>{
    const dimension=showDims?`${f1(Math.min(c.w,c.h)/FT)} ft ${c.serviceOverlay?'band · service overlay':'clear'}`:'';
    out+=rect(c,ROOM_COLORS.corridor,'var(--svg-line-strong)');out+=corridorLabel(c,c.label,dimension);
  });
  out+=rect(building,'var(--svg-wall)','var(--svg-muted)','stroke-width="1.3"');
  out+=rect(g.core,'var(--svg-deep)','var(--svg-line-strong)');
  if(plan.placed.length||g.balconies.length){
    (plan.flexSpaces||[]).forEach(f=>{
      const reachable=(plan.circulation&&plan.circulation.reachablePassages||[]).includes(f);
      out+=rect(f,reachable?ROOM_COLORS.corridor:ROOM_COLORS.flex,'var(--svg-line-strong)','stroke-dasharray="4 3"');
      out+=label(f,reachable?'Passage':'Flex',showDims?`${f1(f.w/FT)} × ${f1(f.h/FT)} ft`:'',reachable?'var(--svg-on-color)':'var(--svg-muted)');
    });
  }else{
    const empty=box(g.core);
    out+=`<text x="${empty.x+empty.w/2}" y="${empty.y+empty.h/2-5}" text-anchor="middle" fill="var(--svg-text)" font-size="15" font-weight="650">Start with an empty floor plate</text>`+
      `<text x="${empty.x+empty.w/2}" y="${empty.y+empty.h/2+14}" text-anchor="middle" fill="var(--svg-muted)" font-size="10.5">Add rooms from the Rooms &amp; Services panel</text>`;
  }
  g.balconies.forEach(b=>{
    const attached=b.attachedRoomLabel||'not currently attached';
    const rule=b.projected?`projects ${f1(b.projectionDepth/FT)} ft under Rule 7(a)(xiv)`:'kept inside the statutory envelope';
    const horizontal=b.attachEdge==='N'||b.attachEdge==='S',span=horizontal?b.w:b.h,depth=horizontal?b.h:b.w;
    out+=`<g data-room-id="${b.id}" tabindex="0" role="group" aria-label="${b.label}, ${attached}, draggable and resizable">`;
    out+=rect(b,ROOM_COLORS.balcony,'#39c5cf',`class="room-draggable" data-room-id="${b.id}" data-action="move"`);
    out+=`<title>${b.label}: ${f1(span/FT)} ft span by ${f1(depth/FT)} ft depth, ${attached}; ${rule}. Drag along the facade to move.</title>`;
    out+=label(b,b.label,showDims?`${attached} · ${f1(span/FT)} × ${f1(depth/FT)} ft`:'');
    out+=resizeHandles(b,b.id,b.label);
    out+='</g>';
  });
  plan.placed.slice().sort((a,b)=>Number(!!a.req.reserveFootprint)-Number(!!b.req.reserveFootprint)).forEach(p=>{
    out+=`<g data-room-id="${p.req.id}" tabindex="0" role="group" aria-label="${p.req.label}, draggable and resizable">`;
    if(!effective&&p.req.stairEnclosure!=='open')out+=rect(p.module,'var(--svg-deep)','var(--svg-line-strong)',`class="room-draggable" data-room-id="${p.req.id}" data-action="move"`);
    (p.usableRegions||[p.carpet]).forEach(region=>{
      out+=rect(region,ROOM_COLORS[p.req.type],'none',`class="room-draggable" data-room-id="${p.req.id}" data-action="move"`);
    });
    out+=`<title>${p.req.label}: ${f1(p.carpet.w/FT)} by ${f1(p.carpet.h/FT)} ft. Drag to move.</title>`;
    const labelRegion=(p.usableRegions||[p.carpet]).slice().sort((a,b)=>b.w*b.h-a.w*a.h)[0];
    if(p.req.type==='staircase')out+=roomStairGlyph(p,g,point);
    else if(labelRegion)out+=label(labelRegion,p.req.label,showDims?(p.reservedAreaM2>ROOM_EPS
      ?`${f0(roomUsableArea(p)*M2SF)} sq ft usable`:`${f1(p.carpet.w/FT)} × ${f1(p.carpet.h/FT)} ft`):'');
    out+=resizeHandles(p.carpet,p.req.id,p.req.label);
    out+='</g>';
  });
  const selected=window.HomePlanner?.getSelection();
  const selectedSource=effective?.rooms.find(room=>room.id===selected?.id)?.sourceId;
  for(const passage of plan.stairPassages||[]){
    if(passage.stairId!==selectedSource)continue;
    out+=rect(passage.rect,'none',passage.crossesBoundary?'var(--warn)':'var(--svg-muted)',
      'data-stair-guide="side" stroke-width="1" stroke-dasharray="4 5" pointer-events="none"');
    out+=corridorLabel(passage.rect,'Side guide',`${f1(passage.widthM/FT)} ft`);
  }
  for(const approach of plan.stairApproaches||[]){
    if(approach.stairId!==selectedSource)continue;
    out+=rect(approach.rect,'none','var(--acc)','data-stair-guide="entry" stroke-width="1.2" stroke-dasharray="4 3" pointer-events="none"');
    out+=corridorLabel(approach.rect,'Entry clearance',`${f1(approach.widthM/FT)} ft`);
  }
  if(effective)out+=window.HomePlanner.renderLayer(effective,point,scale,'walls');
  (plan.furniture||[]).forEach(f=>{
    const parent=plan.placed.find(p=>p.req.id===f.roomId),color=f.needsRelocation?'var(--bad)':ROOM_COLORS[f.type]||'#d2a8ff';
    const resizable=roomFurnitureResizable(f);
    out+=`<g class="room-furniture-group" data-room-id="${roomEscapeMarkup(f.id)}" tabindex="0" role="group" aria-label="${roomEscapeMarkup(f.label)}, movable${resizable?' and resizable':''} within ${parent?parent.req.label:'its room'}">`;
    out+=rect(f,color,color,
      `class="room-furniture" data-room-id="${roomEscapeMarkup(f.id)}" data-action="move" fill-opacity=".38" stroke-width="1.3"${f.needsRelocation?' stroke-dasharray="4 3"':''}`);
    if(f.type==='bed'){
      const head=f.headLocal||(f.w<=f.h?'N':'W');
      const depth=Math.min((head==='N'||head==='S'?f.h:f.w)*.16,.38);
      const pillow=head==='N'||head==='S'
        ? {x:f.x+f.w*.16,y:head==='N'?f.y+f.h*.06:f.y+f.h*.94-depth,w:f.w*.68,h:depth}
        : {x:head==='W'?f.x+f.w*.06:f.x+f.w*.94-depth,y:f.y+f.h*.16,w:depth,h:f.h*.68};
      out+=rect(pillow,'rgba(255,255,255,.28)',color,'pointer-events="none"');
    }
    out+=label(f,f.label,showDims?`${f1(f.w/FT)} × ${f1(f.h/FT)} ft`:'',color);
    if(resizable)out+=resizeHandles(f,f.id,f.label);
    out+=`<title>${roomEscapeMarkup(f.label)}: ${f1(f.w/FT)} by ${f1(f.h/FT)} ft. Drag within ${parent?parent.req.label:'the room'}${resizable?'; drag any edge to resize':''}; use the top Edit and Delete actions for properties and removal.</title></g>`;
  });
  const segmentLine=(s,color,width,title)=>{
    const p1=point(s.x1,s.y1),p2=point(s.x2,s.y2);
    return `<g><line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/><title>${title}</title></g>`;
  };
  const slidingDoor=(d)=>{
    const p1=point(d.segment.x1,d.segment.y1),p2=point(d.segment.x2,d.segment.y2);
    const dx=p2.x-p1.x,dy=p2.y-p1.y,len=Math.max(Math.hypot(dx,dy),1),nx=-dy/len*2.2,ny=dx/len*2.2;
    const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
    return `<g><line x1="${p1.x+nx}" y1="${p1.y+ny}" x2="${mx+nx+4*dx/len}" y2="${my+ny+4*dy/len}" stroke="${ROOM_COLORS.door}" stroke-width="3" stroke-linecap="round"/>`+
      `<line x1="${mx-nx-4*dx/len}" y1="${my-ny-4*dy/len}" x2="${p2.x-nx}" y2="${p2.y-ny}" stroke="${ROOM_COLORS.door}" stroke-width="3" stroke-linecap="round"/>`+
      `<line x1="${mx-3*dy/len}" y1="${my+3*dx/len}" x2="${mx+3*dy/len}" y2="${my-3*dx/len}" stroke="var(--svg-on-color)" stroke-width="1.2"/><title>${d.label}: ${f1(d.width/FT)} ft clear opening</title></g>`;
  };
  (!effective&&plan.openings&&plan.openings.windows||[]).forEach(w=>{
    if(w.custom)out+=`<g data-room-id="${w.id}" tabindex="0" role="group" aria-label="${w.label}, deletable">`;
    out+=segmentLine(w.segment,ROOM_COLORS.window,5,`${w.label}: ${f1(w.width/FT)} ft wide, ${w.area.toFixed(2)} m² gross, ${(w.operability*100).toFixed(0)}% openable = ${w.openableArea.toFixed(2)} m² effective`);
    out+=segmentLine(w.segment,'var(--svg-on-color)',1.2,w.label);
    if(w.custom)out+='</g>';
  });
  (!effective&&plan.openings&&plan.openings.doors||[]).forEach(d=>{
    if(d.custom)out+=`<g data-room-id="${d.id}" tabindex="0" role="group" aria-label="${d.label} door, deletable">`;
    out+=d.kind==='balcony-slider'?slidingDoor(d):segmentLine(d.segment,ROOM_COLORS.door,4,
      `${d.label} door to ${d.targetLabel}: ${f1(d.width/FT)} ft wide`);
    if(d.custom)out+='</g>';
  });
  (!effective&&plan.wallOpenings||[]).forEach(o=>{
    out+=`<g data-room-id="${o.id}" tabindex="0" role="group" aria-label="${o.label}, open-plan connection, deletable">`;
    out+=segmentLine(o.segment,o.targetRoomId?'var(--svg-deep)':ROOM_COLORS.corridor,Math.max(7,adapter.getInternalWallM()*scale+4),
      `${o.label}: ${f1(o.width/FT)} ft open connection to ${o.targetLabel}`);
    const p1=point(o.segment.x1,o.segment.y1),p2=point(o.segment.x2,o.segment.y2);
    out+=`<circle cx="${p1.x}" cy="${p1.y}" r="2.2" fill="#f0b429"/><circle cx="${p2.x}" cy="${p2.y}" r="2.2" fill="#f0b429"/>`;
    out+='</g>';
  });
  if(effective)out+=window.HomePlanner.renderLayer(effective,point,scale,'openings');
  if(!effective&&plan.openings&&plan.openings.entrance)
    out+=segmentLine(plan.openings.entrance.segment,'#f0b429',7,`Main entrance: ${f1(plan.openings.entrance.width/FT)} ft wide`);
  const a=point(0,0),b=point(g.W,0),m=point(g.W/2,-.62);
  const roadTextAngle=angle===90||angle===-90?angle:0;
  out+=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--acc)" stroke-width="4"/>`;
  out+=`<text x="${m.x}" y="${m.y+3}" text-anchor="middle" fill="var(--acc)" stroke="var(--svg-bg)" stroke-width="3.5" paint-order="stroke" font-size="10" font-weight="700" transform="rotate(${roadTextAngle} ${m.x} ${m.y+3})">${DIRNAME[plate.frontEdge].toUpperCase()} FRONT / ROAD</text>`;
  out+=`<text x="14" y="${VH-14}" fill="${plate.nonCompliant?'var(--bad)':'var(--svg-muted)'}" font-size="9.5">${plate.label} · ${plate.customSetbacks?'custom setback':'statutory'} envelope ${f1(g.W/FT)} ft × ${f1(g.D/FT)} ft · rectangular dwelling ${f1(g.outerW/FT)} ft × ${f1(g.outerD/FT)} ft${plate.nonCompliant?' · NON-COMPLIANT':''}</text>`;
  out+=`<g transform="translate(${VW-38},38)"><circle r="21" fill="var(--svg-surface)" stroke="var(--svg-line)"/><path d="M 0 -15 L 5 3 L 0 -1 L -5 3 Z" fill="var(--bad)"/><text x="0" y="-23" fill="var(--bad)" font-size="9" text-anchor="middle">N</text><text x="0" y="31" fill="var(--svg-muted)" font-size="8" text-anchor="middle">S</text><text x="29" y="4" fill="var(--svg-muted)" font-size="8" text-anchor="middle">E</text><text x="-29" y="4" fill="var(--svg-muted)" font-size="8" text-anchor="middle">W</text></g>`;
  svg.innerHTML=out;
  const focusTarget=focusId?svg.querySelector(`[data-planner-id="${CSS.escape(focusId)}"]`):
    focusSource?svg.querySelector(`[data-room-id="${CSS.escape(focusSource)}"][tabindex]`):null;
  focusTarget?.focus({preventScroll:true});
}

    if(editing)initRoomEditing();
    const instance=Object.freeze({
      render(context=adapter.getContext()){
        if(destroyed)throw new Error('Layout runtime has been destroyed.');
        roomSvgPlan(context?.plate,context?.g,context?.plan);
      },
      getView:()=>view,
      destroy(){
        if(destroyed)return;
        for(const remove of listeners.splice(0))remove();
        try{disposeEditing();}
        finally{
          destroyed=true;
          mounts.delete(host);
          window.__roomView=null;
        }
      }
    });
    mounts.set(host,instance);
    return instance;
  }
  return Object.freeze({
    mount,requiredHelpers:Object.freeze(helpers),requiredCallbacks:Object.freeze(callbacks),
    rendererHelpers:Object.freeze(rendererHelpers),rendererCallbacks:Object.freeze(rendererCallbacks)
  });
});
