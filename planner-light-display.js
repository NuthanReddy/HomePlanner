(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerLightDisplay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION=1;
  const METRICS={
    direct:{label:'Direct daytime path transmission weight',units:'dimensionless-0-to-1'},
    'presence-hours':{label:'Positive-path-presence hours',units:'hours'},
    'equivalent-hours':{label:'Transmitted-equivalent sun hours',units:'hours'},
    sky:{label:'Normalized cosine-weighted sky access',units:'dimensionless-0-to-1'}
  };
  const INK='#263238',ZERO='#1539ba',OCHRE='#986919';
  const PALETTE=['#1539ba','#00b9ed','#37d342','#ffed37','#dc2419'];
  function heatColor(value,maximum){
    if(value===0||maximum===0)return ZERO;
    const t=Math.max(0,Math.min(1,value/maximum))*4,index=Math.min(3,Math.floor(t)),fraction=t-index;
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),a=rgb(PALETTE[index]),b=rgb(PALETTE[index+1]);
    return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*fraction).toString(16).padStart(2,'0')).join('');
  }
  const key=r=>JSON.stringify([r?.floorId,r?.entityId]);
  const number=v=>Number.isFinite(v)?v:null;
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'\ufffd')
    .replace(/[\ud800-\udfff]/gu,'\ufffd');
  const short=v=>String(v??'unknown').replace(/\s+/g,' ').slice(0,110);
  function fail(message){throw new RangeError(`Light display: ${message}; no truncation or guessed geometry.`);}
  function json(root,maxNodes=500000){
    let nodes=0,characters=0;
    const active=new Set();
    function visit(v,depth){
      if(++nodes>maxNodes||depth>64)fail('JSON traversal budget exceeded');
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='number'){if(!Number.isFinite(v))throw new TypeError('Finite JSON required.');return;}
      if(typeof v==='string'){characters+=v.length;if(characters>16000000)fail('JSON text budget exceeded');return;}
      if(!v||typeof v!=='object'||active.has(v))throw new TypeError('Acyclic finite JSON required.');
      active.add(v);
      if(Array.isArray(v)){
        if(v.length>500000)fail('Array budget exceeded');
        for(let i=0;i<v.length;i++)visit(v[i],depth+1);
      }else{
        if(Object.prototype.toString.call(v)!=='[object Object]'||Object.getOwnPropertySymbols(v).length)
          throw new TypeError('Plain JSON objects required.');
        for(const [k,child] of Object.entries(v)){visit(k,depth+1);visit(child,depth+1);}
      }
      active.delete(v);
    }
    visit(root,0);
  }
  function freeze(v,seen=new Set()){
    if(v&&typeof v==='object'&&!seen.has(v)){
      seen.add(v);Object.values(v).forEach(child=>freeze(child,seen));Object.freeze(v);
    }
    return v;
  }
  function array(v,name,max){
    if(!Array.isArray(v))throw new TypeError(`Missing ${name} array.`);
    if(v.length>max)fail(`${name} budget exceeded`);
    return v;
  }
  function coordinate(v){if(!Number.isFinite(v)||Math.abs(v)>1e9)fail('Coordinates must be finite within ±1e9 m');return v;}
  function rect(r){
    if(!r)throw new TypeError('Rectangle required.');
    ['x','y','w','h'].forEach(k=>coordinate(r[k]));
    if(!(r.w>0&&r.h>0))fail('Rectangle dimensions must be positive');
    coordinate(r.x+r.w);coordinate(r.y+r.h);
    return r;
  }
  function unique(records,id,name){
    const map=new Map();
    for(const r of records){
      const k=id(r);
      if(typeof k!=='string'||map.has(k))throw new TypeError(`Unique ${name} references required.`);
      map.set(k,r);
    }
    return map;
  }
  function checkInventory(i){
    if(!i||i.version!==1)throw new TypeError('Version 1 light inventory required.');
    const floors=unique(array(i.floors,'floors',64),f=>f.floorId,'floor');
    array(i.rooms,'rooms',32768);array(i.openings,'openings',32768);array(i.electrical,'electrical',32768);
    array(i.walls||[],'walls',32768);
    if(i.rooms.length+i.openings.length+i.electrical.length+(i.walls?.length||0)>32768)fail('Inventory entity budget exceeded');
    for(const f of i.floors)if(f.plot)rect(f.plot);
    const rooms=unique(i.rooms,r=>key(r.ref),'room');
    for(const r of i.rooms){
      if(!floors.has(r.ref?.floorId)||typeof r.ref?.entityId!=='string'||typeof r.label!=='string')
        throw new TypeError('Qualified room references and labels required.');
      if(r.geometry){
        if(r.geometry.coordinateSpace!=='site-local')throw new TypeError('Rooms must be site-local.');
        if(r.geometry.rect)rect(r.geometry.rect);
        if(r.geometry.usableRegions)array(r.geometry.usableRegions,'usable regions',4096).forEach(rect);
      }
    }
    return {floors,rooms};
  }
  function optionsFor(options,inventory,result){
    json(options);
    if(!options||Array.isArray(options)||Object.keys(options).some(k=>!['floorId','metric','intervalIndex','modeled','showElectrical'].includes(k)))
      throw new TypeError('Unknown light display option.');
    const o={floorId:inventory.floors[0]?.floorId??null,metric:'direct',intervalIndex:0,modeled:false,showElectrical:false,...options};
    if(o.floorId!==null&&(typeof o.floorId!=='string'||!inventory.floors.some(f=>f.floorId===o.floorId)))
      fail('Select a registered floorId');
    if(o.floorId===null&&inventory.floors.length)fail('Select a registered floorId');
    if(!Object.hasOwn(METRICS,o.metric)||typeof o.metric!=='string')throw new TypeError('Unsupported metric.');
    if(typeof o.modeled!=='boolean'||typeof o.showElectrical!=='boolean')throw new TypeError('Display toggles must be boolean.');
    if(!Number.isInteger(o.intervalIndex)||o.intervalIndex<0||o.intervalIndex>=2048)fail('Invalid intervalIndex');
    if(o.intervalIndex>0&&o.intervalIndex>=(result?.config?.samples?.length??0))fail('intervalIndex is outside supplied samples');
    return o;
  }
  function checkResult(r,rooms){
    array(r.sensors,'sensors',4096);array(r.direct?.masks,'direct masks',2048);
    array(r.direct?.sensorResults,'direct sensor results',4096);array(r.sky?.sensorResults,'sky sensor results',4096);
    unique(r.sensors,s=>s.id,'sensor');
    unique(r.direct.sensorResults,s=>s.sensorId,'direct sensor');
    unique(r.sky.sensorResults,s=>s.sensorId,'sky sensor');
    const indices=new Set();
    for(const m of r.direct.masks){
      if(!Number.isInteger(m.sampleIndex)||m.sampleIndex<0||m.sampleIndex>=2048||indices.has(m.sampleIndex))
        throw new TypeError('Unique committed sample indices required.');
      indices.add(m.sampleIndex);
      for(const field of ['directPathWeights','modeledDirectPathWeights','positivePathPresence']){
        array(m[field],field,4096);
        if(m[field].length!==r.sensors.length)throw new TypeError('Committed mask must cover every sensor.');
        if(m[field].some(v=>v!==null&&(field==='positivePathPresence'?typeof v!=='boolean':typeof v!=='number'||v<0||v>1)))
          throw new TypeError('Invalid direct mask values.');
      }
    }
    for(const s of r.sensors){
      ['x','y','z'].forEach(k=>coordinate(s.point?.[k]));
      const g=s.grid,room=rooms.get(key(s.room)),rr=room?.geometry?.rect;
      if(!rr||!g||!['rows','columns'].every(k=>Number.isInteger(g[k])&&g[k]>0&&g[k]<=4096)||
        !['row','column'].every(k=>Number.isInteger(g[k])&&g[k]>=0&&g[k]<g[k==='row'?'rows':'columns'])||g.rows*g.columns>4096)
        throw new TypeError('Sensor requires its matching inventory rectangle and grid.');
      const cell=s.cell?rect(s.cell):{x:rr.x+g.column*rr.w/g.columns,y:rr.y+g.row*rr.h/g.rows,w:rr.w/g.columns,h:rr.h/g.rows};
      const x=cell.x+cell.w/2,y=cell.y+cell.h/2;
      const tolerance=1e-7*Math.max(1,rr.w,rr.h);
      if(Math.abs(x-s.point.x)>tolerance||Math.abs(y-s.point.y)>tolerance)
        throw new TypeError('Sensor point does not match its inventory grid cell.');
      const base={x:rr.x+g.column*rr.w/g.columns,y:rr.y+g.row*rr.h/g.rows,w:rr.w/g.columns,h:rr.h/g.rows};
      const inside=(a,b)=>a.x>=b.x-tolerance&&a.y>=b.y-tolerance&&a.x+a.w<=b.x+b.w+tolerance&&a.y+a.h<=b.y+b.h+tolerance;
      if(!inside(cell,base)||!(room.geometry.usableRegions||[rr]).some(region=>inside(cell,region)))
        throw new TypeError('Sensor cell leaves its supplied usable floor region.');
      if(s.cell&&Math.abs(s.areaWeightM2-cell.w*cell.h)>tolerance)
        throw new TypeError('Clipped sensor area must match its exact cell.');
    }
  }
  function createView(result,options={}){
    if(result?.version!==1||result.kind!=='RoomLightStudy'||
      !['running','blocked','cancelled','incomplete','complete'].includes(result.status))
      throw new TypeError('Use a version 1 RoomLightStudy result.');
    return build(result.inventory,result,options);
  }
  function createInventoryView(inventory,options={}){return build(inventory,null,options);}
  function build(input,resultInput,options){
    json(resultInput??input);
    // Detach once; row geometry and provenance may safely share this private snapshot.
    const result=resultInput?JSON.parse(JSON.stringify(resultInput)):null;
    const inventory=result?.inventory??JSON.parse(JSON.stringify(input));
    const {rooms}=checkInventory(inventory),o=optionsFor(options,inventory,result);
    if(result)checkResult(result,rooms);
    const status=result?.status??'not-run',blocked=status==='blocked';
    const masks=result?.direct.masks??[],mask=masks.find(m=>m.sampleIndex===o.intervalIndex)??null;
    const sample=result?.config?.samples?.[o.intervalIndex]??null;
    const interval=mask?{sampleIndex:mask.sampleIndex,startUTC:mask.startUTC,endUTC:mask.endUTC,sampleUTC:mask.sampleUTC,
      directSunStatus:mask.directSunStatus,status:mask.status,committed:true}:
      {sampleIndex:o.intervalIndex,startUTC:sample?.startUTC??null,endUTC:sample?.endUTC??null,sampleUTC:sample?.sampleUTC??null,
        directSunStatus:'unprocessed',status:status==='not-run'?'not-run':'unprocessed',committed:false};
    const directById=new Map((result?.direct.sensorResults??[]).map(r=>[r.sensorId,r]));
    const skyById=new Map((result?.sky.sensorResults??[]).map(r=>[r.sensorId,r]));
    const provenance={projectId:inventory.projectId??null,revision:inventory.revision??null,
      engineId:result?.provenance?.engineId??null,engineVersion:result?.provenance?.engineVersion??null,
      coordinateSpace:'site-local',contextStatus:result?.context?.status??'not-run'};
    const primaryHours=!blocked&&result?.direct.complete===true;
    const sensorRows=(result?.sensors??[]).map((s,index)=>{
      const d=directById.get(s.id),sky=skyById.get(s.id),g=s.grid,rr=rooms.get(key(s.room)).geometry.rect;
      const primary={
        direct:!blocked&&mask?number(mask.directPathWeights[index]):null,
        'presence-hours':primaryHours?number(d?.positivePathPresenceHours):null,
        'equivalent-hours':primaryHours?number(d?.transmittedEquivalentSunHours):null,
        sky:!blocked?number(sky?.cosineWeightedSkyAccess):null
      };
      const modeled={
        direct:!blocked&&mask?number(mask.modeledDirectPathWeights[index]):null,
        'presence-hours':primaryHours?number(d?.modeledProcessedPositivePathPresenceHours):null,
        'equivalent-hours':primaryHours?number(d?.modeledProcessedTransmittedEquivalentSunHours):null,
        sky:!blocked?number(sky?.modeledCosineWeightedSkyAccess):null
      };
      const selectedValue=(o.modeled?modeled:primary)[o.metric];
      return {id:s.id,shortKey:`S${index+1}`,workplaneId:s.workplaneId,roomRef:s.room,floorId:s.room.floorId,
        inScope:s.room.floorId===o.floorId,point:s.point,world:s.world??null,grid:g,areaWeightM2:s.areaWeightM2,
        cell:{...(s.cell||{x:s.point.x-rr.w/g.columns/2,y:s.point.y-rr.h/g.rows/2,w:rr.w/g.columns,h:rr.h/g.rows}),z:s.point.z},
        provenance,primary,modeled,
        knownProcessedPositivePathPresenceHours:blocked?null:number(d?.knownProcessedPositivePathPresenceHours),
        knownProcessedTransmittedEquivalentSunHours:blocked?null:number(d?.knownProcessedTransmittedEquivalentSunHours),
        modeledProcessedPositivePathPresenceHours:blocked?null:number(d?.modeledProcessedPositivePathPresenceHours),
        modeledProcessedTransmittedEquivalentSunHours:blocked?null:number(d?.modeledProcessedTransmittedEquivalentSunHours),
        skyStatus:sky?.status??'unavailable',interval,numericalStatus:status,
        metric:o.metric,units:METRICS[o.metric].units,selectedValue,
        selectedStatus:selectedValue===null?'unknown':selectedValue===0?'known-zero':'finite',
        primaryStatus:Object.fromEntries(Object.entries(primary).map(([k,v])=>[k,v===null?'unknown':v===0?'known-zero':'finite'])),
        modeledStatus:Object.fromEntries(Object.entries(modeled).map(([k,v])=>[k,v===null?'unknown':v===0?'known-zero':'finite']))};
    });
    const byRoom=new Map();
    for(const s of sensorRows){const k=key(s.roomRef);if(!byRoom.has(k))byRoom.set(k,[]);byRoom.get(k).push(s);}
    const floorById=new Map(inventory.floors.map(f=>[f.floorId,f]));
    const roomRows=inventory.rooms.map((r,index)=>{
      const sensors=byRoom.get(key(r.ref))??[];
      function mean(column,metric){
        if(!sensors.length||sensors.some(s=>s[column][metric]===null||!(s.areaWeightM2>0)))return null;
        const area=sensors.reduce((sum,s)=>sum+s.areaWeightM2,0);
        return number(sensors.reduce((sum,s)=>sum+s[column][metric]*(s.areaWeightM2/area),0));
      }
      const primary=Object.fromEntries(Object.keys(METRICS).map(m=>[m,mean('primary',m)]));
      const modeled=Object.fromEntries(Object.keys(METRICS).map(m=>[m,mean('modeled',m)]));
      return {id:r.ref.entityId,shortKey:`R${index+1}`,roomRef:r.ref,floorId:r.ref.floorId,label:r.label,
        geometry:r.geometry??null,supportedHeightM:r.supportedHeightM??null,heightMeaning:r.heightMeaning??null,
        floor:floorById.get(r.ref.floorId),primary,modeled,aggregation:'Area-weighted workplane sensor mean; not room-total hours',
        inScope:r.ref.floorId===o.floorId,provenance,sensorIds:sensors.map(s=>s.id),sensorCount:sensors.length,
        finiteSensorCount:sensors.filter(s=>s.selectedValue!==null).length,
        unknownSensorCount:sensors.filter(s=>s.selectedValue===null).length,
        status:sensors.length?(sensors.every(s=>s.selectedValue!==null)?'finite-sensors':'unknown-sensors'):'not-sampled',
        metric:o.metric,units:METRICS[o.metric].units,numericalStatus:status};
    });
    const electricalRows=inventory.electrical.map((e,index)=>{
      const supplied=e.positionStatus==='supplied-site-local'&&e.record?.coordinateSpace==='site-local'&&e.point!==null;
      if(supplied){
        coordinate(e.point.x);coordinate(e.point.y);
        if(e.point.z!==null)coordinate(e.point.z);
      }
      return {...e,shortKey:`E${index+1}`,inScope:e.floorId===o.floorId,
        markerVisible:o.showElectrical&&e.floorId===o.floorId&&supplied,
        heightStatus:supplied&&e.point.z!==null?'supplied-z':'height-unknown',
        emissionStatus:'not-calculated'};
    });
    const warnings=[...(inventory.findings??[]),...(result?.findings??[])].map(f=>`${f.code}: ${f.message}`);
    if(!result)warnings.unshift('NOT RUN — pending controls; room geometry is not a light calculation.');
    if(result&&!result.complete)warnings.unshift(`${status.toUpperCase()} — whole-study evidence is incomplete; missing is not zero.`);
    if(o.metric==='direct'&&!mask)warnings.push('Selected interval is not committed; no future zero mask is inferred.');
    if(o.modeled)warnings.unshift('SUPPLIED MODEL ONLY / unknown context');
    if(electricalRows.length)warnings.push('Electrical intent only: no emission, photometry or adequacy. Unresolved anchors stay schedule-only; null z means height unknown.');
    if(!roomRows.some(r=>r.inScope&&r.geometry?.rect))warnings.push('No drawable room rectangles on the selected floor; review inventory findings and controls.');
    const finiteValues=sensorRows.filter(sensor=>sensor.selectedValue!==null).map(sensor=>sensor.selectedValue);
    const legend=[
      `${METRICS[o.metric].label} · ${METRICS[o.metric].units==='hours'?'hours':'0..1 (dimensionless)'}. Computed range: ${finiteValues.length?`0–${Number(Math.max(...finiteValues).toPrecision(7))}`:'unavailable'}. Not lux.`,
      o.modeled?'SUPPLIED MODEL ONLY / unknown context — modeled columns only.':'PRIMARY EVIDENCE — unknown context stays missing.',
      'Gray hatch + ? = unknown / unprocessed; blue = known zero; cyan / green / yellow / red = increasing actual values.',
      'Direct = path transmission, not irradiance. Presence hours count positive paths; equivalent hours sum transmitted weights.',
      'Sky access is geometry-only, independent of day/night; not daylight factor, illuminance or adequacy.',
      'Hours cells require direct.complete. Known/modelled processed subtotals are table evidence only, never full-period totals.',
      'Exact workplane cells clipped to supplied usable regions; R / S / E resolve to full table references. Reserved space is not sampled.',
      'Fixed common site-local origin across floors; display fit only, no source-origin subtraction or floor gaps.',
      'Electrical rings are supplied plan positions only; ? means height unknown. No electrical emission is calculated.'
    ];
    const svg=render(inventory,roomRows,sensorRows,electricalRows,o,status,interval,result,legend);
    const evidenceProvenance=result?.provenance??{projectId:inventory.projectId??null,revision:inventory.revision??null,
      sourceFingerprint:inventory.sourceFingerprint??null,physicalFingerprint:inventory.physicalFingerprint??null};
    const view={version:VERSION,svg,sensorRows,roomRows,electricalRows,provenance:evidenceProvenance,
      legend,warnings:[...new Set(warnings)],floorId:o.floorId};
    json(view,2000000);
    return freeze(view);
  }
  function render(inventory,rooms,sensors,electrical,o,status,interval,result,legend){
    let minX=0,minY=0,maxX=1,maxY=1;
    function extend(r){minX=Math.min(minX,r.x);minY=Math.min(minY,r.y);maxX=Math.max(maxX,r.x+r.w);maxY=Math.max(maxY,r.y+r.h);}
    for(const f of inventory.floors)if(f.plot)extend(f.plot);
    for(const r of rooms)if(r.geometry?.rect)extend(r.geometry.rect);
    for(const e of electrical)if(e.positionStatus==='supplied-site-local'&&e.record?.coordinateSpace==='site-local'&&e.point)
      extend({x:coordinate(e.point.x),y:coordinate(e.point.y),w:0,h:0});
    const scale=Math.min(810/(maxX-minX),595/(maxY-minY));
    const px=x=>35+(810-(maxX-minX)*scale)/2+(x-minX)*scale,py=y=>115+(y-minY)*scale;
    const n=v=>String(Number(v.toPrecision(12)));
    const text=(x,y,t,size=14,extra='')=>`<text x="${n(x)}" y="${n(y)}" font-size="${size}" ${extra}>${escape(t)}</text>`;
    const rectangle=(r,attrs)=>`<rect x="${n(px(r.x))}" y="${n(py(r.y))}" width="${n(r.w*scale)}" height="${n(r.h*scale)}" ${attrs}/>`;
    const hours=o.metric.endsWith('hours'),known=sensors.filter(sensor=>sensor.selectedValue!==null);
    const maximum=known.length?Math.max(...known.map(sensor=>sensor.selectedValue)):null;
    const fill=value=>value===null?'url(#light-unknown)':heatColor(value,maximum);
    const graphics=[];
    for(const r of rooms)if(r.inScope&&r.geometry?.rect){
      graphics.push(`<g data-room="${r.shortKey}"><title>${escape(r.label)}</title>`+
        (r.geometry.usableRegions||[r.geometry.rect]).map(region=>rectangle(region,'fill="#f1f3f5"')).join('')+'</g>');
      if(!inventory.walls?.length)graphics.push(rectangle(r.geometry.rect,'fill="none" stroke="#899097" stroke-width="1"'));
    }
    for(const s of sensors)if(s.inScope){
      graphics.push(`<g data-sensor="${s.shortKey}" data-value="${s.selectedValue===null?'unknown':s.selectedValue}" data-status="${s.selectedStatus}"><title>${escape(`${s.shortKey}: ${s.selectedValue===null?'unknown':s.selectedValue} ${s.units}; site x=${s.point.x}, y=${s.point.y}, z=${s.point.z}`)}</title>`+
        rectangle(s.cell,`data-site-x="${n(s.cell.x)}" data-site-y="${n(s.cell.y)}" fill="${fill(s.selectedValue)}"`)+
        (s.selectedValue===null&&s.cell.w*scale>14&&s.cell.h*scale>14?text(px(s.point.x),py(s.point.y)+4,'?',12,'text-anchor="middle"'):'')+'</g>');
    }
    const line=(a,b,width,color)=>`<line x1="${n(px(a.x))}" y1="${n(py(a.y))}" x2="${n(px(b.x))}" y2="${n(py(b.y))}" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="butt"/>`;
    for(const wall of inventory.walls||[])if(wall.ref.floorId===o.floorId&&!wall.removed&&wall.start&&wall.end&&Number.isFinite(wall.thicknessM))
      graphics.push(`<g data-wall="${escape(wall.ref.entityId)}">${line(wall.start,wall.end,wall.thicknessM*scale,INK)}</g>`);
    for(const opening of inventory.openings)if(opening.ref.floorId===o.floorId&&opening.geometry){
      const g=opening.geometry;
      graphics.push(`<g data-opening="${escape(opening.ref.entityId)}"><title>${escape(`${opening.kind}: ${opening.ref.entityId}`)}</title>`+
        line(g.start,g.end,Math.max(3,(g.wallThicknessM||0)*scale+1),'#fff')+
        line(g.start,g.end,opening.kind==='window'?2:1,opening.kind==='window'?'#31556b':INK)+'</g>');
    }
    for(const r of rooms)if(r.inScope&&r.geometry?.rect){
      const q=(r.geometry.usableRegions||[r.geometry.rect]).reduce((best,region)=>!best||region.w*region.h>best.w*best.h?region:best,null);
      if(!q)continue;
      graphics.push(`<g><title>${escape(`${r.shortKey}: ${short(r.label)}`)}</title>`+
        text(px(q.x+q.w/2),py(q.y+q.h/2),r.shortKey,14,'text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4" stroke-linejoin="round" font-weight="700"')+'</g>');
    }
    for(const e of electrical)if(e.markerVisible){
      graphics.push(`<g data-electrical="${e.shortKey}"><title>${escape(`${e.shortKey}: electrical intent; ${e.heightStatus==='height-unknown'?'height unknown':`z=${e.point.z} m`}; no emission`)}</title>`+
        `<circle cx="${n(px(e.point.x))}" cy="${n(py(e.point.y))}" r="5" fill="#fff" stroke="${OCHRE}" stroke-width="2"/>`+
        text(px(e.point.x)+7,py(e.point.y)-5,e.shortKey+(e.heightStatus==='height-unknown'?' ?':''),11)+'</g>');
    }
    const stamp=interval.sampleUTC;
    let caption=stamp?`Sample ${stamp} UTC`:'No selected timestamp / interval not supplied';
    const zone=result?.config?.site?.timeZone??inventory.config?.site?.timeZone;
    if(stamp&&zone){
      try{
        caption+=` · ${new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(stamp))} ${zone}`;
      }catch{caption+=' · local time unavailable';}
    }
    const sun=o.metric==='sky'?'Geometry-only sky; day/night does not alter these cells':`Sun: ${interval.directSunStatus} · ${interval.committed?'committed interval':'unprocessed / unknown'}`;
    const metricLabel=({direct:'Path transmission','presence-hours':'Presence hours','equivalent-hours':'Equivalent hours',sky:'Sky access'})[o.metric];
    const ticks=maximum===null?'':Array.from({length:maximum===0?1:6},(_,i)=>{
      const fraction=maximum===0?0:i/5,y=625-fraction*380;
      return `<path d="M925 ${n(y)}h8" stroke="${INK}"/>`+text(940,y+5,Number((fraction*maximum).toPrecision(4)),14);
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(`Room light evidence — ${status}`)}" viewBox="0 0 1040 820" width="1040" height="820" style="max-width:100%;height:auto;background:#fff" font-family="Arial, sans-serif" fill="${INK}">
<title>Room light evidence — ${escape(status)}</title>
<desc>${escape(legend.join(' '))}</desc>
<!-- THESIS: actual computed light access on the architectural plan, never invented lux. OWN-WORLD: white plan paper, dark physical walls and a reference-pinned spectral scale. STORY: read the cells, units and unknowns; inspect exact evidence below. FIRST VIEWPORT: the plan owns the frame, with a vertical numeric legend. FORM: a local extension of the existing study, not a visual rebrand. -->
<defs><pattern id="light-unknown" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#d8dde1"/><path d="M0 8L8 0" stroke="#808a92" stroke-width="1.5"/></pattern>
<linearGradient id="light-spectrum" x1="0" x2="0" y1="1" y2="0">${PALETTE.map((color,i)=>`<stop offset="${i/4}" stop-color="${color}"/>`).join('')}</linearGradient></defs>
<rect width="1040" height="820" fill="#fff"/>
${text(28,33,'Room light · '+metricLabel,24,'font-weight="700"')}
${text(28,58,o.modeled?'SUPPLIED MODEL ONLY / unknown context':`PRIMARY EVIDENCE · ${status.toUpperCase()} · NOT LUX`,15,'font-weight="700"')}
${text(28,81,short(caption),13)}
${text(28,101,sun,13)}
${graphics.join('\n')}
<circle cx="${n(px(0))}" cy="${n(py(0))}" r="3" fill="${INK}"><title>Fixed site-local origin (0, 0); no floor recentering</title></circle>
${rooms.some(r=>r.inScope&&r.geometry?.rect)?'':text(50,240,'No drawable room rectangles. Review inventory findings and pending controls.',16)}
${text(890,202,metricLabel,15,'font-weight="700"')}
${text(890,225,hours?'[h]':'[dimensionless]',13)}
<rect data-legend="light" x="895" y="245" width="30" height="380" fill="${maximum===null?'url(#light-unknown)':maximum===0?ZERO:'url(#light-spectrum)'}" stroke="${INK}" stroke-width="1"/>
${ticks}${text(888,655,maximum===null?'Unavailable':maximum===0?'Known zero':'Computed range',12)}
${text(888,675,'Not lux',12)}
${text(28,739,sensors.some(s=>s.inScope)?'Exact cell evidence clipped to usable floor; reserved lift/stair area is excluded.':'No sampled workplanes on this floor; geometry alone is not a light calculation.',14)}
${text(28,762,'Blue = known zero · spectral colors = increasing values · hatch / ? = unavailable · uncolored = not sampled',13)}
${text(28,785,'R / S / E refer to evidence tables. Sky access is not daylight factor or illuminance; no electrical emission is calculated.',12)}
${text(28,805,o.modeled?'Modeled processed subtotals stay in the tables, not full-period cell totals.':`Site-local frame · display fit only · ${status} · interval: ${interval.status} · no full-period subtotals substituted`,12)}
</svg>`;
  }
  function exportSVG(view){
    if(view?.version!==VERSION||typeof view.svg!=='string'||!Object.isFrozen(view))
      throw new TypeError('Pass a frozen light display view.');
    return view.svg;
  }
  return Object.freeze({VERSION,createView,createInventoryView,exportSVG});
});
