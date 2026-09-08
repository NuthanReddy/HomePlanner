(function(){
  'use strict';
  const byId=id=>document.getElementById(id),model=window.HomeSun;
  const form=byId('sunForm'),results=byId('sunResults'),errorBox=byId('sunError');
  const fields={latitude:byId('sunLatitude'),longitude:byId('sunLongitude'),date:byId('sunDate'),
    time:byId('sunTime'),timeZone:byId('sunTimeZone'),occurrence:byId('sunOccurrence')};
  const download=byId('sunDownload'),annualStatus=byId('sunAnnualStatus');
  let revision=0,annualKey='',annualRows=[],exportConfig=null;

  if(!model){
    errorBox.hidden=false;errorBox.textContent='The local solar scripts could not load. Keep sun-model.js, sun-planner.js and the vendor folder beside index.html, then reload.';
    form.querySelector('fieldset').disabled=true;
    return;
  }

  const degrees=n=>`${n.toFixed(1)}\u00b0`;
  const clock=(instant,timeZone)=>new Intl.DateTimeFormat('en-GB',{
    timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(instant);

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
    const radius=140*(1-Math.max(0,Math.min(90,sample.altitude))/90);
    const angle=sample.azimuth*Math.PI/180;
    return {x:230+radius*Math.sin(angle),y:185-radius*Math.cos(angle)};
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

  function drawDaily(config,current){
    const rows=model.dailySamples(config);
    const path=pathFor(rows,skyPoint,row=>row.altitude>=0);
    const p=skyPoint(current);
    byId('sunDaily').innerHTML=
      '<title>Daily sky path, geographic north up</title>'+
      '<desc>Equidistant altitude diagram. The centre is the zenith at 90 degrees; the outer circle is the horizon at zero degrees. Only above-horizon samples are connected.</desc>'+
      [140,140*2/3,140/3].map(r=>`<circle class="sun-plot-grid" cx="230" cy="185" r="${r}"/>`).join('')+
      '<path class="sun-plot-grid" d="M230 45V325M90 185H370"/>'+
      '<g class="sun-plot-text" text-anchor="middle"><text x="230" y="25">N / 0\u00b0</text><text x="404" y="190">E / 90\u00b0</text>'+
      '<text x="230" y="350">S / 180\u00b0</text><text x="50" y="190">W / 270\u00b0</text></g>'+
      '<g class="sun-plot-text"><text x="238" y="53">0\u00b0</text><text x="238" y="99">30\u00b0</text><text x="238" y="146">60\u00b0</text><text x="238" y="182">90\u00b0</text></g>'+
      `<path class="sun-plot-path" d="${path}"/>`+
      (current.altitude>=0?`<circle class="sun-plot-selected" cx="${p.x}" cy="${p.y}" r="6"/>`:'');
    byId('sunDailyCaption').textContent=`${config.date} in ${config.timeZone}. Blue: 15-minute samples for this civil date. ${
      current.altitude>=0?'Amber: selected time.':'The selected sun position is below the horizon.'} This diagram does not include buildings, trees or terrain.`;
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
      const name=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1];
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
    annualKey=JSON.stringify([config.latitude,config.longitude,config.date.slice(0,4),config.time,config.timeZone,config.occurrence]);
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
      drawDaily(config,current);
      const key=JSON.stringify([config.latitude,config.longitude,config.date.slice(0,4),config.time,config.timeZone,config.occurrence]);
      if(key===annualKey){
        drawAnnual(config,annualRows);results.setAttribute('aria-busy','false');download.disabled=false;
      }else await refreshAnnual(config,token);
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
