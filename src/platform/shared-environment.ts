import type { PlannerApi } from '../domain/project/planner-api'
import type { JsonObject, PlannerCommand } from '../domain/project/types'
import type { MaterialsDocument } from './materials-api'

type WeatherParser={
  parseEPW(text:string):JsonObject
  parseWeatherJSON(text:string):JsonObject
}
let pending:Promise<WeatherParser>|undefined
async function weatherParser():Promise<WeatherParser> {
  const globals=window as Window & {EnvironmentData?:WeatherParser}
  if(globals.EnvironmentData)return globals.EnvironmentData
  if(!pending)pending=new Promise<WeatherParser>((resolve,reject)=>{
    const script=document.createElement('script')
    script.src=new URL(`${import.meta.env.BASE_URL}classic/environment-data.js`,document.baseURI).href
    script.onload=()=>globals.EnvironmentData?resolve(globals.EnvironmentData):reject(new Error('The shared weather parser did not initialize.'))
    script.onerror=()=>{script.remove();reject(new Error('The shared weather parser could not load. Imported text was retained.'))}
    document.head.append(script)
  }).catch(error=>{pending=undefined;throw error})
  return pending
}

export function sharedMaterialsCommand(value:MaterialsDocument):PlannerCommand {
  return {type:'set-environment',patch:{schemaVersion:1,
    materials:{layers:value.layers.map(layer=>({...layer})),films:{...value.films},
      comparisonThicknessM:value.comparisonThicknessM,basis:'Applied account Materials; not assigned thermal zones'},
    glazing:{...value.glazing}}}
}

export async function sharedWeatherCommand(planner:Pick<PlannerApi,'exportProject'>,format:'epw'|'json',text:string):Promise<PlannerCommand> {
  if(!text.trim())throw new Error('Choose a weather file first. No shared weather was changed.')
  const captured=planner.exportProject()
  const parser=await weatherParser()
  const weather=format==='epw'?parser.parseEPW(text):parser.parseWeatherJSON(text)
  if(planner.exportProject()!==captured)throw new Error('Design changed while preparing weather. Current inputs were kept; try again.')
  return {type:'set-environment',patch:{schemaVersion:1,weather}}
}
