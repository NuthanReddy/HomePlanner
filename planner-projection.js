(function(root,factory){
  'use strict';
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?require('./planner-model.js'):root.HomePlannerModel,
    ()=>common?require('./electrical-planner.js'):root.HomePlannerElectrical,
    ()=>common?require('./planner-regions.js'):root.HomePlannerRegions);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerProjection=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Model,getElectrical,getRegions){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const EPS=1e-7;
  function freeze(value){
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.values(value).forEach(freeze);Object.freeze(value);
    }
    return value;
  }
  function localToSite(point,scene){
    if(!scene.plot)throw new Error('The site plot origin is unresolved.');
    const result={x:point.x-scene.plot.x,y:point.y-scene.plot.y,z:point.z};
    if(!Object.values(result).every(Number.isFinite))throw new Error('Site coordinates require finite x, y and z.');
    return result;
  }
  function siteToWorld(point,headingDeg,datumElevationM=null){
    if(![point.x,point.y,point.z,headingDeg].every(Number.isFinite)||
      (datumElevationM!==null&&!Number.isFinite(datumElevationM)))throw new Error('Invalid physical coordinates.');
    const angle=headingDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const result={east:point.x*c-point.y*s,north:-point.x*s-point.y*c,up:point.z,
      absoluteElevationM:datumElevationM===null?null:datumElevationM+point.z};
    if(Object.values(result).some(value=>value!==null&&!Number.isFinite(value)))throw new Error('Physical coordinates exceed the supported range.');
    return result;
  }
  function projectScene(source){
    if(!source.plot)throw new Error('The site plot origin is unresolved.');
    for(const room of source.rooms){
      if(!Object.hasOwn(room,'usableRegions')&&!Object.hasOwn(room,'reservationFootprint'))continue;
      const regions=getRegions();
      if(!regions)throw new Error('HomePlannerRegions must be loaded before projecting reserved floor regions.');
      if(Object.hasOwn(room,'usableRegions'))regions.area(room.usableRegions);
      if(Object.hasOwn(room,'reservationFootprint'))regions.area([room.reservationFootprint]);
    }
    const scene=copy(source),dx=-source.plot.x,dy=-source.plot.y;
    const shift=point=>{
      const moved={...point,x:point.x+dx,y:point.y+dy};
      if(!Number.isFinite(moved.x)||!Number.isFinite(moved.y))throw new Error('Projected site coordinates exceed the finite numerical range.');
      return moved;
    };
    const segment=value=>({...value,x1:value.x1+dx,y1:value.y1+dy,x2:value.x2+dx,y2:value.y2+dy});
    const opening=value=>({...value,...(value.segment?{segment:segment(value.segment)}:{})});
    scene.floor=shift(scene.floor);scene.plot=shift(scene.plot);scene.building=shift(scene.building);
    scene.rooms=scene.rooms.map(room=>({...room,rect:shift(room.rect),module:shift(room.module),
      ...(room.usableRegions?{usableRegions:room.usableRegions.map(shift)}:{}),
      ...(room.reservationFootprint?{reservationFootprint:shift(room.reservationFootprint)}:{})}));
    scene.openings=scene.openings.map(opening);
    const openings=new Map(scene.openings.map(item=>[item.id,item]));
    scene.walls=scene.walls.map(wall=>({...wall,start:shift(wall.start),end:shift(wall.end),
      openings:wall.openings.map(item=>openings.get(item.id)||opening(item))}));
    scene.furniture=scene.furniture.map(item=>({...item,rect:shift(item.rect)}));
    scene.obstacles=scene.obstacles.map(shift);
    scene.electrical=(source.electrical||[]).map(record=>{
      const resolver=getElectrical();
      const resolved=typeof resolver?.resolveAnchor==='function'
        ?resolver.resolveAnchor(record,source,Model)
        :{drawable:false,position:null,checks:[{code:'electrical-resolver-unavailable',
          message:'Load HomePlannerElectrical before projecting electrical anchors; coordinates are unavailable.'}]};
      const resolvedPoint=resolved.drawable&&resolved.position?shift(resolved.position):null;
      return {...copy(record),resolvedPoint,coordinateSpace:'site-local',
        positionStatus:resolvedPoint?'supplied-site-local':'unprojected-intent',
        positionDiagnostics:copy(resolved.checks)};
    });
    // Rejected proposals remain evidence, not usable geometry in a different frame.
    scene.unresolvedOpenings=scene.unresolvedOpenings.map(item=>({...item,sourceCoordinateSpace:'floor-local'}));
    scene.coordinateSpace='site-local';
    scene.sourcePlotOrigin={x:source.plot.x,y:source.plot.y};
    return freeze(scene);
  }
  function build(project){
    Model.validateProject(project);
    const canonical=Model.canonicalDocument(project),scenes=[],diagnostics=[],raw=new Map(),unregistered=new Set();
    const issue=(code,ownerId,reference=null)=>diagnostics.push({code,ownerId,reference:reference===null?null:copy(reference)});
    for(const floor of canonical.floors){
      const context=floor.legacy.context;
      if(!context){issue('missing-geometry',floor.id);continue;}
      const doc={...copy(project),activeFloorId:floor.id,legacy:copy(floor.legacy),
        building:{...project.building,wallHeightM:floor.wallHeightM}};
      for(const key of ['wallEdits','doorEdits','windowEdits','furnitureEdits','obstacles','electrical'])doc[key]=copy(floor[key]);
      try{raw.set(floor.id,Model.buildScene(context,doc));}
      catch(error){issue('invalid-geometry',floor.id);diagnostics[diagnostics.length-1].message=error.message;}
    }
    const first=raw.get(canonical.floors[0].id);
    for(const [floorId,scene] of raw){
      if(!scene.plot){unregistered.add(floorId);issue('missing-plot',floorId);continue;}
      if(!first?.plot||Math.abs(scene.headingDeg-first.headingDeg)>EPS||
        Math.abs(scene.plot.w-first.plot.w)>EPS||Math.abs(scene.plot.h-first.plot.h)>EPS){
        unregistered.add(floorId);issue('inconsistent-site-frame',floorId);continue;
      }
      scenes.push(projectScene(scene));
    }
    const floorById=new Map(canonical.floors.map(floor=>[floor.id,floor]));
    const records=new Map();
    const hostResults=Array.from({length:64},()=>new Map()),failurePaths=new WeakMap();
    const entityCollections={room:'rooms',opening:'openings',furniture:'furniture',obstacle:'obstacles'};
    const authoredKinds={fixtures:'fixture',stairs:'stair',structural:'structural',serviceNodes:'serviceNode'};
    for(const floor of canonical.floors)for(const [collection,items] of Object.entries(floor.authored||{})){
      if(collection==='version')continue;
      for(const record of items)records.set(`${floor.id}|${record.id}`,{floorId:floor.id,collection,record});
    }
    function failed(code,ref){return {status:'unresolved',point:null,code,reference:copy(ref)};}
    function resolved(point,scene){
      const site=localToSite(point,scene);
      return {status:'resolved',point:site,world:siteToWorld(site,scene.headingDeg,project.siteDatum?.elevationM??null)};
    }
    function resolve(ref,depth=0){
      if(ref===null)return failed('unknown-anchor',ref);
      if(depth>=64)return failed('host-depth-limit',ref);
      if(!floorById.has(ref.floorId))return failed('missing-floor',ref);
      const scene=raw.get(ref.floorId);
      if(!scene)return failed('missing-geometry',ref);
      if(unregistered.has(ref.floorId))return failed('unresolved-site-frame',ref);
      if(ref.kind==='point')return resolved({x:ref.point.x,y:ref.point.y,z:scene.floorElevationM+ref.point.z},scene);
      if(ref.kind==='wall'){
        const wall=scene.walls.find(item=>item.id===ref.entityId);
        if(!wall)return failed('missing-host',ref);
        if(wall.removed)return failed('removed-host',ref);
        const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
        if(ref.offsetM>length+EPS||ref.heightM>wall.heightM+EPS)return failed('host-bounds',ref);
        if(wall.openings.some(opening=>ref.offsetM>opening.offsetM+EPS&&ref.offsetM<opening.offsetM+opening.widthM-EPS&&
          ref.heightM>opening.sillM+EPS&&ref.heightM<opening.sillM+opening.heightM-EPS))return failed('host-void',ref);
        return resolved({...Model.wallPoint(wall,Math.min(ref.offsetM,length)),z:wall.baseM+ref.heightM},scene);
      }
      const list=entityCollections[ref.entityKind];
      if(list){
        const entity=scene[list].find(item=>item.id===ref.entityId);
        if(!entity)return failed('missing-host',ref);
        if(ref.entityKind==='opening'){
          const wall=scene.walls.find(item=>item.id===entity.wallId);
          if(!wall||wall.removed)return failed('removed-host',ref);
          return resolved({...Model.wallPoint(wall,entity.offsetM+entity.widthM/2),
            z:wall.baseM+entity.sillM+entity.heightM/2},scene);
        }
        const box=entity.rect||entity;
        return resolved({x:box.x+box.w/2,y:box.y+box.h/2,
          z:ref.entityKind==='obstacle'?entity.baseM+entity.heightM/2:scene.floorElevationM},scene);
      }
      const key=`${ref.floorId}|${ref.entityId}`,entry=records.get(key);
      if(!entry||authoredKinds[entry.collection]!==ref.entityKind)return failed('missing-host',ref);
      if(hostResults[depth].has(key))return hostResults[depth].get(key);
      // Unroll at most 64 levels, memoizing each host/depth rather than each
      // traversal path. The first failed path retains cycle evidence without
      // making cached results depend on a caller's active ancestor set.
      const results=anchors(entry).map(item=>resolve(item,depth+1));
      const failure=results.find(result=>result.status!=='resolved');
      if(failure){
        const path=failurePaths.get(failure)||[],cycle=path.includes(key);
        const result={...failed('unresolved-host',ref),causeCode:cycle?'cyclic-host':failure.causeCode||failure.code};
        failurePaths.set(result,[key,...path]);
        hostResults[depth].set(key,result);
        return result;
      }
      const point={x:0,y:0,z:0};
      for(const result of results)for(const axis of ['x','y','z'])point[axis]+=result.point[axis]/results.length;
      const result={status:'resolved',point,world:siteToWorld(point,scene.headingDeg,project.siteDatum?.elevationM??null)};
      hostResults[depth].set(key,result);
      return result;
    }
    function anchors(entry){
      const value=entry.record;
      if(Object.hasOwn(value,'anchor'))return [value.anchor];
      if(Object.hasOwn(value,'start'))return [value.start,value.end];
      if(value.anchors)return value.anchors;
      if(entry.collection==='serviceRoutes')return [
        {kind:'entity',entityKind:'serviceNode',...value.from},...value.via,
        {kind:'entity',entityKind:'serviceNode',...value.to}];
      return [];
    }
    const authored=[];
    for(const entry of records.values()){
      const results=anchors(entry).map(ref=>resolve(ref));
      let anchorStatus=results.every(result=>result.status==='resolved')?'resolved':'unresolved';
      for(const result of results)if(result.status==='unresolved'){
        issue(result.code,entry.record.id,result.reference);
        if(result.causeCode)diagnostics[diagnostics.length-1].causeCode=result.causeCode;
      }
      if(entry.collection==='serviceRoutes'){
        for(const ref of [entry.record.from,entry.record.to]){
          const node=records.get(`${ref.floorId}|${ref.entityId}`);
          if(node&&node.record.system!==entry.record.system){
            issue('service-system-mismatch',entry.record.id,ref);anchorStatus='unresolved';
          }
        }
      }
      for(const [key,value] of Object.entries(entry.record))
        if(value===null)issue('unknown-input',entry.record.id,{field:key});
      const dimension=entry.collection==='dimensions';
      const distanceM=dimension&&anchorStatus==='resolved'
        ?Math.hypot(...['x','y','z'].map(axis=>results[1].point[axis]-results[0].point[axis])):null;
      authored.push({...copy(entry),anchorStatus,anchors:results,...(dimension?{distanceM}:{})});
    }
    const documentation=copy(project.documentation||{version:1,views:[],sheets:[]});
    for(const view of documentation.views){
      if(!floorById.has(view.floorId))issue('missing-floor',view.id,{floorId:view.floorId});
      else if(!raw.has(view.floorId))issue('missing-geometry',view.id,{floorId:view.floorId});
      else if(unregistered.has(view.floorId))issue('unresolved-site-frame',view.id,{floorId:view.floorId});
      for(const ref of view.cut){const result=resolve(ref);if(result.status==='unresolved')issue(result.code,view.id,ref);}
    }
    for(const sheet of documentation.sheets)for(const viewId of sheet.viewIds)
      if(!documentation.views.some(view=>view.id===viewId))issue('missing-view',sheet.id,{viewId});
    return freeze({version:1,kind:'DrawingScene',projectId:project.id,revision:project.revision,
      inputFingerprint:Model.inputFingerprint(project),siteDatum:copy(project.siteDatum||{version:1,elevationM:null}),
      scenes,authored,documentation,diagnostics});
  }
  function snapshot(project,{purpose,engineId,engineVersion,inputs={}}){
    if(!['drawing','analysis','export'].includes(purpose)||typeof engineId!=='string'||!engineId.trim()||
      typeof engineVersion!=='string'||!engineVersion.trim())throw new Error('Snapshot purpose and engine provenance are required.');
    Model.assertJSON(inputs);
    return freeze({version:1,purpose,provenance:{projectId:project.id,revision:project.revision,
      inputFingerprint:Model.inputFingerprint(project,inputs),engineId,engineVersion},
      inputs:copy(inputs),drawing:build(project)});
  }
  return Object.freeze({localToSite,siteToWorld,projectScene,build,snapshot});
});
