(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports
    ? require('./vendor/suncalc-2.0.1.js') : root.SunCalc);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomeSun=api;
})(globalThis,function(SunCalc){
  'use strict';
  const MINUTE=60000,DAY=86400000;
  const formatters=new Map();

  class InputError extends Error{
    constructor(message,field,code='input'){
      super(message);this.name='SunInputError';this.field=field;this.code=code;
    }
  }

  function formatter(timeZone){
    if(typeof timeZone!=='string'||!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(timeZone))
      throw new InputError('Enter an IANA time zone, such as Asia/Kolkata, or UTC.','timeZone');
    if(formatters.has(timeZone))return formatters.get(timeZone);
    let result;
    try{
      result=new Intl.DateTimeFormat('en-CA',{
        timeZone,calendar:'gregory',numberingSystem:'latn',hourCycle:'h23',
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'
      });
    }catch(error){
      if(!(error instanceof RangeError))throw error;
      throw new InputError('Enter a valid IANA time zone, such as Asia/Kolkata or America/New_York.','timeZone');
    }
    if(formatters.size>=16)formatters.delete(formatters.keys().next().value);
    formatters.set(timeZone,result);
    return result;
  }

  function partsAt(instant,timeZone){
    return Object.fromEntries(formatter(timeZone).formatToParts(instant)
      .filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  }

  function epoch(parts){
    const date=new Date(0);
    date.setUTCFullYear(parts.year,parts.month-1,parts.day);
    date.setUTCHours(parts.hour||0,parts.minute||0,parts.second||0,0);
    return date.getTime();
  }

  function parseDate(date){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if(!match)throw new InputError('Choose a complete calendar date.','date');
    const parts={year:+match[1],month:+match[2],day:+match[3]};
    const check=new Date(epoch(parts));
    if(parts.year<1||check.getUTCFullYear()!==parts.year||
       check.getUTCMonth()+1!==parts.month||check.getUTCDate()!==parts.day)
      throw new InputError('Choose a valid calendar date.','date');
    return parts;
  }

  function parseTime(time){
    const match=/^(\d{2}):(\d{2})$/.exec(time);
    if(!match||+match[1]>23||+match[2]>59)
      throw new InputError('Choose a time between 00:00 and 23:59.','time');
    return {hour:+match[1],minute:+match[2]};
  }

  const pad=n=>String(n).padStart(2,'0');
  const dateText=p=>`${String(p.year).padStart(4,'0')}-${pad(p.month)}-${pad(p.day)}`;
  const sameTime=(a,b)=>['year','month','day','hour','minute'].every(key=>a[key]===b[key]);

  function localCandidates(date,time,timeZone){
    const wanted={...parseDate(date),...parseTime(time)};
    const naive=epoch(wanted),offsets=new Set();
    // Sample both sides of a clock change; match wall time instead of guessing a UTC offset.
    for(const hours of [-36,-12,0,12,36]){
      const sample=naive+hours*60*MINUTE;
      offsets.add(epoch(partsAt(new Date(sample),timeZone))-sample);
    }
    return [...offsets].map(offset=>new Date(naive-offset))
      .filter(candidate=>sameTime(partsAt(candidate,timeZone),wanted))
      .sort((a,b)=>a-b);
  }

  function resolveLocal(date,time,timeZone,occurrence=''){
    const candidates=localCandidates(date,time,timeZone);
    if(!candidates.length)
      throw new InputError('This local time does not exist because the clock or calendar skips forward. Choose another time.','time','gap');
    if(candidates.length>1&&!['earlier','later'].includes(occurrence))
      throw new InputError('This clock time occurs twice. Choose the earlier or later occurrence below.','occurrence','ambiguous');
    return {instant:candidates[occurrence==='later'?candidates.length-1:0],ambiguous:candidates.length>1};
  }

  function validate(config){
    if(!Number.isFinite(config.latitude)||Math.abs(config.latitude)>90)
      throw new InputError('Latitude must be a number from -90 to 90.','latitude');
    if(!Number.isFinite(config.longitude)||Math.abs(config.longitude)>180)
      throw new InputError('Longitude must be a number from -180 to 180.','longitude');
    parseDate(config.date);parseTime(config.time);formatter(config.timeZone);
    if(config.occurrence&&!['earlier','later'].includes(config.occurrence))
      throw new InputError('Choose the earlier or later clock occurrence.','occurrence');
    if(!SunCalc||typeof SunCalc.getPosition!=='function'||typeof SunCalc.getTimes!=='function')
      throw new InputError('The local SunCalc bundle is unavailable. Keep the vendor folder beside index.html and reload.','library');
    return config;
  }

  function position(instant,latitude,longitude){
    const result=SunCalc.getPosition(instant,latitude,longitude);
    if(!Number.isFinite(result.altitude)||!Number.isFinite(result.azimuth))
      throw new InputError('SunCalc could not calculate this position. Check the date and coordinates.','date');
    const altitude=result.altitude,azimuth=(result.azimuth+360)%360;
    const a=altitude*Math.PI/180,b=azimuth*Math.PI/180;
    return {altitude,azimuth,zenith:90-altitude,
      vector:{east:Math.cos(a)*Math.sin(b),north:Math.cos(a)*Math.cos(b),up:Math.sin(a)}};
  }

  function calculate(config){
    validate(config);
    const resolved=resolveLocal(config.date,config.time,config.timeZone,config.occurrence);
    const noon=localCandidates(config.date,'12:00',config.timeZone)[0]||resolved.instant;
    const events=SunCalc.getTimes(noon,config.latitude,config.longitude);
    return {...resolved,...position(resolved.instant,config.latitude,config.longitude),events};
  }

  function dailySamples(config){
    validate(config);
    const midnight=epoch(parseDate(config.date)),samples=[];
    // Filter UTC samples by civil date, retaining 23/25-hour DST days without a fixed offset.
    for(let t=midnight-18*60*MINUTE;t<midnight+42*60*MINUTE;t+=15*MINUTE){
      const instant=new Date(t);
      if(dateText(partsAt(instant,config.timeZone))===config.date)
        samples.push({instant,...position(instant,config.latitude,config.longitude)});
    }
    return samples;
  }

  function daylightExtrema(samples){
    let min=null,max=null;
    for(const sample of samples){
      if(!Number.isFinite(sample.altitude))
        throw new InputError('A daily sun sample has an invalid elevation.','date');
      if(sample.altitude<0)continue;
      if(!min||sample.altitude<min.altitude)min=sample;
      if(!max||sample.altitude>max.altitude)max=sample;
    }
    return min?{min,max}:null;
  }

  function* annualSamples(config){
    validate(config);
    const year=parseDate(config.date).year;
    const first=epoch({year,month:1,day:1}),last=epoch({year:year+1,month:1,day:1});
    for(let t=first;t<last;t+=DAY){
      const day=new Date(t),date=dateText({year,month:day.getUTCMonth()+1,day:day.getUTCDate()});
      const candidates=localCandidates(date,config.time,config.timeZone);
      if(!candidates.length){yield {date,instant:null,status:'skipped local time'};continue;}
      const instant=candidates[config.occurrence==='later'?candidates.length-1:0];
      const status=candidates.length>1?`${config.occurrence||'earlier'} repeated time`:'available';
      yield {date,instant,status,...position(instant,config.latitude,config.longitude)};
    }
  }

  function dateAt(instant,timeZone){return dateText(partsAt(instant,timeZone));}
  function daysInYear(year){
    return (epoch({year:year+1,month:1,day:1})-epoch({year,month:1,day:1}))/DAY;
  }
  function dayOfYear(date){
    const p=parseDate(date);
    return (epoch(p)-epoch({year:p.year,month:1,day:1}))/DAY+1;
  }
  function dateFromDay(year,day){
    if(!Number.isInteger(day)||day<1||day>daysInYear(year))
      throw new InputError('Choose a valid day of the selected year.','date');
    const d=new Date(epoch({year,month:1,day:1})+(day-1)*DAY);
    return dateText({year,month:d.getUTCMonth()+1,day:d.getUTCDate()});
  }

  function csv(config,rows){
    const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
    const header=['date','local_time','time_zone','latitude_deg','longitude_deg','instant_utc',
      'azimuth_deg_from_north','apparent_elevation_deg','apparent_zenith_deg','status','engine'];
    return [header,...rows.map(row=>[row.date,config.time,config.timeZone,config.latitude,config.longitude,
      row.instant?row.instant.toISOString():'',row.azimuth,row.altitude,row.zenith,row.status,'SunCalc 2.0.1'])]
      .map(row=>row.map(quote).join(',')).join('\r\n');
  }

  return Object.freeze({InputError,validate,calculate,dailySamples,daylightExtrema,annualSamples,resolveLocal,
    dateAt,daysInYear,dayOfYear,dateFromDay,csv});
});
