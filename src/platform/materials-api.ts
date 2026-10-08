import { request } from './api'

export type MaterialLayer = {
  id:string; label:string; source:string; condition:string
  thicknessM:number|null; conductivityW_MK:number|null; densityKgM3:number|null; specificHeatJ_KgK:number|null
}
export type MaterialsDocument = {
  version:1; layers:MaterialLayer[]
  films:{inside:number|null;outside:number|null;source:string}
  comparisonThicknessM:number|null
  glazing:{uValueW_M2K:number|null;shgc:number|null;vlt:number|null;source:string}
}
export type MaterialPreset = MaterialLayer & {url:string}
export type AssemblyOutput = {resistanceM2K_W:number;uValueW_M2K:number;arealHeatCapacityJ_M2K:number}
export type AssemblyResult = {status:'computed'|'prerequisites';messages:string[];output:AssemblyOutput|null}
export type MaterialsResult = {
  project_id:string;version:number;scope:'assembly-descriptors-not-zone-simulation';presets:MaterialPreset[]
  result:{method:string;input_fingerprint:string;inputs:MaterialsDocument
    units:Record<keyof AssemblyOutput,string>;selected:AssemblyResult
    comparisons:(AssemblyResult & {id:string;label:string;source:string;url:string;thicknessM:number|null})[]
    glazing:{status:'supplied'|'prerequisites';messages:string[];inputs:MaterialsDocument['glazing']}
    warnings:string[]}
}
export const materialNumbers=['thicknessM','conductivityW_MK','densityKgM3','specificHeatJ_KgK'] as const
export function emptyMaterials():MaterialsDocument {
  return {version:1,layers:[],films:{inside:null,outside:null,source:''},comparisonThicknessM:null,
    glazing:{uValueW_M2K:null,shgc:null,vlt:null,source:''}}
}
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid materials response.')
  return value as Record<string,unknown>
}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const nullable=(value:unknown,min:number,includeMin=false,max=Infinity)=>value===null||
  (finite(value)&&(includeMin?value>=min:value>min)&&value<=max)
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(v=>typeof v==='string')
function layer(value:unknown):MaterialLayer {
  const row=object(value)
  if(typeof row.id!=='string'||!row.id.trim()||!['label','source','condition'].every(k=>typeof row[k]==='string')
    ||!materialNumbers.every(k=>nullable(row[k],0)))throw new Error('Invalid material layer.')
  return row as MaterialLayer
}
export function parseMaterials(value:unknown):MaterialsDocument {
  if(value===undefined)return emptyMaterials()
  const row=object(value),films=object(row.films),glazing=object(row.glazing)
  if(row.version!==1||!Array.isArray(row.layers)||!nullable(row.comparisonThicknessM,0)
    ||!['inside','outside'].every(k=>nullable(films[k],0,true))||typeof films.source!=='string'
    ||!nullable(glazing.uValueW_M2K,0)||!['shgc','vlt'].every(k=>nullable(glazing[k],0,true,1))
    ||typeof glazing.source!=='string')throw new Error('Invalid materials document.')
  const layers=row.layers.map(layer)
  if(new Set(layers.map(l=>l.id)).size!==layers.length)throw new Error('Duplicate material layer identities.')
  return {...row,layers} as MaterialsDocument
}
function parsePresets(value:unknown):MaterialPreset[] {
  if(!Array.isArray(value))throw new Error('Invalid materials examples.')
  return value.map(value=>{
    const row=object(value)
    if(typeof row.url!=='string'||!row.url.startsWith('https://'))throw new Error('Invalid example source.')
    return {...layer(row),url:row.url}
  })
}
function assembly(value:unknown):AssemblyResult {
  const row=object(value)
  if(!strings(row.messages))throw new Error('Invalid assembly messages.')
  if(row.status==='prerequisites'&&row.output===null)return row as AssemblyResult
  const output=object(row.output)
  if(row.status!=='computed'||!['resistanceM2K_W','uValueW_M2K','arealHeatCapacityJ_M2K']
    .every(k=>finite(output[k])&&Number(output[k])>0))throw new Error('Invalid assembly output.')
  return row as AssemblyResult
}
export function parseMaterialsResult(value:unknown):MaterialsResult {
  const row=object(value),result=object(row.result),glazing=object(result.glazing),units=object(result.units)
  if(typeof row.project_id!=='string'||!Number.isSafeInteger(row.version)||Number(row.version)<0
    ||row.scope!=='assembly-descriptors-not-zone-simulation'||typeof result.method!=='string'
    ||typeof result.input_fingerprint!=='string'||!Array.isArray(result.comparisons)||!strings(result.warnings)
    ||!['supplied','prerequisites'].includes(String(glazing.status))||!strings(glazing.messages)
    ||!['resistanceM2K_W','uValueW_M2K','arealHeatCapacityJ_M2K'].every(k=>typeof units[k]==='string'))
    throw new Error('Invalid materials calculation response.')
  parseMaterials(result.inputs)
  parseMaterials({ ...emptyMaterials(),glazing:glazing.inputs })
  assembly(result.selected)
  for(const comparison of result.comparisons) {
    const c=object(comparison)
    if(!['id','label','source','url'].every(k=>typeof c[k]==='string')||!String(c.url).startsWith('https://')
      ||!nullable(c.thicknessM,0))throw new Error('Invalid materials comparison.')
    assembly(c)
  }
  return {...row,presets:parsePresets(row.presets)} as MaterialsResult
}
const path=(id:string)=>`/projects/${encodeURIComponent(id)}/workspace`
export async function materialOptions(id:string):Promise<MaterialPreset[]> {
  return parsePresets(object(await request(path(id)+'/materials-options')).presets)
}
export async function evaluateMaterials(record:{project_id:string;version:number},csrf:string):Promise<MaterialsResult> {
  return parseMaterialsResult(await request(path(record.project_id)+'/materials','POST',{expected_version:record.version},csrf))
}
