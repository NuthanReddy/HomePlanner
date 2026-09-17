'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const L=require('../planner-light.js'),Physics=require('../building-physics.js'),Projection=require('../planner-projection.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const near=(a,b,e=1e-9)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=e,`${a} != ${b} (tolerance ${e})`);
const clear=()=>Object.fromEntries(['front','right','rear','left'].map(side=>[side,{state:'clear'}]));
const period={startUTC:'2026-09-15T06:00:00Z',endUTC:'2026-09-15T07:00:00Z'};
const interval=(sunENU={east:0,north:0,up:1},extra={})=>({...period,sampleUTC:'2026-09-15T06:30:00Z',sunENU,...extra});
const box=(extra={})=>({id:'box',type:'building',x:-1,y:-1,w:2,h:2,baseM:2,heightM:1,transmittance:0,...extra});
const wall=(extra={})=>({id:'wall',start:{x:-2,y:1},end:{x:2,y:1},thicknessM:.2,baseM:0,heightM:3,removed:false,exterior:false,...extra});
function scene(extra={}){
  return {version:1,kind:'DrawingScene',projectId:'project',revision:1,inputFingerprint:'source-1',
    siteDatum:{elevationM:null},diagnostics:[],authored:[],scenes:[{
      floorId:'f',coordinateSpace:'site-local',floorElevationM:0,headingDeg:0,wallHeightM:3,
      floor:{x:-20,y:-20,w:40,h:40},plot:{x:-20,y:-20,w:40,h:40},
      building:{x:-1.1,y:-1.1,w:2.2,h:2.2},
      rooms:[{id:'room',rect:{x:-.05,y:-.05,w:.1,h:.1}}],walls:[],openings:[],obstacles:[],
      unresolvedOpenings:[],diagnostics:[],electrical:[],...extra}]};
}
function config(extra={}){
  return {version:1,id:'analytic',workplanes:[{id:'plane',room:{floorId:'f',entityId:'room'},heightM:1,spacingM:1}],
    sky:{enabled:true,radialBands:16,azimuthSectors:64},
    minSunAltitudeDeg:1,windowOptics:{mode:'ideal-clear'},neighbors:clear(),neighborBoxes:[],
    roofContext:[{floorId:'f',state:'none',source:'Analytic open plane explicitly has no ceiling or roof.'}],
    period:copy(period),samples:[interval()],...extra};
}
test('workplanes sample exact clipped usable-area cells, never the reserved bounding-box portion',()=>{
  const drawing=scene(),r=drawing.scenes[0].rooms[0];
  r.reservedAreaM2=r.rect.w*r.rect.h/2;
  r.usableRegions=[{...r.rect,w:r.rect.w/2}];
  const before=JSON.stringify(drawing);
  const result=L.run(drawing,config());
  assert.equal(result.status,'complete');
  assert.equal(result.sensors.length,1);
  near(result.sensors[0].areaWeightM2,r.rect.w*r.rect.h/2);
  assert.ok(result.sensors[0].point.x<r.rect.x+r.rect.w/2);
  near(result.sensors[0].cell.w,r.rect.w/2);
  assert.equal(JSON.stringify(drawing),before);
  r.reservedAreaM2=0;r.usableRegions=[copy(r.rect)];
  assert.equal(L.run(drawing,config()).status,'complete');
  r.usableRegions=[{...r.rect,x:r.rect.x+r.rect.w}];
  assert.throws(()=>L.discover(drawing),/outside the room bounding rectangle/);
});
function apertureScene(){
  return scene({roofThicknessM:.2,
    walls:[wall({id:'front',start:{x:-1,y:1},end:{x:1,y:1}}),
      wall({id:'back',start:{x:-1,y:-1},end:{x:1,y:-1}}),
      wall({id:'left',start:{x:-1,y:-1},end:{x:-1,y:1}}),
      wall({id:'right',start:{x:1,y:-1},end:{x:1,y:1}})],
    openings:[{id:'window',wallId:'front',kind:'window',offsetM:.5,widthM:1,sillM:1,heightM:1,openFraction:0}]});
}
const apertureConfig=(extra={})=>config({roofContext:[],...extra});
const access=r=>r.sky.sensorResults[0].cosineWeightedSkyAccess;
const modeled=r=>r.sky.sensorResults[0].modeledCosineWeightedSkyAccess;
function finiteFrozen(v){
  if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(finiteFrozen);}
  else if(typeof v==='number')assert.ok(Number.isFinite(v));else assert.notEqual(typeof v,'undefined');
}
test('browser/CommonJS contract, frozen JSON snapshots and immutable source',()=>{
  const sandbox={BuildingPhysics:Physics,HomePlannerProjection:Projection};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-light.js'),'utf8'),sandbox);
  assert.deepEqual(Object.keys(sandbox.HomePlannerLight),Object.keys(L));
  finiteFrozen(L.CONFIG_SCHEMA);assert.deepEqual(copy(L.CONFIG_SCHEMA),L.CONFIG_SCHEMA);
  assert.equal(L.CONFIG_SCHEMA.properties.version.const,1);
  assert.ok(L.CONFIG_SCHEMA.required.includes('workplanes'));
  const s=scene(),c=config(),before=JSON.stringify({s,c}),r=L.run(s,c);
  assert.equal(r.status,'complete');finiteFrozen(r);assert.deepEqual(copy(r),r);
  assert.equal(JSON.stringify({s,c}),before);
  assert.deepEqual(copy(sandbox.HomePlannerLight.run(s,c)),r);
});
test('analytic full sky horizontal plane = 1; explicitly no ceiling; daylight mask/hours',()=>{
  const r=L.run(scene(),config());near(access(r),1);
  assert.equal(r.sky.timeDependence,'geometry-only-not-day-night');
  assert.deepEqual(r.direct.masks[0].directPathWeights,[1]);
  near(r.direct.sensorResults[0].positivePathPresenceHours,1);
  near(r.direct.sensorResults[0].transmittedEquivalentSunHours,1);
  near(r.direct.knownIntervalHours,1);
  assert.equal(r.direct.masks[0].directSunStatus,'sun-above-horizon');
});
test('analytic full block = 0, actual supplied roof; missing roof is never implicitly clear',()=>{
  const enclosed=apertureScene();enclosed.scenes[0].openings=[];
  const r=L.run(enclosed,config({roofContext:[]}));
  near(access(r),0);assert.deepEqual(r.direct.masks[0].directPathWeights,[0]);
  const unknown=L.run(scene(),config({roofContext:[]}));
  assert.equal(unknown.status,'incomplete');assert.equal(access(unknown),null);near(modeled(unknown),1);
  assert.equal(unknown.context.status,'unknown-context');
});
test('analytic half hemisphere = .5 from a known wall at receiver boundary',()=>{
  const s=scene({walls:[wall({start:{x:0,y:-1000},end:{x:0,y:1000},thicknessM:.2,heightM:1000})],
    rooms:[{id:'room',rect:{x:-.15,y:-.05,w:.1,h:.1}}]});
  // Receiver is at x=-.1, exactly on the wall's outer face; rays pointing away leave it.
  for(const radialBands of [4,8,16,32]){
    const r=L.run(s,config({sky:{enabled:true,radialBands,azimuthSectors:radialBands*4}}));
    near(access(r),.5);
  }
});
test('rectangular real aperture with finite reveals converges to independent analytic integral',t=>{
  const s=apertureScene(),d=1.1,a=.5,h=1;
  const expected=d/Math.PI*(Math.atan(a/d)/d-Math.atan(a/Math.sqrt(d*d+h*h))/Math.sqrt(d*d+h*h));
  const evidence=[];
  for(const radialBands of [8,16,32,64,128]){
    const r=L.run(s,apertureConfig({sky:{enabled:true,radialBands,azimuthSectors:4*radialBands}}));
    evidence.push({radialBands,azimuthSectors:radialBands*4,value:access(r),error:Math.abs(access(r)-expected)});
  }
  t.diagnostic(JSON.stringify({benchmark:'finite-thickness-vertical-aperture',expected,evidence}));
  assert.ok(evidence.at(-1).error<.001);assert.ok(evidence.at(-1).error<evidence[0].error);
  assert.ok(evidence.at(-1).value>0&&evidence.at(-1).value<.1);
});
test('explicit visible transmission and door operation weight paths once, not irradiance VLT inference',()=>{
  const s=apertureScene(),vector={east:0,north:-2/Math.sqrt(5),up:1/Math.sqrt(5)};
  s.scenes[0].openings[0].transmittance=.02;
  const clear=L.run(s,apertureConfig({samples:[interval(vector)]}));
  const glass=L.run(s,apertureConfig({samples:[interval(vector)],windowOptics:{mode:'visible-transmission',visibleTransmittance:.4,source:'Analytical optical input'}}));
  near(access(glass),access(clear)*.4);
  near(glass.direct.masks[0].directPathWeights[0],.4);
  near(glass.direct.sensorResults[0].positivePathPresenceHours,1);
  near(glass.direct.sensorResults[0].transmittedEquivalentSunHours,.4);
  const half=copy(s);half.scenes[0].openings[0].openFraction=.5;
  near(L.run(half,apertureConfig({samples:[interval(vector)],windowOptics:{mode:'visible-transmission',visibleTransmittance:.4,source:'test'}})).direct.masks[0].directPathWeights[0],.7);
  s.scenes[0].openings[0].kind='hinged';s.scenes[0].openings[0].openFraction=.25;
  near(L.run(s,apertureConfig({samples:[interval(vector)]})).direct.masks[0].directPathWeights[0],.25);
});
test('nested room sky-access sampling converges independently of sensor spacing as a physical dimension',t=>{
  const s=apertureScene();s.scenes[0].rooms[0].rect={x:-.4,y:-.4,w:.8,h:.8};
  const integral=(x,y)=>{
    const d=1.1-y,lo=-.5-x,hi=.5-x,b=Math.sqrt(d*d+1);
    return d/(2*Math.PI)*((Math.atan(hi/d)-Math.atan(lo/d))/d-(Math.atan(hi/b)-Math.atan(lo/b))/b);
  };
  let expected=0;
  for(let y=0;y<128;y++)for(let x=0;x<128;x++)expected+=integral(-.4+.8*(x+.5)/128,-.4+.8*(y+.5)/128)/(128*128);
  const evidence=[];
  for(const n of [1,2,4,8]){
    const c=apertureConfig({sky:{enabled:true,radialBands:64,azimuthSectors:256},
      workplanes:[{id:'p',room:{floorId:'f',entityId:'room'},heightM:1,spacingM:.8/n}]});
    const r=L.run(s,c),mean=r.sky.sensorResults.reduce((v,s)=>v+s.cosineWeightedSkyAccess,0)/r.sensors.length;
    evidence.push({n,sensors:r.sensors.length,mean,error:Math.abs(mean-expected)});
  }
  t.diagnostic(JSON.stringify({benchmark:'aperture-room-spatial-sky-access',expected,evidence}));
  assert.ok(evidence.at(-1).error<.001);assert.ok(evidence.at(-1).error<evidence[0].error);
});
test('aperture wall outside opening blocks; roof above and all-storey slab occlude sensors',()=>{
  const r=L.run(apertureScene(),apertureConfig({samples:[interval({east:Math.SQRT1_2,north:0,up:Math.SQRT1_2})]}));
  assert.deepEqual(r.direct.masks[0].directPathWeights,[0]);
  const s=scene(),upper=copy(s.scenes[0]);upper.floorId='upper';upper.floorElevationM=4;upper.roofThicknessM=.2;
  upper.wallHeightM=2;upper.building={x:-100,y:-100,w:200,h:200};upper.rooms=[];
  s.scenes.push(upper);
  const stacked=L.run(s,config());near(access(stacked),0);assert.deepEqual(stacked.direct.masks[0].directPathWeights,[0]);
});
test('facade and all four finite neighbor boxes use actual transmittance and orientations',()=>{
  for(const [side,east,north,x,y] of [['front',0,1,-.5,-2],['right',1,0,1,-.5],['rear',0,-1,-.5,1],['left',-1,0,-2,-.5]]){
    const b={id:'neighbor',x,y,w:1,h:1,baseM:0,heightM:5,transmittance:.4};
    const n=clear();n[side]={state:'modeled',boxIds:['neighbor']};
    const c=config({neighbors:n,neighborBoxes:[b],samples:[interval({east:east*Math.SQRT1_2,north:north*Math.SQRT1_2,up:Math.SQRT1_2})]});
    near(L.run(scene(),c).direct.masks[0].directPathWeights[0],.4);
    const degrees=copy(c);delete degrees.samples[0].sunENU;
    degrees.samples[0].sunAnglesDeg={altitudeDeg:45,azimuthDeg:(Math.atan2(east,north)/Math.PI*180+360)%360};
    near(L.run(scene(),degrees).direct.masks[0].directPathWeights[0],.4);
    const s=scene({obstacles:[box({...b,id:'facade',heightM:6,transmittance:.5,facade:{version:1,finish:null}})]});
    near(L.run(s,c).direct.masks[0].directPathWeights[0],.2);
  }
});
test('neighbor reuses exact project ID/sourceId once without erasing supplied context or provenance',()=>{
  for(const id of ['project-box','physical-source']){
    const s=scene({obstacles:[box({id:'project-box',sourceId:'physical-source',transmittance:.5})]});
    const b=box({id,transmittance:.5});delete b.type;
    const c=config({neighborBoxes:[b],neighbors:{...clear(),front:{state:'modeled',boxIds:[id]}}});
    const before=JSON.stringify({s,c}),baseline=L.run(s,config()),r=L.run(s,c);
    near(baseline.direct.masks[0].directPathWeights[0],.5);
    near(r.direct.masks[0].directPathWeights[0],.5);
    assert.equal(r.status,'complete');assert.equal(r.context.status,'known-supplied-model');
    assert.ok(r.findings.some(f=>f.code==='reused-project-obstacle'&&['warning','info'].includes(f.severity)));
    assert.equal(r.sampling.kernel.casterCount,1);
    assert.deepEqual(r.config.neighborBoxes,[b]);assert.deepEqual(r.context.neighbors,c.neighbors);
    assert.notEqual(r.provenance.inputFingerprint,baseline.provenance.inputFingerprint);
    assert.equal(JSON.stringify({s,c}),before);
  }
});
test('conflicting or unconfirmed duplicate box identities block before kernel compilation',()=>{
  const original=box({id:'project-box',sourceId:'physical-source',transmittance:.5});
  for(const changes of [{id:'other'},{id:'other',transmittance:.3},{id:'project-box',w:3},
    {id:'physical-source',transmittance:.3}]){
    const b={...original,...changes};delete b.type;delete b.sourceId;
    const r=L.run(scene({obstacles:[original]}),config({
      neighborBoxes:[b],neighbors:{...clear(),front:{state:'modeled',boxIds:[b.id]}}}));
    assert.equal(r.status,'blocked');assert.equal(r.sampling.kernel,null);
    assert.ok(r.findings.some(f=>f.severity==='blocking'&&/physical-obstacle/.test(f.code)));
  }
  const tree=box({id:'tree',type:'tree',transmittance:.5}),b={...tree};delete b.type;
  const r=L.run(scene({obstacles:[tree]}),config({neighborBoxes:[b],
    neighbors:{...clear(),front:{state:'modeled',boxIds:['tree']}}}));
  assert.equal(r.status,'blocked');assert.equal(r.sampling.kernel,null);
  for(const transmittance of [.5,.3]){
    const boxes=[box({id:'one',transmittance:.5}),box({id:'two',transmittance})]
      .map(({type,...b})=>b);
    const r=L.run(scene(),config({neighborBoxes:boxes,
      neighbors:{...clear(),front:{state:'modeled',boxIds:['one','two']}}}));
    assert.equal(r.status,'blocked');assert.equal(r.sampling.kernel,null);
  }
});
test('nearby and genuinely overlapping independent boxes still attenuate independently',()=>{
  for(const delta of [1e-10,.25]){
    const s=scene({obstacles:[box({id:'project-box',transmittance:.5})]});
    const b=box({id:'independent',x:-1+delta,transmittance:.5});delete b.type;
    const r=L.run(s,config({neighborBoxes:[b],
      neighbors:{...clear(),front:{state:'modeled',boxIds:[b.id]}}}));
    assert.equal(r.status,'complete');near(r.direct.masks[0].directPathWeights[0],.25);
    assert.equal(r.sampling.kernel.casterCount,2);
  }
});
test('same physical obstacle source repeated across floors applies once',()=>{
  const s=scene({obstacles:[box({sourceId:'physical',transmittance:.5})]});
  const upper=copy(s.scenes[0]);upper.floorId='upper';upper.floorElevationM=5;upper.rooms=[];
  upper.obstacles[0].id='upper-box';s.scenes.push(upper);
  const c=config({roofContext:[...config().roofContext,{floorId:'upper',state:'none',source:'explicit'}]});
  const r=L.run(s,c);near(r.direct.masks[0].directPathWeights[0],.5);
  upper.obstacles[0].transmittance=.6;assert.throws(()=>L.run(s,c),/Ambiguous/);
});
test('interstorey gap is unmodeled context, not an invented slab or a trusted clear passage',()=>{
  const s=scene({roofThicknessM:.2}),upper=copy(s.scenes[0]);
  upper.floorId='upper';upper.floorElevationM=4;upper.rooms=[];s.scenes.push(upper);
  const r=L.run(s,config({roofContext:[]}));
  assert.equal(r.status,'incomplete');assert.equal(access(r),null);
  assert.ok(r.findings.some(f=>f.code==='unmodeled-interstorey-gap'));
  assert.equal(r.sampling.kernel.casterCount,2);
});
test('unknown neighbors never become trusted clear; night zero direct does not zero geometry sky',()=>{
  const c=config();c.neighbors.front={state:'unknown'};
  const r=L.run(scene(),c);assert.equal(r.complete,false);assert.equal(access(r),null);near(modeled(r),1);
  assert.deepEqual(r.direct.masks[0].directPathWeights,[null]);
  assert.equal(r.direct.knownIntervalHours,0);assert.equal(r.direct.unknownOrUnprocessedHours,1);
  const night=L.run(scene(),config({samples:[interval({east:0,north:0,up:-1})]}));
  near(access(night),1);near(night.direct.sensorResults[0].positivePathPresenceHours,0);
  assert.equal(night.direct.masks[0].directSunStatus,'night');
  c.samples=[interval({east:0,north:0,up:-1})];
  const unknownNight=L.run(scene(),c);assert.deepEqual(unknownNight.direct.masks[0].directPathWeights,[0]);
  assert.equal(unknownNight.direct.knownIntervalHours,1);assert.equal(access(unknownNight),null);
  assert.equal(unknownNight.direct.complete,true);near(unknownNight.direct.sensorResults[0].positivePathPresenceHours,0);
});
test('arbitrary heading exact shared transform parity, including unequal floor offsets/elevations',()=>{
  const original=apertureScene(),local={x:0,y:2/Math.sqrt(5),z:1/Math.sqrt(5)};
  const base=L.run(original,apertureConfig({samples:[interval({east:0,north:-local.y,up:local.z})]}));
  for(const angle of [17,123.456,271]){
    const s=copy(original);s.scenes[0].headingDeg=angle;
    const world=Projection.siteToWorld(local,angle);
    const r=L.run(s,apertureConfig({samples:[interval({east:world.east,north:world.north,up:world.up})]}));
    near(access(r),access(base));near(r.direct.masks[0].directPathWeights[0],1);
    assert.deepEqual(r.sensors[0].world,copy(Projection.siteToWorld(r.sensors[0].point,angle)));
  }
  const p=createFixture('multiple-floors').project;
  for(let i=0;i<p.floors.length;i++)p.floors[i].legacy.context.plate.sitePlot={x:-1-i,y:-2-i*2,w:20,h:20};
  p.legacy=copy(p.floors[0].legacy);
  const drawing=copy(controllerFor(p).getDrawingScene());
  for(const f of drawing.scenes)f.headingDeg=37.25;
  const inv=L.discover(drawing),c=config({roofContext:[],workplanes:inv.rooms.slice(0,1).concat(inv.rooms.filter(r=>r.ref.floorId==='upper').slice(0,1))
    .map((r,i)=>({id:'p'+i,room:r.ref,heightM:.7,spacingM:5}))});
  const r=L.run(drawing,c);
  assert.notEqual(r.status,'blocked');
  for(const sensor of r.sensors){
    const f=drawing.scenes.find(f=>f.floorId===sensor.room.floorId),room=f.rooms.find(q=>q.id===sensor.room.entityId);
    near(sensor.point.z,f.floorElevationM+.7);
    assert.ok(sensor.point.x>room.rect.x&&sensor.point.x<room.rect.x+room.rect.w);
    assert.ok(sensor.point.y>room.rect.y&&sensor.point.y<room.rect.y+room.rect.h);
    assert.deepEqual(sensor.world,Projection.siteToWorld(sensor.point,37.25));
  }
  assert.ok(new Set(r.sensors.map(s=>s.room.floorId)).size>=2);
});
test('nested spatial grids converge for a fixed sharp shade boundary without resizing the room',t=>{
  const s=scene({rooms:[{id:'room',rect:{x:0,y:0,w:1,h:1}}],obstacles:[box({x:0,y:0,w:.3,h:1,baseM:2})]});
  const evidence=[];
  for(const n of [2,4,8,16,32]){
    const c=config({sky:{enabled:false},workplanes:[{id:'p',room:{floorId:'f',entityId:'room'},heightM:1,spacingM:1/n}]});
    const r=L.run(s,c),mean=r.direct.masks[0].directPathWeights.reduce((a,b)=>a+b,0)/r.sensors.length;
    evidence.push({n,sensors:r.sensors.length,mean,error:Math.abs(mean-.7)});
  }
  t.diagnostic(JSON.stringify({benchmark:'spatial-vertical-shade-boundary',expected:.7,evidence}));
  assert.ok(evidence.at(-1).error<.02);assert.ok(evidence.at(-1).error<evidence[0].error);
});
test('interval durations are weighted, gaps/cancel/finalize-partial stay incomplete with guarded totals',()=>{
  const s=scene(),c=config({samples:[
    interval(undefined,{endUTC:'2026-09-15T06:15:00Z',sampleUTC:'2026-09-15T06:07:30Z'}),
    interval({east:0,north:0,up:-1},{startUTC:'2026-09-15T06:15:00Z',sampleUTC:'2026-09-15T06:37:30Z'})]});
  near(L.run(s,c).direct.sensorResults[0].positivePathPresenceHours,.25);
  c.samples.pop();const gap=L.run(s,c);
  assert.equal(gap.status,'incomplete');near(gap.direct.knownIntervalHours,.25);near(gap.direct.unknownOrUnprocessedHours,.75);
  assert.equal(gap.direct.sensorResults[0].positivePathPresenceHours,null);
  const study=L.createStudy(s,config()),initial=study.getResult();study.step(5);
  assert.equal(initial.progress.processedRays,0);assert.equal(study.progress().processedRays,5);
  const stopped=study.cancel();assert.equal(stopped.status,'cancelled');assert.equal(stopped.sky.sensorResults[0].cosineWeightedSkyAccess,null);
  const before=JSON.stringify(stopped);study.step();assert.equal(JSON.stringify(study.getResult()),before);
  const partial=L.createStudy(s,config()).finalize();assert.equal(partial.status,'incomplete');assert.equal(partial.complete,false);
});
test('small worker batches are real chunks; masks commit only after an entire interval',()=>{
  const s=scene({rooms:[{id:'room',rect:{x:0,y:0,w:2,h:2}}]}),c=config({sky:{enabled:false}});
  const a=L.createStudy(s,c);a.step(1);
  assert.equal(a.getResult().direct.masks.length,0);
  assert.equal(a.progress().processedRays,1);
  while(!a.progress().computationalComplete)a.step(1);
  assert.deepEqual(a.finalize(),L.run(s,c));
});
test('near-horizon is unresolved, not zero shade; UTC timestamps, angles and site schema are strict',()=>{
  const c=config({samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',sunAnglesDeg:{azimuthDeg:20,altitudeDeg:.5}}],
    site:{latitudeDeg:17.3,longitudeDeg:78.5,timeZone:'Asia/Kolkata'}});
  const r=L.run(scene(),c);assert.equal(r.status,'incomplete');
  assert.equal(r.direct.masks[0].directSunStatus,'near-horizon-unresolved');
  assert.deepEqual(r.direct.masks[0].directPathWeights,[null]);near(r.direct.nearHorizonUnresolvedHours,1);
  const bad=copy(c);bad.samples[0].startUTC='2026-11-01T01:30:00';assert.throws(()=>L.normalizeConfig(bad),TypeError);
  bad.samples[0].startUTC='2026-09-15T06:00:00+00:00';assert.throws(()=>L.normalizeConfig(bad),TypeError);
  bad.samples[0].startUTC='2026-02-30T06:00:00Z';assert.throws(()=>L.normalizeConfig(bad),RangeError);
  assert.throws(()=>L.normalizeConfig({...c,site:{latitudeDeg:'17'}}),TypeError);
  assert.throws(()=>L.normalizeConfig({...c,samples:[interval({east:1,north:1,up:1})]}),RangeError);
  assert.throws(()=>L.normalizeConfig({...c,samples:[interval(undefined,{sampleUTC:'2026-09-15T06:10:00Z'})]}),RangeError);
  for(const angles of [{altitudeDeg:45,azimuthDeg:90},{altitudeDeg:45,azimuthDeg:180},{altitudeDeg:45,azimuthDeg:270}]){
    const r=L.run(scene(),config({samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',sunAnglesDeg:angles}]}));
    assert.deepEqual(r.direct.masks[0].directPathWeights,[1]);
  }
});
test('missing refs/controls are repairable blocks; malformed numeric fields are strict failures',()=>{
  const c=config();delete c.workplanes[0].heightM;
  assert.equal(L.run(scene(),c).status,'blocked');
  c.workplanes[0].heightM='1';assert.throws(()=>L.run(scene(),c),TypeError);
  c.workplanes[0].heightM=-1;assert.throws(()=>L.run(scene(),c),RangeError);
  assert.equal(L.run(scene(),config({workplanes:[{id:'p',room:{floorId:'wrong',entityId:'room'},heightM:1,spacingM:1}]})).status,'blocked');
  assert.equal(L.run(scene(),{}).status,'blocked');
  const s=apertureScene();s.scenes[0].openings[0].wallId='deleted';
  assert.equal(L.run(s,apertureConfig()).status,'blocked');
  s.scenes[0].openings[0].heightM='2';assert.throws(()=>L.run(s,apertureConfig()),TypeError);
  assert.throws(()=>L.normalizeConfig({...config(),lux:300}),TypeError);
});
test('unknown clear heights/electrical intent do not create physical ceiling, beams or lumens',()=>{
  const s=scene({wallHeightM:null,electrical:[{id:'light',type:'light',x:2,y:3},
    {id:'point',coordinateSpace:'site-local',point:{x:2,y:3,z:null},heightM:null}]});
  const r=L.run(s,config());
  assert.equal(access(r),null);near(modeled(r),1);
  assert.ok(r.findings.some(f=>f.code==='unknown-workplane-height-extent'));
  assert.equal(r.inventory.electrical[0].point,null);assert.equal(r.inventory.electrical[0].heightM,null);
  assert.deepEqual(r.inventory.electrical[1].point,{x:2,y:3,z:null});
  assert.equal(r.sampling.kernel.casterCount,0);
  const high=config();high.workplanes[0].heightM=3;
  assert.equal(L.run(scene(),high).status,'blocked');
});
test('physical content fingerprints reject same-ID/revision replacement and accept history-only revision changes',()=>{
  const s=scene(),c=config(),a=L.run(s,c),replaced=copy(s);
  replaced.scenes[0].obstacles.push(box());replaced.inputFingerprint='same-declared-source';
  const b=L.run(replaced,c);assert.equal(b.provenance.revision,a.provenance.revision);
  assert.notEqual(b.provenance.physicalFingerprint,a.provenance.physicalFingerprint);
  assert.equal(L.compare(a,b).comparable,false);
  assert.equal(L.run(replaced,c,{expectedPhysicalFingerprint:L.discover(s).physicalFingerprint}).status,'blocked');
  s.revision++;s.inputFingerprint='different-history';const history=L.run(s,c);
  assert.equal(L.compare(a,history).comparable,true);
  assert.equal(L.compare(a,history).deltas[0].cosineWeightedSkyAccess,0);
  const other=copy(c);other.workplanes[0].heightM=.5;
  assert.ok(L.compare(a,L.run(s,other)).reasons.includes('different-sensorFingerprint'));
});
test('full canonical JSON budget, not identifier-length budget; bounded densities/cycles/sparse JSON',()=>{
  const s=scene();for(let i=0;i<320;i++)s.scenes[0].rooms.push({id:'r'+i,rect:{x:i,y:0,w:1,h:1}});
  const inv=L.discover(s);assert.ok(inv.physicalFingerprint.length>16384);
  assert.equal(L.run(s,config(),{expectedPhysicalFingerprint:inv.physicalFingerprint}).status,'complete');
  const dense=config();dense.workplanes[0].spacingM=.00001;
  assert.throws(()=>L.createStudy(scene(),dense),/Sensor budget/);
  const rays=config({sky:{enabled:true,radialBands:128,azimuthSectors:512}});
  assert.throws(()=>L.createStudy(scene({rooms:[{id:'room',rect:{x:0,y:0,w:10,h:10}}]}),rays),/ray\/comparison/);
  const sparse=config();sparse.samples=new Array(2);assert.throws(()=>L.normalizeConfig(sparse),/Sparse/);
  const cyclic=config();cyclic.site=cyclic;assert.throws(()=>L.normalizeConfig(cyclic),/Cyclic/);
  assert.throws(()=>L.run(scene(),config(),{expectedPhysicalFingerprint:'x'.repeat(L.LIMITS.jsonCharacters+1)}),/budget/);
  const comparisons=scene({obstacles:Array.from({length:800},(_,i)=>box({id:'block-'+i,x:i}))});
  assert.throws(()=>L.createStudy(comparisons,rays),/ray\/comparison/);
  const start=Date.parse(period.startUTC),samples=Array.from({length:1000},(_,i)=>interval(undefined,{
    startUTC:new Date(start+i*1000).toISOString(),endUTC:new Date(start+(i+1)*1000).toISOString(),
    sampleUTC:new Date(start+i*1000+500).toISOString()}));
  const output=config({sky:{enabled:false},samples,period:{startUTC:period.startUTC,endUTC:samples.at(-1).endUTC}});
  assert.throws(()=>L.createStudy(scene({rooms:[{id:'room',rect:{x:0,y:0,w:10,h:10}}]}),output),/snapshot JSON budget/);
});
test('complete scenario comparison permits numerical/date forcing changes but explains incompatible definitions',()=>{
  const a=L.run(scene(),config()),night=L.run(scene(),config({samples:[interval({east:0,north:0,up:-1})]}));
  const delta=L.compare(a,night);assert.equal(delta.comparable,true);
  near(delta.deltas[0].positivePathPresenceHours,-1);near(delta.deltas[0].cosineWeightedSkyAccess,0);
  const refined=L.run(scene(),config({sky:{enabled:true,radialBands:32,azimuthSectors:128}}));
  assert.equal(L.compare(a,refined).comparable,true);
  const s=scene();s.projectId='other';assert.ok(L.compare(a,L.run(s,config())).reasons.includes('different-projectId'));
  assert.ok(L.compare(a,L.createStudy(scene(),config()).finalize()).reasons.includes('incomplete-study'));
  const optics=config({windowOptics:{mode:'visible-transmission',visibleTransmittance:.4,source:'Explicit'}});
  assert.ok(L.compare(a,L.run(scene(),optics)).reasons.includes('different-optical-definition'));
});
