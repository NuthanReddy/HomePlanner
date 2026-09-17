(function(root,factory){
  'use strict';
  const scriptURL=root.document?.currentScript?.src||null;
  const common=typeof module==='object'&&module.exports;
  const api=factory(root,scriptURL,common?require('./planner-light.js'):null);
  if(common)module.exports=api;else root.HomePlannerLightRunner=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,scriptURL,commonLight){
  'use strict';
  const VERSION=1,TIMEOUT_MS=120000,JSON_CHARACTERS=16000000;
  const PROGRESS=['processedRays','totalRays','completedIntervals','totalIntervals','completedSkySensors','totalSensors',
    'computationalComplete','cancelled','finalized','blocked'];
  let nextToken=0;
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const fail=message=>new Error('Light worker: '+message);
  function namedError(name,message){
    const error=name==='TypeError'?new TypeError(message):name==='RangeError'?new RangeError(message):new Error(message);
    error.name=name;return error;
  }
  function keys(v,allowed,required=allowed){
    if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!own(v,k)))
      throw new TypeError('Malformed light protocol object.');
  }
  function canonical(v){
    if(v===null||typeof v!=='object')return JSON.stringify(v);
    return Array.isArray(v)?'['+v.map(canonical).join(',')+']':
      '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  }
  function finiteJSON(value){
    let nodes=0,characters=0;const active=new Set();
    function visit(v,depth){
      if(++nodes>500000||depth>64)throw new RangeError('Light JSON traversal budget exceeded.');
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='number'){if(!Number.isFinite(v))throw new TypeError('Light JSON numbers must be finite.');return;}
      if(typeof v==='string'){
        characters+=v.length;if(characters>JSON_CHARACTERS)throw new RangeError('Light JSON character budget exceeded.');
        return;
      }
      if(typeof v!=='object'||active.has(v)||Object.getOwnPropertySymbols(v).length||
        (!Array.isArray(v)&&(Object.prototype.toString.call(v)!=='[object Object]'||
          Object.getPrototypeOf(v)!==null&&Object.getPrototypeOf(Object.getPrototypeOf(v))!==null)))
        throw new TypeError('Light requires finite plain JSON without cycles.');
      const names=Object.keys(v);
      if(Object.getOwnPropertyNames(v).length!==names.length+(Array.isArray(v)?1:0))
        throw new TypeError('Light JSON cannot contain hidden properties.');
      if(names.length>500000-nodes)throw new RangeError('Light JSON traversal budget exceeded.');
      if(Array.isArray(v)&&(names.length!==v.length||names.some((k,i)=>k!==String(i))))
        throw new TypeError('Light requires dense JSON arrays without extra properties.');
      active.add(v);
      for(const k of names){
        if(!Array.isArray(v))visit(k,depth+1);
        const descriptor=Object.getOwnPropertyDescriptor(v,k);
        if(!own(descriptor,'value'))throw new TypeError('Light JSON cannot contain accessors.');
        visit(descriptor.value,depth+1);
      }
      active.delete(v);
    }
    visit(value,0);
  }
  function snapshot(value){finiteJSON(value);return JSON.parse(JSON.stringify(value));}
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  function progress(v,previous=null,terminal=false){
    keys(v,PROGRESS);
    for(const k of PROGRESS.slice(0,6))if(!Number.isSafeInteger(v[k])||v[k]<0)throw fail('invalid progress counter.');
    for(const k of PROGRESS.slice(6))if(typeof v[k]!=='boolean')throw fail('invalid progress flag.');
    if(v.totalRays>4000000||v.totalIntervals>2048||v.totalSensors>4096||
      v.processedRays>v.totalRays||v.completedIntervals>v.totalIntervals||v.completedSkySensors>v.totalSensors||
      v.cancelled||v.finalized!==terminal||v.blocked&&v.computationalComplete||
      v.computationalComplete&&(v.processedRays!==v.totalRays||v.completedIntervals!==v.totalIntervals))
      throw fail('inconsistent progress.');
    if(previous){
      for(const k of ['totalRays','totalIntervals','totalSensors','blocked'])
        if(v[k]!==previous[k])throw fail('progress changed study totals.');
      for(const k of ['processedRays','completedIntervals','completedSkySensors'])
        if(v[k]<previous[k])throw fail('progress moved backwards.');
      if(v.processedRays-previous.processedRays>4096||previous.computationalComplete&&!v.computationalComplete)
        throw fail('progress exceeded a batch or reversed completion.');
    }
    return freeze(v);
  }
  function validateResult(value,request,inventory,previous){
    const r=snapshot(value);
    const directEnabled=request.config.direct?.enabled!==false;
    keys(r,['version','kind','status','complete','computationalComplete','config','inventory','provenance','findings',
      'progress','sensors','context','sampling','sky','direct','limitations']);
    if(r.version!==1||r.kind!=='RoomLightStudy'||!['blocked','complete','incomplete'].includes(r.status)||
      typeof r.complete!=='boolean'||typeof r.computationalComplete!=='boolean')
      throw fail('invalid terminal study header.');
    for(const k of ['findings','sensors','limitations'])if(!Array.isArray(r[k]))throw fail('invalid study '+k+'.');
    for(const k of ['context','sampling','sky','direct'])if(!object(r[k]))throw fail('invalid study '+k+'.');
    const p=r.provenance;
    keys(p,['engineId','engineVersion','projectId','revision','sourceFingerprint','physicalFingerprint',
      'scenePhysicalFingerprint','sensorFingerprint','inputFingerprint']);
    const physical=canonical({scene:inventory.physicalFingerprint,neighborBoxes:request.config.neighborBoxes||[]});
    if(p.engineId!=='HomePlannerLight'||p.engineVersion!==1||p.projectId!==request.scene.projectId||
      p.revision!==request.scene.revision||p.sourceFingerprint!==(request.scene.inputFingerprint??null)||
      canonical(r.config)!==canonical(request.config)||canonical(r.inventory)!==canonical(inventory)||
      p.scenePhysicalFingerprint!==inventory.physicalFingerprint||p.physicalFingerprint!==physical||
      p.sensorFingerprint!==canonical(r.sensors)||
      p.inputFingerprint!==canonical({physicalFingerprint:physical,sensorFingerprint:p.sensorFingerprint,config:request.config}))
      throw fail('result provenance does not match the submitted snapshot.');
    progress(r.progress,previous,true);
    if(r.progress.totalSensors!==r.sensors.length||r.computationalComplete!==r.progress.computationalComplete||
      r.complete!==(r.status==='complete')||r.progress.blocked!==(r.status==='blocked')||
      r.status!=='blocked'&&!r.computationalComplete||
      r.findings.some(f=>!object(f)||typeof f.code!=='string'||typeof f.message!=='string'||
        !['blocking','warning'].includes(f.severity))||
      r.progress.blocked!==r.findings.some(f=>f.severity==='blocking')||
      r.complete!==(r.computationalComplete&&r.context.status==='known-supplied-model'&&
        (directEnabled?r.direct.complete===true:r.sky.status==='complete'))||
      r.limitations.some(v=>typeof v!=='string'))
      throw fail('inconsistent terminal study status.');
    const stale=own(request,'expectedPhysicalFingerprint')&&request.expectedPhysicalFingerprint!==inventory.physicalFingerprint;
    if(stale!==r.findings.some(f=>f.code==='stale-physical-input')||stale&&r.status!=='blocked')
      throw fail('result ignored the scene physical fingerprint guard.');
    if(r.sampling.totalRays!==r.progress.totalRays||r.sampling.outputNodeUpperBound>500000||
      r.sampling.outputCharacterUpperBound>JSON_CHARACTERS||
      !Array.isArray(r.sky.sensorResults)||!Array.isArray(r.direct.sensorResults)||!Array.isArray(r.direct.masks)||
      r.sky.sensorResults.length!==r.sensors.length||r.direct.sensorResults.length!==r.sensors.length||
      r.direct.masks.length!==r.progress.completedIntervals)
      throw fail('invalid numerical result dimensions.');
    const fraction=v=>v===null||typeof v==='number'&&v>=0&&v<=1;
    const hours=v=>v===null||typeof v==='number'&&v>=0;
    const coverageFields=['periodHours','processedIntervalHours','knownIntervalHours','unknownOrUnprocessedHours','nearHorizonUnresolvedHours'];
    const sensorHourFields=['positivePathPresenceHours','transmittedEquivalentSunHours','knownProcessedPositivePathPresenceHours',
      'knownProcessedTransmittedEquivalentSunHours','modeledProcessedPositivePathPresenceHours','modeledProcessedTransmittedEquivalentSunHours'];
    if(typeof r.direct.complete!=='boolean'||r.direct.complete!==(r.direct.status==='complete')||
      (directEnabled?!['blocked','complete','incomplete'].includes(r.direct.status):
        r.direct.status!==(r.status==='blocked'?'blocked':'disabled')||r.direct.complete||
        r.sampling.directRays!==0||r.progress.totalIntervals!==0||r.direct.masks.length!==0||
        coverageFields.some(k=>r.direct[k]!==null))||
      r.sky.metric!=='normalized-cosine-weighted-sky-access'||r.sky.units!=='dimensionless-0-to-1'||
      r.direct.units!=='hours'||!['known-supplied-model','unknown-context'].includes(r.context.status)||
      canonical(r.context.neighbors)!==canonical(request.config.neighbors??null)||
      canonical(r.context.windowOptics)!==canonical(request.config.windowOptics??null)||
      canonical(r.context.roofContext)!==canonical(request.config.roofContext??[])||
      coverageFields.some(k=>!hours(r.direct[k]))||
      r.direct.complete&&(r.status==='blocked'||r.direct.periodHours===null||
        Math.abs(r.direct.knownIntervalHours-r.direct.periodHours)>=1e-10))
      throw fail('invalid metric or coverage status.');
    const seenSensors=new Set();
    for(let i=0;i<r.sensors.length;i++){
      const s=r.sensors[i],w=request.config.workplanes?.find(w=>w.id===s.workplaneId);
      if(!w||canonical(w.room)!==canonical(s.room)||r.sky.sensorResults[i].sensorId!==s.id||
        r.direct.sensorResults[i].sensorId!==s.id)throw fail('invalid result sensor reference.');
      const room=inventory.rooms.find(room=>canonical(room.ref)===canonical(w.room));
      const floor=request.scene.scenes.find(f=>f.floorId===w.room.floorId),rect=room?.geometry?.rect,g=s.grid;
      if(!rect||!object(g)||!object(s.point)||!object(s.world)||
        !Number.isSafeInteger(g.column)||!Number.isSafeInteger(g.row)||
        g.columns!==Math.ceil(rect.w/w.spacingM)||g.rows!==Math.ceil(rect.h/w.spacingM)||
        g.column<0||g.column>=g.columns||g.row<0||g.row>=g.rows||
        seenSensors.has(s.id)||s.point.z!==floor.floorElevationM+w.heightM)
        throw fail('sensor geometry does not match the submitted workplane.');
      if(s.cell){
        const base={x:rect.x+rect.w*g.column/g.columns,y:rect.y+rect.h*g.row/g.rows,w:rect.w/g.columns,h:rect.h/g.rows};
        const span=(a,b)=>b-a>4*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
        const pieces=(room.geometry.usableRegions||[rect]).map(region=>{
          const x=Math.max(base.x,region.x),y=Math.max(base.y,region.y);
          const right=Math.min(base.x+base.w,region.x+region.w),bottom=Math.min(base.y+base.h,region.y+region.h);
          return span(x,right)&&span(y,bottom)?{x,y,w:right-x,h:bottom-y}:null;
        }).filter(Boolean);
        const fragment=pieces.findIndex(piece=>canonical(piece)===canonical(s.cell));
        if(fragment<0||s.id!==JSON.stringify(fragment?[w.id,g.column,g.row,fragment]:[w.id,g.column,g.row])||
          s.point.x!==s.cell.x+s.cell.w/2||s.point.y!==s.cell.y+s.cell.h/2||
          s.areaWeightM2!==s.cell.w*s.cell.h)
          throw fail('clipped sensor cell does not match its supplied usable region and grid.');
      }else if(s.id!==JSON.stringify([w.id,g.column,g.row])||
        s.point.x!==rect.x+rect.w*(g.column+.5)/g.columns||
        s.point.y!==rect.y+rect.h*(g.row+.5)/g.rows||s.areaWeightM2!==rect.w*rect.h/(g.columns*g.rows))
        throw fail('sensor geometry does not match the submitted workplane.');
      seenSensors.add(s.id);
      const sky=r.sky.sensorResults[i],direct=r.direct.sensorResults[i];
      if(!fraction(sky.cosineWeightedSkyAccess)||!fraction(sky.modeledCosineWeightedSkyAccess)||
        sensorHourFields.some(k=>directEnabled?!hours(direct[k]):direct[k]!==null)||
        !r.direct.complete&&(direct.positivePathPresenceHours!==null||direct.transmittedEquivalentSunHours!==null))
        throw fail('invalid sensor metrics.');
    }
    if(r.status!=='blocked')for(const plane of request.config.workplanes||[]){
      const room=inventory.rooms.find(room=>canonical(room.ref)===canonical(plane.room));
      const expected=(room?.geometry?.usableRegions||[room?.geometry?.rect]).reduce((sum,rect)=>sum+rect.w*rect.h,0);
      const actual=r.sensors.filter(sensor=>sensor.workplaneId===plane.id).reduce((sum,sensor)=>sum+sensor.areaWeightM2,0);
      if(Math.abs(expected-actual)>1e-8*Math.max(1,expected))
        throw fail('workplane cells do not cover the supplied usable area.');
    }
    for(const mask of r.direct.masks){
      for(const k of ['directPathWeights','modeledDirectPathWeights','positivePathPresence'])
        if(!Array.isArray(mask[k])||mask[k].length!==r.sensors.length||
          mask[k].some(v=>k==='positivePathPresence'?v!==null&&typeof v!=='boolean':!fraction(v)))
          throw fail('invalid direct mask.');
    }
    return freeze(r);
  }
  function createRunner(runtime=root){
    let pending=null,disposed=false;
    function cancel(){pending?.finish(namedError('AbortError','Light run cancelled.'));}
    function run(args,onProgress){
      cancel();
      return new Promise((resolve,reject)=>{
        if(disposed){reject(fail('runner is disposed.'));return;}
        let worker=null,timer=null,settled=false,request,inventory,previous=null;
        const token=++nextToken;
        const finish=(error,result)=>{
          if(settled)return;settled=true;
          if(pending?.token===token)pending=null;
          if(timer!==null)runtime.clearTimeout(timer);
          if(worker){
            worker.removeEventListener('message',onMessage);
            worker.removeEventListener('error',onError);
            worker.removeEventListener('messageerror',onMessageError);
            worker.terminate();
          }
          if(error)reject(error);else resolve(result);
        };
        const onMessage=event=>{
          if(settled||pending?.token!==token)return;
          try{
            const data=event.data;
            if(object(data)&&Number.isSafeInteger(data.token)&&data.token>0&&data.token!==token)return;
            if(!object(data)||data.version!==VERSION||data.token!==token)throw fail('invalid response version/token.');
            if(data.type==='progress'){
              keys(data,['version','type','token','progress']);
              const current=progress(snapshot(data.progress),previous);
              if(!previous&&current.processedRays!==0)throw fail('missing initial progress.');
              previous=current;
              if(onProgress)onProgress(current);
            }else if(data.type==='result'){
              keys(data,['version','type','token','result']);
              if(!previous)throw fail('missing study progress.');
              finish(null,validateResult(data.result,request,inventory,previous));
            }else if(data.type==='error'){
              keys(data,['version','type','token','error']);keys(data.error,['name','message']);
              if(typeof data.error.name!=='string'||!data.error.name||data.error.name.length>128||
                typeof data.error.message!=='string'||data.error.message.length>16384)throw fail('malformed worker error.');
              finish(namedError(data.error.name,data.error.message));
            }else throw fail('unsupported response type.');
          }catch(error){finish(error);}
        };
        const onError=event=>{
          event.preventDefault?.();
          finish(fail('cannot load or execute local worker assets; serve HTTP(S) and check worker-src/script-src CSP. '+(event.message||'')));
        };
        const onMessageError=()=>finish(fail('response could not be deserialized.'));
        pending={token,finish};
        try{
          keys(args,['scene','config','expectedPhysicalFingerprint'],['scene','config']);
          if(onProgress!==undefined&&typeof onProgress!=='function')throw new TypeError('onProgress must be a function.');
          if(!object(args.scene)||!object(args.config))throw new TypeError('Light scene and config must be objects.');
          request={version:VERSION,type:'run',token,scene:snapshot(args.scene),config:snapshot(args.config)};
          if(own(args,'expectedPhysicalFingerprint')){
            const guard=args.expectedPhysicalFingerprint;
            if(typeof guard!=='string'||!guard.trim())throw new TypeError('expectedPhysicalFingerprint must be nonempty text.');
            if(guard.length>JSON_CHARACTERS)throw new RangeError('Physical fingerprint exceeds the JSON budget.');
            request.expectedPhysicalFingerprint=guard;
          }
          const Light=commonLight||runtime.HomePlannerLight||root.HomePlannerLight;
          if(!Light)throw fail('load planner-light.js before running a study.');
          Light.normalizeConfig(request.config);
          inventory=Light.discover(request.scene);
          const pageURL=runtime.location?.href||runtime.document?.baseURI;
          if(!pageURL||!/^https?:$/.test(new URL(pageURL).protocol))throw fail('serve HTTP(S), not file:; no main-thread ray fallback.');
          if(typeof runtime.Worker!=='function')throw fail('Web Workers unavailable; no main-thread ray fallback.');
          const url=new URL('planner-light-worker.js',scriptURL||runtime.document?.baseURI||pageURL);
          if(url.origin!==new URL(pageURL).origin||!/^https?:$/.test(url.protocol)||url.username||url.password)
            throw fail('worker must be a fixed local same-origin HTTP(S) asset.');
          worker=new runtime.Worker(url.href,{type:'classic',name:'homeplanner-light'});
          worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);
          worker.addEventListener('messageerror',onMessageError);
          timer=runtime.setTimeout(()=>finish(namedError('TimeoutError','Light worker exceeded the 120-second execution limit.')),TIMEOUT_MS);
          worker.postMessage(request);
        }catch(error){finish(error);}
      });
    }
    return Object.freeze({run,cancel,dispose(){disposed=true;cancel();}});
  }
  return Object.freeze({createRunner});
});
