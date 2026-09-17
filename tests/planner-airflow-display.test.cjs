const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const A=require('../planner-airflow.js');
const D=require('../planner-airflow-display.js');
const Projection=require('../planner-projection.js');
const Regions=require('../planner-regions.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const ref=(floorId,entityId)=>({floorId,entityId});
function project(){
  const p=createFixture('multiple-floors').project;
  for(const [i,f] of p.floors.entries()){
    f.legacy.context.plate.sitePlot={x:-1-i,y:-2-i,w:12,h:12};
    for(const o of [...f.legacy.context.plan.openings.doors,...f.legacy.context.plan.openings.windows])o.openFraction=1;
    f.doorEdits={};f.windowEdits={};
  }
  p.legacy=copy(p.floors[0].legacy);p.doorEdits={};p.windowEdits={};
  return p;
}
function scenario(){
  return {version:1,densityKgM3:1.2,zones:[{id:'living',room:ref('ground','ground:living'),volumeM3:30}],links:[
    {id:'in',kind:'opening',opening:ref('ground','ground:entry'),from:'outside',to:'living',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:12},
    {id:'out',kind:'opening',opening:ref('ground','ground:living-window'),from:'living',to:'outside',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:0}
  ]};
}
const scene=()=>controllerFor(project()).getDrawingScene();
const run=(s=scenario(),drawing=scene())=>A.run(drawing,s);
const view=r=>D.createView(r,{floorId:'ground'});
const byLink=(v,id)=>v.openingRows.find(r=>r.linkId===id);
function frozen(v){
  if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(frozen);}
  else if(typeof v==='number')assert.ok(Number.isFinite(v));
  else assert.notEqual(typeof v,'undefined');
}
function arrow(svg,key){
  const group=svg.match(new RegExp(`<g data-flow="${key}"[^>]*>[\\s\\S]*?<\\/g>`))?.[0];
  if(!group)return null;
  const line=group.match(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/);
  return {start:{x:+line[1],y:+line[2]},end:{x:+line[3],y:+line[4]}};
}

test('stable browser/CommonJS API, detached frozen finite view and immutable actual pipeline inputs',()=>{
  const sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('../planner-airflow-display.js'),'utf8'),sandbox);
  assert.deepEqual(Object.keys(sandbox.HomePlannerAirflowDisplay),Object.keys(D));
  const r=run(),before=JSON.stringify(r),v=view(r);
  assert.deepEqual(Object.keys(v),['version','svg','roomRows','openingRows','legend','warnings','floorId']);
  assert.equal(v.version,1);frozen(v);
  assert.deepEqual(copy(sandbox.HomePlannerAirflowDisplay.createView(r,{floorId:'ground'})),v);
  assert.equal(JSON.stringify(r),before);
  assert.notEqual(v.roomRows[0].geometry,r.inventory.rooms[0].geometry);
  assert.deepEqual(v,view(r));
});

test('computed velocity cells, black vectors, physical walls and an actual numeric spectral legend form the primary 2D field',()=>{
  const result=run({...scenario(),planField:{enabled:true,spacingM:.5}}),v=view(result);
  assert.equal(result.planField.status,'complete',JSON.stringify(result.planField.findings));
  assert.equal(v.fieldRows.length,result.planField.cells.length);
  assert.equal((v.svg.match(/data-field-cell=/g)||[]).length,result.planField.cells.length);
  assert.ok((v.svg.match(/data-field-vector=/g)||[]).length>0);
  assert.match(v.svg,/data-wall=/);assert.match(v.svg,/data-opening=/);
  assert.match(v.svg,/Velocity/);assert.match(v.svg,/\[m s⁻¹\]/);assert.match(v.svg,/NOT CFD/);
  assert.ok(v.svg.includes(String(Number(result.planField.maximumSpeedMps.toPrecision(4)))));
  assert.equal((v.svg.match(/fill="url\(#flow-spectrum\)"/g)||[]).length,1,'the gradient itself is only the legend');
  assert.doesNotMatch(v.svg,/<(?:script|image|foreignObject|iframe)\b/i);
});

test('zero velocity is a computed blue field; unavailable meshes have no colored cells or field vectors',()=>{
  const scenarioValue={...scenario(),planField:{enabled:true,spacingM:.5}};
  scenarioValue.links[0].pressurePa=0;
  const zero=view(run(scenarioValue));
  assert.ok(zero.fieldRows.every(cell=>cell.speedMps===0));
  assert.match(zero.svg,/Known zero/);assert.doesNotMatch(zero.svg,/data-field-vector=/);
  scenarioValue.links[0].pressurePa=12;scenarioValue.planField.spacingM=1e-6;
  const unavailable=view(run(scenarioValue));
  assert.deepEqual(unavailable.fieldRows,[]);
  assert.doesNotMatch(unavailable.svg,/data-field-cell=|data-field-vector=/);
  assert.match(unavailable.svg,/Unavailable/);
});
test('manual-network field fallback retains both explicit anchor rings without inventing velocity paths',()=>{
  const value={...scenario(),planField:{enabled:true,spacingM:.5}};
  value.links[0]={id:'manual',kind:'manual',from:'outside',to:'living',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:12,openFraction:1,
    anchors:{from:{floorId:'ground',point:{x:-2,y:4,z:.45}},to:{floorId:'ground',point:{x:4,y:4,z:.45}}}};
  const result=run(value),v=view(result);
  assert.equal(result.status,'converged');assert.equal(result.planField.status,'unavailable');
  assert.equal((v.svg.match(/data-manual-endpoint=/g)||[]).length,2);
  assert.match(v.svg,/not air paths/);assert.doesNotMatch(v.svg,/data-field-vector=/);
});

test('actual reserved service geometry remains visible while every host velocity cell excludes its footprint',()=>{
  const p=project();
  p.floors[0].legacy.context.plan.placed.push({
    req:{id:'lift',type:'lift',label:'Reserved lift',reserveFootprint:true,seq:9},
    module:{x:2,y:2,w:1,h:1},carpet:{x:2.05,y:2.05,w:.9,h:.9}
  });
  p.legacy=copy(p.floors[0].legacy);
  const drawing=controllerFor(p).getDrawingScene(),footprint=drawing.scenes[0].rooms.find(room=>room.reservesSpace).reservationFootprint;
  const result=run({...scenario(),planField:{enabled:true,spacingM:.5}},drawing),v=view(result);
  assert.equal(result.planField.status,'complete',JSON.stringify(result.planField.findings));
  assert.ok(v.fieldRows.length>0);
  assert.ok(v.fieldRows.every(cell=>Regions.intersection(cell.rect,footprint)===null));
  assert.match(v.svg,/clip-path="url\(#flow-/);assert.match(v.svg,/data-wall=/);
  const forged=copy(result);forged.planField.cells[0].rect.x=footprint.x;forged.planField.cells[0].rect.y=footprint.y;
  assert.throws(()=>view(forged),/centre|usable room area/);
});

test('inventory-only rendering never reports zero flow or inferred volume, area, forcing or pressure',()=>{
  const inventory=A.discover(scene()),v=D.createInventoryView(inventory,{floorId:'ground'});
  assert.match(v.svg,/NOT RUN/);assert.doesNotMatch(v.svg,/data-flow=/);
  for(const r of v.roomRows){
    assert.equal(r.volumeM3,null);assert.equal(r.pressurePa,null);assert.equal(r.display.inflowM3s,'unknown');
    assert.equal(r.directOutsideInflowACH,null);
  }
  for(const o of v.openingRows){
    for(const k of ['m3s','freeAreaM2','effectiveAreaM2','cd','imposedPressurePa'])assert.equal(o[k],null);
    assert.equal(o.display.m3s,'unknown');assert.equal(o.direction,null);
  }
  assert.throws(()=>D.createView({inventory,status:'not-run'}),/AirflowResult/);
});

test('empty registered geometry is explicit, and primitive density has a readable refusal',()=>{
  const drawing=copy(scene());drawing.scenes=[];
  const v=D.createInventoryView(A.discover(drawing));
  assert.equal(v.floorId,null);assert.deepEqual(v.roomRows,[]);assert.deepEqual(v.openingRows,[]);
  assert.match(v.svg,/No drawable geometry/);
  const inventory=copy(A.discover(scene())),original=inventory.openings[0];
  inventory.openings=Array.from({length:513},(_,i)=>({...copy(original),key:`opening-${i}`,ref:ref('ground',`opening-${i}`)}));
  assert.throws(()=>D.createInventoryView(inventory,{floorId:'ground'}),/512 drawable records/);
});

test('actual aperture bars and signed wall-normal boundary vectors reverse with solved flow',()=>{
  const s=scenario(),forward=run(s);s.links[0].pressurePa=-12;
  const reverse=run(s),a=view(forward),b=view(reverse);
  assert.equal(forward.status,'converged');
  for(const id of ['in','out']){
    const x=byLink(a,id),y=byLink(b,id),g=x.geometry;
    assert.ok(x.directionVector);assert.ok(y.directionVector);
    near(x.directionVector.x,-y.directionVector.x);near(x.directionVector.y,-y.directionVector.y);
    near((g.end.x-g.start.x)*x.directionVector.x+(g.end.y-g.start.y)*x.directionVector.y,0);
    near(Math.hypot(x.directionVector.x,x.directionVector.y),1);
    near(x.m3s,-y.m3s);
    assert.deepEqual(x.geometry,forward.inventory.openings.find(o=>o.key===x.key).geometry);
    const line=arrow(a.svg,x.shortKey),back=arrow(b.svg,y.shortKey);
    assert.ok(line&&back);near(line.start.x,back.end.x);near(line.start.y,back.end.y);
    near(line.end.x,back.start.x);near(line.end.y,back.start.y);
    near(Math.hypot(line.end.x-line.start.x,line.end.y-line.start.y),30,1e-4);
    near(x.solverPressureDifferencePa,x.fromPressurePa-x.toPressurePa+x.imposedPressurePa);
  }
  const input=byLink(a,'in'),room=a.roomRows.find(r=>r.zoneId==='living');
  assert.ok(input.directionVector.x*(room.geometry.center.x-input.geometry.center.x)+
    input.directionVector.y*(room.geometry.center.y-input.geometry.center.y)>0);
});

test('interior arrow follows actual adjacency; room totals distinguish transfer from direct outside ACH',()=>{
  const s=scenario();s.zones.push({id:'kitchen',room:ref('ground','ground:kitchen'),volumeM3:20});
  s.links[1]={...s.links[1],opening:ref('ground','ground:kitchen-window'),from:'kitchen'};
  s.links.push({id:'transfer',kind:'opening',opening:ref('ground','ground:kitchen-access'),
    from:'living',to:'kitchen',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:0});
  const r=run(s),v=view(r),k=v.roomRows.find(r=>r.zoneId==='kitchen'),link=byLink(v,'transfer');
  assert.equal(r.status,'converged');assert.ok(link.m3s>0);assert.ok(link.directionVector.x>0);
  assert.equal(link.directionVector.y,0);assert.ok(k.transferInflowM3s>0);
  assert.equal(k.directOutsideInflowM3s,0);assert.equal(k.directOutsideInflowACH,0);
  for(const z of r.zoneResults){
    const row=v.roomRows.find(r=>r.zoneId===z.id);
    for(const field of ['inflowM3s','outflowM3s','netOutflowM3s','massResidualKgS','directOutsideInflowM3s',
      'transferInflowM3s','pressurePa','directOutsideInflowACH','sealed','deadEnd','connectedToOutside'])assert.equal(row[field],z[field]);
    assert.equal(row.achLabel,z.achLabel);assert.equal(row.gauge,'outside-zero-Pa');
  }
  s.links[0].pressurePa=-12;
  const backwards=byLink(view(run(s)),'transfer');
  assert.ok(backwards.directionVector.x<0);assert.deepEqual(backwards.direction,{from:'kitchen',to:'living'});
});

test('zero, disabled and closed links never have arrows; missing inactive inputs remain unknown',()=>{
  for(const mode of ['zero','disabled','dead-end']){
    const s=scenario();
    if(mode==='dead-end')s.links.pop();
    else for(const l of s.links){
      if(mode==='zero')l.freeAreaM2=0;else l.enabled=false;
      l.cd=null;delete l.pressurePa;
    }
    const r=run(s),v=view(r);
    assert.equal(r.status,'converged');assert.doesNotMatch(v.svg,/data-flow=/);
    for(const o of v.openingRows.filter(o=>o.selected)){
      assert.equal(o.m3s,0);assert.equal(o.directionVector,null);
      if(mode!=='dead-end'){assert.equal(o.cd,null);assert.equal(o.display.imposedPressurePa,'unknown');}
    }
  }
});

test('blocked missing inputs and unresolved rows are visible but are not zero or plausible wind',()=>{
  const s=scenario();s.links[0].cd=null;delete s.links[0].pressurePa;
  s.zones[0].volumeM3=null;
  const r=run(s),v=view(r);
  assert.equal(r.status,'blocked');assert.equal(r.flowResults.length,0);
  assert.match(v.svg,/BLOCKED/);assert.doesNotMatch(v.svg,/data-flow=/);
  const row=byLink(v,'in');
  assert.equal(row.m3s,null);assert.equal(row.display.m3s,'unknown');
  assert.equal(row.effectiveAreaM2,null);assert.equal(row.display.cd,'unknown');
  assert.equal(row.rawInputs.cd,null);assert.equal(Object.hasOwn(row.rawInputs,'pressurePa'),false);
  assert.equal(v.roomRows.find(r=>r.zoneId==='living').volumeM3,null);
  s.links[0].opening=ref('missing','missing:id');
  s.zones.push({id:'missing-zone',room:ref('missing','missing:room')});
  const bad=view(run(s));
  assert.equal(byLink(bad,'in').geometry,null);
  assert.equal(bad.roomRows.find(r=>r.zoneId==='missing-zone').geometry,null);
});

test('unknown adjacency or closed/unknown operation cannot be replaced by optical transmission arrows',()=>{
  const d=copy(scene()),entry=d.scenes[0].openings.find(o=>o.id==='ground:entry');
  entry.openFraction=0;entry.transmittance=1;entry.swingAngleDeg=90;
  let r=run(scenario(),d);assert.equal(r.status,'blocked');assert.doesNotMatch(view(r).svg,/data-flow=/);
  delete entry.openFraction;
  r=run(scenario(),d);assert.equal(r.status,'blocked');assert.doesNotMatch(view(r).svg,/data-flow=/);
  const s=scenario();s.links[0].openFraction=1;
  r=run(s,d);assert.equal(r.status,'converged');assert.ok(byLink(view(r),'in').directionVector);
  entry.exterior=false;
  r=run(s,d);assert.equal(r.status,'blocked');assert.equal(byLink(view(r),'in').directionVector,null);
});

test('actual solver nonconvergence retains signed diagnostic tables with persistent no-arrow warning',()=>{
  const s=scenario();s.links[0].pressurePa=1;s.links[0].freeAreaM2=1;s.links[1].freeAreaM2=5e-9;
  const r=run(s),v=view(r);
  assert.equal(r.status,'nonconverged');assert.match(v.svg,/DIAGNOSTIC ONLY/);assert.doesNotMatch(v.svg,/data-flow=/);
  assert.ok(v.warnings.some(w=>w.includes('DIAGNOSTIC ONLY')));
  for(const f of r.flowResults){const row=byLink(v,f.id);assert.equal(row.m3s,f.m3s);assert.equal(row.diagnostic,true);}
  assert.equal(v.roomRows.find(z=>z.zoneId==='living').directOutsideInflowACH,null);
  assert.equal(v.roomRows.find(z=>z.zoneId==='living').massResidualKgS,r.zoneResults[0].massResidualKgS);
  assert.match(v.legend[0],/DIAGNOSTIC ONLY/);
});

test('numerical-error handles absent derived flows and keeps available raw solver evidence diagnostic',()=>{
  const s=scenario();s.densityKgM3=Number.MIN_VALUE;
  const r=run(s),v=view(r);
  assert.equal(r.status,'numerical-error');assert.match(v.svg,/DIAGNOSTIC ONLY/);
  assert.equal(byLink(v,'in').m3s,null);assert.doesNotMatch(v.svg,/data-flow=/);
  const derived=copy(run());derived.status='numerical-error';derived.balanced=false;
  derived.flowResults=[];derived.zoneResults=[];
  const raw=view(derived);
  assert.equal(byLink(raw,'in').m3s,derived.solver.flows.find(f=>f.id===derived.links[0].solverId).m3s);
  assert.equal(raw.roomRows.find(z=>z.zoneId==='living').pressurePa,derived.solver.pressures[derived.zones[0].solverId]);
  assert.equal(raw.roomRows.find(z=>z.zoneId==='living').netOutflowM3s,derived.solver.zoneResidualsM3s[derived.zones[0].solverId]);
  assert.doesNotMatch(raw.svg,/data-flow=/);
});

test('unequal floor origins, dimensions and opaque namespaced references are never reprojected or filtered analytically',()=>{
  const drawing=Projection.build(project()),r=run(scenario(),drawing),ground=view(r),upper=D.createView(r,{floorId:'upper'});
  assert.notDeepEqual(r.inventory.rooms.find(r=>r.ref.floorId==='ground').geometry.center,
    r.inventory.rooms.find(r=>r.ref.floorId==='upper').geometry.center);
  const ignoreScope=rows=>rows.map(({inScope,...r})=>r);
  assert.deepEqual(ignoreScope(ground.roomRows),ignoreScope(upper.roomRows));
  assert.deepEqual(ignoreScope(ground.openingRows),ignoreScope(upper.openingRows));
  for(const row of ground.roomRows){
    assert.deepEqual(row.geometry,r.inventory.rooms.find(r=>r.key===row.key).geometry);
    assert.equal(row.roomRef.entityId.startsWith(row.floorId+':'),true);
    assert.equal(ground.svg.includes(`data-room="${row.shortKey}"`),row.inScope);
    assert.equal(upper.svg.includes(`data-room="${row.shortKey}"`),row.floorId==='upper');
  }
  assert.equal(ground.roomRows.length,6);assert.equal(upper.roomRows.length,6);
});

test('manual cross-floor connections use only both explicit anchors, show full foreign span and never overlay foreign rooms',()=>{
  const s=scenario();s.zones.push({id:'upper',room:ref('upper','upper:living'),volumeM3:25});
  s.links=[{id:'riser',kind:'manual',from:'living',to:'upper',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:12,openFraction:1,
    anchors:{from:{floorId:'ground',point:{x:3,y:4,z:.45}},to:{floorId:'upper',point:{x:14,y:5,z:3.65}}}}];
  const r=run(s),v=view(r),row=byLink(v,'riser');
  assert.equal(r.status,'converged');assert.deepEqual(row.geometry.from,s.links[0].anchors.from);
  assert.deepEqual(row.geometry.to,s.links[0].anchors.to);
  assert.match(v.svg,/data-manual=/);assert.match(v.svg,/CROSS-FLOOR/);assert.match(v.svg,/no foreign room overlay/);
  assert.equal(row.directionVector,null);assert.doesNotMatch(v.svg,/data-flow=/);
  assert.ok(v.svg.includes(row.shortKey+'a')&&v.svg.includes(row.shortKey+'b'));
  assert.ok(v.warnings.some(w=>w.includes('full foreign span')));
  for(const room of v.roomRows.filter(r=>r.floorId==='upper'))assert.ok(!v.svg.includes(`data-room="${room.shortKey}"`));
  const u=D.createView(r,{floorId:'upper'});assert.match(u.svg,/data-manual=/);
  delete s.links[0].anchors.to;
  const missing=view(run(s));assert.equal(byLink(missing,'riser').geometry,null);
  assert.doesNotMatch(missing.svg,/data-manual=/);
});

test('coincident manual anchors remain two explicit keyed endpoints, not an invented plan span',()=>{
  const s=scenario();s.zones.push({id:'upper',room:ref('upper','upper:living'),volumeM3:25});
  s.links=[{id:'vertical',kind:'manual',from:'living',to:'upper',enabled:true,freeAreaM2:.5,cd:.6,pressurePa:0,openFraction:1,
    anchors:{from:{floorId:'ground',point:{x:3,y:4,z:.45}},to:{floorId:'upper',point:{x:3,y:4,z:3.65}}}}];
  const v=view(run(s));assert.match(v.svg,/data-manual=/);
  const line=v.svg.match(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)" data-manual=/);
  assert.equal(line[1],line[3]);assert.equal(line[2],line[4]);
  assert.equal((v.svg.match(/<circle /g)||[]).length,2);
});

test('SVG escapes hostile full labels, never emits external URLs/scripts, and keeps readable short keys',()=>{
  const drawing=copy(scene());
  const hostile='"><script>alert(1)</script><image href="https://evil.invalid/a"/>& \'';
  drawing.scenes[0].rooms[0].label=hostile;
  const v=view(run(scenario(),drawing));
  assert.equal(v.roomRows.find(r=>r.roomRef.entityId===drawing.scenes[0].rooms[0].id).label,hostile);
  assert.match(v.svg,/&lt;script&gt;/);assert.match(v.svg,/&quot;/);assert.match(v.svg,/&amp;/);
  assert.doesNotMatch(v.svg,/<script|<image|<foreignObject|\shref=["']|\sonload=["']|url\(|NaN|Infinity/);
  assert.match(v.svg,/role="img"/);assert.match(v.svg,/<title>/);assert.match(v.svg,/<desc>/);
  assert.match(v.svg,/fill="#fff"/);
  const long=copy(drawing);long.scenes[0].rooms[0].label='Long complete room name '.repeat(500);
  const large=view(run(scenario(),long));assert.equal(large.roomRows.find(r=>r.roomRef.entityId===long.scenes[0].rooms[0].id).label,long.scenes[0].rooms[0].label);
  assert.ok(!large.svg.match(/<text[^>]*>Long complete/));
  drawing.scenes[0].rooms[0].label='Unpaired \uD800 and control \u0000; valid emoji \u{1F3E0}';
  const unicode=view(run(scenario(),drawing));
  assert.doesNotMatch(unicode.svg,/[\u0000\uD800]/u);assert.match(unicode.svg,/\u{1F3E0}/u);
});

test('explicit budgets reject excessive collections, unreadable density, unsafe coordinates and non-JSON values',()=>{
  const inventory=copy(A.discover(scene()));
  let bad=copy(inventory);bad.rooms=Array(4097).fill(bad.rooms[0]);
  assert.throws(()=>D.createInventoryView(bad),/budget/);
  bad=copy(inventory);bad.openings=Array(16385).fill(bad.openings[0]);
  assert.throws(()=>D.createInventoryView(bad),/budget/);
  bad=copy(inventory);bad.rooms[0].geometry.polygon[0].x=1e10;
  assert.throws(()=>D.createInventoryView(bad),/±1e9/);
  bad=copy(inventory);bad.rooms[0].geometry.center.x=NaN;
  assert.throws(()=>D.createInventoryView(bad),/finite JSON/);
  bad=copy(inventory);bad.rooms[0].label='x'.repeat(16385);
  assert.throws(()=>D.createInventoryView(bad),/16,384/);
  bad=copy(inventory);
  for(const p of bad.rooms[0].geometry.polygon){p.x=2+(p.x%1)*1e-8;p.y=2+(p.y%1)*1e-8;}
  bad.rooms[0].geometry.center={x:2,y:2,z:0};
  assert.throws(()=>D.createInventoryView(bad),/too dense/);
  assert.throws(()=>D.createInventoryView(inventory,{floorId:'missing'}),/registered/);
  assert.throws(()=>D.createInventoryView(inventory,{scale:100}),/Only.*floorId/);
  assert.throws(()=>D.createInventoryView(inventory,{floorId:undefined}),/finite JSON/);
});

test('all emitted numeric positions fit the bounded viewBox and labels have a separate legend band',()=>{
  const svg=view(run()).svg;
  for(const match of svg.matchAll(/\b(?:x|x1|x2|cx)="([^"]+)"/g))assert.ok(+match[1]>=0&&+match[1]<=1000);
  for(const match of svg.matchAll(/\b(?:y|y1|y2|cy)="([^"]+)"/g))assert.ok(+match[1]>=0&&+match[1]<=800);
  for(const match of svg.matchAll(/points="([^"]+)"/g))for(const pair of match[1].split(' ')){
    const [x,y]=pair.split(',').map(Number);assert.ok(x>=0&&x<=1000&&y>=100&&y<635);
  }
  assert.doesNotMatch(svg,/marker-end|<path|data-streamline/);
});
