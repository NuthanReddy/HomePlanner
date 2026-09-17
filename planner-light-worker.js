(function(scope){
  'use strict';
  const VERSION=1,BATCH=4096;
  let consumed=false;
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
  function validate(r){
    const allowed=['version','type','token','scene','config','expectedPhysicalFingerprint'];
    if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!allowed.includes(k))||
      ['version','type','token','scene','config'].some(k=>!own(r,k)))
      throw new TypeError('Malformed light worker request.');
    if(r.version!==VERSION||r.type!=='run'||!Number.isSafeInteger(r.token)||r.token<=0)
      throw new RangeError('Unsupported light protocol version/type/token.');
    for(const k of ['scene','config'])if(!r[k]||typeof r[k]!=='object'||Array.isArray(r[k]))
      throw new TypeError('Light '+k+' must be an object.');
    if(own(r,'expectedPhysicalFingerprint')){
      if(typeof r.expectedPhysicalFingerprint!=='string'||!r.expectedPhysicalFingerprint.trim())
        throw new TypeError('expectedPhysicalFingerprint must be nonempty text.');
      if(r.expectedPhysicalFingerprint.length>16000000)throw new RangeError('Physical fingerprint exceeds the JSON budget.');
    }
  }
  scope.addEventListener('message',event=>{
    if(consumed)return;
    consumed=true;
    const request=event.data,token=Number.isSafeInteger(request?.token)&&request.token>0?request.token:null;
    let terminal=false;
    function error(error){
      if(terminal)return;terminal=true;
      scope.postMessage({version:VERSION,type:'error',token,error:{
        name:typeof error?.name==='string'?error.name.slice(0,128):'Error',
        message:typeof error?.message==='string'?error.message.slice(0,16384):'Light worker failed.'
      }});
    }
    try{
      validate(request);
      scope.importScripts('planner-regions.js','planner-features.js','planner-model.js','planner-projection.js','building-physics.js','planner-light.js');
      const options={};
      if(own(request,'expectedPhysicalFingerprint'))options.expectedPhysicalFingerprint=request.expectedPhysicalFingerprint;
      const study=scope.HomePlannerLight.createStudy(request.scene,request.config,options);
      function publish(p){
        scope.postMessage({version:VERSION,type:'progress',token,progress:p});
        if(p.blocked||p.computationalComplete){
          const result=study.finalize();
          scope.postMessage({version:VERSION,type:'result',token,result});
          terminal=true;
        }else scope.setTimeout(batch,0);
      }
      function batch(){
        if(terminal)return;
        try{publish(study.step(BATCH));}catch(e){error(e);}
      }
      publish(study.progress());
    }catch(e){error(e);}
  });
})(self);
