(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EnvironmentData=api;
})(globalThis,function(){
  'use strict';
  const HOUR=3600000,MAX_RECORDS=200000;
  const FIELDS=Object.freeze({
    temperatureC:{unit:'C',min:-100,max:70,sentinel:99.9},
    rhPct:{unit:'%',min:0,max:100,sentinel:999},
    pressurePa:{unit:'Pa',min:10000,max:120000,sentinel:999999},
    dniWm2:{unit:'W/m2',min:0,max:1600,sentinel:9999},
    dhiWm2:{unit:'W/m2',min:0,max:1500,sentinel:9999},
    ghiWm2:{unit:'W/m2',min:0,max:2000,sentinel:9999},
    windSpeedMps:{unit:'m/s',min:0,max:150,sentinel:999},
    windFromDeg:{unit:'deg',min:0,max:360,sentinel:999}
  });
  const UNITS=Object.freeze(Object.fromEntries(Object.entries(FIELDS).map(([key,value])=>[key,value.unit])));
  const KINDS=['unclassified','historical','reanalysis','tmy','forecast','scenario'];
  const PROVIDER_FIELDS=Object.freeze({
    temperatureC:'temperature_2m',rhPct:'relative_humidity_2m',pressurePa:'surface_pressure',
    dniWm2:'direct_normal_irradiance',dhiWm2:'diffuse_radiation',ghiWm2:'shortwave_radiation',
    windSpeedMps:'wind_speed_10m',windFromDeg:'wind_direction_10m'
  });

  class InputError extends Error{
    constructor(message){super(message);this.name='WeatherInputError';}
  }
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const warn=(warnings,message)=>{if(!warnings.includes(message))warnings.push(message);};
  function number(value){
    return typeof value==='string'&&value.trim()!==''?Number(value):typeof value==='number'?value:NaN;
  }
  function hash(text){
    let value=2166136261;
    for(let i=0;i<text.length;i++)value=Math.imul(value^text.charCodeAt(i),16777619);
    return (value>>>0).toString(16).padStart(8,'0');
  }
  function epoch(year,month,day,hour=0,minute=0,second=0,millis=0){
    const date=new Date(0);
    date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,millis);
    return date.getTime();
  }
  function validDay(year,month,day){
    if(!Number.isInteger(year)||year<1||year>9999||!Number.isInteger(month)||month<1||month>12||
       !Number.isInteger(day)||day<1||day>31)return false;
    const date=new Date(epoch(year,month,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day;
  }
  function timestamp(value){
    if(typeof value!=='string')return null;
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if(!match)return null;
    const [,year,month,day,hour,minute,second='0',fraction='',zone]=match;
    if(!validDay(+year,+month,+day)||+hour>23||+minute>59||+second>59)return null;
    let offset=0;
    if(zone!=='Z'){
      const h=+zone.slice(1,3),m=+zone.slice(4,6);
      if(h>14||m>59||(h===14&&m!==0))return null;
      offset=(h*60+m)*(zone[0]==='-'?-1:1);
    }
    return new Date(epoch(+year,+month,+day,+hour,+minute,+second,
      Number(fraction.padEnd(3,'0')))-offset*60000).toISOString();
  }
  function coordinate(value,name,limit,warnings){
    if(!finite(value)||Math.abs(value)>limit){
      warn(warnings,`${name} is missing or invalid; these data do not establish the building site.`);
      return null;
    }
    return value;
  }
  function classify(value,warnings){
    if(KINDS.includes(value)){
      if(value==='unclassified')warn(warnings,'Weather classification is unconfirmed. Choose historical, reanalysis, TMY, forecast or scenario from source evidence.');
      return value;
    }
    warn(warnings,'Weather classification is unconfirmed. Choose historical, reanalysis, TMY, forecast or scenario from source evidence.');
    return 'unclassified';
  }
  function unitText(value){return typeof value==='string'?value.replace(/\s/g,'').replace(/²/g,'2').replace(/°/g,''):'';}
  function convert(value,field,unit,duration){
    const u=unitText(unit);
    if(field==='temperatureC'){
      if(u==='C'||u==='celsius')return value;
      if(u==='K')return value-273.15;
    }else if(field==='rhPct'&&u==='%')return value;
    else if(field==='pressurePa'){
      if(u==='Pa')return value;
      if(u==='hPa')return value*100;
    }else if(['dniWm2','dhiWm2','ghiWm2'].includes(field)){
      if(u==='W/m2')return value;
      if(u==='Wh/m2')return value*3600/duration;
    }else if(field==='windSpeedMps'){
      if(u==='m/s'||u==='ms')return value;
      if(u==='km/h')return value/3.6;
      if(u==='kn'||u==='knots')return value*1852/3600;
      if(u==='mph')return value*1609.344/3600;
    }else if(field==='windFromDeg'&&(u==='deg'||u==='degrees'||unit==='°'))return value;
    return NaN;
  }
  function normalizeValues(values,units,duration,warnings,allowStrings=false,priorMissing=[]){
    const result={},missing=[];
    for(const [key,rule] of Object.entries(FIELDS)){
      const raw=allowStrings?number(values[key]):values[key];
      let value=NaN;
      if(finite(raw)&&raw!==rule.sentinel&&!priorMissing.includes(key))
        value=convert(raw,key,units[key],duration);
      if(!finite(value)||value<rule.min||value>rule.max){
        result[key]=null;missing.push(key);
        if(raw!==undefined&&raw!==null&&(!allowStrings||String(values[key]).trim()!=='')&&
           raw!==rule.sentinel&&!priorMissing.includes(key))
          warn(warnings,`${key}: invalid values or unsupported units became null (accepted range ${rule.min}–${rule.max} ${rule.unit}).`);
      }else result[key]=key==='windFromDeg'&&value===360?0:value;
    }
    result.missing=missing;
    return result;
  }
  function finish(dataset,rawRecords,warnings){
    if(rawRecords.length>MAX_RECORDS)throw new InputError(`At most ${MAX_RECORDS.toLocaleString('en-US')} records can be imported at once.`);
    const seen=new Set(),records=[];
    let duplicates=0,outOfOrder=0,previous=-Infinity;
    for(const row of rawRecords){
      const t=Date.parse(row.timestamp);
      if(seen.has(t)){duplicates++;continue;}
      if(t<previous)outOfOrder++;
      previous=t;seen.add(t);records.push(row);
    }
    if(!records.length)throw new InputError('No valid weather intervals were found. Check timestamps, dates, duration and the required file structure.');
    if(duplicates)warn(warnings,`${duplicates} duplicate timestamp(s) were discarded; the first interval was retained. Review conflicting source rows.`);
    if(outOfOrder)warn(warnings,`${outOfOrder} out-of-order timestamp(s); source order is retained. TMY month-years are not chronological history.`);
    const sorted=[...records].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
    let gaps=0,overlaps=0,totalSeconds=0;
    for(let i=0;i<sorted.length;i++){
      const row=sorted[i],start=Date.parse(row.timestamp)-row.durationSeconds*1000;
      totalSeconds+=row.durationSeconds;
      if(i){
        const delta=start-Date.parse(sorted[i-1].timestamp);
        if(delta>1)gaps++;
        else if(delta<-1)overlaps++;
      }
    }
    if(gaps)warn(warnings,`${gaps} gap(s) in interval coverage. Missing hours are not interpolated or replaced with zeros.`);
    if(overlaps)warn(warnings,`${overlaps} overlapping interval(s); interval totals are not a continuous energy history.`);
    for(const key of Object.keys(FIELDS)){
      const count=records.reduce((n,row)=>n+(row[key]===null?1:0),0);
      if(count)warn(warnings,`${count} of ${records.length} records missing ${key}.`);
    }
    if(dataset.kind==='tmy')warn(warnings,'TMY is a synthetic typical year, not observed chronological history. Original source years are preserved; no year remapping was performed.');
    const first=sorted[0],last=sorted[sorted.length-1];
    const coverage={startUTC:new Date(Date.parse(first.timestamp)-first.durationSeconds*1000).toISOString(),
      endUTC:last.timestamp,recordCount:records.length,intervalHours:totalSeconds/3600,gaps,overlaps,duplicates,
      chronological:outOfOrder===0&&dataset.kind!=='tmy'};
    const span=(Date.parse(coverage.endUTC)-Date.parse(coverage.startUTC))/HOUR;
    if(span<8760)warn(warnings,'Coverage is shorter than a full year; a partial record is not an annual climate normal.');
    return {...dataset,records,coverage,units:{...UNITS},warnings,
      timestampMeaning:'Interval end in UTC. Radiation is a mean over the preceding durationSeconds; other variable sampling follows source metadata.'};
  }
  function csv(line){
    const fields=[];let value='',quoted=false,closed=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(quoted){
        if(c==='"'){
          if(line[i+1]==='"'){value+='"';i++;}
          else{quoted=false;closed=true;}
        }else value+=c;
      }else if(c===','){fields.push(value.trim());value='';closed=false;}
      else if(c==='"'&&!value.trim()&&!closed)quoted=true;
      else if(closed&&c.trim())throw new InputError('Malformed quoted CSV field in EPW.');
      else value+=c;
    }
    if(quoted)throw new InputError('Unclosed quoted CSV field in EPW.');
    fields.push(value.trim());return fields;
  }

  function parseEPW(text){
    if(typeof text!=='string'||!text.trim())throw new InputError('Select a nonempty EPW text file.');
    const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/).filter(line=>line.trim());
    if(lines.length<9)throw new InputError('An EPW file needs eight header lines followed by weather rows.');
    const expected=['LOCATION','DESIGN CONDITIONS','TYPICAL/EXTREME PERIODS','GROUND TEMPERATURES',
      'HOLIDAYS/DAYLIGHT SAVINGS','COMMENTS 1','COMMENTS 2','DATA PERIODS'];
    const headers=lines.slice(0,8).map(csv);
    expected.forEach((name,i)=>{if(headers[i][0].toUpperCase()!==name)throw new InputError(`EPW header ${i+1} must be ${name}.`);});
    const warnings=[],location=headers[0],periods=headers[7],offset=number(location[8]);
    if(!finite(offset)||offset<-12||offset>14)throw new InputError('EPW LOCATION needs a valid local-standard UTC offset (−12 to +14 hours).');
    const perHour=number(periods[2]);
    if(!Number.isInteger(perHour)||perHour<1||perHour>60||60%perHour!==0)
      throw new InputError('EPW DATA PERIODS must specify a records-per-hour value that divides 60.');
    const durationSeconds=3600/perHour,intervalMinutes=60/perHour;
    if(!Number.isInteger(number(periods[1]))||number(periods[1])<1)
      throw new InputError('EPW DATA PERIODS has an invalid period count.');
    if(number(periods[1])!==1)warn(warnings,'This EPW declares multiple data periods; review each period and the reported gaps before integration.');
    if(periods.length<3+number(periods[1])*4)warn(warnings,'EPW DATA PERIODS metadata is incomplete.');
    const presentPeriods=Math.min(number(periods[1]),Math.ceil(Math.max(0,periods.length-3)/4));
    for(let i=0;i<presentPeriods;i++){
      for(const label of [periods[5+i*4],periods[6+i*4]]){
        const parts=/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(label||'');
        if(!parts||!validDay(parts[3]?+parts[3]:2000,+parts[1],+parts[2]))
          warn(warnings,'EPW DATA PERIODS contains an invalid or missing calendar boundary. Actual row timestamps are retained; do not assume the declared coverage.');
      }
    }
    const source={label:[location[1],location[3],location[4]].filter(Boolean).join(' · '),
      format:'EPW',city:location[1]||'',state:location[2]||'',country:location[3]||'',
      dataSource:location[4]||'',stationId:location[5]||'',
      elevationM:finite(number(location[9]))?number(location[9]):null,
      headers:Object.fromEntries(headers.map(row=>[row[0],row.slice(1)])),
      recordsPerHour:perHour,timeBasis:'Local standard time; fixed UTC offset, no DST',
      radiationOriginalUnit:'Wh/m2',radiationConversion:'Wh/m2 × 3600 / durationSeconds → W/m2',
      observationTiming:'EPW end-of-interval fields; radiation integrated over the preceding interval',
      license:'Supplied by the file owner. EPW format does not establish redistribution rights.',
      documentation:'https://bigladdersoftware.com/epx/docs/24-2/auxiliary-programs/energyplus-weather-file-epw-data-dictionary.html'};
    const evidence=[location[4],...headers[5],...headers[6]].join(' ');
    const kind=/\b(?:TMY[A-Za-z0-9]*|IWEC2?|typical\s+meteorological)\b/i.test(evidence)?'tmy':classify(undefined,warnings);
    const units={...UNITS,dniWm2:'Wh/m2',dhiWm2:'Wh/m2',ghiWm2:'Wh/m2'};
    const records=[];let badRows=0;
    if(lines.length-8>MAX_RECORDS)throw new InputError(`EPW exceeds ${MAX_RECORDS} rows.`);
    for(let i=8;i<lines.length;i++){
      const row=csv(lines[i]);
      if(row.length<35){badRows++;continue;}
      const [year,month,day,hour,minute]=row.slice(0,5).map(number);
      if(!validDay(year,month,day)||!Number.isInteger(hour)||hour<1||hour>24||
         !Number.isInteger(minute)||minute<1||minute>60||minute%intervalMinutes!==0){badRows++;continue;}
      const end=epoch(year,month,day)+(hour-1)*HOUR+minute*60000-offset*HOUR;
      const values={temperatureC:row[6],rhPct:row[8],pressurePa:row[9],ghiWm2:row[13],
        dniWm2:row[14],dhiWm2:row[15],windFromDeg:row[20],windSpeedMps:row[21]};
      records.push({timestamp:new Date(end).toISOString(),durationSeconds,
        ...normalizeValues(values,units,durationSeconds,warnings,true),
        sourceTime:{year,month,day,hour,minute}});
    }
    if(badRows)warn(warnings,`${badRows} malformed EPW row(s) skipped: need 35 fields, a real calendar date, hour 1–24 and an end-of-interval minute (60 for hourly data).`);
    warn(warnings,'EPW local-standard time is not the site IANA daylight-saving clock. Radiation Wh/m2 was divided by interval hours, not treated as instantaneous power.');
    return finish({id:`epw-${hash(text)}`,kind,source,
      latitude:coordinate(number(location[6]),'Latitude',90,warnings),
      longitude:coordinate(number(location[7]),'Longitude',180,warnings),timeZoneOffsetHours:offset},records,warnings);
  }

  function parseWeatherJSON(text){
    if(typeof text!=='string')throw new InputError('Weather JSON must be text.');
    let data;
    try{data=JSON.parse(text);}catch(error){
      if(!(error instanceof SyntaxError))throw error;
      throw new InputError('Weather JSON is not valid JSON. No existing data were changed.');
    }
    if(object(data)&&object(data.hourly))return fromOpenMeteo(data);
    const warnings=[];
    if(Array.isArray(data)){data={records:data};warn(warnings,'Bare record array: source, classification and location metadata were not supplied.');}
    if(!object(data)||!Array.isArray(data.records))throw new InputError('Weather JSON needs a records array, or an Open-Meteo hourly response.');
    if(data.records.length>MAX_RECORDS)throw new InputError(`Weather JSON exceeds ${MAX_RECORDS} records.`);
    if(data.units!==undefined&&!object(data.units))throw new InputError('Weather units must be an object keyed by normalized variable name.');
    if(Array.isArray(data.warnings))data.warnings.filter(value=>typeof value==='string').forEach(value=>warn(warnings,value));
    const units={...UNITS,...data.units},records=[];let malformed=0;
    for(const row of data.records){
      if(!object(row)){malformed++;continue;}
      const end=timestamp(row.timestamp),duration=row.durationSeconds;
      if(!end||!finite(duration)||duration<=0||duration>86400){malformed++;continue;}
      if(row.missing!==undefined&&!Array.isArray(row.missing)){
        warn(warnings,'A JSON record has a malformed missing array and was skipped rather than discarding its quality flags.');
        malformed++;continue;
      }
      const priorMissing=Array.isArray(row.missing)?row.missing.filter(key=>typeof key==='string'):[];
      const overlap=row.requestedOverlapSeconds;
      if(overlap!==undefined&&(!finite(overlap)||overlap<=0||overlap>duration))
        warn(warnings,'Invalid requestedOverlapSeconds metadata was discarded; original source intervals remain unchanged.');
      records.push({timestamp:end,durationSeconds:duration,...normalizeValues(row,units,duration,warnings,false,priorMissing),
        ...(finite(overlap)&&overlap>0&&overlap<=duration?{requestedOverlapSeconds:overlap}:{}),
        ...(object(row.sourceTime)?{sourceTime:{...row.sourceTime}}:{})});
    }
    if(malformed)warn(warnings,`${malformed} malformed JSON record(s) skipped: timestamps need real dates and an explicit UTC/offset suffix; durationSeconds must be > 0 and ≤ 86400.`);
    const source=typeof data.source==='string'?{label:data.source}:object(data.source)?{...data.source}:{label:'Local weather JSON',format:'Normalized weather JSON'};
    if(!data.units)warn(warnings,'No units object: canonical field names imply C, %, Pa, W/m2, m/s and degrees FROM true north.');
    source.normalizedUnits={...UNITS};
    let offset;
    if(data.timeZoneOffsetHours!==undefined){
      if(!finite(data.timeZoneOffsetHours)||data.timeZoneOffsetHours<-12||data.timeZoneOffsetHours>14)
        throw new InputError('timeZoneOffsetHours must be a finite fixed offset between −12 and +14.');
      offset=data.timeZoneOffsetHours;
    }
    return finish({id:`json-${hash(text)}`,kind:classify(data.kind,warnings),source,
      latitude:coordinate(data.latitude,'Latitude',90,warnings),longitude:coordinate(data.longitude,'Longitude',180,warnings),
      ...(offset===undefined?{}:{timeZoneOffsetHours:offset})},records,warnings);
  }

  function fromOpenMeteo(response){
    if(!object(response))throw new InputError('Expected one Open-Meteo response object, not a list or empty response.');
    if(response.error)throw new InputError(`Open-Meteo rejected the request: ${typeof response.reason==='string'?response.reason:'unspecified provider error'}`);
    if(!object(response.hourly)||!Array.isArray(response.hourly.time))
      throw new InputError('Open-Meteo response needs hourly.time as an array.');
    const hourly=response.hourly,count=hourly.time.length,warnings=[],records=[],arrays={},units={};
    if(count>MAX_RECORDS)throw new InputError(`Open-Meteo response exceeds ${MAX_RECORDS} intervals.`);
    const providedUnits=object(response.hourly_units)?response.hourly_units:{};
    for(const [key,provider] of Object.entries(PROVIDER_FIELDS)){
      arrays[key]=Array.isArray(hourly[provider])?hourly[provider]:[];
      units[key]=providedUnits[provider];
      if(!Array.isArray(hourly[provider]))warn(warnings,`Open-Meteo ${provider} is missing or is not an array; ${key} is null.`);
      else if(hourly[provider].length!==count)warn(warnings,`Open-Meteo ${provider} length ${hourly[provider].length} differs from time length ${count}; absent elements stay null, excess elements are ignored.`);
      if(typeof units[key]!=='string')warn(warnings,`Open-Meteo unit for ${provider} is missing; values cannot safely be interpreted.`);
    }
    const declaredUTC=['UTC','GMT','Etc/UTC','Etc/GMT'].includes(response.timezone)&&
      (response.utc_offset_seconds===undefined||response.utc_offset_seconds===0);
    let badDates=0;
    for(let i=0;i<count;i++){
      const time=hourly.time[i];let end=null;
      if(finite(time)&&(!providedUnits.time||providedUnits.time==='unixtime')){
        const date=new Date(time*1000);
        if(Number.isFinite(date.getTime())&&date.getUTCFullYear()>=1&&date.getUTCFullYear()<=9999)end=date.toISOString();
      }else if(typeof time==='string'){
        end=timestamp(time);
        if(!end&&declaredUTC)end=timestamp(`${time}Z`);
      }
      if(!end){badDates++;continue;}
      const values={};
      for(const key of Object.keys(PROVIDER_FIELDS))values[key]=typeof units[key]==='string'?arrays[key][i]:null;
      records.push({timestamp:end,durationSeconds:3600,...normalizeValues(values,units,3600,warnings)});
    }
    if(badDates)warn(warnings,`${badDates} invalid or ambiguous Open-Meteo timestamp(s) skipped. Request timezone=UTC and timeformat=unixtime; local ISO strings are not shifted by a guessed offset.`);
    const source={label:'Open-Meteo hourly weather',provider:'Open-Meteo',
      model:typeof response.model==='string'?response.model:'Not identified in response; retain the original request',
      format:'Open-Meteo hourly',documentation:'https://open-meteo.com/en/docs/historical-weather-api',
      license:'Weather data: CC BY 4.0 attribution. Free API service is restricted to non-commercial use and subject to quotas and separate terms.',
      attribution:'Open-Meteo.com and its indicated upstream weather datasets',
      termsURL:'https://open-meteo.com/en/terms',returnedTimeZone:response.timezone||null,
      returnedUTCOffsetSeconds:finite(response.utc_offset_seconds)?response.utc_offset_seconds:null,
      elevationM:finite(response.elevation)?response.elevation:null,
      originalUnits:{...providedUnits},windReferenceHeightM:10,temperatureReferenceHeightM:2,
      radiationTiming:'Mean W/m2 over the preceding hour ending at timestamp',
      otherVariableTiming:'Instantaneous model values at timestamp',
      transformations:['Unix seconds are UTC instants; no offset added','Surface pressure hPa → Pa when declared','Declared wind speed units → m/s']};
    warn(warnings,'Gridded/model weather is not a measurement at the house. Wind at 10 m is not window-height or occupant airspeed.');
    warn(warnings,'Radiation is a preceding-hour mean; temperature, humidity, pressure and wind are instantaneous model fields at the timestamp. No interpolation is performed.');
    return finish({id:`open-meteo-${hash(JSON.stringify(response))}`,kind:classify(response.kind,warnings),source,
      latitude:coordinate(response.latitude,'Latitude',90,warnings),longitude:coordinate(response.longitude,'Longitude',180,warnings),
      timeZoneOffsetHours:0},records,warnings);
  }

  function windRose(records,options={}){
    if(!Array.isArray(records)||!object(options))throw new InputError('Wind rose requires records and an options object.');
    const calm=options.calmThresholdMps===undefined?0.5:options.calmThresholdMps;
    if(!finite(calm)||calm<0||calm>150)throw new InputError('Calm threshold must be between 0 and 150 m/s.');
    const months=options.months===undefined?[]:options.months;
    if(!Array.isArray(months)||months.some(month=>!Number.isInteger(month)||month<1||month>12))
      throw new InputError('Wind-rose months must be an array of month numbers 1–12.');
    const daytime=options.daytime||'all',start=options.dayStartHour===undefined?6:options.dayStartHour,
      end=options.dayEndHour===undefined?18:options.dayEndHour;
    if(!['all','day','night'].includes(daytime)||!finite(start)||!finite(end)||start<0||start>=24||end<0||end>24||start===end)
      throw new InputError('Choose all/day/night and a nonempty daytime clock window in hours 0–24.');
    let formatter=null;
    if(options.timeZone!==undefined){
      try{formatter=new Intl.DateTimeFormat('en-GB',{timeZone:options.timeZone,month:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'});}
      catch(error){
        if(!(error instanceof RangeError))throw error;
        throw new InputError('Choose a valid IANA time zone for wind-rose filters.');
      }
    }
    const offset=options.timeZoneOffsetHours===undefined?0:options.timeZoneOffsetHours;
    if(!finite(offset)||offset<-12||offset>14)throw new InputError('Wind-rose fixed UTC offset must be between −12 and +14.');
    if(formatter&&options.timeZoneOffsetHours!==undefined)throw new InputError('Choose either an IANA time zone or a fixed standard-time offset, not both.');
    const bins=Array.from({length:16},(_,i)=>({directionDeg:i*22.5,count:0,meanSpeedMps:null}));
    const sums=new Array(16).fill(0);
    let calmCount=0,missingCount=0,total=0,excludedCount=0,unknownTimeCount=0;
    for(const row of records){
      if(months.length||daytime!=='all'){
        const endTime=object(row)?timestamp(row.timestamp):null;
        if(!endTime){unknownTimeCount++;missingCount++;total++;continue;}
        const instant=new Date(endTime);let month,hour;
        if(formatter){
          const parts=Object.fromEntries(formatter.formatToParts(instant).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
          month=parts.month;hour=parts.hour+parts.minute/60;
        }else{
          const local=new Date(instant.getTime()+offset*HOUR);
          month=local.getUTCMonth()+1;hour=local.getUTCHours()+local.getUTCMinutes()/60;
        }
        const day=start<end?hour>=start&&hour<end:hour>=start||hour<end;
        if((months.length&&!months.includes(month))||(daytime==='day'&&!day)||(daytime==='night'&&day)){excludedCount++;continue;}
      }
      total++;
      if(!object(row)||!finite(row.windSpeedMps)||row.windSpeedMps<0||row.windSpeedMps>150||
         (Array.isArray(row.missing)&&row.missing.includes('windSpeedMps'))){missingCount++;continue;}
      const speed=row.windSpeedMps;
      if(speed===0||speed<calm){calmCount++;continue;}
      if(!finite(row.windFromDeg)||row.windFromDeg<0||row.windFromDeg>360||
         (Array.isArray(row.missing)&&row.missing.includes('windFromDeg'))){missingCount++;continue;}
      const index=Math.floor(((row.windFromDeg%360)+11.25)/22.5)%16;
      bins[index].count++;sums[index]+=speed;
    }
    bins.forEach((bin,i)=>{if(bin.count)bin.meanSpeedMps=sums[i]/bin.count;});
    return {bins,calmCount,missingCount,total,excludedCount,unknownTimeCount,calmThresholdMps:calm,
      directionConvention:'Meteorological FROM, clockwise from true north',
      frequencyBasis:'Record count, not duration-weighted; do not mix interval lengths as hourly frequencies',
      timeBasis:options.timeZone||`Fixed UTC${offset<0?'':'+'}${offset}`,
      daytimeDefinition:{mode:daytime,startHour:start,endHour:end,meaning:'Clock-hour filter, not astronomical daylight'}};
  }

  return Object.freeze({parseEPW,parseWeatherJSON,fromOpenMeteo,windRose,InputError,UNITS,PROVIDER_FIELDS});
});
