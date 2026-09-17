const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Model=require('../planner-model.js');
const Projection=require('../planner-projection.js');
const Structure=require('../planner-structure.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const anchor=(floorId='ground',x=2,y=2,z=0)=>({kind:'point',floorId,point:{x,y,z}});
function record(kind='column',extra={}){
  return {id:`ground:authored:${kind}`,kind,anchors:kind==='beam'||kind==='grid'?
    [anchor(),anchor('ground',6,2)]:[anchor()],
    widthM:kind==='grid'?null:.4,depthM:kind==='grid'?null:.6,
    material:kind==='grid'?null:'Concrete (unverified)',...extra};
}
function project(records=[]){
  const doc=createFixture('multiple-floors').project;
  doc.floors[0].heightM=4.1;
  doc.floors[0].legacy.context.plate.sitePlot={x:-1,y:-2,w:16,h:16};
  doc.floors[1].legacy.context.plate.sitePlot={x:-4,y:-3,w:16,h:16};
  doc.legacy=copy(doc.floors[0].legacy);
  doc.floors[0].authored=Model.emptyAuthored();
  doc.floors[0].authored.structural=records;
  return doc;
}
function entry(r,floorId='ground',points=r.anchors.map(a=>a?.point)){
  return {collection:'structural',floorId,record:r,anchorStatus:points.every(Boolean)?'resolved':'unresolved',
    anchors:points.map(point=>point?{status:'resolved',point}:{status:'unresolved',point:null,code:'missing-host'})};
}
function scene(floorId='ground',floorElevationM=0){
  return {floorId,floorElevationM,coordinateSpace:'site-local',plot:{x:0,y:0,w:20,h:20},walls:[],openings:[],unresolvedOpenings:[]};
}
function drawing(entries=[],scenes=[scene()]){
  return {version:1,kind:'DrawingScene',projectId:'test',revision:4,inputFingerprint:'canonical-input',authored:entries,scenes};
}
const codes=e=>e.issues;
const build=r=>Structure.build(drawing([entry(r)]));
test('old structural records remain byte-equivalent through validation, projection and JSON import',()=>{
  const old=record('column',{widthM:null,depthM:null,material:null}),doc=project([old]);
  const text=JSON.stringify(doc);
  Model.validateProject(doc);
  assert.equal(JSON.stringify(doc),text);
  assert.equal(JSON.stringify(Model.parseProject(text)),text);
  const projected=Projection.build(doc);
  assert.deepEqual(projected.authored[0].record,old);
  const result=Structure.build(projected).elements[0];
  assert.equal(result.heightM,null);
  assert.equal(result.sizeSource,'unspecified');
  assert.equal(result.reference,null);
  assert.equal(result.label,old.id);
  assert.equal(result.geometry,null);
  assert.equal(JSON.stringify(doc),text);
});
test('all optional fields and grids round-trip without backfilling',()=>{
  const records=[
    record('column',{heightM:3,label:'C1',sizeSource:'engineer-provided',reference:'Claim: drawing S-01'}),
    record('beam',{heightM:null,label:null,sizeSource:'assumed',reference:null}),
    record('slab',{heightM:.2,sizeSource:'authored'}),
    record('footing',{heightM:.5,sizeSource:'unspecified'}),
    record('grid',{label:'A',reference:'Concept grid'})
  ];
  const doc=project(records);
  assert.deepEqual(Model.parseProject(JSON.stringify(doc)),doc);
  assert.deepEqual(Projection.build(doc).authored.map(e=>e.record),records);
});
const invalidOptionals={
  heightM:[undefined,0,-1,Infinity,NaN,'3',1e10],
  label:[undefined,'','  ','bad\nlabel',10,{}],
  sizeSource:[undefined,null,'verified','engineered','',1],
  reference:[undefined,'','bad\tref',false,[]]
};
for(const [key,values] of Object.entries(invalidOptionals))test(`strict optional ${key}, including explicitly undefined`,()=>{
  for(const value of values)assert.throws(()=>Model.validateProject(project([record('column',{[key]:value})])),undefined,`${key}: ${String(value)}`);
});
test('required structural fields, unknown keys, anchor shapes and grid restrictions stay strict',()=>{
  const bad=[
    r=>delete r.material,r=>delete r.widthM,r=>r.extra=true,r=>r.anchors=[],
    r=>r.anchors.push(anchor()),r=>r.anchors[0].point.extra=1,
    r=>r.kind='wall',r=>r.depthM=undefined
  ];
  for(const mutate of bad){const r=record();mutate(r);assert.throws(()=>Model.validateProject(project([r])));}
  for(const extra of [{widthM:1},{depthM:1},{material:'steel'},{heightM:1},{anchors:[anchor()]}])
    assert.throws(()=>Model.validateProject(project([record('grid',extra)])));
  assert.throws(()=>Model.validateProject(project([record('beam',{heightM:1})])));
  assert.throws(()=>Model.validateProject(project([record('beam',{anchors:[anchor()]} )])));
  assert.doesNotThrow(()=>Model.validateProject(project([record('grid',{heightM:null})])));
});
for(const kind of ['column','grid'])test(`bridge ${kind} upsert/delete/undo/redo and JSON preserve extended records and fingerprints`,()=>{
  const controller=controllerFor(project()),before=controller.inputFingerprint();
  const r=record(kind,{heightM:kind==='grid'?null:3.5,label:'C1',sizeSource:'engineer-provided',reference:'Unverified ref'});
  controller.execute({type:'upsert-authored',collection:'structural',value:r});
  const key=controller.inputFingerprint();
  assert.notEqual(key,before);
  controller.execute({type:'delete-authored',collection:'structural',id:r.id});
  assert.deepEqual(controller.getProject().floors[0].authored.structural,[]);
  controller.undo();
  assert.deepEqual(controller.getProject().floors[0].authored.structural,[r]);
  assert.equal(controller.inputFingerprint(),key);
  controller.redo();
  assert.deepEqual(controller.getProject().floors[0].authored.structural,[]);
  controller.undo();
  const restored=controllerFor(Model.createProject());
  restored.importProject(controller.exportProject());
  assert.deepEqual(restored.getProject(),controller.getProject());
  const prior=controller.exportProject();
  assert.throws(()=>controller.execute({type:'upsert-authored',collection:'structural',value:{...r,heightM:undefined}}));
  assert.equal(controller.exportProject(),prior);
});
test('grid wall anchors remap on copy and still resolve through the real projection',()=>{
  const controller=controllerFor(project()),wall=controller.getScene().walls.find(w=>Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y)>1);
  const wallAnchor=offsetM=>({kind:'wall',floorId:'ground',entityId:wall.id,offsetM,heightM:0});
  const grid=record('grid',{anchors:[wallAnchor(0),wallAnchor(.5)]});
  controller.execute({type:'upsert-authored',collection:'structural',value:grid});
  controller.execute({type:'add-floor',copyFromId:'ground'});
  const id=controller.getProject().activeFloorId;
  const projected=controller.getDrawingScene();
  const copied=projected.authored.find(e=>e.floorId===id&&e.collection==='structural');
  assert.equal(copied.anchorStatus,'resolved');
  for(const a of copied.record.anchors){
    assert.equal(a.floorId,id);assert.equal(a.entityId,id+wall.id.slice('ground'.length));
  }
  assert.equal(Structure.build(projected).elements.find(e=>e.floorId===id).geometry.kind,'grid');
});
for(const inactive of [false,true])test(`${inactive?'inactive':'active'} source duplication preserves new metadata and remaps grid/entity anchors`,()=>{
  const column=record('column',{heightM:3,label:'ground:verbatim',sizeSource:'authored',reference:'ground:reference'}),
    grid=record('grid',{anchors:[
      {kind:'entity',entityKind:'structural',floorId:'ground',entityId:column.id},
      anchor('upper',5,2)
    ],heightM:null});
  const controller=controllerFor(project([column,grid]));
  if(inactive)controller.execute({type:'select-floor',id:'upper'});
  controller.execute({type:'add-floor',copyFromId:'ground'});
  const doc=controller.getProject(),floorId=doc.activeFloorId;
  const records=doc.floors.find(f=>f.id===floorId).authored.structural;
  assert.deepEqual(records[0],{...column,id:`${floorId}:authored:column`,anchors:[anchor(floorId)]});
  assert.deepEqual(records[1],{...grid,id:`${floorId}:authored:grid`,anchors:[
    {kind:'entity',entityKind:'structural',floorId,entityId:`${floorId}:authored:column`},anchor('upper',5,2)
  ]});
  assert.deepEqual(doc.floors[0].authored.structural,[column,grid]);
  const restored=Model.parseProject(controller.exportProject());
  assert.deepEqual(restored.floors.find(f=>f.id===floorId).authored.structural,records);
});
test('grid host deletion and floor deletion retain repairable references through undo/redo',()=>{
  const column=record('column',{heightM:3}),grid=record('grid',{anchors:[
    {kind:'entity',entityKind:'structural',floorId:'ground',entityId:column.id},anchor('upper',5,2)
  ]});
  const controller=controllerFor(project([column,grid]));
  controller.execute({type:'delete-authored',collection:'structural',id:column.id});
  let result=Structure.build(controller.getDrawingScene());
  assert.equal(result.elements[0].geometry,null);
  assert.ok(codes(result.elements[0]).includes('unresolved-anchor'));
  assert.deepEqual(controller.getProject().floors[0].authored.structural,[grid]);
  controller.undo();
  assert.equal(controller.getDrawingScene().authored.find(e=>e.record.id===grid.id).anchorStatus,'resolved');
  controller.redo();controller.undo();
  controller.execute({type:'delete-floor',id:'upper'});
  result=Structure.build(controller.getDrawingScene());
  assert.equal(result.elements.find(e=>e.id===grid.id).anchors[1],null);
  controller.undo();
  assert.equal(controller.getDrawingScene().authored.find(e=>e.record.id===grid.id).anchorStatus,'resolved');
  controller.redo();
  assert.deepEqual(Model.parseProject(controller.exportProject()).floors[0].authored.structural,[column,grid]);
});
test('site-local box coordinates use unequal floor origins and explicit stacked elevation',()=>{
  const doc=project();
  doc.floors[1].authored=Model.emptyAuthored();
  doc.floors[1].authored.structural=[record('column',{
    id:'upper:authored:column',anchors:[anchor('upper',2,3,.5)],widthM:.4,depthM:.8,heightM:2.2
  })];
  const result=Structure.build(Projection.build(doc)),e=result.elements[0];
  assert.equal(e.floorId,'upper');
  assert.deepEqual(e.anchors,[{x:6,y:6,z:5.05}]);
  assert.deepEqual(e.geometry,{kind:'box',x:5.8,y:5.6,z:5.05,w:.4,d:.8,h:2.2});
  assert.equal(result.inputFingerprint,Model.inputFingerprint(doc));
});
for(const kind of ['column','slab','footing'])test(`${kind} box uses bottom center and explicit height only`,()=>{
  const e=build(record(kind,{widthM:2,depthM:4,heightM:.25})).elements[0];
  assert.deepEqual(e.geometry,{kind:'box',x:1,y:0,z:0,w:2,d:4,h:.25});
  for(const extra of [{},{heightM:null},{widthM:null,heightM:3},{depthM:null,heightM:3}]){
    const incomplete=build(record(kind,extra)).elements[0];
    assert.equal(incomplete.geometry,null);
    assert.ok(codes(incomplete).includes('unknown-dimensions'));
  }
});
test('beam endpoints are bottom centers; width is cross-axis and depth vertical',()=>{
  const r=record('beam',{anchors:[anchor('ground',2,3,4),anchor('ground',6,7,4)],widthM:.3,depthM:.7});
  const e=build(r).elements[0];
  assert.deepEqual(e.geometry,{kind:'beam',start:{x:2,y:3,z:4},end:{x:6,y:7,z:4},widthM:.3,depthM:.7});
  assert.equal(e.heightM,null);
  assert.deepEqual(e.anchors,r.anchors.map(a=>a.point));
});
test('positive but numerically collapsed extents remain diagnosed markers, not false volume/contact evidence',()=>{
  for(const r of [
    record('column',{widthM:1e-30,heightM:3}),
    record('column',{anchors:[anchor('ground',2,2,4)],heightM:1e-30}),
    record('beam',{widthM:1e-30})
  ]){
    Model.validateProject(project([r]));
    const e=build(r).elements[0];
    assert.equal(e.geometry,null);
    assert.ok(codes(e).includes('geometry-precision-limit'));
    assert.ok(codes(e).includes('missing-support-information'));
  }
});
test('horizontal grid is a non-volume segment with no dimension/material warnings',()=>{
  const e=build(record('grid')).elements[0];
  assert.deepEqual(e.geometry,{kind:'grid',start:{x:2,y:2,z:0},end:{x:6,y:2,z:0}});
  assert.ok(!codes(e).includes('unknown-dimensions'));
  assert.ok(!codes(e).includes('unknown-material'));
  assert.ok(!codes(e).includes('missing-support-information'));
});
for(const kind of ['beam','grid'])test(`${kind} diagnoses degenerate, sloping and unresolved anchors without fabricated geometry`,()=>{
  for(const [points,code] of [
    [[anchor(),anchor()],'degenerate-endpoints'],
    [[anchor(),anchor('ground',4,2,1)],'sloping-endpoints'],
    [[anchor(),null],'unresolved-anchor']
  ]){
    const e=build(record(kind,{anchors:points})).elements[0];
    assert.equal(e.geometry,null);
    assert.ok(codes(e).includes(code));
  }
});
test('missing materials/provenance and claimed engineer references never imply verification',()=>{
  const e=build(record('column',{heightM:3,material:null})).elements[0];
  assert.ok(codes(e).includes('unknown-material'));
  assert.ok(codes(e).includes('unknown-provenance'));
  assert.ok(e.geometry);
  for(const reference of [null,'Claimed signed S01']){
    const result=build(record('column',{heightM:3,sizeSource:'engineer-provided',reference}));
    assert.equal(result.engineeringStatus,'not-assessed');
    assert.ok(codes(result.elements[0]).includes('unverified-reference'));
    assert.equal(codes(result.elements[0]).includes('missing-reference'),reference===null);
  }
  assert.ok(codes(build(record('beam',{sizeSource:'assumed'})).elements[0]).includes('assumed-dimensions'));
});
function apertureScene(){
  const s=scene();
  s.walls=[{id:'wall',baseM:0,thicknessM:.2,removed:false}];
  s.openings=[{id:'window',wallId:'wall',sillM:1,heightM:1,segment:{x1:4,y1:4,x2:6,y2:4}}];
  return s;
}
test('opening conflict uses true aperture volume; touching faces, wrong height and plan near misses do not conflict',()=>{
  const s=apertureScene();
  for(const [x,y,z,expected] of [[5,4,1.2,true],[5,4,2,false],[5,4,0,false],[5,4.31,1.2,false],[6.3,4,1.2,false]]){
    const r=record('column',{anchors:[anchor('ground',x,y,z)],widthM:.4,depthM:.4,heightM:.5});
    const result=Structure.build(drawing([entry(r)],[s]));
    assert.equal(codes(result.elements[0]).includes('opening-volume-conflict'),expected,`${x},${y},${z}`);
    if(expected)assert.deepEqual(result.findings.find(f=>f.code==='opening-volume-conflict').elementIds,[r.id,'window']);
  }
});
test('oriented diagonal beam narrowphase rejects an AABB near miss but detects true segment conflicts',()=>{
  const s=apertureScene();
  const beam=(id,start,end)=>entry(record('beam',{id,anchors:[anchor('ground',...start),anchor('ground',...end)],widthM:.1,depthM:.2}));
  const result=Structure.build(drawing([
    beam('miss',[1,1,1.1],[8,4.7,1.1]),beam('hit',[1,1,1.1],[8,8,1.1]),
    beam('above',[1,1,2],[8,8,2]),beam('reversed',[8,8,1.1],[1,1,1.1])
  ],[s]));
  assert.equal(codes(result.elements[0]).includes('opening-volume-conflict'),false);
  assert.equal(codes(result.elements[1]).includes('opening-volume-conflict'),true);
  assert.equal(codes(result.elements[2]).includes('opening-volume-conflict'),false);
  assert.equal(codes(result.elements[3]).includes('opening-volume-conflict'),true);
});
test('real projected openings participate in volume checks, including actual sill elevation',()=>{
  const controller=controllerFor(project()),drawingScene=controller.getDrawingScene();
  const s=drawingScene.scenes[0],o=s.openings.find(o=>o.kind==='window'),wall=s.walls.find(w=>w.id===o.wallId);
  const p={x:(o.segment.x1+o.segment.x2)/2,y:(o.segment.y1+o.segment.y2)/2,z:wall.baseM+o.sillM+.1};
  const r=record('column',{anchors:[anchor('ground',p.x-1,p.y-2,p.z-s.floorElevationM)],widthM:.1,depthM:.1,heightM:.2});
  controller.execute({type:'upsert-authored',collection:'structural',value:r});
  const result=Structure.build(controller.getDrawingScene());
  assert.ok(result.findings.some(f=>f.code==='opening-volume-conflict'&&f.elementIds.includes(o.id)));
});
test('apertures are checked across floors by physical volume, not only owner floor',()=>{
  const s=apertureScene();
  const r=record('column',{id:'upper:authored:column',anchors:[anchor('upper',5,4,1.1)],heightM:.2});
  const result=Structure.build(drawing([entry(r,'upper')],[s,scene('upper',4)]));
  assert.ok(codes(result.elements[0]).includes('opening-volume-conflict'));
});
test('compiled apertures remain clearances without wall solids; malformed proposals remain unresolved',()=>{
  const s=apertureScene();s.walls[0].removed=true;
  const r=record('column',{anchors:[anchor('ground',5,4,1.1)],heightM:1});
  assert.ok(codes(Structure.build(drawing([entry(r)],[s])).elements[0]).includes('opening-volume-conflict'));
  s.walls[0].removed=false;s.openings[0].heightM=null;
  s.unresolvedOpenings=[{id:'unresolved'}];
  const result=Structure.build(drawing([entry(r)],[s]));
  assert.ok(result.findings.some(f=>f.code==='missing-opening-information'));
  assert.ok(result.findings.some(f=>f.code==='unresolved-openings'));
  assert.ok(!codes(result.elements[0]).includes('opening-volume-conflict'));
});
test('real full-width full-height sliding doorway still conflicts with a column',()=>{
  for(const heightDelta of [0,.01]){
    const doc=project(),initial=Projection.build(doc).scenes[0];
    const wall=initial.walls.find(w=>!w.exterior&&w.roomIds.length===2);
    assert.ok(wall);
    const ctx=doc.floors[0].legacy.context;
    ctx.plan.openings.doors=[{id:'full-door',kind:'sliding',wallId:wall.id,offsetM:0,
      widthM:Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y),heightM:wall.heightM-heightDelta}];
    ctx.plan.openings.windows=[];
    doc.legacy=copy(doc.floors[0].legacy);
    const planner=controllerFor(doc),compiled=planner.getDrawingScene().scenes[0];
    const opening=compiled.openings.find(o=>o.sourceId==='full-door');
    assert.ok(opening);
    assert.equal(compiled.walls.find(w=>w.id===wall.id).removed,heightDelta===0);
    const p={x:(opening.segment.x1+opening.segment.x2)/2+compiled.sourcePlotOrigin.x,
      y:(opening.segment.y1+opening.segment.y2)/2+compiled.sourcePlotOrigin.y};
    planner.execute({type:'upsert-authored',collection:'structural',value:record('column',{
      anchors:[anchor('ground',p.x,p.y,0)],widthM:.4,depthM:.4,heightM:2})});
    assert.ok(Structure.build(planner.getDrawingScene()).findings.some(f=>
      f.code==='opening-volume-conflict'&&f.elementIds.includes(opening.id)));
  }
});
test('out-of-plot checks full cross-axis beam/box extents and grid endpoints, not only centers',()=>{
  const entries=[
    entry(record('column',{anchors:[anchor('ground',.1,2)],heightM:1})),
    entry(record('beam',{anchors:[anchor('ground',1,.1),anchor('ground',8,.1)],widthM:.4})),
    entry(record('grid',{anchors:[anchor(),anchor('ground',21,2)]}))
  ];
  const result=Structure.build(drawing(entries));
  for(const e of result.elements)assert.ok(codes(e).includes('out-of-plot'));
  const incomplete=entry(record('column',{anchors:[anchor('ground',.1,2)]}));
  const marker=Structure.build(drawing([incomplete])).elements[0];
  assert.equal(marker.geometry,null);
  assert.ok(codes(marker).includes('out-of-plot'));
  const missing=scene();missing.plot=null;
  assert.ok(codes(Structure.build(drawing([entries[0]],[missing])).elements[0]).includes('missing-plot-information'));
});
function supports({x=2,height=3,width=.8,missing=false}={}){
  const lower=record('column',{widthM:width,depthM:width,heightM:missing?null:height});
  const upper=record('column',{id:'upper:authored:column',anchors:[anchor('upper',x,2,3)],widthM:.4,depthM:.4,heightM:2});
  return Structure.build(drawing([entry(lower),entry(upper,'upper')],[scene(),scene('upper',3)]));
}
test('upper/lower support compares footprint containment and actual top/bottom elevation without safety verdicts',()=>{
  const aligned=supports().elements[1];
  assert.ok(!codes(aligned).includes('column-support-mismatch'));
  for(const options of [{x:5},{height:2.9},{width:.2},{x:2.3}]){
    const e=supports(options).elements[1];
    assert.ok(codes(e).includes('column-support-mismatch'),JSON.stringify(options));
    assert.ok(codes(e).includes('missing-support-information'));
  }
  const unknown=supports({missing:true}).elements[1];
  assert.ok(!codes(unknown).includes('column-support-mismatch'));
  assert.ok(codes(unknown).includes('missing-support-information'));
});
test('column contact on diagonal beam is evaluated against the oriented footprint',()=>{
  const beam=entry(record('beam',{anchors:[anchor('ground',1,1,2.5),anchor('ground',8,8,2.5)],widthM:1,depthM:.5}));
  const upper=(id,x,y)=>entry(record('column',{id,anchors:[anchor('upper',x,y,3)],widthM:.2,depthM:.2,heightM:2}),'upper');
  const result=Structure.build(drawing([beam,upper('aligned',4,4),upper('miss',2,6)],[scene(),scene('upper',3)]));
  assert.ok(!codes(result.elements[1]).includes('column-support-mismatch'));
  assert.ok(codes(result.elements[2]).includes('column-support-mismatch'));
});
test('beam endpoint contact is geometric only and missing endpoints are individually identified',()=>{
  const column=entry(record('column',{heightM:3}));
  const beam=entry(record('beam',{anchors:[anchor('ground',2,2,3),anchor('ground',6,2,3)]}));
  const result=Structure.build(drawing([column,beam]));
  const findings=result.findings.filter(f=>f.code==='unsupported-endpoint');
  assert.equal(findings.length,1);
  assert.match(findings[0].message,/endpoint 2/);
  assert.equal(result.engineeringStatus,'not-assessed');
});
test('empty and populated outputs always have a warning caveat and exact, deeply frozen provenance',()=>{
  const input=drawing([entry(record('column',{heightM:3}))]),before=copy(input);
  const result=Structure.build(input);
  assert.deepEqual(input,before);
  assert.deepEqual(Object.keys(result).sort(),['version','projectId','revision','inputFingerprint','elements','findings','engineeringStatus'].sort());
  assert.equal(result.projectId,input.projectId);assert.equal(result.revision,input.revision);
  assert.equal(result.inputFingerprint,input.inputFingerprint);
  assert.deepEqual(Object.keys(result.elements[0]).sort(),[
    'id','floorId','kind','label','sizeSource','reference','anchors','widthM','depthM','heightM','material','geometry','issues'
  ].sort());
  function frozen(value){
    if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));Object.values(value).forEach(frozen);}
  }
  frozen(result);
  for(const output of [result,Structure.build(drawing())]){
    assert.equal(output.engineeringStatus,'not-assessed');
    assert.ok(output.findings.some(f=>f.code==='engineering-not-assessed'));
    for(const f of output.findings){
      assert.deepEqual(Object.keys(f).sort(),['code','severity','elementIds','floorId','message'].sort());
      assert.equal(f.severity,'warning');
    }
  }
  assert.deepEqual(Structure.build(input),result);
  input.authored[0].anchors[0].point.x=99;
  assert.equal(result.elements[0].anchors[0].x,2);
});
test('input/workload guards fail explicitly instead of truncating elements or findings',()=>{
  assert.throws(()=>Structure.build({}),/DrawingScene/);
  const e=entry(record('grid'));
  assert.equal(Structure.build(drawing(Array.from({length:1000},(_,i)=>({...e,record:{...e.record,id:`grid-${i}`}})))).elements.length,1000);
  assert.throws(()=>Structure.build(drawing(Array(1001).fill(e))),/1000 elements/);
  assert.throws(()=>Structure.build(drawing([] ,Array(1001).fill(scene()))),/1000 scenes/);
  assert.throws(()=>Structure.build(drawing(Array(70001).fill(e))),/70000 authored/);
  const s=apertureScene();
  s.openings=Array(10001).fill(s.openings[0]);
  assert.throws(()=>Structure.build(drawing([],[s])),/10000 openings/);
  const walls=scene();walls.walls=Array(20001).fill({});
  assert.throws(()=>Structure.build(drawing([],[walls])),/20000 walls/);
  const crowded=apertureScene();
  crowded.openings=Array.from({length:1000},(_,i)=>({...crowded.openings[0],id:`opening-${i}`}));
  const r=record('column',{anchors:[anchor('ground',5,4,1.1)],heightM:.5});
  assert.throws(()=>Structure.build(drawing(Array.from({length:101},(_,i)=>entry({...r,id:`column-${i}`})),[crowded])),/candidate-pair limit/);
});
test('classic script global works without DOM, model, network or CommonJS',()=>{
  const context={};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','planner-structure.js'),'utf8'),context);
  assert.equal(typeof context.HomePlannerStructure.build,'function');
  assert.equal(context.HomePlannerStructure.build(drawing()).engineeringStatus,'not-assessed');
});
