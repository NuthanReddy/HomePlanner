'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Model=require('../planner-model.js'),Projection=require('../planner-projection.js');
const Electrical=require('../electrical-planner.js'),Light=require('../planner-light.js');
const Display=require('../planner-light-display.js'),View=require('../planner-3d.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function record(scene,suffix,anchor,elevationM){
  return {version:1,id:`${scene.floorId}:electrical:${suffix}`,floorId:scene.floorId,
    roomId:scene.rooms[0].id,type:'light',label:suffix,purpose:'Authored lighting intent',
    loadCategory:'unknown',anchor,elevationM,elevationReference:'mounting-point',
    envelope:{widthM:null,heightM:null,depthM:null,referenceOffsetM:null},
    inputs:{wetArea:'unknown'},origin:{kind:'manual'}};
}
function setup(){
  const project=createFixture('multiple-floors').project;
  for(const [i,floor] of project.floors.entries()){
    floor.legacy.context.plate.sitePlot={x:-1-2*i,y:-2-3*i,w:20,h:20};
    floor.heightM=floor.wallHeightM+project.building.roofThicknessM;floor.electrical=[];
  }
  project.legacy=copy(project.floors[0].legacy);project.electrical=[];
  const planner=controllerFor(project);
  for(const floor of project.floors){
    planner.execute({type:'select-floor',id:floor.id});
    const scene=planner.getScene(),r=scene.rooms[0].rect,xy={x:r.x+r.w/2,y:r.y+r.h/2};
    const records=[
      record(scene,'ceiling',{kind:'ceiling',...xy},scene.wallHeightM),
      record(scene,'floor',{kind:'floor',...xy},0),
      record(scene,'unset-ceiling',{kind:'ceiling',...xy},null),
      record(scene,'broken',{kind:'wall',wallId:`${floor.id}:missing`,face:'left',offsetM:1},1)];
    let wallRecord;
    for(const wall of scene.walls){
      const candidate=record(scene,'unset-wall',{kind:'wall',wallId:wall.id,face:'left',
        offsetM:Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y)/2},null);
      if(Electrical.resolveAnchor(candidate,scene,Model).drawable){wallRecord=candidate;break;}
    }
    assert.ok(wallRecord,'real compiled floor has a supported full-height wall');
    records.push(wallRecord,{...copy(wallRecord),id:`${floor.id}:electrical:wall`,elevationM:1});
    // This is the real editor command used by Electrical.savePoint, not a synthetic scene-only insertion.
    planner.execute({type:'set-electrical',value:records});
  }
  planner.execute({type:'select-floor',id:project.floors[0].id});
  return planner;
}
function config(drawing){
  const period={startUTC:'2026-09-15T06:00:00Z',endUTC:'2026-09-15T07:00:00Z'};
  return {version:1,workplanes:Light.discover(drawing).rooms.map((r,i)=>({
    id:`p${i}`,room:r.ref,heightM:.8,spacingM:5})),sky:{enabled:false},
    minSunAltitudeDeg:1,windowOptics:{mode:'ideal-clear'},neighborBoxes:[],
    neighbors:Object.fromEntries(['front','right','rear','left'].map(s=>[s,{state:'clear'}])),
    roofContext:[],period,samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',
      sunENU:{east:0,north:0,up:1}}]};
}
test('ordinary editor electrical anchors resolve against each raw floor once, without changing saved records',()=>{
  const planner=setup(),project=planner.getProject(),before=JSON.stringify(project);
  const raw=planner.getScenes(),drawing=planner.getDrawingScene(),inventory=Light.discover(drawing);
  assert.notDeepEqual(raw[0].plot,raw[1].plot);
  assert.notEqual(raw[0].floorElevationM,raw[1].floorElevationM);
  for(const floor of raw){
    const projected=drawing.scenes.find(f=>f.floorId===floor.floorId);
    for(const original of floor.electrical){
      const expected=Electrical.resolveAnchor(original,floor,Model);
      const derived=projected.electrical.find(e=>e.id===original.id);
      const row=inventory.electrical.find(e=>e.record.id===original.id);
      for(const key of Object.keys(original))assert.deepEqual(derived[key],original[key]);
      assert.equal(derived.coordinateSpace,'site-local');
      assert.deepEqual(derived.positionDiagnostics,expected.checks);
      assert.equal(row.heightM,original.elevationM);
      if(expected.drawable){
        near(derived.resolvedPoint.x,expected.position.x-floor.plot.x);
        near(derived.resolvedPoint.y,expected.position.y-floor.plot.y);
        assert.equal(derived.resolvedPoint.z,expected.position.z);
        assert.equal(row.positionStatus,'supplied-site-local');
      }else{
        assert.equal(derived.resolvedPoint,null);assert.equal(row.point,null);
        assert.equal(row.positionStatus,'unprojected-intent');
      }
      assert.ok(Object.isFrozen(derived));assert.ok(Object.isFrozen(derived.positionDiagnostics));
    }
  }
  assert.equal(JSON.stringify(project),before);
  assert.equal(JSON.stringify(planner.getProject()),before);
  const restored=controllerFor(JSON.parse(before)).getDrawingScene();
  assert.deepEqual(restored,drawing);
});
test('missing browser resolver and arbitrary legacy point never silently become projected anchors',()=>{
  const planner=setup(),raw=copy(planner.getScenes()[0]);
  raw.electrical.push({id:'legacy',coordinateSpace:'site-local',point:{x:1,y:2,z:3}});
  const common=Projection.projectScene(raw);
  assert.equal(common.electrical.at(-1).resolvedPoint,null);
  assert.deepEqual(common.electrical.at(-1).point,raw.electrical.at(-1).point);
  const sandbox={HomePlannerModel:Model};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-projection.js'),'utf8'),sandbox);
  const missing=sandbox.HomePlannerProjection.projectScene(raw);
  assert.ok(missing.electrical.every(e=>e.resolvedPoint===null));
  assert.ok(missing.electrical.every(e=>e.positionDiagnostics[0].code==='electrical-resolver-unavailable'));
  // Lookup is dynamic: loading the resolver after the projection script is supported.
  sandbox.HomePlannerElectrical=Electrical;
  assert.deepEqual(copy(sandbox.HomePlannerProjection.projectScene(raw)),common);
});
test('electrical changes invalidate conservative snapshot keys although they never alter rays',()=>{
  const planner=setup(),drawing=planner.getDrawingScene(),c=config(drawing),first=Light.run(drawing,c);
  const changed=copy(planner.getProject()),floor=changed.floors[0];
  floor.electrical[0].anchor.x+=.1;changed.electrical=copy(floor.electrical);
  const next=Projection.build(changed),second=Light.run(next,c);
  assert.equal(next.revision,drawing.revision);
  assert.notEqual(Light.discover(next).physicalFingerprint,Light.discover(drawing).physicalFingerprint);
  assert.notEqual(first.provenance.inputFingerprint,second.provenance.inputFingerprint);
  assert.deepEqual(second.direct.masks,first.direct.masks);
  assert.equal(Light.run(next,c,{expectedPhysicalFingerprint:first.inventory.physicalFingerprint}).status,'blocked');
  assert.equal(View.currentLight(next,changed,{result:first,visualization:{showElectrical:true}},Light).result,null);
});
test('real projected electrical records render 2D intent and only known xyz reaches 3D',async()=>{
  const THREE=await import('../vendor/three/three.module.min.js');
  const planner=setup(),project=planner.getProject(),drawing=planner.getDrawingScene();
  const result=Light.run(drawing,config(drawing));
  assert.equal(result.status,'complete',JSON.stringify(result.findings));
  const display=Display.createView(result,{floorId:project.activeFloorId,showElectrical:true});
  const active=display.electricalRows.filter(row=>row.inScope);
  assert.equal(active.filter(row=>row.markerVisible).length,4);
  const unset=active.find(row=>row.record.id.endsWith(':unset-wall'));
  assert.equal(unset.point.z,null);assert.equal(unset.heightStatus,'height-unknown');
  for(const row of active.filter(row=>row.markerVisible))assert.ok(display.svg.includes(`data-electrical="${row.shortKey}"`));
  for(const headingDeg of [0,37,90,271]){
    const rotated=copy(drawing);rotated.scenes.forEach(f=>{f.headingDeg=headingDeg;});
    const rotatedResult=Light.run(rotated,config(rotated));
    const lightData=View.currentLight(rotated,project,{result:rotatedResult,
      visualization:{showElectrical:true,metric:'direct',intervalIndex:0,modeled:false}},Light);
    const content=View.buildContent(THREE,rotated.scenes,project,Model,{lightStudy:true,lightData});
    try{
      const markers=content.lightStudy.objects.filter(o=>o.userData.lightElectricalId);
      assert.equal(markers.length,6,'three known xyz per floor; no unknown-height or orphan mesh');
      for(const marker of markers){
        const row=rotatedResult.inventory.electrical.find(e=>e.record.id===marker.userData.lightElectricalId);
        assert.ok(row);assert.ok(Number.isFinite(row.point.z));
        near(marker.geometry.attributes.position.getY(0),row.point.z);
        const floor=rotated.scenes.find(f=>f.floorId===row.floorId);
        const world=Projection.siteToWorld({...row.point,x:row.point.x-floor.plot.w/2,
          y:row.point.y-floor.plot.h/2},headingDeg);
        near(marker.geometry.attributes.position.getX(0),world.east,1e-6);
        near(marker.geometry.attributes.position.getZ(0),-world.north,1e-6);
      }
    }finally{View.disposeObject(content.group);}
  }
});
