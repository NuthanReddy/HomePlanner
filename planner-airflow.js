(function(root,factory){
  'use strict';
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?require('./building-physics.js'):root.BuildingPhysics,
    common?require('./planner-regions.js'):root.HomePlannerRegions,
    common?require('./planner-airflow-field.js'):()=>root.HomePlannerAirflowField);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerAirflow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Physics,Regions,Field){
  'use strict';
  const VERSION=1,OUTSIDE='outside';
  const LIMITS=Object.freeze({zones:128,links:512,floors:64,rooms:4096,openings:16384,walls:32768,
    jsonNodes:500000,jsonCharacters:16000000,jsonDepth:64});
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
  const copy=v=>JSON.parse(JSON.stringify(v));
  const key=(kind,ref)=>JSON.stringify([kind,ref.floorId,ref.entityId]);
  const zoneKey=id=>JSON.stringify(['zone',id]);
  const linkKey=id=>JSON.stringify(['link',id]);
  const outsideKey=JSON.stringify(['outside']);
  const missing=v=>v===null||v===undefined;
  function freeze(v){
    if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}
    return v;
  }
  function object(v,path){
    if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${path} must be an object.`);
  }
  function keys(v,allowed,path){
    object(v,path);
    for(const k of Object.keys(v))if(!allowed.includes(k))throw new TypeError(`${path}.${k} is unsupported.`);
  }
  function text(v,path){
    if(typeof v!=='string'||!v.trim())throw new TypeError(`${path} must be a nonempty string.`);
    if(v.length>16384)throw new RangeError(`${path} is too long.`);
  }
  function number(v,path,min=-Infinity,max=Infinity,exclusive=false){
    if(typeof v!=='number'||!Number.isFinite(v))throw new TypeError(`${path} must be finite.`);
    if(v<min||v>max||(exclusive&&v===min))throw new RangeError(`${path} is outside its allowed range.`);
  }
  function array(v,path,max){
    if(!Array.isArray(v))throw new TypeError(`${path} must be an array.`);
    if(v.length>max)throw new RangeError(`${path} exceeds the ${max} item budget; no truncation is performed.`);
  }
  function json(v){
    let nodes=0,characters=0;
    const visiting=new Set();
    function visit(v,depth){
      if(++nodes>LIMITS.jsonNodes||depth>LIMITS.jsonDepth)throw new RangeError('JSON traversal budget exceeded.');
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='number'){number(v,'JSON number');return;}
      if(typeof v==='string'){
        characters+=v.length;
        if(characters>LIMITS.jsonCharacters)throw new RangeError('JSON text budget exceeded.');
        return;
      }
      if(typeof v!=='object')throw new TypeError('Inputs must be finite JSON; undefined is not null.');
      if(visiting.has(v))throw new TypeError('JSON must not contain cycles.');
      if(!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]')throw new TypeError('Only JSON objects are supported.');
      if(Object.getOwnPropertySymbols(v).length)throw new TypeError('JSON cannot contain symbol keys.');
      visiting.add(v);
      if(Array.isArray(v)){
        for(let i=0;i<v.length;i++){if(!own(v,i))throw new TypeError('Sparse arrays are not JSON.');visit(v[i],depth+1);}
      }else for(const k of Object.keys(v)){visit(k,depth+1);visit(v[k],depth+1);}
      visiting.delete(v);
    }
    visit(v,0);
  }
  function canonical(v){
    if(v===null||typeof v!=='object')return JSON.stringify(v);
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  }
  function ref(v,path){
    if(v===null)return;
    keys(v,['floorId','entityId'],path);
    for(const k of ['floorId','entityId'])if(own(v,k)&&v[k]!==null)text(v[k],`${path}.${k}`);
  }
  const completeRef=v=>v&&typeof v.floorId==='string'&&typeof v.entityId==='string';
  function nullableNumber(v,k,path,min,max,exclusive){
    if(own(v,k)&&v[k]!==null)number(v[k],`${path}.${k}`,min,max,exclusive);
  }
  function anchor(v,path){
    if(v===null)return;
    keys(v,['floorId','point'],path);
    if(own(v,'floorId')&&v.floorId!==null)text(v.floorId,`${path}.floorId`);
    if(own(v,'point')&&v.point!==null){
      keys(v.point,['x','y','z'],`${path}.point`);
      for(const axis of ['x','y','z'])if(own(v.point,axis)&&v.point[axis]!==null)number(v.point[axis],`${path}.point.${axis}`);
    }
  }
  function normalizeScenario(value){
    keys(value,['version','id','label','notes','zones','links','densityKgM3','sources','planField'],'scenario');
    if(value.version!==1)throw new RangeError('scenario.version must be 1.');
    array(value.zones,'scenario.zones',LIMITS.zones);array(value.links,'scenario.links',LIMITS.links);
    json(value);
    for(const k of ['id','label','notes'])if(own(value,k)&&value[k]!==null)text(value[k],`scenario.${k}`);
    nullableNumber(value,'densityKgM3','scenario',0,Infinity,true);
    if(value.planField!=null){
      keys(value.planField,['enabled','spacingM'],'scenario.planField');
      if(own(value.planField,'enabled')&&typeof value.planField.enabled!=='boolean')
        throw new TypeError('scenario.planField.enabled must be boolean.');
      nullableNumber(value.planField,'spacingM','scenario.planField',0,Infinity,true);
    }
    if(own(value,'sources')&&value.sources!==null){
      keys(value.sources,['densityKgM3','freeAreaM2','cd','pressurePa','openFraction'],'scenario.sources');
      for(const [k,v] of Object.entries(value.sources))if(v!==null)text(v,`scenario.sources.${k}`);
    }
    const ids=new Set(),roomRefs=new Set(),openingRefs=new Set(),linkIds=new Set();
    value.zones.forEach((z,i)=>{
      const path=`scenario.zones[${i}]`;
      keys(z,['id','room','volumeM3','volumeSource'],path);text(z.id,`${path}.id`);
      if(ids.has(z.id)||z.id===OUTSIDE)throw new RangeError(`${path}.id duplicates a zone or the reserved outside endpoint.`);
      ids.add(z.id);
      if(own(z,'room'))ref(z.room,`${path}.room`);
      if(completeRef(z.room)){
        const id=key('room',z.room);
        if(roomRefs.has(id))throw new RangeError('A physical room may belong to only one zone.');
        roomRefs.add(id);
      }
      nullableNumber(z,'volumeM3',path,0,Infinity,true);
      if(own(z,'volumeSource')&&z.volumeSource!==null)text(z.volumeSource,`${path}.volumeSource`);
    });
    value.links.forEach((l,i)=>{
      const path=`scenario.links[${i}]`;
      keys(l,['id','kind','opening','from','to','anchors','freeAreaM2','cd','pressurePa','openFraction','enabled','notes'],path);
      text(l.id,`${path}.id`);
      if(linkIds.has(l.id))throw new RangeError('Duplicate link ID.');
      linkIds.add(l.id);
      if(!['opening','manual'].includes(l.kind))throw new RangeError(`${path}.kind must be opening or manual.`);
      for(const k of ['from','to','notes'])if(own(l,k)&&l[k]!==null)text(l[k],`${path}.${k}`);
      if(!missing(l.from)&&l.from===l.to)throw new RangeError(`${path} is a self-link.`);
      if(own(l,'enabled')&&typeof l.enabled!=='boolean')throw new TypeError(`${path}.enabled must be boolean.`);
      if(own(l,'opening')){
        if(l.kind!=='opening')throw new TypeError('A manual link cannot claim a known opening.');
        ref(l.opening,`${path}.opening`);
        if(completeRef(l.opening)){
          const id=key('opening',l.opening);
          if(openingRefs.has(id))throw new RangeError('Duplicate physical opening: multiple links would double-count free area.');
          openingRefs.add(id);
        }
      }
      if(own(l,'anchors')){
        if(l.kind!=='manual')throw new TypeError('Known openings use compiled geometry, not manual anchors.');
        if(l.anchors!==null){
          keys(l.anchors,['from','to'],`${path}.anchors`);
          for(const k of ['from','to'])if(own(l.anchors,k))anchor(l.anchors[k],`${path}.anchors.${k}`);
        }
      }
      nullableNumber(l,'freeAreaM2',path,0,Infinity,false);
      nullableNumber(l,'cd',path,0,1,true);
      nullableNumber(l,'pressurePa',path,-Infinity,Infinity,false);
      nullableNumber(l,'openFraction',path,0,1,false);
    });
    // Do not backfill absent fields or erase nulls in a session draft.
    return freeze(copy(value));
  }
  const ordered=list=>list.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  const pick=(v,fields)=>Object.fromEntries(fields.filter(k=>own(v,k)).map(k=>[k,copy(v[k])]));
  function discover(scene){
    object(scene,'scene');
    if(scene.kind!=='DrawingScene'||scene.version!==1)throw new TypeError('Use the version 1 shared DrawingScene from getDrawingScene()/Projection.build().');
    text(scene.projectId,'scene.projectId');number(scene.revision,'scene.revision',0);
    array(scene.scenes,'scene.scenes',LIMITS.floors);
    let roomsCount=0,openingsCount=0,wallsCount=0;
    for(const f of scene.scenes){
      array(f.rooms,'floor.rooms',LIMITS.rooms);array(f.openings,'floor.openings',LIMITS.openings);array(f.walls,'floor.walls',LIMITS.walls);
      roomsCount+=f.rooms.length;openingsCount+=f.openings.length;wallsCount+=f.walls.length;
    }
    if(roomsCount>LIMITS.rooms||openingsCount>LIMITS.openings||wallsCount>LIMITS.walls)throw new RangeError('Scene inventory budget exceeded.');
    json(scene);
    const rooms=[],openings=[],floors=[],walls=[],findings=[],physical=[],floorIds=new Set();
    const issue=(code,reference,message)=>findings.push({code,reference,message,severity:'warning'});
    for(const f of scene.scenes){
      text(f.floorId,'floor.floorId');
      if(floorIds.has(f.floorId))throw new RangeError('Duplicate floor ID.');
      floorIds.add(f.floorId);
      if(f.coordinateSpace!=='site-local')throw new TypeError('All floors must use the shared site-local projection; no recentering is performed.');
      number(f.floorElevationM,'floor.floorElevationM');number(f.headingDeg,'floor.headingDeg');
      floors.push({floorId:f.floorId,elevationM:f.floorElevationM,headingDeg:f.headingDeg,coordinateSpace:'site-local'});
      const roomIds=new Set(),wallIds=new Set(),openingIds=new Set();
      for(const r of f.rooms){
        text(r.id,'room.id');
        if(roomIds.has(r.id))throw new RangeError('Duplicate room ID on a floor.');
        roomIds.add(r.id);
        object(r.rect,'room.rect');
        for(const k of ['x','y','w','h'])number(r.rect[k],`room.rect.${k}`,['w','h'].includes(k)?0:-Infinity,Infinity,['w','h'].includes(k));
        const {x,y,w,h}=r.rect,z=f.floorElevationM,reference={floorId:f.floorId,entityId:r.id};
        let usableRegions=[copy(r.rect)];
        if(own(r,'usableRegions')){
          if(!Regions?.area||!Regions?.subtractRectangle)throw new TypeError('Load planner-regions.js to validate supplied usable room regions.');
          array(r.usableRegions,'room.usableRegions',4096);Regions.area(r.usableRegions);
          if(r.usableRegions.some(region=>Regions.subtractRectangle(region,[r.rect]).length))
            throw new RangeError('Usable floor regions extend outside the room bounding rectangle.');
          usableRegions=copy(r.usableRegions);
        }else if(r.reservedAreaM2>0)throw new TypeError('Reserved room area requires supplied usableRegions; no bounding rectangle is substituted.');
        const largest=usableRegions.reduce((best,region)=>!best||region.w*region.h>best.w*best.h?region:best,null)||r.rect;
        const geometry={rect:copy(r.rect),module:r.module?copy(r.module):null,usableRegions,polygon:[{x,y,z},{x:x+w,y,z},{x:x+w,y:y+h,z},{x,y:y+h,z}],
          center:{x:largest.x+largest.w/2,y:largest.y+largest.h/2,z},coordinateSpace:'site-local'};
        json(geometry);
        rooms.push({key:key('room',reference),ref:reference,label:r.label??r.id,geometry,
          usableAreaM2:usableRegions.reduce((sum,region)=>sum+region.w*region.h,0),
          volumeM3:null,volumeStatus:'explicit-clear-volume-required'});
      }
      for(const w of f.walls){
        text(w.id,'wall.id');
        if(wallIds.has(w.id))throw new RangeError('Duplicate wall ID on a floor.');
        wallIds.add(w.id);
        walls.push({ref:{floorId:f.floorId,entityId:w.id},...pick(w,['start','end','thicknessM','removed'])});
      }
      const wallById=new Map(f.walls.map(w=>[w.id,w]));
      for(const o of f.openings){
        text(o.id,'opening.id');
        if(openingIds.has(o.id))throw new RangeError('Duplicate opening ID on a floor.');
        openingIds.add(o.id);
        const reference={floorId:f.floorId,entityId:o.id},wall=wallById.get(o.wallId);
        const hosts=wall?.roomIds,knownHosts=Array.isArray(hosts)&&hosts.length>0&&hosts.length<=2&&
          new Set(hosts).size===hosts.length&&hosts.every(id=>roomIds.has(id));
        const hosted=!!wall&&Array.isArray(wall.openings)&&wall.openings.some(item=>item.id===o.id)&&(!wall.removed||o.kind==='passage');
        const ownership=knownHosts&&(!o.roomId||hosts.includes(o.roomId))&&(!o.targetRoomId||hosts.includes(o.targetRoomId));
        let candidateAdjacency=null;
        if(hosted&&ownership){
          if(wall.exterior===true&&o.exterior===true&&hosts.length===1&&!o.targetRoomId)
            candidateAdjacency=[{kind:'room',floorId:f.floorId,entityId:hosts[0]},{kind:'outside'}];
          else if(wall.exterior===false&&o.exterior===false&&hosts.length===2)
            candidateAdjacency=hosts.map(entityId=>({kind:'room',floorId:f.floorId,entityId}));
        }
        if(!candidateAdjacency)issue(hosted?'unknown-opening-adjacency':'missing-opening-host',reference,
          'Resolve the compiled wall/room hosts before selecting this opening; an unknown side is not outside.');
        let geometry=null,grossAreaM2=null;
        if(wall&&[o.offsetM,o.widthM,o.heightM,o.sillM,wall.baseM,wall.start?.x,wall.start?.y,wall.end?.x,wall.end?.y].every(Number.isFinite)&&o.widthM>0&&o.heightM>0){
          const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y);
          if(length>0&&o.offsetM>=0&&o.sillM>=0&&o.offsetM+o.widthM<=length+1e-7&&
            Number.isFinite(wall.heightM)&&o.sillM+o.heightM<=wall.heightM+1e-7){
            const at=(offset,z)=>({x:wall.start.x+(wall.end.x-wall.start.x)*offset/length,
              y:wall.start.y+(wall.end.y-wall.start.y)*offset/length,z});
            const z=wall.baseM+o.sillM+o.heightM/2;
            geometry={coordinateSpace:'site-local',floorId:f.floorId,
              start:at(o.offsetM,z),end:at(o.offsetM+o.widthM,z),center:at(o.offsetM+o.widthM/2,z),
              sillElevationM:wall.baseM+o.sillM,heightM:o.heightM,widthM:o.widthM,wallThicknessM:wall.thicknessM??null};
            grossAreaM2=o.widthM*o.heightM;json({geometry,grossAreaM2});
          }
        }
        if(!geometry)issue('unknown-opening-geometry',reference,'Resolve the compiled aperture geometry.');
        const fraction=o.openFraction??null;
        if(fraction!==null)number(fraction,'opening.openFraction',0,1);
        openings.push({key:key('opening',reference),ref:reference,kind:o.kind??null,
          wallRef:typeof o.wallId==='string'?{floorId:f.floorId,entityId:o.wallId}:null,
          geometry,grossAreaM2,candidateAdjacency,adjacencyStatus:candidateAdjacency?'known':'unknown',
          operation:{openFraction:fraction,source:fraction===null?'unknown':'compiled-model',
            semantics:'Current compiled opening fraction, including compiler closed defaults; not optical transmission or door glyph angle.'}});
      }
      physical.push({floorId:f.floorId,elevationM:f.floorElevationM,headingDeg:f.headingDeg,
        plot:f.plot??null,wallHeightM:f.wallHeightM??null,
        rooms:f.rooms.map(r=>pick(r,['id','rect','module','service','usableRegions','reservedAreaM2','reservationFootprint'])).sort((a,b)=>a.id<b.id?-1:1),
        walls:f.walls.map(w=>({...pick(w,['id','start','end','baseM','heightM','thicknessM','exterior','removed','roomIds']),
          openingIds:(w.openings||[]).map(o=>o.id).sort()})).sort((a,b)=>a.id<b.id?-1:1),
        openings:f.openings.map(o=>pick(o,['id','wallId','roomId','targetRoomId','kind','offsetM','widthM','heightM','sillM','openFraction','exterior'])).sort((a,b)=>a.id<b.id?-1:1),
        unresolvedOpenings:f.unresolvedOpenings??[],diagnostics:f.diagnostics??[]});
    }
    physical.sort((a,b)=>a.floorId<b.floorId?-1:1);
    const sourceDiagnostics=copy(scene.diagnostics??[]);
    const sourceFloorDiagnostics=scene.scenes.map(f=>({floorId:f.floorId,diagnostics:copy(f.diagnostics??[])}));
    return freeze({version:VERSION,kind:'AirflowInventory',projectId:scene.projectId,revision:scene.revision,
      physicalFingerprint:canonical({version:VERSION,floors:physical,diagnostics:sourceDiagnostics}),
      sourceInputFingerprint:scene.inputFingerprint??null,coordinateSpace:'site-local',
      floors,walls,rooms:ordered(rooms),openings:ordered(openings),findings,sourceDiagnostics,sourceFloorDiagnostics,
      scope:'Explicit selected-room steady pressure network; inventory is not an automatically connected ventilation model.'});
  }
  function graph(zones,links){
    const adjacency=new Map([[OUTSIDE,[]],...zones.map(z=>[z.id,[]])]);
    for(const l of links)if(l.state==='active'){
      adjacency.get(l.from).push(l.to);adjacency.get(l.to).push(l.from);
    }
    const seen=new Set(),components=[];
    for(const start of adjacency.keys()){
      if(seen.has(start))continue;
      const members=[start];seen.add(start);
      for(let i=0;i<members.length;i++)for(const next of adjacency.get(members[i]))if(!seen.has(next)){seen.add(next);members.push(next);}
      if(members.length===1&&start===OUTSIDE)continue;
      components.push({id:components.length,zoneIds:members.filter(id=>id!==OUTSIDE),
        connectedToOutside:members.includes(OUTSIDE),referenceZoneId:members.includes(OUTSIDE)?OUTSIDE:start,
        gauge:members.includes(OUTSIDE)?'outside-zero-Pa':'arbitrary-zero-Pa',
        referencePressurePa:0});
    }
    return {components,adjacency};
  }
  function run(scene,scenario,options={}){
    const draft=normalizeScenario(scenario);
    keys(options,['expectedPhysicalFingerprint'],'options');json(options);
    if(own(options,'expectedPhysicalFingerprint')){
      const fingerprint=options.expectedPhysicalFingerprint;
      if(typeof fingerprint!=='string'||!fingerprint.trim())
        throw new TypeError('options.expectedPhysicalFingerprint must be a nonempty string.');
      if(fingerprint.length>LIMITS.jsonCharacters)
        throw new RangeError('Physical fingerprint exceeds the JSON text budget.');
    }
    const inventory=discover(scene),findings=[];
    const scenarioFingerprint=canonical(draft);
    const provenance={engineId:'HomePlannerAirflow',engineVersion:'1',solverId:'BuildingPhysics.solveAirflow',
      solverContractVersion:1,projectId:inventory.projectId,revision:inventory.revision,
      physicalFingerprint:inventory.physicalFingerprint,scenarioFingerprint,
      inputFingerprint:canonical({version:VERSION,physicalFingerprint:inventory.physicalFingerprint,scenarioFingerprint}),
      sourceInputFingerprint:inventory.sourceInputFingerprint};
    const issue=(code,path,message,blocking=true)=>findings.push({code,path,message,severity:blocking?'blocking':'info'});
    if(own(options,'expectedPhysicalFingerprint')&&options.expectedPhysicalFingerprint!==inventory.physicalFingerprint)
      issue('stale-physical-input','options.expectedPhysicalFingerprint','Physical inputs changed. Review current geometry and operating state.');
    const roomsByKey=new Map(inventory.rooms.map(r=>[r.key,r])),openingsByKey=new Map(inventory.openings.map(o=>[o.key,o]));
    const floors=new Set(inventory.floors.map(f=>f.floorId));
    const zones=draft.zones.map((z,i)=>{
      const room=completeRef(z.room)?roomsByKey.get(key('room',z.room)):null;
      if(!room)issue('missing-room-reference',`zones[${i}].room`,'Select a current physical room with its exact floor and entity IDs.');
      if(room?.usableAreaM2===0)issue('empty-usable-room',`zones[${i}].room`,'No usable floor remains in this room. Choose another zone or review the physical reservations in Design.');
      if(missing(z.volumeM3))issue('missing-volume',`zones[${i}].volumeM3`,'Supply a positive clear room volume explicitly; wall height is not clear room height.');
      return {id:z.id,solverId:zoneKey(z.id),roomRef:z.room??null,geometry:room?.geometry??null,
        volumeM3:z.volumeM3??null,volumeProvenance:{source:missing(z.volumeM3)?'unknown':'scenario-explicit',note:z.volumeSource??null}};
    });
    if(!zones.length)issue('missing-zones','zones','Select at least one current room.');
    if(missing(draft.densityKgM3))issue('missing-density','densityKgM3','Supply a positive constant density; no default air density is applied.');
    const byId=new Map(zones.map(z=>[z.id,z]));
    const selectedFloors=new Set(zones.map(z=>z.roomRef?.floorId).filter(Boolean));
    for(const floor of inventory.sourceFloorDiagnostics)if(selectedFloors.has(floor.floorId))
      for(const diagnostic of floor.diagnostics)if(diagnostic.level==='error')
        issue('invalid-physical-enclosure',`floors[${JSON.stringify(floor.floorId)}]`,diagnostic.message);
    const endpoint=id=>id===OUTSIDE?{kind:'outside'}:completeRef(byId.get(id)?.roomRef)?{kind:'room',...byId.get(id).roomRef}:null;
    const links=draft.links.map((l,i)=>{
      const path=`links[${i}]`,disabled=l.enabled===false;
      const before=findings.length;
      const problem=(code,field,message,blocking=!disabled)=>issue(code,`${path}.${field}`,message,blocking);
      if(!own(l,'enabled'))problem('missing-enabled','enabled','Explicitly enable or disable this link.');
      const from=endpoint(l.from),to=endpoint(l.to);
      if(!from||!to)problem('missing-endpoint','from/to','Choose two current scenario zones, or one zone and outside.');
      let opening=null,geometry=null,operationSource='scenario-explicit',fraction=l.openFraction??null,grossAreaM2=null;
      if(l.kind==='opening'){
        opening=completeRef(l.opening)?openingsByKey.get(key('opening',l.opening)):null;
        if(!opening)problem('missing-opening-reference','opening','Select a current compiled opening with exact floor and entity IDs.');
        else{
          geometry=opening.geometry;grossAreaM2=opening.grossAreaM2;
          if(!geometry)problem('unknown-opening-geometry','opening','Repair the compiled opening geometry.');
          const candidates=opening.candidateAdjacency;
          if(!candidates)problem('unknown-opening-adjacency','opening','Resolve wall room hosts; unknown sides cannot be assigned outside.');
          else if(from&&to){
            const pair=[canonical(from),canonical(to)].sort();
            if(canonical(pair)!==canonical(candidates.map(canonical).sort()))
              problem('incompatible-opening-endpoints','from/to','Selected zones must match both actual wall hosts, including a confirmed exterior side.');
          }
          if(opening.operation.openFraction!==null){
            fraction=opening.operation.openFraction;operationSource='compiled-model';
            if(!missing(l.openFraction)&&l.openFraction!==fraction)
              problem('operating-state-mismatch','openFraction','Current model operation differs. Change the opening operation in the project, review the draft, or disable this link.');
          }
        }
      }else{
        const points={};
        for(const side of ['from','to']){
          const a=l.anchors?.[side],z=byId.get(l[side]);
          const valid=a&&floors.has(a.floorId)&&a.point&&['x','y','z'].every(k=>Number.isFinite(a.point[k]));
          if(!valid)problem('missing-manual-anchor',`anchors.${side}`,'Supply an explicit site-local x/y/z anchor and existing floor ID; no stair or stack geometry is inferred.');
          else if(l[side]!==OUTSIDE&&z?.roomRef?.floorId!==a.floorId)
            problem('manual-anchor-floor-mismatch',`anchors.${side}`,'The manual anchor must use the selected room floor.');
          else points[side]=copy(a);
        }
        if(points.from&&points.to)geometry={coordinateSpace:'site-local',from:points.from,to:points.to,
          isInterFloor:points.from.floorId!==points.to.floorId,label:'Manual connection intent; not a known opening'};
      }
      const zero=l.freeAreaM2===0;
      for(const field of ['freeAreaM2','cd','pressurePa'])if(missing(l[field]))
        problem(`missing-${field}`,field,`Supply explicit ${field}; no physical value is inferred.`,!disabled&&!(zero&&field!=='freeAreaM2'));
      if(fraction===null)problem('missing-openFraction','openFraction','Current operation is unknown. Supply an explicit operating fraction.',!disabled&&!zero);
      if(!disabled&&l.freeAreaM2>0&&fraction===0)
        problem('closed-opening-positive-area','freeAreaM2','The opening is closed. Change its modeled operation, supply zero free area, or disable this link. No leakage is added.');
      if(!disabled&&!zero&&grossAreaM2!==null&&fraction!==null&&l.freeAreaM2>grossAreaM2*fraction)
        problem('area-exceeds-aperture','freeAreaM2','Operating free area exceeds width × height × current open fraction. Review area or change operation; no silent clamp.');
      const blocked=findings.slice(before).some(f=>f.severity==='blocking');
      return {id:l.id,solverId:linkKey(l.id),kind:l.kind,openingRef:l.opening??null,from:l.from??null,to:l.to??null,
        solverFrom:from?(l.from===OUTSIDE?outsideKey:zoneKey(l.from)):null,
        solverTo:to?(l.to===OUTSIDE?outsideKey:zoneKey(l.to)):null,
        enabled:l.enabled??null,state:disabled?'disabled':blocked?'blocked':zero?'closed':'active',
        freeAreaM2:l.freeAreaM2??null,effectiveAreaM2:disabled||zero?0:blocked?null:l.freeAreaM2,
        cd:l.cd??null,pressurePa:l.pressurePa??null,operation:{openFraction:fraction,source:fraction===null?'unknown':operationSource},
        geometry,grossAreaM2,awaitingInputs:findings.slice(before).filter(f=>f.code.startsWith('missing-')).map(f=>f.path)};
    });
    let solverInput=null,solver=null,components=[],zoneResults=[],flowResults=[];
    let status='blocked';
    if(!findings.some(f=>f.severity==='blocking')){
      solverInput={outsideId:outsideKey,densityKgM3:draft.densityKgM3,
        zones:zones.map(z=>({id:z.solverId,volumeM3:z.volumeM3})),
        links:links.filter(l=>l.state==='active').map(l=>({id:l.solverId,from:l.solverFrom,to:l.solverTo,
          freeAreaM2:l.effectiveAreaM2,cd:l.cd,pressurePa:l.pressurePa}))};
      if(!Physics||typeof Physics.solveAirflow!=='function')throw new TypeError('Load building-physics.js before planner-airflow.js.');
      try{solver=Physics.solveAirflow(solverInput);}
      catch(error){
        if(!(error instanceof RangeError))throw error;
        issue('solver-numerical-range','solver',error.message);
        status='numerical-error';
      }
      if(solver){
        status=solver.converged?'converged':'nonconverged';
        const topology=graph(zones,links);components=topology.components;
        const flows=new Map(solver.flows.map(f=>[f.id,f]));
        flowResults=links.map(l=>{
          const flow=flows.get(l.solverId),q=flow?flow.m3s:0;
          return {...l,m3s:q,direction:q===0?null:{from:q>0?l.from:l.to,to:q>0?l.to:l.from},
            meanOpeningSpeedMps:l.effectiveAreaM2>0?Math.abs(q)/l.effectiveAreaM2:null,
            numericalStatus:status};
        });
        zoneResults=zones.map(z=>{
          let inflowM3s=0,outflowM3s=0,directOutsideInflowM3s=0,transferInflowM3s=0;
          for(const f of flowResults){
            const signed=f.from===z.id?-f.m3s:f.to===z.id?f.m3s:0;
            if(signed>0){
              inflowM3s+=signed;
              if((f.from===z.id?f.to:f.from)===OUTSIDE)directOutsideInflowM3s+=signed;else transferInflowM3s+=signed;
            }else outflowM3s-=signed;
          }
          const component=components.find(c=>c.zoneIds.includes(z.id)),degree=topology.adjacency.get(z.id).length;
          return {...z,pressurePa:solver.pressures[z.solverId],inflowM3s,outflowM3s,
            netOutflowM3s:solver.zoneResidualsM3s[z.solverId],
            massResidualKgS:solver.zoneResidualsM3s[z.solverId]*draft.densityKgM3,
            directOutsideInflowM3s,transferInflowM3s,
            directOutsideInflowACH:solver.converged?directOutsideInflowM3s*3600/z.volumeM3:null,
            achLabel:'Direct outside inflow ACH; not complete fresh-air delivery or a mixing estimate',
            sealed:degree===0,deadEnd:degree===1,connectedToOutside:component.connectedToOutside,
            componentId:component.id,numericalStatus:status};
        });
      }
    }
    const result={version:VERSION,kind:'AirflowResult',status,balanced:solver?.converged===true,
      provenance,scenario:draft,inventory,zones,links,solverInput,solver,components,zoneResults,flowResults,findings,
      warnings:['Selected-room network only; omitted openings are not asserted sealed.',
        'Steady one-way constant-density orifices, not CFD, turbulent room velocity, single-sided exchange or two-way large openings.',
        'Manual links are supplied intent, not confirmed stairs/shafts. No wind Cp, buoyancy, leakage or pressure is inferred.',
        'Disabled/zero-area links are excluded from the solver; missing inactive-link inputs remain recorded.',
        ...(solver?.warnings??[])]};
    if(draft.planField?.enabled===true){
      const engine=typeof Field==='function'?Field():Field;
      if(!engine?.run)throw new TypeError('Load planner-airflow-field.js for the optional 2D potential-flow estimate.');
      result.planField=engine.run(result,draft.planField);
    }
    // Never export Infinity/NaN introduced by secondary metrics as plausible JSON nulls.
    try{json(result);}
    catch(error){
      if(!(error instanceof TypeError))throw error;
      result.status='numerical-error';result.balanced=false;result.zoneResults=[];result.flowResults=[];
      if(result.planField)result.planField={...result.planField,status:'unavailable',cells:[],rooms:[],maximumSpeedMps:null,
        findings:[{code:'network-numerical-error',message:'The network has invalid secondary metrics; no velocity estimate is published.'}]};
      issue('derived-numerical-range','results','Secondary metrics exceed finite numeric range; inspect raw solver diagnostics.');
      json(result);
    }
    return freeze(copy(result));
  }
  function compare(a,b){
    for(const r of [a,b]){
      if(r?.kind!=='AirflowResult'||r.version!==1)throw new TypeError('Compare two version 1 AirflowResult snapshots.');
      json(r);
    }
    const differentProject=a.provenance.projectId!==b.provenance.projectId;
    const geometryChanged=a.provenance.physicalFingerprint!==b.provenance.physicalFingerprint;
    const reasons=[];
    if(differentProject)reasons.push('different-project');
    if(geometryChanged)reasons.push('physical-inputs-changed');
    if(!a.balanced||!b.balanced)reasons.push('unbalanced-or-unavailable');
    const comparable=reasons.length===0;
    const oldZones=new Map(a.zoneResults.map(z=>[canonical(z.roomRef),z]));
    const sameRooms=canonical(a.zones.map(z=>canonical(z.roomRef)).sort())===canonical(b.zones.map(z=>canonical(z.roomRef)).sort());
    if(!sameRooms)reasons.push('zone-selection-changed');
    return freeze({version:VERSION,comparable:comparable&&sameRooms,reasons,differentProject,geometryChanged,
      revisionChanged:a.provenance.revision!==b.provenance.revision,
      scenarioChanged:a.provenance.scenarioFingerprint!==b.provenance.scenarioFingerprint,
      sameInput:a.provenance.inputFingerprint===b.provenance.inputFingerprint,
      zoneDeltas:comparable&&sameRooms?b.zoneResults.map(z=>({roomRef:copy(z.roomRef),
        directOutsideInflowM3s:z.directOutsideInflowM3s-oldZones.get(canonical(z.roomRef)).directOutsideInflowM3s,
        inflowM3s:z.inflowM3s-oldZones.get(canonical(z.roomRef)).inflowM3s})):[]});
  }
  return Object.freeze({VERSION,LIMITS,OUTSIDE,normalizeScenario,discover,run,compare});
});
