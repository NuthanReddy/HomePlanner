import { request } from './api'
import type { WorkspaceRecord } from './native-api'

export type SolarInputs = {
  date:string;local_time:string;occurrence:'earlier'|'later'|null
  altitude_m:number|null;pressure_pa:number|null;temperature_c:number|null
  acknowledge_reference:boolean;sample_minutes:number
  pole_height_m?:number|null;low_sun_cutoff_deg?:number
}
export type SolarPosition = {
  instantUTC:string;localTime:string;azimuthDeg:number;geometricElevationDeg:number;apparentElevationDeg:number;aboveHorizon:boolean
}
export type SolarCalendarRow={date:string;status:'available'|'skipped local time'|'earlier repeated time'|'later repeated time';position:SolarPosition|null}
export type SolarCurve={time:string;rows:SolarCalendarRow[]}
export type PoleShadow={status:'unknown-height'|'night'|'low-sun'|'available';lengthM:number|null;bearingDeg:number|null}
export type SolarCharts={
  schemaVersion:1;year:number;sampleCount:number;referenceSampleMinutes:5
  references:{date:string;kind:string;durationHours:number;status:string;samples:SolarPosition[]}[]
  annual:SolarCurve;hourly:SolarCurve[]
  monthly:{date:string;times:(SolarCalendarRow&{time:string})[]}[]
  extrema:{min:SolarPosition;max:SolarPosition}|null
  summary:{events:Record<string,string|null>;daylight:{status:'sunrise-sunset'|'polar-day'|'polar-night'|'incomplete';durationHours:number|null};method:string
    phases:{name:string;thresholdDeg:number;morning:string|null;evening:string|null}[];phaseMethod:string}
  pole:{heightM:number|null;lowSunCutoffDeg:number;selected:PoleShadow;path:PoleShadow[]}
  geometry:{status:'legacy-only';reason:string}
}
export type SolarResult = {
  project_id:string;version:number;scope:'site-solar-position-not-shading'
  result:{
    status:'ok';kind:'solar-position';inputs:Record<string,unknown>
    output:{selected:SolarPosition;path:SolarPosition[];day:{startUTC:string;endUTC:string;durationHours:number;sampleMinutes:number;sampleCount:number;sampling:string};charts?:SolarCharts}
    engine:{name:string;version:string;method:string};assumptions:string[]
  }
}
function object(value:unknown):value is Record<string,unknown> {return !!value&&typeof value==='object'&&!Array.isArray(value)}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
function instant(value:unknown):value is string {
  return typeof value==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))
}
function position(value:unknown):value is SolarPosition {
  return object(value)&&instant(value.instantUTC)&&instant(value.localTime)&&typeof value.aboveHorizon==='boolean'
    &&finite(value.azimuthDeg)&&value.azimuthDeg>=0&&value.azimuthDeg<=360
    &&finite(value.geometricElevationDeg)&&Math.abs(value.geometricElevationDeg)<=90
    &&finite(value.apparentElevationDeg)&&Math.abs(value.apparentElevationDeg)<=90
    &&value.aboveHorizon===(value.apparentElevationDeg>0)
}
function parseCharts(value:unknown,path:SolarPosition[],selected:SolarPosition) {
  const fail=()=>{throw new Error('Invalid bounded solar chart evidence.')}
  if(!object(value)||value.schemaVersion!==1||!Number.isInteger(value.year)||Number(value.year)<1900||Number(value.year)>2100
    ||!Number.isInteger(value.sampleCount)||Number(value.sampleCount)<1||Number(value.sampleCount)>14000||value.referenceSampleMinutes!==5
    ||!Array.isArray(value.references)||value.references.length!==14||!Array.isArray(value.hourly)||value.hourly.length!==24
    ||!Array.isArray(value.monthly)||value.monthly.length!==12||!object(value.summary)||!object(value.pole)||!object(value.geometry)
    ||value.geometry.status!=='legacy-only'||typeof value.geometry.reason!=='string')return fail()
  const year=Number(value.year),days=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000
  const dateAt=(offset:number)=>new Date(Date.UTC(year,0,1)+offset*86400000).toISOString().slice(0,10)
  function row(item:unknown,expectedDate:string) {
    if(!object(item)||item.date!==expectedDate||!['available','skipped local time','earlier repeated time','later repeated time'].includes(String(item.status))
      ||(item.status==='skipped local time'?item.position!==null:!position(item.position)))return fail()
    if(item.position!==null&&(item.position as SolarPosition).localTime.slice(0,10)!==expectedDate)return fail()
  }
  function curve(item:unknown) {
    if(!object(item)||typeof item.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
      ||!Array.isArray(item.rows)||item.rows.length!==days)return fail()
    const clock=item.time
    item.rows.forEach((p,index)=>{
      row(p,dateAt(index))
      if(p.position!==null&&p.position.localTime.slice(11,16)!==clock)fail()
    })
  }
  curve(value.annual)
  value.hourly.forEach((item,index)=>{curve(item);if(item.time!==`${String(index).padStart(2,'0')}:00`)fail()})
  const expectedRefs=Array.from({length:12},(_,index)=>`${year}-${String(index+1).padStart(2,'0')}-21`).concat(`${year}-03-20`,`${year}-09-22`).sort()
  value.references.forEach((item,index)=>{
    if(!object(item)||item.date!==expectedRefs[index]||!['monthly','june-solstice','december-solstice','march-equinox','september-equinox'].includes(String(item.kind))
      ||!finite(item.durationHours)||!Array.isArray(item.samples)||item.samples.length>313||!item.samples.every(position)
      ||(item.status==='available'?(item.durationHours<20||item.durationHours>26||item.samples.length!==Math.ceil(item.durationHours*12)+1)
        :item.status!=='unsupported civil date'||item.samples.length!==0))return fail()
    const samples=item.samples as SolarPosition[]
    if(item.status==='available'&&Math.abs((Date.parse(samples.at(-1)!.instantUTC)-Date.parse(samples[0].instantUTC))/3600000-item.durationHours)>1e-8)fail()
    samples.forEach((point,index)=>{if(index>0&&(Date.parse(point.instantUTC)<=Date.parse(samples[index-1].instantUTC)
      ||Date.parse(point.instantUTC)-Date.parse(samples[index-1].instantUTC)>300000))fail()})
  })
  value.monthly.forEach((item,index)=>{
    const expected=`${year}-${String(index+1).padStart(2,'0')}-21`
    if(!object(item)||item.date!==expected||!Array.isArray(item.times)||item.times.length!==3)return fail()
    item.times.forEach((p,index)=>{row(p,expected);if(p.time!==['09:00','12:00','15:00'][index])fail()})
  })
  const references=value.references as SolarCharts['references'],hourly=value.hourly as SolarCurve[],annual=value.annual as SolarCurve
  const sampleCount=references.reduce((sum,curve)=>sum+curve.samples.length,0)
    +hourly.reduce((sum,curve)=>sum+curve.rows.filter(row=>row.position!==null).length,0)
    +(annual.time.endsWith(':00')?0:annual.rows.filter(row=>row.position!==null).length)
  if(sampleCount!==value.sampleCount)return fail()
  if(value.extrema!==null&&(!object(value.extrema)||!position(value.extrema.min)||!position(value.extrema.max)
    ||!value.extrema.min.aboveHorizon||value.extrema.min.apparentElevationDeg>value.extrema.max.apparentElevationDeg))return fail()
  const summary=value.summary, daylight=summary.daylight
  if(!object(summary.events))return fail()
  const events=summary.events
  if(!['sunrise','sunset','solarNoon','dawn','dusk','nauticalDawn','nauticalDusk','nightEnd','night','goldenHourEnd','goldenHour'].every(key=>key in events)
    ||!Object.values(summary.events).every(event=>event===null||instant(event))||!instant(summary.events.solarNoon)
    ||typeof summary.method!=='string'||typeof summary.phaseMethod!=='string'||!Array.isArray(summary.phases)||summary.phases.length!==4
    ||!object(daylight)||!['sunrise-sunset','polar-day','polar-night','incomplete'].includes(String(daylight.status))
    ||(daylight.durationHours!==null&&(!finite(daylight.durationHours)||daylight.durationHours<0||daylight.durationHours>26)))return fail()
  if(daylight.status==='sunrise-sunset'){
    if(!instant(summary.events.sunrise)||!instant(summary.events.sunset)||!finite(daylight.durationHours)
      ||Math.abs((Date.parse(summary.events.sunset)-Date.parse(summary.events.sunrise))/3600000-daylight.durationHours)>1e-6)return fail()
  }else {
    if(daylight.status==='polar-night'?daylight.durationHours!==0:daylight.durationHours!==null)return fail()
    if(['polar-day','polar-night'].includes(String(daylight.status))&&(summary.events.sunrise!==null||summary.events.sunset!==null))return fail()
  }
  summary.phases.forEach((phase,index)=>{if(!object(phase)||typeof phase.name!=='string'||phase.thresholdDeg!==[-6,-12,-18,6][index]
    ||![phase.morning,phase.evening].every(event=>event===null||instant(event)))fail()})
  const pole=value.pole
  if((pole.heightM!==null&&(!finite(pole.heightM)||pole.heightM<=0||pole.heightM>1000))||!finite(pole.lowSunCutoffDeg)
    ||pole.lowSunCutoffDeg<0||pole.lowSunCutoffDeg>10||!Array.isArray(pole.path)||pole.path.length!==path.length)return fail()
  function shadow(item:unknown,point:SolarPosition) {
    if(!object(item)||!['unknown-height','night','low-sun','available'].includes(String(item.status))
      ||(item.status==='available'?(!finite(item.lengthM)||item.lengthM<0||!finite(item.bearingDeg)||item.bearingDeg<0||item.bearingDeg>=360)
        :item.lengthM!==null||item.bearingDeg!==null))return fail()
    const elevation=point.apparentElevationDeg
    const expected=pole.heightM===null?'unknown-height':elevation<=0?'night':elevation<Number(pole.lowSunCutoffDeg)?'low-sun':'available'
    if(item.status!==expected)return fail()
    if(item.status==='available'){
      const length=elevation===90?0:Number(pole.heightM)/Math.tan(elevation*Math.PI/180)
      if(Math.abs(Number(item.lengthM)-length)>Math.max(1e-8,length*1e-8)
        ||Math.abs(Number(item.bearingDeg)-(point.azimuthDeg+180)%360)>1e-8)return fail()
    }
  }
  shadow(pole.selected,selected)
  pole.path.forEach((item,index)=>shadow(item,path[index]))
}
export function parseSolar(value:unknown):SolarResult {
  if(!object(value)||typeof value.project_id!=='string'||!Number.isSafeInteger(value.version)||value.scope!=='site-solar-position-not-shading')
    throw new Error('Invalid site Solar response identity.')
  const result=value.result
  if(!object(result)||result.status!=='ok'||result.kind!=='solar-position'||!object(result.inputs)
    ||!object(result.output)||!position(result.output.selected)||!Array.isArray(result.output.path)||result.output.path.length<2
    ||!result.output.path.every(position)||!object(result.output.day)
    ||!object(result.engine)||!['name','version','method'].every(key=>typeof result.engine==='object'&&result.engine!==null&&typeof (result.engine as Record<string,unknown>)[key]==='string')
    ||!Array.isArray(result.assumptions)||!result.assumptions.every(v=>typeof v==='string'))
    throw new Error('Invalid pvlib solar response.')
  const day=result.output.day, path=result.output.path
  if(!instant(day.startUTC)||!instant(day.endUTC)||!finite(day.durationHours)||day.durationHours<20||day.durationHours>26
    ||!finite(day.sampleMinutes)||!Number.isInteger(day.sampleMinutes)||day.sampleMinutes<5||day.sampleMinutes>60
    ||day.sampleCount!==path.length||typeof day.sampling!=='string'
    ||path.length!==Math.ceil(day.durationHours*60/day.sampleMinutes)+1
    ||path[0].instantUTC!==day.startUTC||path[path.length-1].instantUTC!==day.endUTC
    ||path.some((point,index)=>index>0&&Date.parse(point.instantUTC)<=Date.parse(path[index-1].instantUTC))
    ||path.some(point=>Date.parse(point.instantUTC)!==Date.parse(point.localTime))
    ||Date.parse(result.output.selected.instantUTC)!==Date.parse(result.output.selected.localTime)
    ||path.some((point,index)=>index>0&&Date.parse(point.instantUTC)-Date.parse(path[index-1].instantUTC)>Number(day.sampleMinutes)*60000)
    ||Date.parse(result.output.selected.instantUTC)<Date.parse(day.startUTC)||Date.parse(result.output.selected.instantUTC)>=Date.parse(day.endUTC)
    ||Math.abs((Date.parse(day.endUTC)-Date.parse(day.startUTC))/3600000-day.durationHours)>1e-8)
    throw new Error('Invalid solar path time intervals.')
  if(result.output.charts!==undefined)parseCharts(result.output.charts,path,result.output.selected)
  return value as SolarResult
}
export async function calculateSolar(record:WorkspaceRecord,inputs:SolarInputs,csrf:string):Promise<SolarResult> {
  const result=parseSolar(await request(`/projects/${encodeURIComponent(record.project_id)}/workspace/solar`,'POST',
    {...inputs,expected_version:record.version},csrf))
  if(result.project_id!==record.project_id||result.version!==record.version)throw new Error('Stale Solar result. Reload and calculate again.')
  if(result.result.output.charts){
    const returned=result.result.inputs,charts=result.result.output.charts
    if(returned.date!==inputs.date||returned.localClock!==inputs.local_time||returned.occurrence!==inputs.occurrence
      ||returned.latitude!==record.document.site.latitude||returned.longitude!==record.document.site.longitude
      ||returned.timeZone!==record.document.site.time_zone||charts.annual.time!==inputs.local_time
      ||charts.pole.heightM!==(inputs.pole_height_m??null)||charts.pole.lowSunCutoffDeg!==(inputs.low_sun_cutoff_deg??1))
      throw new Error('Mismatched Solar calculation inputs. Calculate the current Site and drafts again.')
  }
  return result
}
