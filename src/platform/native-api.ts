import { request } from './api'
import { parseMaterials, type MaterialsDocument } from './materials-api'

export type Obstacle = {
  id: string; kind: 'cuboid' | 'tree'; name: string; x: number; y: number
  width_m: number; depth_m: number; height_m: number | null; base_m: number | null; transmission: number | null
}
export type Site = {
  width: number | null; depth: number | null; units: 'm' | 'ft'
  facing: 'N' | 'E' | 'S' | 'W' | 'NE' | 'SE' | 'SW' | 'NW'
  roads: Record<'N' | 'E' | 'S' | 'W', number | null>
  road_units: Record<'N' | 'E' | 'S' | 'W', 'm' | 'ft'>
  category: 'A' | 'B'; use: 'res' | 'apt' | 'com'; height_m: number | null
  floor_height_m: number | null; floors: number | null; stilt: boolean
  tdr: boolean; compounding: boolean; custom_setbacks: boolean
  setback_front_m: number | null; setback_rear_m: number | null
  setback_left_m: number | null; setback_right_m: number | null
  split_edge: 'N'|'E'|'S'|'W'|null; split_fraction: number|null
  latitude: number | null; longitude: number | null; time_zone: string | null
  location_source: 'unknown' | 'manual' | 'device'; location_accuracy_m: number | null
  weather_source: 'location' | 'manual'; obstacles: Obstacle[]
}
export type Costs = {
  land_inr_m2: number | null; construction_inr_m2: number | null; stilt_inr_m2: number | null
  land_sro_inr_m2: number | null; registration_percent: number | null; gst_percent: number | null
  estimate_scope: 'partial'|'legacy-schedule'; flat_sro_inr_m2: number|null
  lrs_mode: 'na'|'paid'|'due'|null; lrs_rebate: boolean|null
  brs_mode: 'na'|'paid'|'dev'|'unauth'|null; brs_violated_m2: number|null
  stilt_rate_mode: 'explicit'|'legacy-55-percent'
}
export type WorkspaceRecord = {
  project_id: string; version: number; can_undo: boolean; can_redo: boolean
  document: { schema_version: 1; site: Site; costs: Costs; materials:MaterialsDocument }
}
export type Rect = { x: number; y: number; width: number; depth: number }
export type EvaluationPart = {
  status: 'computed' | 'prerequisites' | 'infeasible'; messages: string[]
  [key: string]: unknown
}
export type Evaluation = {
  project_id: string; version: number; feasibility: EvaluationPart; costs: EvaluationPart; utilization: EvaluationPart
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native workspace response.')
  return value as Record<string, unknown>
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function nullable(value: unknown) { return value === null || finite(value) }
function text(value: unknown): value is string { return typeof value === 'string' }
export function parseWorkspace(value: unknown): WorkspaceRecord {
  const row = object(value), doc = object(row.document), site = object(doc.site), costs = object(doc.costs)
  const materials=parseMaterials(doc.materials)
  const roads = object(site.roads)
  const roadUnits = object(site.road_units)
  if (!text(row.project_id) || !Number.isSafeInteger(row.version) || Number(row.version) < 0
    || typeof row.can_undo !== 'boolean' || typeof row.can_redo !== 'boolean' || doc.schema_version !== 1
    || !['m', 'ft'].includes(String(site.units)) || !['N','E','S','W','NE','SE','SW','NW'].includes(String(site.facing))
    || !['A','B'].includes(String(site.category)) || !['res','apt','com'].includes(String(site.use))
    || typeof site.stilt !== 'boolean' || !['unknown','manual','device'].includes(String(site.location_source))
    || !['location','manual'].includes(String(site.weather_source)) || !(site.time_zone === null || text(site.time_zone))
    || !['width','depth','height_m','floor_height_m','floors','latitude','longitude','location_accuracy_m'].every(key => nullable(site[key]))
    || !['N','E','S','W'].every(key => nullable(roads[key])) || !Array.isArray(site.obstacles)
    || !['N','E','S','W'].every(key => ['m','ft'].includes(String(roadUnits[key])))
    || !['tdr','compounding','custom_setbacks'].every(key=>typeof site[key]==='boolean')
    || !['setback_front_m','setback_rear_m','setback_left_m','setback_right_m','split_fraction'].every(key=>nullable(site[key]))
    || !(site.split_edge===null||['N','E','S','W'].includes(String(site.split_edge)))
    || !['partial','legacy-schedule'].includes(String(costs.estimate_scope))
    || !['explicit','legacy-55-percent'].includes(String(costs.stilt_rate_mode))
    || !(costs.lrs_mode===null||['na','paid','due'].includes(String(costs.lrs_mode)))
    || !(costs.brs_mode===null||['na','paid','dev','unauth'].includes(String(costs.brs_mode)))
    || !(costs.lrs_rebate===null||typeof costs.lrs_rebate==='boolean')
    || !['flat_sro_inr_m2','brs_violated_m2'].every(key=>nullable(costs[key]))
    || !['land_inr_m2','construction_inr_m2','stilt_inr_m2','land_sro_inr_m2','registration_percent','gst_percent'].every(key => nullable(costs[key]))) {
    throw new Error('Invalid native workspace response.')
  }
  for (const item of site.obstacles) {
    const obstacle = object(item)
    if (!text(obstacle.id) || !text(obstacle.name) || !['cuboid','tree'].includes(String(obstacle.kind))
      || !['x','y','width_m','depth_m'].every(key => finite(obstacle[key]))
      || !['height_m','base_m','transmission'].every(key => nullable(obstacle[key]))) throw new Error('Invalid obstacle response.')
  }
  return {...row,document:{...doc,materials}} as WorkspaceRecord
}
function parsePart(value: unknown): EvaluationPart {
  const part = object(value)
  if (!['computed','prerequisites','infeasible'].includes(String(part.status))
    || !Array.isArray(part.messages) || !part.messages.every(text)) throw new Error('Invalid Python evaluation response.')
  return part as EvaluationPart
}
export function rect(value: unknown): Rect | null {
  if (value === undefined) return null
  const data = object(value)
  if (!['x','y','width','depth'].every(key => finite(data[key]))) throw new Error('Invalid site geometry response.')
  return data as Rect
}
const path = (id: string) => `/projects/${encodeURIComponent(id)}/workspace`
export const nativeApi = {
  plotOptions: async (id:string,inputs:Partial<Site>,csrf:string):Promise<{heights:number[];max_floors:number|null;message:string}> => {
    const data=object(await request(path(id)+'/plot-options','POST',{inputs},csrf))
    if(!Array.isArray(data.heights)||!data.heights.every(finite)||!nullable(data.max_floors)||!text(data.message))throw new Error('Invalid plot options.')
    return {heights:data.heights,max_floors:data.max_floors as number|null,message:data.message}
  },
  get: async (id: string) => parseWorkspace(await request(path(id))),
  command: async (record: WorkspaceRecord, action: 'site' | 'costs' | 'materials' | 'undo' | 'redo', value: Partial<Site> | Costs | MaterialsDocument | null, csrf: string) =>
    parseWorkspace(await request(path(record.project_id) + '/commands', 'POST', { expected_version: record.version, action, value }, csrf)),
  evaluate: async (id: string): Promise<Evaluation> => {
    const data = object(await request(path(id) + '/evaluation'))
    if (!text(data.project_id) || !Number.isSafeInteger(data.version)) throw new Error('Invalid evaluation identity.')
    return { project_id: data.project_id, version: Number(data.version), feasibility: parsePart(data.feasibility),
      costs: parsePart(data.costs), utilization: parsePart(data.utilization) }
  },
  options: async (): Promise<{time_zones: string[]; time_zone_labels: Record<string,string>; sources: {title: string; url: string}[]}> => {
    const data = object(await request('/site/options'))
    if (!Array.isArray(data.time_zones) || !data.time_zones.every(text) || !Array.isArray(data.sources)) throw new Error('Invalid site options.')
    const sources = data.sources.map(value => {
      const entry = object(value)
      if (!text(entry.title) || !text(entry.url) || !entry.url.startsWith('https://')) throw new Error('Invalid source.')
      return { title: entry.title, url: entry.url }
    })
    const labels=object(data.time_zone_labels)
    if(!data.time_zones.every(zone=>text(labels[zone])))throw new Error('Invalid time-zone offset labels.')
    return {time_zones: data.time_zones, time_zone_labels: labels as Record<string,string>, sources}
  },
  weather: async (record: WorkspaceRecord, csrf: string) => {
    const data = object(await request(path(record.project_id)+'/weather','POST',
      {inputs:{expected_version:record.version,acknowledgeOpenMeteo:true}},csrf))
    if(data.project_id!==record.project_id||data.version!==record.version) throw new Error('Stale weather result.')
    const result = object(data.result)
    object(result.weather)
    return result
  },
}
