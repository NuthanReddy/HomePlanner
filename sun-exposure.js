(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    root.HomeSunExposure=api;
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>api.mount(),{once:true});
    else api.mount();
  }
})(globalThis,function(root){
  'use strict';
  const SIDES=['front','right','rear','left'];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const title=value=>value[0].toUpperCase()+value.slice(1);
  const emptyNeighbors=()=>Object.fromEntries(SIDES.map(side=>[side,{state:'unknown'}]));
  const numeric=(value,label)=>{
    if(!Number.isFinite(value))throw new Error(`${label} must be a finite number.`);
    return value;
  };

  function validateNeighbors(neighbors,{complete=false}={}){
    if(!neighbors||typeof neighbors!=='object'||Array.isArray(neighbors))throw new Error('Neighbour inputs must describe all four plot sides.');
    const result={};
    for(const side of SIDES){
      const item=neighbors[side];
      if(!item||!['unknown','clear','block'].includes(item.state))throw new Error(`Choose the ${side} neighbour state.`);
      if(complete&&item.state==='unknown')throw new Error(`The ${side} side is unknown. Choose a neighbouring block or explicitly confirm clear space.`);
      result[side]={state:item.state};
      if(item.state==='block'){
        for(const key of ['heightM','gapM']){
          const value=item[key];
          if(!complete&&(value===null||value===undefined)){result[side][key]=null;continue;}
          numeric(value,`${title(side)} ${key==='heightM'?'height':'boundary gap'}`);
          if(value<0||(key==='heightM'&&value===0))throw new Error(`${title(side)} ${key==='heightM'?'height must be positive':'gap cannot be negative'}.`);
          result[side][key]=value;
        }
      }
    }
    return result;
  }

  function prepareScenes(project,scenes){
    if(!Array.isArray(scenes)||!scenes.length)throw new Error('Create a valid house layout in Room Planner before calculating sunlight.');
    const missing=project.floors.filter(floor=>!scenes.some(scene=>scene.floorId===floor.id));
    if(missing.length)throw new Error(`Missing floor geometry: ${missing.map(floor=>floor.name).join(', ')}. Open and complete these floors in Room Planner first.`);
    return scenes.map(source=>{
      if(!source.plot)throw new Error('The actual plot boundary is unavailable. Recalculate this floor from Plot Planner; a buildable floor plate is not the plot.');
      if(source.diagnostics?.some(item=>item.level==='error'))throw new Error('Resolve the Room Planner geometry errors before calculating whole-house sunlight.');
      const scene=copy(source),plot=scene.plot,dx=-numeric(plot.x,'Plot origin x'),dy=-numeric(plot.y,'Plot origin y');
      const shift=point=>({...point,x:point.x+dx,y:point.y+dy});
      scene.floor={x:0,y:0,w:numeric(plot.w,'Plot width'),h:numeric(plot.h,'Plot depth')};
      scene.plot={...scene.floor};
      scene.building=shift(scene.building);
      scene.walls=scene.walls.map(wall=>({...wall,start:shift(wall.start),end:shift(wall.end)}));
      scene.rooms=scene.rooms.map(room=>({...room,rect:shift(room.rect)}));
      scene.obstacles=scene.obstacles.map(shift);
      return scene;
    });
  }

  function inputKey(project,scenes,config,neighbors){
    return JSON.stringify({projectId:project.id,date:config.date,latitude:config.latitude,
      longitude:config.longitude,timeZone:config.timeZone,neighbors,
      floors:project.floors.map(floor=>({id:floor.id,name:floor.name,heightM:floor.heightM})),
      scenes:scenes.map(scene=>({floorId:scene.floorId,headingDeg:scene.headingDeg,plot:scene.plot,
        building:scene.building,floorElevationM:scene.floorElevationM,wallHeightM:scene.wallHeightM,
        roofThicknessM:scene.roofThicknessM,walls:scene.walls,openings:scene.openings,
        rooms:scene.rooms.map(room=>({id:room.id,rect:room.rect})),obstacles:scene.obstacles,
        regulatory:scene.regulatory}))});
  }

  function groupSurfaces(result,scenes){
    const groups=new Map();
    for(const surface of result.surfaces){
      const scene=scenes.find(item=>item.floorId===surface.floorId);
      const h=scene.headingDeg*Math.PI/180,n=surface.normal;
      const east=n.x*Math.cos(h)-n.y*Math.sin(h),north=-n.x*Math.sin(h)-n.y*Math.cos(h);
      const bearing=surface.type==='roof'?null:(Math.atan2(east,north)*180/Math.PI+360)%360;
      const key=`${surface.floorId}:${surface.type}:${bearing===null?'up':bearing.toFixed(3)}`;
      if(!groups.has(key))groups.set(key,{floorId:surface.floorId,type:surface.type,bearing,areaM2:0,
        averageHours:0,unobstructedHours:0,blockedHours:0,minHours:Infinity,maxHours:0,firstSunUTC:null,lastSunUTC:null});
      const group=groups.get(key);
      for(const field of ['averageHours','unobstructedHours','blockedHours'])group[field]+=surface[field]*surface.areaM2;
      group.areaM2+=surface.areaM2;
      group.minHours=Math.min(group.minHours,surface.minHours);group.maxHours=Math.max(group.maxHours,surface.maxHours);
      if(surface.firstSunUTC&&(!group.firstSunUTC||surface.firstSunUTC<group.firstSunUTC))group.firstSunUTC=surface.firstSunUTC;
      if(surface.lastSunUTC&&(!group.lastSunUTC||surface.lastSunUTC>group.lastSunUTC))group.lastSunUTC=surface.lastSunUTC;
    }
    return [...groups.values()].map(group=>{
      for(const field of ['averageHours','unobstructedHours','blockedHours'])group[field]/=group.areaM2;
      return group;
    });
  }

  function validateResult(result){
    const invalid=()=>{throw new Error('The saved sunlight result is incomplete or invalid. Recalculate the selected day.');};
    if(!result||!Array.isArray(result.surfaces))invalid();
    for(const key of ['elapsedHours','aboveHorizonHours','nearHorizonExcludedHours'])
      if(!Number.isFinite(result[key])||result[key]<0)invalid();
    if(result.aboveHorizonHours>result.elapsedHours+1e-8||
      result.nearHorizonExcludedHours>result.aboveHorizonHours+1e-8)invalid();
    for(const key of ['assumptions','warnings'])
      if(!Array.isArray(result[key])||result[key].some(item=>typeof item!=='string'))invalid();
    const ids=new Set();
    for(const surface of result.surfaces){
      if(!surface||typeof surface.id!=='string'||ids.has(surface.id)||
        typeof surface.floorId!=='string'||!['roof','wall'].includes(surface.type))invalid();
      ids.add(surface.id);
      for(const key of ['areaM2','averageHours','minHours','maxHours','unobstructedHours','blockedHours'])
        if(!Number.isFinite(surface[key])||surface[key]<0)invalid();
      if(surface.areaM2===0||surface.minHours>surface.averageHours+1e-8||
        surface.averageHours>surface.maxHours+1e-8||surface.maxHours>surface.unobstructedHours+1e-8||
        surface.unobstructedHours>result.elapsedHours+1e-8||
        Math.abs(surface.blockedHours-(surface.unobstructedHours-surface.averageHours))>1e-8)invalid();
      if(!surface.normal||!['x','y','z'].every(axis=>Number.isFinite(surface.normal[axis]))||
        Math.abs(Math.hypot(surface.normal.x,surface.normal.y,surface.normal.z)-1)>1e-6)invalid();
      for(const key of ['firstSunUTC','lastSunUTC']){
        const value=surface[key];
        if(value!==null&&(typeof value!=='string'||!Number.isFinite(Date.parse(value))))invalid();
      }
      if((surface.firstSunUTC===null)!==(surface.lastSunUTC===null)||
        (surface.firstSunUTC!==null&&Date.parse(surface.lastSunUTC)<Date.parse(surface.firstSunUTC)))invalid();
    }
  }

  function mount(host=root.document?.getElementById('sunExposure'),planner=root.HomePlanner){
    if(!host||host.dataset.mounted)return null;
    host.dataset.mounted='true';
    const by=id=>host.querySelector('#'+id),Sun=root.HomeSun,Physics=root.BuildingPhysics;
    if(!planner||!Sun?.dailyIntervals||!Physics?.createSunlightStudy){
      by('sunExposureError').textContent='House sunlight needs the local planner, solar and building-physics scripts. Keep all companion files beside index.html and reload.';
      by('sunExposureError').hidden=false;by('sunExposureCalculate').disabled=true;by('sunExposureSave').disabled=true;
      return null;
    }
    by('sunNeighborRows').innerHTML=SIDES.map(side=>{
      const name=title(side),prefix='sunNeighbor'+name;
      return `<div class="sun-neighbor-row"><b id="${prefix}Label">${name}</b>`+
        `<label class="sun-neighbor-state" for="${prefix}State">Neighbour state<select id="${prefix}State" aria-label="${name} neighbour state">`+
        '<option value="unknown">Unknown</option><option value="clear">Clear / no block</option><option value="block">Neighbour block</option></select></label>'+
        `<label for="${prefix}Height">Height (m)<input id="${prefix}Height" type="number" min="0" step="any" aria-label="${name} neighbour height in metres" disabled></label>`+
        `<label for="${prefix}Gap">Boundary gap (m)<input id="${prefix}Gap" type="number" min="0" step="any" aria-label="${name} boundary gap in metres" disabled></label></div>`;
    }).join('');
    let projectId=null,savedText='',dirty=false,revision=0,running=false,storedResult=null,geometrySignature='',availabilityError=null;
    const field=(side,suffix)=>by('sunNeighbor'+title(side)+suffix);
    const config=()=>({
      latitude:root.document.getElementById('sunLatitude').valueAsNumber,
      longitude:root.document.getElementById('sunLongitude').valueAsNumber,
      date:root.document.getElementById('sunDate').value,time:root.document.getElementById('sunTime').value,
      timeZone:root.document.getElementById('sunTimeZone').value.trim(),
      occurrence:root.document.getElementById('sunOccurrence').value
    });
    const error=problem=>{
      if(!(problem instanceof Error)&&typeof problem?.message!=='string')throw problem;
      by('sunExposureError').textContent=problem.message;by('sunExposureError').hidden=false;
    };
    function readNeighbors(complete=false){
      const neighbors=Object.fromEntries(SIDES.map(side=>{
        const state=field(side,'State').value;
        return [side,{state,...(state==='block'?{
          heightM:field(side,'Height').value===''?null:field(side,'Height').valueAsNumber,
          gapM:field(side,'Gap').value===''?null:field(side,'Gap').valueAsNumber
        }:{})}];
      }));
      return validateNeighbors(neighbors,{complete});
    }
    function fillNeighbors(neighbors){
      const values=validateNeighbors(neighbors);
      SIDES.forEach(side=>{
        const item=values[side];
        field(side,'State').value=item.state;
        field(side,'Height').value=item.heightM??'';
        field(side,'Gap').value=item.gapM??'';
      });
      dirty=false;
    }
    function invalidate(message){
      revision++;running=false;storedResult=null;
      by('sunExposureResults').innerHTML='';
      by('sunExposureCalculate').disabled=false;by('sunExposureSave').disabled=false;
      by('sunExposureStatus').textContent=message;
      host.setAttribute('aria-busy','false');
    }
    const hours=value=>{
      const minutes=Math.round(value*60);
      return `${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,'0')} min`;
    };
    function eventTime(utc,settings){
      if(!utc)return 'None';
      const instant=new Date(utc),date=Sun.dateAt(instant,settings.timeZone);
      const time=new Intl.DateTimeFormat('en-GB',{timeZone:settings.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant);
      return time+(date===settings.date?'':` (${date})`);
    }
    function display(entry,project,scenes){
      validateResult(entry.output);
      const rows=groupSurfaces(entry.output,scenes);
      const limitations=[...new Set([...entry.output.assumptions,...entry.output.warnings])];
      by('sunExposureResults').innerHTML=
        `<p><b>${escape(entry.config.date)}</b> in ${escape(entry.config.timeZone)}. Potential direct sun on the modeled house, not weather-adjusted sunshine.</p>`+
        `<p class="mini">Sun above the 1° calculation cutoff: ${hours(entry.output.aboveHorizonHours-entry.output.nearHorizonExcludedHours)}. Near-horizon time excluded: ${hours(entry.output.nearHorizonExcludedHours)}.</p>`+
        '<div class="sun-exposure-table" tabindex="0" role="region" aria-label="House sunlight hours by surface"><table><thead><tr>'+
        '<th>Surface</th><th>Area (m²)</th><th>Average direct sun</th><th>Point range</th><th>Lost to shade</th><th>First / last sun</th>'+
        '</tr></thead><tbody>'+rows.map(row=>{
          const floor=project.floors.find(item=>item.id===row.floorId);
          const side=row.type==='roof'?'Exposed roof / terrace':`${Math.round(row.bearing)}°-facing exterior wall`;
          return `<tr><td>${escape(floor.name)}<br>${side}</td><td>${row.areaM2.toFixed(1)}</td>`+
            `<td>${hours(row.averageHours)}</td><td>${hours(row.minHours)} – ${hours(row.maxHours)}</td>`+
            `<td>${hours(row.blockedHours)}</td><td>${escape(eventTime(row.firstSunUTC,entry.config))}<br>${escape(eventTime(row.lastSunUTC,entry.config))}</td></tr>`;
        }).join('')+'</tbody></table></div>'+
        '<p class="mini sun-scroll-hint">Scroll the results sideways for point ranges, shade loss and first/last sunlight.</p>'+
        '<p class="mini">Average is area-weighted across sampled points; supplied partial-transmission obstacles also weight exposure. The range is shortest to longest exposure across those points. Lost to shade compares the same surface without obstructions, not a full day of sunshine on every wall. First/last sun can include shaded gaps, not one continuous interval. Opaque wall faces exclude window and door openings.</p>'+
        `<p class="mini">5-minute midpoint intervals; 8-axis surface sampling. Near-horizon sun below the model's 1° cutoff is excluded. Each neighbourhood block extends along its entire side at the entered boundary gap; width/depth, terrain, foliage detail and weather are not inferred.</p>`+
        (limitations.length?`<details><summary>Model assumptions and limitations</summary><ul>${limitations.map(item=>`<li>${escape(item)}</li>`).join('')}</ul></details>`:'');
    }
    function currentState(){
      const project=planner.getProject(),raw=planner.getScenes(),settings=config();
      Sun.calculate(settings);
      if(root.__plotInputError)throw new Error(`Fix the Plot Planner inputs first: ${root.__plotInputError}`);
      return {project,scenes:prepareScenes(project,raw),settings};
    }
    function render(event){
      try{
        const project=planner.getProject(),saved=project.environment.sunlight||{};
        const neighbors=saved.neighbors??emptyNeighbors(),text=JSON.stringify(neighbors);
        const replacing=project.id!==projectId||event?.type==='restore'||event?.type==='project';
        if(replacing){
          invalidate('Neighbour inputs are separate from a survey. Specify every side before calculating.');
          fillNeighbors(neighbors);projectId=project.id;savedText=text;
        }else if(text!==savedText&&!dirty){fillNeighbors(neighbors);savedText=text;}
        SIDES.forEach(side=>{
          const enabled=field(side,'State').value==='block';
          field(side,'Height').disabled=!enabled;field(side,'Gap').disabled=!enabled;
        });
        const {scenes,settings}=currentState(),first=scenes[0],plot=first.floor;
        if(availabilityError&&by('sunExposureError').textContent===availabilityError)by('sunExposureError').hidden=true;
        availabilityError=null;
        const signature=inputKey(project,scenes,settings,readNeighbors());
        if(geometrySignature&&geometrySignature!==signature)
          invalidate('Plot, house, date, site or neighbour inputs changed. Recalculate sunlight.');
        geometrySignature=signature;
        SIDES.forEach((side,index)=>{
          const bearing=(first.headingDeg+index*90)%360;
          by('sunNeighbor'+title(side)+'Label').textContent=`${title(side)} (${Math.round(bearing)}°)`;
        });
        const names=project.floors.map(floor=>floor.name).join(', ');
        by('sunExposurePlot').textContent=`Net plot: ${plot.w.toFixed(2)} × ${plot.h.toFixed(2)} m (${(plot.w/0.3048).toFixed(1)} × ${(plot.h/0.3048).toFixed(1)} ft). Front bearing ${first.headingDeg}°. Modeled floors: ${names}. Building positions and setbacks come from each floor's Plot Planner context, not from the floor-plate edge.`;
        const planned=first.regulatory?.plannedFloors,notes=[];
        if(planned&&planned!==scenes.length)notes.push(`Plot Planner's area/cost scenario has ${planned} habitable floors; this study uses the ${scenes.length} saved floor layout(s), not an assumed repetition. Add or duplicate actual storeys in Room Planner to study the full house.`);
        if(first.regulatory?.stiltParking&&Math.min(...scenes.map(scene=>scene.floorElevationM))===0)
          notes.push('Stilt parking is selected, but the physical building base is still 0 m. Set the actual raised base in Environment if the house sits above parking.');
        notes.push('Review these assumed heights and footprints; a regulatory height band is not a measured house height.');
        by('sunExposureGeometryNote').textContent=notes.join(' ');
        by('sunExposureGeometry').innerHTML='<table><thead><tr><th>Modeled floor</th><th>Building (m)</th><th>Front / left gap (m)</th><th>Base elevation (m)</th><th>Wall height (m)</th><th>Roof top (m)</th></tr></thead><tbody>'+
          scenes.map(scene=>`<tr><td>${escape(project.floors.find(floor=>floor.id===scene.floorId).name)}</td>`+
            `<td>${scene.building.w.toFixed(2)} × ${scene.building.h.toFixed(2)}</td><td>${scene.building.y.toFixed(2)} / ${scene.building.x.toFixed(2)}</td>`+
            `<td>${scene.floorElevationM.toFixed(2)}</td><td>${scene.wallHeightM.toFixed(2)}</td><td>${(scene.floorElevationM+scene.wallHeightM+scene.roofThicknessM).toFixed(2)}</td></tr>`).join('')+'</tbody></table>';
        const nonCompliant=scenes.some(scene=>scene.regulatory?.nonCompliantSetbacks);
        by('sunExposureScenario').hidden=!nonCompliant;
        by('sunExposureScenario').textContent=nonCompliant?'NON-COMPLIANT SETBACK SCENARIO: sunlight results do not establish permission or safety.':'';
        if(!running&&!dirty&&saved.result?.key===signature){
          try{
            storedResult=saved.result;display(storedResult,project,scenes);
            by('sunExposureStatus').textContent='Saved sunlight result matches the current inputs.';
          }catch(problem){
            storedResult=null;by('sunExposureResults').innerHTML='';
            by('sunExposureStatus').textContent='Stored result unavailable. Recalculate the selected day.';
            error(problem);
          }
        }
        by('sunExposureCalculate').disabled=running;
      }catch(problem){
        invalidate('Sunlight duration is unavailable until the inputs above are complete.');
        availabilityError=problem.message;
        error(problem);by('sunExposureCalculate').disabled=true;
      }
    }
    function save(neighbors,result){
      const project=planner.getProject(),previous=project.environment.sunlight||{};
      const next={...previous,schemaVersion:1,neighbors};
      if(result)next.result=result;
      else delete next.result;
      dirty=false;savedText=JSON.stringify(neighbors);
      planner.execute({type:'set-environment',patch:{sunlight:next}});
    }
    by('sunExposureForm').addEventListener('input',()=>{
      dirty=true;by('sunExposureError').hidden=true;
      invalidate('Neighbour inputs edited but not saved. Save them or calculate the selected day.');
      render();
    });
    by('sunExposureSave').addEventListener('click',()=>{
      by('sunExposureError').hidden=true;
      try{save(readNeighbors());by('sunExposureStatus').textContent='Neighbour inputs saved with the project. Unknown/incomplete sides cannot be used for a sunlight result.';}
      catch(problem){error(problem);}
    });
    by('sunExposureForm').addEventListener('submit',async event=>{
      event.preventDefault();by('sunExposureError').hidden=true;
      const token=++revision;
      try{
        const neighbors=readNeighbors(true),{project,scenes,settings}=currentState();
        const key=inputKey(project,scenes,settings,neighbors);
        save(neighbors);
        if(token!==revision)return;
        const study=Physics.createSunlightStudy(scenes,{neighbors,samplesPerAxis:8});
        running=true;host.setAttribute('aria-busy','true');by('sunExposureCalculate').disabled=true;by('sunExposureSave').disabled=true;
        by('sunExposureResults').innerHTML='';
        let count=0;
        for(const interval of Sun.dailyIntervals(settings,5)){
          if(token!==revision)return;
          study.addInterval({startUTC:interval.startUTC,endUTC:interval.endUTC,sunENU:interval.vector});
          count++;
          if(count%4===0){
            by('sunExposureStatus').textContent=`Calculating locally: ${count} five-minute intervals...`;
            await new Promise(resolve=>root.setTimeout(resolve,0));
          }
        }
        if(token!==revision)return;
        const latest=currentState();
        if(inputKey(latest.project,latest.scenes,latest.settings,readNeighbors(true))!==key){
          invalidate('Inputs changed during calculation. Recalculate sunlight.');return;
        }
        storedResult={schemaVersion:1,key,calculatedAt:new Date().toISOString(),config:settings,
          neighbors,output:study.getResult()};
        running=false;save(neighbors,storedResult);display(storedResult,latest.project,latest.scenes);
        by('sunExposureStatus').textContent=`Calculated and saved ${count} intervals for ${settings.date}. Results are geometric estimates, not guaranteed sunshine.`;
      }catch(problem){error(problem);}
      finally{
        if(token===revision){running=false;host.setAttribute('aria-busy','false');by('sunExposureCalculate').disabled=false;by('sunExposureSave').disabled=false;}
      }
    });
    const onSun=()=>{by('sunExposureError').hidden=true;render();};
    root.document.addEventListener('homeplanner:sun-change',onSun);
    const unsubscribe=planner.subscribe(render);
    render();
    return {render,destroy(){revision++;unsubscribe();root.document.removeEventListener('homeplanner:sun-change',onSun);}};
  }
  return Object.freeze({emptyNeighbors,validateNeighbors,prepareScenes,inputKey,groupSurfaces,mount});
});
