const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const data=require('../environment-data.js');

function epwRow(patch={}){
  const row=Array(35).fill('0');
  Object.assign(row,{0:'2024',1:'2',2:'29',3:'1',4:'60',5:'?9?9?9?9',6:'24',8:'55',
    9:'101325',13:'500',14:'600',15:'100',20:'359',21:'3'});
  Object.entries(patch).forEach(([key,value])=>{row[key]=String(value);});
  return row.join(',');
}
function epw(rows=[epwRow()],{perHour=1,source='Research fixture',offset=5.5}={}){
  return [`LOCATION,"Example, fixture",State,Country,${source},12345,10,20,${offset},100`,
    'DESIGN CONDITIONS,0','TYPICAL/EXTREME PERIODS,0','GROUND TEMPERATURES,0',
    'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0','COMMENTS 1,Synthetic parser test; not site data',
    'COMMENTS 2,No redistribution claim',`DATA PERIODS,1,${perHour},Fixture,Thursday,1/1,12/31`,...rows].join('\r\n');
}
function record(patch={}){
  return {timestamp:'2024-02-29T01:00:00Z',durationSeconds:3600,temperatureC:24,rhPct:55,pressurePa:101325,
    dniWm2:600,dhiWm2:100,ghiWm2:500,windSpeedMps:3,windFromDeg:359,...patch};
}
function provider(patch={}){
  const response={latitude:10,longitude:20,timezone:'GMT',utc_offset_seconds:0,
    hourly_units:{time:'unixtime',temperature_2m:'°C',relative_humidity_2m:'%',surface_pressure:'hPa',
      direct_normal_irradiance:'W/m²',diffuse_radiation:'W/m²',shortwave_radiation:'W/m²',
      wind_speed_10m:'m/s',wind_direction_10m:'°'},
    hourly:{time:[1709168400],temperature_2m:[24],relative_humidity_2m:[55],surface_pressure:[1013.25],
      direct_normal_irradiance:[600],diffuse_radiation:[100],shortwave_radiation:[500],
      wind_speed_10m:[3],wind_direction_10m:[359]}};
  return {...response,...patch};
}

test('browser namespace and CommonJS expose the same four contract functions',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../environment-data.js'),'utf8'),context);
  for(const name of ['parseEPW','parseWeatherJSON','fromOpenMeteo','windRose']){
    assert.equal(typeof data[name],'function');assert.equal(typeof context.EnvironmentData[name],'function');
  }
});
test('EPW hour 1/minute 60 ends at 01:00 local standard, with half-hour offset',()=>{
  const result=data.parseEPW(epw()),row=result.records[0];
  assert.equal(row.timestamp,'2024-02-28T19:30:00.000Z');
  assert.equal(result.coverage.startUTC,'2024-02-28T18:30:00.000Z');
  assert.equal(row.durationSeconds,3600);assert.equal(row.dniWm2,600);
  assert.equal(result.timeZoneOffsetHours,5.5);assert.equal(result.source.city,'Example, fixture');
  assert.equal(result.source.stationId,'12345');assert.equal(result.source.elevationM,100);
  assert.equal(result.kind,'unclassified');assert.equal(result.records[0].missing.length,0);
});
test('EPW hour 24 rolls into the next day and preserves valid leap day',()=>{
  const row=data.parseEPW(epw([epwRow({3:24})])).records[0];
  assert.equal(row.timestamp,'2024-02-29T18:30:00.000Z');
  assert.deepEqual(row.sourceTime,{year:2024,month:2,day:29,hour:24,minute:60});
});
test('EPW sub-hour radiation energy is divided by actual interval hours',()=>{
  const result=data.parseEPW(epw([epwRow({4:30,13:250,14:300,15:50}),epwRow({13:200,14:250,15:40})],{perHour:2,offset:5.75}));
  assert.equal(result.records[0].timestamp,'2024-02-28T18:45:00.000Z');
  assert.equal(result.records[0].durationSeconds,1800);
  assert.equal(result.records[0].dniWm2,600);assert.equal(result.records[0].dhiWm2,100);
  assert.equal(result.records[1].ghiWm2,400);assert.equal(result.coverage.gaps,0);
});
test('EPW sentinels, blanks and physically invalid values stay null plus missing',()=>{
  const row=data.parseEPW(epw([epwRow({6:99.9,8:999,9:999999,13:9999,14:-5,15:'',20:999,21:999})])).records[0];
  for(const key of Object.keys(data.UNITS)){assert.equal(row[key],null);assert.ok(row.missing.includes(key));}
  const out=data.parseEPW(epw([epwRow({6:'Infinity',8:101,9:1,13:2001,14:1601,15:1501,20:-1,21:151})]));
  assert.equal(out.records[0].missing.length,8);
  assert.ok(out.warnings.some(w=>w.includes('invalid values')));
});
test('EPW does not normalize malformed dates, hour zero or minute zero into valid rows',()=>{
  const result=data.parseEPW(epw([epwRow({0:2023}),epwRow({3:0}),epwRow({4:0}),
    epwRow({3:25}),epwRow({1:13}),epwRow(),epwRow().split(',').slice(0,30).join(',')]));
  assert.equal(result.records.length,1);assert.ok(result.warnings.some(w=>w.includes('6 malformed')));
  assert.throws(()=>data.parseEPW(epw([epwRow({0:2023})])),data.InputError);
});
test('EPW rejects bad headers, offset, data periods and quoted fields',()=>{
  assert.throws(()=>data.parseEPW('LOCATION,only'),data.InputError);
  assert.throws(()=>data.parseEPW(epw().replace('DESIGN CONDITIONS','BAD HEADER')),data.InputError);
  assert.throws(()=>data.parseEPW(epw(undefined,{offset:NaN})),/UTC offset/);
  assert.throws(()=>data.parseEPW(epw(undefined,{perHour:7})),/divides 60/);
  assert.throws(()=>data.parseEPW(epw().replace('"Example, fixture"','"Unclosed')),data.InputError);
  const boundary=data.parseEPW(epw().replace('1/1,12/31','2/30,12/31'));
  assert.equal(boundary.records.length,1);
  assert.ok(boundary.warnings.some(w=>w.includes('calendar boundary')));
});
test('TMY metadata establishes typical-year classification without inventing a chronological year',()=>{
  const result=data.parseEPW(epw([epwRow({0:2015,1:1,2:15}),epwRow({0:2012,1:2,2:15})],{source:'TMYx'}));
  assert.equal(result.kind,'tmy');assert.equal(result.coverage.chronological,false);
  assert.equal(result.records[1].sourceTime.year,2012);
  assert.ok(result.warnings.some(w=>w.includes('out-of-order')));
  assert.ok(result.warnings.some(w=>w.includes('not observed chronological')));
});
test('duplicates are not double-counted and gaps and overlaps have explicit coverage warnings',()=>{
  const result=data.parseWeatherJSON(JSON.stringify({kind:'historical',records:[
    record(),record({temperatureC:30}),record({timestamp:'2024-02-29T03:00:00Z'}),
    record({timestamp:'2024-02-29T03:30:00Z'})
  ]}));
  assert.equal(result.records.length,3);assert.equal(result.records[0].temperatureC,24);
  assert.equal(result.coverage.duplicates,1);assert.equal(result.coverage.gaps,1);
  assert.equal(result.coverage.overlaps,1);
  assert.ok(result.warnings.some(w=>w.includes('first interval')));
});
test('canonical JSON accepts explicit units and duration, and retains source evidence',()=>{
  const result=data.parseWeatherJSON(JSON.stringify({kind:'scenario',source:{label:'Synthetic example',license:'Example only'},
    latitude:10,longitude:20,units:{temperatureC:'K',pressurePa:'hPa',windSpeedMps:'km/h',ghiWm2:'Wh/m²'},
    records:[record({temperatureC:300,pressurePa:1013.25,windSpeedMps:36,durationSeconds:1800,ghiWm2:250})]}));
  assert.ok(Math.abs(result.records[0].temperatureC-26.85)<1e-10);
  assert.equal(result.records[0].pressurePa,101325);assert.equal(result.records[0].windSpeedMps,10);
  assert.equal(result.records[0].ghiWm2,500);assert.equal(result.source.license,'Example only');
  assert.equal(result.kind,'scenario');assert.equal(result.units.pressurePa,'Pa');
});
test('JSON timestamps need real dates and explicit offsets; DST repeated instants remain distinct',()=>{
  const result=data.parseWeatherJSON(JSON.stringify([record({timestamp:'2024-02-30T01:00Z'}),
    record({timestamp:'2024-02-29T01:00'}),record({timestamp:'2024-02-29T24:00Z'}),
    record({timestamp:'2024-11-03T01:00:00-04:00'}),record({timestamp:'2024-11-03T01:00:00-05:00'})]));
  assert.equal(result.records.length,2);
  assert.equal(Date.parse(result.records[1].timestamp)-Date.parse(result.records[0].timestamp),3600000);
  assert.ok(result.warnings.some(w=>w.includes('3 malformed')));
});
test('JSON rejects missing durations, malformed structures and nonnumeric physical values',()=>{
  for(const input of ['not JSON','null','{}','{"records":{}}','{"records":[]}']){
    assert.throws(()=>data.parseWeatherJSON(input),data.InputError);
  }
  for(const durationSeconds of [null,undefined,0,-1,Infinity,'3600',86401])
    assert.throws(()=>data.parseWeatherJSON(JSON.stringify([record({durationSeconds})])),data.InputError);
  const result=data.parseWeatherJSON(JSON.stringify([record({temperatureC:'24',rhPct:null,windSpeedMps:null})]));
  assert.equal(result.records[0].temperatureC,null);assert.equal(result.records[0].rhPct,null);
  assert.equal(result.records[0].windSpeedMps,null);
});
test('JSON respects explicit missing flags instead of silently using a stored numeric value',()=>{
  const row=data.parseWeatherJSON(JSON.stringify([record({missing:['dniWm2','windSpeedMps']})])).records[0];
  assert.equal(row.dniWm2,null);assert.equal(row.windSpeedMps,null);
  assert.equal(row.dhiWm2,100);
});
test('JSON unknown units do not masquerade as valid SI data',()=>{
  const row=data.parseWeatherJSON(JSON.stringify({units:{pressurePa:'kittens',dniWm2:'kWh',temperatureC:'F'},
    records:[record()]})).records[0];
  assert.equal(row.pressurePa,null);assert.equal(row.dniWm2,null);assert.equal(row.temperatureC,null);
});
test('Open-Meteo UNIX times stay UTC, surface pressure becomes Pa and the sampling distinction persists',()=>{
  const result=data.fromOpenMeteo(provider()),row=result.records[0];
  assert.equal(row.timestamp,new Date(1709168400*1000).toISOString());
  assert.equal(row.pressurePa,101325);assert.equal(row.dniWm2,600);assert.equal(row.windSpeedMps,3);
  assert.equal(row.durationSeconds,3600);assert.equal(row.windFromDeg,359);
  assert.equal(result.source.windReferenceHeightM,10);
  assert.match(result.source.radiationTiming,/preceding hour/);
  assert.match(result.source.otherVariableTiming,/Instantaneous/);
  assert.equal(result.kind,'unclassified');
  const offset=data.fromOpenMeteo(provider({timezone:'Asia/Kolkata',utc_offset_seconds:19800}));
  assert.equal(offset.records[0].timestamp,row.timestamp);
});
test('Open-Meteo explicitly declared km/h is converted, never mislabeled m/s',()=>{
  const input=provider();input.hourly_units.wind_speed_10m='km/h';input.hourly.wind_speed_10m=[36];
  assert.equal(data.fromOpenMeteo(input).records[0].windSpeedMps,10);
});
test('Open-Meteo missing units, null values and malformed arrays stay missing with warnings',()=>{
  const input=provider();delete input.hourly_units.surface_pressure;
  input.hourly.wind_speed_10m=[null];input.hourly.diffuse_radiation=100;input.hourly.shortwave_radiation=[];
  const result=data.fromOpenMeteo(input),row=result.records[0];
  assert.equal(row.pressurePa,null);assert.equal(row.windSpeedMps,null);assert.equal(row.dhiWm2,null);
  assert.equal(row.ghiWm2,null);assert.ok(result.warnings.some(w=>w.includes('length 0')));
  assert.ok(result.warnings.some(w=>w.includes('not an array')));
  assert.ok(result.warnings.some(w=>w.includes('unit for surface_pressure')));
});
test('Open-Meteo ISO UTC works; naive local timestamps are rejected rather than using a single DST offset',()=>{
  const input=provider();input.hourly.time=['2024-02-29T01:00'];input.hourly_units.time='iso8601';
  assert.equal(data.fromOpenMeteo(input).records[0].timestamp,'2024-02-29T01:00:00.000Z');
  input.timezone='America/New_York';input.utc_offset_seconds=-18000;
  assert.throws(()=>data.fromOpenMeteo(input),data.InputError);
  input.hourly.time=['2024-02-29T01:00-05:00'];
  assert.equal(data.fromOpenMeteo(input).records[0].timestamp,'2024-02-29T06:00:00.000Z');
});
test('provider error, invalid time arrays and multi-location responses fail explicitly',()=>{
  assert.throws(()=>data.fromOpenMeteo({error:true,reason:'Daily limit exceeded'}),/Daily limit exceeded/);
  for(const bad of [null,[],{hourly:{time:'no'}},{hourly:{time:[]}}])
    assert.throws(()=>data.fromOpenMeteo(bad),data.InputError);
});
test('parseWeatherJSON recognizes a provider fixture without changing units',()=>{
  assert.equal(data.parseWeatherJSON(JSON.stringify(provider())).records[0].pressurePa,101325);
});
test('rose has 16 circular FROM sectors and retains opposed modes rather than taking a mean bearing',()=>{
  const result=data.windRose([record({windFromDeg:359}),record({windFromDeg:1}),record({windFromDeg:180}),
    record({windFromDeg:360}),record({windFromDeg:90}),record({windFromDeg:270})]);
  assert.equal(result.bins.length,16);assert.equal(result.bins[0].count,3);
  assert.equal(result.bins[8].count,1);assert.equal(result.bins[4].count,1);assert.equal(result.bins[12].count,1);
  assert.equal(result.bins[0].meanSpeedMps,3);assert.equal(result.bins[1].meanSpeedMps,null);
  assert.equal(result.total,6);
});
test('rose separates calm, missing and excluded records, including calm without a bearing',()=>{
  const rows=[record({windSpeedMps:0,windFromDeg:null}),record({windSpeedMps:.2,windFromDeg:999}),
    record({windSpeedMps:null}),record({windFromDeg:null}),record({windSpeedMps:999}),record()];
  const result=data.windRose(rows);
  assert.equal(result.calmCount,2);assert.equal(result.missingCount,3);assert.equal(result.total,6);
  assert.equal(result.bins.reduce((n,bin)=>n+bin.count,0)+result.calmCount+result.missingCount,result.total);
  assert.equal(data.windRose([record({windSpeedMps:0})],{calmThresholdMps:0}).calmCount,1);
});
test('rose month and clock-hour filters honor half-hour offsets and retain midnight transitions',()=>{
  const rows=[record({timestamp:'2024-01-31T18:45:00Z'}),record({timestamp:'2024-02-01T07:00:00Z'}),
    record({timestamp:'2024-02-01T19:00:00Z'}),record({timestamp:'2024-03-01T07:00:00Z'})];
  const result=data.windRose(rows,{months:[2],daytime:'day',timeZone:'Asia/Kolkata'});
  assert.equal(result.total,1);assert.equal(result.excludedCount,3);
  assert.equal(data.windRose(rows,{months:[2],daytime:'night',timeZoneOffsetHours:5.5}).total,2);
  assert.equal(data.windRose(rows,{daytime:'day',dayStartHour:22,dayEndHour:6,timeZone:'Asia/Kolkata'}).total,2);
});
test('rose marks unknown filter timestamps separately and rejects invalid options',()=>{
  const result=data.windRose([record({timestamp:'bad'})],{months:[1]});
  assert.equal(result.unknownTimeCount,1);assert.equal(result.missingCount,1);
  for(const options of [{months:[0]},{months:'June'},{daytime:'sunrise'},{calmThresholdMps:-1},
    {dayStartHour:6,dayEndHour:6},{timeZone:'Not/AZone'},{timeZone:'UTC',timeZoneOffsetHours:0}]){
    assert.throws(()=>data.windRose([],options),data.InputError);
  }
  assert.throws(()=>data.windRose(null),data.InputError);
});
test('normalization is deterministic and does not mutate imported inputs',()=>{
  const input=provider(),before=JSON.stringify(input);
  const a=data.fromOpenMeteo(input),b=data.fromOpenMeteo(input);
  assert.deepEqual(a,b);assert.equal(JSON.stringify(input),before);
  const normalized=data.parseWeatherJSON(JSON.stringify(a));
  assert.deepEqual(normalized.records,a.records);
});

const ui=require('../environment-ui.js');
const sun=require('../sun-model.js');
function windScene({headingDeg=0,doorOpen=1,outletOpen=1}={}){
  const rooms=[{id:'a',label:'Room A',type:'bedroom',service:false,rect:{x:0,y:0,w:4,h:4}},
    {id:'b',label:'Room B',type:'living',service:false,rect:{x:4,y:0,w:4,h:4}}];
  const wall=(id,start,end,roomIds,exterior=true)=>({id,start,end,roomIds,exterior,removed:false,thicknessM:.2,
    heightM:3,baseM:0,openings:[],solidSegments:[{startM:0,endM:Math.hypot(end.x-start.x,end.y-start.y)}]});
  const walls=[wall('a-front',{x:0,y:0},{x:4,y:0},['a']),wall('b-front',{x:4,y:0},{x:8,y:0},['b']),
    wall('a-back',{x:0,y:4},{x:4,y:4},['a']),wall('b-back',{x:4,y:4},{x:8,y:4},['b']),
    wall('a-left',{x:0,y:0},{x:0,y:4},['a']),wall('b-right',{x:8,y:0},{x:8,y:4},['b']),
    wall('a-b',{x:4,y:0},{x:4,y:4},['a','b'],false)];
  const openings=[{id:'door-ab',wallId:'a-b',roomId:'a',targetRoomId:'b',kind:'hinged',exterior:false,
    offsetM:1,widthM:1,sillM:0,heightM:2,openFraction:doorOpen,segment:{x1:4,y1:1,x2:4,y2:2}},
  {id:'window-b',wallId:'b-back',roomId:'b',kind:'window',exterior:true,
    offsetM:1,widthM:1,sillM:1,heightM:1,openFraction:outletOpen,segment:{x1:5,y1:4,x2:6,y2:4}}];
  return {floorId:'fixture-floor',headingDeg,floorElevationM:0,wallHeightM:3,
    floor:{x:0,y:0,w:8,h:4},building:{x:0,y:0,w:8,h:4},rooms,walls,openings,obstacles:[],diagnostics:[]};
}
const windowOptions={windFromDeg:0,widthM:1.2,heightM:1.2,sillM:.9,openFraction:.5};
test('archive request discloses only approved coordinates and weather parameters, never geometry',()=>{
  const site={latitude:10,longitude:20,timeZone:'Asia/Kolkata'},request=ui.buildArchiveRequest(site,'2024-01-01','2024-01-01',sun,new Date('2026-01-01'));
  const url=new URL(request.url);
  assert.equal(url.origin,'https://archive-api.open-meteo.com');
  assert.equal(url.searchParams.get('models'),'era5');assert.equal(url.searchParams.get('wind_speed_unit'),'ms');
  assert.equal(url.searchParams.get('timezone'),'UTC');assert.equal(url.searchParams.get('timeformat'),'unixtime');
  assert.equal(url.searchParams.get('start_date'),'2023-12-31');assert.equal(url.searchParams.get('end_date'),'2024-01-01');
  assert.equal(request.startUTC,'2023-12-31T18:30:00.000Z');
  assert.equal(request.endUTC,'2024-01-01T18:30:00.000Z');
  assert.equal(url.searchParams.has('apikey'),false);assert.equal(url.searchParams.has('rooms'),false);
  assert.ok(url.searchParams.get('hourly').includes('surface_pressure'));
  assert.ok(url.searchParams.get('hourly').includes('direct_normal_irradiance'));
  assert.ok(!url.searchParams.get('hourly').includes('_instant'));
});
test('archive local day conversion handles DST 23/25-hour days and quarter-hour zones',()=>{
  const now=new Date('2026-01-01'),site={latitude:10,longitude:20,timeZone:'America/New_York'};
  const spring=ui.buildArchiveRequest(site,'2024-03-10','2024-03-10',sun,now);
  const fall=ui.buildArchiveRequest(site,'2024-11-03','2024-11-03',sun,now);
  assert.equal((Date.parse(spring.endUTC)-Date.parse(spring.startUTC))/3600000,23);
  assert.equal((Date.parse(fall.endUTC)-Date.parse(fall.startUTC))/3600000,25);
  assert.equal(ui.buildArchiveRequest({...site,timeZone:'Asia/Kathmandu'},'2024-01-01','2024-01-01',sun,now).startUTC,'2023-12-31T18:15:00.000Z');
});
test('archive rejects future/unpublished, oversized, invalid and reversed date ranges',()=>{
  const site={latitude:10,longitude:20,timeZone:'UTC'},now=new Date('2026-01-01');
  for(const [start,end] of [['2025-12-30','2025-12-31'],['2023-01-01','2024-02-01'],
    ['2024-02-30','2024-03-01'],['2024-03-01','2024-02-01'],['1939-01-01','1939-02-01']]){
    assert.throws(()=>ui.buildArchiveRequest(site,start,end,sun,now));
  }
  assert.throws(()=>ui.buildArchiveRequest({...site,latitude:100},'2024-01-01','2024-01-02',sun,now));
  assert.throws(()=>ui.buildArchiveRequest(site,'2024-01-01','2024-01-02',null,now));
});
test('partial UTC boundary intervals preserve original source duration and explicit requested overlap',()=>{
  const request={startUTC:'2024-01-01T00:30:00.000Z',endUTC:'2024-01-01T02:30:00.000Z',site:{latitude:10,longitude:20,timeZone:'UTC'}};
  const weather={id:'fixture',kind:'reanalysis',source:{label:'Synthetic fixture'},warnings:[],coverage:{},
    records:[0,1,2,3,4].map(h=>record({timestamp:`2024-01-01T0${h}:00:00.000Z`}))};
  const before=JSON.stringify(weather),result=ui.trimWeatherToInterval(weather,request);
  assert.equal(result.records.length,3);assert.deepEqual(result.records.map(r=>r.requestedOverlapSeconds),[1800,3600,1800]);
  assert.ok(result.records.every(r=>r.durationSeconds===3600));
  assert.equal(result.coverage.requestedOverlapHours,2);
  assert.equal(JSON.stringify(weather),before);
  assert.ok(result.warnings.some(w=>w.includes('Boundary records retain')));
});
test('window proposals use actual exterior walls and open internal paths, not room-outline guesses',()=>{
  const scene=windScene(),before=JSON.stringify(scene),proposals=ui.buildWindowRecommendations(scene,windowOptions);
  const northA=proposals.find(p=>p.wallId==='a-front');
  assert.ok(northA);assert.equal(northA.role,'Windward candidate');
  assert.deepEqual(northA.path.roomIds,['a','b']);assert.deepEqual(northA.path.openingIds,['door-ab','window-b']);
  assert.ok(proposals.every(p=>p.wallId!=='a-b'));
  assert.deepEqual(Object.keys(northA.command).sort(),['heightM','offsetM','openFraction','sillM','type','wallId','widthM'].sort());
  assert.equal(northA.command.type,'add-window');assert.equal(northA.command.openFraction,.5);
  assert.equal(JSON.stringify(scene),before);
});
test('closed internal doors and closed glazing remove schematic through-paths without invented leakage',()=>{
  const closedDoor=ui.buildWindowRecommendations(windScene({doorOpen:0}),windowOptions);
  assert.equal(closedDoor.find(p=>p.wallId==='a-front').path,null);
  assert.match(closedDoor.find(p=>p.wallId==='a-front').reason,/Adding this alone/);
  const closedWindow=ui.buildWindowRecommendations(windScene({outletOpen:0}),windowOptions);
  assert.ok(closedWindow.every(p=>p.path===null));
});
test('wind recommendation headings convert local normals to true north exactly once',()=>{
  for(const [heading,bearing,wall] of [[0,0,'a-front'],[90,90,'a-front'],[180,180,'a-front'],[270,270,'a-front'],[90,0,'a-left']]){
    const proposals=ui.buildWindowRecommendations(windScene({headingDeg:heading}),{...windowOptions,windFromDeg:bearing});
    const p=proposals.find(p=>p.wallId===wall);
    assert.ok(p,`${heading}/${bearing} ${wall}`);assert.equal(p.role,'Windward candidate');
    assert.ok(p.alignment>.99);
  }
});
test('window proposals respect existing opening spans, room service boundaries and height limits',()=>{
  const scene=windScene(),proposals=ui.buildWindowRecommendations(scene,{...windowOptions,windFromDeg:180});
  for(const p of proposals){
    for(const o of scene.openings.filter(o=>o.wallId===p.wallId))
      assert.ok(p.command.offsetM+p.command.widthM<=o.offsetM-.099||p.command.offsetM>=o.offsetM+o.widthM+.099);
  }
  assert.equal(ui.buildWindowRecommendations(scene,{...windowOptions,heightM:5}).length,0);
  scene.rooms[0].service=true;
  assert.ok(ui.buildWindowRecommendations(scene,windowOptions).every(p=>p.roomId!=='a'));
});
test('pressure scene templates preserve real operating areas and leave density/Cd/pressure explicitly missing',()=>{
  const template=ui.buildAirflowTemplate(windScene({outletOpen:0}));
  assert.equal(template.zones[0].volumeM3,48);assert.equal(template.densityKgM3,null);
  assert.equal(template.links.find(l=>l.id==='window-b').freeAreaM2,0);
  assert.equal(template.links.find(l=>l.id==='door-ab').freeAreaM2,2);
  assert.ok(template.links.every(l=>l.cd===null&&l.pressurePa===null));
  assert.throws(()=>ui.validatePressureInput(template,windScene({outletOpen:0})),/density/);
});
test('pressure inputs cannot turn fixed glazing into a flow aperture or attach arbitrary links',()=>{
  const scene=windScene({outletOpen:0}),template=ui.buildAirflowTemplate(scene);
  template.densityKgM3=1.2;template.links.forEach(l=>{l.cd=.6;l.pressurePa=0;});
  assert.equal(ui.validatePressureInput(template,scene),template);
  template.links.find(l=>l.id==='window-b').freeAreaM2=1;
  assert.throws(()=>ui.validatePressureInput(template,scene),/free area/);
  template.links.find(l=>l.id==='window-b').freeAreaM2=0;
  template.links[0].id='invented-opening';
  assert.throws(()=>ui.validatePressureInput(template,scene),/actual opening/);
});
test('thermal templates have no invented capacity, conductance, weather or gains',()=>{
  const scene=windScene(),input=ui.buildThermalTemplate(scene);
  assert.ok(input.zones.every(z=>z.capacityJ_K===null&&z.initialC===null&&z.outsideConductanceW_K===null));
  assert.equal(input.links.length,1);assert.equal(input.links[0].conductanceW_K,null);
  assert.equal(input.steps[0].outdoorC,null);assert.deepEqual(input.steps[0].gainsW,{a:null,b:null});
  assert.throws(()=>ui.validateThermalInput(input,scene),/capacity/);
  input.zones.forEach(z=>Object.assign(z,{capacityJ_K:1000000,initialC:25,outsideConductanceW_K:100}));
  input.links[0].conductanceW_K=10;input.steps[0].outdoorC=30;input.steps[0].gainsW={a:0,b:0};
  assert.equal(ui.validateThermalInput(input,scene),input);
  delete input.steps[0].gainsW.b;
  assert.throws(()=>ui.validateThermalInput(input,scene),/net gains/);
});
test('sourced material presets separate AAC, clay brick and unresolved specific earth properties',()=>{
  assert.ok(ui.MATERIAL_PRESETS.every(p=>p.source&&p.url.startsWith('https://')));
  const aac=ui.MATERIAL_PRESETS.find(p=>p.id==='aac-ens');
  assert.equal(aac.specificHeatJ_KgK,1240);assert.equal(aac.densityKgM3,642);
  assert.notEqual(aac.conductivityW_MK,ui.MATERIAL_PRESETS[0].conductivityW_MK);
  const earth=ui.MATERIAL_PRESETS.find(p=>p.id==='lyon-rammed-earth');
  assert.equal(earth.conductivityW_MK,null);assert.match(earth.source,/generic mud is unspecified/);
});

test('complete ordinary and leap EPW years retain 8760/8784 intervals without artificial DST gaps',()=>{
  for(const [year,hours] of [[2023,8760],[2024,8784]]){
    const first=Date.UTC(year,0,1);
    const rows=Array.from({length:hours},(_,i)=>{
      const date=new Date(first+i*3600000);
      return epwRow({0:year,1:date.getUTCMonth()+1,2:date.getUTCDate(),3:date.getUTCHours()+1});
    });
    const result=data.parseEPW(epw(rows));
    assert.equal(result.records.length,hours);assert.equal(result.coverage.intervalHours,hours);
    assert.equal(result.coverage.gaps,0);assert.equal(result.coverage.overlaps,0);
    assert.equal(result.coverage.duplicates,0);
    assert.ok(!result.warnings.some(w=>w.includes('shorter than a full year')));
    assert.equal(result.coverage.startUTC,`${year-1}-12-31T18:30:00.000Z`);
    assert.equal(result.coverage.endUTC,`${year}-12-31T18:30:00.000Z`);
  }
});
test('normalized JSON round-trips partial source-interval overlap and rejects malformed quality arrays',()=>{
  const input=[record({requestedOverlapSeconds:1800}),record({timestamp:'2024-02-29T02:00:00Z',missing:'windSpeedMps'})];
  const result=data.parseWeatherJSON(JSON.stringify(input));
  assert.equal(result.records.length,1);assert.equal(result.records[0].requestedOverlapSeconds,1800);
  assert.ok(result.warnings.some(w=>w.includes('malformed missing array')));
  const invalid=data.parseWeatherJSON(JSON.stringify([record({requestedOverlapSeconds:4000})]));
  assert.equal(invalid.records[0].requestedOverlapSeconds,undefined);
  assert.ok(invalid.warnings.some(w=>w.includes('Invalid requestedOverlapSeconds')));
});
test('blank/unsupported bearing units do not disguise undeclared numeric directions as degrees',()=>{
  const parsed=data.parseWeatherJSON(JSON.stringify({units:{windFromDeg:''},records:[record()]}));
  assert.equal(parsed.records[0].windFromDeg,null);
  assert.ok(Object.isFrozen(data.PROVIDER_FIELDS));
});
