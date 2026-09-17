(function(root,factory){
  'use strict';
  // currentScript disappears after classic-script evaluation; capture it now.
  const scriptURL=root.document?.currentScript?.src||null;
  const api=factory(root,scriptURL);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerAirflowRunner=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,scriptURL){
  'use strict';
  const VERSION=1,TIMEOUT_MS=120000;
  let nextToken=0;
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=message=>new Error(`Airflow worker: ${message}`);
  function namedError(name,message){
    const error=name==='TypeError'?new TypeError(message):name==='RangeError'?new RangeError(message):new Error(message);
    error.name=name;
    return error;
  }
  function keys(value,allowed,required=allowed){
    if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!own(value,k)))
      throw fail('malformed protocol object.');
  }
  function canonical(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  function finiteJSON(value,result=false){
    const maxNodes=result?2000000:500000,maxCharacters=result?128000000:16000000;
    let nodes=0,characters=0;
    const seen=new Set(),stack=[{value,depth:0,exit:false}];
    while(stack.length){
      const item=stack.pop(),v=item.value;
      if(item.exit){seen.delete(v);if(result)Object.freeze(v);continue;}
      if(++nodes>maxNodes||item.depth>64)throw new RangeError('Airflow JSON traversal budget exceeded.');
      if(v===null||typeof v==='boolean')continue;
      if(typeof v==='number'&&Number.isFinite(v))continue;
      if(typeof v==='string'){
        if((characters+=v.length)>maxCharacters)throw new RangeError('Airflow JSON text budget exceeded.');
        continue;
      }
      if(typeof v!=='object'||(!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]')||
        seen.has(v)||Object.getOwnPropertySymbols(v).length)
        throw new TypeError('Airflow requires finite JSON without cycles or symbol keys.');
      const names=Object.keys(v);
      if(names.length+nodes>maxNodes||Array.isArray(v)&&(v.length!==names.length||names.some((k,i)=>k!==String(i))))
        throw new TypeError('Airflow JSON is oversized or contains a sparse/non-JSON array.');
      seen.add(v);stack.push({value:v,exit:true});
      for(const k of names){
        if((characters+=k.length)>maxCharacters)throw new RangeError('Airflow JSON text budget exceeded.');
        stack.push({value:v[k],depth:item.depth+1,exit:false});
      }
    }
    return value;
  }
  function snapshot(value){
    finiteJSON(value);
    return JSON.parse(JSON.stringify(value));
  }
  function validateResult(result,request){
    finiteJSON(result,true);
    const resultFields=['version','kind','status','balanced','provenance','scenario','inventory','zones','links',
      'solverInput','solver','components','zoneResults','flowResults','findings','warnings'];
    keys(result,[...resultFields,'planField'],resultFields);
    if(result.version!==VERSION||result.kind!=='AirflowResult'||
      !['blocked','converged','nonconverged','numerical-error'].includes(result.status)||typeof result.balanced!=='boolean')
      throw fail('malformed result header.');
    for(const key of ['zones','links','components','zoneResults','flowResults','findings','warnings']){
      if(!Array.isArray(result[key]))throw fail(`malformed result ${key}.`);
    }
    const p=result.provenance,i=result.inventory;
    keys(p,['engineId','engineVersion','solverId','solverContractVersion','projectId','revision',
      'physicalFingerprint','scenarioFingerprint','inputFingerprint','sourceInputFingerprint']);
    if(!object(i)||i.kind!=='AirflowInventory'||i.version!==VERSION||i.coordinateSpace!=='site-local'||
      !Array.isArray(i.floors)||!Array.isArray(i.rooms)||!Array.isArray(i.openings))
      throw fail('malformed inventory.');
    if(p.engineId!=='HomePlannerAirflow'||p.engineVersion!=='1'||p.solverId!=='BuildingPhysics.solveAirflow'||
      p.solverContractVersion!==1||p.projectId!==request.scene.projectId||p.revision!==request.scene.revision||
      p.projectId!==i.projectId||p.revision!==i.revision||
      typeof p.physicalFingerprint!=='string'||!p.physicalFingerprint||
      p.physicalFingerprint!==i.physicalFingerprint||
      p.sourceInputFingerprint!==(request.scene.inputFingerprint??null)||p.sourceInputFingerprint!==i.sourceInputFingerprint||
      p.scenarioFingerprint!==canonical(request.scenario)||canonical(result.scenario)!==canonical(request.scenario)||
      p.inputFingerprint!==canonical({version:VERSION,physicalFingerprint:p.physicalFingerprint,scenarioFingerprint:p.scenarioFingerprint}))
      throw fail('result provenance does not match the submitted snapshot.');
    if(own(request,'expectedPhysicalFingerprint')&&request.expectedPhysicalFingerprint!==p.physicalFingerprint&&
      !(result.status==='blocked'&&result.findings.some(f=>f?.code==='stale-physical-input')))
      throw fail('result ignored the expected physical fingerprint guard.');
    if((result.status==='blocked'&&(result.solver!==null||result.solverInput!==null))||
      (result.status==='converged'&&(!object(result.solver)||result.solver.status!=='converged'))||
      (result.solver!==null&&!object(result.solver))||(result.solverInput!==null&&!object(result.solverInput)))
      throw fail('malformed solver result.');
    for(const [field,submitted] of [['zones',request.scenario.zones],['links',request.scenario.links]]){
      if(!Array.isArray(submitted)||result[field].length!==submitted.length||
        result[field].some((entry,index)=>!object(entry)||entry.id!==submitted[index].id||
          entry.solverId!==JSON.stringify([field==='zones'?'zone':'link',submitted[index].id])))
        throw fail(`result ${field} do not match submitted identifiers.`);
    }
    if(result.findings.some(f=>!object(f)||typeof f.code!=='string'||typeof f.path!=='string'||
      typeof f.message!=='string'||!['blocking','info'].includes(f.severity))||
      result.warnings.some(w=>typeof w!=='string')||result.balanced!==(result.status==='converged'))
      throw fail('malformed result findings or balance status.');
    if(['converged','nonconverged'].includes(result.status)){
      if(!object(result.solver)||!object(result.solverInput)||result.solver.converged!==result.balanced)
        throw fail('malformed numerical outcome.');
      for(const [field,source] of [['zoneResults',result.zones],['flowResults',result.links]]){
        if(result[field].length!==source.length||result[field].some((entry,index)=>!object(entry)||
          entry.id!==source[index].id||entry.solverId!==source[index].solverId||entry.numericalStatus!==result.status))
          throw fail(`malformed numerical ${field}.`);
      }
      const field=result.planField;
      if(request.scenario.planField?.enabled===true){
        if(!object(field)||field.version!==1||field.kind!=='AirflowPlanField'||field.engineId!=='HomePlannerAirflowField'||
          field.method!=='finite-volume potential flow'||field.units!=='m/s'||field.coordinateSpace!=='site-local'||
          field.inputFingerprint!==p.inputFingerprint||!['complete','partial','unavailable'].includes(field.status)||
          !Array.isArray(field.cells)||field.cells.length>4096||!Array.isArray(field.rooms)||!Array.isArray(field.findings)||
          !Array.isArray(field.assumptions)||field.cells.some(cell=>!object(cell)||!object(cell.rect)||
            !object(cell.velocityMps)||!Number.isFinite(cell.speedMps)||cell.speedMps<0||
            !result.zones.some(zone=>zone.id===cell.zoneId&&zone.roomRef?.floorId===cell.floorId&&
              canonical(zone.roomRef)===canonical(cell.roomRef)))||
          (field.cells.length>0&&!result.balanced))
          throw fail('malformed or mismatched 2D potential-flow field.');
      }else if(field!==undefined)throw fail('unrequested 2D potential-flow field.');
    }
    return result;
  }
  function createRunner(runtime=root,options={}){
    keys(options,['workerURL'],[]);
    let pending=null,disposed=false;
    function cancel(){
      if(pending)pending.finish(namedError('AbortError','Airflow run cancelled.'));
    }
    function run(args){
      cancel();
      return new Promise((resolve,reject)=>{
        if(disposed){reject(fail('runner is disposed; create a new runner.'));return;}
        let worker=null,timer=null,settled=false;
        const token=++nextToken;
        const finish=(error,value)=>{
          if(settled)return;
          settled=true;
          if(pending?.token===token)pending=null;
          if(timer!==null)runtime.clearTimeout(timer);
          if(worker){
            worker.removeEventListener('message',onMessage);
            worker.removeEventListener('error',onError);
            worker.removeEventListener('messageerror',onMessageError);
            worker.terminate();
          }
          if(error)reject(error);else resolve(value);
        };
        let request;
        const onMessage=event=>{
          if(settled||pending?.token!==token)return;
          try{
            const data=event.data;
            if(!object(data)||data.version!==VERSION||data.token!==token)throw fail('malformed or foreign response token/version.');
            if(data.type==='error'){
              keys(data,['version','token','type','error']);keys(data.error,['name','message']);
              if(typeof data.error.name!=='string'||!data.error.name||data.error.name.length>128||
                typeof data.error.message!=='string'||data.error.message.length>16384)throw fail('malformed error response.');
              finish(namedError(data.error.name,data.error.message));
            }else{
              keys(data,['version','token','type','result']);
              if(data.type!=='result')throw fail('unsupported response type.');
              finish(null,validateResult(data.result,request));
            }
          }catch(error){finish(error);}
        };
        const onError=event=>{
          if(settled)return;
          event.preventDefault?.();
          finish(fail(`could not load or execute local worker assets. Serve the app over HTTP(S), check worker-src CSP and planner-airflow-worker.js, building-physics.js, planner-airflow.js. ${event.message||''}`));
        };
        const onMessageError=()=>finish(fail('response could not be deserialized; no result was published.'));
        pending={token,finish};
        try{
          keys(args,['scene','scenario','expectedPhysicalFingerprint'],['scene','scenario']);
          if(!object(args.scene)||!object(args.scenario))throw new TypeError('Airflow scene and scenario must be objects.');
          request={version:VERSION,type:'run',token,scene:snapshot(args.scene),scenario:snapshot(args.scenario)};
          if(own(args,'expectedPhysicalFingerprint')){
            if(typeof args.expectedPhysicalFingerprint!=='string'||!args.expectedPhysicalFingerprint.trim())
              throw new TypeError('expectedPhysicalFingerprint must be nonempty text.');
            request.expectedPhysicalFingerprint=args.expectedPhysicalFingerprint;
          }
          const pageURL=runtime.location?.href||runtime.document?.baseURI;
          if(!pageURL||!/^https?:$/.test(new URL(pageURL).protocol))
            throw fail('serve this app from a local HTTP(S) server, not a file: URL. No main-thread solver fallback is available.');
          if(typeof runtime.Worker!=='function')
            throw fail('Web Workers are unavailable. Use a browser with dedicated Worker support; no main-thread solver fallback is available.');
          const base=scriptURL||runtime.document?.baseURI||pageURL;
          const url=new URL(options.workerURL??'planner-airflow-worker.js',base);
          if(!/^https?:$/.test(url.protocol)||url.origin!==new URL(pageURL).origin||url.username||url.password)
            throw fail('workerURL must be a local same-origin HTTP(S) asset; remote, blob and data URLs are not allowed.');
          worker=new runtime.Worker(url.href,{type:'classic',name:'homeplanner-airflow'});
          worker.addEventListener('message',onMessage);
          worker.addEventListener('error',onError);
          worker.addEventListener('messageerror',onMessageError);
          timer=runtime.setTimeout(()=>finish(namedError('TimeoutError','Airflow worker exceeded the 120-second execution limit; simplify the scenario and retry.')),TIMEOUT_MS);
          worker.postMessage(request);
        }catch(error){finish(error);}
      });
    }
    return Object.freeze({run,cancel,dispose(){disposed=true;cancel();}});
  }
  return Object.freeze({createRunner});
});
