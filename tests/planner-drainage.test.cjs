const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Model=require('../planner-model.js');
const Projection=require('../planner-projection.js');
const Services=require('../planner-services.js');
const Drainage=require('../planner-drainage.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const id=(floor,suffix)=>`${floor}:authored:${suffix}`;
const ref=(floor,suffix)=>({floorId:floor,entityId:id(floor,suffix)});
const at=(floor,x,y,z=2)=>({kind:'point',floorId:floor,point:{x,y,z}});
const node=(suffix,x,y,invertM=2,extra={})=>({
  id:id('ground',suffix),system:'waste',kind:'junction',anchor:at('ground',x,y),diameterMm:100,invertM,circuit:'soil',...extra
});
const route=(suffix,from,to,extra={})=>({
  id:id('ground',suffix),system:'waste',from:ref('ground',from),to:ref('ground',to),via:[],diameterMm:100,
  slope:.02,circuit:'soil',clearanceM:.05,...extra
});
function project(){
  const p=createFixture('multiple-floors').project;
  for(const f of p.floors){
    f.legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
    f.authored=Model.emptyAuthored();
  }
  p.legacy=copy(p.floors[0].legacy);
  const g=p.floors[0].authored;
  g.serviceNodes=[node('a',0,0,2,{kind:'fixture',role:'floor-trap'}),
    node('b',10,0,1.8,{kind:'outlet',role:'outfall'})];
  g.serviceRoutes=[route('ab','a','b')];
  return p;
}
const build=p=>Drainage.build(Projection.build(p));
const has=(e,code)=>e.issues.includes(code);
const codes=(r,code)=>r.findings.filter(f=>f.code===code);
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function clearWalls(p){
  const drawing=copy(Projection.build(p));
  for(const s of drawing.scenes)s.walls=[];
  return drawing;
}

test('exact frozen JSON contract, classic global parity and 10 m at .02 gives .2 m independent invert fall',()=>{
  const p=project(),before=JSON.stringify(p),d=Projection.build(p),result=Drainage.build(d),r=result.routes[0];
  assert.deepEqual(Object.keys(result),['version','projectId','revision','inputFingerprint','nodes','routes','findings','engineeringStatus']);
  assert.equal(r.profile.horizontalLengthM,10);assert.equal(r.lengthM,10);
  approx(r.profile.measuredFallM,.2);assert.equal(r.profile.expectedFallM,.2);
  approx(r.profile.measuredGradient,.02);assert.equal(r.profile.profileComplete,true);
  assert.equal(r.profile.invertFallAvailable,true);assert.equal(codes(result,'slope-intent-mismatch').length,0);
  assert.deepEqual(r.profile.invertsM,[2,1.8]);assert.equal(r.points[0].z,2.45);
  assert.deepEqual(r.points,Services.build(d).routes[0].points);
  assert.equal(result.engineeringStatus,'not-assessed');
  assert.ok(Object.isFrozen(r.profile.segments[0]));assert.ok(Object.isFrozen(result.nodes[0].anchor));
  assert.equal(JSON.stringify(p),before);
  const sandbox={HomePlannerServices:Services};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-drainage.js'),'utf8'),sandbox);
  assert.deepEqual(copy(sandbox.HomePlannerDrainage.build(d)),result);
  assert.equal(result.inputFingerprint,d.inputFingerprint);
  const noDependency={};vm.runInNewContext(fs.readFileSync(require.resolve('../planner-drainage.js'),'utf8'),noDependency);
  assert.throws(()=>noDependency.HomePlannerDrainage.build(d),/Load HomePlannerServices/);
});
test('schema additions validate without backfill and preserve exact old JSON records',()=>{
  const p=project();
  for(const r of [...p.floors[0].authored.serviceNodes,...p.floors[0].authored.serviceRoutes]){
    delete r.role;delete r.circuit;delete r.clearanceM;
  }
  const before=JSON.stringify(p);
  assert.equal(JSON.stringify(Model.parseProject(before)),before);
  const result=build(p);assert.equal(result.nodes[0].groundM,null);assert.equal(result.nodes[1].discharge,null);
  assert.deepEqual(result.routes[0].viaInvertsM,[]);assert.equal(JSON.stringify(p),before);
});
test('optional levels, claimed sources, discharge and via invert validation are strict and additive',()=>{
  const p=project(),g=p.floors[0].authored;
  Object.assign(g.serviceNodes[1],{groundM:-1,finishedFloorM:0,levelSource:'surveyed',
    levelReference:'unverified survey',accessRadiusM:0,discharge:{kind:'sewer',reference:null}});
  Object.assign(g.serviceRoutes[0],{via:[null],viaInvertsM:[null],slopeSource:'engineer-provided',slopeReference:'claimed calculation'});
  const before=JSON.stringify(p);assert.equal(JSON.stringify(Model.parseProject(before)),before);
  for(const source of [null,'assumed','surveyed','engineer-provided']){
    g.serviceNodes[1].levelSource=source;g.serviceRoutes[0].slopeSource=source;Model.validateProject(p);
  }
  for(const kind of ['sewer','surface-outfall','soakaway','septic','reuse','other']){
    g.serviceNodes[1].discharge.kind=kind;Model.validateProject(p);
  }
  const invalidNodes={groundM:[undefined,Infinity,'1'],finishedFloorM:[undefined,NaN],levelSource:[undefined,'verified'],
    levelReference:[undefined,'','bad\ntext'],accessRadiusM:[undefined,-.1],discharge:[undefined,{}, {kind:'sewer'},
      {kind:'auto',reference:null},{kind:'sewer',reference:undefined},{kind:'sewer',reference:null,capacity:2}],outerDiameterMm:[120]};
  for(const [field,values] of Object.entries(invalidNodes))for(const value of values){
    const q=copy(p);q.floors[0].authored.serviceNodes[1][field]=value;
    assert.throws(()=>Model.validateProject(q),undefined,field);
  }
  for(const discharge of [null,{kind:'sewer',reference:null}]){
    const q=copy(p);q.floors[0].authored.serviceNodes[0].discharge=discharge;assert.throws(()=>Model.validateProject(q));
  }
  const invalidRoutes={viaInvertsM:[undefined,null,[],[1,2],[undefined],[Infinity],Array(1)],
    slopeSource:[undefined,'authored'],slopeReference:[undefined,''],clearanceM:[undefined,-1],slope:[-.02]};
  for(const [field,values] of Object.entries(invalidRoutes))for(const value of values){
    const q=copy(p);q.floors[0].authored.serviceRoutes[0][field]=value;assert.throws(()=>Model.validateProject(q),undefined,field);
  }
});
test('new roles require explicit compatible base kind; unusual systems remain warnings',()=>{
  for(const [kind,roles] of Object.entries({fixture:['floor-trap','gully-trap','roof-outlet'],junction:['chamber','downpipe'],outlet:['outfall']})){
    for(const role of roles){
      const p=project(),n=p.floors[0].authored.serviceNodes[0];Object.assign(n,{kind,role});Model.validateProject(p);
      n.kind='supply';assert.throws(()=>Model.validateProject(p));
    }
  }
  for(const role of ['roof-outlet','downpipe']){
    const p=project(),n=p.floors[0].authored.serviceNodes[0];
    Object.assign(n,{kind:role==='downpipe'?'junction':'fixture',role});
    assert.ok(has(build(p).nodes[0],'unusual-service-purpose'));
    n.system='rain';n.circuit='storm';
    assert.equal(has(build(p).nodes[0],'unusual-service-purpose'),false);
  }
  const p=project();Object.assign(p.floors[0].authored.serviceNodes[0],{system:'water',circuit:'cold'});
  assert.ok(has(Services.build(Projection.build(p)).nodes[0],'unusual-service-purpose'));
});
test('ordered unequal-floor via stations use independent levels, no interpolation across unknown inverts',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceRoutes[0].via=[at('upper',2,0,3),at('ground',8,0,0)];
  g.serviceRoutes[0].viaInvertsM=[1.96,null];
  let r=build(p).routes[0];
  assert.deepEqual(r.profile.stationsM,[0,2,8,10]);
  assert.deepEqual(r.profile.invertsM,[2,1.96,null,1.8]);
  assert.ok(r.points[1].z>6);assert.notEqual(r.lengthM,10);
  approx(r.profile.segments[0].measuredFallM,.04);
  assert.equal(r.profile.segments[1].measuredFallM,null);
  assert.equal(r.profile.segments[2].measuredFallM,null);
  approx(r.profile.measuredFallM,.2);assert.equal(r.profile.invertFallAvailable,true);
  assert.equal(r.profile.invertProfileComplete,false);assert.equal(r.profile.profileComplete,false);
  assert.ok(has(r,'incomplete-invert-profile'));
  delete g.serviceRoutes[0].viaInvertsM;r=build(p).routes[0];
  assert.deepEqual(r.profile.invertsM,[2,null,null,1.8]);
  assert.ok(r.profile.segments.every(s=>s.measuredFallM===null));
  g.serviceRoutes[0].viaInvertsM=[1.96,1.84];r=build(p).routes[0];
  assert.equal(r.profile.profileComplete,true);approx(r.profile.segments[1].measuredGradient,.02);
});
test('unknown plan spans null subsequent stations but do not erase independently known endpoint fall',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceRoutes[0].via=[at('ground',2,0),null,at('ground',8,0)];
  g.serviceRoutes[0].viaInvertsM=[1.96,1.9,1.84];
  const r=build(p).routes[0];
  assert.deepEqual(r.profile.stationsM,[0,2,null,null,null]);
  assert.equal(r.profile.horizontalLengthM,null);assert.equal(r.profile.expectedFallM,null);
  assert.equal(r.profile.invertFallAvailable,true);approx(r.profile.measuredFallM,.2);
  assert.equal(r.profile.invertProfileComplete,true);assert.equal(r.profile.profileComplete,false);
  assert.equal(r.profile.axisLengthM,null);assert.equal(r.profile.segments[1].measuredGradient,null);
  approx(r.profile.segments[3].measuredGradient,.02);
});
test('reverse and zero falls, mismatch and zero slope are numerical warnings only',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[1].invertM=2.2;
  let r=build(p).routes[0];
  approx(r.profile.measuredFallM,-.2);assert.ok(has(r,'reverse-fall'));assert.ok(has(r,'slope-intent-mismatch'));
  assert.equal(r.slope,.02);
  g.serviceNodes[1].invertM=2;g.serviceRoutes[0].slope=0;r=build(p).routes[0];
  assert.ok(has(r,'zero-fall'));assert.ok(has(r,'zero-slope-intent'));assert.equal(r.profile.measuredGradient,0);
  g.serviceRoutes[0].slope=.02;g.serviceNodes[1].invertM=1.8-5e-7;
  assert.equal(has(build(p).routes[0],'slope-intent-mismatch'),false);
  g.serviceRoutes[0].via=[at('ground',5,0)];g.serviceRoutes[0].slope=null;
  g.serviceNodes[1].invertM=2.2;r=build(p).routes[0];
  assert.equal(r.profile.invertProfileComplete,false);
  assert.ok(r.profile.segments.every(s=>s.measuredFallM===null));assert.ok(has(r,'reverse-fall'));
});
test('pure vertical drop and coincident axis never produce infinite gradients',()=>{
  for(const z of [0,2]){
    const p=project(),g=p.floors[0].authored;
    g.serviceNodes[1].anchor=at('ground',0,0,z);
    const r=build(p).routes[0];
    assert.equal(r.profile.horizontalLengthM,0);assert.equal(r.profile.measuredGradient,null);
    assert.equal(r.profile.segments[0].measuredGradient,null);assert.equal(r.profile.segments[0].verticalDrop,true);
    assert.equal(r.profile.expectedFallM,null);assert.ok(has(r,'vertical-drop'));
    if(z===2)assert.ok(has(r,'zero-length-segment'));else assert.equal(r.profile.axisLengthM,2);
  }
});
test('vent intent is retained but excluded from gravity; unknown and mixed circuits cannot become safe',()=>{
  for(const circuit of ['vent',null]){
    const p=project(),g=p.floors[0].authored;
    for(const e of [...g.serviceNodes,...g.serviceRoutes])e.circuit=circuit;
    const r=build(p).routes[0];
    assert.equal(r.profile.measuredFallM,null);assert.equal(r.profile.expectedFallM,null);
    assert.equal(r.profile.segments[0].measuredFallM,null);
    assert.equal(r.gravityStatus,circuit==='vent'?'not-applicable':'unknown');
  }
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[1].circuit=null;
  g.serviceNodes.push(node('vent',5,3,1,{circuit:'vent'}));
  g.serviceRoutes.push(route('mixed','b','vent',{circuit:null}));
  const result=build(p);
  assert.ok(codes(result,'mixed-circuit-component').length);
  assert.equal(result.routes[0].gravityStatus,'unknown');assert.equal(result.routes[0].profile.measuredFallM,null);
});
test('storm and sanitary are separate; only drainage output rephrases deferred rain scope',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes.push(node('roof',1,1,5,{system:'rain',circuit:'storm',kind:'fixture',role:'roof-outlet'}),
    node('storm-out',5,1,null,{system:'rain',circuit:'storm',kind:'outlet',role:'outfall'}));
  g.serviceRoutes.push(route('storm','roof','storm-out',{system:'rain',circuit:'storm'}));
  const d=Projection.build(p),result=Drainage.build(d);
  assert.ok(codes(Services.build(d),'rain-coordination-deferred').length);
  assert.equal(codes(result,'rain-coordination-deferred').length,0);
  assert.notEqual(result.nodes[0].componentId,result.nodes[2].componentId);
  assert.equal(result.routes[1].system,'rain');assert.equal(result.routes[1].profile.measuredFallM,null);
  assert.equal(Drainage.build(d,{systems:['rain']}).routes.length,1);
  assert.equal(Drainage.build(d,{systems:[]}).nodes.length,0);
  for(const options of [null,[],{systems:undefined},{systems:['water']},{systems:['rain','rain']},{capacity:true}])
    assert.throws(()=>Drainage.build(d,options));
  assert.throws(()=>Drainage.build({version:1,kind:'other'}));
  g.serviceRoutes[0].to=ref('ground','storm-out');
  assert.ok(has(build(p).routes[0],'service-system-mismatch'));
});
test('each component owns its unknown destination/outlet level context, never borrowing a sewer',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[1].discharge={kind:'sewer',reference:'claimed tie-in'};
  g.serviceNodes.push(node('isolated',4,4,null),node('unknown-out',5,5,null,{kind:'outlet'}));
  const result=build(p);
  assert.equal(codes(result,'unknown-discharge-destination').length,2);
  assert.equal(codes(result,'unknown-outfall-level').length,2);
  for(const f of codes(result,'unknown-outfall-level')){
    assert.ok(f.componentId);assert.notEqual(f.componentId,result.nodes[0].componentId);
  }
  assert.ok(codes(result,'discharge-not-assessed').length);
  assert.equal(result.nodes[3].discharge,null);
});
test('ground/floor comparisons are supplied differences, never inferred cover or verified provenance',()=>{
  const p=project(),g=p.floors[0].authored;
  Object.assign(g.serviceNodes[0],{groundM:3,finishedFloorM:2.9,levelSource:'engineer-provided',levelReference:'claim',accessRadiusM:1});
  const result=build(p),n=result.nodes[0];
  assert.equal(n.invertBelowGroundM,1);approx(n.finishedFloorAboveGroundM,-.1);
  assert.equal('coverDepthM' in n,false);assert.ok(has(n,'cover-depth-not-assessed'));
  assert.ok(has(n,'finished-floor-below-ground'));assert.ok(has(n,'unverified-level-provenance'));
  assert.equal(result.nodes[1].groundM,null);assert.equal(result.nodes[1].finishedFloorM,null);
  assert.equal(result.nodes[1].invertBelowGroundM,null);
  g.serviceNodes[0].groundM=1;assert.ok(has(build(p).nodes[0],'invert-above-ground'));
});
test('property check uses actual plot, accepts setback routing, checks all via vertices and diagonals',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[0].anchor=at('ground',-.5,-1.5);
  g.serviceNodes[1].anchor=at('ground',10.5,9.5);
  let d=Projection.build(p),r=Drainage.build(d).routes[0];
  assert.ok(r.points[0].x<d.scenes[0].floor.x);
  assert.equal(has(r,'outside-property-boundary'),false);
  g.serviceRoutes[0].via=[at('ground',15,5)];r=build(p).routes[0];
  assert.ok(has(r,'outside-property-boundary'));
  d=clearWalls(p);delete d.scenes[0].plot;
  assert.ok(has(Drainage.build(d).routes[0],'unknown-plot-boundary'));
});
test('actual 3D route minimum distance distinguishes near misses, exact crossing, parallel and degenerate segments',()=>{
  for(const [z,expect] of [[2,true],[2.19,true],[2.21,false],[5,false]]){
    const p=project(),g=p.floors[0].authored;
    g.serviceNodes.push(node('c',5,-1,0,{system:'water',circuit:'cold',anchor:at('ground',5,-1,z)}),
      node('d',5,1,0,{system:'water',circuit:'cold',anchor:at('ground',5,1,z)}));
    g.serviceRoutes.push(route('water','c','d',{system:'water',circuit:'cold'}));
    const result=Drainage.build(clearWalls(p),{systems:['waste']});
    assert.equal(codes(result,'potential-route-envelope-conflict').length>0,expect,`z=${z}`);
    assert.equal(result.routes.length,1);
    if(expect)assert.equal(codes(result,'potential-route-envelope-conflict')[0].entityRefs[1].entityId,id('ground','water'));
  }
  for(const positions of [[[2,.1],[8,.1]],[[5,0],[5,0]]]){
    const p=project(),g=p.floors[0].authored;
    g.serviceNodes.push(node('c',...positions[0]),node('d',...positions[1]));
    g.serviceRoutes.push(route('second','c','d'));
    const result=Drainage.build(clearWalls(p));
    assert.ok(codes(result,'potential-route-envelope-conflict').length);
    assert.ok(result.routes.every(r=>has(r,'potential-route-envelope-conflict')));
  }
});
test('unknown or zero clearance/diameter is incomplete rather than a safe envelope default',()=>{
  for(const patch of [{clearanceM:null},{clearanceM:0},{diameterMm:null}]){
    const p=project(),g=p.floors[0].authored;
    g.serviceNodes.push(node('c',5,-1),node('d',5,1));
    g.serviceRoutes.push(route('second','c','d',patch));
    const result=Drainage.build(clearWalls(p));
    assert.equal(codes(result,'potential-route-envelope-conflict').length,0);
    assert.ok(codes(result,'route-pair-clearance-unknown').length);
    if(patch.clearanceM===null)assert.ok(has(result.routes[1],'unknown-clearance'));
  }
});
test('shared riser candidates require actual vertical overlapping segments, not diagonal cross-floor flags',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[0].anchor=at('ground',2,2,0);g.serviceNodes[1].anchor=at('ground',2,2,4);
  g.serviceNodes.push(node('c',2,2,0,{anchor:at('ground',2,2,2)}),node('d',2,2,0,{anchor:at('ground',2,2,5)}));
  g.serviceRoutes.push(route('second','c','d',{clearanceM:null}));
  assert.ok(codes(Drainage.build(clearWalls(p)),'shared-riser-zone-needs-review').length);
  g.serviceNodes[3].anchor=at('ground',3,2,5);
  assert.equal(codes(Drainage.build(clearWalls(p)),'shared-riser-zone-needs-review').length,0);
  g.serviceNodes[3].anchor=at('ground',2,2,5);g.serviceNodes[2].anchor=at('ground',2,2,4.1);
  assert.equal(codes(Drainage.build(clearWalls(p)),'shared-riser-zone-needs-review').length,0);
});
test('wall/member access is circle versus oriented footprint, explicitly plan-only across unknown heights',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[0].accessRadiusM=.6;
  g.structural=[{id:id('ground','member'),kind:'column',anchors:[at('upper',.7,0,20)],
    widthM:.4,depthM:.4,heightM:null,material:null}];
  let result=Drainage.build(clearWalls(p));
  assert.ok(codes(result,'access-plan-candidate').some(f=>f.entityIds.includes(id('ground','member'))));
  assert.ok(has(result.nodes[0],'access-review-plan-only'));
  g.serviceNodes[0].accessRadiusM=.4;result=Drainage.build(clearWalls(p));
  assert.equal(codes(result,'access-plan-candidate').length,0);
  const d=clearWalls(p);g.serviceNodes[0].accessRadiusM=.6;
  d.authored.find(e=>e.collection==='serviceNodes').record.accessRadiusM=.6;
  d.scenes[0].walls=[{id:'wall',start:{x:1.5,y:0},end:{x:1.5,y:5},baseM:30,thicknessM:.2,
    solidSections:[{startM:0,endM:5,sillM:0,heightM:2}]}];
  result=Drainage.build(d);assert.ok(codes(result,'access-plan-candidate').some(f=>f.entityIds.includes('wall')));
  assert.equal(codes(result,'possible-penetration-conflict').length,0);
});
test('core axis coordination still checks represented solids on intermediate floors',()=>{
  const p=project(),g=p.floors[0].authored;
  g.structural=[{id:id('ground','wall-box'),kind:'column',anchors:[at('ground',5,0,0)],
    widthM:.4,depthM:.4,heightM:3,material:null}];
  assert.ok(codes(build(p),'possible-penetration-conflict').some(f=>f.entityIds.includes(id('ground','wall-box'))));
});
test('bridge history, new metadata JSON, copied references and delete/undo retain authored intent',()=>{
  const p=project(),g=p.floors[0].authored;
  Object.assign(g.serviceNodes[1],{groundM:4,finishedFloorM:4.2,accessRadiusM:.7,levelSource:'surveyed',
    levelReference:'ground:literal claim',discharge:{kind:'soakaway',reference:'unverified site study'}});
  Object.assign(g.serviceRoutes[0],{via:[at('ground',4,0),at('upper',6,0)],
    viaInvertsM:[1.92,null],slopeSource:'assumed',slopeReference:'ground:literal slope'});
  const controller=controllerFor(p),before=copy(controller.getProject().floors[0].authored);
  controller.execute({type:'upsert-authored',collection:'serviceRoutes',value:{...copy(g.serviceRoutes[0]),slope:.03}});
  controller.undo();assert.deepEqual(controller.getProject().floors[0].authored,before);
  controller.redo();assert.equal(controller.getProject().floors[0].authored.serviceRoutes[0].slope,.03);
  const exported=controller.exportProject();
  const imported=controllerFor(Model.createProject());imported.importProject(exported);
  assert.deepEqual(imported.getProject().floors[0].authored,controller.getProject().floors[0].authored);
  controller.execute({type:'add-floor',copyFromId:'ground'});
  const duplicate=controller.getProject().floors.find(f=>f.id===controller.getProject().activeFloorId);
  const r=duplicate.authored.serviceRoutes[0],n=duplicate.authored.serviceNodes[1];
  assert.equal(r.from.floorId,duplicate.id);assert.equal(r.to.entityId,id(duplicate.id,'b'));
  assert.equal(r.via[0].floorId,duplicate.id);assert.equal(r.via[1].floorId,'upper');
  assert.deepEqual(r.viaInvertsM,[1.92,null]);assert.deepEqual(n.discharge,g.serviceNodes[1].discharge);
  assert.equal(n.levelReference,'ground:literal claim');assert.equal(n.groundM,4);
  controller.execute({type:'delete-authored',collection:'serviceNodes',id:n.id});
  let result=Drainage.build(controller.getDrawingScene());
  assert.ok(has(result.routes.find(e=>e.id===r.id),'dangling-node'));
  assert.equal(result.routes.find(e=>e.id===r.id).profile.invertFallAvailable,false);
  controller.undo();result=Drainage.build(controller.getDrawingScene());
  assert.deepEqual(result.nodes.find(e=>e.id===n.id).discharge,g.serviceNodes[1].discharge);
});
test('same-revision replacement changes fingerprint; captured output remains detached and immutable',()=>{
  const controller=controllerFor(project()),old=Drainage.build(controller.getDrawingScene()),p=copy(controller.getProject());
  p.floors[0].authored.serviceNodes[0].groundM=15;controller.replaceProject(p);
  const next=Drainage.build(controller.getDrawingScene());
  assert.equal(next.revision,old.revision);assert.notEqual(next.inputFingerprint,old.inputFingerprint);
  assert.equal(old.nodes[0].groundM,null);assert.equal(next.nodes[0].groundM,15);
});
test('explicit aggregate failure and accumulation precision keep horizontal totals unknown',()=>{
  const d=clearWalls(project()),r=d.authored.find(e=>e.collection==='serviceRoutes');
  r.anchorStatus='unresolved';assert.equal(Drainage.build(d).routes[0].profile.horizontalLengthM,null);
  r.anchorStatus='resolved';r.record.via=[at('ground',1,1)];
  r.anchors=[{status:'resolved',point:{x:0,y:0,z:0}},{status:'resolved',point:{x:1e9,y:0,z:0}},
    {status:'resolved',point:{x:1e9,y:1e-10,z:0}}];
  const result=Drainage.build(d).routes[0];
  assert.equal(result.profile.horizontalLengthM,null);assert.ok(has(result,'profile-precision-limit'));
});
test('route/segment density fails before quadratic work beyond explicit comparison budget',()=>{
  const d=clearWalls(project()),r=d.authored.find(e=>e.collection==='serviceRoutes');
  d.authored=d.authored.filter(e=>e.collection!=='serviceRoutes');
  for(let i=0;i<1001;i++)d.authored.push({...r,record:{...r.record,id:id('ground',`dense${i}`)}});
  assert.throws(()=>Drainage.build(d),/1000000 coordination comparisons/);
  assert.equal(Drainage.build(d,{systems:[]}).routes.length,0);
  const segmentDense=clearWalls(project()),base=segmentDense.authored.find(e=>e.collection==='serviceRoutes');
  const other={...copy(base),record:{...copy(base.record),id:id('ground','other')}};
  for(const e of [base,other]){
    e.record.via=Array(1000).fill(null);e.anchors=Array(1002).fill({status:'resolved',point:{x:1,y:1,z:1}});
  }
  segmentDense.authored.push(other);
  assert.throws(()=>Drainage.build(segmentDense),/1000000 coordination comparisons/);
});
test('access footprint work uses the same explicit bound and fails without a partial result',()=>{
  const d=clearWalls(project()),n=d.authored.find(e=>e.collection==='serviceNodes');
  d.authored=d.authored.filter(e=>e.collection!=='serviceNodes');
  for(let i=0;i<1001;i++)d.authored.push({...n,record:{...n.record,id:id('ground',`access${i}`),accessRadiusM:.1}});
  d.scenes[0].walls=Array.from({length:1000},(_,i)=>({
    id:`wall${i}`,start:{x:20,y:20},end:{x:21,y:20},baseM:0,thicknessM:.1,
    solidSections:[{startM:0,endM:1,sillM:0,heightM:2}]
  }));
  assert.throws(()=>Drainage.build(d),/1000000 coordination comparisons/);
});
