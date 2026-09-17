const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Model=require('../planner-model.js');
const Projection=require('../planner-projection.js');
const Storage=require('../planner-storage.js');
const Sun=require('../sun-exposure.js');
const {createController}=require('../planner-bridge.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const time='2026-09-16T10:00:00.000Z';
const point=(floorId='ground',x=1,y=1,z=0)=>({kind:'point',floorId,point:{x,y,z}});
const entity=(entityId,entityKind='room',floorId='ground')=>({kind:'entity',floorId,entityId,entityKind});
function project(){
  const doc=createFixture('multiple-floors').project;
  for(const floor of doc.floors)floor.legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
  doc.legacy=copy(doc.floors[0].legacy);
  return doc;
}
function authored(floorId='ground'){
  const value=Model.emptyAuthored(),id=name=>`${floorId}:authored:${name}`,at=point(floorId);
  value.annotations=[{id:id('note'),text:'Concept only',anchor:at}];
  value.dimensions=[{id:id('dim'),start:at,end:point(floorId,4,5),offsetM:.5}];
  value.fixtures=[{id:id('basin'),kind:'basin',anchor:at,widthM:null,depthM:null,heightM:null}];
  value.stairs=[{id:id('stair'),start:at,end:point('upper',1,1),widthM:null,riserCount:null}];
  value.structural=[{id:id('column'),kind:'column',anchors:[at],widthM:null,depthM:null,material:null}];
  value.serviceNodes=[
    {id:id('supply'),system:'water',kind:'supply',anchor:at,diameterMm:null,invertM:null},
    {id:id('outlet'),system:'water',kind:'fixture',anchor:entity(id('basin'),'fixture',floorId),diameterMm:null,invertM:null}
  ];
  value.serviceRoutes=[{id:id('route'),system:'water',
    from:{floorId,entityId:id('supply')},to:{floorId,entityId:id('outlet')},via:[],diameterMm:null,slope:null}];
  return value;
}
function documentation(){
  return {version:1,views:[{id:'plan-ground',name:'Ground plan',kind:'plan',floorId:'ground',
    scaleDenominator:null,direction:null,cut:[]}],
  sheets:[{id:'sheet-1',number:'A01',title:'Concept plan',paper:'A3',orientation:'landscape',viewIds:['plan-ground']}]};
}
function populated(){
  const doc=project();
  doc.floors[0].authored=authored();
  doc.documentation=documentation();doc.siteDatum={version:1,elevationM:null};
  return doc;
}
function editable(doc){
  let live=copy(doc.legacy);
  const adapter={
    capture:()=>copy(live),restore:value=>{live=copy(value);},render(){},
    edit(command,selected){
      if(command.type==='delete-furniture')live.context.plan.furniture=live.context.plan.furniture.filter(item=>item.id!==selected.sourceId);
      else{
        const room=live.context.plan.placed.find(item=>item.req.id===selected.sourceId);
        const dx=command.rect.x-room.module.x,dy=command.rect.y-room.module.y;
        room.module=copy(command.rect);room.carpet.x+=dx;room.carpet.y+=dy;
      }
    }
  };
  const controller=createController(adapter,Model);controller.replaceProject(doc);
  return {controller,adapter};
}
test('old schema-1 documents remain unmodified and gain no optional feature records',()=>{
  const doc=createFixture('furnished-single').project,text=JSON.stringify(doc);
  assert.equal(JSON.stringify(Model.parseProject(text)),text);
  assert.equal('authored' in Model.createProject().floors[0],false);
  assert.equal('documentation' in Model.createProject(),false);
  assert.equal('siteDatum' in Model.createProject(),false);
  assert.equal('authored' in controllerFor(doc).getProject().floors[0],false);
});
test('every feature collection and all null physical inputs round-trip exactly',()=>{
  const controller=controllerFor(populated()),doc=controller.getProject();
  const restored=controllerFor(Model.createProject());restored.importProject(controller.exportProject());
  assert.deepEqual(restored.getProject(),doc);
  assert.deepEqual(restored.getProject().floors[0].authored,authored());
  assert.deepEqual(restored.getProject().documentation,documentation());
});
for(const feature of ['authored','documentation','siteDatum'])test(`unknown ${feature} versions and fields are rejected`,()=>{
  const doc=populated(),record=feature==='authored'?doc.floors[0].authored:doc[feature];
  record.version=2;assert.throws(()=>Model.validateProject(doc),/version/);
  record.version=1;record.unspecified=true;assert.throws(()=>Model.validateProject(doc),/fields/);
});
test('recognized record fields have strict semantic schemas, scoped IDs and unique identities',()=>{
  const mutations=[
    a=>a.annotations[0].text='',
    a=>a.dimensions[0].offsetM='1',
    a=>a.dimensions[0].start.point.extra=1,
    a=>a.fixtures[0].widthM=0,
    a=>a.fixtures[0].heightM='unknown',
    a=>a.stairs[0].riserCount=1.5,
    a=>a.structural[0].kind='engineered',
    a=>a.structural[0].widthM=-1,
    a=>a.structural[0].anchors=[],
    a=>a.serviceNodes[0].system='electricity',
    a=>a.serviceNodes[0].diameterMm=0,
    a=>a.serviceRoutes[0].slope=-.01,
    a=>a.serviceRoutes[0].from={id:'untyped'},
    a=>a.fixtures[0].anchor.kind='arbitrary',
    a=>a.annotations[0].id='upper:authored:note',
    a=>a.annotations[0].id='ground:authored:',
    a=>a.fixtures[0].id=a.annotations[0].id,
    a=>a.dimensions[0].measuredLengthM=5
  ];
  for(const mutate of mutations){
    const doc=populated();mutate(doc.floors[0].authored);
    assert.throws(()=>Model.validateProject(doc));
  }
  for(const mutate of [
    d=>d.views[0].scaleDenominator=0,d=>d.views[0].kind='perspective',
    d=>d.views[0].cut=[point()],d=>d.sheets[0].paper='custom',
    d=>d.sheets[0].viewIds.push('plan-ground')
  ]){
    const doc=populated();mutate(doc.documentation);assert.throws(()=>Model.validateProject(doc));
  }
});
test('authored commands are atomic, version checked and never turn NaN/Infinity into unknown',()=>{
  const controller=controllerFor(project()),before=controller.exportProject();
  const value=authored();value.fixtures[0].widthM=Infinity;
  assert.throws(()=>controller.execute({type:'set-authored',value}),/finite/);
  value.fixtures[0].widthM=null;value.version=99;
  assert.throws(()=>controller.execute({type:'set-authored',value}),/version/);
  assert.throws(()=>controller.execute({type:'upsert-authored',collection:'anything',value:{}}));
  assert.throws(()=>controller.execute({type:'delete-authored',collection:'fixtures',id:'missing'}));
  assert.equal(controller.exportProject(),before);
  assert.equal(controller.canUndo(),false);
});
test('feature setters, upsert, delete, undo and redo preserve exact record contents',()=>{
  const controller=controllerFor(project());
  controller.execute({type:'set-authored',value:authored()});
  controller.execute({type:'set-documentation',value:documentation()});
  controller.execute({type:'set-site-datum',value:{version:1,elevationM:100}});
  const note={...authored().annotations[0],text:'Updated'};
  controller.execute({type:'upsert-authored',collection:'annotations',value:note});
  assert.deepEqual(controller.getProject().floors[0].authored.annotations,[note]);
  controller.undo();assert.equal(controller.getProject().floors[0].authored.annotations[0].text,'Concept only');
  controller.redo();assert.deepEqual(controller.getProject().floors[0].authored.annotations,[note]);
  controller.execute({type:'delete-authored',collection:'annotations',id:note.id});
  assert.deepEqual(controller.getProject().floors[0].authored.annotations,[]);
  controller.undo();assert.deepEqual(controller.getProject().floors[0].authored.annotations,[note]);
  controller.execute({type:'set-authored',value:null});
  assert.equal('authored' in controller.getProject().floors[0],false);
  controller.undo();assert.deepEqual(controller.getProject().floors[0].authored.annotations,[note]);
});
test('floor navigation and object selection do not change inputs, revision, history or storage identity',()=>{
  const controller=controllerFor(populated()),before=controller.getProject();
  const key=controller.inputFingerprint(),storageKey=Storage.fingerprint(before);
  controller.select({kind:'room',id:'ground:living'});
  controller.execute({type:'select-floor',id:'upper'});
  assert.equal(controller.getProject().revision,before.revision);
  assert.deepEqual(controller.getProject().floors,before.floors);
  assert.equal(controller.inputFingerprint(),key);
  assert.equal(Storage.fingerprint(controller.getProject()),storageKey);
  assert.equal(controller.canUndo(),false);
  controller.execute({type:'select-floor',id:'ground'});
  assert.deepEqual(controller.getProject(),before);
});
test('inactive-floor authored records are isolated; active-floor duplication remaps all references',()=>{
  const controller=controllerFor(populated());
  const original=copy(controller.getProject().floors[0].authored);
  const wall=controller.getScene().walls[0];
  controller.execute({type:'upsert-authored',collection:'annotations',value:{
    id:'ground:authored:wall-note',text:'ground:keep text',anchor:{kind:'wall',floorId:'ground',entityId:wall.id,offsetM:1,heightM:1}
  }});
  controller.execute({type:'add-floor',copyFromId:'ground'});
  const doc=controller.getProject(),id=doc.activeFloorId,duplicate=doc.floors.find(floor=>floor.id===id).authored;
  assert.equal(duplicate.annotations[0].id,`${id}:authored:note`);
  assert.equal(duplicate.annotations[1].anchor.entityId,id+wall.id.slice('ground'.length));
  assert.equal(duplicate.annotations[1].anchor.floorId,id);
  assert.equal(duplicate.annotations[1].text,'ground:keep text');
  assert.equal(duplicate.serviceRoutes[0].from.entityId,`${id}:authored:supply`);
  assert.equal(duplicate.serviceRoutes[0].from.floorId,id);
  assert.equal(duplicate.serviceNodes[1].anchor.entityId,`${id}:authored:basin`);
  assert.equal(duplicate.stairs[0].end.floorId,'upper');
  assert.equal(doc.documentation.views[0].floorId,'ground');
  controller.execute({type:'delete-authored',collection:'fixtures',id:`${id}:authored:basin`});
  assert.deepEqual(controller.getProject().floors[0].authored.fixtures,original.fixtures);
  controller.execute({type:'select-floor',id:'upper'});
  assert.equal('authored' in controller.getProject().floors[1],false);
  controller.execute({type:'set-authored',value:authored('upper')});
  controller.execute({type:'select-floor',id:'ground'});
  assert.deepEqual(controller.getProject().floors[0].authored.fixtures,original.fixtures);
});
test('deleting a floor retains cross-floor anchors and produces explicit unresolved diagnostics',()=>{
  const controller=controllerFor(populated()),before=controller.getProject().floors[0].authored.stairs[0];
  controller.execute({type:'delete-floor',id:'upper'});
  assert.deepEqual(controller.getProject().floors[0].authored.stairs[0],before);
  const drawing=controller.getDrawingScene();
  assert.ok(drawing.diagnostics.some(item=>item.code==='missing-floor'&&item.ownerId===before.id));
  controller.undo();assert.equal(controller.getProject().floors.length,2);
  assert.equal(controller.getDrawingScene().authored.find(item=>item.record.id===before.id).anchorStatus,'resolved');
  controller.redo();assert.equal(controller.getProject().floors.length,1);
});
test('dimensions resolve host positions and follow edits without replacing authored anchors',()=>{
  const doc=populated(),dim=doc.floors[0].authored.dimensions[0];
  dim.start=entity('ground:living');dim.end=point('ground',8,6);
  const {controller}=editable(doc),before=controller.getDrawingScene(),raw=controller.getScene();
  const room=raw.rooms.find(item=>item.id==='ground:living');
  controller.execute({type:'update-room',id:room.id,rect:{...room.module,x:room.module.x+.1}});
  const after=controller.getDrawingScene();
  assert.notEqual(after.authored.find(item=>item.collection==='dimensions').distanceM,
    before.authored.find(item=>item.collection==='dimensions').distanceM);
  assert.deepEqual(controller.getProject().floors[0].authored.dimensions[0],dim);
});
test('deleted furniture and authored hosts stay referenced, unresolved and undoable',()=>{
  const doc=populated();
  doc.floors[0].authored.annotations[0].anchor=entity('ground:sofa','furniture');
  const {controller}=editable(doc);
  controller.execute({type:'delete-furniture',id:'ground:sofa'});
  assert.ok(controller.getDrawingScene().diagnostics.some(item=>item.code==='missing-host'&&item.ownerId==='ground:authored:note'));
  assert.equal(controller.getProject().floors[0].authored.annotations[0].anchor.entityId,'ground:sofa');
  controller.undo();assert.equal(controller.getDrawingScene().authored.find(item=>item.collection==='annotations').anchorStatus,'resolved');
  controller.execute({type:'delete-authored',collection:'fixtures',id:'ground:authored:basin'});
  assert.equal(controller.getProject().floors[0].authored.serviceNodes[1].anchor.entityId,'ground:authored:basin');
  assert.ok(controller.getDrawingScene().diagnostics.some(item=>item.code==='unresolved-host'&&item.ownerId==='ground:authored:route'));
});
test('wall anchors diagnose changed spans, removed hosts and missing IDs without reattachment',()=>{
  const controller=controllerFor(populated()),wall=controller.getScene().walls.find(item=>!item.exterior);
  const note={id:'ground:authored:wall',text:'Host',anchor:{kind:'wall',floorId:'ground',entityId:wall.id,offsetM:0,heightM:1}};
  controller.execute({type:'upsert-authored',collection:'annotations',value:note});
  assert.equal(controller.getDrawingScene().authored.find(item=>item.record.id===note.id).anchorStatus,'resolved');
  controller.execute({type:'open-wall',id:wall.id,full:true,confirmConceptual:true});
  assert.ok(controller.getDrawingScene().diagnostics.some(item=>item.code==='removed-host'&&item.ownerId===note.id));
  controller.undo();
  note.anchor.offsetM=100;
  controller.execute({type:'upsert-authored',collection:'annotations',value:note});
  assert.ok(controller.getDrawingScene().diagnostics.some(item=>item.code==='host-bounds'&&item.ownerId===note.id));
  note.anchor.entityId='ground:nonexistent';
  controller.execute({type:'upsert-authored',collection:'annotations',value:note});
  assert.ok(controller.getDrawingScene().diagnostics.some(item=>item.code==='missing-host'&&item.ownerId===note.id));
});
test('wall anchors cannot silently resolve into an aperture void',()=>{
  const controller=controllerFor(populated()),opening=controller.getScene().openings.find(item=>item.kind==='window');
  controller.execute({type:'upsert-authored',collection:'annotations',value:{
    id:'ground:authored:void',text:'Invalid mounting location',anchor:{
      kind:'wall',floorId:'ground',entityId:opening.wallId,
      offsetM:opening.offsetM+opening.widthM/2,heightM:opening.sillM+opening.heightM/2
    }
  }});
  assert.ok(controller.getDrawingScene().diagnostics.some(item=>item.code==='host-void'&&item.ownerId==='ground:authored:void'));
});
test('cyclic hosts, system mismatches and deleted view references remain explicit',()=>{
  const doc=populated(),a=doc.floors[0].authored;
  a.fixtures[0].anchor=entity(a.fixtures[0].id,'fixture');
  a.serviceNodes[0].system='waste';
  doc.documentation.sheets[0].viewIds=['missing-view'];
  Model.validateProject(doc);
  const drawing=Projection.build(doc);
  assert.ok(drawing.diagnostics.some(item=>item.code==='unresolved-host'));
  assert.ok(drawing.diagnostics.some(item=>item.code==='service-system-mismatch'));
  assert.ok(drawing.diagnostics.some(item=>item.code==='missing-view'));
  assert.deepEqual(drawing.authored.find(item=>item.collection==='fixtures').record,a.fixtures[0]);
});
test('site projection preserves plate/plot distinction and every supported geometric representation',()=>{
  const controller=controllerFor(createFixture('setback-plot').project),raw=controller.getScene();
  const before=copy(raw),scene=Projection.projectScene(raw),dx=-raw.plot.x,dy=-raw.plot.y;
  assert.equal(scene.floor.w,raw.floor.w);assert.notEqual(scene.floor.w,scene.plot.w);
  for(const [items,field] of [['rooms','rect'],['rooms','module'],['furniture','rect']])
    raw[items].forEach((item,index)=>{
      assert.equal(scene[items][index][field].x,item[field].x+dx);
      assert.equal(scene[items][index][field].y,item[field].y+dy);
    });
  raw.walls.forEach((wall,index)=>{
    assert.equal(scene.walls[index].start.x,wall.start.x+dx);
    assert.equal(scene.walls[index].end.y,wall.end.y+dy);
    assert.equal(scene.walls[index].baseM,wall.baseM);
    wall.openings.forEach((opening,j)=>{
      assert.equal(scene.walls[index].openings[j],scene.openings.find(item=>item.id===opening.id));
    });
  });
  raw.openings.forEach((opening,index)=>{
    assert.equal(scene.openings[index].segment.x1,opening.segment.x1+dx);
    assert.equal(scene.openings[index].segment.y2,opening.segment.y2+dy);
  });
  assert.equal(scene.obstacles[0].x,raw.obstacles[0].x+dx);
  assert.equal(scene.obstacles[0].baseM,raw.obstacles[0].baseM);
  assert.deepEqual(raw,before);assert.ok(Object.isFrozen(scene.rooms[0].module));
});
test('site, legacy 3D-centered and sun-analysis coordinates have canonical physical parity',()=>{
  const controller=controllerFor(createFixture('setback-plot').project),raw=controller.getScene();
  const scene=Projection.projectScene(raw),sun=Sun.prepareScenes(controller.getProject(),[raw])[0];
  const physicalWalls=value=>value.walls.map(wall=>({...wall,
    openings:wall.openings.map(({segment,...opening})=>opening)}));
  assert.deepEqual(physicalWalls(scene),physicalWalls(sun));
  assert.deepEqual(scene.rooms.map(room=>room.rect),sun.rooms.map(room=>room.rect));
  for(const headingDeg of [0,90,180,270,32.5]){
    const source={...raw,headingDeg},point3={x:2.4,y:3.1,z:4.8};
    const physical=Projection.siteToWorld(Projection.localToSite(point3,source),headingDeg);
    const centered=Model.localToWorld(point3,source);
    const origin=Projection.siteToWorld(Projection.localToSite({x:raw.floor.w/2,y:raw.floor.h/2,z:0},source),headingDeg);
    for(const axis of ['east','north','up'])assert.ok(Math.abs(physical[axis]-centered[axis]-origin[axis])<1e-9);
    const sunCentered=Model.localToWorld({x:point3.x-raw.plot.x,y:point3.y-raw.plot.y,z:point3.z},{...sun,headingDeg});
    const sunOrigin=Projection.siteToWorld({x:raw.plot.w/2,y:raw.plot.h/2,z:0},headingDeg);
    for(const axis of ['east','north','up'])assert.ok(Math.abs(physical[axis]-sunCentered[axis]-sunOrigin[axis])<1e-9);
  }
  const unsupported=project();unsupported.legacy.context.plate.frontEdge=32.5;
  assert.throws(()=>Model.buildScene(unsupported.legacy.context,unsupported),/direction/);
});
test('vertical datum, storey stacking, explicit elevation and unknown absolute level are distinguished',()=>{
  const controller=controllerFor(populated()),first=controller.getDrawingScene();
  const dim=first.authored.find(item=>item.collection==='dimensions');
  assert.equal(dim.anchors[0].point.z,.45);
  assert.equal(dim.anchors[0].world.absoluteElevationM,null);
  controller.execute({type:'set-site-datum',value:{version:1,elevationM:100}});
  const drawing=controller.getDrawingScene();
  const stair=drawing.authored.find(item=>item.collection==='stairs');
  assert.equal(stair.anchors[0].world.absoluteElevationM,100.45);
  assert.ok(Math.abs(stair.anchors[1].point.z-3.65)<1e-9);
  const doc=copy(controller.getProject());doc.floors[1].legacy.context.floorElevationM=9;
  assert.equal(Projection.build(doc).scenes[1].floorElevationM,9);
});
test('missing or incompatible site geometry is unresolved instead of invented',()=>{
  const sparse=Projection.build(createFixture('sparse-unknown').project);
  assert.equal(sparse.scenes.length,0);assert.ok(sparse.diagnostics.some(item=>item.code==='missing-plot'));
  const doc=populated();doc.floors[1].legacy.context.plate.sitePlot.w=13;
  const drawing=Projection.build(doc);
  assert.equal(drawing.scenes.length,1);
  assert.ok(drawing.diagnostics.some(item=>item.code==='inconsistent-site-frame'));
  assert.equal(drawing.authored.find(item=>item.collection==='stairs').anchorStatus,'unresolved');
  const missing=Projection.build(createFixture('missing-context').project);
  assert.ok(missing.diagnostics.some(item=>item.code==='missing-geometry'));
});
test('snapshots are immutable copies with deterministic input and engine provenance, not results',()=>{
  const controller=controllerFor(populated()),inputs={season:'summer'};
  const snapshot=controller.createSnapshot({purpose:'analysis',engineId:'test',engineVersion:'1',inputs});
  const before=copy(snapshot);
  inputs.season='winter';
  controller.execute({type:'select-floor',id:'upper'});
  assert.equal(controller.inputFingerprint({season:'summer'}),snapshot.provenance.inputFingerprint);
  controller.execute({type:'update-floor',id:'ground',patch:{heightM:4}});
  assert.notEqual(controller.inputFingerprint({season:'summer'}),snapshot.provenance.inputFingerprint);
  assert.deepEqual(snapshot,before);
  assert.ok(Object.isFrozen(snapshot.inputs));assert.ok(Object.isFrozen(snapshot.drawing.authored[0].record));
  assert.equal(snapshot.provenance.engineVersion,'1');
  assert.throws(()=>controller.createSnapshot({purpose:'calculation',engineId:'x',engineVersion:'1'}));
});
test('unknown anchor positions stay null rather than generating plausible coordinates',()=>{
  const doc=populated();doc.floors[0].authored.dimensions[0].start=null;
  doc.floors[0].authored.fixtures[0].anchor=null;
  Model.validateProject(doc);
  const drawing=Projection.build(doc),dimension=drawing.authored.find(item=>item.collection==='dimensions');
  assert.equal(dimension.distanceM,null);assert.equal(dimension.anchors[0].point,null);
  assert.ok(drawing.diagnostics.some(item=>item.code==='unknown-anchor'));
  assert.equal(drawing.authored.find(item=>item.collection==='fixtures').record.anchor,null);
});
test('known output writes and zoom-only navigation leave input fingerprints unchanged',()=>{
  const {controller,adapter}=editable(populated()),before=controller.getProject(),key=controller.inputFingerprint();
  const live=adapter.capture();live.controls.roomZoom={value:'200'};adapter.restore(live);controller.acceptLegacy();
  assert.equal(controller.getProject().revision,before.revision);
  assert.equal(controller.inputFingerprint(),key);
  controller.execute({type:'set-environment',patch:{results:{example:{inputKey:key,result:42}}}});
  assert.equal(controller.inputFingerprint(),key);
  controller.execute({type:'set-environment',patch:{sunlight:{result:{output:42}}}});
  assert.equal(controller.inputFingerprint(),key);
  const first=copy(controller.getProject());
  first.environment.sunlight={neighbors:{},result:{output:1}};
  const second=copy(first);second.environment.sunlight.result.output=2;second.revision++;
  assert.equal(Model.inputFingerprint(first),Model.inputFingerprint(second));
  assert.notEqual(Storage.fingerprint(first),Storage.fingerprint(second));
  assert.equal(Storage.fingerprint({schemaVersion:1,mode:'study'}),'{"mode":"study","schemaVersion":1}');
});
test('floor navigation preserves redo and inactive-floor duplication retains references',()=>{
  const controller=controllerFor(populated());
  controller.execute({type:'upsert-authored',collection:'annotations',value:{...authored().annotations[0],text:'Edit'}});
  controller.undo();
  const revision=controller.getProject().revision;
  controller.execute({type:'select-floor',id:'upper'});
  assert.equal(controller.getProject().revision,revision);assert.equal(controller.canRedo(),true);
  controller.redo();assert.equal(controller.getProject().floors[0].authored.annotations[0].text,'Edit');
  controller.execute({type:'select-floor',id:'upper'});
  controller.execute({type:'add-floor',copyFromId:'ground'});
  const doc=controller.getProject(),floor=doc.floors.find(item=>item.id===doc.activeFloorId);
  assert.equal(floor.authored.annotations[0].anchor.floorId,floor.id);
  assert.equal(floor.authored.serviceRoutes[0].to.entityId,`${floor.id}:authored:outlet`);
});
test('different floor-local origins still resolve the same physical site position',()=>{
  const doc=populated();
  doc.floors[1].legacy.context.plate.sitePlot={x:0,y:0,w:12,h:12};
  doc.floors[0].authored.dimensions[0]={id:'ground:authored:dim',
    start:point('ground',1,1,3.2),end:point('upper',2,3,0),offsetM:0};
  const drawing=Projection.build(doc),dim=drawing.authored.find(item=>item.collection==='dimensions');
  assert.ok(dim.distanceM<1e-9);
  assert.deepEqual(dim.anchors[0].world,dim.anchors[1].world);
});
test('failed restore and navigation preserve data, selection and history atomically',()=>{
  const {controller,adapter}=editable(populated()),before=controller.exportProject();
  controller.select({kind:'room',id:'ground:living'});
  const original=adapter.render;let fail=true;
  adapter.render=()=>{if(fail){fail=false;throw new Error('Synthetic render failure');}original();};
  assert.throws(()=>controller.execute({type:'select-floor',id:'upper'}),/Synthetic/);
  assert.equal(controller.exportProject(),before);
  assert.deepEqual(controller.getSelection(),{kind:'room',id:'ground:living'});
  assert.equal(controller.canUndo(),false);
});
test('JSON and browser storage envelopes preserve records and reject feature corruption through real model',()=>{
  const controller=controllerFor(populated());
  const first=Storage.createRecord(controller.getProject(),undefined,time,Model);
  const second=Storage.readRecord(copy(first),Model);
  const restored=controllerFor(project());restored.replaceProject(second.document);
  assert.deepEqual(restored.getProject(),controller.getProject());
  controller.execute({type:'select-floor',id:'upper'});
  assert.deepEqual(Storage.createRecord(controller.getProject(),first,time,Model),first);
  controller.execute({type:'set-authored',value:authored('upper')});
  const saved=Storage.createRecord(controller.getProject(),first,time,Model);
  assert.deepEqual(Storage.readRecord(saved,Model).document,controller.getProject());
  saved.document.floors[1].authored.version=999;
  assert.throws(()=>Storage.readRecord(saved,Model),error=>error.code==='ProjectValidationError');
  const conflict=copy(first.document);conflict.floors[0].authored.annotations[0].text='Conflicting edit';
  assert.throws(()=>Storage.createRecord(conflict,first,time,Model),error=>error.code==='RevisionConflictError');
});
test('classic offline scripts load in dependency order and expose the same APIs',()=>{
  const sandbox={Intl,console};vm.createContext(sandbox);
  for(const file of ['planner-features.js','planner-model.js','planner-projection.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox);
  assert.deepEqual(Object.keys(sandbox.HomePlannerProjection),Object.keys(Projection));
  assert.equal(vm.runInContext('HomePlannerModel.validateProject(HomePlannerModel.createProject()).schemaVersion',sandbox),1);
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  for(const [before,after] of [['planner-features.js','planner-model.js'],['planner-model.js','planner-projection.js'],['planner-projection.js','planner-bridge.js']])
    assert.ok(html.indexOf(`src="${before}"`)<html.indexOf(`src="${after}"`));
});
