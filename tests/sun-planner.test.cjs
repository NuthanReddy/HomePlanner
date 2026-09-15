const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const model=require('../sun-model.js');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'sun-planner.js'),'utf8');
const base={latitude:17.385,longitude:78.4867,date:'2026-09-08',time:'12:00',
  timeZone:'Asia/Kolkata',occurrence:''};
const fieldIds={latitude:'sunLatitude',longitude:'sunLongitude',date:'sunDate',
  time:'sunTime',timeZone:'sunTimeZone',occurrence:'sunOccurrence'};

function element(id){
  const listeners=new Map(),attributes=new Map();
  return {id,value:'',checked:false,hidden:false,disabled:false,innerHTML:'',textContent:'',
    get valueAsNumber(){return this.value===''?NaN:Number(this.value);},
    addEventListener(type,listener){
      if(!listeners.has(type))listeners.set(type,[]);
      listeners.get(type).push(listener);
    },
    async emit(type){await Promise.all((listeners.get(type)||[]).map(listener=>listener({preventDefault(){}})));},
    setAttribute(name,value){attributes.set(name,String(value));},
    getAttribute(name){return attributes.get(name)??null;},
    removeAttribute(name){attributes.delete(name);},
    querySelector(){return element('fieldset');}
  };
}

async function planner(config=base,modelOverrides={}){
  const nodes=new Map([...html.matchAll(/\bid="(sun\w+)"/g)].map(match=>[match[1],element(match[1])]));
  const calls={references:0,hours:0,annual:0},downloads=[];
  const api={...model,
    referencePaths(config){calls.references++;return model.referencePaths(config);},
    hourlyPaths(config){calls.hours++;return model.hourlyPaths(config);},
    annualSamples(config){calls.annual++;return model.annualSamples(config);},
    ...modelOverrides
  };
  for(const [field,id] of Object.entries(fieldIds))nodes.get(id).value=String(config[field]);
  nodes.get('sunShowMonths').checked=true;nodes.get('sunShowHours').checked=true;
  const document={
    getElementById:id=>nodes.get(id),
    addEventListener(){},dispatchEvent(){},querySelectorAll(){return [];},
    body:{appendChild(){}},
    createElement:()=>({click(){downloads.push(this);},remove(){}})
  };
  let exportedBlob=null;
  vm.runInNewContext(script,{
    window:{HomeSun:api},document,Intl,Date,Map,Set,Math,Number,Object,Error,RangeError,Blob,
    CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},
    setTimeout:callback=>setImmediate(callback),
    URL:{createObjectURL(blob){exportedBlob=blob;return 'blob:sun-test';},revokeObjectURL(){}}
  });
  const configure=async changes=>{
    for(const [field,value] of Object.entries(changes))nodes.get(fieldIds[field]).value=String(value);
    await nodes.get('sunDate').emit('input');
  };
  await configure(config);
  return {nodes,calls,downloads,configure,getBlob:()=>exportedBlob,
    sky:()=>nodes.get('sunDaily').innerHTML};
}

function paths(markup){
  return [...markup.matchAll(/<path\b([^>]+)>/g)].map(match=>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute=>[attribute[1],attribute[2]])));
}

test('diagram renders all monthly day paths, seasonal paths and constant-clock curves',async()=>{
  const ui=await planner(),drawing=paths(ui.sky());
  const months=drawing.filter(item=>item['data-sun-month']);
  assert.equal(months.length,12);
  assert.deepEqual(months.map(item=>Number(item['data-sun-month'])),Array.from({length:12},(_,i)=>i+1));
  for(const item of months){
    assert.ok(item.d.startsWith('M'));
    assert.ok((item.d.match(/L/g)||[]).length>100);
  }
  assert.equal(drawing.filter(item=>item['data-sun-reference']).length,14);
  assert.equal(drawing.find(item=>item['data-sun-reference']==='june-solstice').class,'sun-reference-path sun-longest-path');
  assert.equal(drawing.find(item=>item['data-sun-reference']==='december-solstice').class,'sun-reference-path sun-shortest-path');
  assert.equal(drawing.filter(item=>item['data-sun-hour']).length,23);
  const time=drawing.find(item=>item['data-sun-selected-time']==='12:00');
  assert.ok((time.d.match(/L/g)||[]).length>=364);
  assert.ok(drawing.find(item=>item['data-sun-selected-date']===base.date).d.includes('L'));
  assert.equal((ui.sky().match(/class="sun-plot-grid" cx=/g)||[]).length,9);
  assert.equal((ui.sky().match(/sun-month-label/g)||[]).length,12);
  assert.match(ui.sky(),/Day min/);
  assert.match(ui.sky(),/Day max/);
  assert.doesNotMatch(ui.sky(),/NaN|Infinity/);
  assert.equal(ui.nodes.get('sunResults').getAttribute('aria-busy'),'false');
  assert.equal(ui.nodes.get('sunDownload').disabled,false);
});

test('layer controls retain seasonal and selected curves without rebuilding data',async()=>{
  const ui=await planner(),before={...ui.calls};
  const selected=paths(ui.sky()).find(item=>item['data-sun-selected-time']).d;
  ui.nodes.get('sunShowMonths').checked=false;
  ui.nodes.get('sunShowHours').checked=false;
  await ui.nodes.get('sunShowMonths').emit('change');
  await ui.nodes.get('sunShowHours').emit('change');
  const drawing=paths(ui.sky());
  assert.equal(drawing.filter(item=>item['data-sun-reference']).length,4);
  assert.equal(drawing.filter(item=>item['data-sun-hour']).length,0);
  assert.equal(drawing.find(item=>item['data-sun-selected-time']).d,selected);
  assert.ok(drawing.find(item=>item['data-sun-selected-date']).d);
  assert.deepEqual(ui.calls,before);
  ui.nodes.get('sunShowMonths').checked=true;
  await ui.nodes.get('sunShowMonths').emit('change');
  assert.equal(paths(ui.sky()).filter(item=>item['data-sun-month']).length,12);
});

test('one-foot pole shadow follows the selected instant and is unavailable at night',async()=>{
  const config={...base,latitude:17.3262,longitude:78.5916,date:'2026-09-15',time:'10:44'};
  const ui=await planner(config),shadow=ui.nodes.get('sunShadowLength'),note=ui.nodes.get('sunShadowNote');
  assert.equal(shadow.textContent,'0.48 ft');
  assert.match(note.textContent,/vertical 1 ft pole.*selected time.*level, unobstructed ground/);
  await ui.configure({time:'09:35'});
  const angle=model.calculate({...config,time:'09:35'}).altitude*Math.PI/180;
  assert.equal(shadow.textContent,`${(1/Math.tan(angle)).toFixed(2)} ft`);
  assert.notEqual(shadow.textContent,'0.48 ft');
  await ui.configure({time:'23:00'});
  assert.equal(shadow.textContent,'No direct sun');
  assert.match(note.textContent,/sun is below the horizon/);
  await ui.configure({time:'10:44',date:'2026-12-21'});
  const winterAngle=model.calculate({...config,date:'2026-12-21'}).altitude*Math.PI/180;
  assert.equal(shadow.textContent,`${(1/Math.tan(winterAngle)).toFixed(2)} ft`);
});

test('day summary shows daylight, twilight and golden-hour endpoints in the selected time zone',async()=>{
  const config={...base,latitude:17.3262,longitude:78.5916,date:'2026-09-15',time:'10:44'};
  const ui=await planner(config);
  const expected={sunDaylightDuration:'12 h 14 min',sunRise:'06:03',sunNoon:'12:10',sunSet:'18:17',
    sunCivilDawn:'05:41',sunCivilDusk:'18:39',sunNauticalDawn:'05:16',sunNauticalDusk:'19:04',
    sunAstronomicalDawn:'04:51',sunAstronomicalDusk:'19:30',sunGoldenMorningEnd:'06:32',sunGoldenEveningStart:'17:49'};
  for(const [id,value] of Object.entries(expected))assert.equal(ui.nodes.get(id).textContent,value,id);
  assert.equal(ui.nodes.get('sunDaySummaryDate').textContent,'2026-09-15 | Asia/Kolkata');
  assert.match(ui.nodes.get('sunDaylightNote').textContent,/elapsed time from sunrise to sunset, excluding twilight/);
  assert.match(ui.nodes.get('sunDaylightNote').textContent,/not the neighbour-blocked/);
  assert.match(ui.nodes.get('sunEventNote').textContent,/solar cycle near local noon/);
  await ui.configure({time:'23:00'});
  for(const [id,value] of Object.entries(expected))assert.equal(ui.nodes.get(id).textContent,value,id);
  assert.equal(ui.nodes.get('sunShadowLength').textContent,'No direct sun');
  await ui.configure({date:'2026-12-21'});
  assert.notEqual(ui.nodes.get('sunDaylightDuration').textContent,expected.sunDaylightDuration);
  assert.notEqual(ui.nodes.get('sunCivilDawn').textContent,expected.sunCivilDawn);
  await ui.configure({timeZone:'UTC',date:config.date});
  assert.equal(ui.nodes.get('sunCivilDawn').textContent,'00:11');
  assert.equal(ui.nodes.get('sunAstronomicalDawn').textContent,'23:21 (2026-09-14)');
});

test('day summary exposes polar states without hiding twilight that still occurs',async()=>{
  const config={...base,latitude:69.6492,longitude:18.9553,timeZone:'Europe/Oslo',date:'2026-12-21'};
  const ui=await planner(config);
  assert.equal(ui.nodes.get('sunDaylightDuration').textContent,'0 h 00 min');
  assert.equal(ui.nodes.get('sunRise').textContent,'No event');
  assert.equal(ui.nodes.get('sunSet').textContent,'No event');
  assert.match(ui.nodes.get('sunCivilDawn').textContent,/^\d\d:\d\d$/);
  assert.equal(ui.nodes.get('sunGoldenMorningEnd').textContent,'No crossing');
  assert.equal(ui.nodes.get('sunGoldenEveningStart').textContent,'No crossing');
  assert.match(ui.nodes.get('sunDaylightNote').textContent,/Polar night.*Twilight can still occur/);
  await ui.configure({date:'2026-06-21'});
  assert.equal(ui.nodes.get('sunDaylightDuration').textContent,'Continuous daylight');
  assert.equal(ui.nodes.get('sunNauticalDawn').textContent,'No crossing');
  assert.equal(ui.nodes.get('sunAstronomicalDusk').textContent,'No crossing');
  assert.match(ui.nodes.get('sunDaylightNote').textContent,/not forced into a 24-hour/);
  await ui.configure(base);
  assert.match(ui.nodes.get('sunDaylightDuration').textContent,/^\d+ h \d\d min$/);
  assert.doesNotMatch(ui.nodes.get('sunDaylightNote').textContent,/Polar/);
});

test('an incomplete event pair stays unavailable and malformed phase times are surfaced',async()=>{
  const partial=await planner(base,{calculate(config){
    const current=model.calculate(config);
    return {...current,events:{...current.events,sunrise:null}};
  }});
  assert.equal(partial.nodes.get('sunDaylightDuration').textContent,'Not available');
  assert.match(partial.nodes.get('sunDaylightNote').textContent,/complete sunrise\/sunset pair is unavailable/);
  const malformed=await planner(base,{calculate(config){
    const current=model.calculate(config);
    return {...current,events:{...current.events,nauticalDawn:new Date(NaN)}};
  }});
  assert.equal(malformed.nodes.get('sunResults').hidden,true);
  assert.equal(malformed.nodes.get('sunError').hidden,false);
  assert.match(malformed.nodes.get('sunError').textContent,/invalid nauticalDawn event/);
  assert.equal(malformed.nodes.get('sunDownload').disabled,true);
});

test('date/time scrubbing updates highlights but reuses the site-year reference grid',async()=>{
  const ui=await planner(),before={...ui.calls};
  const original=paths(ui.sky());
  const reference=original.filter(item=>item['data-sun-reference']).map(item=>item.d);
  const originalTime=original.find(item=>item['data-sun-selected-time']).d;
  await ui.configure({time:'09:35'});
  let drawing=paths(ui.sky());
  const newTime=drawing.find(item=>item['data-sun-selected-time']==='09:35').d;
  assert.notEqual(newTime,originalTime);
  assert.equal(drawing.filter(item=>item['data-sun-hour']).length,24);
  assert.deepEqual(drawing.filter(item=>item['data-sun-reference']).map(item=>item.d),reference);
  assert.equal(ui.calls.references,before.references);
  assert.equal(ui.calls.hours,before.hours);
  assert.equal(ui.calls.annual,before.annual+1);
  await ui.configure({date:'2026-12-11'});
  drawing=paths(ui.sky());
  assert.equal(drawing.find(item=>item['data-sun-selected-time']).d,newTime);
  assert.equal(ui.calls.annual,before.annual+1);
  assert.ok(drawing.find(item=>item['data-sun-selected-date']==='2026-12-11'));
  assert.match(ui.nodes.get('sunSelectedTimeLabel').textContent,/09:35/);
  await ui.nodes.get('sunDownload').emit('click');
  assert.equal(ui.downloads[0].download,'sun-path-2026.csv');
  const csv=await ui.getBlob().text();
  assert.match(csv,/"2026-12-11","09:35","Asia\/Kolkata"/);
  assert.equal(csv.split('\r\n').length,366);
});

test('site/year changes rebuild paths and reverse southern-hemisphere solstice labels',async()=>{
  const ui=await planner(),before={...ui.calls};
  await ui.configure({latitude:-33.8688,longitude:151.2093,timeZone:'Australia/Sydney',date:'2024-02-29'});
  assert.equal(ui.calls.references,before.references+1);
  assert.equal(ui.calls.hours,before.hours+1);
  assert.match(ui.nodes.get('sunAnnualStatus').textContent,/366 dates/);
  assert.match(ui.nodes.get('sunLongestLabel').textContent,/Dec 21/);
  assert.match(ui.nodes.get('sunShortestLabel').textContent,/Jun 21/);
  const drawing=paths(ui.sky());
  assert.match(drawing.find(item=>item['data-sun-reference']==='december-solstice').class,/sun-longest-path/);
  assert.match(drawing.find(item=>item['data-sun-reference']==='june-solstice').class,/sun-shortest-path/);
  assert.ok(drawing.filter(item=>item['data-date']).every(item=>item['data-date'].startsWith('2024-')));
  await ui.configure({latitude:0});
  assert.equal(ui.nodes.get('sunLongestLabel').textContent,'June solstice ref. (Jun 21)');
  assert.equal(ui.nodes.get('sunShortestLabel').textContent,'December solstice ref. (Dec 21)');
});

test('polar-night paths stay absent while visible seasons and explanations remain',async()=>{
  const ui=await planner({...base,latitude:78.2,longitude:15.6,timeZone:'Arctic/Longyearbyen',date:'2026-12-21'});
  const drawing=paths(ui.sky());
  assert.equal(drawing.find(item=>item['data-sun-selected-date']).d,'');
  assert.equal(drawing.find(item=>item['data-sun-reference']==='december-solstice').d,'');
  assert.ok(drawing.find(item=>item['data-sun-reference']==='june-solstice').d.includes('L'));
  assert.match(ui.nodes.get('sunDiagramStatus').textContent,/No above-horizon path on.*Dec 21/);
  assert.match(ui.nodes.get('sunDailyCaption').textContent,/no above-horizon samples/);
  assert.doesNotMatch(ui.sky(),/Day min|Day max|NaN|Infinity/);
});

test('selected-time sky curves break at DST jumps without changing annual CSV availability',async()=>{
  const ui=await planner({...base,latitude:40.7128,longitude:-74.006,timeZone:'America/New_York'});
  const time=paths(ui.sky()).find(item=>item['data-sun-selected-time']);
  assert.equal((time.d.match(/M/g)||[]).length,3);
  assert.match(ui.nodes.get('sunAnnualStatus').textContent,/365 available/);
  await ui.configure({time:'02:30'});
  assert.match(ui.nodes.get('sunAnnualStatus').textContent,/1 skipped/);
  await ui.nodes.get('sunDownload').emit('click');
  assert.match(await ui.getBlob().text(),/"2026-03-08".*"skipped local time"/);
});

test('stale reference calculations cannot overwrite a newer date or invalid-input state',async()=>{
  const ui=await planner();
  const older=ui.configure({date:'2024-02-29',latitude:45});
  const newer=ui.configure({date:'2025-06-21',latitude:-33.8688,longitude:151.2093,timeZone:'Australia/Sydney'});
  await Promise.all([older,newer]);
  assert.match(ui.sky(),/paths for 2025/);
  assert.ok(paths(ui.sky()).find(item=>item['data-sun-selected-date']==='2025-06-21'));
  assert.equal(ui.nodes.get('sunResults').getAttribute('aria-busy'),'false');
  const pending=ui.configure({date:'2024-03-01'});
  await ui.configure({latitude:91});
  await pending;
  assert.equal(ui.nodes.get('sunResults').hidden,true);
  assert.equal(ui.nodes.get('sunError').hidden,false);
  assert.equal(ui.nodes.get('sunLatitude').getAttribute('aria-invalid'),'true');
  assert.equal(ui.nodes.get('sunDownload').disabled,true);
  await ui.configure(base);
  assert.equal(ui.nodes.get('sunResults').hidden,false);
  assert.equal(paths(ui.sky()).filter(item=>item['data-sun-month']).length,12);
});
