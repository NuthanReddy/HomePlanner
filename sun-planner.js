(function(){
  'use strict';
  const byId=id=>document.getElementById(id),model=window.HomeSun;
  const form=byId('sunForm'),results=byId('sunResults'),errorBox=byId('sunError');
  const fields={latitude:byId('sunLatitude'),longitude:byId('sunLongitude'),date:byId('sunDate'),
    time:byId('sunTime'),timeZone:byId('sunTimeZone'),occurrence:byId('sunOccurrence')};
  const download=byId('sunDownload'),annualStatus=byId('sunAnnualStatus');
  const layers={months:byId('sunShowMonths'),hours:byId('sunShowHours')};
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sky={x:400,y:320,radius:240};
  let revision=0,annualKey='',annualRows=[],exportConfig=null,locationRequest=0;
  let referenceKey='',referenceCurves=[],hourCurves=[],activeConfig=null,activePosition=null;

  if(!model){
    errorBox.hidden=false;errorBox.textContent='The local solar scripts could not load. Keep sun-model.js, sun-planner.js and the vendor folder beside index.html, then reload.';
    form.querySelector('fieldset').disabled=true;
    return;
  }

  const degrees=n=>`${n.toFixed(1)}\u00b0`;
  const clock=(instant,timeZone)=>new Intl.DateTimeFormat('en-GB',{
    timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(instant);
  const shortDate=date=>`${monthNames[Number(date.slice(5,7))-1]} ${Number(date.slice(8,10))}`;
  const referenceCacheKey=config=>JSON.stringify([
    config.latitude,config.longitude,config.date.slice(0,4),config.timeZone,config.occurrence
  ]);
  const annualCacheKey=config=>JSON.stringify([referenceCacheKey(config),config.time]);

  function readConfig(){
    return {latitude:fields.latitude.valueAsNumber,longitude:fields.longitude.valueAsNumber,
      date:fields.date.value,time:fields.time.value,timeZone:fields.timeZone.value.trim(),
      occurrence:fields.occurrence.value};
  }

  function eventLabel(instant,config){
    if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))return 'No event';
    const date=model.dateAt(instant,config.timeZone);
    return `${clock(instant,config.timeZone)}${date===config.date?'':` (${date})`}`;
  }

  function skyPoint(sample){
    const radius=sky.radius*(1-Math.max(0,Math.min(90,sample.altitude))/90);
    const angle=sample.azimuth*Math.PI/180;
    return {x:sky.x+radius*Math.sin(angle),y:sky.y-radius*Math.cos(angle)};
  }

  function pathFor(rows,pointFor,valid=()=>true){
    let path='',open=false;
    rows.forEach((row,index)=>{
      if(!valid(row)){open=false;return;}
      const p=pointFor(row,index);
      path+=`${open?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
      open=true;
    });
    return path;
  }

  const skyPath=segments=>segments.map(segment=>pathFor(segment,skyPoint)).join('');

  function skyGrid(){
    let markup='';
    for(let altitude=0;altitude<90;altitude+=10){
      const r=sky.radius*(1-altitude/90);
      markup+=`<circle class="sun-plot-grid" cx="${sky.x}" cy="${sky.y}" r="${r}"/>`;
    }
    for(let azimuth=0;azimuth<360;azimuth+=15){
      const point=skyPoint({altitude:0,azimuth});
      markup+=`<path class="sun-plot-grid" d="M${sky.x} ${sky.y}L${point.x} ${point.y}"/>`;
    }
    const directions=['N','NE','E','SE','S','SW','W','NW'];
    directions.forEach((direction,index)=>{
      const angle=index*Math.PI/4,radius=sky.radius+30;
      markup+=`<text class="sun-plot-text sun-direction" x="${sky.x+radius*Math.sin(angle)}" `+
        `y="${sky.y-radius*Math.cos(angle)+4}" text-anchor="middle">${direction} / ${index*45}\u00b0</text>`;
    });
    for(let altitude=0;altitude<=90;altitude+=10){
      const y=sky.y-sky.radius*(1-altitude/90);
      markup+=`<text class="sun-plot-text sun-plot-label" x="${sky.x+7}" y="${y+12}">${altitude}\u00b0</text>`;
    }
    return markup;
  }

  function referenceStyle(curve,config){
    if(curve.kind==='monthly')return 'sun-month-path';
    if(curve.kind.endsWith('equinox'))return 'sun-equinox-path';
    const longest=(curve.kind==='june-solstice')===(config.latitude>=0);
    return longest?'sun-longest-path':'sun-shortest-path';
  }

  function referenceLabel(curve,config){
    if(curve.kind==='monthly')return `${shortDate(curve.date)} monthly reference`;
    if(curve.kind.endsWith('equinox'))
      return `${curve.kind==='march-equinox'?'March':'September'} equinox reference`;
    const season=curve.kind==='june-solstice'?'June':'December';
    const longest=(curve.kind==='june-solstice')===(config.latitude>0);
    return `${season} solstice reference${config.latitude===0?'':` (${longest?'longest':'shortest'}-day reference)`}`;
  }

  function monthLabels(curves){
    const labels=[];
    for(const curve of curves){
      if(!curve.month)continue;
      const visible=curve.segments.flat(),side=curve.month<=6?1:-1;
      const candidates=visible.filter(row=>(skyPoint(row).x-sky.x)*side>=0);
      if(!candidates.length)continue;
      const sample=candidates.reduce((lowest,row)=>row.altitude<lowest.altitude?row:lowest);
      const point=skyPoint(sample);
      labels.push({date:curve.date,side,point,y:point.y});
    }
    for(const side of [-1,1]){
      const group=labels.filter(label=>label.side===side).sort((a,b)=>a.y-b.y);
      group.forEach((label,index)=>{
        label.y=Math.max(100,Math.min(550,label.y),index?group[index-1].y+22:100);
      });
      if(group.length&&group.at(-1).y>550){
        group.at(-1).y=550;
        for(let i=group.length-2;i>=0;i--)group[i].y=Math.min(group[i].y,group[i+1].y-22);
      }
    }
    return labels.map(label=>{
      const x=label.side>0?710:90,end=x-label.side*8;
      return `<path class="sun-label-leader" d="M${label.point.x} ${label.point.y}L${end} ${label.y}"/>`+
        `<text class="sun-plot-text sun-plot-label sun-month-label" x="${x}" y="${label.y+4}" `+
        `text-anchor="${label.side>0?'start':'end'}">${shortDate(label.date)}</text>`;
    }).join('');
  }

  function drawDaily(config,current){
    const rows=model.dailySamples(config,5);
    const path=skyPath(model.daylightSegments(rows));
    const extrema=model.daylightExtrema(rows);
    const referenceReady=referenceKey===referenceCacheKey(config),annualReady=annualKey===annualCacheKey(config);
    const curves=referenceReady?referenceCurves
      .filter(curve=>layers.months.checked||curve.kind!=='monthly')
      .map(curve=>({...curve,segments:model.daylightSegments(curve.samples)})):[];
    const referenceMarkup=curves.map(curve=>
      `<path class="sun-reference-path ${referenceStyle(curve,config)}" data-sun-reference="${curve.kind}" `+
      `${curve.month?`data-sun-month="${curve.month}" `:''}data-date="${curve.date}" d="${skyPath(curve.segments)}">`+
      `<title>${referenceLabel(curve,config)}: ${curve.date} in ${config.timeZone}${curve.segments.length?'':' (below the horizon all day)'}</title></path>`
    ).join('');
    let hourMarkup='',hourLabels='';
    if(referenceReady&&layers.hours.checked){
      for(const curve of hourCurves){
        if(curve.time===config.time)continue;
        const segments=model.daylightSegments(curve.samples),visible=segments.flat();
        hourMarkup+=`<path class="sun-hour-path" data-sun-hour="${curve.time}" d="${skyPath(segments)}">`+
          `<title>${curve.time} local clock time across ${config.date.slice(0,4)} in ${config.timeZone}</title></path>`;
        if(!visible.length)continue;
        const peak=visible.reduce((highest,row)=>row.altitude>highest.altitude?row:highest),point=skyPoint(peak);
        hourLabels+=`<text class="sun-plot-text sun-plot-label sun-hour-label" x="${point.x+5}" y="${point.y-7}">${curve.time}</text>`;
      }
    }
    const timeSegments=annualReady?model.daylightSegments(annualRows):[];
    const timePeak=annualReady?model.daylightExtrema(annualRows.filter(row=>row.instant))?.max:null;
    let timeLabel='';
    if(timePeak){
      const point=skyPoint(timePeak);
      timeLabel=`<text class="sun-plot-text sun-plot-label sun-time-label" x="${point.x+10}" y="${point.y+18}">${config.time} all year</text>`;
    }
    const dateMarkers=annualReady?curves.map(curve=>{
      const row=annualRows.find(sample=>sample.date===curve.date);
      if(!row?.instant||row.altitude<0)return '';
      const point=skyPoint(row);
      return `<circle class="sun-reference-point" cx="${point.x}" cy="${point.y}" r="3">`+
        `<title>${shortDate(curve.date)} at ${config.time} in ${config.timeZone}</title></circle>`;
    }).join(''):'';
    const p=skyPoint(current);
    const mark=(sample,label,kind)=>{
      const point=skyPoint(sample),left=point.x>=sky.x;
      const x=point.x+(left?-20:20),y=Math.max(30,Math.min(615,point.y+(kind==='max'?-28:28)));
      const anchor=left?'end':'start';
      return `<g class="sun-extrema sun-extrema-${kind}">`+
        `<path d="M${point.x} ${point.y} L${x} ${y}" fill="none" stroke="currentColor"/>`+
        `<circle cx="${point.x}" cy="${point.y}" r="5" fill="${kind==='min'?'var(--panel)':'currentColor'}" stroke="currentColor" stroke-width="2"/>`+
        `<text x="${x}" y="${y-3}" text-anchor="${anchor}">${label} ${degrees(sample.altitude)}</text>`+
        `<text x="${x}" y="${y+12}" text-anchor="${anchor}">${clock(sample.instant,config.timeZone)}</text></g>`;
    };
    byId('sunDaily').innerHTML=
      `<title>Monthly and seasonal sun paths for ${config.date.slice(0,4)}, geographic north up</title>`+
      '<desc>Equidistant altitude diagram: the centre is the zenith at 90 degrees and the outer circle is the horizon. '+
      'Month lines trace complete days; dashed hour curves join the same local clock time across dates. '+
      'Solstice and equinox reference paths are distinguished from the blue selected date and amber selected-time curve. '+
      'Below-horizon portions, skipped times and clock-offset jumps are not connected.</desc>'+
      skyGrid()+`<g id="sunHourTracks">${hourMarkup}</g><g id="sunReferenceTracks">${referenceMarkup}</g>`+
      `<path class="sun-time-path" data-sun-selected-time="${config.time}" d="${skyPath(timeSegments)}"/>`+
      `<path class="sun-plot-path" data-sun-selected-date="${config.date}" d="${path}"/>`+
      dateMarkers+monthLabels(curves)+hourLabels+timeLabel+
      (extrema?mark(extrema.min,'Day min','min')+mark(extrema.max,'Day max','max'):'')+
      (current.altitude>=0?`<circle class="sun-plot-selected" cx="${p.x}" cy="${p.y}" r="6"/>`:'');
    byId('sunLongestLabel').textContent=config.latitude===0?'June solstice ref. (Jun 21)':
      `Longest-day ref. (${config.latitude>0?'Jun 21':'Dec 21'})`;
    byId('sunShortestLabel').textContent=config.latitude===0?'December solstice ref. (Dec 21)':
      `Shortest-day ref. (${config.latitude>0?'Dec 21':'Jun 21'})`;
    byId('sunSelectedTimeLabel').textContent=`${config.time} across the year`;
    const invisible=curves.filter(curve=>!curve.segments.length);
    byId('sunDiagramStatus').textContent=!referenceReady?'Calculating month and hourly paths locally...':
      !annualReady?'Calculating the selected-time curve...':
      `Below-horizon portions and clock-change jumps are left as gaps.${invisible.length
        ?` No above-horizon path on ${invisible.map(curve=>shortDate(curve.date)).join(', ')}.`:''}`;
    byId('sunDailyCaption').textContent=`${config.date} in ${config.timeZone}. Blue: 5-minute samples for this civil date. Amber: ${
      config.time} across ${config.date.slice(0,4)}; small dots mark reference dates. ${
      current.altitude>=0?'The large dot is the selected date and time.':'The selected sun position is below the horizon.'} ${
      extrema?`Daylight elevation ranges from ${degrees(extrema.min.altitude)} at ${clock(extrema.min.instant,config.timeZone)} to ${degrees(extrema.max.altitude)} at ${clock(extrema.max.instant,config.timeZone)} (sampled extrema, not exact horizon crossings).`
        :'There are no above-horizon samples, so daylight minimum and maximum are unavailable.'} This diagram does not include buildings, trees or terrain.`;
  }

  async function refreshReferences(config,token){
    const references=[],hours=[];
    results.setAttribute('aria-busy','true');download.disabled=true;
    for(const curve of model.referencePaths(config)){
      if(token!==revision)return;
      references.push(curve);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    for(const curve of model.hourlyPaths(config)){
      if(token!==revision)return;
      hours.push(curve);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(token!==revision)return;
    referenceCurves=references;hourCurves=hours;referenceKey=referenceCacheKey(config);
  }

  function drawAnnual(config,rows){
    const point=(row,i)=>({x:48+i/(rows.length-1)*584,y:126-row.altitude/90*94});
    const path=pathFor(rows,point,row=>row.instant!==null);
    const selected=rows.findIndex(row=>row.date===config.date);
    const marker=selected>=0&&rows[selected].instant?point(rows[selected],selected):null;
    let labels='';
    for(const altitude of [-90,-45,0,45,90]){
      const y=126-altitude/90*94;
      labels+=`<line x1="48" y1="${y}" x2="632" y2="${y}" class="${altitude===0?'sun-plot-horizon':'sun-plot-grid'}"/>`+
        `<text class="sun-plot-text" x="40" y="${y+4}" text-anchor="end">${altitude}\u00b0</text>`;
    }
    for(let month=1;month<=12;month++){
      const date=`${config.date.slice(0,4)}-${String(month).padStart(2,'0')}-01`;
      const x=48+(model.dayOfYear(date)-1)/(rows.length-1)*584;
      const name=monthNames[month-1];
      labels+=`<text class="sun-plot-text" x="${x}" y="244" text-anchor="middle">${name}</text>`;
    }
    byId('sunAnnual').innerHTML='<title>Annual apparent solar elevation at the selected local clock time</title>'+
      '<desc>One sample for each calendar date; gaps indicate skipped local clock times. The dashed zero line is the horizon.</desc>'+
      labels+`<path class="sun-plot-path" d="${path}"/>`+
      (marker?`<circle class="sun-plot-selected" cx="${marker.x}" cy="${marker.y}" r="5"/>`:'');
    const skipped=rows.filter(row=>!row.instant).length,repeated=rows.filter(row=>row.status.includes('repeated')).length;
    annualStatus.textContent=`${rows.length} dates at ${config.time} in ${config.timeZone}; ${
      rows.length-skipped} available${skipped?`, ${skipped} skipped by clock/calendar changes`:''}.${
      repeated?` Repeated times use the ${config.occurrence||'earlier'} occurrence.`:''} One point per day, not annual energy or hourly weather.`;
  }

  async function refreshAnnual(config,token){
    annualStatus.textContent='Calculating the year locally...';
    results.setAttribute('aria-busy','true');download.disabled=true;
    const rows=[];
    for(const row of model.annualSamples(config)){
      if(token!==revision)return;
      rows.push(row);
      if(rows.length%24===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(token!==revision)return;
    annualRows=rows;
    annualKey=annualCacheKey(config);
    exportConfig={...config};
    drawAnnual(config,rows);
    results.setAttribute('aria-busy','false');download.disabled=false;
  }

  async function update(){
    const token=++revision;
    errorBox.hidden=true;
    Object.values(fields).forEach(field=>field.removeAttribute('aria-invalid'));
    try{
      const config=readConfig(),current=model.calculate(config);
      document.dispatchEvent(new CustomEvent('homeplanner:sun-change',{detail:config}));
      if(token!==revision)return;
      byId('sunOccurrenceRow').hidden=!current.ambiguous;
      results.hidden=false;
      byId('sunAzimuth').textContent=degrees(current.azimuth);
      byId('sunAltitude').textContent=degrees(current.altitude);
      byId('sunZenith').textContent=degrees(current.zenith);
      byId('sunInstant').textContent=`${config.date} ${clock(current.instant,config.timeZone)} ${config.timeZone} | ${current.instant.toISOString().replace('.000Z',' UTC')}`;
      byId('sunState').textContent=current.altitude>=0?'Sun above the horizon':'Sun below the horizon';
      byId('sunRise').textContent=eventLabel(current.events.sunrise,config);
      byId('sunNoon').textContent=eventLabel(current.events.solarNoon,config);
      byId('sunSet').textContent=eventLabel(current.events.sunset,config);
      byId('sunEventNote').textContent=current.events.alwaysUp
        ? 'Polar day: the sun does not set in this solar cycle.'
        : current.events.alwaysDown?'Polar night: the sun does not rise in this solar cycle.'
          : 'Events are for the solar cycle near local noon, assuming an unobstructed horizon at ground level. Events outside the selected day include their date.';
      const year=Number(config.date.slice(0,4));
      byId('sunDay').max=String(model.daysInYear(year));byId('sunDay').value=String(model.dayOfYear(config.date));
      byId('sunDayValue').textContent=`${config.date} (${model.dayOfYear(config.date)} / ${model.daysInYear(year)})`;
      byId('sunMinute').value=String(+config.time.slice(0,2)*60 + +config.time.slice(3));
      byId('sunMinuteValue').textContent=config.time;
      activeConfig=config;activePosition=current;
      drawDaily(config,current);
      if(referenceKey!==referenceCacheKey(config)){
        await refreshReferences(config,token);
        if(token!==revision)return;
        drawDaily(config,current);
      }
      const key=annualCacheKey(config);
      if(key===annualKey){
        exportConfig={...config};
        drawAnnual(config,annualRows);results.setAttribute('aria-busy','false');download.disabled=false;
      }else await refreshAnnual(config,token);
      if(token===revision)drawDaily(config,current);
    }catch(error){
      if(!(error instanceof model.InputError))throw error;
      if(token!==revision)return;
      results.hidden=true;results.setAttribute('aria-busy','false');download.disabled=true;
      errorBox.textContent=error.message;errorBox.hidden=false;
      if(fields[error.field])fields[error.field].setAttribute('aria-invalid','true');
      byId('sunOccurrenceRow').hidden=error.code!=='ambiguous';
    }
  }

  form.addEventListener('submit',event=>{event.preventDefault();update();});
  Object.values(fields).forEach(field=>field.addEventListener('input',update));
  Object.values(layers).forEach(layer=>layer.addEventListener('change',()=>{
    if(activeConfig&&!results.hidden)drawDaily(activeConfig,activePosition);
  }));
  document.addEventListener('homeplanner:project-context',()=>{
    locationRequest++;
    byId('sunLocate').disabled=false;
    byId('sunLocationStatus').textContent='Project context changed. Any previous location result will be ignored; confirm the site coordinates or detect again.';
  });
  byId('sunLocate').addEventListener('click',async()=>{
    const button=byId('sunLocate'),status=byId('sunLocationStatus');
    const before=[fields.latitude.value,fields.longitude.value];
    const token=++locationRequest,projectId=window.HomePlanner?.getProject().id??null;
    button.disabled=true;status.textContent='Requesting your device location. Your browser may ask for permission.';
    try{
      if(!window.HomePlannerLocation)throw new Error('The local location helper is unavailable. Enter coordinates manually.');
      const location=await window.HomePlannerLocation.detect();
      if(token!==locationRequest)return;
      if(projectId!==(window.HomePlanner?.getProject().id??null)){
        status.textContent='The project changed while locating the device. Its coordinates were not replaced; detect again if needed.';
        return;
      }
      if(before[0]!==fields.latitude.value||before[1]!==fields.longitude.value){
        status.textContent='A device location was received, but you edited the coordinates while waiting. Your manual values were kept.';
        return;
      }
      fields.latitude.value=String(location.latitude);fields.longitude.value=String(location.longitude);
      fields.latitude.dispatchEvent(new Event('input',{bubbles:true}));
      status.textContent=`Device coordinates applied (reported accuracy ${Math.round(location.accuracyM)} m). Confirm that the device is at the site. The time zone was not changed.`;
    }catch(error){
      if(token===locationRequest)status.textContent=error.message;
    }finally{
      if(token===locationRequest)button.disabled=false;
    }
  });
  byId('sunDay').addEventListener('input',()=>{
    const year=Number(fields.date.value.slice(0,4));
    if(!Number.isInteger(year)||year<1){update();return;}
    fields.date.value=model.dateFromDay(year,+byId('sunDay').value);update();
  });
  byId('sunMinute').addEventListener('input',()=>{
    const minute=+byId('sunMinute').value;
    fields.time.value=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
    update();
  });
  byId('sunNow').addEventListener('click',()=>{
    const now=new Date();
    try{
      fields.date.value=model.dateAt(now,fields.timeZone.value.trim());
      fields.time.value=clock(now,fields.timeZone.value.trim());
      const early=model.resolveLocal(fields.date.value,fields.time.value,fields.timeZone.value.trim(),'earlier');
      fields.occurrence.value=early.ambiguous
        ? (Math.floor(now.getTime()/60000)*60000===early.instant.getTime()?'earlier':'later') : '';
    }catch(error){
      if(!(error instanceof model.InputError))throw error;
    }
    update();
  });
  document.querySelectorAll('[data-sun-date]').forEach(button=>button.addEventListener('click',()=>{
    const year=fields.date.value.slice(0,4);
    if(!/^\d{4}$/.test(year)){update();return;}
    fields.date.value=`${year}-${button.dataset.sunDate}`;update();
  }));
  download.addEventListener('click',()=>{
    if(!exportConfig||download.disabled)return;
    const blob=new Blob([model.csv(exportConfig,annualRows)],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`sun-path-${exportConfig.date.slice(0,4)}.csv`;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  });
  fields.date.value=model.dateAt(new Date(),fields.timeZone.value);
  update();
})();
