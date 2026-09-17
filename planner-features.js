(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerFeatures=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const collections=['annotations','dimensions','fixtures','stairs','structural','serviceNodes','serviceRoutes'];
  const systems=['water','waste','rain'];
  const kinds=['room','wall','opening','furniture','obstacle','fixture','stair','structural','serviceNode'];
  const fail=path=>{throw new Error(`Invalid ${path}.`);};
  const text=(value,path)=>{if(typeof value!=='string'||!value.trim()||value.length>16384||/[\u0000-\u001f]/.test(value))fail(path);};
  const id=(value,path)=>{text(value,path);if(['__proto__','constructor','prototype'].includes(value))fail(path);};
  const num=(value,path,min=-Infinity,positive=false)=>{
    if(!Number.isFinite(value)||Math.abs(value)>1e9||value<min||(positive&&value===min))fail(path);
  };
  const nullable=(value,path,min=-Infinity,positive=false)=>{if(value!==null)num(value,path,min,positive);};
  const choice=(value,values,path)=>{if(!values.includes(value))fail(path);};
  function shape(value,keys,path,optional=[]){
    if(!value||typeof value!=='object'||Array.isArray(value))fail(path);
    if(Object.keys(value).some(key=>!keys.includes(key)&&!optional.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))fail(`${path} fields`);
  }
  function list(value,path,check){
    if(!Array.isArray(value)||value.length>10000)fail(path);
    value.forEach((item,index)=>check(item,`${path}[${index}]`));
  }
  function point(value,path){
    shape(value,['x','y','z'],path);
    for(const key of ['x','y','z'])num(value[key],`${path}.${key}`);
  }
  function reference(value,path){
    shape(value,['floorId','entityId'],path);
    id(value.floorId,`${path}.floorId`);id(value.entityId,`${path}.entityId`);
  }
  function anchor(value,path){
    if(value===null)return;
    if(!value||typeof value!=='object')fail(path);
    if(value.kind==='point'){
      shape(value,['kind','floorId','point'],path);point(value.point,`${path}.point`);
    }else if(value.kind==='wall'){
      shape(value,['kind','floorId','entityId','offsetM','heightM'],path);
      id(value.entityId,`${path}.entityId`);
      num(value.offsetM,`${path}.offsetM`,0);num(value.heightM,`${path}.heightM`,0);
    }else if(value.kind==='entity'){
      shape(value,['kind','floorId','entityKind','entityId'],path);
      choice(value.entityKind,kinds.filter(kind=>kind!=='wall'),`${path}.entityKind`);
      id(value.entityId,`${path}.entityId`);
    }else fail(`${path}.kind`);
    id(value.floorId,`${path}.floorId`);
  }
  const fields={
    annotations:['id','text','anchor'],
    dimensions:['id','start','end','offsetM'],
    fixtures:['id','kind','anchor','widthM','depthM','heightM'],
    stairs:['id','start','end','widthM','riserCount'],
    structural:['id','kind','anchors','widthM','depthM','material'],
    serviceNodes:['id','system','kind','anchor','diameterMm','invertM'],
    serviceRoutes:['id','system','from','to','via','diameterMm','slope']
  };
  function record(value,collection,path){
    shape(value,fields[collection],path,collection==='structural'?['heightM','label','sizeSource','reference']:
      collection==='serviceNodes'?['label','circuit','role','groundM','finishedFloorM','levelSource','levelReference','accessRadiusM','discharge']:
      collection==='serviceRoutes'?['label','circuit','viaInvertsM','slopeSource','slopeReference','clearanceM']:[]);
    id(value.id,`${path}.id`);
    if(fields[collection].includes('anchor'))anchor(value.anchor,`${path}.anchor`);
    if(collection==='annotations')text(value.text,`${path}.text`);
    if(collection==='dimensions'||collection==='stairs'){
      anchor(value.start,`${path}.start`);anchor(value.end,`${path}.end`);
    }
    if(collection==='dimensions')num(value.offsetM,`${path}.offsetM`);
    if(collection==='fixtures')choice(value.kind,['basin','sink','toilet','shower','equipment'],`${path}.kind`);
    if(collection==='stairs'&&value.riserCount!==null){
      num(value.riserCount,`${path}.riserCount`,1);
      if(!Number.isSafeInteger(value.riserCount))fail(`${path}.riserCount`);
    }
    if(collection==='structural'){
      choice(value.kind,['column','beam','slab','footing','grid'],`${path}.kind`);
      list(value.anchors,`${path}.anchors`,anchor);
      if(value.anchors.length!==(['beam','grid'].includes(value.kind)?2:1))fail(`${path}.anchors`);
      if(value.material!==null)text(value.material,`${path}.material`);
      if(Object.hasOwn(value,'heightM'))nullable(value.heightM,`${path}.heightM`,0,true);
      for(const key of ['label','reference'])
        if(Object.hasOwn(value,key)&&value[key]!==null)text(value[key],`${path}.${key}`);
      if(Object.hasOwn(value,'sizeSource'))
        choice(value.sizeSource,['unspecified','assumed','authored','engineer-provided'],`${path}.sizeSource`);
      if(['beam','grid'].includes(value.kind)&&Object.hasOwn(value,'heightM')&&value.heightM!==null)fail(`${path}.heightM`);
      if(value.kind==='grid'&&[value.widthM,value.depthM,value.material].some(item=>item!==null))fail(`${path} grid dimensions/material`);
    }
    if(collection==='serviceNodes'||collection==='serviceRoutes'){
      choice(value.system,systems,`${path}.system`);
      nullable(value.diameterMm,`${path}.diameterMm`,0,true);
      if(Object.hasOwn(value,'label')&&value.label!==null)text(value.label,`${path}.label`);
      if(Object.hasOwn(value,'circuit'))
        choice(value.circuit,[null,...{water:['cold','hot'],waste:['soil','waste','vent'],rain:['storm']}[value.system]],`${path}.circuit`);
    }
    if(collection==='serviceNodes'){
      choice(value.kind,['fixture','junction','outlet','supply'],`${path}.kind`);
      nullable(value.invertM,`${path}.invertM`);
      for(const key of ['groundM','finishedFloorM'])
        if(Object.hasOwn(value,key))nullable(value[key],`${path}.${key}`);
      if(Object.hasOwn(value,'accessRadiusM'))nullable(value.accessRadiusM,`${path}.accessRadiusM`,0);
      provenance(value,'level',path);
      if(Object.hasOwn(value,'discharge')){
        if(value.kind!=='outlet')fail(`${path}.discharge outlet only`);
        if(value.discharge!==null){
          shape(value.discharge,['kind','reference'],`${path}.discharge`);
          choice(value.discharge.kind,['sewer','surface-outfall','soakaway','septic','reuse','other'],`${path}.discharge.kind`);
          if(value.discharge.reference!==null)text(value.discharge.reference,`${path}.discharge.reference`);
        }
      }
      if(Object.hasOwn(value,'role')){
        const roles={fixture:['port','fixture','trap','floor-trap','gully-trap','roof-outlet'],
          junction:['junction','stack','valve','trap','cleanout','chamber','downpipe'],
          supply:['supply'],outlet:['outlet','outfall']};
        choice(value.role,[null,...roles[value.kind]],`${path}.role`);
      }
    }
    if(collection==='serviceRoutes'){
      reference(value.from,`${path}.from`);reference(value.to,`${path}.to`);
      list(value.via,`${path}.via`,anchor);nullable(value.slope,`${path}.slope`,0);
      if(Object.hasOwn(value,'viaInvertsM')){
        list(value.viaInvertsM,`${path}.viaInvertsM`,nullable);
        if(value.viaInvertsM.length!==value.via.length)fail(`${path}.viaInvertsM length`);
        for(let i=0;i<value.viaInvertsM.length;i++)
          if(!Object.hasOwn(value.viaInvertsM,i))fail(`${path}.viaInvertsM[${i}]`);
      }
      provenance(value,'slope',path);
      if(Object.hasOwn(value,'clearanceM'))nullable(value.clearanceM,`${path}.clearanceM`,0);
    }
    function provenance(value,prefix,path){
      const source=`${prefix}Source`,reference=`${prefix}Reference`;
      if(Object.hasOwn(value,source))
        choice(value[source],[null,'assumed','surveyed','engineer-provided'],`${path}.${source}`);
      if(Object.hasOwn(value,reference)&&value[reference]!==null)text(value[reference],`${path}.${reference}`);
    }
    for(const key of ['widthM','depthM','heightM'])
      if(fields[collection].includes(key))nullable(value[key],`${path}.${key}`,0,true);
  }
  function emptyAuthored(){
    return {version:1,...Object.fromEntries(collections.map(key=>[key,[]]))};
  }
  function validate(project){
    if(Object.hasOwn(project,'siteDatum')){
      shape(project.siteDatum,['version','elevationM'],'siteDatum');
      if(project.siteDatum.version!==1)fail('siteDatum.version');
      nullable(project.siteDatum.elevationM,'siteDatum.elevationM');
    }
    for(const floor of project.floors){
      if(!Object.hasOwn(floor,'authored'))continue;
      const value=floor.authored,path=`Floor ${floor.id}.authored`,ids=new Set();
      shape(value,['version',...collections],path);
      if(value.version!==1)fail(`${path}.version`);
      for(const key of collections)list(value[key],`${path}.${key}`,(item,here)=>{
        record(item,key,here);
        if(!item.id.startsWith(`${floor.id}:authored:`)||item.id.length<=floor.id.length+10||ids.has(item.id))fail(`${here}.id scope or uniqueness`);
        ids.add(item.id);
      });
    }
    if(Object.hasOwn(project,'documentation')){
      const value=project.documentation;
      shape(value,['version','views','sheets'],'documentation',['package']);
      if(value.version!==1)fail('documentation.version');
      if(Object.hasOwn(value,'package')){
        const p=value.package,path='documentation.package';
        shape(p,['version','title','paper','orientation','scaleDenominator','units','pngDpi'],path);
        if(p.version!==1)fail(`${path}.version`);
        if(typeof p.title!=='string'||p.title.length>200||
          /[\u0000-\u001f\u007f-\u009f\ufffe\uffff]/u.test(p.title)||
          /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(p.title))fail(`${path}.title`);
        choice(p.paper,['A4','A3','A2'],`${path}.paper`);
        choice(p.orientation,['portrait','landscape'],`${path}.orientation`);
        choice(p.scaleDenominator,[50,75,100],`${path}.scaleDenominator`);
        choice(p.units,['metric','imperial'],`${path}.units`);
        choice(p.pngDpi,[72,150],`${path}.pngDpi`);
      }
      const ids=new Set();
      function unique(item,path){
        id(item.id,`${path}.id`);if(ids.has(item.id))fail(`${path}.id uniqueness`);ids.add(item.id);
      }
      list(value.views,'documentation.views',(view,path)=>{
        shape(view,['id','name','kind','floorId','scaleDenominator','direction','cut'],path);
        unique(view,path);text(view.name,`${path}.name`);id(view.floorId,`${path}.floorId`);
        choice(view.kind,['plan','section','elevation'],`${path}.kind`);
        nullable(view.scaleDenominator,`${path}.scaleDenominator`,0,true);
        choice(view.direction,[null,'N','E','S','W'],`${path}.direction`);
        list(view.cut,`${path}.cut`,anchor);
        if(view.cut.length!==(view.kind==='section'?2:0))fail(`${path}.cut`);
      });
      list(value.sheets,'documentation.sheets',(sheet,path)=>{
        shape(sheet,['id','number','title','paper','orientation','viewIds'],path);
        unique(sheet,path);text(sheet.number,`${path}.number`);text(sheet.title,`${path}.title`);
        choice(sheet.paper,['A4','A3','A2','A1','A0'],`${path}.paper`);
        choice(sheet.orientation,['portrait','landscape'],`${path}.orientation`);
        list(sheet.viewIds,`${path}.viewIds`,id);
        if(new Set(sheet.viewIds).size!==sheet.viewIds.length)fail(`${path}.viewIds uniqueness`);
      });
    }
  }
  return Object.freeze({collections:Object.freeze(collections),emptyAuthored,validate});
});
