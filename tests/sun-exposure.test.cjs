const test=require('node:test');
const assert=require('node:assert/strict');
const exposure=require('../sun-exposure.js');
const Model=require('../planner-model.js');
const Physics=require('../building-physics.js');
const Sun=require('../sun-model.js');
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  return {
    project:{id:'project',floors:[{id:'ground',name:'Ground',heightM:3}]},
    scene:{floorId:'ground',headingDeg:90,floorElevationM:0,wallHeightM:2.8,roofThicknessM:0.15,
      floor:{x:0,y:0,w:10,h:8},plot:{x:-1,y:-3,w:13,h:16},building:{x:0.5,y:0.5,w:9,h:7},
      walls:[{id:'wall',start:{x:0.5,y:0.5},end:{x:9.5,y:0.5}}],
      rooms:[{id:'room',rect:{x:0.7,y:0.7,w:8.6,h:6.6}}],
      obstacles:[{id:'neighbor',x:12,y:0,w:3,h:8}],openings:[],regulatory:{nonCompliantSetbacks:true}},
    config:{latitude:17,longitude:78,date:'2026-09-15',time:'10:44',timeZone:'Asia/Kolkata',occurrence:''}
  };
}

test('all neighbour sides start unknown, and unknown or incomplete sides cannot calculate',()=>{
  const neighbors=exposure.emptyNeighbors();
  assert.deepEqual(Object.values(neighbors).map(item=>item.state),['unknown','unknown','unknown','unknown']);
  assert.throws(()=>exposure.validateNeighbors(neighbors,{complete:true}),/front.*unknown/);
  for(const side of Object.keys(neighbors))neighbors[side]={state:'clear'};
  neighbors.front={state:'block',heightM:null,gapM:null};
  assert.deepEqual(exposure.validateNeighbors(neighbors).front,neighbors.front);
  assert.throws(()=>exposure.validateNeighbors(neighbors,{complete:true}),/Front height/);
  neighbors.front={state:'block',heightM:10,gapM:0};
  assert.deepEqual(exposure.validateNeighbors(neighbors,{complete:true}).front,neighbors.front);
  neighbors.front.heightM=0;
  assert.throws(()=>exposure.validateNeighbors(neighbors,{complete:true}),/height must be positive/);
  neighbors.front.heightM=10;neighbors.front.gapM=-1;
  assert.throws(()=>exposure.validateNeighbors(neighbors,{complete:true}),/gap cannot be negative/);
  assert.equal(exposure.emptyNeighbors().front.state,'unknown');
});

test('analysis uses property bounds rather than the buildable plate and translates geometry once',()=>{
  const data=fixture(),before=copy(data.scene);
  const [scene]=exposure.prepareScenes(data.project,[data.scene]);
  assert.deepEqual(scene.floor,{x:0,y:0,w:13,h:16});
  assert.deepEqual(scene.building,{x:1.5,y:3.5,w:9,h:7});
  assert.deepEqual(scene.walls[0].start,{x:1.5,y:3.5});
  assert.deepEqual(scene.rooms[0].rect,{x:1.7,y:3.7,w:8.6,h:6.6});
  assert.equal(scene.obstacles[0].x,13);
  assert.equal(scene.obstacles[0].y,3);
  assert.equal(scene.headingDeg,90);
  assert.deepEqual(data.scene,before);
  assert.equal(scene.regulatory.nonCompliantSetbacks,true);
});

test('missing plot information or uncompiled storeys never become guessed whole-house geometry',()=>{
  const data=fixture();
  assert.throws(()=>exposure.prepareScenes(data.project,[]),/valid house layout/);
  assert.throws(()=>exposure.prepareScenes(data.project,[{...data.scene,plot:null}]),/actual plot boundary/);
  data.project.floors.push({id:'upper',name:'Upper',heightM:3});
  assert.throws(()=>exposure.prepareScenes(data.project,[data.scene]),/Missing floor geometry: Upper/);
  const upper={...data.scene,floorId:'upper',plot:{x:-2,y:-4,w:13,h:16},floorElevationM:3};
  const scenes=exposure.prepareScenes(data.project,[data.scene,upper]);
  assert.equal(scenes[1].building.x,2.5);
  assert.equal(scenes[1].building.y,4.5);
  assert.equal(scenes[1].floorElevationM,3);
  assert.throws(()=>exposure.prepareScenes(data.project,[data.scene,{...upper,diagnostics:[{level:'error'}]}]),/geometry errors/);
});

test('result keys track date, geometry and neighbour data but not the selected clock hour',()=>{
  const data=fixture(),neighbors=exposure.emptyNeighbors(),scenes=exposure.prepareScenes(data.project,[data.scene]);
  const key=exposure.inputKey(data.project,scenes,data.config,neighbors);
  assert.equal(exposure.inputKey(data.project,scenes,{...data.config,time:'15:00'},neighbors),key);
  assert.notEqual(exposure.inputKey(data.project,scenes,{...data.config,date:'2026-09-16'},neighbors),key);
  assert.notEqual(exposure.inputKey(data.project,scenes,{...data.config,latitude:18},neighbors),key);
  neighbors.front={state:'block',heightM:10,gapM:2};
  assert.notEqual(exposure.inputKey(data.project,scenes,data.config,neighbors),key);
});

test('wall summaries rotate local normals and area-weight exposure instead of averaging rows',()=>{
  const data=fixture(),normal={x:0,y:-1,z:0};
  const common={floorId:'ground',type:'wall',normal,unobstructedHours:8,
    firstSunUTC:'2026-09-15T01:00:00.000Z',lastSunUTC:'2026-09-15T09:00:00.000Z'};
  const groups=exposure.groupSurfaces({surfaces:[
    {...common,id:'a',areaM2:10,averageHours:2,minHours:1,maxHours:3,blockedHours:6},
    {...common,id:'b',areaM2:30,averageHours:6,minHours:4,maxHours:8,blockedHours:2}
  ]},[data.scene]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].bearing,90);
  assert.equal(groups[0].averageHours,5);
  assert.equal(groups[0].minHours,1);
  assert.equal(groups[0].maxHours,8);
  assert.equal(groups[0].blockedHours,3);
  assert.equal(groups[0].areaM2,40);
});

test('real plot compilation, solar intervals and the sunlight kernel work together',()=>{
  const project=Model.createProject();
  const source=Model.buildScene({
    plate:{frontEdge:'E',width:10,depth:8,rawDepth:8,localSetbacks:{N:3,E:2,S:2,W:2}},
    g:{W:10,D:8,outerX:0.5,outerY:0.5,outerW:9,outerD:7,coreX:0.7,coreY:0.7,coreW:8.6,coreD:6.6},
    cfg:{walls:{external:0.2,internal:0.1}},
    plan:{placed:[],furniture:[],openings:{doors:[],windows:[]}}
  },project);
  const scenes=exposure.prepareScenes(project,[source]);
  assert.deepEqual(scenes[0].floor,{x:0,y:0,w:14,h:13});
  const neighbors=Object.fromEntries(['front','right','rear','left'].map(side=>[side,{state:'clear'}]));
  const clear=Physics.createSunlightStudy(scenes,{neighbors,samplesPerAxis:4});
  const blocks=Object.fromEntries(Object.keys(neighbors).map(side=>[side,{state:'block',heightM:12,gapM:2}]));
  const blocked=Physics.createSunlightStudy(scenes,{neighbors:blocks,samplesPerAxis:4});
  const config={latitude:17.3262,longitude:78.5916,date:'2026-09-15',time:'10:44',timeZone:'Asia/Kolkata'};
  for(const interval of Sun.dailyIntervals(config,5)){
    const input={startUTC:interval.startUTC,endUTC:interval.endUTC,sunENU:interval.vector};
    clear.addInterval(input);blocked.addInterval(input);
  }
  const unobstructed=clear.getResult(),shaded=blocked.getResult();
  assert.equal(shaded.elapsedHours,24);
  assert.equal(shaded.surfaces.length,5);
  const roof=result=>result.surfaces.find(surface=>surface.type==='roof');
  assert.ok(roof(shaded).averageHours<roof(unobstructed).averageHours);
  assert.ok(shaded.surfaces.every(surface=>surface.averageHours<=surface.unobstructedHours+1e-8));
  assert.equal(exposure.groupSurfaces(shaded,scenes).length,5);
  assert.doesNotThrow(()=>JSON.stringify(shaded));
});
