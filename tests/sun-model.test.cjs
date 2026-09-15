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
});

test('a missing browser bundle reports an actionable error instead of invented output',()=>{
  const context=vm.createContext({Intl,Date,Map,Set,Math,Number,Object,Error,RangeError});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..','sun-model.js'),'utf8'),context);
  assert.throws(()=>context.HomeSun.calculate(base),error=>error.field==='library');
});
