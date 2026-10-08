const test=require('node:test');
const assert=require('node:assert/strict');
const UI=require('../planner-reduced-ui.js');
const Environment=require('../environment-ui.js');
const Physics=require('../building-physics.js');
const Drafts=require('../planner-drafts.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const setup=name=>{
  const planner=controllerFor(createFixture('multiple-floors').project);
  return {planner,ui:UI.createController(planner,name)};
};
function complete(ui,name){
  ui.prepare();
  const input=JSON.parse(ui.getState().text);
  if(name==='thermal'){
    input.zones.forEach(zone=>Object.assign(zone,{capacityJ_K:10000,initialC:20,outsideConductanceW_K:0}));
    input.links.forEach(link=>{link.conductanceW_K=0;});
    input.steps=[{durationSeconds:60,outdoorC:10,gainsW:Object.fromEntries(input.zones.map(zone=>[zone.id,100]))}];
  }else{
    input.densityKgM3=1.2;
    input.links.forEach(link=>Object.assign(link,{cd:0.6,pressurePa:0}));
  }
  ui.setDraft({text:JSON.stringify(input),notes:'Synthetic equation fixture; no real-building prediction.',acknowledged:true});
  return input;
}
for(const name of ['thermal','pressure']){
  test(`${name}: mount/sync does not author or calculate; prepare keeps nulls, evaluation reuses incumbent solver and Undo restores pair`,()=>{
    const {planner,ui}=setup(name),before=planner.exportProject();
    assert.equal(ui.getState().result,null);
    assert.equal(planner.exportProject(),before);
    const input=complete(ui,name),prepared=planner.exportProject(),revision=planner.getProject().revision;
    ui.run();
    assert.equal(planner.getProject().revision,revision+1);
    assert.deepEqual(ui.getState().result.output,name==='thermal'?Physics.simulateThermal(input):Physics.solveAirflow(input));
    const output=ui.getState().result.output;
    planner.undo();assert.equal(ui.getState().result,null);
    assert.deepEqual(planner.getProject().environment[name].input,JSON.parse(prepared).environment[name].input);
    planner.redo();assert.deepEqual(ui.getState().result.output,output);
    const exportData=ui.exportData();
    assert.equal(exportData.externalSolverExecuted,false);
    assert.equal(exportData.resultCurrent,true);
    assert.equal(exportData.scenes.length,2);
    ui.dispose();
  });
  test(`${name}: failed validation saves nothing; unevaluated nullable input saves once and revokes old evidence`,()=>{
    const {planner,ui}=setup(name);complete(ui,name);ui.run();
    const previous=planner.exportProject(),input=JSON.parse(ui.getState().text);
    if(name==='thermal')input.zones[0].capacityJ_K=null;else input.densityKgM3=null;
    ui.setDraft({text:JSON.stringify(input),acknowledged:true});
    assert.equal(ui.getState().result,null);assert.throws(()=>ui.run(),/finite|positive|number/);
    assert.equal(planner.exportProject(),previous);
    ui.save();assert.equal(ui.getState().result,null);
    assert.equal(planner.getProject().environment[name].acknowledged,false);
    planner.undo();assert.ok(ui.getState().result);
    ui.dispose();
  });
}
test('owned drafts survive floor changes and reject concurrent saved inputs without losing text',()=>{
  const {planner,ui}=setup('thermal');ui.prepare();
  ui.setDraft({text:'pending ground JSON',notes:'unsaved ground'});
  assert.equal(Drafts.pending(planner).length,1);
  planner.execute({type:'select-floor',id:'upper'});
  assert.notEqual(ui.getState().text,'pending ground JSON');
  ui.prepare();ui.setDraft({text:'pending upper JSON'});
  planner.execute({type:'select-floor',id:'ground'});
  assert.equal(ui.getState().text,'pending ground JSON');
  planner.execute({type:'set-environment',patch:{thermal:{input:{zones:[]},notes:'other author'}}});
  assert.equal(ui.getState().conflict,true);
  assert.throws(()=>ui.save(),/Saved inputs changed/);
  assert.equal(ui.getState().text,'pending ground JSON');
  ui.keepDraft();assert.equal(ui.getState().conflict,false);
  assert.equal(ui.getState().acknowledged,false);
  ui.dispose();assert.equal(Drafts.pending(planner).length,0);
});
test('same-revision geometry edits invalidate results, unrelated shared source updates retain independent RC evidence',()=>{
  const {planner,ui}=setup('thermal');complete(ui,'thermal');ui.run();
  const output=ui.getState().result.output;
  planner.execute({type:'set-environment',patch:{glazing:{vlt:0,source:'Explicit fixture'},weather:{records:[],source:{label:'Imported'}}}});
  assert.deepEqual(ui.getState().result.output,output);
  assert.equal(ui.getState().context.glazing.vlt,0);
  const project=JSON.parse(planner.exportProject());project.site.latitude+=0.1;
  planner.replaceProject(project);
  assert.equal(ui.getState().result,null);
  assert.match(ui.getState().status,/stale/);
  assert.equal(ui.exportData().resultCurrent,false);
  ui.dispose();
});
test('shared result renderer preserves errors, exact zero and escapes source room names',()=>{
  assert.match(Environment.reducedResultMarkup('thermal',{}),/incomplete or unsupported/);
  const {ui}=setup('thermal');complete(ui,'thermal');ui.run();
  const entry=ui.getState().result;
  assert.match(Environment.reducedResultMarkup('thermal',entry),/Hypothetical RC-state temperatures/);
  assert.match(Environment.reducedResultMarkup('thermal',entry),/Energy residual 0/);
  ui.dispose();
});
test('Light explicitly reuses shared Materials VLT/source without treating SHGC or null as optical transmission',()=>{
  const planner=controllerFor(createFixture('multiple-floors').project);
  const LightUI=require('../planner-light-ui.js');
  const light=LightUI.createController(planner,{HomePlannerLight:require('../planner-light.js')});
  planner.execute({type:'set-environment',patch:{glazing:{shgc:0.3,vlt:null,source:'Fixture product'}}});
  assert.equal(light.useProjectGlazing(),null);
  assert.match(light.getState().error,/VLT/);
  planner.execute({type:'set-environment',patch:{glazing:{shgc:0.3,vlt:0,source:'Fixture product'}}});
  const before=planner.exportProject();
  assert.deepEqual(light.useProjectGlazing(),{mode:'visible-transmission',visibleTransmittance:0,source:'Fixture product'});
  assert.equal(planner.exportProject(),before);
  assert.equal(light.getState().draft.windowOptics.visibleTransmittance,0);
  light.dispose();
});
