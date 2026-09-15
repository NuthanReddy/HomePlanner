const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Sun=require('../sun-model.js');
const script=fs.readFileSync(path.join(__dirname,'..','sun-exposure.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const sides=['Front','Right','Rear','Left'];

function node(){
  const listeners=new Map(),attributes=new Map();
  return {value:'',innerHTML:'',textContent:'',hidden:true,disabled:false,dataset:{},
    get valueAsNumber(){return this.value===''?NaN:Number(this.value);},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    removeEventListener(){},
    async emit(type){await Promise.all((listeners.get(type)||[]).map(handler=>handler({preventDefault(){}})));},
    setAttribute(key,value){attributes.set(key,value);},
    getAttribute(key){return attributes.get(key)??null;}
  };
}

function setup(){
  const ids=['sunExposure','sunExposureError','sunExposureSave','sunExposureCalculate','sunNeighborRows',
    'sunExposureForm','sunExposureResults','sunExposureStatus','sunExposurePlot','sunExposureScenario','sunExposureGeometryNote','sunExposureGeometry',
    'sunLatitude','sunLongitude','sunDate','sunTime','sunTimeZone','sunOccurrence',
    ...sides.flatMap(side=>['State','Height','Gap','Label'].map(suffix=>'sunNeighbor'+side+suffix))];
  const nodes=Object.fromEntries(ids.map(id=>[id,node()])),host=nodes.sunExposure;
  host.querySelector=selector=>nodes[selector.slice(1)];
  for(const [id,value] of Object.entries({sunLatitude:'17.3262',sunLongitude:'78.5916',sunDate:'2026-09-15',
    sunTime:'10:44',sunTimeZone:'Asia/Kolkata',sunOccurrence:''}))nodes[id].value=value;
  for(const side of sides)nodes['sunNeighbor'+side+'State'].value='unknown';
  const document={...node(),readyState:'complete',getElementById:id=>nodes[id]};
  let project={id:'test-project',environment:{},floors:[{id:'floor',name:'Ground floor',heightM:3}]};
  const scene={floorId:'floor',headingDeg:0,plot:{x:-1,y:-3,w:12,h:14},floor:{x:0,y:0,w:10,h:10},
    building:{x:1,y:1,w:8,h:8},floorElevationM:0,wallHeightM:2.8,roofThicknessM:.15,
    walls:[],openings:[],obstacles:[],rooms:[],regulatory:{nonCompliantSetbacks:false}};
  const listeners=new Set(),calls={studies:0,intervals:0};
  const planner={getProject:()=>project,getScenes:()=>[clone(scene)],
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    execute(command){
      assert.equal(command.type,'set-environment');
      project.environment={...project.environment,...clone(command.patch)};
      listeners.forEach(listener=>listener({type:'change',project}));
    }};
  const Physics={createSunlightStudy(scenes,options){
    calls.studies++;
    assert.equal(scenes[0].floor.w,12);assert.equal(scenes[0].building.y,4);
    assert.ok(Object.values(options.neighbors).every(item=>item.state!=='unknown'));
    return {addInterval(){calls.intervals++;},getResult:()=>({elapsedHours:24,aboveHorizonHours:12.25,
      nearHorizonExcludedHours:0.25,assumptions:['Continuous opaque neighbour screens.'],warnings:[],surfaces:[
      {id:'floor:roof',floorId:'floor',type:'roof',normal:{x:0,y:0,z:1},areaM2:64,
        averageHours:6,minHours:4,maxHours:8,unobstructedHours:12,blockedHours:6,
        firstSunUTC:'2026-09-15T02:00:00.000Z',lastSunUTC:'2026-09-15T10:00:00.000Z'}
    ]})};
  }};
  vm.runInNewContext(script,{document,HomePlanner:planner,HomeSun:Sun,BuildingPhysics:Physics,
    Date,Intl,Error,Math,Number,Object,JSON,Set,Map,setTimeout:callback=>setImmediate(callback)});
  async function clearSides(){
    sides.forEach(side=>{nodes['sunNeighbor'+side+'State'].value='clear';});
    await nodes.sunExposureForm.emit('input');
  }
  return {nodes,document,calls,clearSides,getProject:()=>project};
}

test('unknown neighbours stop calculation; incomplete drafts can still be saved',async()=>{
  const ui=setup();
  await ui.nodes.sunExposureForm.emit('submit');
  assert.match(ui.nodes.sunExposureError.textContent,/front side is unknown/);
  assert.equal(ui.calls.studies,0);
  ui.nodes.sunNeighborFrontState.value='block';
  await ui.nodes.sunExposureForm.emit('input');
  await ui.nodes.sunExposureSave.emit('click');
  const draft=ui.getProject().environment.sunlight;
  assert.equal(draft.neighbors.front.heightM,null);
  assert.equal(draft.neighbors.front.gapM,null);
  assert.equal(draft.result,undefined);
});

test('calculation saves a result and changing only clock time retains the whole-day study',async()=>{
  const ui=setup();
  await ui.clearSides();
  await ui.nodes.sunExposureForm.emit('submit');
  assert.equal(ui.calls.studies,1);
  assert.equal(ui.calls.intervals,288);
  assert.ok(ui.getProject().environment.sunlight.result);
  assert.match(ui.nodes.sunExposureResults.innerHTML,/6 h 00 min/);
  assert.match(ui.nodes.sunExposureResults.innerHTML,/calculation cutoff: 12 h 00 min/);
  assert.match(ui.nodes.sunExposureResults.innerHTML,/Continuous opaque neighbour screens/);
  assert.match(ui.nodes.sunExposureStatus.textContent,/Calculated and saved 288 intervals/);
  assert.equal(ui.nodes.sunExposure.getAttribute('aria-busy'),'false');
  const saved=ui.getProject().environment.sunlight.result.key;
  ui.nodes.sunTime.value='15:00';
  await ui.document.emit('homeplanner:sun-change');
  assert.equal(ui.calls.studies,1);
  assert.equal(ui.getProject().environment.sunlight.result.key,saved);
  assert.match(ui.nodes.sunExposureResults.innerHTML,/6 h 00 min/);
  ui.nodes.sunDate.value='2026-09-16';
  await ui.document.emit('homeplanner:sun-change');
  assert.equal(ui.nodes.sunExposureResults.innerHTML,'');
  assert.match(ui.nodes.sunExposureStatus.textContent,/Recalculate/);
});

test('editing neighbours cancels an in-progress study without saving stale hours',async()=>{
  const ui=setup();
  await ui.clearSides();
  const pending=ui.nodes.sunExposureForm.emit('submit');
  ui.nodes.sunNeighborFrontState.value='block';
  ui.nodes.sunNeighborFrontHeight.value='15';
  ui.nodes.sunNeighborFrontGap.value='2';
  await ui.nodes.sunExposureForm.emit('input');
  await pending;
  assert.equal(ui.getProject().environment.sunlight.result,undefined);
  assert.equal(ui.nodes.sunExposureResults.innerHTML,'');
  assert.equal(ui.nodes.sunExposure.getAttribute('aria-busy'),'false');
  assert.equal(ui.nodes.sunExposureCalculate.disabled,false);
});

test('invalid stored sunlight values are reported instead of displayed and can be recalculated',async()=>{
  const ui=setup();
  await ui.clearSides();await ui.nodes.sunExposureForm.emit('submit');
  ui.getProject().environment.sunlight.result.output.surfaces[0].averageHours='invalid';
  await ui.document.emit('homeplanner:sun-change');
  assert.equal(ui.nodes.sunExposureResults.innerHTML,'');
  assert.match(ui.nodes.sunExposureError.textContent,/saved sunlight result is incomplete or invalid/);
  assert.equal(ui.nodes.sunExposureCalculate.disabled,false);
  await ui.nodes.sunExposureForm.emit('submit');
  assert.match(ui.nodes.sunExposureResults.innerHTML,/6 h 00 min/);
  assert.equal(ui.nodes.sunExposureError.hidden,true);
});
