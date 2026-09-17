(function(scope){
  'use strict';
  const VERSION=1;
  let consumed=false;
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
  function validate(request){
    const allowed=['version','type','token','scene','scenario','expectedPhysicalFingerprint'];
    if(!request||typeof request!=='object'||Array.isArray(request)||
      Object.keys(request).some(k=>!allowed.includes(k))||
      ['version','type','token','scene','scenario'].some(k=>!own(request,k)))
      throw new TypeError('Malformed airflow worker request.');
    if(request.version!==VERSION||request.type!=='run'||!Number.isSafeInteger(request.token)||request.token<=0)
      throw new RangeError('Unsupported airflow worker protocol version/type/token.');
    for(const k of ['scene','scenario']){
      if(!request[k]||typeof request[k]!=='object'||Array.isArray(request[k]))
        throw new TypeError(`Airflow ${k} must be an object.`);
    }
    if(own(request,'expectedPhysicalFingerprint')&&
      (typeof request.expectedPhysicalFingerprint!=='string'||!request.expectedPhysicalFingerprint.trim()||
        request.expectedPhysicalFingerprint.length>16000000))
      throw new TypeError('expectedPhysicalFingerprint must be a nonempty canonical key within the 16000000-character JSON budget.');
  }
  scope.addEventListener('message',event=>{
    const request=event.data;
    const token=Number.isSafeInteger(request?.token)&&request.token>0?request.token:null;
    try{
      if(consumed)throw new Error('Airflow worker accepts exactly one run; create a new worker.');
      consumed=true;
      validate(request);
      try{
        scope.importScripts('planner-regions.js','building-physics.js','planner-airflow-field.js','planner-airflow.js');
      }catch(error){
        error.message=`Cannot load local airflow dependencies. Serve planner-regions.js, building-physics.js, planner-airflow-field.js and planner-airflow.js beside planner-airflow-worker.js and check CSP. ${error.message}`;
        throw error;
      }
      const options={};
      if(own(request,'expectedPhysicalFingerprint'))options.expectedPhysicalFingerprint=request.expectedPhysicalFingerprint;
      const result=scope.HomePlannerAirflow.run(request.scene,request.scenario,options);
      scope.postMessage({version:VERSION,type:'result',token,result});
    }catch(error){
      scope.postMessage({version:VERSION,type:'error',token,error:{
        name:typeof error?.name==='string'?error.name.slice(0,128):'Error',
        message:typeof error?.message==='string'?error.message.slice(0,16384):'Airflow worker failed.'
      }});
    }
  });
})(self);
