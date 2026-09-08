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
