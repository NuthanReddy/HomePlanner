const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Regions=require('../planner-regions.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

function load(){
  const ctx=vm.createContext({
    RoomRegions:Regions,ROOM_EPS:1e-7,ROOM_PASSAGE_MIN:0.9,ROOM_DOOR_WIDTH:0.9,ROOM_DOOR_MIN:0.68,
    INT_WALL:0.12,EXT_WALL:0.25,FT:0.3048,
    roomIdentityState:{},roomManualLayouts:new Map(),
    roomClamp:(value,min,max)=>Math.min(max,Math.max(min,value)),
    roomLocalEdgeGlobal:edge=>edge,f1:value=>value.toFixed(1),window:{},
    roomHardAdjacencyValid:()=>true,roomAssignBalconies(){},
    roomDirectionPenalty:()=>0,roomAdjacencyPenalty:()=>0,roomRolePenalty:()=>0,
    roomBalconyAttachments:()=>[],
    roomCirculationAnalysis:()=>({inaccessible:[]}),
    roomPlanOpenings:()=>({doors:[],windows:[]}),roomApplySavedOpenings(){},roomPlanFurniture(){},
    roomSvgPlan(){},roomManualHint(){},roomSaveManualLayout(){},
    roomEditBlocked:(context,message)=>{context.editError=message;return false;},
    $:()=>({innerHTML:''})
  });
  for(const name of ['deriveRoomGeometry','roomRectInside','roomIntersects','roomCarpetModule',
    'roomIntersectionRect','roomIntersectionArea','roomMoveCandidate','roomResizeCandidate',
    'roomOccupiedBounds','roomPlacementConflict','roomModuleInside','roomModuleClear',
    'roomServiceKeepClear','roomServicePlacementRank','roomStairEntryEdge','roomStairApproach','roomSharedOpening',
    'roomPruneFree','roomSubtractFree','roomScoreLess','roomPackAttempt',
    'roomUsableArea','roomReservationCuts','roomReservationHostOpenings','roomStairPassage','roomFlexSpaces','roomRecalculatePlan',
    'roomEditableError','roomCommitManual','roomFurnitureClearances','roomApplyManualLayout',
    'roomStableIds','makeRoomRequests','roomOrder']){
    const source=html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(source,`Missing ${name}`);vm.runInContext(source[0],ctx);
  }
  return ctx;
}
function geometry(api){
  const range={minW:2,minD:3,maxW:2,maxD:3};
  return api.deriveRoomGeometry({width:20,depth:18,frontEdge:'N'},{
    corridors:{front:1,back:1,side:1},counts:{staircase:1,lift:1,balcony:0},
    staircase:range,lift:range,bed:range,side:'right',balconyDepth:1
  },[]);
}
function room(api,id,type,carpet,reserveFootprint=false){
  return {req:{id,type,label:id,reserveFootprint},carpet,module:api.roomCarpetModule(carpet)};
}
const item=p=>({kind:'room',room:p,rect:p.carpet});
function plan(placed){return {placed,openings:{doors:[],windows:[]},wallOpenings:[],furniture:[]};}

test('staircases and lifts do not expand or occupy the outside corridor strip',()=>{
  const api=load(),g=geometry(api);
  assert.equal(g.S,1);assert.equal(g.serviceZone,null);
  assert.equal(g.outerW,19);
  assert.ok(g.corridors.every(corridor=>!corridor.serviceOverlay));
});

test('staircases move by the requested X/Y displacement rather than snapping to corners',()=>{
  const api=load(),g=geometry(api),p=room(api,'stair-1','staircase',{x:4,y:5,w:2,h:3},true);
  const next=api.roomMoveCandidate(item(p),p.carpet,0.35,0.65,g);
  close(next.x,4.35);close(next.y,5.65);
  assert.equal(api.roomModuleInside(api.roomCarpetModule(next),g,p.req),true);
  const context={g,plan:plan([p]),cfg:{},signature:'move'};
  assert.equal(api.roomCommitManual(context,p,next,false,false),true);
  close(p.carpet.x,4.35);close(p.carpet.y,5.65);
});

test('a kitchen can jump across an occupied rectangle to a valid destination',()=>{
  const api=load(),g=geometry(api);
  const kitchen=room(api,'kitchen-1','kitchen',{x:2,y:5,w:2,h:2});
  const bedroom=room(api,'bed-1','bedroom',{x:6,y:5,w:3,h:3});
  const context={g,plan:plan([kitchen,bedroom]),cfg:{},signature:'jump'};
  const before=plain(context.plan.placed);
  const middle={...kitchen.carpet,x:6};
  assert.match(api.roomEditableError(context,item(kitchen),middle),/free destination/);
  assert.deepEqual(plain(context.plan.placed),before,'Preview validation must not move objects');
  const destination={...kitchen.carpet,x:11};
  assert.equal(api.roomEditableError(context,item(kitchen),destination),null);
  assert.equal(api.roomCommitManual(context,kitchen,destination,false,false),true);
  close(kitchen.carpet.x,11);
  assert.deepEqual(plain(bedroom.carpet),before[1].carpet);
});

test('services may reserve ordinary rooms, but ordinary room overlaps and service clashes stay invalid',()=>{
  const api=load(),g=geometry(api);
  const host=room(api,'bed-1','bedroom',{x:2,y:3,w:10,h:10});
  const lift=room(api,'lift-1','lift',{x:4,y:5,w:2,h:3},true);
  const stairs=room(api,'stair-1','staircase',{x:8,y:8,w:2,h:3},true);
  const context={g,plan:plan([host,lift,stairs]),cfg:{},signature:'reserve'};
  assert.equal(api.roomEditableError(context,item(lift),lift.carpet),null);
  assert.equal(api.roomEditableError(context,item(stairs),stairs.carpet),null);
  assert.match(api.roomEditableError(context,item(stairs),lift.carpet),/another lift or staircase/);
  const kitchen=room(api,'kitchen-1','kitchen',{x:5,y:6,w:2,h:2});
  assert.match(api.roomEditableError(context,item(kitchen),kitchen.carpet),/free destination/);
});

test('reserved full-wall footprints reduce host usable area exactly once',()=>{
  const api=load(),g=geometry(api);
  const host=room(api,'living-1','living',{x:2,y:3,w:10,h:10});
  const lift=room(api,'lift-1','lift',{x:4,y:5,w:2,h:3},true);
  const stairs=room(api,'stair-1','staircase',{x:8,y:8,w:2,h:3},true);
  const result=api.roomRecalculatePlan(plan([host,lift,stairs]),g);
  const footprint=(2+2*0.12)*(3+2*0.12);
  close(host.usableAreaM2,100-2*footprint);
  close(host.reservedAreaM2,2*footprint);
  close(result.habitableCarpetArea,host.usableAreaM2);
  close(result.serviceArea,12);
  close(result.carpetArea,100-2*footprint+12);
  for(const region of host.usableRegions){
    assert.equal(Regions.intersection(region,api.roomOccupiedBounds(lift)),null);
    assert.equal(Regions.intersection(region,api.roomOccupiedBounds(stairs)),null);
  }
});

test('moving a service restores the old host area and reserves the new host footprint',()=>{
  const api=load(),g=geometry(api);
  const a=room(api,'bed-1','bedroom',{x:2,y:3,w:5,h:10});
  const b=room(api,'kitchen-1','kitchen',{x:9,y:3,w:5,h:10});
  const lift=room(api,'lift-1','lift',{x:3,y:5,w:2,h:3},true);
  const context={g,plan:plan([a,b,lift]),cfg:{},signature:'host-change'};
  api.roomRecalculatePlan(context.plan,g);
  assert.ok(a.reservedAreaM2>0);assert.equal(b.reservedAreaM2,0);
  assert.equal(api.roomCommitManual(context,lift,{...lift.carpet,x:10},false,false),true);
  close(a.usableAreaM2,50);close(a.reservedAreaM2,0);
  assert.ok(b.reservedAreaM2>0);
});

test('contained service openings target a real host usable region instead of a corridor anchor',()=>{
  const api=load(),g=geometry(api);
  const host=room(api,'living-1','living',{x:2,y:3,w:10,h:10});
  const staircase=room(api,'stair-1','staircase',{x:5,y:6,w:2,h:3},true);
  const layout=api.roomRecalculatePlan(plan([host,staircase]),g);
  const openings=api.roomReservationHostOpenings(staircase,host,layout);
  assert.equal(new Set(openings.map(opening=>opening.edge)).size,4);
  assert.ok(openings.every(opening=>opening.targetRoomId==='living-1'&&opening.width<=0.9&&opening.width>=0.68));
  for(const opening of openings){
    const s=opening.segment;
    assert.ok(Math.abs(s.x2-s.x1)>0||Math.abs(s.y2-s.y1)>0);
  }
  assert.deepEqual(plain(api.roomReservationHostOpenings(staircase,{...host,usableRegions:[]},layout)),[]);
});

test('an along-stair passage is adjacent, contained and not counted as additional floor area',()=>{
  const api=load(),g=geometry(api);
  const host=room(api,'living-1','living',{x:2,y:3,w:10,h:10});
  const stair=room(api,'stair-1','staircase',{x:4,y:5,w:3,h:2},true);
  stair.req.passageWidthM=0.9144;
  const layout=api.roomRecalculatePlan(plan([host,stair]),g);
  assert.equal(layout.stairPassages.length,1);
  const passage=layout.stairPassages[0],footprint=api.roomOccupiedBounds(stair);
  assert.equal(api.roomRectInside(passage.rect,g.core),true);
  close(passage.rect.w,footprint.w);close(passage.rect.h,0.9144);
  assert.equal(api.roomIntersects(passage.rect,footprint),false);
  close(layout.carpetArea,100-host.reservedAreaM2+6);
  assert.ok(!api.roomFurnitureClearances(layout,host,'bed').some(rect=>api.roomIntersects(rect,passage.rect)),
    'The advisory side guide must not become a furniture exclusion strip');
  assert.equal(layout.stairApproaches.length,1);
  assert.ok(api.roomFurnitureClearances(layout,host,'bed').some(rect=>api.roomIntersects(rect,layout.stairApproaches[0].rect)));
});

test('a passage that cannot fit is reported without moving the staircase or other rooms',()=>{
  const api=load(),g=geometry(api),stair=room(api,'stair-1','staircase',{x:4,y:5,w:3,h:2},true);
  stair.req.passageWidthM=100;
  const before=plain(stair.carpet),layout=api.roomRecalculatePlan(plan([stair]),g);
  assert.deepEqual(plain(layout.stairPassages),[]);
  assert.match(layout.stairPassageIssues[0],/no along-stair passage/);
  assert.deepEqual(stair.carpet,before);
});

test('moving a lift cannot cover the bounded landing approach',()=>{
  const api=load(),g=geometry(api);
  const stair=room(api,'stair-1','staircase',{x:6,y:5,w:3,h:2},true);
  const lift=room(api,'lift-1','lift',{x:12,y:11,w:1.5,h:1.7},true);
  stair.req.passageWidthM=0.9144;
  const layout=api.roomRecalculatePlan(plan([stair,lift]),g);
  const passage=plain(layout.stairApproaches[0]),before=plain(layout);
  const context={g,plan:layout,cfg:{},signature:'blocked-passage'};
  const blocked={...lift.carpet,x:passage.rect.x+0.12,y:passage.rect.y+0.12};
  assert.equal(api.roomIntersects(api.roomOccupiedBounds({...lift,carpet:blocked,module:api.roomCarpetModule(blocked)}),
    api.roomOccupiedBounds(stair)),false,'The lift itself is beyond the staircase, not overlapping it');
  assert.match(api.roomEditableError(context,item(lift),blocked),/block a stair landing approach/);
  assert.equal(api.roomCommitManual(context,lift,blocked,false,false),false);
  assert.deepEqual(plain(layout),before);
  assert.deepEqual(plain(layout.stairApproaches[0]),passage);
});

test('a lift wall alone may not intrude into the passage even when its carpet remains clear',()=>{
  const api=load(),g=geometry(api);
  const stair=room(api,'stair-1','staircase',{x:6,y:5,w:3,h:2},true);
  stair.req.passageWidthM=0.9144;
  const lift=room(api,'lift-1','lift',{x:12,y:11,w:1.5,h:1.7},true);
  stair.req.stairEntryEdge='W';
  const layout=api.roomRecalculatePlan(plan([stair,lift]),g),passage=layout.stairApproaches[0].rect;
  const blocked={x:passage.x-1.5-0.04,y:passage.y+0.2,w:1.5,h:1.7};
  assert.equal(api.roomIntersects(blocked,passage),false);
  const context={g,plan:layout,cfg:{}};
  assert.match(api.roomEditableError(context,item(lift),blocked),/block a stair landing approach/);
  assert.equal(api.roomEditableError(context,item(lift),{...blocked,x:passage.x-1.5-0.12}),null,
    'Touching the passage edge with the full wall footprint is allowed');
});

test('a generic circulation flex-space does not lock the entire room behind a staircase',()=>{
  const api=load(),g=geometry(api);
  const stair=room(api,'stair-1','staircase',{x:9,y:2,w:2,h:5},true);
  const lift=room(api,'lift-1','lift',{x:5,y:9,w:1.5,h:1.7},true);
  const access={x:8.88,y:7.12,w:2.24,h:8.5};
  const layout=api.roomRecalculatePlan(plan([stair,lift]),g);
  layout.circulation={accessByRoom:new Map([['stair-1',{targetType:'passage',target:access}]])};
  const before=plain(layout.placed),context={g,plan:layout,cfg:{}};
  const blocked={...lift.carpet,x:9,y:10};
  assert.equal(api.roomEditableError(context,item(lift),blocked),null);
  assert.deepEqual(plain(layout.placed),before);
  assert.equal(api.roomEditableError(context,item(lift),lift.carpet),null,'The lift may stand beside the shared passage');
});

test('resizing a lift into the staircase access passage is rejected without altering dimensions',()=>{
  const api=load(),g=geometry(api);
  const stair=room(api,'stair-1','staircase',{x:9,y:2,w:2,h:5},true);
  stair.req.passageWidthM=0.9144;stair.req.stairEntryEdge='S';
  const lift=room(api,'lift-1','lift',{x:6.5,y:7.3,w:1.5,h:1.7},true);
  const access={x:8.88,y:7.12,w:2.24,h:8.5};
  const layout=api.roomRecalculatePlan(plan([stair,lift]),g);
  layout.circulation={accessByRoom:new Map([['stair-1',{targetType:'passage',target:access}]])};
  const before=plain(lift.carpet),context={g,plan:layout,cfg:{},signature:'resize-passage'};
  const candidate=api.roomResizeCandidate(item(lift),lift.carpet,1,0,g,'E');
  assert.match(api.roomEditableError(context,item(lift),candidate),/block a stair landing approach/);
  assert.equal(api.roomCommitManual(context,lift,candidate,false,false),false);
  assert.deepEqual(lift.carpet,before);
});

test('adding a lift prefers the side of the bounded stair entry without moving retained rooms',()=>{
  const api=load(),g=geometry(api);
  const host=room(api,'bed-1','bedroom',{x:2,y:3,w:6,h:10});
  const stair=room(api,'stair-1','staircase',{x:9,y:2,w:2,h:5},true);
  stair.req.passageWidthM=0.9144;stair.req.stairEntryEdge='S';
  const kept=[host,stair],before=plain(kept);
  const access=api.roomStairApproach(stair,g);
  const req={id:'lift-1',type:'lift',label:'Lift 1',reserveFootprint:true,seq:1,priority:1,
    range:{minW:1.5,maxW:1.5,minD:1.7,maxD:1.7}};
  const result=api.roomPackAttempt(g,[req],'preferred','large',0,kept,[access]);
  const lift=result.placed.find(p=>p.req.id==='lift-1'),bounds=api.roomOccupiedBounds(lift);
  assert.ok(lift);
  assert.equal(result.unmet.length,0);
  assert.equal(api.roomIntersects(bounds,access.rect),false);
  assert.ok(api.roomSharedOpening(bounds,access.rect,0.9,0.68,0.001),
    'The lift must be alongside the shared passage, with enough facing edge for an opening');
  assert.ok(bounds.y<access.rect.y+access.rect.h&&bounds.y+bounds.h>access.rect.y);
  assert.ok(Math.min(Math.abs(bounds.x+bounds.w-access.rect.x),Math.abs(bounds.x-access.rect.x-access.rect.w))<1e-7);
  assert.deepEqual(plain(kept),before);
  for(const retained of kept)
    assert.deepEqual(plain(result.placed.find(p=>p.req.id===retained.req.id).carpet),plain(retained.carpet));
});

test('stairs are proposed before lifts even when the requested lift is larger',()=>{
  const api=load();
  const requests=[
    {id:'lift-1',type:'lift',seq:0,priority:1,range:{minW:5,minD:5}},
    {id:'stair-1',type:'staircase',seq:1,priority:1,range:{minW:2,minD:3}}
  ];
  for(const mode of ['large','service','privacy'])
    assert.deepEqual(plain(api.roomOrder(requests,mode).map(req=>req.id)),['stair-1','lift-1']);
});

test('removed staircases do not leave stale passage obstacles behind',()=>{
  const api=load(),g=geometry(api),lift=room(api,'lift-1','lift',{x:5,y:9,w:1.5,h:1.7},true);
  const layout={...plan([lift]),accessPassages:[{stairId:'removed-stair',rect:{...lift.carpet}}]};
  assert.deepEqual(plain(api.roomServiceKeepClear(layout,g)),[]);
  assert.equal(api.roomEditableError({g,plan:layout},item(lift),lift.carpet),null);
});

test('move and resize containment includes the whole service-wall footprint',()=>{
  const api=load(),g=geometry(api),p=room(api,'stair-1','staircase',{x:4,y:5,w:2,h:3},true);
  for(const [dx,dy] of [[-100,-100],[100,100]]){
    const next=api.roomMoveCandidate(item(p),p.carpet,dx,dy,g);
    const bounds=api.roomOccupiedBounds({...p,carpet:next,module:api.roomCarpetModule(next)});
    assert.equal(api.roomRectInside(bounds,g.core),true);
  }
  for(const [edge,dx,dy] of [['W',-100,0],['E',100,0],['N',0,-100],['S',0,100]]){
    const next=api.roomResizeCandidate(item(p),p.carpet,dx,dy,g,edge);
    assert.equal(api.roomModuleInside(api.roomCarpetModule(next),g,p.req),true);
  }
  assert.equal(api.roomModuleInside(api.roomCarpetModule({...p.carpet,x:g.core.x+0.01}),g,p.req),false);
});

test('interior service positions survive manual-layout restoration without an anchor',()=>{
  const api=load(),g=geometry(api),range={minW:2,minD:3,maxW:2,maxD:3};
  const cfg={counts:{living:0,bedroom:0,kitchen:0,pooja:0,bathroom:0,lift:0,staircase:1},
    living:range,bed:range,kitchen:range,pooja:range,bathroom:range,lift:range,staircase:range};
  const generated=room(api,'stair-1','staircase',{x:g.core.x+0.12,y:g.core.y+0.12,w:2,h:3},true);
  api.roomManualLayouts.set('saved',{preserveRooms:true,rooms:{'stair-1':{x:4.35,y:5.65,w:2,h:3}}});
  const restored=api.roomApplyManualLayout(plan([generated]),g,'saved',cfg);
  close(restored.placed[0].carpet.x,4.35);close(restored.placed[0].carpet.y,5.65);
});

test('legacy outside staircase positions remain recorded but cannot produce an outside preview',()=>{
  const api=load(),g=geometry(api),generated=room(api,'stair-1','staircase',{x:4,y:5,w:2,h:3},true);
  const saved={rooms:{'stair-1':{x:19,y:5,w:2,h:3}}},before=plain(saved);
  api.roomManualLayouts.set('old',saved);
  const restored=api.roomApplyManualLayout(plan([generated]),g,'old');
  assert.equal(api.roomModuleInside(restored.placed[0].module,g,generated.req),true);
  assert.match(restored.manualWarning,/saved lift or staircase position no longer fits/);
  assert.deepEqual(saved,before);
});

test('drag handlers preview without committing intermediate collision positions',()=>{
  const source=html.match(/function initRoomEditing\([^]*?\n\}/)[0];
  const previewPart=source.slice(source.indexOf('const applyPending'),source.indexOf("svg.addEventListener('pointerdown'"));
  assert.match(previewPart,/drag\.previewRect=/);
  assert.doesNotMatch(previewPart,/roomCommitEditable/);
  assert.match(source,/roomCommitEditable\(ctx,item,ended\.previewRect/);
  assert.doesNotMatch(source,/roomKeyboardStairMove/);
});
