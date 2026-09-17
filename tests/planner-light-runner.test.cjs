'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Runner=require('../planner-light-runner.js'),Light=require('../planner-light.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
const source=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
const period={startUTC:'2026-09-15T06:00:00Z',endUTC:'2026-09-15T07:00:00Z'};
function config(extra={}){
  return {version:1,workplanes:[{id:'p',room:{floorId:'f',entityId:'room'},heightM:1,spacingM:1}],
    sky:{enabled:true,radialBands:32,azimuthSectors:128},windowOptics:{mode:'ideal-clear'},
    neighbors:Object.fromEntries(['front','right','rear','left'].map(k=>[k,{state:'clear'}])),
    neighborBoxes:[],roofContext:[{floorId:'f',state:'none',source:'Explicit analytical open plane.'}],
    minSunAltitudeDeg:1,period:copy(period),
    samples:[{...period,sampleUTC:'2026-09-15T06:30:00Z',sunENU:{east:0,north:0,up:1}}],...extra};
}
function scene(extra={}){
  return {version:1,kind:'DrawingScene',projectId:'p',revision:1,inputFingerprint:'drawing',
    siteDatum:{elevationM:null},diagnostics:[],scenes:[{
      floorId:'f',coordinateSpace:'site-local',floorElevationM:0,headingDeg:0,wallHeightM:3,
      floor:{x:-20,y:-20,w:40,h:40},plot:{x:-20,y:-20,w:40,h:40},building:{x:-1.1,y:-1.1,w:2.2,h:2.2},
      rooms:[{id:'room',rect:{x:-.05,y:-.05,w:.1,h:.1}}],walls:[],openings:[],obstacles:[],
      unresolvedOpenings:[],diagnostics:[],electrical:[],...extra}]};
}
function harness(options={}){
  const workers=[],timeouts=new Map();let sequence=0;
  class Worker{
    constructor(url,opts){
      this.url=url;this.options=opts;this.handlers=new Map();this.tasks=[];this.messages=[];this.imports=[];
      this.terminated=false;workers.push(this);
      const worker=this;
      const sandbox={};
      sandbox.self=sandbox;
      sandbox.addEventListener=(type,fn)=>{if(type==='message')worker.receive=fn;};
      sandbox.postMessage=data=>{
        const detached=structuredClone(data);worker.messages.push(detached);
        options.intercept?.(detached,worker);
        worker.emit('message',{data:detached});
      };
      sandbox.setTimeout=(fn,delay)=>{assert.equal(delay,0);if(!worker.terminated)worker.tasks.push(fn);return worker.tasks.length;};
      sandbox.importScripts=(...names)=>{
        if(options.importFailure)throw new Error('import failed');
        for(const name of names){worker.imports.push(name);vm.runInContext(source(name),context,{filename:name});}
        if(options.observeSteps){
          const original=sandbox.HomePlannerLight;
          sandbox.HomePlannerLight={...original,createStudy(...args){
            const study=original.createStudy(...args);
            return {...study,step(n){worker.steps.push(n);return study.step(n);}};
          }};
        }
      };
      this.steps=[];const context=vm.createContext(sandbox);this.context=context;
      vm.runInContext(source('planner-light-worker.js'),context,{filename:'planner-light-worker.js'});
    }
    addEventListener(type,fn){this.handlers.set(type,fn);}
    removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
    emit(type,event){this.handlers.get(type)?.(event);}
    postMessage(data){
      if(options.cloneFailure)throw new DOMException('cannot clone','DataCloneError');
      this.request=structuredClone(data);
      if(!options.noReply)this.tasks.push(()=>this.receive({data:this.request}));
    }
    terminate(){this.terminated=true;this.handlers.clear();this.tasks.length=0;}
    tick(){if(!this.terminated)this.tasks.shift()?.();}
    drain(){let n=0;while(this.tasks.length&&!this.terminated){assert.ok(++n<10000);this.tick();}}
  }
  const runtime={Worker,location:{href:'https://example.test/app/index.html'},
    setTimeout(fn,ms){assert.equal(ms,120000);const id=++sequence;timeouts.set(id,fn);return id;},
    clearTimeout(id){timeouts.delete(id);}};
  return {runtime,workers,timeouts,expire(){for(const fn of [...timeouts.values()])fn();}};
}
function cleaned(h,w=h.workers.at(-1)){
  assert.ok(w.terminated);assert.equal(w.handlers.size,0);assert.equal(w.tasks.length,0);assert.equal(h.timeouts.size,0);
}
function finiteFrozen(v){
  if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));Object.values(v).forEach(finiteFrozen);}
  else if(typeof v==='number')assert.ok(Number.isFinite(v));
}
test('lazy frozen global/CommonJS contract and actual browser dependency load order',async()=>{
  const h=harness({observeSteps:true}),r=Runner.createRunner(h.runtime);
  assert.deepEqual(Object.keys(r),['run','cancel','dispose']);assert.ok(Object.isFrozen(r));assert.equal(h.workers.length,0);
  const global={URL,document:{currentScript:{src:'https://example.test/assets/planner-light-runner.js'}},HomePlannerLight:Light};
  vm.runInNewContext(source('planner-light-runner.js'),global);
  assert.deepEqual(Object.keys(global.HomePlannerLightRunner),Object.keys(Runner));
  const browser=global.HomePlannerLightRunner.createRunner(h.runtime),s=scene(),c=config(),events=[];
  const promise=browser.run({scene:s,config:c},p=>events.push(p)),w=h.workers[0];
  assert.equal(w.url,'https://example.test/assets/planner-light-worker.js');assert.equal(w.options.type,'classic');
  w.tick();
  assert.deepEqual(w.imports,['planner-regions.js','planner-features.js','planner-model.js','planner-projection.js','building-physics.js','planner-light.js']);
  assert.equal(events.length,1);assert.equal(events[0].processedRays,0);assert.equal(w.steps.length,0);
  w.tick();assert.equal(events[1].processedRays,4096);assert.equal(w.tasks.length,1);
  w.drain();const result=await promise;
  assert.deepEqual(copy(result),Light.run(s,c));assert.equal(result.status,'complete');finiteFrozen(result);
  assert.equal(result.sky.sensorResults[0].cosineWeightedSkyAccess,1);
  assert.deepEqual(copy(result.direct.masks[0].directPathWeights),[1]);
  assert.ok(w.steps.every(n=>n===4096));
  assert.ok(w.messages.filter(m=>m.type==='progress').every(m=>!('result' in m)&&JSON.stringify(m).length<500));
  cleaned(h);
});
test('actual finite aperture and supplied roof match synchronous kernel and analytic integral',async()=>{
  const wall=(id,start,end)=>({id,start,end,baseM:0,heightM:3,thicknessM:.2,removed:false,exterior:false});
  const s=scene({roofThicknessM:.2,walls:[
    wall('front',{x:-1,y:1},{x:1,y:1}),wall('back',{x:-1,y:-1},{x:1,y:-1}),
    wall('left',{x:-1,y:-1},{x:-1,y:1}),wall('right',{x:1,y:-1},{x:1,y:1})],
    openings:[{id:'window',wallId:'front',kind:'window',offsetM:.5,widthM:1,sillM:1,heightM:1,openFraction:0}]});
  const c=config({roofContext:[],sky:{enabled:true,radialBands:128,azimuthSectors:512}});
  c.samples[0].sunENU={east:0,north:-2/Math.sqrt(5),up:1/Math.sqrt(5)};
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:s,config:c});h.workers[0].drain();
  const result=await promise;assert.deepEqual(result,Light.run(s,c));
  const d=1.1,a=.5,b=Math.sqrt(d*d+1),expected=d/Math.PI*(Math.atan(a/d)/d-Math.atan(a/b)/b);
  assert.ok(Math.abs(result.sky.sensorResults[0].cosineWeightedSkyAccess-expected)<.001);
  assert.deepEqual(result.direct.masks[0].directPathWeights,[1]);cleaned(h);
});
test('actual worker runs every supplied room floor plane sky-only without period, location or horizon',async()=>{
  const project=createFixture('furnished-single').project;
  project.floors[0].legacy.context.plate.sitePlot={x:0,y:0,w:10,h:8};
  project.legacy=copy(project.floors[0].legacy);
  const drawing=copy(controllerFor(project).getDrawingScene()),inventory=Light.discover(drawing);
  const c=config({direct:{enabled:false},period:null,samples:[],minSunAltitudeDeg:null,roofContext:[],
    neighbors:{},sky:{enabled:true,radialBands:8,azimuthSectors:32},
    workplanes:inventory.rooms.map((room,i)=>({id:'floor-plane-'+i,room:room.ref,heightM:0,spacingM:2}))});
  const before=JSON.stringify({drawing,c}),h=harness(),events=[];
  const promise=Runner.createRunner(h.runtime).run({scene:drawing,config:c},p=>events.push(p));
  h.workers[0].drain();const result=await promise;
  assert.deepEqual(result,Light.run(drawing,c));finiteFrozen(result);
  assert.equal(result.status,'incomplete');assert.equal(result.computationalComplete,true);
  assert.equal(result.context.status,'unknown-context');assert.equal(result.direct.status,'disabled');
  assert.equal(result.direct.complete,false);assert.deepEqual(result.direct.masks,[]);
  assert.equal(result.sampling.directRays,0);assert.ok(result.progress.processedRays>0);
  assert.ok(events.every(p=>p.totalIntervals===0&&p.completedIntervals===0));
  assert.equal(new Set(result.sensors.map(s=>s.workplaneId)).size,inventory.rooms.length);
  assert.ok(result.sky.sensorResults.every(s=>s.cosineWeightedSkyAccess===null&&Number.isFinite(s.modeledCosineWeightedSkyAccess)));
  assert.ok(result.direct.sensorResults.every(s=>Object.entries(s).every(([key,value])=>key==='sensorId'||value===null)));
  assert.ok(result.sensors.every(s=>s.point.z===drawing.scenes.find(f=>f.floorId===s.room.floorId).floorElevationM));
  assert.equal(JSON.stringify({drawing,c}),before);cleaned(h);
});
test('sky-only known context completes through runner while disabled direct totals remain null',async()=>{
  const c=config({direct:{enabled:false},period:null,samples:[],minSunAltitudeDeg:null});
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:scene(),config:c});
  h.workers[0].drain();const result=await promise;
  assert.equal(result.status,'complete');assert.equal(result.complete,true);
  assert.equal(result.direct.status,'disabled');assert.equal(result.direct.complete,false);
  assert.deepEqual(result,Light.run(scene(),c));cleaned(h);
});
test('sky-only protocol rejects forged direct status, rays, masks and zero-valued unavailable hours',async()=>{
  const changes=[
    r=>{r.direct.status='incomplete';},
    r=>{r.direct.complete=true;},
    r=>{r.sampling.directRays=1;},
    r=>{r.direct.masks=[{}];},
    r=>{r.direct.periodHours=0;},
    r=>{r.direct.processedIntervalHours=0;},
    r=>{r.direct.sensorResults[0].modeledProcessedPositivePathPresenceHours=0;},
    r=>{r.direct.sensorResults[0].knownProcessedTransmittedEquivalentSunHours=0;},
    r=>{r.sky.status='disabled';}
  ];
  for(const change of changes){
    const h=harness({intercept:m=>{if(m.type==='result')change(m.result);}});
    const promise=Runner.createRunner(h.runtime).run({scene:scene(),
      config:config({direct:{enabled:false},period:null,samples:[],minSunAltitudeDeg:null})});
    h.workers[0].drain();await assert.rejects(promise);cleaned(h);
  }
});
test('real worker thread executes browser worker sky-only protocol and publishes known and unknown context',async()=>{
  const {Worker:Thread}=require('node:worker_threads');
  class Worker{
    constructor(){
      this.handlers=new Map();
      this.thread=new Thread(`
        const {parentPort,workerData}=require('node:worker_threads');
        const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
        const sandbox={setTimeout,clearTimeout};sandbox.self=sandbox;
        sandbox.postMessage=data=>parentPort.postMessage(data);
        sandbox.addEventListener=(type,fn)=>{if(type==='message')parentPort.on('message',data=>fn({data}));};
        const context=vm.createContext(sandbox);
        sandbox.importScripts=(...names)=>{for(const name of names)
          vm.runInContext(fs.readFileSync(path.join(workerData.root,name),'utf8'),context,{filename:name});};
        vm.runInContext(fs.readFileSync(path.join(workerData.root,'planner-light-worker.js'),'utf8'),
          context,{filename:'planner-light-worker.js'});
      `,{eval:true,workerData:{root:require('node:path').resolve(__dirname,'..')}});
    }
    addEventListener(type,fn){
      const listener=type==='message'?data=>fn({data}):fn;
      this.handlers.set(fn,listener);this.thread.on(type,listener);
    }
    removeEventListener(type,fn){this.thread.off(type,this.handlers.get(fn));this.handlers.delete(fn);}
    postMessage(data){this.thread.postMessage(data);}
    terminate(){this.thread.terminate();}
  }
  for(const known of [true,false]){
    const runtime={Worker,location:{href:'https://example.test/index.html'},setTimeout,clearTimeout};
    const runner=Runner.createRunner(runtime),drawing=scene();
    const c=config({direct:{enabled:false},period:null,samples:[],minSunAltitudeDeg:null,
      ...(known?{}:{neighbors:{},roofContext:[]})});
    c.workplanes[0].heightM=0;
    try{
      const result=await runner.run({scene:drawing,config:c});
      assert.deepEqual(result,Light.run(drawing,c));
      assert.equal(result.status,known?'complete':'incomplete');
      assert.equal(result.direct.status,'disabled');assert.equal(result.direct.complete,false);
      assert.equal(result.sky.sensorResults[0].modeledCosineWeightedSkyAccess,1);
      assert.equal(result.sky.sensorResults[0].cosineWeightedSkyAccess,known?1:null);
      assert.ok(result.progress.processedRays>0);assert.equal(result.progress.totalIntervals,0);
    }finally{runner.dispose();}
  }
});
test('actual shared bridge DrawingScene fixture, real windows, roof and explicit context',async()=>{
  const project=createFixture('furnished-single').project;
  project.floors[0].legacy.context.plate.sitePlot={x:0,y:0,w:10,h:8};
  project.legacy=copy(project.floors[0].legacy);
  const s=copy(controllerFor(project).getDrawingScene()),inv=Light.discover(s);
  const c=config({workplanes:[{id:'p',room:inv.rooms[0].ref,heightM:.8,spacingM:2}],
    sky:{enabled:true,radialBands:8,azimuthSectors:32},roofContext:[]});
  assert.ok(s.scenes[0].openings.some(o=>o.kind==='window'));
  for(const floor of s.scenes)floor.roofThicknessM=.2;
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:s,config:c});h.workers[0].drain();
  const result=await promise;assert.deepEqual(result,Light.run(s,c));assert.equal(result.status,'complete');finiteFrozen(result);
  cleaned(h);
});
test('real worker transmits exact reserved-region fragments with verified area and grid identity',async()=>{
  const project=createFixture('furnished-single').project;
  project.floors[0].legacy.context.plate.sitePlot={x:0,y:0,w:10,h:8};
  project.legacy=copy(project.floors[0].legacy);
  const drawing=copy(controllerFor(project).getDrawingScene()),room=drawing.scenes[0].rooms[0];
  const Regions=require('../planner-regions.js'),cut={x:room.rect.x+.3,y:room.rect.y+.3,w:.4,h:.4};
  room.usableRegions=Regions.subtractRectangle(room.rect,[cut]);room.reservedAreaM2=.16;
  const c=config({workplanes:[{id:'p',room:{floorId:'ground',entityId:room.id},heightM:.8,spacingM:1}],roofContext:[]});
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:drawing,config:c});
  h.workers[0].drain();const result=await promise;
  assert.equal(result.status,'complete');
  assert.deepEqual(result,Light.run(drawing,c));
  assert.ok(result.sensors.every(sensor=>Regions.intersection(sensor.cell,cut)===null));
  assert.ok(Math.abs(result.sensors.reduce((area,sensor)=>area+sensor.areaWeightM2,0)-Regions.area(room.usableRegions))<1e-9);
  cleaned(h);
});
test('night and unresolved receiver operations yield even with zero processed rays',async()=>{
  for(const up of [-1,.01]){
    const s=scene({rooms:[{id:'room',rect:{x:-5,y:-5,w:10,h:10}}]});
    const c=config({sky:{enabled:false},workplanes:[{id:'p',room:{floorId:'f',entityId:'room'},heightM:1,spacingM:.2}]});
    c.samples=[];
    for(let i=0;i<2;i++)c.samples.push({startUTC:`2026-09-15T06:${i?'30':'00'}:00Z`,
      endUTC:i?period.endUTC:'2026-09-15T06:30:00Z',sampleUTC:`2026-09-15T06:${i?'45':'15'}:00Z`,
      sunENU:{east:Math.sqrt(1-up*up),north:0,up}});
    const h=harness({observeSteps:true}),events=[];
    const promise=Runner.createRunner(h.runtime).run({scene:s,config:c},p=>events.push(p)),w=h.workers[0];
    w.tick();w.tick();
    assert.equal(events.at(-1).processedRays,0);assert.equal(events.at(-1).completedIntervals,1);
    assert.equal(events.at(-1).computationalComplete,false);assert.equal(w.tasks.length,1);
    w.drain();const result=await promise;
    assert.deepEqual(result,Light.run(s,c));assert.equal(result.status,up<0?'complete':'incomplete');cleaned(h);
  }
});
test('blocked and unknown context stay honest; same-ID/revision stale full physical key is not shortened',async()=>{
  const s=scene();
  for(let i=0;i<120;i++)s.scenes[0].walls.push({id:'wall-'+i,start:{x:10+i,y:10},end:{x:10+i,y:11},
    baseM:0,heightM:3,thicknessM:.2,removed:false,exterior:false});
  const key=Light.discover(s).physicalFingerprint;assert.ok(key.length>16384);
  const cases=[
    {scene:s,config:config(),expectedPhysicalFingerprint:key},
    {scene:copy(s),config:config(),expectedPhysicalFingerprint:key},
    {scene:scene(),config:{}},
    {scene:scene(),config:config({neighbors:{}})}
  ];
  cases[1].scene.scenes[0].walls[0].heightM=4;
  for(let i=0;i<cases.length;i++){
    const args=cases[i],h=harness(),promise=Runner.createRunner(h.runtime).run(args);h.workers[0].drain();
    const result=await promise;assert.deepEqual(result,Light.run(args.scene,args.config,
      ownGuard(args)));
    assert.equal(result.status,['complete','blocked','blocked','incomplete'][i]);cleaned(h);
  }
  function ownGuard(a){return a.expectedPhysicalFingerprint?{expectedPhysicalFingerprint:a.expectedPhysicalFingerprint}:{};}
});
test('guard is scene fingerprint, not neighbor-augmented study fingerprint',async()=>{
  const s=scene(),c=config();c.neighbors.front={state:'modeled',boxIds:['b']};
  c.neighborBoxes=[{id:'b',x:10,y:10,w:1,h:1,baseM:0,heightM:3,transmittance:.5}];
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:s,config:c,expectedPhysicalFingerprint:Light.discover(s).physicalFingerprint});
  h.workers[0].drain();const r=await promise;assert.equal(r.status,'complete');
  assert.notEqual(r.provenance.physicalFingerprint,r.provenance.scenePhysicalFingerprint);cleaned(h);
});
test('cancel between batches, supersede, dispose, and late/out-of-order callbacks never publish',async()=>{
  const h=harness(),runner=Runner.createRunner(h.runtime),events=[];
  const first=runner.run({scene:scene(),config:config()},p=>events.push(p));
  const rejected=assert.rejects(first,{name:'AbortError'}),old=h.workers[0];
  old.tick();old.tick();const late=old.handlers.get('message');
  const second=runner.run({scene:scene(),config:config()});
  await rejected;assert.ok(old.terminated);
  const current=h.workers[1];
  current.emit('message',{data:{version:1,token:old.request.token,type:'progress',progress:{}}});
  late({data:{version:1,token:old.request.token,type:'result',result:{}}});
  current.drain();assert.equal((await second).status,'complete');cleaned(h);
  const count=events.length;late({data:{version:1,token:old.request.token,type:'progress',progress:{}}});
  assert.equal(events.length,count);
  const third=runner.run({scene:scene(),config:config()});const abort=assert.rejects(third,{name:'AbortError'});
  h.workers[2].tick();runner.cancel();await abort;cleaned(h);
  const fourth=runner.run({scene:scene(),config:config()});const disposed=assert.rejects(fourth,{name:'AbortError'});
  runner.dispose();await disposed;cleaned(h);
  await assert.rejects(runner.run({scene:scene(),config:config()}),/disposed/);assert.equal(h.workers.length,4);
});
test('worker ignores concurrent requests and sends one final result',async()=>{
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:scene(),config:config()}),w=h.workers[0];
  w.tick();w.receive({data:{...w.request,token:w.request.token+1}});w.drain();
  await promise;assert.equal(w.messages.filter(m=>m.type==='result').length,1);
  assert.equal(w.messages.filter(m=>m.type==='error').length,0);cleaned(h);
});
test('progress callback throw rejects and releases every resource',async()=>{
  const h=harness(),error=new Error('render failed'),promise=Runner.createRunner(h.runtime).run(
    {scene:scene(),config:config()},()=>{throw error;});
  h.workers[0].tick();await assert.rejects(promise,e=>e===error);cleaned(h);
});
test('malformed progress, backwards counters, foreign versions and forged results fail closed',async()=>{
  const edits=[
    m=>{if(m.type==='progress')m.progress.totalSensors=-1;},
    m=>{if(m.type==='progress'&&m.progress.processedRays)m.progress.processedRays=1;},
    m=>{m.version=2;},
    m=>{if(m.type==='result')m.result.provenance.scenePhysicalFingerprint='forged';},
    m=>{if(m.type==='result')m.result.config.sky.radialBands=1;},
    m=>{if(m.type==='result')m.result.direct.periodHours=Infinity;},
    m=>{if(m.type==='result')m.result.status='running';},
    m=>{if(m.type==='result')m.result.progress.finalized=false;},
    m=>{if(m.type==='result')m.result.inventory.physicalFingerprint='forged';},
    m=>{if(m.type==='result')m.result.sky.sensorResults[0].cosineWeightedSkyAccess=2;},
    m=>{if(m.type==='result')m.result.direct.masks[0].directPathWeights[0]=-1;},
    m=>{if(m.type==='result')m.result.limitations=['x'.repeat(16000001)];}
  ];
  for(const intercept of edits){
    const h=harness({intercept}),promise=Runner.createRunner(h.runtime).run({scene:scene(),config:config()});
    h.workers[0].drain();await assert.rejects(promise);cleaned(h);
  }
});
test('type/range errors, finite clone validation, memory budgets and malformed schemas',async()=>{
  const cyclic={};cyclic.self=cyclic;
  const cases=[
    [{scene:scene(),config:{...config(),unsupported:1}},'TypeError'],
    [{scene:scene(),config:config({sky:{enabled:true,radialBands:129,azimuthSectors:4}})},'RangeError'],
    [{scene:scene(),config:config({minSunAltitudeDeg:NaN})},'TypeError'],
    [{scene:scene(),config:cyclic},'TypeError'],
    [{scene:scene(),config:config(),expectedPhysicalFingerprint:4},'TypeError'],
    [{scene:scene(),config:config(),expectedPhysicalFingerprint:'x'.repeat(16000001)},'RangeError'],
    [{scene:scene(),config:config({label:'x'.repeat(16000001)})},'RangeError'],
    [{scene:scene(),config:config({samples:new Array(1)})},'TypeError'],
    [{scene:scene(),config:new Date()},'TypeError'],
    [{scene:scene(),config:config(),url:'evil'},'TypeError']
  ];
  for(const [args,name] of cases){
    const h=harness();await assert.rejects(Runner.createRunner(h.runtime).run(args),{name});
    assert.equal(h.workers.length,0);assert.equal(h.timeouts.size,0);
  }
  const c=config();Object.defineProperty(c,'label',{enumerable:true,get(){throw new Error('must not execute');}});
  await assert.rejects(Runner.createRunner(harness().runtime).run({scene:scene(),config:c}),/accessors/);
});
test('preparation range exceptions, imports, clone failures, deserialization, worker errors and bounded timeout clean up',async()=>{
  for(const options of [{importFailure:true},{cloneFailure:true},{noReply:true}]){
    const h=harness(options),promise=Runner.createRunner(h.runtime).run({scene:scene(),config:config()});
    h.workers[0].drain();if(options.noReply)h.expire();
    await assert.rejects(promise,options.noReply?{name:'TimeoutError'}:undefined);cleaned(h);
  }
  for(const event of ['error','messageerror']){
    const h=harness({noReply:true}),promise=Runner.createRunner(h.runtime).run({scene:scene(),config:config()});
    h.workers[0].emit(event,{message:'worker stopped'});await assert.rejects(promise);cleaned(h);
  }
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:scene(),
    config:config({workplanes:[{id:'p',room:{floorId:'f',entityId:'room'},heightM:1,spacingM:.000001}]})});
  h.workers[0].drain();await assert.rejects(promise,{name:'RangeError'});cleaned(h);
});
test('missing Worker/file origin reject with no ray fallback; runner never calls createStudy/run',async()=>{
  const h=harness();delete h.runtime.Worker;
  await assert.rejects(Runner.createRunner(h.runtime).run({scene:scene(),config:config()}),/Workers unavailable/);
  const file=harness();file.runtime.location.href='file:///app/index.html';
  await assert.rejects(Runner.createRunner(file.runtime).run({scene:scene(),config:config()}),/HTTP/);
  const browser={URL,HomePlannerLight:{discover:Light.discover,normalizeConfig:Light.normalizeConfig,
    createStudy(){assert.fail('no main-thread accumulator');},run(){assert.fail('no main-thread rays');}}};
  vm.runInNewContext(source('planner-light-runner.js'),browser);
  const real=harness(),promise=browser.HomePlannerLightRunner.createRunner(real.runtime).run({scene:scene(),config:config()});
  real.workers[0].drain();assert.equal((await promise).status,'complete');cleaned(real);
});
test('submitted snapshots are detached from caller mutations',async()=>{
  const s=scene(),c=config(),baseline=Light.run(s,c),h=harness();
  const promise=Runner.createRunner(h.runtime).run({scene:s,config:c});
  s.scenes[0].wallHeightM=10;c.neighbors.front.state='unknown';
  h.workers[0].drain();assert.deepEqual(await promise,baseline);cleaned(h);
});
test('worker rejects unsupported controls, schemas and versions without importing arbitrary assets',()=>{
  for(const change of [
    r=>({...r,version:2}),r=>({...r,token:-1}),r=>({...r,type:'cancel'}),
    r=>({...r,importURL:'https://other.test/evil.js'}),r=>({...r,config:null}),
    r=>({...r,expectedPhysicalFingerprint:5})
  ]){
    const h=harness({noReply:true}),w=new h.runtime.Worker('local',{});
    w.receive({data:change({version:1,type:'run',token:1,scene:scene(),config:config()})});
    assert.equal(w.imports.length,0);assert.equal(w.messages.length,1);assert.equal(w.messages[0].type,'error');
    assert.ok(['TypeError','RangeError'].includes(w.messages[0].error.name));w.terminate();
  }
});
test('timeout also bounds a running study between batches and import startup',async()=>{
  const h=harness(),promise=Runner.createRunner(h.runtime).run({scene:scene(),config:config()});
  h.workers[0].tick();h.workers[0].tick();assert.equal(h.workers[0].tasks.length,1);
  h.expire();await assert.rejects(promise,{name:'TimeoutError'});cleaned(h);
});
