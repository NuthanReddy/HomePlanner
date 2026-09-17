(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerAirflowDisplay=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION=1,UNKNOWN='unknown',INK='#263238',BLUE='#246DA0',SIENNA='#795439';
  const SPECTRUM=['#1539ba','#00b9ed','#37d342','#ffed37','#dc2419'];
  function heatColor(value,maximum){
    if(value===0||maximum===0)return SPECTRUM[0];
    const t=Math.max(0,Math.min(1,value/maximum))*4,index=Math.min(3,Math.floor(t)),fraction=t-index;
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),a=rgb(SPECTRUM[index]),b=rgb(SPECTRUM[index+1]);
    return '#'+a.map((value,i)=>Math.round(value+(b[i]-value)*fraction).toString(16).padStart(2,'0')).join('');
  }
  const ACH='Direct outside inflow ACH; not complete fresh-air delivery or a mixing estimate';
  const LIMITS={floors:64,rooms:4096,openings:16384,zones:128,links:512};
  const copy=v=>JSON.parse(JSON.stringify(v));
  const refKey=r=>r?JSON.stringify([r.floorId??null,r.entityId??null]):null;
  const value=v=>v??null;
  const numeric=v=>Number.isFinite(v)?v:null;
  const format=v=>v===null||v===undefined?UNKNOWN:typeof v==='number'?String(Number(v.toPrecision(7))):String(v);
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'\uFFFD')
    .replace(/[\uD800-\uDFFF]/gu,'\uFFFD');
  function freeze(v){
    if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}
    return v;
  }
  function fail(message){throw new RangeError(`Airflow display: ${message} No clipping or truncation is performed.`);}
  function validateJSON(root){
    let nodes=0,characters=0;
    const stack=new Set();
    function visit(v,depth){
      if(++nodes>500000||depth>64)fail('JSON traversal budget exceeded.');
      if(v===null||typeof v==='boolean')return;
      if(typeof v==='number'){if(!Number.isFinite(v))throw new TypeError('Airflow display requires finite JSON.');return;}
      if(typeof v==='string'){
        characters+=v.length;
        if(characters>16000000)fail('JSON text budget exceeded.');
        return;
      }
      if(typeof v!=='object'||stack.has(v))throw new TypeError('Airflow display requires acyclic finite JSON.');
      stack.add(v);
      if(Array.isArray(v)){
        for(let i=0;i<v.length;i++)visit(v[i],depth+1);
      }else{
        if(Object.prototype.toString.call(v)!=='[object Object]'||Object.getOwnPropertySymbols(v).length)
          throw new TypeError('Airflow display requires JSON objects.');
        for(const [k,child] of Object.entries(v)){visit(k,depth+1);visit(child,depth+1);}
      }
      stack.delete(v);
    }
    visit(root,0);
  }
  function array(v,name){
    if(!Array.isArray(v))throw new TypeError(`Airflow display requires ${name}.`);
    if(v.length>LIMITS[name])fail(`${name} exceeds the foundation budget.`);
  }
  function point(p){
    if(!p||!['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=1e9))
      fail('Geometry requires finite site-local x/y/z within ±1e9 m.');
    return p;
  }
  function inventoryCheck(inventory){
    if(inventory?.kind!=='AirflowInventory'||inventory.version!==1||inventory.coordinateSpace!=='site-local')
      throw new TypeError('Use the version 1 AirflowInventory from HomePlannerAirflow.discover/run.');
    for(const name of ['floors','rooms','openings'])array(inventory[name],name);
    const floors=new Set();
    for(const f of inventory.floors){
      if(typeof f.floorId!=='string'||floors.has(f.floorId)||f.coordinateSpace!=='site-local')
        throw new TypeError('Inventory floors must be unique site-local references.');
      floors.add(f.floorId);
    }
    for(const name of ['rooms','openings']){
      const keys=new Set();
      for(const record of inventory[name]){
        if(typeof record.key!=='string'||keys.has(record.key)||!floors.has(record.ref?.floorId)||typeof record.ref?.entityId!=='string')
          throw new TypeError('Inventory records require unique keys and qualified references.');
        keys.add(record.key);
        if(name==='rooms'){
          const g=record.geometry;
          if(g?.coordinateSpace!=='site-local'||!Array.isArray(g.polygon)||g.polygon.length!==4)
            throw new TypeError('Use the discovered rectangular room polygons.');
          g.polygon.forEach(point);point(g.center);
          if(g.usableRegions){
            if(!Array.isArray(g.usableRegions)||g.usableRegions.length>4096)fail('Invalid usable-region budget.');
            for(const rect of g.usableRegions){
              point({x:rect.x,y:rect.y,z:g.center.z});point({x:rect.x+rect.w,y:rect.y+rect.h,z:g.center.z});
              if(!(rect.w>0&&rect.h>0))fail('Usable regions require positive dimensions.');
            }
          }
          if(typeof record.label!=='string'||record.label.length>16384)fail('Room label is invalid or exceeds 16,384 characters.');
        }else if(record.geometry){
          if(record.geometry.coordinateSpace!=='site-local')throw new TypeError('Opening geometry must be site-local.');
          ['start','end','center'].forEach(k=>point(record.geometry[k]));
        }
      }
    }
  }
  function createView(result,options={}){
    if(result?.kind!=='AirflowResult'||result.version!==1||
      !['blocked','converged','nonconverged','numerical-error'].includes(result.status))
      throw new TypeError('createView requires a version 1 AirflowResult; use createInventoryView before a run.');
    return build(result.inventory,result,options);
  }
  function createInventoryView(inventory,options={}){return build(inventory,null,options);}
  function build(inventory,result,options){
    validateJSON(result||inventory);inventoryCheck(inventory);validateJSON(options);
    if(!options||Array.isArray(options)||Object.keys(options).some(k=>k!=='floorId'))
      throw new TypeError('Only the display floorId option is supported.');
    const floorId=options.floorId??inventory.floors[0]?.floorId??null;
    if(floorId!==null&&!inventory.floors.some(f=>f.floorId===floorId))
      throw new RangeError('Select a registered inventory floorId.');
    if(result){
      for(const name of ['zones','links'])array(result[name],name);
      array(result.zoneResults,'zones');array(result.flowResults,'links');
    }
    const status=result?.status??'not-run';
    const trusted=status==='converged'&&result.balanced===true&&result.solver?.converged===true&&result.solver.status==='converged';
    const statusLabel=trusted?'CONVERGED — selected network':status==='not-run'?'NOT RUN — geometry inventory':
      status==='blocked'?'BLOCKED — inputs require review':`DIAGNOSTIC ONLY — ${status}`;
    const warnings=[...(result?.warnings??[]),...(inventory.findings??[]).map(f=>f.message),
      ...(result?.findings??[]).map(f=>`${f.severity}: ${f.message}`)];
    for(const diagnostic of inventory.sourceDiagnostics??[])
      if(typeof diagnostic.message==='string')warnings.push(diagnostic.message);
    for(const floor of inventory.sourceFloorDiagnostics??[])
      for(const diagnostic of floor.diagnostics??[])
        if(typeof diagnostic.message==='string')warnings.push(`Floor ${floor.floorId}: ${diagnostic.message}`);
    if(!trusted)warnings.unshift(`${statusLabel}. No flow arrows are displayed; unknown values are not zero.`);
    const zones=result?.zones??[],links=result?.links??[];
    const zoneByRef=new Map(zones.filter(z=>z.roomRef).map(z=>[refKey(z.roomRef),z]));
    const zoneById=new Map(zones.map(z=>[z.id,z]));
    const zoneResults=new Map((result?.zoneResults??[]).map(z=>[z.id,z]));
    const flowResults=new Map((result?.flowResults??[]).map(l=>[l.id,l]));
    const rawFlows=new Map((result?.solver?.flows??[]).map(f=>[f.id,f]));
    const linkByRef=new Map(links.filter(l=>l.openingRef).map(l=>[refKey(l.openingRef),l]));
    const rawZones=new Map((result?.scenario?.zones??[]).map(z=>[z.id,z]));
    const rawLinks=new Map((result?.scenario?.links??[]).map(l=>[l.id,l]));
    const rawPressure=id=>numeric(result?.solver?.pressures?.[id]);
    const roomRows=[];
    function roomRow(room,z){
      const output=z?zoneResults.get(z.id):null;
      const component=(result?.components??[]).find(c=>c.zoneIds.includes(z?.id));
      const fields=['inflowM3s','outflowM3s','netOutflowM3s','massResidualKgS','directOutsideInflowM3s','transferInflowM3s'];
      const row={key:room?.key??JSON.stringify(['unresolved-zone',z.id]),shortKey:`R${roomRows.length+1}`,
        id:room?.ref.entityId??z.id,roomRef:value(room?.ref??z?.roomRef),floorId:value(room?.ref.floorId??z?.roomRef?.floorId),
        label:room?.label??z.id,zoneId:z?.id??null,solverId:z?.solverId??null,
        inScope:(room?.ref.floorId??z?.roomRef?.floorId)===floorId,selected:!!z,
        geometry:value(room?.geometry),volumeM3:numeric(z?.volumeM3),volumeProvenance:value(z?.volumeProvenance),
        rawInputs:z?value(rawZones.get(z.id)):null,
        pressurePa:numeric(output?.pressurePa??rawPressure(z?.solverId)),
        gauge:component?.gauge??UNKNOWN,referenceZoneId:component?.referenceZoneId??null,
        referencePressurePa:numeric(component?.referencePressurePa),
        directOutsideInflowACH:trusted?numeric(output?.directOutsideInflowACH):null,
        achLabel:output?.achLabel??ACH,numericalStatus:status,diagnostic:!trusted&&status!=='not-run',
        sealed:value(output?.sealed),deadEnd:value(output?.deadEnd),connectedToOutside:value(output?.connectedToOutside)};
      for(const field of fields)row[field]=numeric(output?.[field]);
      if(row.netOutflowM3s===null)row.netOutflowM3s=numeric(result?.solver?.zoneResidualsM3s?.[z?.solverId]);
      if(row.massResidualKgS===null&&row.netOutflowM3s!==null&&Number.isFinite(result?.scenario?.densityKgM3))
        row.massResidualKgS=numeric(row.netOutflowM3s*result.scenario.densityKgM3);
      row.display=Object.fromEntries(['volumeM3','pressurePa','directOutsideInflowACH',...fields].map(k=>[k,format(row[k])]));
      roomRows.push(row);
    }
    for(const room of inventory.rooms)roomRow(room,zoneByRef.get(refKey(room.ref)));
    for(const z of zones)if(!inventory.rooms.some(r=>refKey(r.ref)===refKey(z.roomRef)))roomRow(null,z);
    const roomByRef=new Map(inventory.rooms.map(r=>[refKey(r.ref),r]));
    function directionVector(opening,l,q){
      if(!trusted||l?.state!=='active'||l.enabled!==true||!(l.effectiveAreaM2>0)||!(l.operation?.openFraction>0)||
        opening?.operation?.openFraction===0||!Number.isFinite(q)||q===0||
        !opening?.geometry||opening.adjacencyStatus!=='known'||!opening.candidateAdjacency)return null;
      const endpoint=id=>id==='outside'?{kind:'outside'}:zoneById.get(id)?.roomRef;
      const from=endpoint(l.from),to=endpoint(l.to);
      const matches=(a,b)=>a?.kind==='outside'?b?.kind==='outside':b?.kind==='room'&&refKey(a)===refKey(b);
      if(!from||!to||!opening.candidateAdjacency.some(a=>matches(from,a))||!opening.candidateAdjacency.some(a=>matches(to,a)))return null;
      const {start,end,center}=opening.geometry,dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
      if(!(length>0))return null;
      let nx=-dy/length,ny=dx/length;
      const fromRoom=roomByRef.get(refKey(from)),toRoom=roomByRef.get(refKey(to));
      const toward=toRoom?{x:toRoom.geometry.center.x-center.x,y:toRoom.geometry.center.y-center.y}:
        fromRoom?{x:center.x-fromRoom.geometry.center.x,y:center.y-fromRoom.geometry.center.y}:null;
      if(!toward)return null;
      const dot=nx*toward.x+ny*toward.y;
      if(Math.abs(dot)<1e-9)return null;
      const sign=(dot>0?1:-1)*(q>0?1:-1);nx*=sign;ny*=sign;
      return {x:nx===0?0:nx,y:ny===0?0:ny};
    }
    const openingRows=[];
    function openingRow(opening,l){
      const flow=l?flowResults.get(l.id):null,raw=l?rawFlows.get(l.solverId):null;
      const q=numeric(flow?.m3s??raw?.m3s);
      const manual=l?.kind==='manual',g=manual?l.geometry:opening?.geometry??null;
      if(manual&&g){point(g.from?.point);point(g.to?.point);}
      const pressureFrom=l?.from==='outside'?(result?.solver?0:null):rawPressure(l?.solverFrom);
      const pressureTo=l?.to==='outside'?(result?.solver?0:null):rawPressure(l?.solverTo);
      const imposed=numeric(l?.pressurePa);
      const delta=pressureFrom!==null&&pressureTo!==null&&imposed!==null?numeric(pressureFrom-pressureTo+imposed):null;
      const direction=q===null||q===0||!l?.from||!l?.to?null:{from:q>0?l.from:l.to,to:q>0?l.to:l.from};
      const row={key:opening?.key??JSON.stringify(['link',l.id]),shortKey:`O${openingRows.length+1}`,
        id:l?.id??opening.ref.entityId,linkId:l?.id??null,openingRef:value(opening?.ref??l?.openingRef),
        floorId:value(opening?.ref.floorId??l?.openingRef?.floorId??g?.from?.floorId),
        fromFloorId:manual?g?.from?.floorId??null:zoneById.get(l?.from)?.roomRef?.floorId??opening?.ref.floorId??null,
        toFloorId:manual?g?.to?.floorId??null:zoneById.get(l?.to)?.roomRef?.floorId??opening?.ref.floorId??null,
        inScope:manual?g?.from?.floorId===floorId||g?.to?.floorId===floorId:(opening?.ref.floorId??l?.openingRef?.floorId)===floorId,
        kind:manual?'manual':opening?.kind??'opening',selected:!!l,geometry:value(g),
        from:l?.from??null,to:l?.to??null,fromRoomRef:value(zoneById.get(l?.from)?.roomRef),toRoomRef:value(zoneById.get(l?.to)?.roomRef),
        solverId:l?.solverId??null,solverFrom:l?.solverFrom??null,solverTo:l?.solverTo??null,
        state:l?.state??'not-selected',enabled:value(l?.enabled),m3s:q,direction,
        freeAreaM2:numeric(l?.freeAreaM2),effectiveAreaM2:numeric(l?.effectiveAreaM2),cd:numeric(l?.cd),
        imposedPressurePa:imposed,pressurePa:imposed,fromPressurePa:pressureFrom,toPressurePa:pressureTo,solverPressureDifferencePa:delta,
        meanOpeningSpeedMps:numeric(flow?.meanOpeningSpeedMps),operation:value(l?.operation??opening?.operation),
        grossAreaM2:numeric(opening?.grossAreaM2??l?.grossAreaM2),rawInputs:l?value(rawLinks.get(l.id)):null,
        awaitingInputs:l?.awaitingInputs??[],numericalStatus:status,diagnostic:!trusted&&status!=='not-run',
        directionVector:directionVector(opening,l,q),label:manual?'User connection — not a known opening':opening?.kind??'Unresolved opening'};
      row.display=Object.fromEntries(['m3s','freeAreaM2','effectiveAreaM2','cd','imposedPressurePa','fromPressurePa','toPressurePa',
        'solverPressureDifferencePa','meanOpeningSpeedMps'].map(k=>[k,format(row[k])]));
      row.display.direction=direction?`${direction.from} → ${direction.to}`:q===0?'zero net flow':UNKNOWN;
      openingRows.push(row);
    }
    for(const opening of inventory.openings)openingRow(opening,linkByRef.get(refKey(opening.ref)));
    for(const l of links)if(l.kind==='manual'||!inventory.openings.some(o=>refKey(o.ref)===refKey(l.openingRef)))openingRow(null,l);
    if(openingRows.some(r=>r.inScope&&r.kind==='manual'&&r.fromFloorId!==r.toFloorId))
      warnings.push('Cross-floor user connection: both explicit site-local endpoints and the full foreign span are shown. No foreign room is projected onto this floor; anchor z is not a shaft or stack-effect model.');
    const legend=[
      statusLabel,
      'Selected-floor geometry only; all-floor analytical rows are unchanged by this display filter.',
      'R / O keys resolve to full names and qualified references in the accompanying tables.',
      'Solid room outlines and aperture bars: compiled site-local geometry. Arrow: signed opening flow only.',
      'Dashed line + endpoint rings: explicit user connection, not a known opening or physical route.',
      'Flow m³/s; pressure Pa; area m²; volume m³; mass residual kg/s; aperture-mean speed m/s.',
      ACH+'.',
      'Fit-to-view diagram, not a fixed-scale construction sheet. No CFD, room streamlines or spatial velocity.'
    ];
    const field=result?.planField??null,fieldRows=[];
    if(field){
      if(field.kind!=='AirflowPlanField'||field.version!==1||field.engineId!=='HomePlannerAirflowField'||
        field.inputFingerprint!==result.provenance.inputFingerprint||field.units!=='m/s'||
        !['complete','partial','unavailable'].includes(field.status)||!Array.isArray(field.cells)||field.cells.length>4096)
        throw new TypeError('Use the matching computed 2D potential-flow field, not a fabricated heatmap.');
      const ids=new Set();
      for(const cell of field.cells){
        const room=roomByRef.get(refKey(cell.roomRef)),r=cell.rect,v=cell.velocityMps;
        if(!trusted||!room||cell.floorId!==room.ref.floorId||typeof cell.id!=='string'||ids.has(cell.id)||
          !r||![r.x,r.y,r.w,r.h,v?.x,v?.y,cell.point?.x,cell.point?.y,cell.speedMps].every(Number.isFinite)||!(r.w>0&&r.h>0)||
          cell.speedMps<0||Math.abs(Math.hypot(v.x,v.y)-cell.speedMps)>1e-9*Math.max(1,cell.speedMps))
          throw new TypeError('Invalid numerical velocity cell.');
        if(Math.abs(cell.point.x-r.x-r.w/2)>1e-7||Math.abs(cell.point.y-r.y-r.h/2)>1e-7)
          throw new TypeError('Velocity vector is not located at its computed cell centre.');
        const inside=b=>r.x>=b.x-1e-7&&r.y>=b.y-1e-7&&r.x+r.w<=b.x+b.w+1e-7&&r.y+r.h<=b.y+b.h+1e-7;
        if(!(room.geometry.usableRegions||[room.geometry.rect]).some(inside))
          throw new TypeError('Velocity cell leaves the supplied usable room area.');
        point({x:r.x,y:r.y,z:0});point({x:r.x+r.w,y:r.y+r.h,z:0});
        ids.add(cell.id);fieldRows.push({...cell,inScope:cell.floorId===floorId});
      }
      warnings.push(...field.findings.map(finding=>finding.message),...field.assumptions);
      const range=fieldRows.length?`0–${format(Math.max(...fieldRows.map(cell=>cell.speedMps)))} m/s`:'unavailable';
      legend.splice(0,legend.length,`Velocity [m s⁻¹] · computed range ${range} · 2D potential-flow estimate: ${field.status} · not validated CFD or measured room airspeed.`,
        'Blue → cyan → green → yellow → red shows increasing computed speed; black arrows show computed direction.',
        'Gray/uncolored regions have no field. Reserved footprints are excluded. R / O keys resolve in the evidence tables.');
    }
    const uniqueWarnings=[...new Set(warnings)];
    const regional=roomRows.some(room=>room.geometry?.usableRegions&&
      (room.geometry.usableRegions.length!==1||['x','y','w','h'].some(key=>room.geometry.usableRegions[0][key]!==room.geometry.rect[key])));
    const svg=field||regional?renderPlan(roomRows,openingRows,inventory,field,fieldRows,statusLabel,floorId)
      :render(roomRows,openingRows,statusLabel,floorId,uniqueWarnings);
    const view={version:VERSION,svg,roomRows,openingRows,...(field?{fieldRows}:{}),legend,warnings:uniqueWarnings,floorId};
    validateJSON(view);
    return freeze(copy(view));
  }
  const overlap=(a,b,gap=3)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
  function intersects(a,b,box){
    let low=0,high=1;
    for(const [s,d,min,max] of [[a.x,b.x-a.x,box.x-6,box.x+box.w+6],[a.y,b.y-a.y,box.y-6,box.y+box.h+6]]){
      if(Math.abs(d)<1e-9){if(s<min||s>max)return false;}
      else {low=Math.max(low,Math.min((min-s)/d,(max-s)/d));high=Math.min(high,Math.max((min-s)/d,(max-s)/d));}
    }
    return low<=high;
  }
  function renderPlan(roomRows,openingRows,inventory,field,fieldRows,statusLabel,floorId){
    const rooms=roomRows.filter(row=>row.inScope&&row.geometry),openings=openingRows.filter(row=>row.inScope&&row.geometry);
    if(rooms.length+openings.length>512)fail('More than 512 drawable records; use the evidence tables.');
    const points=roomRows.flatMap(room=>room.geometry?.polygon||[]);
    for(const wall of inventory.walls||[])if(wall.start&&wall.end)points.push(wall.start,wall.end);
    for(const opening of openingRows)if(opening.geometry)points.push(...(opening.kind==='manual'
      ?[opening.geometry.from.point,opening.geometry.to.point]:[opening.geometry.start,opening.geometry.end]));
    let minX=0,minY=0,maxX=1,maxY=1;
    for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    const scale=Math.min(800/(maxX-minX),590/(maxY-minY));
    const px=x=>40+(800-(maxX-minX)*scale)/2+(x-minX)*scale,py=y=>110+(y-minY)*scale;
    const n=value=>String(Number(value.toPrecision(12)));
    const text=(x,y,value,size=14,extra='')=>`<text x="${n(x)}" y="${n(y)}" font-size="${size}" ${extra}>${escape(value)}</text>`;
    const rect=(r,attrs)=>`<rect x="${n(px(r.x))}" y="${n(py(r.y))}" width="${n(r.w*scale)}" height="${n(r.h*scale)}" ${attrs}/>`;
    const line=(a,b,width,color,attrs='')=>`<line x1="${n(px(a.x))}" y1="${n(py(a.y))}" x2="${n(px(b.x))}" y2="${n(py(b.y))}" stroke="${color}" stroke-width="${n(width)}" ${attrs}/>`;
    const localCells=fieldRows.filter(cell=>cell.inScope),maximum=fieldRows.length?Math.max(...fieldRows.map(cell=>cell.speedMps)):null;
    const graphics=[],clips=[];
    for(const room of rooms){
      const regions=room.geometry.usableRegions||[room.geometry.rect];
      clips.push(`<clipPath id="flow-${room.shortKey}">${regions.map(region=>rect(region,'')).join('')}</clipPath>`);
      graphics.push(`<g data-room="${room.shortKey}"><title>${escape(room.label)}</title>`+
        regions.map(region=>rect(region,'fill="#f0f2f4"')).join('')+'</g>');
      if(!inventory.walls?.length)graphics.push(rect(room.geometry.rect,`fill="none" stroke="${INK}" stroke-width="1"`));
    }
    const roomKeys=new Map(rooms.map(room=>[refKey(room.roomRef),room.shortKey])),bins=new Set();
    for(const cell of localCells){
      const roomKey=roomKeys.get(refKey(cell.roomRef)),v=cell.velocityMps;
      graphics.push(`<g data-field-cell="${escape(cell.id)}" data-speed="${cell.speedMps}" clip-path="url(#flow-${roomKey})"><title>${escape(`Velocity estimate ${format(cell.speedMps)} m/s; vx=${format(v.x)}, vy=${format(v.y)}; site x=${cell.point.x}, y=${cell.point.y}`)}</title>`+
        rect(cell.rect,`fill="${heatColor(cell.speedMps,maximum)}"`)+'</g>');
      if(cell.speedMps===0)continue;
      const x=px(cell.point.x),y=py(cell.point.y),bin=`${Math.floor(x/22)},${Math.floor(y/22)}`;
      if(bins.has(bin))continue;
      bins.add(bin);
      const ux=v.x/cell.speedMps,uy=v.y/cell.speedMps,length=Math.min(15,Math.max(5,Math.min(cell.rect.w,cell.rect.h)*scale*.7));
      const a={x:x-ux*length/2,y:y-uy*length/2},b={x:x+ux*length/2,y:y+uy*length/2};
      const left={x:b.x-ux*4-uy*2.4,y:b.y-uy*4+ux*2.4},right={x:b.x-ux*4+uy*2.4,y:b.y-uy*4-ux*2.4};
      graphics.push(`<g data-field-vector="${escape(cell.id)}" clip-path="url(#flow-${roomKey})" stroke="#111820" fill="none" stroke-width="1.2"><line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"/><polyline points="${[left,b,right].map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}"/></g>`);
    }
    for(const wall of inventory.walls||[])if(wall.ref.floorId===floorId&&!wall.removed&&wall.start&&wall.end&&Number.isFinite(wall.thicknessM))
      graphics.push(`<g data-wall="${escape(wall.ref.entityId)}">${line(wall.start,wall.end,wall.thicknessM*scale,INK,'stroke-linecap="butt"')}</g>`);
    for(const opening of openings){
      if(opening.kind==='manual'){
        graphics.push(line(opening.geometry.from.point,opening.geometry.to.point,2,SIENNA,`data-manual="${opening.shortKey}" stroke-dasharray="6 5"`));
        for(const [endpoint,suffix] of [[opening.geometry.from,'a'],[opening.geometry.to,'b']]){
          const p=endpoint.point;
          graphics.push(`<g data-manual-endpoint="${opening.shortKey}${suffix}"><title>${escape(`User connection anchor ${opening.shortKey}${suffix}; floor ${endpoint.floorId}; z=${p.z} m. Not a velocity path.`)}</title><circle cx="${n(px(p.x))}" cy="${n(py(p.y))}" r="4" fill="#fff" stroke="${SIENNA}" stroke-width="2"/>`+
            text(px(p.x)+7,py(p.y)-7,opening.shortKey+suffix,11)+'</g>');
        }
        continue;
      }
      const g=opening.geometry;
      graphics.push(`<g data-opening="${opening.shortKey}"><title>${escape(`${opening.shortKey}: ${opening.display.m3s} m³/s`)}</title>`+
        line(g.start,g.end,Math.max(3,(g.wallThicknessM||0)*scale+1),'#fff')+
        line(g.start,g.end,opening.kind==='window'?2:1,INK)+'</g>');
      if(opening.directionVector){
        const v=opening.directionVector,p=g.center,a={x:p.x-v.x*9/scale,y:p.y-v.y*9/scale},b={x:p.x+v.x*9/scale,y:p.y+v.y*9/scale};
        graphics.push(`<g data-flow="${opening.shortKey}">${line(a,b,2,INK,'marker-end="url(#flow-arrow)"')}</g>`);
      }
    }
    for(const room of rooms){
      const region=(room.geometry.usableRegions||[room.geometry.rect]).reduce((best,r)=>!best||r.w*r.h>best.w*best.h?r:best,null);
      if(!region)continue;
      graphics.push(text(px(region.x+region.w/2),py(region.y+region.h/2),room.shortKey,14,
        'text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4" stroke-linejoin="round" font-weight="700"'));
    }
    const ticks=maximum===null?'':Array.from({length:maximum===0?1:6},(_,i)=>{
      const t=maximum===0?0:i/5,y=615-t*370;
      return `<path d="M925 ${n(y)}h8" stroke="${INK}"/>`+text(940,y+5,Number((t*maximum).toPrecision(4)));
    }).join('');
    const fieldStatus=field?`2D POTENTIAL-FLOW ESTIMATE · ${field.status.toUpperCase()} · NOT CFD`:'INVENTORY ONLY · NO VELOCITY CALCULATED';
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Airflow plan — ${escape(fieldStatus)}" viewBox="0 0 1040 820" width="1040" height="820" style="max-width:100%;height:auto" font-family="Arial, sans-serif" fill="${INK}">
<title>Airflow · depth-averaged velocity estimate</title><desc>${escape(fieldStatus)}. Exact numerical cells are clipped to supplied usable floor regions. Black vectors are computed, not decorative wind paths.</desc>
<!-- THESIS: computed velocity on the architectural plan, not a decorative network diagram. OWN-WORLD: white paper, physical dark walls, spectral values and small black vectors. STORY: inspect the estimate and its actual numeric legend, then its assumptions. FIRST VIEWPORT: plan first; vertical scale at right. FORM: reference-pinned scientific field presentation within the existing workbench. -->
<defs>${clips.join('')}<linearGradient id="flow-spectrum" x1="0" x2="0" y1="1" y2="0">${SPECTRUM.map((color,i)=>`<stop offset="${i/4}" stop-color="${color}"/>`).join('')}</linearGradient>
<marker id="flow-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5" fill="${INK}"/></marker></defs>
<rect width="1040" height="820" fill="#fff"/>
${text(28,33,'Airflow · velocity field',24,'font-weight="700"')}
${text(28,59,fieldStatus,15,'font-weight="700"')}
${text(28,82,`${statusLabel} · selected-floor site-local plan`,13)}
${graphics.join('')}
${rooms.length?'':text(50,240,'No drawable usable room regions. Prepare or repair the physical inventory.',16)}
${text(888,203,'Velocity',16,'font-weight="700"')}${text(888,226,'[m s⁻¹]',14)}
<rect data-legend="velocity" x="895" y="245" width="30" height="370" fill="${maximum===null?'#dde2e6':maximum===0?SPECTRUM[0]:'url(#flow-spectrum)'}" stroke="${INK}" stroke-width="1"/>
${ticks}${text(887,646,maximum===null?'Unavailable':maximum===0?'Known zero':'Computed range',12)}
${text(887,668,'Depth averaged',12)}
${text(28,736,localCells.length?`${localCells.length} computed cells on this floor. Reserved lift/stair footprints are excluded from host air regions.`:'No velocity cells on this floor. Uncolored geometry is not a zero-velocity result.',14)}
${text(28,759,'Potential flow is an uncalibrated reduced model: no viscosity, turbulence, jet entrainment, furniture drag or vertical mixing.',12)}
${text(28,782,'Model depth = declared clear volume / usable floor area. Exact signed opening flows and cell values remain in the tables.',12)}
${text(28,804,openings.some(opening=>opening.kind==='manual')?'Dashed lines + rings = user connection intent, not air paths. Black vectors = computed field; not measured CFD.':'Black field vectors = computed direction · R / O = evidence keys · fit-to-view plan, not a construction scale or measured CFD field',12)}
</svg>`;
  }
  function render(roomRows,openingRows,statusLabel,floorId,warnings){
    const rooms=roomRows.filter(r=>r.inScope&&r.geometry),openings=openingRows.filter(r=>r.inScope&&r.geometry);
    if(rooms.length+openings.length>512)fail('More than 512 drawable records on this floor; use the inventory/result tables.');
    const points=rooms.flatMap(r=>r.geometry.polygon);
    for(const o of openings)points.push(...(o.kind==='manual'?[o.geometry.from.point,o.geometry.to.point]:[o.geometry.start,o.geometry.end]));
    let minX=0,minY=0,maxX=1,maxY=1;
    if(points.length){
      minX=Infinity;minY=Infinity;maxX=-Infinity;maxY=-Infinity;
      for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    }
    const w=Math.max(maxX-minX,.01),h=Math.max(maxY-minY,.01),scale=Math.min(840/w,460/h);
    const px=p=>({x:80+(840-w*scale)/2+(p.x-minX)*scale,y:138+(460-h*scale)/2+(p.y-minY)*scale});
    const n=v=>String(Number(v.toFixed(5)));
    const text=(x,y,t,size=14,extra='')=>`<text x="${n(x)}" y="${n(y)}" font-size="${size}" ${extra}>${escape(t)}</text>`;
    const line=(a,b,extra='')=>`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" ${extra}/>`;
    const graphics=[],segments=[],labels=[],boxes=[];
    const reserve=(a,b)=>segments.push([a,b]);
    const label=(key,center,candidates,title,inside=null)=>{
      const width=key.length*8.5+10,height=22;
      for(const p of candidates){
        const box={x:p.x-width/2,y:p.y-16,w:width,h:height};
        if(box.x<25||box.x+box.w>975||box.y<105||box.y+box.h>635)continue;
        if(inside&&(box.x<inside.x+5||box.x+box.w>inside.x+inside.w-5||box.y<inside.y+5||box.y+box.h>inside.y+inside.h-5))continue;
        if(boxes.some(b=>overlap(box,b))||segments.some(([a,b])=>intersects(a,b,box)))continue;
        boxes.push(box);
        labels.push(`<g><title>${escape(title)}</title>${text(p.x,p.y,key,14,'text-anchor="middle" font-weight="600"')}</g>`);
        return box;
      }
      fail(`Diagram is too dense to place readable ${key} without obscuring geometry. Select another floor or review the tables.`);
    };
    for(const r of rooms){
      const polygon=r.geometry.polygon.map(px);
      graphics.push(`<polygon data-room="${r.shortKey}" points="${polygon.map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}" fill="#fff" stroke="${INK}" stroke-width="1.5"><title>${escape(`${r.shortKey}: ${r.label}`)}</title></polygon>`);
      polygon.forEach((p,i)=>reserve(p,polygon[(i+1)%polygon.length]));
    }
    const openingLabels=[];
    for(const o of openings){
      if(o.kind==='manual'){
        const a=px(o.geometry.from.point),b=px(o.geometry.to.point);
        graphics.push(line(a,b,`data-manual="${o.shortKey}" stroke="${SIENNA}" stroke-width="2" stroke-dasharray="6 5"`));
        reserve(a,b);
        for(const [p,side] of [[a,'a'],[b,'b']]){
          graphics.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="5" fill="#fff" stroke="${SIENNA}" stroke-width="2"/>`);
          openingLabels.push({key:o.shortKey+side,p,title:`${o.shortKey}${side}: ${side==='a'?'from':'to'} explicit user anchor; floor ${side==='a'?o.fromFloorId:o.toFloorId}`});
        }
      }else{
        const a=px(o.geometry.start),b=px(o.geometry.end),p=px(o.geometry.center);
        graphics.push(line(a,b,`data-opening="${o.shortKey}" stroke="${INK}" stroke-width="5"`));reserve(a,b);
        if(o.directionVector){
          const v=o.directionVector,start={x:p.x-v.x*15,y:p.y-v.y*15},end={x:p.x+v.x*15,y:p.y+v.y*15};
          const left={x:end.x-v.x*8-v.y*5,y:end.y-v.y*8+v.x*5},right={x:end.x-v.x*8+v.y*5,y:end.y-v.y*8-v.x*5};
          graphics.push(`<g data-flow="${o.shortKey}" stroke="${BLUE}" stroke-width="2.5" fill="none"><title>${escape(`${o.shortKey}: ${o.display.direction}; ${o.display.m3s} m³/s signed from-to`)}</title>${line(start,end)}<polyline points="${[left,end,right].map(p=>`${n(p.x)},${n(p.y)}`).join(' ')}"/></g>`);
          reserve(start,end);reserve(left,end);reserve(right,end);
        }
        openingLabels.push({key:o.shortKey,p,title:`${o.shortKey}: ${o.label}; ${o.state}; ${o.display.m3s} m³/s`});
      }
    }
    for(const r of rooms){
      const polygon=r.geometry.polygon.map(px),p=px(r.geometry.center);
      const x=Math.min(...polygon.map(p=>p.x)),y=Math.min(...polygon.map(p=>p.y));
      const inside={x,y,w:Math.max(...polygon.map(p=>p.x))-x,h:Math.max(...polygon.map(p=>p.y))-y};
      label(r.shortKey,p,[p,{x:p.x,y:p.y-30},{x:p.x,y:p.y+30}],`${r.shortKey}: ${r.label}`,inside);
      // A whole short name may supplement the key; long names remain complete in rows and SVG titles.
      const name=r.label.replace(/\s+/g,' ').trim(),nameBox={x:p.x-name.length*6.5,y:p.y+9,w:name.length*13,h:20};
      if(name.length<=28&&nameBox.x>inside.x+8&&nameBox.x+nameBox.w<inside.x+inside.w-8&&
        nameBox.y+nameBox.h<inside.y+inside.h-8&&!boxes.some(b=>overlap(b,nameBox))&&!segments.some(([a,b])=>intersects(a,b,nameBox))){
        boxes.push(nameBox);labels.push(text(p.x,p.y+25,name,13,'text-anchor="middle"'));
      }
    }
    for(const {key,p,title} of openingLabels){
      const candidates=[];
      for(const radius of [30,48,66])for(const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]])
        candidates.push({x:p.x+dx*radius,y:p.y+dy*radius});
      label(key,p,candidates,title);
    }
    const cross=openings.some(o=>o.kind==='manual'&&o.fromFloorId!==o.toFloorId);
    const desc=`${statusLabel}. Floor ${floorId??UNKNOWN}. ${rooms.length} room polygons; ${openings.length} openings/user connections. `+
      'All values and full qualified references are in the accompanying tables. Arrows are symbolic signed opening flow, not a spatial velocity field. '+
      (cross?'Cross-floor user connections retain both explicit anchors and the full foreign span; no foreign room overlay. ':'')+
      'Fit-to-view, not a construction scale. Unknown is not zero.';
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escape(`Airflow plan — ${statusLabel}`)}" viewBox="0 0 1000 800" width="1000" height="800" style="max-width:100%;height:auto" font-family="Arial, sans-serif" fill="${INK}">
<title>${escape(`Airflow plan — ${statusLabel}`)}</title><desc>${escape(desc)}</desc>
<!-- THESIS: opening evidence, never a simulated wind field. OWN-WORLD: white paper, dark ink and incumbent blue/sienna notation. STORY: inspect scope, geometry, signed flow and full tables. FIRST VIEWPORT: status above plan, limitations below. FORM: brief-pinned local drawing extension, fit-to-view only. -->
<rect width="1000" height="800" fill="#fff"/>
${text(32,40,'Airflow · opening network',24,'font-weight="700"')}
${text(32,71,statusLabel,17,'font-weight="700"')}
${text(32,96,'Selected floor · common site-local frame · display fit only',14)}
${graphics.join('\n')}${labels.join('\n')}
${points.length?'':text(32,180,'No drawable geometry on this floor. See the full inventory tables.',16)}
${text(32,670,'R / O = table keys     → = signed opening flow     - - + rings = user connection',14)}
${text(32,694,'Flow m³/s · pressure Pa · area m² · volume m³ · mass residual kg/s',14)}
${text(32,718,cross?'CROSS-FLOOR: full explicit anchor span shown; no foreign room overlay.':'Selected network only; omitted openings are not asserted sealed.',14)}
${text(32,742,'Direct outside inflow ACH ≠ complete fresh-air delivery or a mixing estimate.',14)}
${text(32,766,'Not CFD, room airspeed, streamlines or a fixed-scale construction sheet.',14)}
${text(32,789,`${warnings.length} review notes in the accompanying warnings. Full names and references remain in tables.`,12)}
</svg>`;
  }
  return Object.freeze({VERSION,createView,createInventoryView});
});
