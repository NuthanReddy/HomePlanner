const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Model=require('../planner-model.js');
const Projection=require('../planner-projection.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const point=()=>({kind:'point',floorId:'ground',point:{x:1,y:2,z:0}});
const entity=(entityId,entityKind='structural',floorId='ground')=>({kind:'entity',floorId,entityKind,entityId});
const beamId=i=>`ground:authored:beam-${i}`;
function branching(count,cyclic=false){
  const doc=createFixture('setback-plot').project,a=Model.emptyAuthored();
  for(let i=0;i<count;i++)a.structural.push({
    id:beamId(i),kind:'beam',anchors:[0,1].map(()=>i?entity(beamId(i-1)):cyclic?entity(beamId(0)):point()),
    widthM:null,depthM:null,material:null
  });
  doc.floors[0].authored=a;
  return doc;
}
function boundedBuild(doc){
  let reads=0;
  const count=doc.floors[0].authored.structural.length,limit=count*64*4;
  const instrumented={...Model,buildScene:(context,project)=>Model.buildScene(copy(context),copy(project)),canonicalDocument(project){
    const canonical=Model.canonicalDocument(project);
    for(const record of canonical.floors[0].authored.structural){
      const anchors=record.anchors;
      Object.defineProperty(record,'anchors',{enumerable:true,get(){
        assert.ok(++reads<=limit,`Host traversal exceeded ${limit} anchor reads`);
        return anchors;
      }});
    }
    return canonical;
  }};
  const sandbox={module:{exports:{}},require:()=>instrumented};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','planner-projection.js'),'utf8'),sandbox);
  const drawing=sandbox.module.exports.build(doc);
  assert.ok(reads>0,'The traversal work counter must be exercised');
  return copy(drawing);
}
test('22 doubly linked beams resolve with bounded branching work, not exponential traversal',()=>{
  const doc=branching(22),before=JSON.stringify(doc);
  Model.validateProject(doc);
  const drawing=boundedBuild(doc);
  assert.equal(drawing.authored.length,22);
  for(const entry of drawing.authored){
    assert.equal(entry.anchorStatus,'resolved');
    assert.deepEqual(entry.anchors,drawing.authored[0].anchors);
  }
  assert.equal(JSON.stringify(doc),before);
});
test('branching cyclic hosts also have bounded work and retain cyclic diagnostics',()=>{
  const drawing=boundedBuild(branching(22,true));
  for(const entry of drawing.authored){
    assert.equal(entry.anchorStatus,'unresolved');
    assert.ok(entry.anchors.every(anchor=>anchor.causeCode==='cyclic-host'));
  }
});
test('memoized shallow hosts do not bypass the 64-level limit in deeper callers or depend on record order',()=>{
  const doc=branching(70),drawing=boundedBuild(doc);
  for(let i=0;i<70;i++){
    const entry=drawing.authored[i];
    assert.equal(entry.anchorStatus,i<64?'resolved':'unresolved',entry.record.id);
    if(i>=64)assert.ok(entry.anchors.every(anchor=>anchor.causeCode==='host-depth-limit'));
  }
  doc.floors[0].authored.structural.reverse();
  const reverse=boundedBuild(doc);
  assert.deepEqual(reverse.authored.slice().reverse(),drawing.authored);
});
for(const length of [1,63,64,65])test(`cycle length ${length} preserves cycle versus depth-limit precedence`,()=>{
  const doc=branching(length);
  for(let i=0;i<length;i++)doc.floors[0].authored.structural[i].anchors=
    [entity(beamId((i+1)%length)),entity(beamId((i+1)%length))];
  const drawing=boundedBuild(doc);
  for(const entry of drawing.authored)assert.ok(entry.anchors.every(anchor=>
    anchor.causeCode===(length<64?'cyclic-host':'host-depth-limit')));
});
test('memoized branching diagnostics match path-local traversal across mixed cyclic and broken hosts',()=>{
  let seed=17;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let sample=0;sample<80;sample++){
    const doc=branching(6),records=doc.floors[0].authored.structural;
    for(const record of records)record.anchors=[0,1].map(()=>{
      const choice=random()%9;
      return choice<7?entity(beamId(choice)):choice===7?point():null;
    });
    function expected(ref,trail=new Set()){
      if(ref===null)return 'unknown-anchor';
      if(trail.size>=64)return 'host-depth-limit';
      if(ref.kind==='point')return 'resolved';
      const record=records.find(item=>item.id===ref.entityId);
      if(!record)return 'missing-host';
      if(trail.has(record.id))return 'cyclic-host';
      const next=new Set(trail);next.add(record.id);
      return record.anchors.map(anchor=>expected(anchor,next)).find(code=>code!=='resolved')||'resolved';
    }
    const drawing=Projection.build(doc);
    for(const entry of drawing.authored)assert.deepEqual(
      entry.anchors.map(anchor=>anchor.causeCode||anchor.code||anchor.status),
      entry.record.anchors.map(anchor=>expected(anchor)),`Graph ${sample}: ${entry.record.id}`);
  }
});

function namespacedProject(separator){
  const doc=createFixture('setback-plot').project,ground=doc.floors[0],plan=ground.legacy.context.plan;
  const externalId='ground/external';
  const renamed=id=>`ground${separator}${id==='living'?'room':id}`;
  for(const room of plan.placed)room.req.id=renamed(room.req.id);
  for(const item of [...plan.furniture,...plan.openings.doors,...plan.openings.windows]){
    item.id=renamed(item.id);
    item.roomId=renamed(item.roomId);
    if(item.targetRoomId)item.targetRoomId=renamed(item.targetRoomId);
  }
  // Both source and already compiled room references are accepted by the model.
  plan.furniture[1].roomId=`ground:${plan.furniture[1].roomId}`;
  ground.obstacles[0].id=renamed('neighbor');
  ground.furnitureEdits={[`ground:${renamed('sofa')}`]:{headLocal:'E',pinned:true}};
  ground.doorEdits={[`ground:${renamed('entry')}`]:{openFraction:.25}};
  ground.windowEdits={[`ground:${renamed('living-window')}`]:{openFraction:.5}};
  doc.legacy=copy(ground.legacy);
  for(const key of ['furnitureEdits','doorEdits','windowEdits','obstacles'])doc[key]=copy(ground[key]);
  let scene=Model.buildScene(doc.legacy.context,doc);
  const opening=scene.openings.find(item=>item.sourceId===renamed('living-window'));
  plan.openings.windows[0].wallId=opening.wallId;
  const wall=scene.walls.find(item=>!item.exterior);
  ground.wallEdits={[wall.id]:{full:false,offsetM:.1,widthM:.1}};
  ground.electrical=[{id:'ground:point',wallId:wall.id}];
  ground.legacy.manualLayouts=[['layout',{rooms:{[renamed('living')]:{id:renamed('living')}}}]];
  doc.legacy=copy(ground.legacy);doc.wallEdits=copy(ground.wallEdits);doc.electrical=copy(ground.electrical);
  scene=Model.buildScene(doc.legacy.context,doc);
  const a=ground.authored=Model.emptyAuthored();
  for(const [kind,list] of [['room',scene.rooms],['opening',scene.openings],['furniture',scene.furniture],['obstacle',scene.obstacles]])
    for(const item of list)a.annotations.push({id:`ground:authored:${kind}-${a.annotations.length}`,text:'ground:keep text',anchor:entity(item.id,kind)});
  a.annotations.push({id:'ground:authored:wall',text:'Wall host',
    anchor:{kind:'wall',floorId:'ground',entityId:wall.id,offsetM:0,heightM:0}});
  a.fixtures.push({id:'ground:authored:fixture',kind:'basin',anchor:entity(scene.rooms[0].id,'room'),
    widthM:null,depthM:null,heightM:null});
  a.serviceNodes.push({id:'ground:authored:node',system:'water',kind:'fixture',
    anchor:entity('ground:authored:fixture','fixture'),diameterMm:null,invertM:null});
  a.serviceRoutes.push({id:'ground:authored:route',system:'water',
    from:{floorId:'ground',entityId:'ground:authored:node'},to:{floorId:externalId,entityId:`${externalId}:authored:node`},
    via:[point()],diameterMm:null,slope:null});
  const external=copy(ground);
  external.id=externalId;external.name='External floor';
  for(const key of ['wallEdits','doorEdits','windowEdits','furnitureEdits'])external[key]={};
  external.electrical=[];
  external.authored=Model.emptyAuthored();
  external.authored.serviceNodes=[{...copy(a.serviceNodes[0]),id:`${externalId}:authored:node`,
    anchor:{...point(),floorId:externalId}}];
  // This external source ID deliberately contains the original floor's namespace.
  const externalRoom=`${externalId}:${plan.placed[0].req.id}`;
  a.annotations.push({id:'ground:authored:external',text:'External',anchor:entity(externalRoom,'room',externalId)});
  doc.floors.push(external);
  return doc;
}
for(const separator of ['/',':'])for(const inactive of [false,true])
  test(`copy ${inactive?'inactive':'active'} floor with ${separator} namespace-like source IDs preserves every host`,()=>{
    const doc=namespacedProject(separator),controller=controllerFor(doc);
    const before=controller.getDrawingScene(),source=copy(controller.getProject().floors[0]);
    assert.ok(before.authored.every(entry=>entry.anchorStatus==='resolved'));
    if(inactive)controller.execute({type:'select-floor',id:doc.floors[1].id});
    controller.execute({type:'add-floor',copyFromId:'ground'});
    const copied=controller.getProject(),id=copied.activeFloorId,dest=copied.floors.find(floor=>floor.id===id);
    const drawing=controller.getDrawingScene(),scene=controller.getScene();
    assert.ok(drawing.authored.every(entry=>entry.anchorStatus==='resolved'),
      JSON.stringify(drawing.diagnostics.filter(issue=>issue.code.includes('host'))));
    assert.deepEqual(copied.floors[0],source);
    assert.deepEqual(dest.legacy.context.plan.placed,source.legacy.context.plan.placed);
    assert.deepEqual(dest.legacy.manualLayouts,source.legacy.manualLayouts);
    for(const kind of ['rooms','openings','furniture']){
      const original=before.scenes[0][kind];
      assert.deepEqual(scene[kind].map(item=>item.sourceId),original.map(item=>item.sourceId));
      assert.deepEqual(scene[kind].map(item=>item.id),original.map(item=>id+item.id.slice('ground'.length)));
    }
    assert.deepEqual(Object.keys(dest.wallEdits),Object.keys(source.wallEdits).map(key=>id+key.slice('ground'.length)));
    assert.equal(dest.electrical[0].wallId,id+source.electrical[0].wallId.slice('ground'.length));
    assert.equal(dest.legacy.context.plan.openings.windows[0].wallId,
      id+source.legacy.context.plan.openings.windows[0].wallId.slice('ground'.length));
    assert.equal(scene.furniture.find(item=>item.sourceId===`ground${separator}sofa`).headLocal,'E');
    assert.equal(scene.openings.find(item=>item.sourceId===`ground${separator}entry`).openFraction,.25);
    assert.equal(scene.openings.find(item=>item.sourceId===`ground${separator}living-window`).openFraction,.5);
    assert.deepEqual(dest.authored.annotations.at(-1).anchor,source.authored.annotations.at(-1).anchor);
    assert.deepEqual(dest.authored.serviceRoutes[0].to,source.authored.serviceRoutes[0].to);
    assert.equal(dest.authored.serviceRoutes[0].from.entityId,`${id}:authored:node`);
    assert.equal(dest.authored.serviceNodes[0].anchor.entityId,`${id}:authored:fixture`);
    assert.equal(dest.authored.annotations[0].text,'ground:keep text');
    const saved=controller.exportProject();
    controller.undo();assert.equal(controller.getProject().floors.length,2);
    controller.redo();assert.equal(controller.getProject().floors.length,3);
    assert.ok(controller.getDrawingScene().authored.every(entry=>entry.anchorStatus==='resolved'));
    assert.ok(controllerFor(Model.parseProject(saved)).getDrawingScene().authored.every(entry=>entry.anchorStatus==='resolved'));
  });
