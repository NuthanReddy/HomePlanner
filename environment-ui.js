(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    root.EnvironmentUI=api;
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>api.mount(),{once:true});
    else api.mount();
  }
})(globalThis,function(root){
  'use strict';
  const HOUR=3600000,DAY=24*HOUR;
  const DIRECTIONS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const MATERIAL_PRESETS=Object.freeze([
    Object.freeze({id:'dense-clay-brick',label:'Dense face clay brick — EnergyPlus example',
      thicknessM:0.1014984,conductivityW_MK:1.245296,densityKgM3:2082.4,specificHeatJ_KgK:920.48,
      source:'EnergyPlus 24.2 Input Output Reference, Material example A2 – 4 IN DENSE FACE BRICK. Example, not a local product specification.',
      url:'https://bigladdersoftware.com/epx/docs/24-2/input-output-reference/group-surface-construction-elements.html#material'}),
    Object.freeze({id:'aac-ens',label:'AAC — ENS 2024 reference',
      thicknessM:0.2,conductivityW_MK:0.184,densityKgM3:642,specificHeatJ_KgK:1240,
      source:'BEE Eco-Niwas Samhita 2024 material reference: k 0.184, density 642, c 1.24 kJ/kg K converted to 1240 J/kg K. Thickness 0.20 m is an explicit example assumption.',
      url:'https://beeindia.gov.in/WriteReadData/RTF1984/1772175926.pdf'}),
    Object.freeze({id:'lyon-rammed-earth',label:'Lyon rammed earth — source-specific, properties required',
      thicknessM:0.3,conductivityW_MK:null,densityKgM3:null,specificHeatJ_KgK:null,
      source:'Losini et al., hygrothermal characterization of Lyon rammed earth. Density/moisture-dependent values must be supplied from the applicable specimen. Thickness 0.30 m is an example assumption; generic mud is unspecified.',
      url:'https://hal.science/hal-04301821'})
  ]);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const nice=(value,places=2)=>finite(value)?value.toLocaleString('en-GB',{maximumFractionDigits:places}):'Not evaluated';
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function requireNumber(value,label,min=-Infinity,max=Infinity){
    const number=typeof value==='string'&&value.trim()!==''?Number(value):typeof value==='number'?value:NaN;
    if(!finite(number)||number<min||number>max)throw new Error(`${label} must be a finite number${Number.isFinite(min)?` ≥ ${min}`:''}${Number.isFinite(max)?` and ≤ ${max}`:''}.`);
    return number;
  }
  function positive(value,label){
    const number=requireNumber(value,label,0);
    if(number===0)throw new Error(`${label} must be greater than zero.`);
    return number;
  }
  function fingerprint(value){
    const text=JSON.stringify(value);let hash=2166136261;
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return (hash>>>0).toString(16);
  }
  function siteKey(project){return JSON.stringify([project.id,project.site.latitude,project.site.longitude,project.site.timeZone]);}
  function geometryKey(project,scenes){
    return fingerprint({projectId:project.id,site:project.site,building:project.building,
      activeFloorId:project.activeFloorId,floors:project.floors.map(f=>({id:f.id,heightM:f.heightM})),
      scenes:scenes.map(s=>({floorId:s.floorId,headingDeg:s.headingDeg,floor:s.floor,building:s.building,
        floorElevationM:s.floorElevationM,wallHeightM:s.wallHeightM,rooms:s.rooms,walls:s.walls,openings:s.openings,obstacles:s.obstacles}))});
  }
  function dateParts(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');
    if(!match)throw new Error('Choose complete start and end calendar dates.');
    const date=new Date(0);
    date.setUTCFullYear(+match[1],+match[2]-1,+match[3]);date.setUTCHours(0,0,0,0);
    if(date.getUTCFullYear()!==+match[1]||date.getUTCMonth()+1!==+match[2]||date.getUTCDate()!==+match[3])
      throw new Error('Choose real calendar dates for the historical period.');
    return date;
  }
  function buildArchiveRequest(site,startDate,endDate,Sun,now=new Date()){
    requireNumber(site.latitude,'Latitude',-90,90);requireNumber(site.longitude,'Longitude',-180,180);
    if(!Sun||typeof Sun.resolveLocal!=='function')throw new Error('The local HomeSun time-zone adapter is unavailable.');
    const first=dateParts(startDate),last=dateParts(endDate);
    const days=(last-first)/DAY+1;
    if(days<1||days>366)throw new Error('Request 1–366 local calendar days at a time; use local files for longer records.');
    if(first.getUTCFullYear()<1940)throw new Error('ERA5 archive requests in this workspace start in 1940.');
    const next=new Date(last.getTime()+DAY).toISOString().slice(0,10);
    const start=Sun.resolveLocal(startDate,'00:00',site.timeZone).instant;
    const end=Sun.resolveLocal(next,'00:00',site.timeZone).instant;
    if(end.getTime()>now.getTime()-5*DAY)throw new Error('ERA5 has a publication delay. Choose an end date at least six days before today, or import a local file.');
    const params=new URLSearchParams({latitude:String(site.latitude),longitude:String(site.longitude),
      start_date:start.toISOString().slice(0,10),end_date:end.toISOString().slice(0,10),
      hourly:'temperature_2m,relative_humidity_2m,surface_pressure,direct_normal_irradiance,diffuse_radiation,shortwave_radiation,wind_speed_10m,wind_direction_10m',
      models:'era5',timezone:'UTC',timeformat:'unixtime',wind_speed_unit:'ms',temperature_unit:'celsius'});
    return {url:`https://archive-api.open-meteo.com/v1/archive?${params}`,startUTC:start.toISOString(),endUTC:end.toISOString(),
      startDate,endDate,site:{...site},model:'era5',intervalConvention:'UTC interval ends; radiation means for the preceding hour',
      coordinateDisclosure:'Only latitude, longitude, date bounds and weather-variable parameters are sent. No plan, materials or occupancy.'};
  }
  function trimWeatherToInterval(weather,request){
    const start=Date.parse(request.startUTC),end=Date.parse(request.endUTC);
    const records=weather.records.filter(row=>{
      const t=Date.parse(row.timestamp);return t>start&&t-row.durationSeconds*1000<end;
    }).map(row=>({...row,requestedOverlapSeconds:(Math.min(Date.parse(row.timestamp),end)-
      Math.max(Date.parse(row.timestamp)-row.durationSeconds*1000,start))/1000}));
    if(!records.length)throw new Error('The provider returned no intervals overlapping the requested local dates.');
    const warnings=[...weather.warnings];
    if(records.some(row=>row.requestedOverlapSeconds!==row.durationSeconds))
      warnings.push('Local date boundaries cut through UTC hours. Boundary records retain their complete source interval; requestedOverlapSeconds records the overlap. Do not sum entire boundary hours as local-day energy.');
    const sorted=[...records].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
    const overlapHours=records.reduce((sum,row)=>sum+row.requestedOverlapSeconds/3600,0);
    if(Math.abs(overlapHours-(end-start)/HOUR)>0.001)
      warnings.push('Returned intervals do not cover the whole requested UTC window; review provider coverage and missing data.');
    return {...weather,records,warnings,source:{...weather.source,request:copy(request),label:'Open-Meteo ERA5 historical reanalysis'},
      kind:'reanalysis',coverage:{...weather.coverage,startUTC:new Date(Date.parse(sorted[0].timestamp)-sorted[0].durationSeconds*1000).toISOString(),
        endUTC:sorted[sorted.length-1].timestamp,recordCount:records.length,
        intervalHours:records.reduce((sum,row)=>sum+row.durationSeconds/3600,0),
        requestedStartUTC:request.startUTC,requestedEndUTC:request.endUTC,requestedOverlapHours:overlapHours}};
  }
  function outwardNormal(wall,scene){
    const dx=wall.end.x-wall.start.x,dy=wall.end.y-wall.start.y,length=Math.hypot(dx,dy);
    if(!length)return null;
    const room=scene.rooms.find(r=>wall.roomIds.includes(r.id));
    if(!room)return null;
    const center={x:room.rect.x+room.rect.w/2,y:room.rect.y+room.rect.h/2};
    let x=-dy/length,y=dx/length;
    if(x*((wall.start.x+wall.end.x)/2-center.x)+y*((wall.start.y+wall.end.y)/2-center.y)<0){x=-x;y=-y;}
    const h=scene.headingDeg*Math.PI/180;
    return {x,y,east:x*Math.cos(h)-y*Math.sin(h),north:-(x*Math.sin(h)+y*Math.cos(h))};
  }
  function nominalArea(opening){
    return opening.widthM*opening.heightM*opening.openFraction;
  }
  function availableOffset(wall,scene,width){
    const length=Math.hypot(wall.end.x-wall.start.x,wall.end.y-wall.start.y),margin=.1;
    const occupied=scene.openings.filter(o=>o.wallId===wall.id).map(o=>[o.offsetM-margin,o.offsetM+o.widthM+margin]).sort((a,b)=>a[0]-b[0]);
    let cursor=margin;
    for(const [start,end] of [...occupied,[length-margin,length]]){
      if(start-cursor>=width)return cursor+(start-cursor-width)/2;
      cursor=Math.max(cursor,end);
    }
    return null;
  }
  function buildWindowRecommendations(scene,options){
    if(!scene||!Array.isArray(scene.walls)||!Array.isArray(scene.openings))throw new Error('A valid active-floor scene is needed for window proposals.');
    const bearing=requireNumber(options.windFromDeg,'Wind FROM bearing',0,360)%360;
    const width=positive(options.widthM,'Proposed width'),height=positive(options.heightM,'Proposed height');
    const sill=requireNumber(options.sillM,'Proposed sill',0),fraction=requireNumber(options.openFraction,'Proposed open fraction',0,1);
    const radians=bearing*Math.PI/180,wind={east:Math.sin(radians),north:Math.cos(radians)};
    const walls=new Map(scene.walls.map(w=>[w.id,w]));
    const alignment=wall=>{
      const normal=outwardNormal(wall,scene);return normal?normal.east*wind.east+normal.north*wind.north:null;
    };
    const graph=new Map(scene.rooms.map(r=>[r.id,[]]));
    scene.openings.forEach(o=>{
      if(!o.exterior&&nominalArea(o)>0&&graph.has(o.roomId)&&graph.has(o.targetRoomId)){
        graph.get(o.roomId).push({id:o.id,room:o.targetRoomId,area:nominalArea(o)});
        graph.get(o.targetRoomId).push({id:o.id,room:o.roomId,area:nominalArea(o)});
      }
    });
    function findPath(start,outlet){
      const queue=[{room:start,roomIds:[start],openingIds:[],area:Infinity}],seen=new Set([start]);
      for(let i=0;i<queue.length;i++){
        const node=queue[i];
        if(node.room===outlet.roomId)return {...node,openingIds:[...node.openingIds,outlet.id],area:Math.min(node.area,nominalArea(outlet))};
        for(const edge of graph.get(node.room)||[]){
          if(!seen.has(edge.room)){
            seen.add(edge.room);queue.push({room:edge.room,roomIds:[...node.roomIds,edge.room],
              openingIds:[...node.openingIds,edge.id],area:Math.min(node.area,edge.area)});
          }
        }
      }
      return null;
    }
    const proposals=[];
    for(const wall of scene.walls){
      if(!wall.exterior||wall.removed||wall.roomIds.length!==1||sill+height>wall.heightM)continue;
      const dot=alignment(wall),offset=availableOffset(wall,scene,width);
      if(dot===null||Math.abs(dot)<.35||offset===null)continue;
      const room=scene.rooms.find(r=>r.id===wall.roomIds[0]);
      if(!room||room.service||/toilet|bath|kitchen|garage/i.test(`${room.type} ${room.label}`))continue;
      const opposite=scene.openings.filter(o=>{
        const host=walls.get(o.wallId);
        if(!o.exterior||nominalArea(o)<=0||!host||host.id===wall.id)return false;
        const other=alignment(host);return other!==null&&dot*other<-.1;
      });
      const paths=opposite.map(outlet=>findPath(room.id,outlet)).filter(Boolean);
      const cleanPaths=paths.filter(path=>path.roomIds.every(id=>{
        const r=scene.rooms.find(item=>item.id===id);
        return r&&!r.service&&!/toilet|bath|kitchen|garage/i.test(`${r.type} ${r.label}`);
      }));
      cleanPaths.sort((a,b)=>b.area-a.area||a.openingIds.length-b.openingIds.length);
      const path=cleanPaths[0]||null,role=dot>0?'Windward candidate':'Leeward candidate';
      const pathText=path?`Connected operating path through ${path.roomIds.map(id=>scene.rooms.find(r=>r.id===id).label).join(' → ')} to an opposite-facing exterior opening.`
        :'No clean, connected operating path to an opposite-facing exterior opening was found. Adding this alone does not establish cross-ventilation.';
      proposals.push({id:`${wall.id}-${bearing}`,wallId:wall.id,roomId:room.id,roomLabel:room.label,
        role,alignment:dot,windFromDeg:bearing,path,reason:`${role} for wind FROM ${nice(bearing)}°; exterior wall normal alignment ${nice(dot,2)}. ${pathText}`,
        command:{type:'add-window',wallId:wall.id,offsetM:offset,widthM:width,sillM:sill,heightM:height,openFraction:fraction},
        cautions:['Schematic orientation/path screening, not pressure, ACH, airspeed or CFD.',
          'Review structure, setbacks/fire separation, rain, noise, pollution, privacy, security and fall protection.',
          'Nearby buildings/trees may shelter this opening or create wakes. Those wind effects are not resolved by this normal/path screen.',
          'Internal doors may be shut at night. Free area uses rectangle × operating fraction; frames/screens and aerodynamic losses are not inferred.',
          ...(paths.length&&!cleanPaths.length?['A possible path crosses a service room; avoid dirty-to-clean contaminant transfer.']:[])]});
    }
    return proposals.sort((a,b)=>Number(!!b.path)-Number(!!a.path)||Math.abs(b.alignment)-Math.abs(a.alignment)).slice(0,6);
  }
  function buildAirflowTemplate(scene){
    if(!scene)throw new Error('A valid active-floor scene is needed to prepare the pressure network.');
    const roomIds=new Set(scene.rooms.map(r=>r.id));
    const links=scene.openings.filter(o=>roomIds.has(o.roomId)&&(o.exterior||roomIds.has(o.targetRoomId))).map(o=>({
      id:o.id,from:o.exterior?'outside':o.roomId,to:o.exterior?o.roomId:o.targetRoomId,
      freeAreaM2:nominalArea(o),cd:null,pressurePa:null
    }));
    return {zones:scene.rooms.map(r=>({id:r.id,volumeM3:r.rect.w*r.rect.h*scene.wallHeightM})),
      links,outsideId:'outside',densityKgM3:null};
  }
  function buildThermalTemplate(scene){
    if(!scene)throw new Error('A valid active-floor scene is needed to prepare the thermal zones.');
    const pairs=new Map(),ids=new Set(scene.rooms.map(r=>r.id));
    scene.walls.forEach(w=>{
      if(!w.exterior&&w.roomIds.length===2&&w.roomIds.every(id=>ids.has(id))){
        const key=[...w.roomIds].sort().join('|');pairs.set(key,{from:w.roomIds[0],to:w.roomIds[1],conductanceW_K:null});
      }
    });
    return {zones:scene.rooms.map(r=>({id:r.id,capacityJ_K:null,initialC:null,outsideConductanceW_K:null})),
      links:[...pairs.values()],steps:[{durationSeconds:3600,outdoorC:null,gainsW:Object.fromEntries(scene.rooms.map(r=>[r.id,null]))}]};
  }
  function validatePressureInput(input,scene){
    if(!object(input)||!Array.isArray(input.zones)||!input.zones.length||!Array.isArray(input.links))
      throw new Error('Provide zones and links arrays for the pressure network.');
    positive(input.densityKgM3,'Explicit air density');
    if(input.outsideId!=='outside')throw new Error('Use outsideId "outside" for the scene-linked pressure network.');
    const template=buildAirflowTemplate(scene),allowedZones=new Set(template.zones.map(z=>z.id));
    input.zones.forEach(z=>{
      if(!allowedZones.has(z.id))throw new Error(`Pressure zone ${z.id} is not a room on this floor. Rebuild the template.`);
      positive(z.volumeM3,`Zone ${z.id} volume`);
    });
    input.links.forEach(link=>{
      const opening=template.links.find(o=>o.id===link.id);
      if(!opening||link.from!==opening.from||link.to!==opening.to)throw new Error(`Link ${link.id} does not match an actual opening and its connected rooms. Rebuild the template.`);
      requireNumber(link.freeAreaM2,`Link ${link.id} free area`,0,opening.freeAreaM2+1e-9);
      positive(link.cd,`Link ${link.id} Cd`);requireNumber(link.cd,`Link ${link.id} Cd`,0,1);
      requireNumber(link.pressurePa,`Link ${link.id} signed imposed pressure`);
    });
    return input;
  }
  function validateThermalInput(input,scene){
    if(!object(input)||!Array.isArray(input.zones)||!input.zones.length||!Array.isArray(input.links)||
       !Array.isArray(input.steps)||!input.steps.length)throw new Error('Thermal input needs nonempty zones/steps arrays and a links array.');
    const allowed=new Set(scene.rooms.map(r=>r.id));
    input.zones.forEach(z=>{
      if(!allowed.has(z.id))throw new Error(`Thermal zone ${z.id} is not a room on the active floor. Rebuild or review the template.`);
      positive(z.capacityJ_K,`Zone ${z.id} capacity`);requireNumber(z.initialC,`Zone ${z.id} initial temperature`,-100,100);
      requireNumber(z.outsideConductanceW_K,`Zone ${z.id} outside conductance`,0);
    });
    input.links.forEach(link=>requireNumber(link.conductanceW_K,'Inter-zone conductance',0));
    input.steps.forEach((step,i)=>{
      positive(step.durationSeconds,`Step ${i+1} duration`);requireNumber(step.outdoorC,`Step ${i+1} outdoor temperature`,-100,100);
      if(!object(step.gainsW))throw new Error(`Step ${i+1} needs an explicit gainsW value for every zone, including zero.`);
      input.zones.forEach(z=>requireNumber(step.gainsW[z.id],`Step ${i+1}, zone ${z.id}, net gains`));
    });
    return input;
  }
  function warnList(items){
    return items?.length?`<ul class="env-warnings">${[...new Set(items)].map(message=>`<li>${esc(typeof message==='string'?message:JSON.stringify(message))}</li>`).join('')}</ul>`:'';
  }
  function table(headers,rows,caption){
    return `<div class="env-table-wrap" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="env-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function planSVG(scene,shadow,proposal){
    const obstacles=scene.obstacles||[],floor=scene.floor;
    const xs=[floor.x,floor.x+floor.w,...obstacles.flatMap(o=>[o.x,o.x+o.w])];
    const ys=[floor.y,floor.y+floor.h,...obstacles.flatMap(o=>[o.y,o.y+o.h])];
    const minX=Math.min(...xs)-2,minY=Math.min(...ys)-2,width=Math.max(...xs)-minX+2,height=Math.max(...ys)-minY+2;
    const scale=Math.max(width,height)/42;
    const polygons=(shadow?.groundPolygons||[]).map(p=>`<polygon class="env-shadow" points="${p.points.map(v=>`${v.x},${v.y}`).join(' ')}"><title>${esc(p.obstacleId)} — computed ground projection</title></polygon>`).join('');
    const rooms=scene.rooms.map(r=>`<g><rect class="env-room" x="${r.rect.x}" y="${r.rect.y}" width="${r.rect.w}" height="${r.rect.h}"/><text class="env-svg-label" x="${r.rect.x+r.rect.w/2}" y="${r.rect.y+r.rect.h/2}" font-size="${scale*.8}" text-anchor="middle">${esc(r.label)}</text></g>`).join('');
    const walls=scene.walls.filter(w=>!w.removed).map(w=>{
      const length=Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y);
      const segments=w.solidSegments||[{startM:0,endM:length}];
      return segments.map(s=>`<line class="env-wall" x1="${w.start.x+(w.end.x-w.start.x)*s.startM/length}" y1="${w.start.y+(w.end.y-w.start.y)*s.startM/length}" x2="${w.start.x+(w.end.x-w.start.x)*s.endM/length}" y2="${w.start.y+(w.end.y-w.start.y)*s.endM/length}" stroke-width="${w.thicknessM}"/>`).join('');
    }).join('');
    const openings=scene.openings.map(o=>`<line class="${o.kind==='window'?'env-window':'env-opening'}" x1="${o.segment.x1}" y1="${o.segment.y1}" x2="${o.segment.x2}" y2="${o.segment.y2}" stroke-width="${scale*.14}"><title>${esc(o.id)}; ${nice(o.openFraction*100)}% operating open</title></line>`).join('');
    const blockers=obstacles.map(o=>`<g><rect class="${o.type==='tree'?'env-tree':'env-obstacle'}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"/><title>${esc(o.label)}; ${nice(o.heightM)} m height; base ${nice(o.baseM)} m; beam transmittance ${nice(o.transmittance)}</title></g>`).join('');
    let preview='';
    if(proposal){
      const w=scene.walls.find(wall=>wall.id===proposal.wallId);
      if(w){
        const len=Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y),cmd=proposal.command;
        const at=offset=>({x:w.start.x+(w.end.x-w.start.x)*offset/len,y:w.start.y+(w.end.y-w.start.y)*offset/len});
        const a=at(cmd.offsetM),b=at(cmd.offsetM+cmd.widthM);
        preview=`<line class="env-proposed" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="${scale*.4}"><title>Proposed new window, not yet applied</title></line>`;
      }
    }
    const h=scene.headingDeg*Math.PI/180,nx=-Math.sin(h),ny=-Math.cos(h);
    const ax=minX+width-2.4*scale,ay=minY+2.8*scale;
    return `<svg class="env-plan" role="img" aria-label="${esc(`Local floor plan at elevation ${nice(scene.floorElevationM)} m, true north ${nice(scene.headingDeg)} degree front bearing. ${shadow?'Computed ground shadows, clipped to view.':'Geometry only, not a shadow calculation.'}`)}" viewBox="${minX} ${minY} ${width} ${height}">
      <rect class="env-plot" x="${floor.x}" y="${floor.y}" width="${floor.w}" height="${floor.h}"/>${polygons}${rooms}${blockers}${walls}${openings}${preview}
      <line class="env-north" x1="${ax}" y1="${ay}" x2="${ax+nx*1.5*scale}" y2="${ay+ny*1.5*scale}" stroke-width="${scale*.12}"/>
      <text class="env-svg-label" x="${ax+nx*2*scale}" y="${ay+ny*2*scale}" text-anchor="middle" font-size="${scale}">N</text>
    </svg>`;
  }

  function markup(){
    const input=(id,label,type='number',value='',extra='')=>`<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value)}" ${type==='number'&&!/\bstep=/.test(extra)?'step="any"':''} ${extra}>`;
    return `<!-- THESIS: A local-first environmental workbench; every result sits beside its assumptions.
      OWN-WORLD: Existing HomePlanner neutral panels, blue action accents, system typography, and theme tokens.
      STORY: Confirm site and geometry, bring identified weather, then compare stated analytical scenarios.
      FIRST VIEWPORT: A compact context column beside a large geometry/solar work area; manual entry remains the primary path.
      FORM: Operate-mode extension of the existing planner. No replacement identity or external assets. -->
      <div class="env-heading"><div><h2>Environment</h2><p>Geometry, weather and explainable scenarios. Not a certified energy, comfort or structural assessment.</p></div>
        <span class="env-local-label">Local-first · no automatic weather requests</span></div>
      <nav class="env-nav" aria-label="Environment sections"><a href="#env-site-section">Site &amp; context</a><a href="#env-solar-section">Sun &amp; shade</a><a href="#env-weather-section">Weather</a><a href="#env-envelope-section">Envelope</a><a href="#env-wind-section">Wind &amp; windows</a><a href="#env-models-section">Reduced models</a><a href="#env-export-section">Export</a></nav>
      <p id="env-global-status" class="env-status" role="status"></p>
      <div class="env-layout"><aside class="env-context">
        <section id="env-site-section" class="env-panel" aria-labelledby="env-site-heading">
          <h3 id="env-site-heading">Building site</h3><p id="env-site-status" class="env-warning"></p>
          <form id="env-site-form"><div class="env-fields">
            <div>${input('env-lat','Latitude · north +','number','','min="-90" max="90" required')}</div>
            <div>${input('env-lon','Longitude · east +','number','','min="-180" max="180" required')}</div>
          </div>${input('env-zone','IANA time zone','text','Asia/Kolkata','required spellcheck="false"')}
            <label class="env-check"><input id="env-site-verified" type="checkbox">I verified that these coordinates identify the building site.</label>
            <div class="env-actions"><button class="env-primary" type="submit">Save site</button><button id="env-detect" type="button">Detect current location</button></div>
          </form><p class="env-help">Detection runs only when clicked. Device position may not be the building; accuracy is shown. Time zone stays manual. No reverse geocoding.</p>
          <p id="env-site-error" class="env-error" role="alert" hidden></p>
          <details class="env-details"><summary>Assumed building dimensions</summary>
            <form id="env-building-form"><div class="env-fields">
              <div>${input('env-wall-height','Active-floor wall height (m)','number','','min="0.1" required')}</div>
              <div>${input('env-base','Building base elevation (m)','number','','required')}</div>
              <div>${input('env-roof','Roof/slab thickness (m)','number','','min="0" required')}</div>
            </div><label class="env-check"><input id="env-geometry-ack" type="checkbox">I reviewed these preview assumptions. They are not surveyed dimensions.</label>
              <button type="submit">Save building dimensions</button></form>
            <form id="env-storey-form">${input('env-storey','Active storey floor-to-floor height (m)','number','','min="0.1" required')}<button type="submit">Save storey height</button></form>
            <p class="env-help">Floor elevations stack from the building base using ordered storey heights. These controls do not specify structural adequacy or a calibrated thermal model.</p>
          </details>
        </section>
        <section class="env-panel" aria-labelledby="env-obstacle-heading"><h3 id="env-obstacle-heading">Nearby buildings &amp; trees</h3>
          <p class="env-help">Active-floor context; rectangles use local metres (x right, y rear). Base is an absolute vertical elevation. Tree transmittance is an assumed beam fraction, not a cooling value.</p>
          <div id="env-obstacle-list"></div>
          <details class="env-details" id="env-obstacle-editor"><summary>Add or edit an obstacle</summary>
            <form id="env-obstacle-form"><input id="env-obstacle-id" type="hidden">
              ${input('env-obstacle-label','Label','text','Nearby building','required maxlength="120"')}
              <label for="env-obstacle-type">Type</label><select id="env-obstacle-type"><option value="building">Building</option><option value="tree">Tree / canopy block</option></select>
              <div class="env-fields">
                <div>${input('env-obstacle-x','x (m)','number','0','required')}</div><div>${input('env-obstacle-y','y (m)','number','0','required')}</div>
                <div>${input('env-obstacle-w','Width x (m)','number','3','min="0.01" required')}</div><div>${input('env-obstacle-h','Depth y (m)','number','3','min="0.01" required')}</div>
                <div>${input('env-obstacle-height','Height (m)','number','6','min="0.01" required')}</div><div>${input('env-obstacle-base','Base elevation (m)','number','0','required')}</div>
                <div>${input('env-obstacle-trans','Beam transmittance (0–1)','number','0','min="0" max="1" required')}</div>
              </div><div class="env-actions"><button type="submit">Save obstacle</button><button id="env-obstacle-new" type="button">New rectangle</button></div>
            </form>
          </details><p id="env-obstacle-error" class="env-error" role="alert" hidden></p>
        </section>
        <section id="env-weather-section" class="env-panel" aria-labelledby="env-weather-heading"><h3 id="env-weather-heading">Weather source</h3>
          <p class="env-help">Import locally; no file or coordinates leave the browser. Source data is included in project exports and opt-in local project saves.</p>
          <label for="env-weather-file">EPW or weather JSON (up to 20 MB)</label><input id="env-weather-file" type="file" accept=".epw,.json,text/plain,application/json">
          <div class="env-actions"><button id="env-weather-template" type="button">JSON format example</button><button id="env-weather-clear" type="button">Clear weather</button></div>
          <div id="env-weather-summary"></div>
          <label for="env-weather-kind">Classification from source evidence</label><select id="env-weather-kind">
            <option value="unclassified">Not confirmed</option><option value="historical">Historical observations</option><option value="reanalysis">Historical reanalysis</option><option value="tmy">Synthetic typical year (TMY)</option><option value="forecast">Forecast</option><option value="scenario">Hypothetical scenario</option>
          </select><button id="env-weather-classify" type="button">Save classification</button>
          <details class="env-details"><summary>Optional online historical weather</summary>
            <p>Open-Meteo sends the coordinates and dates below to its servers; requests may be logged. ERA5 is gridded reanalysis, not a house sensor. Free API access is non-commercial and quota-limited; data requires attribution.</p>
            <p><a href="https://open-meteo.com/en/terms" target="_blank" rel="noopener noreferrer">Provider terms</a> · <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener noreferrer">Data documentation</a></p>
            <form id="env-fetch-form"><div class="env-fields"><div>${input('env-weather-start','First local date','date','','required')}</div><div>${input('env-weather-end','Last local date (inclusive)','date','','required')}</div></div>
              <p id="env-request-summary" class="env-help"></p>
              <label class="env-check"><input id="env-fetch-consent" type="checkbox">I accept the provider terms and consent to sending this site's coordinates and dates for this request.</label>
              <div class="env-actions"><button id="env-fetch" class="env-primary" type="submit">Fetch ERA5 history</button><button id="env-fetch-cancel" type="button" disabled>Cancel request</button></div>
            </form><p class="env-help">One 1–366-day request; no API keys, auto-fetch, retries or slider requests. At least six days of publication delay. Import/offline mode remains available after errors.</p>
          </details><p id="env-weather-status" class="env-status" role="status"></p><p id="env-weather-error" class="env-error" role="alert" hidden></p>
        </section>
      </aside><div class="env-analysis">
        <section id="env-solar-section" class="env-panel" aria-labelledby="env-solar-heading"><div class="env-section-heading"><h3 id="env-solar-heading">Sun &amp; geometry</h3><span id="env-floor-label" class="env-help"></span></div>
          <p class="env-help">The existing local SunCalc/HomeSun engine supplies the sun vector. Shadow geometry is independent of weather. A shaded façade is not a daylight-lux or room-temperature result.</p>
          <form id="env-solar-form"><div class="env-fields env-fields-wide">
            <div>${input('env-solar-date','Site calendar date','date','','required')}</div><div>${input('env-solar-time','Site clock time','time','12:00','required')}</div>
            <div><label for="env-solar-occurrence">Repeated DST clock time</label><select id="env-solar-occurrence"><option value="">Ask if ambiguous</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></div>
            <div><label for="env-solar-scope">Floors</label><select id="env-solar-scope"><option value="active">Active floor</option><option value="all">All floor scenes (separate)</option></select></div>
          </div><div class="env-fields env-fields-wide">
            <div><label for="env-radiation-mode">Radiation inputs</label><select id="env-radiation-mode"><option value="none">Geometry only</option><option value="manual">Explicit hypothetical irradiance</option><option value="weather">Imported weather at this instant</option></select></div>
            <div>${input('env-dni','DNI (W/m²)','number','','min="0" max="1600"')}</div><div>${input('env-dhi','DHI (W/m²)','number','','min="0" max="1500"')}</div>
            <div>${input('env-ghi','GHI (W/m²)','number','','min="0" max="2000"')}</div><div>${input('env-albedo','Ground albedo · assumed','number','0.2','min="0" max="1"')}</div>
          </div><div class="env-actions"><button class="env-primary" type="submit">Calculate sun &amp; exposure</button><button id="env-monthly" type="button">Compare monthly 09 / 12 / 15</button></div></form>
          <div class="env-record-picker">${input('env-record-index','Weather record number (1-based)','number','1','min="1" step="1"')}<button id="env-use-record" type="button">Use record midpoint as solar time</button></div>
          <p id="env-solar-error" class="env-error" role="alert" hidden></p><p id="env-solar-status" class="env-status" role="status"></p>
          <div id="env-solar-view"></div><div id="env-solar-results"></div><div id="env-monthly-results"></div>
        </section>
        <section id="env-envelope-section" class="env-panel" aria-labelledby="env-envelope-heading"><h3 id="env-envelope-heading">Envelope comparisons</h3>
          <p>Layer resistance and areal heat capacity are descriptors, not a prediction of indoor temperature or peak delay. Clay brick, AAC and a specified earth material are different records; “mud” alone is underspecified.</p>
          <form id="env-material-form">
            <div class="env-actions"><label for="env-material-preset">Sourced example</label><select id="env-material-preset">${MATERIAL_PRESETS.map(p=>`<option value="${p.id}">${esc(p.label)}</option>`).join('')}</select><button id="env-material-use" type="button">Replace layers with example</button><button id="env-material-add" type="button">Add layer</button></div>
            <p id="env-material-source" class="env-help"></p><div id="env-material-layers"></div>
            <div class="env-fields"><div>${input('env-film-in','Inside film R (m² K/W) · assumed','number','0.13','min="0" required')}</div><div>${input('env-film-out','Outside film R (m² K/W) · assumed','number','0.04','min="0" required')}</div><div>${input('env-compare-thickness','Equal-thickness preset comparison (m)','number','0.2','min="0.001" required')}</div></div>
            <button class="env-primary" type="submit">Evaluate stated assemblies</button>
          </form><p id="env-material-error" class="env-error" role="alert" hidden></p><div id="env-material-results"></div>
          <details class="env-details"><summary>Separate whole-window glazing inputs</summary>
            <form id="env-glazing-form"><div class="env-fields">
              <div>${input('env-glazing-u','Whole-window U (W/m² K)','number','','min="0.01" required')}</div>
              <div>${input('env-glazing-shgc','SHGC (0–1)','number','','min="0" max="1" required')}</div>
              <div>${input('env-glazing-vlt','Visible transmittance / VLT (0–1)','number','','min="0" max="1" required')}</div>
            </div>${input('env-glazing-source','Product / test / assumption source','text','','required')}<button type="submit">Save glazing inputs</button></form>
            <p class="env-help">Glass conductivity/thickness is not whole-window U. VLT is not SHGC. With explicit SHGC and incident radiation, the exposure table can show constant-SHGC glazing solar-gain screening; no angular/frame model or lux claim.</p>
            <p id="env-glazing-status" class="env-status"></p><p id="env-glazing-error" class="env-error" role="alert" hidden></p>
          </details>
        </section>
      </div></div>
      <section id="env-wind-section" class="env-panel" aria-labelledby="env-wind-heading"><h3 id="env-wind-heading">Wind rose &amp; window placement</h3>
        <p>Weather wind is FROM true north at its source reference height. Schematic paths use actual exterior walls and operating openings; glazing is not an open aperture. No mean vector hides opposing seasonal winds.</p>
        <form id="env-wind-form"><div class="env-fields env-fields-wide">
          <div><label for="env-wind-source">Wind scenario</label><select id="env-wind-source"><option value="weather">Imported records</option><option value="manual">Hypothetical wind</option></select></div>
          <div>${input('env-wind-bearing','Hypothetical FROM bearing (°)','number','','min="0" max="360"')}</div><div>${input('env-wind-speed','Hypothetical speed (m/s)','number','','min="0" max="150"')}</div>
          <div><label for="env-wind-month">Month / season</label><select id="env-wind-month"><option value="">All months</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">${new Intl.DateTimeFormat('en-GB',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2024,i,15)))}</option>`).join('')}<option value="12,1,2">Dec–Feb</option><option value="3,4,5">Mar–May</option><option value="6,7,8">Jun–Aug</option><option value="9,10,11">Sep–Nov</option></select></div>
          <div><label for="env-wind-hours">Clock-hour filter</label><select id="env-wind-hours"><option value="all">All hours</option><option value="day">Daytime clock window</option><option value="night">Outside that window</option></select></div>
          <div>${input('env-wind-day-start','Window starts (hour)','number','6','min="0" max="23.99"')}</div><div>${input('env-wind-day-end','Window ends (hour)','number','18','min="0" max="24"')}</div>
          <div>${input('env-wind-calm','Calm below (m/s)','number','0.5','min="0" max="150"')}</div>
          <div><label for="env-wind-clock">Time basis</label><select id="env-wind-clock"><option value="site">Site IANA clock</option><option value="file">File fixed standard-time offset</option></select></div>
        </div><details class="env-details"><summary>Proposed window dimensions (not applied automatically)</summary><div class="env-fields env-fields-wide">
          <div>${input('env-window-width','Width (m)','number','1.2','min="0.1" required')}</div><div>${input('env-window-sill','Sill (m)','number','0.9','min="0" required')}</div>
          <div>${input('env-window-height','Height (m)','number','1.2','min="0.1" required')}</div><div>${input('env-window-open','Operating open fraction','number','0.5','min="0" max="1" required')}</div>
        </div></details><button class="env-primary" type="submit">Build rose &amp; explain proposals</button></form>
        <p id="env-wind-error" class="env-error" role="alert" hidden></p><p id="env-wind-status" class="env-status" role="status"></p>
        <div class="env-wind-layout"><div id="env-wind-rose"></div><div id="env-window-proposals"></div></div><div id="env-window-preview"></div>
      </section>
      <section id="env-models-section" class="env-panel" aria-labelledby="env-models-heading"><h3 id="env-models-heading">Reduced analytical experiments</h3>
        <p class="env-warning">Not evaluated until every required input is supplied and the experimental assumptions are acknowledged. These are not actual site temperatures, CFD, occupant airspeed, health guidance or compliance results.</p>
        <div class="env-model-layout">
          <details class="env-details"><summary>Pressure network · opening flow estimates</summary><p>Build from the active scene, then supply density, Cd and signed imposed from→to pressure for every link. The template's rectangle × operating fraction is only a maximum free area; enter frame/screen losses explicitly. No Cp/Cd or wind-height correction is inferred.</p>
            <button id="env-pressure-template" type="button">Prepare from current openings</button>
            <form id="env-pressure-form"><label for="env-pressure-input">Contract input JSON · null means required, not zero</label><textarea id="env-pressure-input" rows="14" spellcheck="false"></textarea>
              <label for="env-pressure-notes">Pressure/Cd sources, operating state and limitations</label><textarea id="env-pressure-notes" rows="3" required></textarea>
              <label class="env-check"><input id="env-pressure-ack" type="checkbox">I reviewed room volumes, opening mapping, all pressure/discharge assumptions and the limitations of this uncalibrated steady one-way network.</label>
              <div class="env-actions"><button id="env-pressure-save" type="button">Save unevaluated draft</button><button class="env-primary" type="submit">Solve stated pressure network</button></div></form>
            <p id="env-pressure-error" class="env-error" role="alert" hidden></p><div id="env-pressure-result"></div>
          </details>
          <details class="env-details"><summary>Thermal network · sensible RC scenario</summary><p>Supply total effective zone capacity (J/K), initial temperature, outside/inter-zone conductance, timed outdoor temperature and explicit net gains for every zone. The template does not invent occupants, thermal mass, leakage, solar absorption, schedules, HVAC or weather.</p>
            <button id="env-thermal-template" type="button">Prepare room input template</button>
            <form id="env-thermal-form"><label for="env-thermal-input">Contract input JSON · replace each required null</label><textarea id="env-thermal-input" rows="14" spellcheck="false"></textarea>
              <label for="env-thermal-notes">Capacity/conductance/gain sources, operation and omissions</label><textarea id="env-thermal-notes" rows="3" required></textarea>
              <label class="env-check"><input id="env-thermal-ack" type="checkbox">I supplied complete conditions and understand this experimental sensible-only RC result is not a site temperature forecast. No humidity, comfort, moisture, automatic airflow coupling or calibrated warmup is provided.</label>
              <div class="env-actions"><button id="env-thermal-save" type="button">Save unevaluated draft</button><button class="env-primary" type="submit">Simulate stated RC scenario</button></div></form>
            <p id="env-thermal-error" class="env-error" role="alert" hidden></p><div id="env-thermal-result"></div>
          </details>
        </div>
      </section>
      <section id="env-export-section" class="env-panel" aria-labelledby="env-export-heading"><h3 id="env-export-heading">Analysis record &amp; expert handoff</h3>
        <p>Download a versioned local JSON record of site, all floor scenes, constructions, weather provenance, stated solver inputs, outputs and omitted physics. Geometry and coordinate data remain local. This is not an EnergyPlus input file, CFD mesh or evidence of an external solver run.</p>
        <div class="env-actions"><button id="env-export" class="env-primary" type="button">Export analysis inputs &amp; results</button><button id="env-export-weather" type="button">Export normalized weather</button></div>
        <p id="env-export-error" class="env-error" role="alert" hidden></p><p id="env-export-status" class="env-status" role="status"></p>
        <details class="env-details"><summary>Read-only scene &amp; integration diagnostics</summary><div id="env-diagnostics"></div></details>
      </section>`;
  }

  function mount(element=root.document?.getElementById('environmentWorkspace'),planner=root.HomePlanner){
    if(!element||element.dataset.envMounted)return null;
    if(!planner){element.textContent='Environment needs the HomePlanner coordinator. Keep planner-bridge.js before environment-ui.js.';return null;}
    element.dataset.envMounted='true';element.classList.add('env-workspace');element.innerHTML=markup();
    const by=id=>element.querySelector(`#${id}`),Data=root.EnvironmentData,Sun=root.HomeSun;
    let previousProjectId=null,previousSiteKey=null,previousGeometryKey=null,previousWeatherId=null;
    let requestController=null,weatherOperation=0,locationOperation=0,monthlyOperation=0;
    let proposals=[],preview=null,proposalGeometryKey=null,solarResult=null,windResult=null;
    let pressureTemplateKey=null,thermalTemplateKey=null,lastMaterialLayers=[],destroyed=false;
    const scene=()=>planner.getScene();
    const scenes=()=>typeof planner.getScenes==='function'?planner.getScenes():[scene()].filter(Boolean);
    const currentGeometryKey=()=>geometryKey(planner.getProject(),scenes());
    const setStatus=(id,message)=>{by(id).textContent=message;};
    function showError(id,error){
      if(!(error instanceof Error)&&typeof error?.message!=='string')throw error;
      const target=by(id);target.textContent=error.message;target.hidden=false;
    }
    function clearError(id){by(id).hidden=true;by(id).textContent='';}
    async function action(errorId,work){
      clearError(errorId);
      try{await work();}
      catch(error){if(!destroyed)showError(errorId,error);}
    }
    function bindClick(id,errorId,work){by(id).addEventListener('click',()=>action(errorId,work));}
    function bindForm(id,errorId,work){
      by(id).addEventListener('submit',event=>{
        event.preventDefault();action(errorId,async()=>{await work();by(id).dataset.dirty='';});
      });
    }
    function saveEnvironment(patch){planner.execute({type:'set-environment',patch:{schemaVersion:1,...patch}});}
    function needPhysics(name){
      if(typeof root.BuildingPhysics?.[name]!=='function')throw new Error(`BuildingPhysics.${name} is unavailable. Load the local building-physics.js module before the workspace.`);
      return root.BuildingPhysics;
    }
    function needData(){
      if(!Data)throw new Error('The local environment-data.js module is unavailable. Weather import cannot be evaluated.');
      return Data;
    }
    function value(id){return by(id).value;}
    function number(id,label,min=-Infinity,max=Infinity){return requireNumber(value(id),label,min,max);}
    function requireAcknowledgement(id,message){if(!by(id).checked)throw new Error(message);}
    function parseInput(id){
      let result;
      try{result=JSON.parse(value(id));}
      catch(error){
        if(!(error instanceof SyntaxError))throw error;
        throw new Error('Scenario input is not valid JSON. Start with the scene template, then replace required null values.');
      }
      return result;
    }
    function storeResult(name,input,output,extra={}){
      const project=planner.getProject(),results=project.environment?.results||{};
      const entry={schemaVersion:1,calculatedAt:new Date().toISOString(),projectRevision:project.revision,
        geometryKey:currentGeometryKey(),geometrySnapshot:{site:copy(project.site),building:copy(project.building),scenes:copy(scenes())},
        input:copy(input),output:copy(output),...extra};
      saveEnvironment({results:{...results,[name]:entry}});
      return entry;
    }
    function cancelWeather(message='Request cancelled; existing weather was preserved.'){
      weatherOperation++;
      if(requestController){
        requestController.abort();requestController=null;by('env-fetch-consent').checked=false;
        setStatus('env-weather-status',message);
      }
      by('env-fetch').disabled=false;by('env-fetch-cancel').disabled=true;
    }
    function invalidateSolar(message){
      monthlyOperation++;solarResult=null;by('env-solar-results').innerHTML='';
      by('env-monthly-results').innerHTML='';setStatus('env-solar-status',message);
      const active=scene();
      by('env-solar-view').innerHTML=active?`<figure class="env-figure">${planSVG(active,null,null)}<figcaption>Current geometry only. Recalculate to show shadows for the selected inputs.</figcaption></figure>`:
        '<p class="env-empty">No valid floor scene is available for a current geometry view.</p>';
    }
    function invalidateWind(message){
      preview=null;proposals=[];proposalGeometryKey=null;
      by('env-window-preview').innerHTML='';by('env-window-proposals').innerHTML='';
      setStatus('env-wind-status',message);
    }
    function updateAvailability(){
      const radiation=value('env-radiation-mode'),manualWind=value('env-wind-source')==='manual';
      ['env-dni','env-dhi','env-ghi'].forEach(id=>{by(id).disabled=radiation!=='manual';});
      by('env-albedo').disabled=radiation==='none';
      ['env-wind-bearing','env-wind-speed'].forEach(id=>{by(id).disabled=!manualWind;});
      ['env-wind-month','env-wind-hours','env-wind-day-start','env-wind-day-end','env-wind-clock']
        .forEach(id=>{by(id).disabled=manualWind;});
    }
    const onInput=event=>{
      const form=event.target.closest('form');
      if(form)form.dataset.dirty='true';
      if(form?.id==='env-site-form'){
        locationOperation++;by('env-detect').disabled=false;
        cancelWeather('Site inputs changed; request cancelled, prior weather retained.');
        setStatus('env-site-status','Site fields edited but not saved. A pending device result will not replace these manual edits.');
      }
      if(form?.id==='env-fetch-form')cancelWeather('Request inputs/consent changed; prior request cancelled.');
      if(form?.id==='env-solar-form')invalidateSolar('Inputs changed. Recalculate to show a current result.');
      if(form?.id==='env-wind-form'){
        invalidateWind('Wind scenario changed. Rebuild the rose and proposals.');
        by('env-wind-rose').innerHTML='';
      }
      if(['env-radiation-mode','env-wind-source'].includes(event.target.id))updateAvailability();
      if(form?.id==='env-material-form')by('env-material-results').innerHTML='<p class="env-help">Layers changed; evaluate again.</p>';
      if(form?.id==='env-pressure-form')by('env-pressure-result').innerHTML='';
      if(form?.id==='env-thermal-form')by('env-thermal-result').innerHTML='';
    };
    element.addEventListener('input',onInput);

    function syncForm(id,values,force=false){
      const form=by(id);
      if(!force&&(form.dataset.dirty||form.contains(root.document.activeElement)))return;
      for(const [key,val] of Object.entries(values)){
        const field=by(key);
        if(field.type==='checkbox')field.checked=!!val;
        else field.value=val??'';
      }
      if(force)form.dataset.dirty='';
    }
    function renderObstacles(project){
      const obstacles=project.obstacles||[];
      by('env-obstacle-list').innerHTML=obstacles.length?`<ul class="env-item-list">${obstacles.map(o=>
        `<li><div><strong>${esc(o.label)}</strong><span>${esc(o.type)} · ${nice(o.w)} × ${nice(o.h)} m · height ${nice(o.heightM)} m</span></div>
        <div class="env-actions"><button type="button" data-env-obstacle-edit="${esc(o.id)}" aria-label="Edit ${esc(o.label)}">Edit</button><button type="button" data-env-obstacle-remove="${esc(o.id)}" aria-label="Remove ${esc(o.label)}">Remove</button></div></li>`).join('')}</ul>`:
        '<p class="env-help">No nearby obstacles specified. A clear site is an assumption, not a survey.</p>';
    }
    function renderWeather(project){
      const weather=project.environment?.weather;
      const available=Array.isArray(weather?.records)&&weather.records.length>0;
      by('env-weather-clear').disabled=!available;by('env-weather-classify').disabled=!available;
      by('env-weather-kind').disabled=!available;by('env-export-weather').disabled=!available;
      by('env-use-record').disabled=!available;by('env-record-index').max=available?weather.records.length:1;
      by('env-request-summary').textContent=`Request location: ${nice(project.site.latitude,5)}, ${nice(project.site.longitude,5)}. Inclusive local dates use ${project.site.timeZone} and are converted to UTC before requesting ERA5.`;
      if(!available){
        by('env-weather-summary').innerHTML='<p class="env-empty">No weather loaded. Astronomy, geometry and manual scenarios still work offline.</p>';
        by('env-weather-kind').value='unclassified';return;
      }
      by('env-weather-kind').value=weather.kind||'unclassified';
      const warnings=[...(weather.warnings||[])];
      if(finite(weather.latitude)&&finite(weather.longitude)&&
         (Math.abs(weather.latitude-project.site.latitude)>.05||Math.abs(weather.longitude-project.site.longitude)>.05))
        warnings.unshift('Weather station/grid coordinates differ from the project site. No site correction or microclimate downscaling is applied.');
      if(weather.kind==='tmy')warnings.unshift('TMY source years are not a real chronological history; this workspace does not automatically remap them to the solar year.');
      const durationSet=new Set(weather.records.map(r=>r.durationSeconds));
      if(durationSet.size>1)warnings.push('Intervals have mixed durations. The wind rose is record-count frequency, not hourly weighting.');
      const source=typeof weather.source==='string'?weather.source:weather.source?.label||weather.source?.provider||'Unlabelled weather source';
      const sourceUnits=Object.entries(weather.units||{}).map(([key,val])=>`${key}: ${val}`).join('; ');
      by('env-weather-summary').innerHTML=`<dl class="env-source-summary"><dt>Source</dt><dd>${esc(source)}</dd><dt>Coverage</dt><dd>${nice(weather.records.length,0)} records<br>${esc(weather.coverage?.startUTC||weather.records[0].timestamp)} → ${esc(weather.coverage?.endUTC||weather.records[weather.records.length-1].timestamp)}</dd><dt>Classification</dt><dd>${esc(weather.kind||'unclassified')}</dd><dt>Station / grid</dt><dd>${nice(weather.latitude,5)}, ${nice(weather.longitude,5)} (not detected site)</dd><dt>Reference wind height</dt><dd>${finite(weather.source?.windReferenceHeightM)?`${nice(weather.source.windReferenceHeightM)} m`:'Not identified by file; verify station metadata'}</dd></dl>
        <details class="env-details"><summary>Units, provenance &amp; ${warnings.length} warning${warnings.length===1?'':'s'}</summary><p class="env-help">${esc(sourceUnits)}</p><p>${esc(weather.timestampMeaning||'UTC interval-end records; verify source field timing.')}</p><p>${esc(weather.source?.license||'File rights/attribution must be verified by the owner.')}</p>${warnList(warnings)}<pre class="env-json">${esc(JSON.stringify(weather.source,null,2))}</pre></details>`;
    }
    function layerDraft(strict){
      return [...by('env-material-layers').querySelectorAll('[data-env-layer]')].map(row=>{
        const get=key=>row.querySelector(`[data-layer-field="${key}"]`).value;
        const numeric=(key,label)=>{
          const raw=get(key);
          return strict?positive(raw,label):raw.trim()===''?null:Number(raw);
        };
        return {label:get('label'),thicknessM:numeric('thicknessM','Layer thickness'),
          conductivityW_MK:numeric('conductivityW_MK','Conductivity k'),densityKgM3:numeric('densityKgM3','Density'),
          specificHeatJ_KgK:numeric('specificHeatJ_KgK','Specific heat'),source:get('source')};
      });
    }
    function renderLayers(layers){
      lastMaterialLayers=copy(layers);
      const fields=[['label','Layer'],['thicknessM','d (m)'],['conductivityW_MK','k (W/m K)'],
        ['densityKgM3','ρ (kg/m³)'],['specificHeatJ_KgK','c (J/kg K)'],['source','Source / condition']];
      by('env-material-layers').innerHTML=`<div class="env-table-wrap" role="region" aria-label="Editable construction layers" tabindex="0"><table class="env-table env-layer-table"><caption>Explicit opaque layers · outside to inside; no glazing substitution</caption><thead><tr>${fields.map(([,label])=>`<th scope="col">${esc(label)}</th>`).join('')}<th scope="col">Edit</th></tr></thead><tbody>${layers.map((layer,index)=>`<tr data-env-layer="${index}">${fields.map(([key,label])=>`<td><input aria-label="Layer ${index+1} ${esc(label)}" data-layer-field="${key}" type="${['label','source'].includes(key)?'text':'number'}" ${['label','source'].includes(key)?'':'step="any" min="0"'} value="${esc(layer[key])}" ${key==='label'?'maxlength="120"':''}></td>`).join('')}<td><button type="button" data-env-layer-remove="${index}" aria-label="Remove layer ${index+1}">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
    }
    function render(event){
      if(event?.type==='selection')return;
      const project=planner.getProject(),all=scenes(),active=scene(),environment=project.environment||{};
      const changedProject=previousProjectId!==project.id,key=siteKey(project),shapeKey=geometryKey(project,all);
      if(previousSiteKey!==null&&previousSiteKey!==key){
        locationOperation++;by('env-detect').disabled=false;
        cancelWeather('Site/project changed; request cancelled. Existing imported weather was not silently replaced.');
        by('env-fetch-consent').checked=false;
      }
      if(previousGeometryKey!==null&&previousGeometryKey!==shapeKey){
        invalidateSolar('Site or geometry changed. Recalculate for the current project.');
        invalidateWind('Site or geometry changed. Rebuild the current opening-path proposals.');
        by('env-pressure-ack').checked=false;by('env-thermal-ack').checked=false;
        by('env-pressure-result').innerHTML='<p class="env-warning">Geometry changed. Prepare/review the network and acknowledge it again.</p>';
        by('env-thermal-result').innerHTML='<p class="env-warning">Geometry changed. Prepare/review the scenario and acknowledge it again.</p>';
      }
      if(changedProject){
        cancelWeather('A different project was loaded; pending requests cancelled.');
        pressureTemplateKey=environment.pressure?.geometryKey||null;thermalTemplateKey=environment.thermal?.geometryKey||null;
        by('env-fetch-consent').checked=false;
        by('env-obstacle-id').value='';by('env-obstacle-form').dataset.dirty='';
        by('env-material-form').dataset.dirty='';by('env-glazing-form').dataset.dirty='';
        by('env-pressure-form').dataset.dirty='';by('env-thermal-form').dataset.dirty='';
        by('env-material-results').innerHTML='';by('env-window-preview').innerHTML='';
        by('env-pressure-result').innerHTML='';by('env-thermal-result').innerHTML='';
      }
      const weatherId=environment.weather?`${environment.weather.id}|${environment.weather.kind}`:null;
      if(previousWeatherId!==weatherId){
        invalidateWind('Weather changed. Rebuild the rose and review its coverage.');
        by('env-wind-rose').innerHTML='';
        if(value('env-radiation-mode')==='weather')invalidateSolar('Weather changed. Recalculate exposure for an explicitly matching interval.');
        renderWeather(project);
      }else if(previousSiteKey!==key||changedProject)renderWeather(project);
      const provenance=environment.siteProvenance;
      const sameSite=provenance&&provenance.latitude===project.site.latitude&&provenance.longitude===project.site.longitude;
      const isExample=project.site.latitude===17.385&&project.site.longitude===78.4867;
      by('env-site-status').textContent=sameSite?
        `${provenance.method==='device'?`Device position, reported accuracy ±${nice(provenance.accuracyM)} m. `:'Manually entered coordinates. '}${provenance.buildingSiteConfirmed?'User confirmed this is the building site.':'Building site NOT confirmed; verify before interpreting analysis.'}`:
        `${isExample?'Hyderabad EXAMPLE defaults — not a detected site.':'Site coordinates have not been confirmed in this workspace.'} Manual entry is always available.`;
      syncForm('env-site-form',{'env-lat':project.site.latitude,'env-lon':project.site.longitude,'env-zone':project.site.timeZone,
        'env-site-verified':sameSite&&provenance.buildingSiteConfirmed},changedProject);
      const assumed=environment.buildingAssumptions;
      const dimensionsReviewed=assumed?.acknowledged&&assumed.floorId===project.activeFloorId&&
        ['wallHeightM','floorElevationM','roofThicknessM'].every(key=>assumed[key]===project.building[key]);
      syncForm('env-building-form',{'env-wall-height':project.building.wallHeightM,'env-base':project.building.floorElevationM,
        'env-roof':project.building.roofThicknessM,'env-geometry-ack':dimensionsReviewed},changedProject);
      syncForm('env-storey-form',{'env-storey':project.floors.find(f=>f.id===project.activeFloorId)?.heightM},changedProject);
      const solar=environment.solar||{};
      const today=Sun?Sun.dateAt(new Date(),project.site.timeZone):new Date().toISOString().slice(0,10);
      if(changedProject)syncForm('env-solar-form',{'env-solar-date':solar.date||today,'env-solar-time':solar.time||'12:00',
        'env-solar-occurrence':solar.occurrence||'','env-solar-scope':solar.scope||'active',
        'env-radiation-mode':solar.radiationMode||'none','env-dni':solar.manualRadiation?.dniWm2,
        'env-dhi':solar.manualRadiation?.dhiWm2,'env-ghi':solar.manualRadiation?.ghiWm2,'env-albedo':solar.groundAlbedo??.2},true);
      if(changedProject){
        const year=new Date().getUTCFullYear()-1;
        syncForm('env-fetch-form',{'env-weather-start':`${year}-01-01`,'env-weather-end':`${year}-12-31`},true);
      }
      const material=environment.materials;
      const layers=material?.layers||[{...MATERIAL_PRESETS[0]}];
      if((changedProject||JSON.stringify(lastMaterialLayers)!==JSON.stringify(layers))&&!by('env-material-form').dataset.dirty&&
         !by('env-material-form').contains(root.document.activeElement))renderLayers(layers);
      syncForm('env-material-form',{'env-film-in':material?.films?.inside??.13,'env-film-out':material?.films?.outside??.04,
        'env-compare-thickness':material?.comparisonThicknessM??.2},changedProject);
      const glazing=environment.glazing;
      syncForm('env-glazing-form',{'env-glazing-u':glazing?.uValueW_M2K,'env-glazing-shgc':glazing?.shgc,
        'env-glazing-vlt':glazing?.vlt,'env-glazing-source':glazing?.source},changedProject);
      setStatus('env-glazing-status',glazing?`Stored explicit window inputs: U ${nice(glazing.uValueW_M2K)} W/m² K; SHGC ${nice(glazing.shgc)}; VLT ${nice(glazing.vlt)}.`:'No whole-window product specified.');
      if(changedProject){
        const wind=environment.wind||{};
        syncForm('env-wind-form',{'env-wind-source':wind.source||'weather','env-wind-bearing':wind.windFromDeg,
          'env-wind-speed':wind.windSpeedMps,'env-wind-month':wind.months?.join(',')||'','env-wind-hours':wind.daytime||'all',
          'env-wind-day-start':wind.dayStartHour??6,'env-wind-day-end':wind.dayEndHour??18,
          'env-wind-calm':wind.calmThresholdMps??.5,'env-wind-clock':wind.clock||'site',
          'env-window-width':wind.window?.widthM??1.2,'env-window-sill':wind.window?.sillM??.9,
          'env-window-height':wind.window?.heightM??1.2,'env-window-open':wind.window?.openFraction??.5},true);
        syncForm('env-pressure-form',{'env-pressure-input':environment.pressure?.input?JSON.stringify(environment.pressure.input,null,2):'',
          'env-pressure-notes':environment.pressure?.notes||'','env-pressure-ack':false},true);
        syncForm('env-thermal-form',{'env-thermal-input':environment.thermal?.input?JSON.stringify(environment.thermal.input,null,2):'',
          'env-thermal-notes':environment.thermal?.notes||'','env-thermal-ack':false},true);
      }
      renderObstacles(project);
      by('env-floor-label').textContent=active?`${project.floors.find(f=>f.id===project.activeFloorId)?.name||'Active floor'} · ${all.length} scene(s)`:'No valid plate / floor scene';
      if(!solarResult)by('env-solar-view').innerHTML=active?`<figure class="env-figure">${planSVG(active,null,preview)}<figcaption>Current active-floor geometry. No shadow or radiation calculation has been run for these inputs.</figcaption></figure>`:
        '<p class="env-empty">No valid floor plate. Repair the plot/layout in the Planner; site, local weather and envelope inputs remain available.</p>';
      const diagnostics=all.flatMap(s=>(s.diagnostics||[]).map(d=>`${s.floorId}: ${d.message}`));
      if(!Data)diagnostics.push('Missing EnvironmentData module; load environment-data.js before environment-ui.js.');
      if(!Sun)diagnostics.push('Missing local HomeSun module; solar/time calculations are unavailable.');
      if(!root.BuildingPhysics)diagnostics.push('Missing local BuildingPhysics module; only inputs and schematic geometry are available.');
      diagnostics.push('All-floor solar mode evaluates scenes separately; mutual storey shading is not inferred. Add explicit external context where applicable.');
      by('env-diagnostics').innerHTML=`<p>Geometry signature: <code>${esc(shapeKey)}</code>. ${all.length} floor scene(s), ${all.reduce((n,s)=>n+s.walls.length,0)} walls, ${all.reduce((n,s)=>n+s.openings.length,0)} openings. Results are explicit snapshots, not live solver runs.</p>${warnList(diagnostics)}`;
      previousProjectId=project.id;previousSiteKey=key;previousGeometryKey=shapeKey;previousWeatherId=weatherId;
      updateAvailability();
    }

    function solarInputs(){
      if(!Sun)throw new Error('Load the local HomeSun/SunCalc modules to calculate the sun.');
      const project=planner.getProject(),selection={date:value('env-solar-date'),time:value('env-solar-time'),
        occurrence:value('env-solar-occurrence'),scope:value('env-solar-scope'),radiationMode:value('env-radiation-mode'),
        groundAlbedo:value('env-radiation-mode')==='none'?null:number('env-albedo','Ground albedo',0,1)};
      const sun=Sun.calculate({...project.site,...selection});
      let radiation=null,weatherRecord=null;
      if(selection.radiationMode==='manual'){
        radiation={dniWm2:number('env-dni','DNI',0,1600),dhiWm2:number('env-dhi','DHI',0,1500),
          ghiWm2:number('env-ghi','GHI',0,2000),groundAlbedo:selection.groundAlbedo};
        selection.manualRadiation=copy(radiation);
      }else if(selection.radiationMode==='weather'){
        const weather=project.environment?.weather;
        if(!Array.isArray(weather?.records))throw new Error('Import identified weather first, or choose geometry-only/manual radiation.');
        const instant=sun.instant.getTime();
        const row=weather.records.find(r=>instant>=Date.parse(r.timestamp)-r.durationSeconds*1000&&instant<Date.parse(r.timestamp));
        if(!row)throw new Error('No source interval covers this exact UTC instant. Use a weather record midpoint, change the date, or choose geometry-only. TMY years are not silently remapped.');
        radiation={dniWm2:requireNumber(row.dniWm2,'Source DNI',0,1600),dhiWm2:requireNumber(row.dhiWm2,'Source DHI',0,1500),
          ghiWm2:requireNumber(row.ghiWm2,'Source GHI',0,2000),groundAlbedo:selection.groundAlbedo};
        weatherRecord={id:weather.id,kind:weather.kind,timestamp:row.timestamp,durationSeconds:row.durationSeconds,
          intervalStartUTC:new Date(Date.parse(row.timestamp)-row.durationSeconds*1000).toISOString(),
          source:copy(weather.source),units:copy(weather.units||{})};
      }
      const selected=selection.scope==='all'?scenes():[scene()].filter(Boolean);
      if(!selected.length)throw new Error('There is no valid floor scene for solar analysis.');
      return {selection,sun,radiation,weatherRecord,selected};
    }
    function renderSolar(result){
      const {input,output}=result;
      const floorNames=new Map(planner.getProject().floors.map(f=>[f.id,f.name]));
      by('env-solar-view').innerHTML=output.floors.map(f=>{
        const current=scenes().find(s=>s.floorId===f.floorId);
        return current?`<figure class="env-figure"><h4>${esc(floorNames.get(f.floorId)||f.floorId)} · elevation ${nice(current.floorElevationM)} m</h4>${planSVG(current,f.shadow,null)}<figcaption>Computed obstacle ground projections; clipped to plot/context view. Receiver sunlit fractions below use the numerical geometry method, not this drawing's darkness.</figcaption></figure>`:'';
      }).join('');
      const rows=[],warnings=[];
      const glazing=input.glazing;
      for(const floor of output.floors){
        warnings.push(...(floor.shadow.warnings||[]),...(floor.exposure?.warnings||[]));
        const exposed=new Map((floor.exposure?.surfaces||[]).map(s=>[s.id,s]));
        const surfaces=floor.shadow.receivers.map(s=>({...s,...exposed.get(s.id)}));
        for(const s of surfaces){
          const isWindow=/window/i.test(s.type)||scenes().find(f=>f.floorId===floor.floorId)?.openings.some(o=>o.id===s.id&&o.kind==='window');
          const gain=glazing&&isWindow&&finite(s.incidentWm2)?s.incidentWm2*s.areaM2*glazing.shgc:null;
          rows.push([esc(floorNames.get(floor.floorId)||floor.floorId),esc(s.id),esc(s.type),nice(s.areaM2),
            `${nice(s.sunlitFraction*100,1)}%`,finite(s.incidentWm2)?nice(s.incidentWm2,1):input.radiation?'Not evaluated for this receiver':'No radiation input',
            gain===null?'Not evaluated':nice(gain,1)]);
        }
      }
      warnings.push('Preview heights, obstacle transmittance and roof geometry are assumptions. Reflections, complex vegetation, daylight lux and thermal response are not provided by this geometry view.');
      if(output.floors.length>1)warnings.push('Storey scenes are evaluated separately. A higher/lower storey does not automatically occlude another scene; this is not complete coupled multi-storey shading.');
      if(input.weatherRecord)warnings.push(`Weather: ${input.weatherRecord.kind}, ${input.weatherRecord.intervalStartUTC} → ${input.weatherRecord.timestamp}. Radiation is this preceding-interval mean, not an instantaneous observation.`);
      if(input.selection.radiationMode==='manual')warnings.push('Radiation values are explicit hypothetical inputs, not measured or retrieved weather.');
      by('env-solar-results').innerHTML=`<dl class="env-readouts"><div><dt>UTC instant</dt><dd>${esc(output.instantUTC)}</dd></div><div><dt>North-clockwise azimuth</dt><dd>${nice(output.azimuth)}°</dd></div><div><dt>SunCalc apparent elevation</dt><dd>${nice(output.altitude)}°</dd></div></dl>
        ${table(['Floor','Surface ID','Type','Area (m²)','Beam sunlit','Incident (W/m²)','Constant-SHGC gain (W)'],rows,'Per-surface solar screening · not temperature or daylight lux')}
        ${warnList(warnings)}`;
      setStatus('env-solar-status',`Calculated locally at ${input.selection.date} ${input.selection.time} ${input.site.timeZone}. ${input.radiation?'Irradiance screening with stated inputs.':'Geometry only; no radiation or Celsius result.'}`);
    }
    function renderRose(rose,label){
      const max=Math.max(1,...rose.bins.map(b=>b.count)),cx=145,cy=145,base=25,span=84;
      const marks=rose.bins.map((bin,index)=>{
        const angle=bin.directionDeg*Math.PI/180,length=span*bin.count/max;
        const x1=cx+Math.sin(angle)*base,y1=cy-Math.cos(angle)*base,x2=cx+Math.sin(angle)*(base+length),y2=cy-Math.cos(angle)*(base+length);
        const labelX=cx+Math.sin(angle)*128,labelY=cy-Math.cos(angle)*128;
        return `<line class="env-rose-spoke" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><title>${DIRECTIONS[index]} FROM ${bin.directionDeg}°: ${bin.count} records, mean ${nice(bin.meanSpeedMps)} m/s</title></line>
          <text class="env-rose-label" x="${labelX}" y="${labelY+4}" text-anchor="middle">${DIRECTIONS[index]}</text>`;
      }).join('');
      by('env-wind-rose').innerHTML=`<figure class="env-figure"><svg class="env-rose" viewBox="0 0 290 290" role="img" aria-label="16-sector meteorological FROM wind rose. Full counts are in the table below."><circle class="env-rose-ring" cx="145" cy="145" r="109"/><circle class="env-rose-ring" cx="145" cy="145" r="67"/>${marks}<circle class="env-rose-center" cx="145" cy="145" r="25"/><text class="env-rose-label" x="145" y="149" text-anchor="middle">FROM</text></svg><figcaption>${esc(label)}</figcaption></figure>
        <p><strong>${nice(rose.total,0)} included</strong> · calm ${rose.calmCount} · missing ${rose.missingCount} · filtered out ${rose.excludedCount}. Calm: zero or below ${nice(rose.calmThresholdMps)} m/s.</p>
        <p class="env-help">${esc(rose.timeBasis)}; ${esc(rose.daytimeDefinition.meaning)}. ${esc(rose.frequencyBasis)}.${rose.unknownTimeCount?` ${rose.unknownTimeCount} records have unknown filter times and are counted as missing, not assigned a month.`:''}</p>
        <details class="env-details"><summary>All direction counts &amp; mean speeds</summary>${table(['FROM','Records','% of included','Mean speed (m/s)'],rose.bins.map((b,i)=>[`${DIRECTIONS[i]} ${nice(b.directionDeg)}°`,String(b.count),rose.total?nice(100*b.count/rose.total,1):'—',finite(b.meanSpeedMps)?nice(b.meanSpeedMps):'—']),'Wind frequencies retain calm and missing in the denominator')}</details>`;
    }
    function renderProposals(){
      by('env-window-proposals').innerHTML=proposals.length?`<h4>Explainable proposals · preview before applying</h4><ol class="env-proposal-list">${proposals.map((p,i)=>`<li><h5>${esc(p.roomLabel)} · ${esc(p.role)}</h5><p>${esc(p.reason)}</p>${p.path?`<p class="env-help">Current route opening IDs: ${esc(p.path.openingIds.join(' → '))}. Existing path's smallest nominal opening: ${nice(p.path.area)} m² (not an aerodynamic flow estimate).</p>`:''}
        <button type="button" data-env-preview="${i}">Preview new window</button></li>`).join('')}</ol>`:
        '<p class="env-empty">No eligible proposal for these wind/size inputs. Check actual exterior walls, available solid-wall width, window head height, non-service rooms and non-calm wind. No openings were changed.</p>';
    }
    function renderPreview(){
      if(!preview){by('env-window-preview').innerHTML='';return;}
      by('env-window-preview').innerHTML=`<div class="env-preview"><div><h4>Proposed window · not applied</h4><p>${esc(preview.reason)}</p>${warnList(preview.cautions)}<pre class="env-json">${esc(JSON.stringify(preview.command,null,2))}</pre><div class="env-actions"><button type="button" id="env-window-apply" class="env-primary">Apply this new window</button><button type="button" id="env-window-dismiss">Dismiss preview</button></div><p class="env-help">Only add-window is issued. Existing manual openings remain unchanged; use the planner's Undo to reverse an applied addition.</p></div><figure class="env-figure">${planSVG(scene(),null,preview)}<figcaption>Dashed accent segment is a proposal, not a computed shadow or flow field.</figcaption></figure></div>`;
    }
    function download(name,value){
      const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
      const url=root.URL.createObjectURL(blob),link=root.document.createElement('a');
      link.href=url;link.download=name;root.document.body.append(link);link.click();link.remove();
      root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);
    }
    return install();

    function install(){
      bindForm('env-site-form','env-site-error',()=>{
        const patch={latitude:number('env-lat','Latitude',-90,90),longitude:number('env-lon','Longitude',-180,180),timeZone:value('env-zone').trim()};
        try{new Intl.DateTimeFormat('en-GB',{timeZone:patch.timeZone}).format(new Date());}
        catch(error){
          if(!(error instanceof RangeError))throw error;
          throw new Error('Use a valid IANA time zone such as Asia/Kolkata. It is not inferred from coordinates.');
        }
        const confirmed=by('env-site-verified').checked;
        planner.execute({type:'update-site',patch});
        saveEnvironment({siteProvenance:{method:'manual',latitude:patch.latitude,longitude:patch.longitude,
          buildingSiteConfirmed:confirmed,recordedAt:new Date().toISOString()}});
        setStatus('env-global-status','Site saved locally. Weather was not fetched.');
      });
      bindClick('env-detect','env-site-error',async()=>{
        if(typeof root.HomePlannerLocation?.detect!=='function')throw new Error('Current-location detection is unavailable. Enter coordinates manually.');
        const token=++locationOperation,key=siteKey(planner.getProject());
        by('env-detect').disabled=true;setStatus('env-site-status','Requesting device position only after your click…');
        try{
          const found=await root.HomePlannerLocation.detect();
          if(token!==locationOperation||siteKey(planner.getProject())!==key)return;
          requireNumber(found.latitude,'Detected latitude',-90,90);requireNumber(found.longitude,'Detected longitude',-180,180);
          requireNumber(found.accuracyM,'Reported accuracy',0);
          by('env-site-form').dataset.dirty='';
          planner.execute({type:'update-site',patch:{latitude:found.latitude,longitude:found.longitude}});
          saveEnvironment({siteProvenance:{method:'device',latitude:found.latitude,longitude:found.longitude,
            accuracyM:found.accuracyM,timestamp:found.timestamp,buildingSiteConfirmed:false,recordedAt:new Date().toISOString()}});
          syncForm('env-site-form',{'env-lat':found.latitude,'env-lon':found.longitude,'env-zone':planner.getProject().site.timeZone,'env-site-verified':false},true);
          setStatus('env-global-status',`Device position saved; reported accuracy ±${nice(found.accuracyM)} m. Verify it is the building site. Time zone was not changed.`);
        }finally{
          if(!destroyed&&token===locationOperation){by('env-detect').disabled=false;render();}
        }
      });
      bindForm('env-building-form','env-site-error',()=>{
        const patch={wallHeightM:positive(value('env-wall-height'),'Wall height'),
          floorElevationM:number('env-base','Building base elevation'),roofThicknessM:number('env-roof','Roof thickness',0)};
        const acknowledged=by('env-geometry-ack').checked;
        planner.execute({type:'update-building',patch});
        saveEnvironment({buildingAssumptions:{...patch,floorId:planner.getProject().activeFloorId,acknowledged,
          recordedAt:new Date().toISOString(),basis:'User-reviewed preview dimensions, not a survey'}});
        setStatus('env-global-status','Building preview dimensions saved. Numerical models still require their own complete inputs.');
      });
      bindForm('env-storey-form','env-site-error',()=>{
        planner.execute({type:'update-floor',id:planner.getProject().activeFloorId,patch:{heightM:positive(value('env-storey'),'Storey height')}});
        setStatus('env-global-status','Active storey height saved; stacked elevations updated.');
      });
      bindForm('env-obstacle-form','env-obstacle-error',()=>{
        const project=planner.getProject(),id=value('env-obstacle-id')||`obstacle-${root.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        const label=value('env-obstacle-label').trim();
        if(!label)throw new Error('Give the nearby obstacle a label.');
        const obstacle={id,label,type:value('env-obstacle-type'),x:number('env-obstacle-x','Obstacle x'),y:number('env-obstacle-y','Obstacle y'),
          w:positive(value('env-obstacle-w'),'Obstacle width'),h:positive(value('env-obstacle-h'),'Obstacle depth'),
          heightM:positive(value('env-obstacle-height'),'Obstacle height'),baseM:number('env-obstacle-base','Obstacle base'),
          transmittance:number('env-obstacle-trans','Beam transmittance',0,1)};
        const list=copy(project.obstacles),index=list.findIndex(o=>o.id===id);
        if(value('env-obstacle-id')&&index<0)throw new Error('The edited obstacle no longer exists on this floor. Start a new rectangle.');
        if(index<0)list.push(obstacle);else list[index]=obstacle;
        planner.execute({type:'set-obstacles',value:list});by('env-obstacle-id').value=id;
        setStatus('env-global-status',`${label} saved as an assumed local obstruction. No fixed cooling effect was assigned.`);
      });
      bindClick('env-obstacle-new','env-obstacle-error',()=>{
        by('env-obstacle-id').value='';by('env-obstacle-label').value='Nearby building';by('env-obstacle-form').dataset.dirty='true';
        by('env-obstacle-label').focus();
      });
      by('env-weather-file').addEventListener('change',()=>action('env-weather-error',async()=>{
        const file=by('env-weather-file').files[0];if(!file)return;
        needData();if(file.size>20*1024*1024)throw new Error('This file exceeds 20 MB. Import a smaller period to keep local project storage usable.');
        cancelWeather();const token=++weatherOperation,projectId=planner.getProject().id;
        setStatus('env-weather-status',`Reading ${file.name} locally…`);
        const text=await file.text();
        if(token!==weatherOperation||projectId!==planner.getProject().id)return;
        const weather=/\.epw$/i.test(file.name)||/^\s*(?:\uFEFF)?LOCATION,/i.test(text)?Data.parseEPW(text):Data.parseWeatherJSON(text);
        weather.source={...(typeof weather.source==='string'?{label:weather.source}:weather.source),importedFileName:file.name,
          importedAt:new Date().toISOString(),importMethod:'Local file; no upload'};
        saveEnvironment({weather});
        setStatus('env-weather-status',`Imported ${weather.records.length} intervals locally. Review source, classification and warnings.`);
        by('env-weather-file').value='';
      }));
      bindClick('env-weather-template','env-weather-error',()=>{
        needData();
        download('homeplanner-weather-format-example.json',{kind:'scenario',source:{label:'FORMAT EXAMPLE ONLY — replace with identified measurements or model data',
          license:'Record your source attribution and data rights'},latitude:null,longitude:null,units:Data.UNITS,
          records:[{timestamp:'2024-01-01T01:00:00Z',durationSeconds:3600,...Object.fromEntries(Object.keys(Data.UNITS).map(key=>[key,null]))}]});
        setStatus('env-weather-status','Downloaded a format-only example with null weather, not a site dataset.');
      });
      bindClick('env-weather-clear','env-weather-error',()=>{
        cancelWeather();saveEnvironment({weather:null});setStatus('env-weather-status','Weather cleared from this project. No remote data or saved projects were deleted.');
      });
      bindClick('env-weather-classify','env-weather-error',()=>{
        const weather=planner.getProject().environment?.weather;
        if(!weather)throw new Error('Import weather before assigning its source classification.');
        const kind=value('env-weather-kind');
        saveEnvironment({weather:{...weather,kind,classificationEvidence:{method:'User-selected source classification',recordedAt:new Date().toISOString()},
          coverage:{...weather.coverage,chronological:kind==='tmy'?false:weather.coverage?.chronological}}});
        setStatus('env-weather-status',`Classification saved as ${kind}; timestamps and source records were not remapped.`);
      });
      bindClick('env-fetch-cancel','env-weather-error',()=>cancelWeather());
      bindForm('env-fetch-form','env-weather-error',async()=>{
        needData();requireAcknowledgement('env-fetch-consent','Consent is required for this specific online request. Local file import works without it.');
        if(by('env-site-form').dataset.dirty)throw new Error('Save or review your unsaved site edits before sending coordinates. The request uses the saved project site.');
        if(typeof root.fetch!=='function'||typeof root.AbortController!=='function')throw new Error('This browser cannot make a cancellable request. Import an EPW/JSON file instead.');
        const project=planner.getProject(),request=buildArchiveRequest(project.site,value('env-weather-start'),value('env-weather-end'),Sun);
        cancelWeather();const token=++weatherOperation,key=siteKey(project),controller=new root.AbortController();requestController=controller;
        by('env-fetch').disabled=true;by('env-fetch-cancel').disabled=false;
        setStatus('env-weather-status',`Requesting ERA5, ${request.startUTC} → ${request.endUTC}. Only approved coordinates/dates/variables are being sent.`);
        let timedOut=false;
        const timeout=root.setTimeout(()=>{timedOut=true;controller.abort();},45000);
        try{
          let response;
          try{response=await root.fetch(request.url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});}
          catch(error){
            if(error instanceof TypeError)throw new Error('Weather request failed (network, CORS or browser restriction). Existing data remain intact. Import EPW/JSON locally or retry explicitly.');
            throw error;
          }
          if(token!==weatherOperation||siteKey(planner.getProject())!==key)return;
          if(!response.ok){
            const retry=response.headers.get('Retry-After');
            throw new Error(response.status===429?`Open-Meteo quota/rate limit reached.${retry?` Retry-After: ${retry}.`:''} No automatic retry; prior weather is retained.`:
              `Open-Meteo returned HTTP ${response.status}. Check dates, service availability and terms, or import a local file. Prior weather is retained.`);
          }
          let raw;
          try{raw=await response.json();}
          catch(error){
            if(error instanceof SyntaxError)throw new Error('The provider response was not valid JSON. Prior weather is unchanged.');
            throw error;
          }
          if(token!==weatherOperation||siteKey(planner.getProject())!==key||!by('env-fetch-consent').checked)return;
          const weather=trimWeatherToInterval(Data.fromOpenMeteo({...raw,model:'ERA5 (explicit archive request)',kind:'reanalysis'}),request);
          weather.source.retrievedAt=new Date().toISOString();weather.source.consent='One user-initiated request; not permission for background fetching';
          saveEnvironment({weather});setStatus('env-weather-status',`Received ${weather.records.length} identified ERA5 intervals. Imported weather stays local after this request; attribution and provider terms still apply.`);
        }catch(error){
          if(token!==weatherOperation||siteKey(planner.getProject())!==key)return;
          if(error.name==='AbortError'){
            if(token===weatherOperation)setStatus('env-weather-status',timedOut?'Provider request timed out after 45 seconds. Prior weather remains; use offline import or retry explicitly.':'Request cancelled; prior weather retained.');
          }else throw error;
        }finally{
          root.clearTimeout(timeout);
          if(token===weatherOperation){requestController=null;by('env-fetch').disabled=false;by('env-fetch-cancel').disabled=true;by('env-fetch-consent').checked=false;}
        }
      });
      bindForm('env-solar-form','env-solar-error',()=>{
        invalidateSolar('Calculating locally…');
        const physics=needPhysics('shadowAt'),{selection,sun,radiation,weatherRecord,selected}=solarInputs();
        if(radiation)needPhysics('surfaceExposure');
        const floors=selected.map(s=>({floorId:s.floorId,shadow:physics.shadowAt(s,sun.vector),
          exposure:radiation?physics.surfaceExposure(s,sun.vector,radiation):null}));
        const input={selection,site:copy(planner.getProject().site),sunENU:sun.vector,radiation,weatherRecord,
          glazing:planner.getProject().environment?.glazing?copy(planner.getProject().environment.glazing):null};
        saveEnvironment({solar:selection});
        solarResult=storeResult('solar',input,{instantUTC:sun.instant.toISOString(),azimuth:sun.azimuth,altitude:sun.altitude,floors},
          {scope:'Sampled geometry and irradiance screening; no thermal/daylight/CFD result'});
        renderSolar(solarResult);
      });
      bindClick('env-use-record','env-solar-error',()=>{
        const weather=planner.getProject().environment?.weather;
        if(!Array.isArray(weather?.records))throw new Error('Import weather first.');
        if(!Sun)throw new Error('The local HomeSun time-zone adapter is unavailable.');
        const index=number('env-record-index','Weather record number',1,weather.records.length);
        if(!Number.isInteger(index))throw new Error('Use a whole, 1-based weather record number.');
        const row=weather.records[index-1],instant=new Date(Date.parse(row.timestamp)-row.durationSeconds*500),zone=planner.getProject().site.timeZone;
        by('env-solar-date').value=Sun.dateAt(instant,zone);
        by('env-solar-time').value=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);
        const early=Sun.resolveLocal(value('env-solar-date'),value('env-solar-time'),zone,'earlier');
        by('env-solar-occurrence').value=early.ambiguous?(Math.abs(early.instant-instant)<60000?'earlier':'later'):'';
        by('env-radiation-mode').value='weather';by('env-solar-form').dataset.dirty='true';
        updateAvailability();
        invalidateSolar(`Selected source interval ${row.timestamp}, midpoint ${instant.toISOString()}. Click Calculate; no weather request was made.`);
      });
      bindClick('env-monthly','env-solar-error',async()=>{
        const physics=needPhysics('shadowAt');
        if(!Sun)throw new Error('The local sun model is unavailable.');
        const config={...planner.getProject().site,date:value('env-solar-date'),time:value('env-solar-time'),occurrence:value('env-solar-occurrence')};
        Sun.validate(config);const year=Number(config.date.slice(0,4)),key=currentGeometryKey(),token=++monthlyOperation;
        const selected=value('env-solar-scope')==='all'?scenes():[scene()].filter(Boolean);
        if(!selected.length)throw new Error('No valid scene is available for monthly snapshots.');
        const rows=[],warnings=[];
        by('env-monthly').disabled=true;by('env-monthly-results').innerHTML='';
        try{
          for(let month=1;month<=12;month++){
            await new Promise(resolve=>root.setTimeout(resolve,0));
            if(token!==monthlyOperation||key!==currentGeometryKey())return;
            for(const time of ['09:00','12:00','15:00']){
              const date=`${year}-${String(month).padStart(2,'0')}-21`,sun=Sun.calculate({...config,date,time});
              for(const s of selected){
                const result=physics.shadowAt(s,sun.vector),receivers=result.receivers;
                const area=receivers.reduce((sum,r)=>sum+r.areaM2,0),lit=receivers.reduce((sum,r)=>sum+r.areaM2*r.sunlitFraction,0);
                rows.push({date,time,instantUTC:sun.instant.toISOString(),floorId:s.floorId,altitude: sun.altitude,
                  sampledReceiverAreaM2:area,areaWeightedSunlitFraction:area?lit/area:null});
                warnings.push(...result.warnings);
              }
            }
            setStatus('env-solar-status',`Monthly comparison: ${month}/12 months completed locally. No weather requests.`);
          }
          if(token!==monthlyOperation||key!==currentGeometryKey())return;
          const entry=storeResult('monthlySolar',{site:copy(planner.getProject().site),year,dates:'21st of each month',times:['09:00','12:00','15:00'],scope:value('env-solar-scope')},
            {rows,warnings:[...new Set(warnings)]},{scope:'36 local-clock snapshots per floor; not integrated sun hours or seasonal energy'});
          by('env-monthly-results').innerHTML=`${table(['Date','Site time','Floor','Elevation (°)','Area-weighted beam sunlit'],rows.map(r=>[r.date,r.time,esc(r.floorId),nice(r.altitude),finite(r.areaWeightedSunlitFraction)?`${nice(r.areaWeightedSunlitFraction*100,1)}%`:'Not evaluated']),'21st of each month · 09:00 / 12:00 / 15:00 snapshots')}
            <p class="env-warning">36 snapshots per floor, not seasonal radiation energy or integrated sun hours. Different surface orientations are aggregated by area only. All storeys are evaluated independently; no mutual shading is inferred.</p>${warnList(entry.output.warnings)}`;
          setStatus('env-solar-status','Monthly snapshot comparison completed. Solar fields remain unchanged.');
        }finally{if(!destroyed)by('env-monthly').disabled=false;}
      });
      bindClick('env-material-use','env-material-error',()=>{
        const preset=MATERIAL_PRESETS.find(p=>p.id===value('env-material-preset'));
        if(!preset)throw new Error('Choose an available sourced example.');
        renderLayers([preset]);by('env-material-form').dataset.dirty='true';by('env-material-results').innerHTML='';
        by('env-material-source').innerHTML=`${esc(preset.source)} <a href="${preset.url}" target="_blank" rel="noopener noreferrer">Read source</a>`;
      });
      bindClick('env-material-add','env-material-error',()=>{
        renderLayers([...layerDraft(false),{label:'New specified layer',thicknessM:null,conductivityW_MK:null,densityKgM3:null,specificHeatJ_KgK:null,source:''}]);
        by('env-material-form').dataset.dirty='true';by('env-material-results').innerHTML='';
      });
      bindForm('env-material-form','env-material-error',()=>{
        by('env-material-results').innerHTML='';
        const physics=needPhysics('assemblyProperties'),layers=layerDraft(true);
        if(!layers.length)throw new Error('Add at least one fully specified opaque layer.');
        if(layers.some(l=>!l.label.trim()||!l.source.trim()))throw new Error('Give every layer a label and source/condition (or explicitly state it is hypothetical).');
        const films={inside:number('env-film-in','Inside film resistance',0),outside:number('env-film-out','Outside film resistance',0)};
        const thickness=positive(value('env-compare-thickness'),'Comparison thickness');
        const selected=physics.assemblyProperties(layers,films);
        const comparisons=MATERIAL_PRESETS.map(p=>{
          const complete=[p.conductivityW_MK,p.densityKgM3,p.specificHeatJ_KgK].every(finite);
          return {id:p.id,label:p.label,source:p.source,thicknessM:thickness,
            result:complete?physics.assemblyProperties([{label:p.label,source:p.source,thicknessM:thickness,
              conductivityW_MK:p.conductivityW_MK,densityKgM3:p.densityKgM3,specificHeatJ_KgK:p.specificHeatJ_KgK}],films):null};
        });
        saveEnvironment({materials:{layers,films,comparisonThicknessM:thickness,basis:'Explicit layers / sourced examples; not assigned thermal zones'}});
        storeResult('assemblies',{layers,films,comparisonThicknessM:thickness},{selected,comparisons});
        by('env-material-results').innerHTML=table(['Assembly','R (m² K/W)','U (W/m² K)','Capacity (J/m² K)'],
          [['Your explicit layers',nice(selected.resistanceM2K_W,3),nice(selected.uValueW_M2K,3),nice(selected.arealHeatCapacityJ_M2K,0)],
            ...comparisons.map(p=>[`${esc(p.label)}<br><span class="env-help">Same assumed thickness ${nice(thickness,3)} m</span>`,
              p.result?nice(p.result.resistanceM2K_W,3):'Properties required',p.result?nice(p.result.uValueW_M2K,3):'Not evaluated',
              p.result?nice(p.result.arealHeatCapacityJ_M2K,0):'Not evaluated'])],
          'Steady resistance & total areal capacity · not dynamic heat retention or Celsius');
        by('env-material-results').innerHTML+=warnList(['Example properties are source-specific. Moisture, density, mortar, plaster, bridges and layer order matter; films are stated assumptions.',
          '“Mud” has no universal conductivity/capacity. The Lyon rammed-earth record remains unevaluated until the applicable measured properties are supplied.']);
      });
      bindForm('env-glazing-form','env-glazing-error',()=>{
        const glazing={uValueW_M2K:positive(value('env-glazing-u'),'Whole-window U'),
          shgc:number('env-glazing-shgc','SHGC',0,1),vlt:number('env-glazing-vlt','VLT',0,1),source:value('env-glazing-source').trim()};
        if(!glazing.source)throw new Error('Record the glazing product/test or state the hypothetical assumption.');
        saveEnvironment({glazing});invalidateSolar('Glazing inputs changed; recalculate constant-SHGC solar-gain screening.');
      });
      bindForm('env-wind-form','env-wind-error',()=>{
        needData();invalidateWind('Building the wind distribution and actual opening paths…');
        by('env-wind-rose').innerHTML='';
        const manual=value('env-wind-source')==='manual';
        const config={source:value('env-wind-source'),months:manual?[]:value('env-wind-month').split(',').filter(Boolean).map(Number),
          daytime:manual?'all':value('env-wind-hours'),dayStartHour:manual?null:number('env-wind-day-start','Day window start',0,23.999),
          dayEndHour:manual?null:number('env-wind-day-end','Day window end',0,24),calmThresholdMps:number('env-wind-calm','Calm threshold',0,150),clock:value('env-wind-clock'),
          window:{widthM:positive(value('env-window-width'),'Proposed width'),sillM:number('env-window-sill','Proposed sill',0),
            heightM:positive(value('env-window-height'),'Proposed height'),openFraction:number('env-window-open','Proposed operating fraction',0,1)}};
        let records,options={calmThresholdMps:config.calmThresholdMps},label,bearings;
        const weather=planner.getProject().environment?.weather;
        if(config.source==='manual'){
          config.windFromDeg=number('env-wind-bearing','Hypothetical FROM bearing',0,360);
          config.windSpeedMps=number('env-wind-speed','Hypothetical wind speed',0,150);
          records=[{timestamp:new Date().toISOString(),windFromDeg:config.windFromDeg,windSpeedMps:config.windSpeedMps}];
          label='One hypothetical wind input, not regional climatology. Month/clock filters do not apply to this single scenario.';
          bearings=config.windSpeedMps===0||config.windSpeedMps<config.calmThresholdMps?[]:[config.windFromDeg];
        }else{
          if(!Array.isArray(weather?.records)||!weather.records.length)throw new Error('Import weather to make a climate rose, or choose hypothetical wind. No data were fetched.');
          records=weather.records;options={...options,months:config.months,daytime:config.daytime,dayStartHour:config.dayStartHour,dayEndHour:config.dayEndHour};
          if(config.clock==='file'){
            if(!finite(weather.timeZoneOffsetHours))throw new Error('This file has no fixed standard-time offset. Choose the site IANA clock or supply correctly identified metadata.');
            options.timeZoneOffsetHours=weather.timeZoneOffsetHours;
          }else options.timeZone=planner.getProject().site.timeZone;
          label=`${weather.kind} · ${typeof weather.source==='string'?weather.source:weather.source?.label||'Imported weather'}. Reference-height gridded/station wind, not wind at a window.`;
        }
        const rose=Data.windRose(records,options);
        if(config.source==='weather')bearings=[...rose.bins].filter(b=>b.count>0).sort((a,b)=>b.count-a.count).slice(0,2).map(b=>b.directionDeg);
        const active=scene();
        if(active)proposals=bearings.flatMap(windFromDeg=>buildWindowRecommendations(active,{...config.window,windFromDeg})).slice(0,10);
        proposalGeometryKey=currentGeometryKey();
        saveEnvironment({wind:config});
        windResult=storeResult('wind',{config,weatherId:config.source==='weather'?weather.id:null,
          weatherProvenance:config.source==='weather'?{source:weather.source,coverage:weather.coverage,units:weather.units}:null,options},
          {rose,proposalBearings:bearings,proposals},{scope:'Frequency distribution and actual-wall/path screening, not pressure estimates or CFD'});
        renderRose(rose,label);renderProposals();
        setStatus('env-wind-status',`Showing ${rose.total} included records and ${proposals.length} reviewable proposals${active?'':'; no valid floor scene for proposals'}. ${config.source==='weather'?'Top two occupied sector centres are kept separately; no annual mean bearing is substituted.':''}`);
      });
      bindClick('env-pressure-template','env-pressure-error',()=>{
        const input=buildAirflowTemplate(scene());pressureTemplateKey=currentGeometryKey();
        by('env-pressure-input').value=JSON.stringify(input,null,2);by('env-pressure-notes').value='';by('env-pressure-ack').checked=false;
        by('env-pressure-result').innerHTML='<p class="env-help">Not evaluated. Replace density, Cd and signed pressure nulls, review geometry-derived volumes/areas, and document the assumptions.</p>';
        saveEnvironment({pressure:{input,notes:'',geometryKey:pressureTemplateKey,acknowledged:false}});
      });
      bindClick('env-thermal-template','env-thermal-error',()=>{
        const input=buildThermalTemplate(scene());thermalTemplateKey=currentGeometryKey();
        by('env-thermal-input').value=JSON.stringify(input,null,2);by('env-thermal-notes').value='';by('env-thermal-ack').checked=false;
        by('env-thermal-result').innerHTML='<p class="env-help">Not evaluated. All capacities, conductances, temperatures and gains must be explicitly supplied. The 3600-second step is an editable example duration.</p>';
        saveEnvironment({thermal:{input,notes:'',geometryKey:thermalTemplateKey,acknowledged:false}});
      });
      bindClick('env-pressure-save','env-pressure-error',()=>{
        const input=parseInput('env-pressure-input');
        if(!object(input))throw new Error('Save a JSON input object, starting with the scene template.');
        saveEnvironment({pressure:{input,notes:value('env-pressure-notes').trim(),geometryKey:pressureTemplateKey,acknowledged:false}});
        by('env-pressure-ack').checked=false;
        by('env-pressure-result').innerHTML='<p class="env-help">Unevaluated draft saved in the project. Missing values remain missing; no network was solved.</p>';
      });
      bindClick('env-thermal-save','env-thermal-error',()=>{
        const input=parseInput('env-thermal-input');
        if(!object(input))throw new Error('Save a JSON input object, starting with the room template.');
        saveEnvironment({thermal:{input,notes:value('env-thermal-notes').trim(),geometryKey:thermalTemplateKey,acknowledged:false}});
        by('env-thermal-ack').checked=false;
        by('env-thermal-result').innerHTML='<p class="env-help">Unevaluated draft saved in the project. No missing heat-capacity, weather or gain value was replaced by zero.</p>';
      });
      bindForm('env-pressure-form','env-pressure-error',()=>{
        by('env-pressure-result').innerHTML='';
        requireAcknowledgement('env-pressure-ack','Review all pressure-network assumptions and check the experimental acknowledgement before solving.');
        if(pressureTemplateKey!==currentGeometryKey())throw new Error('The pressure template is missing or geometry changed. Prepare it from current openings and review it again.');
        const input=validatePressureInput(parseInput('env-pressure-input'),scene()),notes=value('env-pressure-notes').trim();
        if(!notes)throw new Error('Document pressure/Cd/density sources and operating assumptions, not only numeric values.');
        saveEnvironment({pressure:{input,notes,geometryKey:pressureTemplateKey,acknowledged:true}});
        const output=needPhysics('solveAirflow').solveAirflow(input);
        storeResult('pressure',input,output,{notes,acknowledged:true,scope:'Uncalibrated steady network; not single-sided turbulent exchange, two-way flow or CFD'});
        by('env-pressure-result').innerHTML=`<p class="${output.converged?'env-status':'env-warning'}"><strong>${output.converged?'Numerical network converged':'NOT CONVERGED — do not interpret as a balanced flow solution'}</strong>. Maximum residual ${nice(output.residualM3s,9)} m³/s.</p>
          ${table(['Opening link','From','To','Signed flow (m³/s)'],output.flows.map(f=>[esc(f.id),esc(f.from),esc(f.to),nice(f.m3s,6)]),'Explicit-pressure reduced network · not occupant airspeed')}
          ${warnList(output.warnings)}<details class="env-details"><summary>Read-only pressure diagnostics</summary><pre class="env-json">${esc(JSON.stringify(output,null,2))}</pre></details>`;
      });
      bindForm('env-thermal-form','env-thermal-error',()=>{
        by('env-thermal-result').innerHTML='';
        requireAcknowledgement('env-thermal-ack','Complete all thermal/operating inputs and acknowledge the experimental, non-site-prediction scope before running.');
        if(thermalTemplateKey!==currentGeometryKey())throw new Error('The thermal template is missing or geometry changed. Prepare/review it for the current floor first.');
        const input=validateThermalInput(parseInput('env-thermal-input'),scene()),notes=value('env-thermal-notes').trim();
        if(!notes)throw new Error('Document capacity/conductance/gain sources, operation and omitted physics.');
        saveEnvironment({thermal:{input,notes,geometryKey:thermalTemplateKey,acknowledged:true}});
        const output=needPhysics('simulateThermal').simulateThermal(input);
        storeResult('thermal',input,output,{notes,acknowledged:true,scope:'Uncalibrated sensible RC experiment, NOT actual site temperature or a comfort forecast'});
        const shown=output.samples.length<=240?output.samples:[output.samples[0],...output.samples.slice(-239)];
        by('env-thermal-result').innerHTML=`<p class="env-warning"><strong>Hypothetical RC-state temperatures only — not actual site temperatures.</strong> Energy residual ${nice(output.energyResidualJ,6)} J. No automatic weather, ventilation, humidity or HVAC coupling.</p>
          ${table(['Elapsed hours',...input.zones.map(z=>`${z.id} (°C, model state)`)],shown.map(s=>[nice(s.elapsedSeconds/3600,2),...input.zones.map(z=>nice(s.temperaturesC[z.id],3))]),'Explicit sensible-only experiment')}
          ${output.samples.length>240?'<p class="env-help">First and last 239 samples shown; all samples are preserved in analysis export.</p>':''}${warnList(output.warnings)}`;
      });
      bindClick('env-export-weather','env-export-error',()=>{
        const weather=planner.getProject().environment?.weather;
        if(!weather)throw new Error('No normalized weather is available to export.');
        download('homeplanner-normalized-weather.json',weather);setStatus('env-export-status','Normalized weather downloaded locally with source metadata and warnings.');
      });
      bindClick('env-export','env-export-error',()=>{
        const project=planner.getProject(),all=scenes(),key=geometryKey(project,all),environment=copy(project.environment||{});
        const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
        const matchesCurrentInputs=(name,entry)=>{
          if(name==='pressure'||name==='thermal')return same(entry.input,environment[name]?.input)&&entry.notes===environment[name]?.notes;
          if(name==='assemblies')return same(entry.input,{layers:environment.materials?.layers,films:environment.materials?.films,
            comparisonThicknessM:environment.materials?.comparisonThicknessM});
          if(name==='solar')return same(entry.input.selection,environment.solar)&&same(entry.input.glazing,environment.glazing)&&
            (!entry.input.weatherRecord||(entry.input.weatherRecord.id===environment.weather?.id&&entry.input.weatherRecord.kind===environment.weather?.kind));
          if(name==='wind')return same(entry.input.config,environment.wind)&&
            (entry.input.config.source!=='weather'||entry.input.weatherId===environment.weather?.id);
          return null;
        };
        const results=Object.fromEntries(Object.entries(environment.results||{}).map(([name,entry])=>{
          const currentGeometry=entry.geometryKey===key,currentInputs=matchesCurrentInputs(name,entry);
          return [name,{...entry,currentGeometry,currentInputs,
            staleReason:[...(!currentGeometry?['Site/floor geometry differs from the calculated snapshot']:[]),
              ...(currentInputs===false?['Saved scenario, glazing or weather inputs differ from the calculated snapshot']:[])].join('; ')||null}];
        }));
        download('homeplanner-environment-analysis-v1.json',{schema:'homeplanner.environment-analysis',schemaVersion:1,
          exportedAt:new Date().toISOString(),project:{id:project.id,name:project.name,revision:project.revision},
          site:copy(project.site),building:copy(project.building),floors:project.floors.map(f=>({id:f.id,name:f.name,heightM:f.heightM})),
          activeFloorId:project.activeFloorId,geometryKey:key,coordinateConvention:'Building-local x right, y rear, z up; heading is front bearing clockwise from true north. See scene heading/floor dimensions for ENU transform.',
          scenes:copy(all),environment:{...environment,results},
          provenance:{solarEngine:'Locally vendored SunCalc through HomeSun',numericalAPI:'BuildingPhysics frozen contract; see building-physics.js and documentation',
            weatherAdapter:'EnvironmentData v1',externalSolverExecuted:false,networkDisclosure:'Only explicit consent-driven Open-Meteo weather requests are supported; no plan or solver inputs are uploaded'},
          omissions:['Not an EnergyPlus model, IFC file, CFD mesh or CFD execution result','Uncalibrated reduced analytical models, no certification or site-temperature prediction',
            'No coupled multi-floor shading, moisture, detailed sky/reflection, turbulent room velocity, automatic wind/thermal coupling, HVAC sizing or calibrated warmup',
            'Weather station/grid is not a building-site measurement; TMY years are not chronological history','Material and pressure inputs require expert/source review'],
          diagnostics:all.flatMap(s=>s.diagnostics||[])});
        setStatus('env-export-status','Versioned analysis snapshot downloaded locally. Source records, assumptions, result signatures and unsupported physics are included; no expert solver was run.');
      });
      const onClick=event=>{
        const edit=event.target.closest('[data-env-obstacle-edit]'),remove=event.target.closest('[data-env-obstacle-remove]');
        const layer=event.target.closest('[data-env-layer-remove]'),proposal=event.target.closest('[data-env-preview]');
        if(edit)action('env-obstacle-error',()=>{
          const o=planner.getProject().obstacles.find(o=>o.id===edit.dataset.envObstacleEdit);
          if(!o)throw new Error('This obstacle is no longer available on the active floor.');
          syncForm('env-obstacle-form',{'env-obstacle-id':o.id,'env-obstacle-label':o.label,'env-obstacle-type':o.type,
            'env-obstacle-x':o.x,'env-obstacle-y':o.y,'env-obstacle-w':o.w,'env-obstacle-h':o.h,
            'env-obstacle-height':o.heightM,'env-obstacle-base':o.baseM,'env-obstacle-trans':o.transmittance},true);
          by('env-obstacle-editor').open=true;by('env-obstacle-label').focus();
        });
        if(remove)action('env-obstacle-error',()=>{
          planner.execute({type:'set-obstacles',value:planner.getProject().obstacles.filter(o=>o.id!==remove.dataset.envObstacleRemove)});
          if(value('env-obstacle-id')===remove.dataset.envObstacleRemove)by('env-obstacle-id').value='';
          setStatus('env-global-status','Obstacle removed from the active floor; use planner Undo to restore it.');
        });
        if(layer)action('env-material-error',()=>{
          renderLayers(layerDraft(false).filter((_,i)=>i!==Number(layer.dataset.envLayerRemove)));
          by('env-material-form').dataset.dirty='true';by('env-material-results').innerHTML='';
        });
        if(proposal)action('env-wind-error',()=>{
          if(proposalGeometryKey!==currentGeometryKey())throw new Error('Geometry changed; rebuild proposals before previewing.');
          preview=proposals[Number(proposal.dataset.envPreview)];
          if(!preview)throw new Error('The proposal is no longer available. Rebuild the current wind scenario.');
          planner.select({kind:'wall',id:preview.wallId});renderPreview();
          by('env-window-apply').focus();
        });
        if(event.target.closest('#env-window-dismiss')){preview=null;renderPreview();}
        if(event.target.closest('#env-window-apply'))action('env-wind-error',()=>{
          if(!preview||proposalGeometryKey!==currentGeometryKey())throw new Error('Preview inputs or geometry changed. Build and review a fresh proposal; nothing was applied.');
          const command=copy(preview.command);planner.execute(command);
          invalidateWind('New window added through the validated editor command. Existing openings were preserved. Use planner Undo to reverse it; rebuild the path analysis after reviewing operation.');
        });
      };
      element.addEventListener('click',onClick);
      const unsubscribe=planner.subscribe(render);
      render();
      return {render,destroy(){
        unsubscribe();cancelWeather();locationOperation++;monthlyOperation++;destroyed=true;
        element.removeEventListener('input',onInput);element.removeEventListener('click',onClick);
        element.replaceChildren();delete element.dataset.envMounted;
      }};
    }
  }
  return Object.freeze({mount,MATERIAL_PRESETS,buildArchiveRequest,trimWeatherToInterval,
    buildWindowRecommendations,buildAirflowTemplate,buildThermalTemplate,validatePressureInput,validateThermalInput});
});
