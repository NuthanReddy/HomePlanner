'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Display=require('../planner-light-display.js'),Light=require('../planner-light.js');
const Regions=require('../planner-regions.js');
const copy=v=>JSON.parse(JSON.stringify(v));
const period={startUTC:'2026-09-15T06:00:00Z',endUTC:'2026-09-15T07:00:00Z'};
function scene(){
  return {version:1,kind:'DrawingScene',projectId:'display-test',revision:1,inputFingerprint:'source',
    siteDatum:{elevationM:null},diagnostics:[],authored:[],scenes:[{
      floorId:'ground',coordinateSpace:'site-local',floorElevationM:0,headingDeg:17,wallHeightM:3,
      sourcePlotOrigin:{x:100,y:200},floor:{x:0,y:0,w:10,h:10},plot:{x:0,y:0,w:10,h:10},
      building:{x:2,y:4,w:2,h:2},rooms:[{id:'room',label:'Room',rect:{x:2,y:4,w:2,h:2}}],
      walls:[],openings:[],obstacles:[],unresolvedOpenings:[],diagnostics:[],electrical:[]}]};
}
function config(extra={}){
  return {version:1,workplanes:[{id:'plane',room:{floorId:'ground',entityId:'room'},heightM:.8,spacingM:1}],
    sky:{enabled:true,radialBands:1,azimuthSectors:4},minSunAltitudeDeg:1,windowOptics:{mode:'ideal-clear'},
    neighbors:Object.fromEntries(['front','right','rear','left'].map(s=>[s,{state:'clear'}])),neighborBoxes:[],
    roofContext:[{floorId:'ground',state:'none',source:'Explicit analytic open workplane'}],
    period,samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',sunENU:{east:0,north:0,up:1}}],
    site:{latitudeDeg:17,longitudeDeg:78,timeZone:'Asia/Kolkata'},...extra};
}
function analytic(){
  const r=copy(Light.run(scene(),config()));
  // Isolate display mapping from optics: the supplied fixture intentionally differs by metric.
  r.direct.masks[0].directPathWeights=[.4,0,1,.2];
  r.direct.masks[0].modeledDirectPathWeights=[.4,0,1,.2];
  r.direct.sensorResults.forEach((s,i)=>{
    s.positivePathPresenceHours=i===1?0:1;
    s.transmittedEquivalentSunHours=r.direct.masks[0].directPathWeights[i];
    s.modeledProcessedPositivePathPresenceHours=s.positivePathPresenceHours;
    s.modeledProcessedTransmittedEquivalentSunHours=s.transmittedEquivalentSunHours;
  });
  r.sky.sensorResults.forEach(s=>{s.cosineWeightedSkyAccess=.25;s.modeledCosineWeightedSkyAccess=.25;});
  return r;
}
function frozen(v){
  if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(frozen);}
  else if(typeof v==='number')assert.ok(Number.isFinite(v));
}
test('browser and CommonJS pure frozen detached API, export identical SVG',()=>{
  const sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('../planner-light-display.js'),'utf8'),sandbox);
  assert.deepEqual(Object.keys(sandbox.HomePlannerLightDisplay),Object.keys(Display));
  const result=analytic(),before=JSON.stringify(result),v=Display.createView(result);
  frozen(v);assert.equal(JSON.stringify(result),before);assert.equal(Object.isFrozen(result),false);
  assert.equal(Display.exportSVG(v),v.svg);
  assert.deepEqual(copy(sandbox.HomePlannerLightDisplay.createView(result)),v);
  result.sensors[0].point.x=99;assert.equal(v.sensorRows[0].point.x,2.5);
});
test('selected metric maps exact distinct supplied values and units, never computes optics',()=>{
  const r=analytic();
  for(const [metric,value,units] of [['direct',.4,'dimensionless-0-to-1'],['presence-hours',1,'hours'],
    ['equivalent-hours',.4,'hours'],['sky',.25,'dimensionless-0-to-1']]){
    const v=Display.createView(r,{metric});
    assert.equal(v.sensorRows[0].selectedValue,value);assert.equal(v.sensorRows[0].units,units);
    assert.match(v.svg,new RegExp(`data-sensor="S1" data-value="${value}"`));
    assert.match(v.svg,/NOT LUX/);assert.equal(v.roomRows[0].primary.sky,.25);
  }
});
test('actual workplane cells use room grid widths and site positions, not connected paths',()=>{
  const r=analytic(),v=Display.createView(r);
  assert.deepEqual(v.sensorRows[0].cell,{x:2,y:4,w:1,h:1,z:.8});
  assert.deepEqual(v.sensorRows[3].cell,{x:3,y:5,w:1,h:1,z:.8});
  assert.equal((v.svg.match(/data-sensor="/g)||[]).length,4);
  assert.doesNotMatch(v.svg,/<(?:polyline|polygon|mesh|radialGradient|foreignObject|script)\b/i);
  assert.equal((v.svg.match(/<linearGradient /g)||[]).length,1);
  assert.equal((v.svg.match(/fill="url\(#light-spectrum\)"/g)||[]).length,1, 'the gradient is a numeric legend, never a decorative floor fill');
  assert.equal((v.svg.match(/<path /g)||[]).length,7); // Unknown hatch and six numeric scale ticks.
  assert.deepEqual(v.sensorRows[0].world,r.sensors[0].world);
  assert.equal(v.roomRows[0].floor.sourcePlotOrigin.x,100);
});
test('the spectral plan paints exact clipped cells and preserves an uncolored reserved hole',()=>{
  const drawing=scene(),room=drawing.scenes[0].rooms[0],cut={x:2.5,y:4.5,w:1,h:1};
  room.usableRegions=Regions.subtractRectangle(room.rect,[cut]);room.reservedAreaM2=1;
  const result=Light.run(drawing,config()),v=Display.createView(result,{metric:'sky'});
  assert.equal(result.status,'complete');
  assert.ok(v.sensorRows.length>4);
  assert.ok(v.sensorRows.every(row=>Regions.intersection(row.cell,cut)===null));
  assert.ok(Math.abs(v.sensorRows.reduce((area,row)=>area+row.areaWeightM2,0)-3)<1e-10);
  assert.match(v.svg,/data-legend="light"/);assert.match(v.svg,/\[dimensionless\]/);
  assert.doesNotMatch(v.svg,/\(LUX\)|illuminance \(lux\)/);
  const bad=copy(result);bad.sensors[0].cell.x=cut.x;bad.sensors[0].cell.y=cut.y;
  assert.throws(()=>Display.createView(bad),/grid cell|usable floor/);
});
test('unknown context is hatch, known zero is separate, model never replaces primary columns',()=>{
  const r=Light.run(scene(),config({neighbors:{}}));
  assert.equal(r.status,'incomplete');
  const primary=Display.createView(r),modeled=Display.createView(r,{modeled:true});
  assert.equal(primary.sensorRows[0].selectedValue,null);
  assert.equal(modeled.sensorRows[0].selectedValue,1);assert.equal(modeled.sensorRows[0].primary.direct,null);
  assert.match(primary.svg,/data-status="unknown"/);assert.match(primary.svg,/fill="url\(#light-unknown\)"/);
  assert.match(modeled.svg,/SUPPLIED MODEL ONLY \/ unknown context/);
  const zero=Display.createView(analytic());
  assert.match(zero.svg,/data-sensor="S2" data-value="0" data-status="known-zero"/);
  assert.match(zero.svg,/fill="#1539ba"/);
});
test('partial and cancelled snapshots retain committed evidence but cannot publish full-period subtotals',()=>{
  const c=config({samples:[
    {...period,sampleUTC:'2026-09-15T06:30:00Z',sunENU:{east:0,north:0,up:1}},
    {startUTC:'2026-09-15T07:00:00Z',endUTC:'2026-09-15T08:00:00Z',sampleUTC:'2026-09-15T07:30:00Z',sunENU:{east:0,north:0,up:1}}
  ],period:{startUTC:period.startUTC,endUTC:'2026-09-15T08:00:00Z'},sky:{enabled:false}});
  const study=Light.createStudy(scene(),c);study.step(4);
  let r=study.getResult();
  assert.equal(r.direct.masks.length,1);
  assert.equal(Display.createView(r).sensorRows[0].selectedValue,1);
  assert.equal(Display.createView(r,{intervalIndex:1}).sensorRows[0].selectedValue,null);
  assert.match(Display.createView(r,{intervalIndex:1}).svg,/unprocessed \/ unknown/);
  r=study.cancel();
  for(const metric of ['presence-hours','equivalent-hours']){
    const v=Display.createView(r,{metric,modeled:true});
    assert.equal(v.sensorRows[0].selectedValue,null);
    assert.equal(v.sensorRows[0].modeledProcessedPositivePathPresenceHours,1);
    assert.equal(v.sensorRows[0].primary[metric],null);
    assert.equal(v.roomRows[0].modeled[metric],null);
  }
});
test('selected index uses committed sampleIndex not array offset; future snapshot remains missing',()=>{
  const r=analytic();
  r.config.samples.push({...r.config.samples[0],sampleUTC:'2026-09-16T06:30:00Z'});
  r.direct.masks[0].sampleIndex=1;
  assert.equal(Display.createView(r).sensorRows[0].selectedValue,null);
  assert.equal(Display.createView(r,{intervalIndex:1}).sensorRows[0].selectedValue,.4);
});
test('requested-period gaps never turn processed model totals into full hours',()=>{
  const r=Light.run(scene(),config({period:{startUTC:'2026-09-15T05:00:00Z',endUTC:period.endUTC}}));
  assert.equal(r.direct.complete,false);
  assert.equal(r.direct.unknownOrUnprocessedHours,1);
  const v=Display.createView(r,{metric:'presence-hours',modeled:true});
  assert.equal(v.sensorRows[0].selectedValue,null);
  assert.equal(v.sensorRows[0].modeledProcessedPositivePathPresenceHours,1);
  assert.match(v.svg,/not full-period cell totals/);
});
test('night known zero survives unknown context and incomplete whole study; sky geometry does not darken',()=>{
  const day=Light.run(scene(),config());
  const nightConfig=config({neighbors:{},samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',sunENU:{east:0,north:0,up:-1}}]});
  const night=Light.run(scene(),nightConfig);
  assert.equal(night.complete,false);assert.equal(night.direct.complete,true);
  assert.equal(Display.createView(night).sensorRows[0].selectedValue,0);
  assert.match(Display.createView(night).svg,/Sun: night/);
  assert.equal(Display.createView(night,{metric:'presence-hours'}).sensorRows[0].selectedValue,0);
  assert.equal(Display.createView(night,{metric:'sky',modeled:true}).sensorRows[0].selectedValue,
    Display.createView(day,{metric:'sky'}).sensorRows[0].selectedValue);
  assert.match(Display.createView(night,{metric:'sky',modeled:true}).svg,/Geometry-only sky; day\/night does not alter/);
});
test('near-horizon unresolved is explicitly unknown rather than shaded',()=>{
  const r=Light.run(scene(),config({samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',
    sunAnglesDeg:{altitudeDeg:.5,azimuthDeg:0}}]}));
  const v=Display.createView(r);
  assert.equal(v.sensorRows[0].selectedValue,null);assert.match(v.svg,/near-horizon-unresolved/);
});
test('blocked and inventory-only pending controls are useful views, never numerical success',()=>{
  const r=Light.run(scene(),{version:1}),v=Display.createView(r);
  assert.equal(r.status,'blocked');assert.match(v.svg,/BLOCKED/);
  const pending=Display.createInventoryView(Light.discover(scene()));
  assert.match(pending.svg,/NOT-RUN/);assert.equal(pending.sensorRows.length,0);
  assert.equal(pending.roomRows[0].status,'not-sampled');
  assert.match(pending.warnings.join(' '),/pending controls/);
  const empty=Display.createInventoryView(Light.discover({...scene(),scenes:[]}));
  assert.equal(empty.floorId,null);assert.match(empty.svg,/No drawable room rectangles/);
});
test('cross-floor frame and cells keep normalized origins, gaps are not inserted and elevations not doubled',()=>{
  const s=scene(),upper=copy(s.scenes[0]);upper.floorId='upper';upper.floorElevationM=4;
  upper.sourcePlotOrigin={x:700,y:900};upper.rooms[0].rect.x=6;s.scenes.push(upper);
  const c=config();c.workplanes.push({...c.workplanes[0],id:'upper-plane',room:{floorId:'upper',entityId:'room'}});
  c.roofContext.push({floorId:'upper',state:'none',source:'Explicit open upper workplane'});
  const r=Light.run(s,c),ground=Display.createView(r),top=Display.createView(r,{floorId:'upper'});
  assert.deepEqual(top.sensorRows,ground.sensorRows.map(row=>({...row,inScope:row.floorId==='upper'})));
  const row=top.sensorRows.find(r=>r.inScope);
  assert.equal(row.point.z,4.8);assert.equal(row.cell.x,6);assert.equal(row.point.x,6.5);
  assert.match(top.svg,/data-site-x="6"/);assert.doesNotMatch(top.svg,/data-sensor="S1"/);
  const origin=svg=>svg.match(/<circle cx="([^"]+)" cy="([^"]+)" r="3"/).slice(1);
  assert.deepEqual(origin(top.svg),origin(ground.svg));
});
test('UTC captions retain unambiguous timestamp and supplied IANA local date/time',()=>{
  const v=Display.createView(analytic());
  assert.match(v.svg,/2026-09-15T06:30:00Z UTC/);
  assert.match(v.svg,/15\/09\/2026, 12:00 Asia\/Kolkata/);
  assert.equal(v.sensorRows[0].interval.startUTC,period.startUTC);
});
test('safe standalone accessible SVG escapes labels but preserves raw full IDs in rows',()=>{
  const r=analytic(),label='<script>alert("x")</script>&\'<image href="https://evil.invalid/x">';
  r.inventory.rooms[0].label=label;
  r.provenance.inputFingerprint='giant-private-canonical-fingerprint'.repeat(100);
  r.sensors[0].id='<sensor "full" & id>';
  const v=Display.createView(r);
  assert.equal(v.sensorRows[0].id,r.sensors[0].id);assert.equal(v.roomRows[0].label,label);
  assert.match(v.svg,/&lt;script&gt;/);assert.doesNotMatch(v.svg,/<script|<image|foreignObject|<[^>]*href=|giant-private-canonical-fingerprint/);
  assert.equal(v.provenance.inputFingerprint,r.provenance.inputFingerprint);
  assert.match(v.svg,/role="img"/);assert.match(v.svg,/<title>/);assert.match(v.svg,/<desc>/);
  assert.match(v.svg,/fill="#fff"/);assert.match(v.svg,/height:auto/);
});
test('electrical toggle draws supplied XY only, honors z zero and null; legacy records stay schedule-only',()=>{
  const s=scene();s.scenes[0].electrical=[
    {id:'zero',type:'light',coordinateSpace:'site-local',point:{x:2,y:4,z:0}},
    {id:'unknown',type:'outlet',coordinateSpace:'site-local',point:{x:3,y:5,z:null}},
    {id:'legacy',type:'switch',x:100,y:200,point:'legacy-anchor'}
  ];
  const inventory=Light.discover(s),off=Display.createInventoryView(inventory),on=Display.createInventoryView(inventory,{showElectrical:true});
  assert.doesNotMatch(off.svg,/data-electrical=/);
  assert.match(on.svg,/data-electrical="E1"/);assert.match(on.svg,/data-electrical="E2"/);
  assert.doesNotMatch(on.svg,/data-electrical="E3"/);
  assert.equal(on.electricalRows[0].heightStatus,'supplied-z');
  assert.equal(on.electricalRows[0].point.z,0);
  assert.equal(on.electricalRows[1].heightStatus,'height-unknown');
  assert.equal(on.electricalRows[1].point.z,null);
  assert.equal(on.electricalRows[2].record.point,'legacy-anchor');
  assert.equal(on.electricalRows[2].record.type,'switch');
  assert.equal(on.electricalRows[2].point,null);assert.match(on.svg,/height unknown/);
  assert.deepEqual(off.roomRows,on.roomRows);
});
test('strict options reject coercion, unknown names, invalid metrics/floors and index bounds',()=>{
  const r=analytic();
  for(const options of [null,[],{metric:'lux'},{metric:null},{modeled:1},{showElectrical:'true'},
    {floorId:'missing'},{floorId:null},{intervalIndex:-1},{intervalIndex:.5},{intervalIndex:2048},{intervalIndex:1},{physicalScale:1}]){
    assert.throws(()=>Display.createView(r,options),{name:/TypeError|RangeError/});
  }
  assert.throws(()=>Display.createView({...r,kind:'Other'}),TypeError);
  assert.throws(()=>Display.exportSVG({version:1,svg:'<svg/>'}),TypeError);
});
test('invalid geometry and malformed masks fail rather than place guessed cells',()=>{
  for(const mutate of [
    r=>{r.sensors[0].point.x+=2;},
    r=>{r.sensors[0].grid.columns=0;},
    r=>{r.sensors[0].room.entityId='missing';},
    r=>{r.inventory.rooms[0].geometry.coordinateSpace='legacy';},
    r=>{r.direct.masks[0].directPathWeights.pop();},
    r=>{r.direct.masks[0].directPathWeights[0]=2;},
    r=>{r.sensors[0].point.x=Infinity;}
  ]){
    const r=analytic();mutate(r);assert.throws(()=>Display.createView(r));
  }
});
test('4096 cells render bounded strings; excessive or cyclic input rejects without generation loops',()=>{
  const r=analytic(),template=r.sensors[0];r.sensors=[];
  for(let i=0;i<4096;i++)r.sensors.push({...template,id:`bounded-${i}`,
    point:{x:2+(i%64+.5)/32,y:4+(Math.floor(i/64)+.5)/32,z:.8},
    cell:{x:2+(i%64)/32,y:4+Math.floor(i/64)/32,w:1/32,h:1/32},
    grid:{column:i%64,row:Math.floor(i/64),columns:64,rows:64},areaWeightM2:1/1024});
  r.direct.masks=[];r.direct.sensorResults=[];r.sky.sensorResults=[];
  const v=Display.createView(r);
  assert.equal(v.sensorRows.length,4096);assert.equal((v.svg.match(/data-sensor="/g)||[]).length,4096);
  assert.ok(v.svg.length<2500000);
  r.sensors.push({...r.sensors[0],id:'overflow'});assert.throws(()=>Display.createView(r),RangeError);
  const cycle=analytic();cycle.config.cycle=cycle;assert.throws(()=>Display.createView(cycle),TypeError);
});
