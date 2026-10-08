import { request } from './api'

export const MAX_WEATHER_BYTES=6*1024*1024
export type WindOwner={project_id:string;version:number}
export type WindInputs={
  format:'epw'|'json';text:string;calm_threshold_mps:number;months:number[]
  daytime:'all'|'day'|'night';day_start_hour:number;day_end_hour:number;clock:'source'|'site'
}
export type WindBin={directionDeg:number;count:number;meanSpeedMps:number|null}
export type WeatherRow={
  timestamp:string;durationSeconds:number;windSpeedMps:number|null;windFromDeg:number|null
  temperatureC:number|null;rhPct:number|null;pressurePa:number|null;dniWm2:number|null;dhiWm2:number|null;ghiWm2:number|null
  missing:string[]
}
export type WindResult={
  project_id:string;version:number;scope:'imported-weather-not-ventilation'
  result:{
    status:'ok'|'empty-filter'|'missing-wind';kind:'weather-wind-rose';inputFingerprint:string
    method:{name:string;version:string;implementation:string;reference:string}
    weather:{
      kind:string;source:Record<string,unknown>;latitude:number|null;longitude:number|null;timeZoneOffsetHours?:number
      timestampMeaning:string;units:Record<string,string>;warnings:string[]
      coverage:{startUTC:string;endUTC:string;recordCount:number;intervalHours:number;gaps:number;overlaps:number;duplicates:number;chronological:boolean}
    }
    rose:{
      bins:WindBin[];calmCount:number;missingCount:number;total:number;excludedCount:number;unknownTimeCount:number;calmThresholdMps:number
      directionConvention:string;frequencyBasis:string;timeBasis:string
      daytimeDefinition:{mode:string;startHour:number;endHour:number;meaning:string}
      speedStatistics:{validSpeedCount:number;meanSpeedMps:number|null;maxSpeedMps:number|null;basis:string}
    }
    preview:WeatherRow[];previewCount:number;selectedRecordCount:number;limitations:string[]
  }
}
function object(value:unknown):value is Record<string,unknown> {return !!value&&typeof value==='object'&&!Array.isArray(value)}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const count=(value:unknown):value is number=>finite(value)&&Number.isSafeInteger(value)&&value>=0
const text=(value:unknown):value is string=>typeof value==='string'
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(text)
const date=(value:unknown)=>text(value)&&value.endsWith('Z')&&Number.isFinite(Date.parse(value))
const speed=(value:unknown)=>value===null||(finite(value)&&value>=0&&value<=150)
function row(value:unknown) {
  return object(value)&&date(value.timestamp)&&finite(value.durationSeconds)&&value.durationSeconds>0&&value.durationSeconds<=86400
    &&speed(value.windSpeedMps)&&(value.windFromDeg===null||(finite(value.windFromDeg)&&value.windFromDeg>=0&&value.windFromDeg<360))
    &&['temperatureC','rhPct','pressurePa','dniWm2','dhiWm2','ghiWm2'].every(key=>value[key]===null||finite(value[key]))
    &&strings(value.missing)
}
export function parseWind(value:unknown):WindResult {
  const fail=()=>{throw new Error('Invalid weather/wind response.')}
  if(!object(value)||!text(value.project_id)||!count(value.version)||value.scope!=='imported-weather-not-ventilation')return fail()
  const result=value.result
  if(!object(result)||!['ok','empty-filter','missing-wind'].includes(String(result.status))
    ||result.kind!=='weather-wind-rose'||!text(result.inputFingerprint)||!/^[a-f0-9]{64}$/.test(result.inputFingerprint)
    ||!object(result.method)||!['name','version','implementation','reference'].every(key=>text((result.method as Record<string,unknown>)[key]))
    ||!object(result.weather)||!object(result.rose)||!strings(result.limitations))return fail()
  const {weather,rose}=result,coverage=weather.coverage
  if(!object(coverage)||!date(coverage.startUTC)||!date(coverage.endUTC)||!count(coverage.recordCount)||coverage.recordCount===0
    ||!finite(coverage.intervalHours)||coverage.intervalHours<=0||!['gaps','overlaps','duplicates'].every(key=>count(coverage[key]))
    ||typeof coverage.chronological!=='boolean'||!text(weather.kind)||!object(weather.source)
    ||!['latitude','longitude'].every(key=>weather[key]===null||finite(weather[key]))
    ||!text(weather.timestampMeaning)||!object(weather.units)||!strings(weather.warnings))return fail()
  if(!['total','calmCount','missingCount','excludedCount','unknownTimeCount'].every(key=>count(rose[key]))
    ||!finite(rose.calmThresholdMps)||rose.calmThresholdMps<0||rose.calmThresholdMps>150
    ||!['directionConvention','frequencyBasis','timeBasis'].every(key=>text(rose[key]))
    ||!object(rose.daytimeDefinition)||!['mode','meaning'].every(key=>text((rose.daytimeDefinition as Record<string,unknown>)[key]))
    ||!finite(rose.daytimeDefinition.startHour)||!finite(rose.daytimeDefinition.endHour)
    ||!Array.isArray(rose.bins)||rose.bins.length!==16||!rose.bins.every((bin,index)=>object(bin)&&bin.directionDeg===index*22.5
      &&count(bin.count)&&speed(bin.meanSpeedMps)&&(bin.count===0?bin.meanSpeedMps===null:bin.meanSpeedMps!==null))
    ||!object(rose.speedStatistics)||!count(rose.speedStatistics.validSpeedCount)||!speed(rose.speedStatistics.meanSpeedMps)
    ||!speed(rose.speedStatistics.maxSpeedMps)||!text(rose.speedStatistics.basis))return fail()
  const total=Number(rose.total),missing=Number(rose.missingCount),calm=Number(rose.calmCount)
  if(rose.bins.reduce((sum,bin)=>sum+Number(bin.count),0)+calm+missing!==total
    ||total+Number(rose.excludedCount)!==coverage.recordCount||rose.unknownTimeCount!==0
    ||rose.speedStatistics.validSpeedCount>total||result.selectedRecordCount!==total
    ||result.previewCount!==Math.min(total,100)||!Array.isArray(result.preview)||result.preview.length!==result.previewCount||!result.preview.every(row)
    ||(total===0?result.status!=='empty-filter':missing===total?result.status!=='missing-wind':result.status!=='ok'))return fail()
  return value as WindResult
}
export async function calculateWind(owner:WindOwner,inputs:WindInputs,csrf:string) {
  const result=parseWind(await request(`/projects/${encodeURIComponent(owner.project_id)}/workspace/wind`,'POST',
    {...inputs,expected_version:owner.version},csrf))
  if(result.project_id!==owner.project_id||result.version!==owner.version)throw new Error('Stale Wind result. Reload and calculate again.')
  return result
}
