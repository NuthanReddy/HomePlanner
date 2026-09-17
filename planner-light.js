(function(root,factory){
  'use strict';
  const common=typeof module==='object'&&module.exports;
  const api=factory(common?require('./building-physics.js'):root.BuildingPhysics,
    common?require('./planner-projection.js'):root.HomePlannerProjection,
    common?require('./planner-regions.js'):root.HomePlannerRegions);
  if(common)module.exports=api;else root.HomePlannerLight=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Physics,Projection,Regions){
  'use strict';
  const VERSION=1;
  const LIMITS=Object.freeze({floors:64,entities:32768,sensors:4096,intervals:2048,
    hemisphereRays:2000000,totalRays:4000000,rayComparisons:50000000,maskEntries:1000000,
    batchRays:65536,jsonNodes:500000,jsonCharacters:16000000,jsonDepth:64});
  const SIDES=['front','right','rear','left'],RAD=Math.PI/180;
  const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k),missing=v=>v===undefined||v===null;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
  const schemaObject=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
  const stringSchema={type:'string',minLength:1},numberSchema={type:'number'};
  const positiveSchema={type:'number',exclusiveMinimum:0},fractionSchema={type:'number',minimum:0,maximum:1};
  const timestampSchema={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$'};
  const skyProperties={enabled:{type:'boolean'},radialBands:{type:'integer',minimum:1,maximum:128},
    azimuthSectors:{type:'integer',minimum:4,maximum:512,multipleOf:4}};
  const sampleSchema=schemaObject({startUTC:timestampSchema,endUTC:timestampSchema,sampleUTC:timestampSchema,
    sunENU:schemaObject({east:numberSchema,north:numberSchema,up:numberSchema}),
    sunAnglesDeg:schemaObject({altitudeDeg:{type:'number',minimum:-90,maximum:90},azimuthDeg:{type:'number',minimum:0,maximum:360}})},
  ['startUTC','endUTC','sampleUTC']);
  sampleSchema.oneOf=[{required:['sunENU'],not:{required:['sunAnglesDeg']}},{required:['sunAnglesDeg'],not:{required:['sunENU']}}];
  const configProperties={
    version:{const:VERSION},id:stringSchema,label:stringSchema,
    workplanes:{type:'array',minItems:1,maxItems:LIMITS.sensors,items:schemaObject({
      id:stringSchema,room:schemaObject({floorId:stringSchema,entityId:stringSchema}),
      heightM:{type:'number',minimum:0},spacingM:positiveSchema})},
    sky:{oneOf:[schemaObject({...skyProperties,enabled:{const:true}}),
      schemaObject({...skyProperties,enabled:{const:false}},['enabled'])]},
    direct:schemaObject({enabled:{type:'boolean'}}),
    windowOptics:{oneOf:[schemaObject({mode:{const:'ideal-clear'},source:stringSchema},['mode']),
      schemaObject({mode:{const:'visible-transmission'},visibleTransmittance:fractionSchema,source:stringSchema})]},
    neighbors:schemaObject(Object.fromEntries(SIDES.map(side=>[side,schemaObject({
      state:{enum:['unknown','clear','modeled']},boxIds:{type:'array',uniqueItems:true,maxItems:LIMITS.entities,items:stringSchema}},['state'])])),[]),
    neighborBoxes:{type:'array',maxItems:LIMITS.entities,items:schemaObject({
      id:stringSchema,x:numberSchema,y:numberSchema,w:positiveSchema,h:positiveSchema,baseM:numberSchema,
      heightM:positiveSchema,transmittance:fractionSchema})},
    roofContext:{type:'array',maxItems:LIMITS.floors,items:schemaObject({
      floorId:stringSchema,state:{enum:['none','unknown','supplied']},source:stringSchema})},
    minSunAltitudeDeg:{type:'number',exclusiveMinimum:0,exclusiveMaximum:90},
    period:schemaObject({startUTC:timestampSchema,endUTC:timestampSchema}),
    samples:{type:'array',maxItems:LIMITS.intervals,items:sampleSchema},
    site:schemaObject({latitudeDeg:{type:'number',minimum:-90,maximum:90},
      longitudeDeg:{type:'number',minimum:-180,maximum:180},timeZone:stringSchema},[])
  };
  const CONFIG_SCHEMA=freeze({...schemaObject({...configProperties,
    period:{oneOf:[configProperties.period,{type:'null'}]},
    minSunAltitudeDeg:{oneOf:[configProperties.minSunAltitudeDeg,{type:'null'}]}},
  ['version','workplanes','sky','windowOptics','neighbors','neighborBoxes','samples']),
    allOf:[{if:{required:['direct'],properties:{direct:{properties:{enabled:{const:false}},required:['enabled']}}},
      then:{properties:{sky:{properties:{enabled:{const:true}}},period:{type:'null'},samples:{maxItems:0}}},
      else:{required:['period','minSunAltitudeDeg'],properties:{period:configProperties.period,minSunAltitudeDeg:configProperties.minSunAltitudeDeg}}}],
    title:'HomePlannerLight v1 executable configuration',
    description:'Repairable drafts may omit/null controls; executable inputs also require semantic geometry, timestamp, unit-vector and budget validation by createStudy.'});
  function object(v,p){if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(p+' must be an object.');}
  function keys(v,allowed,p){object(v,p);for(const k of Object.keys(v))if(!allowed.includes(k))throw new TypeError(p+'.'+k+' is unsupported.');}
  function num(v,p,min=-Infinity,max=Infinity){if(typeof v!=='number'||!Number.isFinite(v))throw new TypeError(p+' must be finite.');if(v<min||v>max)throw new RangeError(p+' is outside its range.');return v;}
  function positive(v,p){num(v,p,0);if(v===0)throw new RangeError(p+' must be positive.');return v;}
  function integer(v,p,min,max){num(v,p,min,max);if(!Number.isInteger(v))throw new RangeError(p+' must be an integer.');return v;}
  function text(v,p){if(typeof v!=='string'||!v.trim())throw new TypeError(p+' must be nonempty text.');}
  function array(v,p,max){if(!Array.isArray(v))throw new TypeError(p+' must be an array.');if(v.length>max)throw new RangeError(p+' exceeds budget; no truncation.');}
  function json(value){
    let nodes=0,characters=0;const active=new Set();
    function visit(v,depth){
      if(++nodes>LIMITS.jsonNodes||depth>LIMITS.jsonDepth)throw new RangeError('JSON traversal budget exceeded.');
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='number'){num(v,'JSON number');return;}
      if(typeof v==='string'){characters+=v.length;if(characters>LIMITS.jsonCharacters)throw new RangeError('JSON character budget exceeded.');return;}
      if(typeof v!=='object'||Object.getOwnPropertySymbols(v).length||
        (!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]'))throw new TypeError('Only finite plain JSON is supported.');
      if(active.has(v))throw new TypeError('Cyclic JSON.');active.add(v);
      if(Array.isArray(v)){for(let i=0;i<v.length;i++){if(!own(v,i))throw new TypeError('Sparse arrays are not JSON.');visit(v[i],depth+1);}}
      else for(const k of Object.keys(v)){visit(k,depth+1);visit(v[k],depth+1);}
      active.delete(v);
    }
    visit(value,0);
    return {nodes,characters};
  }
  function canonical(v){
    if(v===null||typeof v!=='object')return JSON.stringify(v);
    return Array.isArray(v)?'['+v.map(canonical).join(',')+']':
      '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  }
  function fingerprint(v){json(v);const result=canonical(v);if(result.length>LIMITS.jsonCharacters)throw new RangeError('Canonical JSON budget exceeded.');return result;}
  const refKey=ref=>JSON.stringify([ref.floorId,ref.entityId]);
  function reference(v,p){keys(v,['floorId','entityId'],p);for(const k of ['floorId','entityId'])if(!missing(v[k]))text(v[k],p+'.'+k);}
  function utc(v,p){
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))throw new TypeError(p+' requires an explicit UTC ISO timestamp ending Z.');
    const time=Date.parse(v);if(!Number.isFinite(time)||new Date(time).toISOString()!==v.replace(/Z$/,v.includes('.')?'Z':'.000Z'))throw new RangeError(p+' is not a real UTC timestamp.');
    return time;
  }
  function sunVector(sample){
    if(!missing(sample.sunENU)){
      keys(sample.sunENU,['east','north','up'],'sunENU');
      const norm=Math.hypot(...['east','north','up'].map(k=>num(sample.sunENU[k],'sunENU.'+k)));
      if(Math.abs(norm-1)>1e-6)throw new RangeError('sunENU must be a unit vector toward the sun.');
      return Object.fromEntries(['east','north','up'].map(k=>[k,sample.sunENU[k]/norm]));
    }
    if(!missing(sample.sunAnglesDeg)){
      keys(sample.sunAnglesDeg,['altitudeDeg','azimuthDeg'],'sunAnglesDeg');
      if(missing(sample.sunAnglesDeg.altitudeDeg)||missing(sample.sunAnglesDeg.azimuthDeg))return null;
      const a=num(sample.sunAnglesDeg.altitudeDeg,'altitudeDeg',-90,90)*RAD;
      const b=num(sample.sunAnglesDeg.azimuthDeg,'azimuthDeg',0,360)*RAD;
      // Same degree convention as HomeSun: clockwise from geographic north.
      return {east:Math.cos(a)*Math.sin(b),north:Math.cos(a)*Math.cos(b),up:Math.sin(a)};
    }
    return null;
  }
  function normalizeConfig(value){
    json(value);keys(value,['version','id','label','workplanes','sky','windowOptics','neighbors','neighborBoxes','roofContext',
      'period','samples','site','minSunAltitudeDeg','direct'],'config');
    if(!missing(value.version)&&value.version!==VERSION)throw new RangeError('config.version must be 1.');
    if(own(value,'direct')){
      keys(value.direct,['enabled'],'direct');
      if(typeof value.direct.enabled!=='boolean')throw new TypeError('direct.enabled must be boolean.');
      if(!value.direct.enabled){
        if(!missing(value.period))throw new TypeError('Disabled direct access requires period null or absent.');
        if(!missing(value.samples)&&(!Array.isArray(value.samples)||value.samples.length))
          throw new TypeError('Disabled direct access requires an empty samples array.');
        if(value.sky?.enabled!==true)throw new TypeError('Disabled direct access requires sky.enabled true.');
      }
    }
    for(const k of ['id','label'])if(!missing(value[k]))text(value[k],k);
    if(!missing(value.minSunAltitudeDeg)){positive(value.minSunAltitudeDeg,'minSunAltitudeDeg');if(value.minSunAltitudeDeg>=90)throw new RangeError('Cutoff must be below 90 degrees.');}
    if(!missing(value.workplanes)){
      array(value.workplanes,'workplanes',LIMITS.sensors);const ids=new Set(),refs=new Set();
      for(const w of value.workplanes){
        keys(w,['id','room','heightM','spacingM'],'workplane');
        if(!missing(w.id)){text(w.id,'workplane.id');if(ids.has(w.id))throw new RangeError('Duplicate workplane ID.');ids.add(w.id);}
        if(!missing(w.room)){reference(w.room,'workplane.room');if(w.room.floorId&&w.room.entityId){const k=refKey(w.room);if(refs.has(k))throw new RangeError('One workplane per room per study.');refs.add(k);}}
        if(!missing(w.heightM))num(w.heightM,'heightM',0);
        if(!missing(w.spacingM))positive(w.spacingM,'spacingM');
      }
    }
    if(!missing(value.sky)){
      keys(value.sky,['enabled','radialBands','azimuthSectors'],'sky');
      if(!missing(value.sky.enabled)&&typeof value.sky.enabled!=='boolean')throw new TypeError('sky.enabled must be boolean.');
      if(!missing(value.sky.radialBands))integer(value.sky.radialBands,'radialBands',1,128);
      if(!missing(value.sky.azimuthSectors)){integer(value.sky.azimuthSectors,'azimuthSectors',4,512);if(value.sky.azimuthSectors%4)throw new RangeError('azimuthSectors must be divisible by four.');}
    }
    if(!missing(value.windowOptics)){
      keys(value.windowOptics,['mode','visibleTransmittance','source'],'windowOptics');
      if(!missing(value.windowOptics.mode)&&!['ideal-clear','visible-transmission'].includes(value.windowOptics.mode))throw new RangeError('Unsupported window optics mode.');
      if(!missing(value.windowOptics.visibleTransmittance))num(value.windowOptics.visibleTransmittance,'visibleTransmittance',0,1);
      if(value.windowOptics.mode==='ideal-clear'&&!missing(value.windowOptics.visibleTransmittance))throw new TypeError('Ideal-clear mode cannot also specify visible transmission.');
      if(!missing(value.windowOptics.source))text(value.windowOptics.source,'windowOptics.source');
    }
    if(!missing(value.neighbors)){
      keys(value.neighbors,SIDES,'neighbors');
      for(const side of SIDES)if(!missing(value.neighbors[side])){
        const n=value.neighbors[side];keys(n,['state','boxIds'],'neighbors.'+side);
        if(!missing(n.state)&&!['unknown','clear','modeled'].includes(n.state))throw new RangeError('Unknown neighbor state.');
        if(!missing(n.boxIds)){array(n.boxIds,'boxIds',LIMITS.entities);n.boxIds.forEach(id=>text(id,'boxId'));if(new Set(n.boxIds).size!==n.boxIds.length)throw new RangeError('Duplicate neighbor box ref.');}
        if(n.state!=='modeled'&&n.boxIds?.length)throw new RangeError('Only modeled neighbors reference boxes.');
      }
    }
    if(!missing(value.neighborBoxes)){
      array(value.neighborBoxes,'neighborBoxes',LIMITS.entities);const ids=new Set();
      for(const b of value.neighborBoxes){
        keys(b,['id','x','y','w','h','baseM','heightM','transmittance'],'neighbor box');
        if(!missing(b.id)){text(b.id,'box.id');if(ids.has(b.id))throw new RangeError('Duplicate neighbor box ID.');ids.add(b.id);}
        for(const k of ['x','y','baseM'])if(!missing(b[k]))num(b[k],'box.'+k);
        for(const k of ['w','h','heightM'])if(!missing(b[k]))positive(b[k],'box.'+k);
        if(!missing(b.transmittance))num(b.transmittance,'box.transmittance',0,1);
      }
    }
    if(!missing(value.roofContext)){
      array(value.roofContext,'roofContext',LIMITS.floors);const ids=new Set();
      for(const r of value.roofContext){
        keys(r,['floorId','state','source'],'roofContext item');
        if(!missing(r.floorId)){text(r.floorId,'roofContext.floorId');if(ids.has(r.floorId))throw new RangeError('Duplicate roof context.');ids.add(r.floorId);}
        if(!missing(r.state)&&!['none','unknown','supplied'].includes(r.state))throw new RangeError('Unsupported roof context state.');
        if(!missing(r.source))text(r.source,'roofContext.source');
      }
    }
    if(!missing(value.site)){
      keys(value.site,['latitudeDeg','longitudeDeg','timeZone'],'site');
      if(!missing(value.site.latitudeDeg))num(value.site.latitudeDeg,'latitudeDeg',-90,90);
      if(!missing(value.site.longitudeDeg))num(value.site.longitudeDeg,'longitudeDeg',-180,180);
      if(!missing(value.site.timeZone)){
        text(value.site.timeZone,'site.timeZone');
        try{new Intl.DateTimeFormat('en',{timeZone:value.site.timeZone});}catch{throw new RangeError('Unknown IANA time zone.');}
      }
    }
    if(!missing(value.period)){
      keys(value.period,['startUTC','endUTC'],'period');
      for(const k of ['startUTC','endUTC'])if(!missing(value.period[k]))utc(value.period[k],'period.'+k);
      if(value.period.startUTC&&value.period.endUTC&&utc(value.period.endUTC,'end')<=utc(value.period.startUTC,'start'))throw new RangeError('Period must have positive duration.');
    }
    if(!missing(value.samples)){
      array(value.samples,'samples',LIMITS.intervals);let previous=null;
      for(const s of value.samples){
        keys(s,['startUTC','endUTC','sampleUTC','sunENU','sunAnglesDeg'],'sample');
        for(const k of ['startUTC','endUTC','sampleUTC'])if(!missing(s[k]))utc(s[k],'sample.'+k);
        if(!missing(s.sunENU)&&!missing(s.sunAnglesDeg))throw new TypeError('Supply one sun representation.');
        sunVector(s);
        if(s.startUTC&&s.endUTC){
          const start=utc(s.startUTC,'start'),end=utc(s.endUTC,'end');
          if(end<=start||previous!==null&&start<previous)throw new RangeError('Intervals must be positive, chronological and non-overlapping.');
          if(s.sampleUTC&&utc(s.sampleUTC,'sampleUTC')!==(start+end)/2)throw new RangeError('sampleUTC must be the exact interval midpoint.');
          if(value.period?.startUTC&&start<utc(value.period.startUTC,'period.startUTC')||
            value.period?.endUTC&&end>utc(value.period.endUTC,'period.endUTC'))throw new RangeError('Interval is outside the period.');
          previous=end;
        }
      }
    }
    return freeze(copy(value));
  }
  const pick=(v,fields)=>Object.fromEntries(fields.map(k=>[k,missing(v[k])?null:copy(v[k])]));
  function discover(scene){
    json(scene);object(scene,'scene');
    if(scene.kind!=='DrawingScene'||scene.version!==1)throw new TypeError('Use the version 1 shared DrawingScene.');
    text(scene.projectId,'projectId');integer(scene.revision,'revision',0,Number.MAX_SAFE_INTEGER);
    array(scene.scenes,'scenes',LIMITS.floors);
    const findings=[],rooms=[],walls=[],openings=[],electrical=[],physical=[],floors=[],floorIds=new Set();
    const issue=(code,reference,message,severity='warning')=>findings.push({code,reference,message,severity});
    if(!scene.scenes.length)issue('missing-physical-floors',null,'No registered physical floors are available.','blocking');
    for(const d of scene.diagnostics||[])if(['missing-geometry','invalid-geometry','missing-plot','inconsistent-site-frame'].includes(d.code))
      issue('unresolved-physical-floor',null,'Repair all projected floors before a full-model study.','blocking');
    let count=0;
    for(const f of scene.scenes){
      text(f.floorId,'floorId');if(floorIds.has(f.floorId))throw new RangeError('Duplicate floor ID.');floorIds.add(f.floorId);
      if(f.coordinateSpace!=='site-local')throw new TypeError('Use projected site-local scenes; no recentering or stacking is performed.');
      for(const k of ['rooms','walls','openings','obstacles']){array(f[k],'floor.'+k,LIMITS.entities);count+=f[k].length;}
      if(count>LIMITS.entities)throw new RangeError('Physical inventory budget exceeded.');
      for(const k of ['floorElevationM','headingDeg'])if(!missing(f[k]))num(f[k],k);else issue('missing-'+k,{floorId:f.floorId},'Resolve physical floor coordinates.','blocking');
      for(const k of ['plot','floor','building']){
        if(missing(f[k]))issue('missing-'+k,{floorId:f.floorId},'Resolve the physical frame.','blocking');
        else {object(f[k],k);for(const a of ['x','y'])num(f[k][a],k+'.'+a);for(const a of ['w','h'])positive(f[k][a],k+'.'+a);}
      }
      if(!missing(f.wallHeightM))positive(f.wallHeightM,'wallHeightM');
      if(!missing(f.roofThicknessM))num(f.roofThicknessM,'roofThicknessM',0);
      if(missing(f.wallHeightM)||missing(f.roofThicknessM))issue('unsupplied-roof',{floorId:f.floorId},
        'No ceiling or roof is invented. A missing slab is unknown context, not a known clear roof.');
      floors.push(pick(f,['floorId','floorElevationM','headingDeg','wallHeightM','roofThicknessM','plot','sourcePlotOrigin']));
      const roomIds=new Set(),wallIds=new Set(f.walls.map(w=>w.id));
      for(const r of f.rooms){
        text(r.id,'room.id');if(roomIds.has(r.id))throw new RangeError('Duplicate room ID.');roomIds.add(r.id);
        const ref={floorId:f.floorId,entityId:r.id};let geometry=null;
        if(!missing(r.rect)){
          object(r.rect,'room.rect');for(const k of ['x','y'])num(r.rect[k],'room.rect.'+k);
          for(const k of ['w','h'])positive(r.rect[k],'room.rect.'+k);
          const {x,y,w,h}=r.rect;
          num(x+w,'room extent');num(y+h,'room extent');
          let usableRegions=[copy(r.rect)];
          if(own(r,'usableRegions')){
            if(!Regions?.area||!Regions?.subtractRectangle)throw new TypeError('Load planner-regions.js to validate supplied usable floor regions.');
            array(r.usableRegions,'room.usableRegions',LIMITS.sensors);
            Regions.area(r.usableRegions);
            if(r.usableRegions.some(region=>Regions.subtractRectangle(region,[r.rect]).length))
              throw new RangeError('Supplied usable floor regions extend outside the room bounding rectangle.');
            usableRegions=copy(r.usableRegions);
          }else if(r.reservedAreaM2>0)throw new TypeError('Reserved room area requires its supplied usableRegions; no bounding rectangle is substituted.');
          geometry={rect:copy(r.rect),usableRegions,polygon:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],coordinateSpace:'site-local'};
        }else issue('missing-carpet-geometry',ref,'A supported rectangular carpet is required.','blocking');
        if(!missing(r.polygon)&&!own(r,'usableRegions'))issue('unsupported-room-polygon',ref,'This projection contract requires supplied rectangular usable regions; do not substitute a polygon bounding box.','blocking');
        rooms.push({ref,label:r.label??r.id,geometry,usableAreaM2:geometry?.usableRegions.reduce((sum,region)=>sum+region.w*region.h,0)??null,
          supportedHeightM:f.wallHeightM??null,
          heightMeaning:'Compiled owner-floor wall extent, not inferred room clear height or a ceiling.'});
      }
      for(const w of f.walls){
        for(const k of ['id','start','end','baseM','heightM','thicknessM','removed','exterior'])
          if(missing(w[k]))issue('missing-wall-'+k,{floorId:f.floorId,entityId:w.id??null},'Repair physical wall inputs.','blocking');
        for(const k of ['start','end'])if(!missing(w[k])){object(w[k],k);num(w[k].x,k+'.x');num(w[k].y,k+'.y');}
        for(const k of ['heightM','thicknessM'])if(!missing(w[k]))positive(w[k],k);
        if(!missing(w.baseM))num(w.baseM,'baseM');
        for(const k of ['removed','exterior'])if(!missing(w[k])&&typeof w[k]!=='boolean')throw new TypeError(k+' must be boolean.');
        walls.push({ref:{floorId:f.floorId,entityId:w.id??null},...pick(w,['start','end','thicknessM','removed'])});
      }
      for(const o of f.openings){
        const ref={floorId:f.floorId,entityId:o.id??null};
        for(const k of ['id','wallId','kind','offsetM','widthM','sillM','heightM','openFraction'])
          if(missing(o[k]))issue('missing-opening-'+k,ref,'Repair physical aperture inputs.','blocking');
        if(!wallIds.has(o.wallId))issue('missing-opening-host',ref,'Repair the exact wall reference.','blocking');
        for(const k of ['offsetM','sillM'])if(!missing(o[k]))num(o[k],k,0);
        for(const k of ['widthM','heightM'])if(!missing(o[k]))positive(o[k],k);
        if(!missing(o.openFraction))num(o.openFraction,'openFraction',0,1);
        if(!missing(o.kind)&&!['window','hinged','sliding','passage'].includes(o.kind))throw new RangeError('Unsupported opening kind.');
        const wall=f.walls.find(w=>w.id===o.wallId);let geometry=null;
        if(wall&&[wall.start?.x,wall.start?.y,wall.end?.x,wall.end?.y,o.offsetM,o.widthM].every(Number.isFinite)){
          const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y,length=Math.hypot(dx,dy);
          if(length>0&&o.widthM>0)geometry={
            start:{x:wall.start.x+dx*o.offsetM/length,y:wall.start.y+dy*o.offsetM/length},
            end:{x:wall.start.x+dx*(o.offsetM+o.widthM)/length,y:wall.start.y+dy*(o.offsetM+o.widthM)/length},
            wallThicknessM:wall.thicknessM??null};
        }
        openings.push({ref,geometry,...pick(o,['wallId','kind','openFraction','offsetM','widthM','sillM','heightM'])});
      }
      for(const o of f.obstacles){
        for(const k of ['id','type','x','y','w','h','baseM','heightM','transmittance'])
          if(missing(o[k]))issue('missing-obstacle-'+k,{floorId:f.floorId,entityId:o.id??null},'Repair physical box inputs.','blocking');
        for(const k of ['x','y','baseM'])if(!missing(o[k]))num(o[k],k);
        for(const k of ['w','h','heightM'])if(!missing(o[k]))positive(o[k],k);
        if(!missing(o.transmittance))num(o.transmittance,'transmittance',0,1);
        if(!missing(o.type)&&!['building','tree'].includes(o.type))throw new RangeError('Unsupported physical obstacle type.');
      }
      if(f.unresolvedOpenings?.length)issue('unresolved-openings',{floorId:f.floorId},'Unresolved aperture proposals require review.','blocking');
      for(const d of f.diagnostics||[])if(d.severity==='error')issue('physical-diagnostic',{floorId:f.floorId},d.message||'Resolve physical scene errors.','blocking');
      for(const e of f.electrical||[]){
        let point=null;
        const supplied=Object.hasOwn(e,'positionStatus')
          ?e.positionStatus==='supplied-site-local'?e.resolvedPoint:null:!e.anchor?e.point:null;
        if(e.coordinateSpace==='site-local'&&supplied&&['x','y'].every(k=>Number.isFinite(supplied[k])))
          point={x:supplied.x,y:supplied.y,z:Number.isFinite(supplied.z)?supplied.z:null};
        for(const diagnostic of e.positionDiagnostics||[])issue(diagnostic.code,
          {floorId:f.floorId,entityId:e.id},diagnostic.message);
        electrical.push({floorId:f.floorId,record:copy(e),point,positionStatus:point?'supplied-site-local':'unprojected-intent',
          photometryStatus:'not-calculated',heightM:e.elevationM??null});
      }
      physical.push({...pick(f,['floorId','coordinateSpace','floorElevationM','headingDeg','wallHeightM','roofThicknessM','floor','plot','building']),
        rooms:f.rooms.map(r=>pick(r,['id','rect','polygon','usableRegions','reservedAreaM2','reservationFootprint'])),
        walls:f.walls.map(w=>pick(w,['id','start','end','baseM','heightM','thicknessM','removed','exterior','solidSections'])),
        openings:f.openings.map(o=>pick(o,['id','wallId','kind','offsetM','widthM','sillM','heightM','openFraction'])),
        obstacles:f.obstacles.map(o=>pick(o,['id','sourceId','type','x','y','w','h','baseM','heightM','transmittance'])),
        electrical:f.electrical??[],unresolvedOpenings:f.unresolvedOpenings??[],diagnostics:f.diagnostics??[]});
    }
    return freeze({version:VERSION,projectId:scene.projectId,revision:scene.revision,
      sourceFingerprint:scene.inputFingerprint??null,physicalFingerprint:fingerprint(physical),floors,rooms,walls,openings,electrical,findings});
  }
  function createStudy(scene,value,options={}){
    keys(options,['expectedPhysicalFingerprint'],'options');json(options);
    if(!missing(options.expectedPhysicalFingerprint))text(options.expectedPhysicalFingerprint,'expectedPhysicalFingerprint');
    const config=normalizeConfig(value),inventory=discover(scene),findings=copy(inventory.findings),sensors=[];
    const directEnabled=config.direct?.enabled!==false;
    const issue=(code,message,reference=null,severity='blocking')=>findings.push({code,message,reference,severity});
    const required=(v,fields,p)=>{for(const k of fields)if(missing(v?.[k]))issue('missing-control',p+'.'+k+' is required.');};
    required(config,['version','workplanes','sky','windowOptics','neighbors','neighborBoxes','samples'],'config');
    if(directEnabled)required(config,['period','minSunAltitudeDeg'],'config');
    required(config.sky,['enabled'],'sky');if(config.sky?.enabled)required(config.sky,['radialBands','azimuthSectors'],'sky');
    required(config.windowOptics,['mode'],'windowOptics');
    if(config.windowOptics?.mode==='visible-transmission')required(config.windowOptics,['visibleTransmittance','source'],'windowOptics');
    if(directEnabled)required(config.period,['startUTC','endUTC'],'period');
    if(config.workplanes&&!config.workplanes.length)issue('missing-workplanes','Select at least one exact room.');
    if(options.expectedPhysicalFingerprint&&options.expectedPhysicalFingerprint!==inventory.physicalFingerprint)issue('stale-physical-input','The actual physical content has changed.');
    const knownNeighbors=SIDES.every(side=>['clear','modeled'].includes(config.neighbors?.[side]?.state));
    if(!knownNeighbors)issue('unknown-neighbors','Missing/unknown sides are not known clear; only supplied-model estimates can be shown.',null,'warning');
    const boxes=config.neighborBoxes||[],boxIds=new Set(boxes.map(b=>b.id));
    for(const b of boxes)required(b,['id','x','y','w','h','baseM','heightM','transmittance'],'neighborBox');
    const usedBoxes=new Set();
    for(const side of SIDES){
      const n=config.neighbors?.[side];
      if(n?.state==='modeled'){
        if(!n.boxIds?.length)issue('missing-neighbor-box','Modeled neighbor '+side+' needs supplied physical boxes.');
        for(const id of n.boxIds||[]){usedBoxes.add(id);if(!boxIds.has(id))issue('missing-neighbor-box','Unknown box '+id+'.');}
      }
    }
    for(const b of boxes)if(!usedBoxes.has(b.id))issue('unreferenced-neighbor-box','Assign box '+b.id+' to its known side(s), never silently ignore it.');
    // Index exact extents separately from material and opaque identity aliases.
    // Near or overlapping boxes are not evidence of a duplicate physical object.
    const identities=new Map(),extents=new Map(),newBoxes=[];
    const extent=b=>canonical(pick(b,['x','y','w','h','baseM','heightM']));
    const signature=b=>canonical([extent(b),b.type??'building',b.transmittance??null]);
    function register(b){
      const physicalId=b.sourceId??b.id,geometry=extent(b),material=signature(b);
      for(const id of new Set([b.id,b.sourceId].filter(id=>!missing(id)))){
        if(!identities.has(id))identities.set(id,{signatures:new Set(),physicalIds:new Set()});
        const entry=identities.get(id);
        entry.signatures.add(material);entry.physicalIds.add(physicalId);
      }
      if(!extents.has(geometry))extents.set(geometry,new Set());
      const owners=extents.get(geometry);
      if(owners.size&&!owners.has(physicalId))issue('ambiguous-physical-obstacle',
        'Identical box extents have different identities. Review '+b.id+' and confirm one physical identity or correct the extents before running.');
      owners.add(physicalId);
    }
    for(const floor of scene.scenes)for(const b of floor.obstacles)register(b);
    for(const b of boxes){
      const existing=identities.get(b.id),geometry=extent(b);
      if(existing){
        if(existing.signatures.size!==1||!existing.signatures.has(signature(b))||existing.physicalIds.size!==1){
          issue('conflicting-physical-obstacle','Box '+b.id+' shares an obstacle identity but differs in extent, type or transmittance. Review the source; no copy was selected.');
        }else if(extents.get(geometry)?.size!==1||
          !extents.get(geometry).has(existing.physicalIds.values().next().value)){
          issue('ambiguous-physical-obstacle','Review coincident obstacles for '+b.id+'; an identity match cannot resolve other differently identified boxes.');
        }else{
          issue('reused-project-obstacle','Box '+b.id+' exactly reuses the identified project obstacle; attenuation is applied once. Supplied side context and configuration are retained.',null,'info');
        }
      }else{
        register({...b,type:'building'});
        newBoxes.push(b);
      }
    }
    const declaredNoRoof=new Set();
    for(const r of config.roofContext||[]){
      required(r,['floorId','state','source'],'roofContext');
      const floor=scene.scenes.find(f=>f.floorId===r.floorId);
      if(!floor){issue('missing-roof-floor','Roof context must reference an actual floor.');continue;}
      const supplied=!missing(floor.wallHeightM)&&!missing(floor.roofThicknessM);
      if(r.state==='none'){
        if(supplied)issue('roof-context-conflict','Cannot remove a supplied slab using an absence assumption.');
        else declaredNoRoof.add(r.floorId);
      }else if(r.state==='supplied'&&!supplied)issue('missing-roof-geometry','The claimed slab geometry is unavailable.');
    }
    for(const f of findings)if(f.code==='unsupplied-roof'&&declaredNoRoof.has(f.reference.floorId)){
      f.code='explicit-no-roof-assumption';
      f.message='Explicit supplied no-roof/no-ceiling assumption; absence was not inferred from missing geometry.';
    }
    const overlaps=(a,b)=>a&&b&&a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
    for(const lower of scene.scenes){
      if(missing(lower.wallHeightM)||missing(lower.roofThicknessM))continue;
      const higher=scene.scenes.filter(f=>f.floorElevationM>lower.floorElevationM&&overlaps(f.building,lower.building))
        .sort((a,b)=>a.floorElevationM-b.floorElevationM)[0];
      if(higher&&higher.floorElevationM>lower.floorElevationM+lower.wallHeightM+lower.roofThicknessM+1e-7)
        issue('unmodeled-interstorey-gap','A vertical gap between supplied floor bands has no inferred connecting geometry; supplied-model rays are not proof that it is physically clear.',
          {floorId:lower.floorId,upperFloorId:higher.floorId},'warning');
    }
    const roomMap=new Map(inventory.rooms.map(r=>[refKey(r.ref),r]));
    const floorMap=new Map(scene.scenes.map(f=>[f.floorId,f]));
    for(const w of config.workplanes||[]){
      required(w,['id','room','heightM','spacingM'],'workplane');required(w.room,['floorId','entityId'],'workplane.room');
      const room=w.room&&roomMap.get(refKey(w.room));
      if(!room){issue('missing-room-reference','Resolve the exact floor and room ID.',w.room??null);continue;}
      if(!room.geometry||missing(w.heightM)||missing(w.spacingM)||missing(w.id))continue;
      if(room.supportedHeightM!==null&&w.heightM>=room.supportedHeightM){
        issue('workplane-outside-supported-height','Workplane must be below the compiled owner-floor wall extent.',w.room);continue;
      }
      if(room.supportedHeightM===null)issue('unknown-workplane-height-extent',
        'The rectangle locates the room only in plan. Workplane height is user intent, not a validated physical room plane.',w.room,'warning');
      const f=floorMap.get(w.room.floorId);if(missing(f.floorElevationM)||missing(f.headingDeg))continue;
      const r=room.geometry.rect,regions=room.geometry.usableRegions||[r],nx=Math.ceil(r.w/w.spacingM),ny=Math.ceil(r.h/w.spacingM);
      if(!regions.length){issue('empty-usable-workplane','No usable floor remains in this room. Choose another room or review its reservations in Design.',w.room);continue;}
      if(!Number.isSafeInteger(nx*ny)||nx*ny>LIMITS.sensors)throw new RangeError('Sensor budget exceeded for the numerical grid; increase spacing. No truncation.');
      for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
        const base={x:r.x+r.w*x/nx,y:r.y+r.h*y/ny,w:r.w/nx,h:r.h/ny};
        const fragments=regions.map(region=>{
          if(Regions?.intersection)return Regions.intersection(base,region);
          const left=Math.max(base.x,region.x),top=Math.max(base.y,region.y);
          const right=Math.min(base.x+base.w,region.x+region.w),bottom=Math.min(base.y+base.h,region.y+region.h);
          return right>left&&bottom>top?{x:left,y:top,w:right-left,h:bottom-top}:null;
        }).filter(Boolean);
        for(let fragment=0;fragment<fragments.length;fragment++){
          if(sensors.length>=LIMITS.sensors)throw new RangeError('Clipped sensor budget exceeded; increase numerical spacing. No truncation.');
          const cell=fragments[fragment],point={x:cell.x+cell.w/2,y:cell.y+cell.h/2,z:f.floorElevationM+w.heightM};
          for(const k of ['x','y','z'])num(point[k],'sensor.'+k);
          if(!(point.x>cell.x&&point.x<cell.x+cell.w&&point.y>cell.y&&point.y<cell.y+cell.h))throw new RangeError('Sensor grid cannot be represented inside usable carpet at this numerical scale.');
          sensors.push({id:JSON.stringify(fragment?[w.id,x,y,fragment]:[w.id,x,y]),workplaneId:w.id,room:copy(w.room),point,cell,
            world:Projection.siteToWorld(point,f.headingDeg,scene.siteDatum?.elevationM??null),
            areaWeightM2:positive(cell.w*cell.h,'sensor cell area'),grid:{column:x,row:y,columns:nx,rows:ny}});
        }
      }
    }
    const samples=[];
    for(const s of config.samples||[]){
      required(s,['startUTC','endUTC','sampleUTC'],'sample');const vector=sunVector(s);
      if(!vector)issue('missing-sun-vector','Supply a unit ENU vector or known degree angles from HomeSun.');
      if(s.startUTC&&s.endUTC&&s.sampleUTC&&vector){
        const altitude=Math.asin(Math.max(-1,Math.min(1,vector.up)))/RAD;
        samples.push({...copy(s),sunENU:vector,durationHours:(utc(s.endUTC,'end')-utc(s.startUTC,'start'))/3600000,
          directSunStatus:vector.up<=0?'night':altitude<=config.minSunAltitudeDeg?'near-horizon-unresolved':'sun-above-horizon'});
      }
    }
    const blocked=findings.some(f=>f.severity==='blocking');
    const model=copy(scene.scenes);
    let kernel=null;
    if(!blocked){
      // Neighbor geometry uses the same site frame; no side screen or guessed gap.
      model[0].obstacles.push(...newBoxes.map(b=>({...copy(b),id:JSON.stringify(['light-neighbor',b.id]),type:'building'})));
      kernel=Physics.createReceiverKernel(model,{windowTransmittance:config.windowOptics.mode==='ideal-clear'?1:config.windowOptics.visibleTransmittance});
    }
    const directionCount=config.sky?.enabled?(config.sky.radialBands||0)*(config.sky.azimuthSectors||0):0;
    const skyRays=directionCount*sensors.length,directRays=samples.filter(s=>s.directSunStatus==='sun-above-horizon').length*sensors.length;
    const totalRays=skyRays+directRays,comparisons=totalRays*(kernel?.metadata.casterCount||0);
    if(skyRays>LIMITS.hemisphereRays||totalRays>LIMITS.totalRays||comparisons>LIMITS.rayComparisons||
      sensors.length*samples.length>LIMITS.maskEntries)throw new RangeError('Study ray/comparison/mask budget exceeded before execution; no truncation.');
    const physicalFingerprint=fingerprint({scene:inventory.physicalFingerprint,neighborBoxes:boxes});
    const sensorFingerprint=fingerprint(sensors);
    const provenance={engineId:'HomePlannerLight',engineVersion:VERSION,projectId:inventory.projectId,revision:inventory.revision,
      sourceFingerprint:inventory.sourceFingerprint,physicalFingerprint,scenePhysicalFingerprint:inventory.physicalFingerprint,
      sensorFingerprint,inputFingerprint:fingerprint({physicalFingerprint,sensorFingerprint,config})};
    const contextKnown=!blocked&&knownNeighbors&&!findings.some(f=>f.code==='unsupplied-roof'&&!declaredNoRoof.has(f.reference.floorId)||
      ['unknown-workplane-height-extent','unmodeled-interstorey-gap'].includes(f.code))&&!(config.roofContext||[]).some(r=>r.state==='unknown');
    const baseBudget=json({config,inventory,provenance,findings,sensors,
      context:{neighbors:config.neighbors??null,windowOptics:config.windowOptics??null,roofContext:config.roofContext??[]}});
    const maskEntries=sensors.length*samples.length;
    const outputNodeUpperBound=baseBudget.nodes+sensors.length*60+maskEntries*8+samples.length*40+1024;
    const outputCharacterUpperBound=baseBudget.characters+sensors.reduce((sum,s)=>sum+s.id.length*2,0)+
      sensors.length*1024+maskEntries*64+samples.length*1024+16384;
    if(outputNodeUpperBound>LIMITS.jsonNodes||outputCharacterUpperBound>LIMITS.jsonCharacters)
      throw new RangeError('Study snapshot JSON budget exceeded before rays; reduce sampling or interval count. No truncation.');
    const skySums=sensors.map(()=>0),presence=sensors.map(()=>0),equivalent=sensors.map(()=>0);
    const masks=[],pending=[];
    let skyCursor=0,sampleIndex=0,sensorIndex=0,processedRays=0,processedHours=0,knownHours=0,nearHours=0;
    let cancelled=false,finalized=false;
    const periodHours=config.period?.startUTC&&config.period?.endUTC?(utc(config.period.endUTC,'end')-utc(config.period.startUTC,'start'))/3600000:null;
    const computationalComplete=()=>!blocked&&skyCursor===skyRays&&sampleIndex===samples.length;
    function step(maxRays=4096){
      integer(maxRays,'maxRays',1,LIMITS.batchRays);
      if(blocked||cancelled||finalized)return progress();
      let budget=maxRays;
      while(skyCursor<skyRays&&budget>0){
        const i=Math.floor(skyCursor/directionCount),d=skyCursor%directionCount;
        const u=(Math.floor(d/config.sky.azimuthSectors)+.5)/config.sky.radialBands;
        const phi=2*Math.PI*((d%config.sky.azimuthSectors)+.5)/config.sky.azimuthSectors;
        const local={x:Math.sqrt(u)*Math.cos(phi),y:Math.sqrt(u)*Math.sin(phi),z:Math.sqrt(1-u)};
        const world=Projection.siteToWorld(local,kernel.metadata.headingDeg);
        skySums[i]+=kernel.trace(sensors[i].point,{east:world.east,north:world.north,up:world.up})/directionCount;
        skyCursor++;processedRays++;budget--;
      }
      while(skyCursor===skyRays&&sampleIndex<samples.length&&budget>0){
        const sample=samples[sampleIndex],day=sample.directSunStatus==='sun-above-horizon',night=sample.directSunStatus==='night';
        while(sensorIndex<sensors.length&&budget>0){
          pending.push(day?kernel.trace(sensors[sensorIndex].point,sample.sunENU):night?0:null);
          sensorIndex++;budget--;if(day)processedRays++;
        }
        if(sensorIndex<sensors.length)break;
        const known=night||(day&&contextKnown);
        for(let i=0;i<sensors.length;i++)if(day){
          presence[i]+=(pending[i]>0?1:0)*sample.durationHours;
          equivalent[i]+=pending[i]*sample.durationHours;
        }
        processedHours+=sample.durationHours;if(known)knownHours+=sample.durationHours;
        if(!day&&!night)nearHours+=sample.durationHours;
        masks.push({sampleIndex,startUTC:sample.startUTC,endUTC:sample.endUTC,sampleUTC:sample.sampleUTC,
          durationHours:sample.durationHours,directSunStatus:sample.directSunStatus,
          status:known?'known':day?'modeled-context-only':'unresolved',
          directPathWeights:known?pending.slice():pending.map(()=>null),
          modeledDirectPathWeights:pending.slice(),
          positivePathPresence:known?pending.map(v=>v>0):pending.map(()=>null)});
        pending.length=0;sensorIndex=0;sampleIndex++;
      }
      return progress();
    }
    function progress(){return freeze({processedRays,totalRays,completedIntervals:sampleIndex,totalIntervals:samples.length,
      completedSkySensors:directionCount?Math.floor(skyCursor/directionCount):0,totalSensors:sensors.length,
      computationalComplete:computationalComplete(),cancelled,finalized,blocked});}
    function getResult(){
      const directComplete=directEnabled&&finalized&&!blocked&&!cancelled&&sampleIndex===samples.length&&
        periodHours!==null&&Math.abs(knownHours-periodHours)<1e-10;
      const complete=computationalComplete()&&contextKnown&&
        (directEnabled?directComplete:finalized&&!cancelled);
      const bounded=v=>Math.max(0,Math.min(1,v));
      const result={version:VERSION,kind:'RoomLightStudy',status:blocked?'blocked':cancelled?'cancelled':complete?'complete':finalized?'incomplete':'running',
        complete,computationalComplete:computationalComplete(),config,inventory,provenance,findings,progress:progress(),sensors,
        context:{status:contextKnown?'known-supplied-model':'unknown-context',neighbors:config.neighbors??null,
          windowOptics:config.windowOptics??null,roofContext:config.roofContext??[],
          unsuppliedRoofFloorIds:kernel?.metadata.omittedRoofFloorIds??[]},
        sampling:{method:'uniform midpoint cells in azimuth and sin-squared zenith',directionCount,skyRays,directRays,totalRays,
          rayComparisonUpperBound:comparisons,outputNodeUpperBound,outputCharacterUpperBound,
          kernel:kernel?.metadata??null,minSunAltitudeDeg:config.minSunAltitudeDeg??null,
          nearHorizonMeaning:'Positive altitude at/below cutoff is unresolved, not physical shade.',
          sensorMeaning:'Equal-area cell midpoints inside rectangular room carpet; spacing is numerical, not room size.'},
        sky:{status:blocked?'blocked':!config.sky?.enabled?'disabled':skyCursor<skyRays?'incomplete':contextKnown?'complete':'modeled-context-only',
          metric:'normalized-cosine-weighted-sky-access',units:'dimensionless-0-to-1',timeDependence:'geometry-only-not-day-night',
          sensorResults:sensors.map((s,i)=>{
            const done=!blocked&&directionCount>0&&skyCursor>=(i+1)*directionCount;
            const modeled=done?bounded(skySums[i]):null;
            return {sensorId:s.id,status:done?contextKnown?'known':'modeled-context-only':'unavailable',
              cosineWeightedSkyAccess:done&&contextKnown?modeled:null,modeledCosineWeightedSkyAccess:modeled};
          })},
        direct:{status:blocked?'blocked':!directEnabled?'disabled':directComplete?'complete':'incomplete',complete:directComplete,
          units:'hours',periodHours,processedIntervalHours:directEnabled?processedHours:null,knownIntervalHours:directEnabled?knownHours:null,
          unknownOrUnprocessedHours:periodHours===null?null:Math.max(0,periodHours-knownHours),nearHorizonUnresolvedHours:directEnabled?nearHours:null,
          masks,sensorResults:sensors.map((s,i)=>({sensorId:s.id,
            positivePathPresenceHours:directComplete?presence[i]:null,transmittedEquivalentSunHours:directComplete?equivalent[i]:null,
            knownProcessedPositivePathPresenceHours:!directEnabled?null:contextKnown?presence[i]:0,
            knownProcessedTransmittedEquivalentSunHours:!directEnabled?null:contextKnown?equivalent[i]:0,
            modeledProcessedPositivePathPresenceHours:directEnabled?presence[i]:null,
            modeledProcessedTransmittedEquivalentSunHours:directEnabled?equivalent[i]:null}))},
        limitations:['Uniform-sky geometric access only; not daylight factor, lux, irradiation, adequacy or artificial photometry.',
          'No interreflection, sky brightness/weather model, invented ceiling, connecting slab, parapet or gap geometry.',
          'Windows use the explicit study optics, never irradiance solar transmittance as visible transmission.',
          'Presence means positive modeled path transmission, not binary unobstructed solar disk duration.',
          'Physical inventory is schematic supplied geometry, not a survey; missing context remains unknown.']};
      json(result);
      return freeze(copy(result));
    }
    function finalize(){finalized=true;return getResult();}
    function cancel(){cancelled=true;finalized=true;return getResult();}
    return Object.freeze({step,getResult,finalize,cancel,progress});
  }
  function run(scene,config,options){
    const study=createStudy(scene,config,options);
    while(!study.progress().blocked&&!study.progress().computationalComplete)study.step();
    return study.finalize();
  }
  function compare(first,second){
    json(first);json(second);const reasons=[];
    for(const r of [first,second])if(r.kind!=='RoomLightStudy'||r.version!==VERSION)throw new TypeError('Compare version 1 RoomLightStudy snapshots.');
    if(!first.complete||!second.complete)reasons.push('incomplete-study');
    for(const field of ['projectId','physicalFingerprint','sensorFingerprint'])
      if(first.provenance[field]!==second.provenance[field])reasons.push('different-'+field);
    if(canonical(first.config.windowOptics)!==canonical(second.config.windowOptics))reasons.push('different-optical-definition');
    if(canonical(first.config.neighbors)!==canonical(second.config.neighbors))reasons.push('different-context-definition');
    if(first.config.sky?.enabled!==second.config.sky?.enabled)reasons.push('different-sky-metric-enablement');
    const directEnabled=first.config.direct?.enabled!==false,secondDirectEnabled=second.config.direct?.enabled!==false;
    if(directEnabled!==secondDirectEnabled)reasons.push('different-direct-metric-enablement');
    if(directEnabled||secondDirectEnabled){
      if(canonical(first.config.period)!==canonical(second.config.period))reasons.push('different-period');
      if(first.config.minSunAltitudeDeg!==second.config.minSunAltitudeDeg)reasons.push('different-horizon-cutoff');
    }
    const comparable=!reasons.length;
    return freeze({comparable,reasons,revisionMetadata:{first:first.provenance.revision,second:second.provenance.revision},
      deltas:comparable?first.sensors.map((s,i)=>({sensorId:s.id,
        positivePathPresenceHours:directEnabled?second.direct.sensorResults[i].positivePathPresenceHours-first.direct.sensorResults[i].positivePathPresenceHours:null,
        transmittedEquivalentSunHours:directEnabled?second.direct.sensorResults[i].transmittedEquivalentSunHours-first.direct.sensorResults[i].transmittedEquivalentSunHours:null,
        cosineWeightedSkyAccess:first.sky.status==='disabled'?null:
          second.sky.sensorResults[i].cosineWeightedSkyAccess-first.sky.sensorResults[i].cosineWeightedSkyAccess})):null});
  }
  return Object.freeze({VERSION,LIMITS,CONFIG_SCHEMA,normalizeConfig,discover,createStudy,run,compare});
});
