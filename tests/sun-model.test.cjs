const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const model=require('../sun-model.js');
const SunCalc=require('../vendor/suncalc-2.0.1.js');
const base={latitude:17.385,longitude:78.4867,date:'2026-09-08',time:'12:00',timeZone:'Asia/Kolkata',occurrence:''};

test('uses the vendored v2 angles without v1 radian or south-origin conversion',()=>{
  const result=model.calculate(base);
  const direct=SunCalc.getPosition(new Date('2026-09-08T06:30:00Z'),base.latitude,base.longitude);
  assert.equal(result.instant.toISOString(),'2026-09-08T06:30:00.000Z');
  assert.equal(result.altitude,direct.altitude);
  assert.ok(Math.abs(result.azimuth-direct.azimuth)<1e-10);
  assert.equal(result.zenith,90-direct.altitude);
  assert.ok(Math.abs(result.azimuth-163.51)<.1);
  assert.ok(Math.abs(result.altitude-77.8)<.1);
  assert.ok(Math.abs(Math.hypot(...Object.values(result.vector))-1)<1e-12);
});

test('equivalent UTC and local clock inputs give the same position',()=>{
  const a=model.calculate(base),b=model.calculate({...base,time:'06:30',timeZone:'UTC'});
  assert.equal(a.instant.getTime(),b.instant.getTime());
  assert.deepEqual(a.vector,b.vector);
});

test('day summary reuses SunCalc event boundaries and derives exact sunrise-to-sunset duration',()=>{
  const config={...base,latitude:17.3262,longitude:78.5916,date:'2026-09-15',time:'10:44'};
  const direct=SunCalc.getTimes(model.resolveLocal(config.date,'12:00',config.timeZone).instant,
    config.latitude,config.longitude);
  const summary=model.daySummary(model.calculate(config).events);
  assert.deepEqual(summary.daylight,{status:'sunrise-sunset',durationMs:direct.sunset-direct.sunrise});
  assert.equal(Math.round(summary.daylight.durationMs/60000),734);
  for(const [name,instant] of Object.entries(summary.events)){
    assert.equal(instant.getTime(),direct[name].getTime(),name);
  }
  assert.ok(summary.events.nightEnd<summary.events.nauticalDawn);
  assert.ok(summary.events.nauticalDawn<summary.events.dawn);
  assert.ok(summary.events.dawn<summary.events.sunrise);
  assert.ok(summary.events.sunrise<summary.events.goldenHourEnd);
  assert.ok(summary.events.goldenHourEnd<summary.events.solarNoon);
  assert.ok(summary.events.solarNoon<summary.events.goldenHour);
  assert.ok(summary.events.goldenHour<summary.events.sunset);
  assert.ok(summary.events.sunset<summary.events.dusk);
  assert.ok(summary.events.dusk<summary.events.nauticalDusk);
  assert.ok(summary.events.nauticalDusk<summary.events.night);
});

test('day summary measures elapsed UTC time across clock changes and midnight',()=>{
  const events=model.calculate(base).events;
  // Synthetic event pairs isolate elapsed-time semantics from an astronomical location.
  for(const [sunrise,sunset,hours] of [
    ['2026-03-08T06:30:00Z','2026-03-08T08:30:00Z',2],
    ['2026-11-01T05:30:00Z','2026-11-01T07:30:00Z',2],
    ['2026-09-14T22:00:00Z','2026-09-15T11:00:00Z',13]
  ]){
    const summary=model.daySummary({...events,sunrise:new Date(sunrise),sunset:new Date(sunset)});
    assert.equal(summary.daylight.durationMs,hours*3600000);
  }
});

test('polar day and night retain missing boundaries instead of inventing durations or twilight',()=>{
  const config={...base,latitude:69.6492,longitude:18.9553,timeZone:'Europe/Oslo'};
  const summer=model.daySummary(model.calculate({...config,date:'2026-06-21'}).events);
  const winter=model.daySummary(model.calculate({...config,date:'2026-12-21'}).events);
  assert.deepEqual(summer.daylight,{status:'polar-day',durationMs:null});
  assert.equal(summer.events.sunrise,null);assert.equal(summer.events.sunset,null);
  assert.equal(summer.events.dawn,null);assert.equal(summer.events.night,null);
  assert.deepEqual(winter.daylight,{status:'polar-night',durationMs:0});
  assert.equal(winter.events.sunrise,null);assert.equal(winter.events.sunset,null);
  assert.ok(winter.events.dawn instanceof Date);
  assert.ok(winter.events.dusk instanceof Date);
  assert.equal(winter.events.goldenHourEnd,null);assert.equal(winter.events.goldenHour,null);
});

test('partial or unknown rise/set pairs are explicitly unavailable, not automatically zero or all day',()=>{
  const events=model.calculate(base).events;
  for(const change of [
    {sunrise:null,alwaysUp:true},
    {sunset:null,alwaysDown:true},
    {sunrise:null,sunset:null}
  ]){
    const summary=model.daySummary({...events,...change});
    assert.deepEqual(summary.daylight,{status:'incomplete',durationMs:null});
  }
});

test('malformed solar events raise errors while explicit absent phase crossings remain null',()=>{
  const events=model.calculate(base).events;
  assert.throws(()=>model.daySummary(null),model.InputError);
  assert.throws(()=>model.daySummary({}),model.InputError);
  assert.throws(()=>model.daySummary([]),model.InputError);
  for(const name of ['sunrise','solarNoon','sunset','dawn','dusk','nauticalDawn','nauticalDusk',
    'nightEnd','night','goldenHourEnd','goldenHour']){
    for(const invalid of [undefined,'06:00',NaN,new Date(NaN)])
      assert.throws(()=>model.daySummary({...events,[name]:invalid}),error=>error.code==='events');
    if(name!=='solarNoon')assert.equal(model.daySummary({...events,[name]:null}).events[name],null);
  }
  assert.throws(()=>model.daySummary({...events,solarNoon:null}),model.InputError);
  assert.throws(()=>model.daySummary({...events,sunset:new Date(events.sunrise-1)}),/before sunrise/);
  assert.throws(()=>model.daySummary({...events,alwaysUp:true,alwaysDown:true}),/conflicting/);
  assert.throws(()=>model.daySummary({...events,alwaysUp:'true'}),/invalid polar/);
});

test('day summaries stay local, deterministic and independent of event input mutations',()=>{
  const events=model.calculate(base).events,before=JSON.stringify(events);
  const summary=model.daySummary(Object.freeze(events));
  assert.equal(JSON.stringify(events),before);
  assert.deepEqual(summary,model.daySummary(events));
  summary.events.dawn.setTime(0);
  assert.equal(JSON.stringify(events),before);
  assert.deepEqual(model.daySummary(model.calculate({...base,time:'18:30'}).events),model.daySummary(events));
  const south={...base,latitude:-33.8688,longitude:151.2093,timeZone:'Australia/Sydney'};
  const june=model.daySummary(model.calculate({...south,date:'2026-06-21'}).events);
  const december=model.daySummary(model.calculate({...south,date:'2026-12-21'}).events);
  assert.ok(december.daylight.durationMs>june.daylight.durationMs);
});

test('pole-shadow lengths use height over tangent of elevation and preserve metre units',()=>{
  assert.ok(Math.abs(model.shadowLengthM(45,0.3048)-0.3048)<1e-12);
  assert.ok(Math.abs(model.shadowLengthM(30,0.3048)-0.3048*Math.sqrt(3))<1e-12);
  assert.ok(Math.abs(model.shadowLengthM(45,3)-3)<1e-12);
  assert.equal(model.shadowLengthM(90,0.3048),0);
  assert.equal(model.shadowLengthM(0,0.3048),null);
  assert.equal(model.shadowLengthM(-10,0.3048),null);
  assert.ok(model.shadowLengthM(0.1,0.3048)>100);
  for(const altitude of [NaN,Infinity,-91,91])
    assert.throws(()=>model.shadowLengthM(altitude,0.3048),model.InputError);
  for(const height of [NaN,Infinity,0,-1])
    assert.throws(()=>model.shadowLengthM(45,height),model.InputError);
  assert.throws(()=>model.shadowLengthM(Number.MIN_VALUE,0.3048),model.InputError);
});

test('quarter-hour and half-hour zones are not rounded to full hours',()=>{
  assert.equal(model.resolveLocal('2026-09-08','12:00','Asia/Kathmandu').instant.toISOString(),'2026-09-08T06:15:00.000Z');
  assert.equal(model.resolveLocal('2026-01-08','12:00','Australia/Adelaide').instant.toISOString(),'2026-01-08T01:30:00.000Z');
});

test('rejects DST gaps and requires an explicit repeated-time choice',()=>{
  assert.throws(()=>model.resolveLocal('2026-03-08','02:30','America/New_York'),e=>e.code==='gap');
  assert.throws(()=>model.resolveLocal('2026-11-01','01:30','America/New_York'),e=>e.code==='ambiguous');
  const early=model.resolveLocal('2026-11-01','01:30','America/New_York','earlier');
  const late=model.resolveLocal('2026-11-01','01:30','America/New_York','later');
  assert.equal(late.instant-early.instant,3600000);
  assert.equal(early.instant.toISOString(),'2026-11-01T05:30:00.000Z');
  assert.equal(late.instant.toISOString(),'2026-11-01T06:30:00.000Z');
});

test('checks leap dates and keeps every date in an annual sequence',()=>{
  assert.equal(model.daysInYear(2024),366);
  assert.equal(model.daysInYear(2026),365);
  assert.equal(model.dayOfYear('2024-03-01'),61);
  assert.equal(model.dateFromDay(2024,60),'2024-02-29');
  assert.throws(()=>model.calculate({...base,date:'2026-02-29'}),model.InputError);
  const rows=[...model.annualSamples({...base,date:'2024-02-29'})];
  assert.equal(rows.length,366);
  assert.equal(rows[59].date,'2024-02-29');
  assert.equal(rows[365].date,'2024-12-31');
});

test('annual DST gaps remain explicit and repeated instants are labelled',()=>{
  const rows=[...model.annualSamples({...base,timeZone:'America/New_York',time:'02:30'})];
  assert.equal(rows.length,365);
  assert.equal(rows.find(row=>row.date==='2026-03-08').instant,null);
  const repeat=[...model.annualSamples({...base,timeZone:'America/New_York',time:'01:30'})];
  assert.equal(repeat.find(row=>row.date==='2026-11-01').status,'earlier repeated time');
});

test('daily sampling follows civil dates through DST',()=>{
  const spring=model.dailySamples({...base,date:'2026-03-08',timeZone:'America/New_York'});
  const fall=model.dailySamples({...base,date:'2026-11-01',timeZone:'America/New_York'});
  assert.equal(spring.length,23*4);
  assert.equal(fall.length,25*4);
  assert.ok(spring.every(row=>model.dateAt(row.instant,'America/New_York')==='2026-03-08'));
});

test('daylight integration intervals cover exact civil days and use midpoint positions',()=>{
  for(const [date,timeZone,hours] of [
    ['2026-09-15','Asia/Kolkata',24],['2026-03-08','America/New_York',23],
    ['2026-11-01','America/New_York',25],['2024-02-29','Asia/Kathmandu',24]
  ]){
    const config={...base,date,timeZone},rows=[...model.dailyIntervals(config,7)];
    assert.equal(rows.reduce((sum,row)=>sum+Date.parse(row.endUTC)-Date.parse(row.startUTC),0),hours*3600000);
    for(const [index,row] of rows.entries()){
      assert.equal(model.dateAt(row.instant,timeZone),date);
      assert.equal(row.instant.getTime(),(Date.parse(row.startUTC)+Date.parse(row.endUTC))/2);
      if(index)assert.equal(row.startUTC,rows[index-1].endUTC);
      const direct=SunCalc.getPosition(row.instant,config.latitude,config.longitude);
      assert.equal(row.altitude,direct.altitude);
    }
    assert.equal(rows[0].startUTC,model.resolveLocal(date,'00:00',timeZone).instant.toISOString());
    assert.notEqual(model.dateAt(new Date(rows.at(-1).endUTC),timeZone),date);
  }
  assert.throws(()=>[...model.dailyIntervals({...base,date:'2011-12-30',timeZone:'Pacific/Apia'})],error=>error.code==='gap');
});

test('daily chart extrema use daylight elevation and do not invent polar-night markers',()=>{
  const rows=[{altitude:-20},{altitude:2},{altitude:70},{altitude:1},{altitude:-4}];
  assert.deepEqual(model.daylightExtrema(rows),{min:rows[3],max:rows[2]});
  assert.equal(model.daylightExtrema([{altitude:-10},{altitude:-2}]),null);
  assert.equal(model.daylightExtrema([]),null);
  assert.throws(()=>model.daylightExtrema([{altitude:NaN}]),model.InputError);
  const actual=model.daylightExtrema(model.dailySamples(base));
  assert.ok(actual.min.altitude>=0);
  assert.ok(actual.max.altitude>actual.min.altitude);
});

test('reference grid has one complete path per month plus equinoxes and solstice paths',()=>{
  const curves=[...model.referencePaths(base)];
  assert.equal(curves.length,14);
  const months=curves.filter(curve=>curve.month!==null);
  assert.deepEqual(months.map(curve=>curve.month),Array.from({length:12},(_,i)=>i+1));
  assert.ok(months.every(curve=>curve.date.endsWith('-21')));
  assert.equal(curves.find(curve=>curve.kind==='june-solstice').date,'2026-06-21');
  assert.equal(curves.find(curve=>curve.kind==='december-solstice').date,'2026-12-21');
  assert.equal(curves.find(curve=>curve.kind==='march-equinox').date,'2026-03-20');
  assert.equal(curves.find(curve=>curve.kind==='september-equinox').date,'2026-09-22');
  for(const curve of curves){
    assert.equal(curve.samples.length,24*12);
    assert.ok(curve.samples.every(row=>model.dateAt(row.instant,base.timeZone)===curve.date));
    const segments=model.daylightSegments(curve.samples);
    assert.equal(segments.length,1);
    assert.equal(segments[0][0].altitude,0);
    assert.equal(segments[0].at(-1).altitude,0);
    assert.ok(segments[0].length>100);
  }
});

test('hourly guides hold clock time fixed on every date, including leap day',()=>{
  const config={...base,date:'2024-02-29',timeZone:'Asia/Kathmandu'};
  const curves=[...model.hourlyPaths(config)];
  assert.equal(curves.length,24);
  assert.equal(curves[0].time,'00:00');
  assert.equal(curves.at(-1).time,'23:00');
  for(const curve of curves){
    assert.equal(curve.samples.length,366);
    assert.equal(curve.samples[59].date,'2024-02-29');
    const row=curve.samples[59];
    assert.equal(row.instant.getTime(),model.resolveLocal(row.date,curve.time,config.timeZone).instant.getTime());
    assert.equal(row.utcOffsetMinutes,345);
  }
  assert.deepEqual(curves[12].samples,[...model.annualSamples({...config,time:'12:00'})]);
});

test('daylight segments interpolate the horizon and cross north without wrapping the long way',()=>{
  const sample=(minute,altitude,azimuth)=>({instant:new Date(Date.UTC(2026,0,1,0,minute)),altitude,azimuth});
  const rows=[sample(0,-2,359),sample(5,2,1),sample(10,4,5),sample(15,-4,9)];
  const [segment]=model.daylightSegments(rows);
  assert.equal(segment.length,4);
  assert.equal(segment[0].altitude,0);
  assert.equal(segment[0].azimuth,0);
  assert.equal(segment[0].instant.toISOString(),'2026-01-01T00:02:30.000Z');
  assert.equal(segment.at(-1).altitude,0);
  assert.equal(segment.at(-1).azimuth,7);
  assert.ok(segment.every(row=>row.altitude>=0));
  assert.deepEqual(model.daylightSegments([rows[0],rows[3]]),[]);
  assert.throws(()=>model.daylightSegments([sample(0,NaN,10)]),model.InputError);
});

test('seasonal sky curves break at missing times and DST offset jumps',()=>{
  const config={...base,latitude:40.7128,longitude:-74.006,timeZone:'America/New_York',time:'12:00'};
  const rows=[...model.annualSamples(config)];
  assert.equal(rows.find(row=>row.date==='2026-03-07').utcOffsetMinutes,-300);
  assert.equal(rows.find(row=>row.date==='2026-03-08').utcOffsetMinutes,-240);
  const segments=model.daylightSegments(rows);
  assert.equal(segments.length,3);
  assert.deepEqual(segments.map(segment=>[segment[0].date,segment.at(-1).date]),
    [['2026-01-01','2026-03-07'],['2026-03-08','2026-10-31'],['2026-11-01','2026-12-31']]);
  const withGap=[rows[0],{date:'2026-01-02',instant:null,status:'skipped local time'},rows[2]];
  assert.deepEqual(model.daylightSegments(withGap),[[rows[0]],[rows[2]]]);
});

test('fine daily paths retain DST day lengths and reject invalid sampling intervals',()=>{
  assert.equal(model.dailySamples({...base,date:'2026-03-08',timeZone:'America/New_York'},5).length,23*12);
  assert.equal(model.dailySamples({...base,date:'2026-11-01',timeZone:'America/New_York'},5).length,25*12);
  for(const interval of [0,-1,1.5,61,Infinity])
    assert.throws(()=>model.dailySamples(base,interval),model.InputError);
});

test('reference paths preserve polar day/night and seasonal reversal south of the equator',()=>{
  const polar=[...model.referencePaths({...base,latitude:78.2,longitude:15.6,timeZone:'Arctic/Longyearbyen'})];
  const june=polar.find(curve=>curve.kind==='june-solstice');
  const december=polar.find(curve=>curve.kind==='december-solstice');
  assert.equal(model.daylightSegments(june.samples)[0].length,june.samples.length);
  assert.deepEqual(model.daylightSegments(december.samples),[]);
  const south=[...model.referencePaths({...base,latitude:-33.8688,longitude:151.2093,timeZone:'Australia/Sydney'})];
  const summer=south.find(curve=>curve.kind==='december-solstice');
  const winter=south.find(curve=>curve.kind==='june-solstice');
  assert.ok(model.daylightExtrema(summer.samples).max.altitude>model.daylightExtrema(winter.samples).max.altitude);
  assert.ok(summer.samples.filter(row=>row.altitude>=0).length>winter.samples.filter(row=>row.altitude>=0).length);
});

test('supports southern/tropical northern sun and polar event absence',()=>{
  const northSun=model.calculate({...base,date:'2026-06-21',time:'12:14'});
  assert.ok(northSun.azimuth<90||northSun.azimuth>270);
  const south=model.calculate({...base,latitude:-33.8688,longitude:151.2093,timeZone:'Australia/Sydney',date:'2026-06-21',time:'12:00'});
  assert.ok(south.azimuth<90||south.azimuth>270);
  const day=model.calculate({...base,latitude:78.2,longitude:15.6,timeZone:'Arctic/Longyearbyen',date:'2026-06-21'});
  const night=model.calculate({...base,latitude:78.2,longitude:15.6,timeZone:'Arctic/Longyearbyen',date:'2026-12-21'});
  assert.equal(day.events.sunrise,null);
  assert.equal(day.events.sunset,null);
  assert.equal(day.events.alwaysUp,true);
  assert.equal(night.events.alwaysDown,true);
});

test('rejects missing/invalid coordinates, dates, times and zones',()=>{
  for(const change of [{latitude:NaN},{longitude:Infinity},{latitude:91},{longitude:-181},
    {date:''},{date:'2026-13-01'},{time:'24:00'},{timeZone:'Not/A_Zone'},
    {timeZone:undefined},{timeZone:null},{timeZone:''},{timeZone:'+01:00'}])
    assert.throws(()=>model.calculate({...base,...change}),model.InputError);
  assert.throws(()=>model.dateFromDay(2026,366),model.InputError);
});

test('CSV preserves unavailable rows, UTC, units, zone and engine identity',()=>{
  const config={...base,timeZone:'America/New_York',time:'02:30'};
  const rows=[...model.annualSamples(config)],csv=model.csv(config,rows);
  assert.equal(csv.split('\r\n').length,366);
  assert.match(csv,/"azimuth_deg_from_north"/);
  assert.match(csv,/"2026-03-08".*"skipped local time"/);
  assert.match(csv,/"SunCalc 2.0.1"/);
});

test('browser bundles operate without modules, Node, network or local storage',()=>{
  const context=vm.createContext({Intl,Date,Map,Set,Math,Number,Object,Error,RangeError});
  const root=path.resolve(__dirname,'..');
  vm.runInContext(fs.readFileSync(path.join(root,'vendor','suncalc-2.0.1.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'sun-model.js'),'utf8'),context);
  const result=context.HomeSun.calculate(base);
  assert.equal(result.instant.toISOString(),'2026-09-08T06:30:00.000Z');
  assert.ok(Number.isFinite(result.azimuth));
  assert.equal(context.HomeSun.daySummary(result.events).daylight.status,'sunrise-sunset');
});

test('a missing browser bundle reports an actionable error instead of invented output',()=>{
  const context=vm.createContext({Intl,Date,Map,Set,Math,Number,Object,Error,RangeError});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..','sun-model.js'),'utf8'),context);
  assert.throws(()=>context.HomeSun.calculate(base),error=>error.field==='library');
});
