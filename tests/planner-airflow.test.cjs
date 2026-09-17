const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const A=require('../planner-airflow.js');
const Physics=require('../building-physics.js');
const Projection=require('../planner-projection.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const room=(floorId,entityId)=>({floorId,entityId});
function fixture(){
  const p=createFixture('multiple-floors').project;
  for(const f of p.floors){
    f.legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
    for(const o of [...f.legacy.context.plan.openings.doors,...f.legacy.context.plan.openings.windows]){
      o.openFraction=1;
    }
    f.doorEdits={};f.windowEdits={};
  }
  p.legacy=copy(p.floors[0].legacy);p.doorEdits={};p.windowEdits={};
  return p;
}
function scenario(){
  return {version:1,id:'analytic',densityKgM3:1.2,
    zones:[{id:'living',room:room('ground','ground:living'),volumeM3:30,volumeSource:'Explicit analytical fixture, not measured'}],
    links:[
      {id:'in',kind:'opening',opening:room('ground','ground:entry'),from:'outside',to:'living',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:12},
      {id:'out',kind:'opening',opening:room('ground','ground:living-window'),from:'living',to:'outside',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:0}
    ]};
}
const scene=()=>Projection.build(fixture());
const run=s=>A.run(scene(),s);
const has=(r,code)=>r.findings.some(f=>f.code===code);
test('reserved usable-area regions are retained without substituting their editable bounding rectangle',()=>{
  const drawing=copy(scene()),r=drawing.scenes[0].rooms[0];
  r.reservedAreaM2=r.rect.w*r.rect.h/2;
  r.usableRegions=[{...r.rect,w:r.rect.w/2}];
  const before=JSON.stringify(drawing);
  const discovered=A.discover(drawing).rooms.find(room=>room.ref.entityId===r.id);
  assert.deepEqual(discovered.geometry.usableRegions,r.usableRegions);
  near(discovered.usableAreaM2,r.rect.w*r.rect.h/2);
  assert.equal(A.run(drawing,scenario()).status,'converged');
  assert.equal(JSON.stringify(drawing),before);
  r.reservedAreaM2=0;r.usableRegions=[copy(r.rect)];
  assert.equal(A.run(drawing,scenario()).status,'converged');
  r.usableRegions=[copy(r.rect),copy(r.rect)];
  assert.throws(()=>A.discover(drawing),/non-overlapping/);
});
function manual(id,from,to,fromFloor='ground',toFloor='ground',pressurePa=0){
  return {id,kind:'manual',from,to,enabled:true,freeAreaM2:.5,cd:.6,pressurePa,openFraction:1,
    anchors:{from:{floorId:fromFloor,point:{x:3,y:4,z:fromFloor==='upper'?3.65:.45}},
      to:{floorId:toFloor,point:{x:3,y:4,z:toFloor==='upper'?3.65:.45}}}};
}
function finiteFrozen(v){
  if(v&&typeof v==='object'){
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(finiteFrozen);
  }else if(typeof v==='number')assert.ok(Number.isFinite(v));
  else assert.notEqual(typeof v,'undefined');
}

test('browser global and CommonJS APIs agree; actual bridge projection remains detached frozen JSON',()=>{
  const sandbox={BuildingPhysics:Physics};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-airflow.js'),'utf8'),sandbox);
  assert.deepEqual(Object.keys(sandbox.HomePlannerAirflow),Object.keys(A));
  const controller=controllerFor(fixture()),drawing=controller.getDrawingScene(),s=scenario();
  const before=JSON.stringify({drawing,s}),result=A.run(drawing,s);
  assert.equal(result.status,'converged');
  assert.deepEqual(copy(sandbox.HomePlannerAirflow.run(drawing,s)),result);
  assert.deepEqual(copy(result),result);finiteFrozen(result);
  assert.equal(JSON.stringify({drawing,s}),before);
  assert.notEqual(result.scenario,s);assert.notEqual(result.inventory.rooms[0].geometry,drawing.scenes[0].rooms[0]);
});

test('two equal real openings match analytical pressures, volume flows and aperture-mean speeds',()=>{
  const s=scenario(),r=run(s),q=.6*.5*Math.sqrt(12/1.2);
  assert.equal(r.balanced,true);assert.equal(r.solver.status,'converged');
  near(r.zoneResults[0].pressurePa,6);
  for(const f of r.flowResults){near(f.m3s,q);near(f.meanOpeningSpeedMps,q/.5);assert.deepEqual(f.direction,{from:f.from,to:f.to});}
  near(r.zoneResults[0].inflowM3s,q);near(r.zoneResults[0].outflowM3s,q);
  near(r.zoneResults[0].directOutsideInflowM3s,q);near(r.zoneResults[0].transferInflowM3s,0);
  near(r.zoneResults[0].directOutsideInflowACH,q*3600/30);
  assert.match(r.zoneResults[0].achLabel,/not complete fresh-air/);
  assert.deepEqual(r.solver,Physics.solveAirflow(r.solverInput));
  assert.deepEqual(r.solverInput.links.map(l=>[l.id,l.from,l.to]),r.flowResults.map(f=>[f.solverId,f.solverFrom,f.solverTo]));
  assert.ok(r.solver.residualM3s<=r.solver.toleranceM3s);
});

test('generated multi-floor physical keys are not restricted to short identifier lengths',()=>{
  const project=createFixture('furnished-single').project;
  project.floors[0].legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
  project.legacy=copy(project.floors[0].legacy);
  const bridge=controllerFor(project);
  bridge.execute({type:'add-floor',copyFromId:project.activeFloorId,name:'Upper'});
  const drawing=bridge.getDrawingScene(),inventory=A.discover(drawing);
  assert.equal(inventory.rooms.length,8);
  assert.ok(inventory.physicalFingerprint.length>16384);
  const draft={version:1,densityKgM3:1.2,zones:[{id:'selected',room:inventory.rooms[0].ref,volumeM3:30}],links:[]};
  const result=A.run(drawing,draft,{expectedPhysicalFingerprint:inventory.physicalFingerprint});
  assert.equal(result.status,'converged');
  assert.equal(result.provenance.physicalFingerprint,inventory.physicalFingerprint);
  assert.ok(has(A.run(drawing,draft,{expectedPhysicalFingerprint:inventory.physicalFingerprint+' '}),'stale-physical-input'));
  assert.throws(()=>A.run(drawing,draft,{expectedPhysicalFingerprint:'x'.repeat(A.LIMITS.jsonCharacters+1)}),RangeError);
});

test('reversals preserve exact named link orientation, signed arrows and constant-density mass residual',()=>{
  const s=scenario(),forward=run(s);s.links[0].pressurePa=-12;
  const reverse=run(s);
  for(let i=0;i<2;i++){
    near(reverse.flowResults[i].m3s,-forward.flowResults[i].m3s);
    assert.deepEqual(reverse.flowResults[i].direction,{from:s.links[i].to,to:s.links[i].from});
  }
  near(reverse.zoneResults[0].pressurePa,-6);
  near(reverse.zoneResults[0].netOutflowM3s,reverse.solver.zoneResidualsM3s[reverse.zones[0].solverId]);
  near(reverse.zoneResults[0].massResidualKgS,reverse.zoneResults[0].netOutflowM3s*1.2);
});

test('single opening is a zero-flow dead end, not single-sided exchange',()=>{
  const s=scenario();s.links.pop();
  const r=run(s);
  assert.equal(r.status,'converged');assert.equal(r.flowResults[0].m3s,0);
  assert.equal(r.flowResults[0].direction,null);assert.equal(r.zoneResults[0].deadEnd,true);
  assert.equal(r.zoneResults[0].connectedToOutside,true);assert.equal(r.zoneResults[0].directOutsideInflowACH,0);
});

test('disabled links are explicitly zero with missing inputs retained, not solver defaults',()=>{
  const s=scenario();
  for(const l of s.links){l.enabled=false;l.cd=null;delete l.pressurePa;l.freeAreaM2=null;delete l.opening;}
  const r=run(s);
  assert.equal(r.status,'converged');assert.deepEqual(r.solverInput.links,[]);
  assert.ok(r.links.every(l=>l.state==='disabled'&&l.effectiveAreaM2===0&&l.awaitingInputs.length>=3));
  assert.ok(r.flowResults.every(l=>l.m3s===0&&l.direction===null));
  assert.equal(r.zoneResults[0].sealed,true);assert.equal(r.zoneResults[0].connectedToOutside,false);
  assert.ok(r.findings.every(f=>f.severity==='info'));
  assert.deepEqual(r.components[0],{id:0,zoneIds:['living'],connectedToOutside:false,referenceZoneId:'living',gauge:'arbitrary-zero-Pa',referencePressurePa:0});
});

test('explicit zero area excludes unknown Cd and forcing without inventing them',()=>{
  const s=scenario();for(const l of s.links){l.freeAreaM2=0;l.cd=null;l.pressurePa=null;}
  const r=run(s);
  assert.equal(r.status,'converged');assert.equal(r.solverInput.links.length,0);
  assert.ok(r.links.every(l=>l.state==='closed'&&l.cd===null&&l.pressurePa===null));
  assert.ok(r.flowResults.every(f=>f.m3s===0));assert.equal(r.zoneResults[0].sealed,true);
});

test('closed modeled glazing blocks positive area regardless of optical transmission and swing',()=>{
  const p=fixture();p.windowEdits['ground:living-window']={openFraction:0};
  const d=copy(Projection.build(p)),o=d.scenes[0].openings.find(o=>o.id==='ground:living-window');
  o.transmittance=1;o.swingAngleDeg=90;
  const r=A.run(d,scenario());
  assert.equal(r.status,'blocked');assert.equal(r.solver,null);assert.ok(has(r,'closed-opening-positive-area'));
  assert.match(r.findings.find(f=>f.code==='closed-opening-positive-area').message,/operation.*zero free area.*disable/);
  const s=scenario();s.links[1].enabled=false;
  assert.equal(A.run(d,s).status,'converged');
});

test('current modeled operation is read-only and fractional aperture bound cannot silently clamp',()=>{
  const p=fixture();p.windowEdits['ground:living-window']={openFraction:.2};
  const d=Projection.build(p),s=scenario();
  assert.ok(has(A.run(d,s),'area-exceeds-aperture'));
  s.links[1].openFraction=1;s.links[1].freeAreaM2=.1;
  assert.ok(has(A.run(d,s),'operating-state-mismatch'));
  delete s.links[1].openFraction;
  const r=A.run(d,s);assert.equal(r.status,'converged');
  assert.equal(r.links[1].operation.openFraction,.2);assert.equal(r.links[1].effectiveAreaM2,.1);
});

test('absent model operation requires explicit scenario fraction; no passage, glyph or optical fallback',()=>{
  const d=copy(scene()),o=d.scenes[0].openings.find(o=>o.id==='ground:entry');delete o.openFraction;
  o.kind='passage';o.transmittance=1;
  const s=scenario(),r=A.run(d,s);
  assert.ok(has(r,'missing-openFraction'));assert.equal(r.status,'blocked');
  s.links[0].openFraction=1;assert.equal(A.run(d,s).status,'converged');
});

test('unknown physical inputs and unresolved pointers produce repairable qualified blocking findings',()=>{
  const mutations=[
    [s=>delete s.densityKgM3,'missing-density'],
    [s=>s.densityKgM3=null,'missing-density'],
    [s=>delete s.zones[0].volumeM3,'missing-volume'],
    [s=>s.zones[0].room={floorId:'lost',entityId:'ground:living'},'missing-room-reference'],
    [s=>s.zones[0].room=null,'missing-room-reference'],
    [s=>s.zones[0].room={floorId:'ground'},'missing-room-reference'],
    [s=>s.links[0].opening=null,'missing-opening-reference'],
    [s=>s.links[0].from='deleted-zone','missing-endpoint'],
    [s=>delete s.links[0].from,'missing-endpoint'],
    [s=>delete s.links[0].enabled,'missing-enabled'],
    [s=>s.links[0].freeAreaM2=null,'missing-freeAreaM2'],
    [s=>delete s.links[0].cd,'missing-cd'],
    [s=>s.links[0].pressurePa=null,'missing-pressurePa']
  ];
  for(const [mutate,code] of mutations){
    const s=scenario();mutate(s);const r=run(s);
    assert.equal(r.status,'blocked',code);assert.equal(r.solver,null,code);assert.equal(r.balanced,false);
    assert.ok(r.findings.some(f=>f.code===code&&f.path&&f.severity==='blocking'),code);
  }
});

test('malformed schema, undefined, nonfinite, duplicates, ranges and unsupported physics reject',()=>{
  const mutations=[
    s=>s.densityKgM3=undefined,s=>s.densityKgM3=NaN,s=>s.links[0].cd=Infinity,
    s=>s.densityKgM3=0,s=>s.links[0].cd=0,s=>s.links[0].cd=1.01,s=>s.links[0].freeAreaM2=-1,
    s=>s.links[0].openFraction=-.1,s=>s.zones[0].volumeM3=0,s=>s.links[0].enabled=null,
    s=>s.density=1.2,s=>s.links[0].windSpeedMps=3,s=>s.zones[0].room.entitiyId='typo',
    s=>s.links[0].pressurePa='0',s=>s.version=2,s=>s.zones[0].id='outside',
    s=>s.links[1].id=s.links[0].id,s=>s.links[1].opening=copy(s.links[0].opening),
    s=>s.links[0].to=s.links[0].from,s=>s.zones.push({...copy(s.zones[0]),id:'second-zone'}),
    s=>s.links[0].anchors={},s=>s.links[0].kind='stair'
  ];
  for(const mutate of mutations){
    const s=scenario();mutate(s);
    assert.throws(()=>run(s),e=>e instanceof TypeError||e instanceof RangeError);
  }
});

test('discovery never converts absent wall room hosts, missing walls or ambiguous adjacency into outside',()=>{
  for(const modify of [
    (d,o,w)=>w.roomIds=[],
    (d,o,w)=>w.roomIds=['missing-room'],
    (d,o,w)=>w.roomIds=['ground:living','ground:kitchen','ground:bathroom'],
    (d,o,w)=>o.wallId='missing-wall',
    (d,o,w)=>w.openings=[],
    (d,o,w)=>w.exterior=false,
    (d,o,w)=>o.targetRoomId='missing-room'
  ]){
    const d=copy(scene()),o=d.scenes[0].openings.find(o=>o.id==='ground:entry'),w=d.scenes[0].walls.find(w=>w.id===o.wallId);
    modify(d,o,w);
    const inventory=A.discover(d),opening=inventory.openings.find(o=>o.ref.entityId==='ground:entry');
    assert.equal(opening.candidateAdjacency,null);
    const r=A.run(d,scenario());assert.equal(r.status,'blocked');assert.equal(r.solver,null);
  }
});

test('known interior opening cannot be routed outside or to unrelated rooms/floors',()=>{
  const s=scenario();s.links[0].opening=room('ground','ground:kitchen-access');
  assert.ok(has(run(s),'incompatible-opening-endpoints'));
  s.links[0].opening=room('upper','upper:study-access');
  assert.ok(has(run(s),'incompatible-opening-endpoints'));
});

test('inter-room transfer inflow is not called direct outside delivery',()=>{
  const s=scenario();
  s.zones.push({id:'kitchen',room:room('ground','ground:kitchen'),volumeM3:20});
  s.links[1]={...s.links[1],opening:room('ground','ground:kitchen-access'),from:'living',to:'kitchen'};
  s.links.push({...copy(s.links[0]),id:'exit',opening:room('ground','ground:kitchen-window'),from:'kitchen',to:'outside',pressurePa:0});
  const r=run(s),k=r.zoneResults.find(z=>z.id==='kitchen');
  assert.equal(r.status,'converged');assert.ok(k.transferInflowM3s>0);
  assert.equal(k.directOutsideInflowM3s,0);assert.equal(k.directOutsideInflowACH,0);
  for(const z of r.zoneResults){near(z.inflowM3s-z.outflowM3s,-z.netOutflowM3s);assert.ok(Math.abs(z.massResidualKgS)<=r.solver.toleranceM3s*1.2);}
});

test('manual cross-floor intent uses exact floor references, absolute anchors and no inferred stack pressure',()=>{
  const s=scenario();
  s.zones.push({id:'upper',room:room('upper','upper:living'),volumeM3:25});
  s.links=[manual('vertical','living','upper','ground','upper',12)];
  const r=run(s);
  assert.equal(r.status,'converged');assert.equal(r.flowResults[0].m3s,0);
  assert.equal(r.links[0].kind,'manual');assert.equal(r.links[0].openingRef,null);
  assert.equal(r.links[0].geometry.isInterFloor,true);
  assert.deepEqual(r.links[0].geometry.from,s.links[0].anchors.from);
  assert.equal(r.components[0].connectedToOutside,false);
  s.links[0].pressurePa=null;assert.ok(has(run(s),'missing-pressurePa'));
  s.links[0].pressurePa=0;s.links[0].anchors.to.floorId='ground';
  assert.ok(has(run(s),'manual-anchor-floor-mismatch'));
  s.links[0].anchors.to=null;assert.ok(has(run(s),'missing-manual-anchor'));
});

test('a disconnected forced cycle circulates but a passive dead-end tree has no flow',()=>{
  const s=scenario();
  s.zones.push({id:'kitchen',room:room('ground','ground:kitchen'),volumeM3:20},
    {id:'bedroom',room:room('ground','ground:bedroom'),volumeM3:20});
  s.links=[manual('a','living','kitchen','ground','ground',9),manual('b','kitchen','bedroom'),manual('c','bedroom','living')];
  const r=run(s);assert.equal(r.status,'converged');assert.equal(r.components[0].connectedToOutside,false);
  assert.ok(r.flowResults.every(f=>f.m3s>0));assert.ok(r.zoneResults.every(z=>z.directOutsideInflowM3s===0));
  assert.ok(r.solver.references.every(r=>r.connectedToOutside===false));
  s.links.pop();s.links[0].pressurePa=0;
  const passive=run(s);assert.ok(passive.flowResults.every(f=>f.m3s===0));
  assert.ok(passive.zoneResults.some(z=>z.deadEnd));
});

test('different plot origins use the single site-local projection with exact floor elevations',()=>{
  const p=fixture();
  p.floors[1].legacy.context.plate.sitePlot={x:-2,y:-3,w:12,h:12};
  const d=Projection.build(p),r=A.discover(d);
  for(const f of d.scenes){
    const actual=f.rooms.find(r=>r.id.endsWith(':living'));
    const observed=r.rooms.find(r=>r.ref.floorId===f.floorId&&r.ref.entityId===actual.id);
    assert.deepEqual(observed.geometry.rect,actual.rect);
    assert.equal(observed.geometry.center.z,f.floorElevationM);
  }
  const lower=r.rooms.find(r=>r.ref.entityId==='ground:living'),upper=r.rooms.find(r=>r.ref.entityId==='upper:living');
  near(upper.geometry.rect.x-lower.geometry.rect.x,1);
  near(upper.geometry.center.z-lower.geometry.center.z,3.2);
  assert.ok(r.openings.every(o=>o.geometry.floorId===o.ref.floorId));
  assert.throws(()=>A.discover({...d,scenes:controllerFor(p).getScenes()}),TypeError);
});

test('opaque full-pair IDs cannot collide through separators or object prototype names',()=>{
  const d=copy(scene());
  // Keep geometry from real compilation; adversarial serialized identifiers are opaque.
  for(const [i,f] of d.scenes.entries()){
    const old=f.floorId;f.floorId=i===0?'a|b':'a';
    const rename=id=>id==='ground:living'?'c':id==='upper:living'?'b|c':id;
    f.rooms.forEach(r=>r.id=rename(r.id));
    f.walls.forEach(w=>w.roomIds=w.roomIds.map(rename));
    f.openings.forEach(o=>{o.roomId=rename(o.roomId);if(o.targetRoomId)o.targetRoomId=rename(o.targetRoomId);});
    assert.notEqual(old,f.floorId);
  }
  const s={version:1,densityKgM3:1.2,zones:[
    {id:'__proto__',room:room('a|b','c'),volumeM3:30},{id:'constructor',room:room('a','b|c'),volumeM3:30}],links:[]};
  const r=A.run(d,s);assert.equal(r.status,'converged');
  assert.equal(new Set(r.inventory.rooms.map(r=>r.key)).size,r.inventory.rooms.length);
  assert.equal(new Set(r.zones.map(z=>z.solverId)).size,2);
  assert.equal(Object.getPrototypeOf(r.solver.pressures),Object.prototype);
});

test('real opening numerical stalling remains diagnostic with original residuals and no balanced label',()=>{
  const s=scenario();s.links[0].pressurePa=1;s.links[0].freeAreaM2=1;s.links[1].freeAreaM2=5e-9;
  const r=run(s);
  assert.equal(r.status,'nonconverged');assert.equal(r.balanced,false);assert.equal(r.solver.status,'stalled');
  assert.equal(r.solver.converged,false);assert.ok(r.solver.residualM3s>r.solver.toleranceM3s);
  assert.equal(r.zoneResults[0].directOutsideInflowACH,null);
  assert.ok(r.flowResults.every(f=>f.numericalStatus==='nonconverged'));
  assert.deepEqual(r.solver,Physics.solveAirflow(r.solverInput));
});

test('density/coefficient numerical overflow is diagnosed without default or silent clamping',()=>{
  const s=scenario();s.densityKgM3=Number.MIN_VALUE;
  const r=run(s);assert.equal(r.status,'numerical-error');assert.equal(r.solver,null);
  assert.ok(has(r,'solver-numerical-range'));assert.equal(r.balanced,false);finiteFrozen(r);
});

test('budgets reject before scene traversal or expensive solver, and never truncate inventory',()=>{
  const s=scenario();s.zones=Array.from({length:129},()=>s.zones[0]);
  const hostile=new Proxy({}, {get(){throw new Error('Scene should not be inspected');}});
  assert.throws(()=>A.run(hostile,s),/128 item budget/);
  s.zones=[];s.links=Array.from({length:513},()=>s.links[0]);
  assert.throws(()=>A.run(hostile,s),/512 item budget/);
  const d=copy(scene());d.scenes[0].rooms=Array(4097).fill(d.scenes[0].rooms[0]);
  assert.throws(()=>A.discover(d),/4096 item budget/);
  assert.equal(A.LIMITS.zones,128);assert.equal(A.LIMITS.links,512);
});

test('normalization preserves absent/null draft fields and rejects undefined rather than JSON erasing it',()=>{
  const s=scenario();delete s.links[0].cd;s.zones[0].volumeSource=null;s.notes='Draft only';
  const n=A.normalizeScenario(s);assert.deepEqual(n,s);assert.equal(Object.hasOwn(n.links[0],'cd'),false);
  assert.equal(n.zones[0].volumeSource,null);assert.deepEqual(copy(n),n);finiteFrozen(n);
  s.links[0].cd=undefined;assert.throws(()=>A.normalizeScenario(s),TypeError);
});

test('fingerprints detect same-ID same-revision replacements and ignore navigation and object-key order',()=>{
  const controller=controllerFor(fixture()),s=scenario(),a=A.run(controller.getDrawingScene(),s);
  controller.select({kind:'room',id:'ground:living'});controller.execute({type:'select-floor',id:'upper'});
  const b=A.run(controller.getDrawingScene(),s);
  assert.equal(a.provenance.inputFingerprint,b.provenance.inputFingerprint);
  const d=copy(controller.getDrawingScene()),entry=d.scenes[0].openings.find(o=>o.id==='ground:entry');
  entry.openFraction=.1;
  const c=A.run(d,s);
  assert.equal(c.provenance.revision,b.provenance.revision);
  assert.notEqual(c.provenance.inputFingerprint,b.provenance.inputFingerprint);
  assert.notEqual(c.provenance.physicalFingerprint,b.provenance.physicalFingerprint);
  const stale=A.run(d,s,{expectedPhysicalFingerprint:b.provenance.physicalFingerprint});
  assert.ok(has(stale,'stale-physical-input'));assert.equal(stale.solver,null);
  const reverseKeys=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(reverseKeys):Object.fromEntries(Object.entries(v).reverse().map(([k,v])=>[k,reverseKeys(v)])):v;
  assert.equal(A.run(scene(),reverseKeys(s)).provenance.scenarioFingerprint,a.provenance.scenarioFingerprint);
});

test('actual bridge opening edits invalidate operation and history restores the same physical input key',()=>{
  const controller=controllerFor(fixture()),s=scenario();
  const before=A.run(controller.getDrawingScene(),s),saved=JSON.stringify(before);
  controller.execute({type:'update-window',id:'ground:living-window',openFraction:0});
  const closed=A.run(controller.getDrawingScene(),s);
  assert.ok(has(closed,'closed-opening-positive-area'));assert.equal(closed.status,'blocked');
  assert.notEqual(closed.provenance.inputFingerprint,before.provenance.inputFingerprint);
  assert.equal(closed.links[1].operation.openFraction,0);
  assert.equal(before.links[1].operation.openFraction,1);assert.equal(JSON.stringify(before),saved);
  controller.undo();
  const restored=A.run(controller.getDrawingScene(),s);
  assert.equal(restored.provenance.inputFingerprint,before.provenance.inputFingerprint);
  assert.equal(restored.status,'converged');
});

test('selected-floor compiler errors block the physical enclosure but unrelated floor errors stay visible',()=>{
  const d=copy(scene()),s=scenario();
  d.scenes[1].diagnostics.push({level:'error',message:'Synthetic unresolved enclosure',ids:['upper:living']});
  const unrelated=A.run(d,s);assert.equal(unrelated.status,'converged');
  assert.ok(unrelated.inventory.sourceFloorDiagnostics[1].diagnostics.some(f=>f.level==='error'));
  d.scenes[0].diagnostics.push({level:'error',message:'Synthetic unresolved enclosure',ids:['ground:living']});
  const selected=A.run(d,s);
  assert.equal(selected.status,'blocked');assert.ok(has(selected,'invalid-physical-enclosure'));assert.equal(selected.solver,null);
});

test('revision comparisons explain physical/project/zone changes and never emit incomparable deltas',()=>{
  const s=scenario(),d=copy(scene()),a=A.run(d,s);s.links[0].pressurePa=24;
  d.revision++;
  const b=A.run(d,s),ab=A.compare(a,b);
  assert.equal(ab.comparable,true);assert.equal(ab.revisionChanged,true);assert.equal(ab.geometryChanged,false);
  assert.ok(ab.zoneDeltas[0].directOutsideInflowM3s>0);
  d.scenes[0].openings[0].openFraction=.5;
  const c=A.run(d,s),ac=A.compare(a,c);
  assert.equal(ac.comparable,false);assert.equal(ac.geometryChanged,true);assert.deepEqual(ac.zoneDeltas,[]);
  d.projectId='other';assert.ok(A.compare(a,A.run(d,s)).reasons.includes('different-project'));
  const fewer=scenario();fewer.zones=[];fewer.links=[];
  assert.ok(A.compare(a,run(fewer)).reasons.includes('zone-selection-changed'));
  assert.deepEqual(copy(ab),ab);finiteFrozen(ab);
});
