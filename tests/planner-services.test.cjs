const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Model=require('../planner-model.js');
const Projection=require('../planner-projection.js');
const Services=require('../planner-services.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const id=(floor,suffix)=>`${floor}:authored:${suffix}`;
const ref=(floor,suffix)=>({floorId:floor,entityId:id(floor,suffix)});
const at=(floor,x=2,y=2,z=1)=>({kind:'point',floorId:floor,point:{x,y,z}});
const node=(floor,suffix,kind='junction',system='water',circuit='cold')=>({
  id:id(floor,suffix),system,kind,anchor:at(floor),diameterMm:null,invertM:null,circuit,label:null,role:null
});
const route=(floor,suffix,from,to,system='water',circuit='cold')=>({
  id:id(floor,suffix),system,from,to,via:[],diameterMm:null,slope:null,circuit,label:null
});
function project(){
  const p=createFixture('multiple-floors').project;
  for(const floor of p.floors){
    floor.legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
    floor.authored=Model.emptyAuthored();
  }
  p.legacy=copy(p.floors[0].legacy);
  const g=p.floors[0].authored,u=p.floors[1].authored;
  g.serviceNodes=[node('ground','source','supply')];
  u.fixtures=[{id:id('upper','basin'),kind:'basin',anchor:at('upper'),widthM:null,depthM:null,heightM:null}];
  u.serviceNodes=[{...node('upper','port','fixture'),role:'port',
    anchor:{kind:'entity',entityKind:'fixture',...ref('upper','basin')}}];
  g.serviceRoutes=[route('ground','riser',ref('ground','source'),ref('upper','port'))];
  return p;
}
const build=p=>Services.build(Projection.build(p));
const has=(e,code)=>e.issues.includes(code);

test('pure global and CommonJS builds agree, remain frozen, preserve site z and actual riser length',()=>{
  const p=project(),text=JSON.stringify(p),drawing=Projection.build(p),result=Services.build(drawing);
  const sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('../planner-services.js'),'utf8'),sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.HomePlannerServices.build(drawing))),result);
  assert.deepEqual(Object.keys(result),['version','projectId','revision','inputFingerprint','nodes','routes','fixtures','findings','engineeringStatus']);
  assert.equal(result.routes[0].lengthM,3.2);
  assert.equal(result.routes[0].isRiser,true);
  assert.deepEqual(result.nodes[0].anchor,{x:3,y:4,z:1.45});
  assert.equal(result.nodes[1].anchor.z,4.65);
  assert.deepEqual(result.routes[0].points,[result.nodes[0].anchor,result.nodes[1].anchor]);
  assert.equal(result.nodes[0].diameterMm,null);
  assert.equal(result.fixtures[0].widthM,null);
  assert.equal(result.engineeringStatus,'not-assessed');
  assert.ok(Object.isFrozen(result.routes[0].points[0]));
  assert.ok(Object.isFrozen(result.findings));
  assert.equal(JSON.stringify(p),text);
  assert.equal(result.findings.some(f=>f.code==='missing-supply'),false);
});
test('additive optional fields preserve old schema-1 bytes with no backfill',()=>{
  const p=project();
  for(const f of p.floors)for(const r of [...f.authored.serviceNodes,...f.authored.serviceRoutes]){
    delete r.label;delete r.circuit;delete r.role;
  }
  const text=JSON.stringify(p);
  assert.equal(JSON.stringify(Model.parseProject(text)),text);
  const result=build(p);
  assert.equal(result.nodes[0].circuit,null);
  assert.ok(has(result.nodes[0],'unknown-circuit'));
  assert.equal(result.routes[0].label,null);
  assert.equal(JSON.stringify(p),text);
});
test('all valid circuit/role combinations parse and undefined, unknown, mismatched fields reject',()=>{
  for(const [system,circuits] of Object.entries({water:['cold','hot'],waste:['soil','waste','vent'],rain:['storm']})){
    for(const circuit of [null,...circuits]){
      const p=project(),g=p.floors[0].authored;
      g.serviceNodes[0].system=system;g.serviceNodes[0].circuit=circuit;
      g.serviceRoutes[0].system=system;g.serviceRoutes[0].circuit=circuit;
      Model.validateProject(p);
    }
  }
  const roles={fixture:['port','fixture','trap'],junction:['junction','stack','valve','trap','cleanout'],supply:['supply'],outlet:['outlet']};
  for(const [kind,list] of Object.entries(roles))for(const role of [null,...list]){
    const p=project();Object.assign(p.floors[0].authored.serviceNodes[0],{kind,role});Model.validateProject(p);
  }
  const invalid=[['label',undefined],['label',''],['label','x'.repeat(16385)],['label','bad\ntext'],
    ['circuit',undefined],['circuit','soil'],['circuit','electric'],['role',undefined],['role','pump'],['role','port'],
    ['unexpected',null]];
  for(const [field,value] of invalid){
    const p=project();p.floors[0].authored.serviceNodes[0][field]=value;
    assert.throws(()=>Model.validateProject(p),undefined,`${field}: ${value}`);
  }
  for(const [field,value] of [['circuit',undefined],['circuit','storm'],['role',null],['label',undefined]]){
    const p=project();p.floors[0].authored.serviceRoutes[0][field]=value;assert.throws(()=>Model.validateProject(p));
  }
  const p=project();p.floors[0].authored.serviceNodes[0].label='x'.repeat(16384);Model.validateProject(p);
  delete p.floors[0].authored.serviceNodes[0].invertM;assert.throws(()=>Model.validateProject(p));
});
test('via geometry uses ordered 3D supplied positions and invert never moves the axis',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes[0].invertM=20;
  g.serviceRoutes[0].via=[at('ground',5,6,1),at('upper',5,6,1)];
  const result=build(p),r=result.routes[0];
  assert.equal(r.lengthM,13.2);
  assert.equal(r.points.length,4);
  assert.deepEqual(r.via,r.points.slice(1,-1));
  assert.equal(r.points[0].z,1.45);
  assert.ok(has(result.nodes[0],'invert-anchor-conflict'));
  assert.equal(result.nodes[0].invertM,20);
});
test('dangling and wrong-system endpoints retain ordered holes instead of plausible lines',()=>{
  for(const mode of ['missing-node','missing-floor','wrong-system','wrong-kind','missing-host']){
    const p=project(),g=p.floors[0].authored,u=p.floors[1].authored;
    g.serviceRoutes[0].via=[at('ground',3,3,1)];
    if(mode==='missing-node')g.serviceRoutes[0].to.entityId=id('upper','missing');
    if(mode==='missing-floor')g.serviceRoutes[0].to.floorId='missing-floor';
    if(mode==='wrong-system')Object.assign(u.serviceNodes[0],{system:'waste',circuit:'waste'});
    if(mode==='wrong-kind')g.serviceRoutes[0].to=ref('upper','basin');
    if(mode==='missing-host')u.fixtures[0].anchor={kind:'entity',entityKind:'room',floorId:'upper',entityId:'upper:gone'};
    const result=build(p),r=result.routes[0];
    assert.equal(r.points.at(-1),null,mode);assert.equal(r.lengthM,null,mode);
    assert.ok(r.points[0]);assert.ok(r.points[1]);assert.ok(has(r,'incomplete-route'));
  }
});
test('partial null via, missing geometry, cyclic hosts and projection aggregate status stay unresolved',()=>{
  const p=project();p.floors[0].authored.serviceRoutes[0].via=[null];
  let result=build(p);
  assert.equal(result.routes[0].lengthM,null);assert.equal(result.routes[0].points[1],null);
  const drawing=copy(Projection.build(project()));drawing.authored.find(e=>e.collection==='serviceRoutes').anchorStatus='unresolved';
  assert.equal(Services.build(drawing).routes[0].lengthM,null);
  const c=project();c.floors[1].authored.fixtures[0].anchor={kind:'entity',entityKind:'serviceNode',...ref('upper','port')};
  result=build(c);assert.ok(result.findings.some(f=>f.code==='cyclic-host'));assert.equal(result.routes[0].lengthM,null);
  c.floors[1].legacy.context=null;assert.equal(build(c).nodes[1].anchor,null);
});
test('contradictory circuits are not connected; unknown circuits stay unknown',()=>{
  const p=project();p.floors[1].authored.serviceNodes[0].circuit='hot';
  let result=build(p);assert.ok(has(result.routes[0],'circuit-mismatch'));
  assert.ok(has(result.nodes[1],'disconnected-fixture-port'));
  p.floors[1].authored.serviceNodes[0].circuit=null;result=build(p);
  assert.ok(has(result.routes[0],'unknown-endpoint-circuit'));
  assert.equal(result.nodes[1].circuit,null);
  assert.equal(has(result.routes[0],'circuit-mismatch'),false);
});
test('components cannot borrow another component supply/outlet; loops allowed and unknown hubs diagnosed',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes.push(node('ground','lonely','fixture'),node('ground','waste','fixture','waste','soil'));
  let result=build(p);
  assert.equal(result.findings.filter(f=>f.code==='missing-supply').length,1);
  assert.equal(result.findings.filter(f=>f.code==='missing-outlet').length,1);
  g.serviceRoutes.push(route('ground','return',ref('upper','port'),ref('ground','source')));
  result=build(p);assert.equal(result.findings.find(f=>f.code==='network-cycle').severity,'info');
  assert.ok(has(result.routes[1],'supply-direction-conflict'));
  g.serviceNodes[0].circuit=null;g.serviceRoutes[0].circuit=null;g.serviceRoutes[1].circuit=null;
  g.serviceNodes.push(node('ground','hot','junction','water','hot'));
  g.serviceRoutes.push(route('ground','hot-run',ref('ground','source'),ref('ground','hot'),'water',null));
  result=build(p);assert.ok(result.findings.some(f=>f.code==='mixed-circuit-component'));
});
test('ports are explicit fixture references and unusual roles/equipment are warnings not invented devices',()=>{
  const p=project(),u=p.floors[1].authored;
  u.serviceNodes[0].anchor=at('upper');
  u.fixtures[0].kind='equipment';
  u.serviceNodes.push({...node('upper','trap','junction'),role:'trap'});
  const result=build(p);
  assert.ok(has(result.nodes[1],'unhosted-fixture-port'));
  assert.ok(has(result.nodes[2],'unusual-service-purpose'));
  assert.ok(has(result.fixtures[0],'fixture-without-service-port'));
  assert.ok(has(result.fixtures[0],'unsupported-equipment'));
});
test('zero length, coincident cross-floor levels and diagonal cross-floor proposals are explicit',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceRoutes[0].via=[at('ground')];
  assert.ok(has(build(p).routes[0],'zero-length-segment'));
  p.floors[1].legacy.context.floorElevationM=.45;
  assert.ok(has(build(p).routes[0],'inter-floor-level-conflict'));
  p.floors[1].authored.fixtures[0].anchor=at('upper',5,6,3);
  const result=build(p);
  assert.ok(result.routes[0].isRiser);assert.ok(has(result.routes[0],'inter-floor-proposal'));
  assert.equal(result.routes[0].lengthM,Math.hypot(3,4,2));
});
test('systems options select only networks, preserve all fixtures and reject unsupported options',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes.push(node('ground','rain','outlet','rain','storm'));
  const drawing=Projection.build(p);
  assert.equal(Services.build(drawing,{systems:['water','waste']}).nodes.length,2);
  assert.equal(Services.build(drawing,{systems:[]}).fixtures.length,1);
  assert.ok(Services.build(drawing).findings.some(f=>f.code==='rain-coordination-deferred'));
  for(const options of [null,[],{systems:undefined},{systems:['water','water']},{systems:['drain']},{flow:true}])
    assert.throws(()=>Services.build(drawing,options));
  assert.throws(()=>Services.build({version:1,kind:'other'}));
});
test('actual bridge edits, undo/redo, JSON, duplication and external floor namespaces preserve circuits',()=>{
  const controller=controllerFor(project()),before=controller.getProject().floors[0].authored.serviceRoutes[0];
  const changed={...copy(before),label:'ground:literal label',circuit:'hot'};
  controller.execute({type:'upsert-authored',collection:'serviceRoutes',value:changed});
  const fingerprint=controller.inputFingerprint();
  controller.undo();assert.deepEqual(controller.getProject().floors[0].authored.serviceRoutes[0],before);
  controller.redo();assert.equal(controller.inputFingerprint(),fingerprint);
  const imported=controllerFor(Model.createProject());imported.importProject(controller.exportProject());
  assert.deepEqual(imported.getProject().floors[0].authored.serviceRoutes[0],changed);
  controller.execute({type:'add-floor',copyFromId:'ground'});
  const duplicate=controller.getProject().floors.find(f=>f.id===controller.getProject().activeFloorId);
  const r=duplicate.authored.serviceRoutes[0];
  assert.equal(r.circuit,'hot');assert.equal(r.label,'ground:literal label');
  assert.equal(r.from.floorId,duplicate.id);assert.equal(r.from.entityId,id(duplicate.id,'source'));
  assert.deepEqual(r.to,ref('upper','port'));
  assert.equal(duplicate.authored.serviceNodes[0].circuit,'cold');
  assert.equal(controller.getProject().floors[0].authored.serviceRoutes[0].from.floorId,'ground');
  controller.execute({type:'add-floor',copyFromId:'upper'});
  const portFloor=controller.getProject().floors.find(f=>f.id===controller.getProject().activeFloorId);
  assert.equal(portFloor.authored.serviceNodes[0].role,'port');
  assert.equal(portFloor.authored.serviceNodes[0].circuit,'cold');
  assert.deepEqual(portFloor.authored.serviceNodes[0].anchor,
    {kind:'entity',entityKind:'fixture',floorId:portFloor.id,entityId:id(portFloor.id,'basin')});
});
test('replacement and floor movement invalidate fingerprints while old outputs remain immutable',()=>{
  const controller=controllerFor(project()),old=Services.build(controller.getDrawingScene());
  const replacement=copy(controller.getProject());
  replacement.floors[0].authored.serviceNodes[0].diameterMm=25;
  controller.replaceProject(replacement);
  const next=Services.build(controller.getDrawingScene());
  assert.equal(next.revision,old.revision);assert.notEqual(next.inputFingerprint,old.inputFingerprint);
  assert.equal(old.nodes[0].diameterMm,null);
  controller.execute({type:'update-floor',id:'ground',patch:{heightM:4}});
  const moved=Services.build(controller.getDrawingScene());
  assert.equal(moved.routes[0].lengthM,4);assert.notEqual(moved.inputFingerprint,next.inputFingerprint);
});
test('floor references use exact pair identity even for delimiter-containing identifiers',()=>{
  const p=project(),g=p.floors[0].authored;
  g.serviceNodes.push({...node('ground','other'),id:id('ground','x|upper:authored:port')});
  g.serviceRoutes[0].to={floorId:'upper',entityId:id('ground','x|upper:authored:port')};
  assert.ok(has(build(p).routes[0],'dangling-node'));
});
test('axis coordination uses actual structural box extent and actual wall aperture solids',()=>{
  const p=project(),g=p.floors[0].authored;
  g.structural=[{id:id('ground','slab'),kind:'slab',anchors:[at('ground',2,2,2)],
    widthM:2,depthM:2,heightM:.2,material:null}];
  assert.ok(build(p).findings.some(f=>f.code==='possible-penetration-conflict'&&f.entityIds.includes(id('ground','slab'))));
  g.structural[0].heightM=null;
  assert.ok(build(p).findings.some(f=>f.code==='coordination-geometry-unknown'));
  const d=copy(Projection.build(project())),r=d.authored.find(e=>e.collection==='serviceRoutes');
  r.anchors=[{status:'resolved',point:{x:-1,y:0,z:1}},{status:'resolved',point:{x:1,y:0,z:1}}];
  d.scenes=[{floorId:'ground',coordinateSpace:'site-local',walls:[{id:'wall',start:{x:0,y:-2},end:{x:0,y:2},
    baseM:0,thicknessM:.2,solidSections:[{startM:0,endM:4,sillM:0,heightM:2}]}]}];
  assert.ok(Services.build(d).findings.some(f=>f.code==='possible-penetration-conflict'));
  d.scenes[0].walls[0].solidSections=[{startM:0,endM:4,sillM:1.5,heightM:.5}];
  assert.equal(Services.build(d).findings.some(f=>f.code==='possible-penetration-conflict'),false);
});
test('resource limits fail explicitly with no silent truncation; long graphs avoid recursion',()=>{
  const d=copy(Projection.build(project()));d.scenes=[];
  const n=d.authored.find(e=>e.collection==='serviceNodes');
  d.authored=Array.from({length:10001},(_,i)=>({...n,record:{...n.record,id:`n${i}`}}));
  assert.throws(()=>Services.build(d),/10000 nodes/);
  const r=copy(Projection.build(project())).authored.find(e=>e.collection==='serviceRoutes');
  d.authored=[{...r,record:{...r.record,via:Array(100000).fill(null)}}];
  assert.throws(()=>Services.build(d),/100000 route segments/);
  d.authored=Array.from({length:5000},(_,i)=>({...n,record:{...n.record,id:`n${i}`}}));
  for(let i=1;i<5000;i++)d.authored.push({...r,record:{...r.record,id:`r${i}`,
    from:{floorId:'ground',entityId:`n${i-1}`},to:{floorId:'ground',entityId:`n${i}`}}});
  assert.equal(Services.build(d).nodes.length,5000);
});
test('route, fixture and coordination budgets fail explicitly rather than returning a filtered partial result',()=>{
  const d=copy(Projection.build(project())),r=d.authored.find(e=>e.collection==='serviceRoutes'),
    fixture=d.authored.find(e=>e.collection==='fixtures');
  for(const entry of [r,fixture]){
    const tooMany={...d,authored:Array(10001).fill(entry)};
    assert.throws(()=>Services.build(tooMany,{systems:[]}),/limit exceeded/);
  }
  const wall={id:'w',start:{x:20,y:20},end:{x:21,y:20},baseM:0,thicknessM:.1,
    solidSections:[{startM:0,endM:1,sillM:0,heightM:2}]};
  d.scenes=[{floorId:'ground',coordinateSpace:'site-local',walls:Array(1001).fill(wall)}];
  d.authored.push(...Array.from({length:999},(_,i)=>({...r,record:{...r.record,id:`r${i}`}})));
  assert.throws(()=>Services.build(d),/1000000 axis\/solid/);
});
test('finite accumulation precision loss is diagnosed, not returned as an exact geometric length',()=>{
  const d=copy(Projection.build(project())),r=d.authored.find(e=>e.collection==='serviceRoutes');
  r.record.via=[at('ground')];
  r.anchors=[{status:'resolved',point:{x:0,y:0,z:0}},
    {status:'resolved',point:{x:1e9,y:0,z:0}},
    {status:'resolved',point:{x:1e9,y:1e-10,z:0}}];
  const output=Services.build(d).routes[0];
  assert.equal(output.lengthM,null);assert.ok(has(output,'geometry-precision-limit'));
  assert.ok(has(output,'zero-length-segment'));
});
