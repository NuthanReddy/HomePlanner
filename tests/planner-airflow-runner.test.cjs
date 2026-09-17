const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Runner=require('../planner-airflow-runner.js');
const Airflow=require('../planner-airflow.js');
const Projection=require('../planner-projection.js');
const {createFixture,controllerFor}=require('./fixtures/drawing-fixtures.cjs');
const copy=value=>structuredClone(value);
function args(){
  const project=createFixture('multiple-floors').project;
  for(const floor of project.floors)floor.legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
  project.legacy=copy(project.floors[0].legacy);
  return {
    scene:copy(Projection.build(project)),
    scenario:{version:1,id:'same-id',densityKgM3:1.2,
      zones:[{id:'living',room:{floorId:'ground',entityId:'ground:living'},volumeM3:30}],links:[]}
  };
}
function harness(){
  const workers=[],timers=new Map();
  let timerId=0;
  class Worker{
    constructor(url,options){this.url=url;this.options=options;this.events=new Map();this.terminated=0;workers.push(this);}
    addEventListener(type,fn){this.events.set(type,fn);}
    removeEventListener(type,fn){if(this.events.get(type)===fn)this.events.delete(type);}
    postMessage(value){this.request=copy(value);}
    terminate(){this.terminated++;}
    emit(type,data){this.events.get(type)?.(type==='message'?{data}:data||{});}
    reply(result=Airflow.run(this.request.scene,this.request.scenario,
      Object.hasOwn(this.request,'expectedPhysicalFingerprint')?{expectedPhysicalFingerprint:this.request.expectedPhysicalFingerprint}:{})){
      this.emit('message',{version:1,type:'result',token:this.request.token,result:copy(result)});
    }
  }
  const runtime={Worker,location:{href:'https://planner.example/app/index.html?view=plan'},
    setTimeout(fn,delay){assert.equal(delay,120000);timers.set(++timerId,fn);return timerId;},
    clearTimeout(id){timers.delete(id);}};
  const runner=Runner.createRunner(runtime);
  return {runtime,runner,workers,timers,timeout(){[...timers.values()][0]();}};
}
function cleaned(h,worker=h.workers.at(-1)){
  assert.equal(worker.terminated,1);assert.equal(worker.events.size,0);assert.equal(h.timers.size,0);
}
function frozen(value){
  if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));Object.values(value).forEach(frozen);}
}
function workerVM({failedImport=false,failedResultClone=false,solverStatus}={}){
  let listener,posts=[];
  const imports=[];
  const sandbox={addEventListener(type,fn){assert.equal(type,'message');listener=fn;},
    postMessage(value){
      if(failedResultClone&&value.type==='result'){const error=new Error('Cannot clone result');error.name='DataCloneError';throw error;}
      posts.push(copy(value));
    }};
  sandbox.self=sandbox;
  const context=vm.createContext(sandbox);
  sandbox.importScripts=(...names)=>{
    imports.push(...names);
    if(failedImport){const error=new Error('offline cache missing');error.name='NetworkError';throw error;}
    for(const name of names){
      assert.ok(['planner-regions.js','building-physics.js','planner-airflow-field.js','planner-airflow.js'].includes(name));
      if(name==='planner-airflow.js'&&solverStatus){
        const real=context.BuildingPhysics;
        context.BuildingPhysics={...real,solveAirflow(input){
          if(solverStatus==='numerical-error')throw new (vm.runInContext('RangeError',context))('Test solver range overflow.');
          const result=copy(real.solveAirflow(input));
          result.status=solverStatus;result.converged=false;
          return result;
        }};
      }
      vm.runInContext(fs.readFileSync(require.resolve(`../${name}`),'utf8'),context,{filename:name});
    }
  };
  vm.runInContext(fs.readFileSync(require.resolve('../planner-airflow-worker.js'),'utf8'),context);
  return {imports,posts,send(request){listener({data:request});return posts.at(-1);}};
}
const request=()=>({version:1,type:'run',token:1,...args()});

test('factory is lazy; successful worker result matches foundation and is recursively frozen',async()=>{
  const h=harness(),input=args(),before=JSON.stringify(input);
  assert.equal(h.workers.length,0);assert.equal(h.timers.size,0);
  const promise=h.runner.run(input),w=h.workers[0];
  assert.equal(w.url,'https://planner.example/app/planner-airflow-worker.js');
  assert.equal(w.options.type,'classic');
  w.reply();const result=await promise;
  assert.equal(result.status,'converged');
  assert.deepEqual(result,Airflow.run(input.scene,input.scenario));frozen(result);
  assert.equal(JSON.stringify(input),before);assert.notEqual(result.scenario,input.scenario);cleaned(h);
});

test('captures classic script directory at load, even after currentScript disappears',async()=>{
  const h=harness(),sandbox={URL,document:{currentScript:{src:'https://planner.example/assets/planner-airflow-runner.js?v=8'}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../planner-airflow-runner.js'),'utf8'),sandbox);
  sandbox.document.currentScript=null;
  const runner=sandbox.HomePlannerAirflowRunner.createRunner(h.runtime);
  const promise=runner.run(args());
  assert.equal(h.workers[0].url,'https://planner.example/assets/planner-airflow-worker.js');
  h.workers[0].reply();await promise;cleaned(h);
});

test('fallback document base and explicitly same-origin worker URLs are supported',async()=>{
  const h=harness();h.runtime.document={baseURI:'https://planner.example/static/index.html?x=1'};
  for(const options of [{},{workerURL:'workers/airflow.js?version=1'}]){
    const runner=Runner.createRunner(h.runtime,options),promise=runner.run(args());
    assert.equal(h.workers.at(-1).url,options.workerURL?
      'https://planner.example/static/workers/airflow.js?version=1':'https://planner.example/static/planner-airflow-worker.js');
    h.workers.at(-1).reply();await promise;cleaned(h);
  }
});

test('file pages, missing Workers, and nonlocal worker URLs fail without main-thread solving',async()=>{
  for(const url of ['https://remote.example/worker.js','data:text/javascript,1','blob:https://planner.example/id','file:///worker.js']){
    const h=harness(),runner=Runner.createRunner(h.runtime,{workerURL:url});
    await assert.rejects(runner.run(args()),/same-origin/);assert.equal(h.workers.length,0);
  }
  const file=harness();file.runtime.location.href='file:///C:/HomePlanner/index.html';
  await assert.rejects(file.runner.run(args()),/local HTTP\(S\) server/);assert.equal(file.workers.length,0);
  const absent=harness();delete absent.runtime.Worker;
  await assert.rejects(absent.runner.run(args()),/Workers are unavailable.*no main-thread/);
  assert.equal(absent.workers.length,0);
});

test('cancel before a run is inert; cancel immediately rejects once and ignores late events',async()=>{
  const h=harness();h.runner.cancel();assert.equal(h.workers.length,0);
  const promise=h.runner.run(args()),w=h.workers[0],late=w.events.get('message');
  const rejection=assert.rejects(promise,{name:'AbortError'});
  h.runner.cancel();h.runner.cancel();await rejection;cleaned(h);
  late({data:{version:1,type:'result',token:w.request.token,result:{}}});
  cleaned(h);
});

test('superseding identical scenario IDs uses distinct tokens and never publishes older results',async()=>{
  const h=harness(),first=h.runner.run(args()),old=h.workers[0],late=old.events.get('message');
  const rejected=assert.rejects(first,{name:'AbortError'});
  const input=args();input.scenario.notes='newer snapshot';
  const second=h.runner.run(input),current=h.workers[1];
  assert.notEqual(old.request.token,current.request.token);
  late({data:{version:1,type:'result',token:old.request.token,result:{}}});
  current.reply();const result=await second;
  assert.equal(result.scenario.notes,'newer snapshot');await rejected;
  cleaned(h,old);cleaned(h,current);
});

test('snapshot is detached before caller mutations; expected physical mismatch remains blocked',async()=>{
  const h=harness(),input=args();input.expectedPhysicalFingerprint='older';
  const promise=h.runner.run(input);
  input.scenario.notes='changed after run';input.scene={};
  h.workers[0].reply();const result=await promise;
  assert.equal(result.status,'blocked');assert.equal(result.scenario.notes,undefined);
  assert.ok(result.findings.some(f=>f.code==='stale-physical-input'));cleaned(h);
});

test('disposing cancels pending work and permanently rejects new runs',async()=>{
  const h=harness(),promise=h.runner.run(args()),rejected=assert.rejects(promise,{name:'AbortError'});
  h.runner.dispose();h.runner.dispose();await rejected;cleaned(h);
  await assert.rejects(h.runner.run(args()),/disposed/);assert.equal(h.workers.length,1);
});

test('120-second timeout terminates and rejects rather than publishing success',async()=>{
  const h=harness(),promise=h.runner.run(args()),rejected=assert.rejects(promise,{name:'TimeoutError'});
  h.timeout();await rejected;cleaned(h);
});

test('script error, messageerror, constructor and postMessage errors reject and clean up',async()=>{
  for(const type of ['error','messageerror','postMessage','constructor']){
    const h=harness();
    if(type==='postMessage')h.runtime.Worker.prototype.postMessage=()=>{const e=new Error('clone failed');e.name='DataCloneError';throw e;};
    if(type==='constructor')h.runtime.Worker=class{constructor(){throw new Error('CSP blocked Worker');}};
    const promise=h.runner.run(args()),rejected=assert.rejects(promise);
    if(type==='error'||type==='messageerror')h.workers[0].emit(type,{message:'failed import'});
    await rejected;
    if(type!=='constructor')cleaned(h);
    else assert.equal(h.timers.size,0);
  }
});

test('malformed envelope, foreign token, invalid result and provenance mismatches reject',async()=>{
  const mutations=[
    value=>null,
    value=>({...value,version:99}),
    value=>({...value,token:value.token+1}),
    value=>({...value,extra:true}),
    value=>({...value,type:'other'}),
    value=>({...value,result:{}}),
    value=>{value.result.provenance.revision++;return value;},
    value=>{value.result.scenario.notes='foreign';return value;},
    value=>{value.result.inventory.physicalFingerprint='foreign';return value;},
    value=>{value.result.provenance.inputFingerprint='foreign';return value;},
    value=>{value.result.flowResults={};return value;},
    value=>{value.result.zones[0].id='foreign';return value;},
    value=>{value.result.zoneResults=[];return value;},
    value=>{value.result.balanced=false;return value;},
    value=>{value.result.status='success';return value;},
    value=>{value.result.findings.push({value:NaN});return value;},
    value=>{value.result.inventory.cycle=value.result;return value;}
  ];
  for(const mutate of mutations){
    const h=harness(),promise=h.runner.run(args()),w=h.workers[0],rejected=assert.rejects(promise);
    const result=copy(Airflow.run(w.request.scene,w.request.scenario));
    w.emit('message',mutate({version:1,type:'result',token:w.request.token,result}));
    await rejected;cleaned(h);
  }
});

test('required arguments and finite JSON validated before a Worker is started',async()=>{
  const cycle={};cycle.self=cycle;
  const invalid=[undefined,{},null,{scene:{},scenario:[]},{...args(),unexpected:true},
    {...args(),expectedPhysicalFingerprint:null},{...args(),scenario:cycle},
    {...args(),scenario:{...args().scenario,notes:undefined}},
    {...args(),scenario:{...args().scenario,zones:Array(1)}}];
  for(const input of invalid){
    const h=harness();await assert.rejects(h.runner.run(input));assert.equal(h.workers.length,0);
  }
});

test('VM classic worker imports only fixed local dependencies on first request and produces real result',()=>{
  const worker=workerVM(),input=request();
  assert.deepEqual(worker.imports,[]);
  const reply=worker.send(input);
  assert.deepEqual(worker.imports,['planner-regions.js','building-physics.js','planner-airflow-field.js','planner-airflow.js']);
  assert.equal(reply.type,'result');assert.equal(reply.token,input.token);
  assert.deepEqual(reply.result,Airflow.run(input.scene,input.scenario));
  assert.equal(worker.send(input).type,'error');assert.equal(worker.imports.length,4);
});

test('guarded real worker accepts the full generated eight-room physical fingerprint',async()=>{
  const project=createFixture('furnished-single').project;
  project.floors[0].legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
  project.legacy=copy(project.floors[0].legacy);
  const bridge=controllerFor(project);
  bridge.execute({type:'add-floor',copyFromId:project.activeFloorId,name:'Upper'});
  const scene=bridge.getDrawingScene(),inventory=Airflow.discover(scene);
  assert.equal(inventory.rooms.length,8);
  assert.ok(inventory.physicalFingerprint.length>16384);
  const scenario={version:1,densityKgM3:1.2,zones:[{id:'selected',room:inventory.rooms[0].ref,volumeM3:30}],links:[]};
  const h=harness(),promise=h.runner.run({scene,scenario,expectedPhysicalFingerprint:inventory.physicalFingerprint});
  const worker=h.workers[0];worker.emit('message',workerVM().send(worker.request));
  const result=await promise;
  assert.equal(result.status,'converged');
  assert.equal(result.provenance.physicalFingerprint,inventory.physicalFingerprint);
  cleaned(h);
});

test('real VM worker propagates strict foundation schema errors through the runner',async()=>{
  for(const [change,name] of [
    [input=>input.scenario.typo=true,'TypeError'],
    [input=>input.scenario.version=2,'RangeError'],
    [input=>input.scene.version=2,'TypeError']
  ]){
    const h=harness(),input=args();change(input);
    const promise=h.runner.run(input),rejected=assert.rejects(promise,{name}),w=h.workers[0];
    w.emit('message',workerVM().send(w.request));await rejected;cleaned(h);
  }
});

test('VM worker rejects unsupported request fields/tokens before importing code',()=>{
  for(const input of [{...request(),scriptURL:'https://remote.example/code.js'},
    {...request(),version:2},{...request(),type:'eval'},{...request(),token:'1'},null]){
    const worker=workerVM(),reply=worker.send(input);
    assert.equal(reply.type,'error');assert.equal(worker.imports.length,0);
    assert.deepEqual(Object.keys(reply.error),['name','message']);
  }
});

test('VM worker import failure is actionable and its original error name survives the runner',async()=>{
  const h=harness(),promise=h.runner.run(args()),w=h.workers[0];
  const rejected=assert.rejects(promise,{name:'NetworkError',message:/Cannot load local airflow dependencies.*CSP/});
  w.emit('message',workerVM({failedImport:true}).send(w.request));await rejected;cleaned(h);
});

test('VM worker postMessage clone failure sends an explicit error, not success',()=>{
  const reply=workerVM({failedResultClone:true}).send(request());
  assert.equal(reply.type,'error');assert.equal(reply.error.name,'DataCloneError');
});

test('honest blocked, nonconverged and numerical-error foundation results resolve unchanged',async()=>{
  for(const status of ['blocked','nonconverged','numerical-error']){
    const h=harness(),input=args();
    if(status==='blocked')delete input.scenario.densityKgM3;
    const promise=h.runner.run(input),w=h.workers[0];
    w.emit('message',workerVM({solverStatus:status==='blocked'?undefined:status}).send(w.request));
    const result=await promise;assert.equal(result.status,status);frozen(result);cleaned(h);
  }
});

test('actual VM worker and runner preserve analytical signed flows, pressure and ACH',async()=>{
  const h=harness(),input=args();
  const anchor={floorId:'ground',point:{x:3,y:4,z:.45}};
  input.scenario.links=[
    {id:'in',from:'outside',to:'living',pressurePa:12},
    {id:'out',from:'living',to:'outside',pressurePa:0}
  ].map(link=>({...link,kind:'manual',enabled:true,freeAreaM2:.5,cd:.6,openFraction:1,
    anchors:{from:copy(anchor),to:copy(anchor)}}));
  const promise=h.runner.run(input),w=h.workers[0];
  w.emit('message',workerVM().send(w.request));
  const result=await promise,q=.6*.5*Math.sqrt(12/1.2);
  assert.equal(result.status,'converged');
  assert.ok(Math.abs(result.zoneResults[0].pressurePa-6)<1e-9);
  for(const flow of result.flowResults)assert.ok(Math.abs(flow.m3s-q)<1e-9);
  assert.ok(Math.abs(result.zoneResults[0].directOutsideInflowACH-q*3600/30)<1e-9);
  assert.deepEqual(result,Airflow.run(input.scene,input.scenario));cleaned(h);
});

test('worker protocol preserves an explicitly requested finite-volume field and rejects relabelled units',async()=>{
  const input=args();input.scenario.planField={enabled:true,spacingM:.5};
  const h=harness(),promise=h.runner.run(input),w=h.workers[0];
  const reply=workerVM().send(w.request);
  assert.equal(reply.type,'result');
  w.emit('message',reply);
  const result=await promise;
  assert.ok(result.planField);assert.equal(result.planField.units,'m/s');
  assert.equal(result.planField.inputFingerprint,result.provenance.inputFingerprint);cleaned(h);
  const bad=harness(),pending=bad.runner.run(input),worker=bad.workers[0],rejected=assert.rejects(pending,/potential-flow field/);
  const malformed=workerVM().send(worker.request);malformed.result.planField.units='CFD velocity';
  worker.emit('message',malformed);await rejected;cleaned(bad);
});

test('cancel during outstanding work permits a later explicit run',async()=>{
  const h=harness(),promise=h.runner.run(args()),rejected=assert.rejects(promise,{name:'AbortError'});
  await Promise.resolve();
  h.runner.cancel();await rejected;cleaned(h);
  const retry=h.runner.run(args());h.workers.at(-1).reply();await retry;cleaned(h);
});

test('malformed serialized errors cannot masquerade as legitimate worker failures',async()=>{
  for(const error of [{name:1,message:'bad'},{name:'TypeError'},{name:'Error',message:'bad',stack:'unexpected'}]){
    const h=harness(),promise=h.runner.run(args()),w=h.workers[0],rejected=assert.rejects(promise,/malformed/);
    w.emit('message',{version:1,type:'error',token:w.request.token,error});
    await rejected;cleaned(h);
  }
});
