import type { PlannerApi } from '../domain/project/planner-api'
import type { NativeSolarSelection } from './analysis-solar'

export interface AnalysisController { dispose(): void }
type StudyMount = (document: Document, runtime: Window, planner: PlannerApi, options?: {
  navigate?: (route: string) => void
  sunPathSelectionsAvailable?: boolean
  getSolarSelection?: () => NativeSolarSelection
}) => AnalysisController | null
export interface AnalysisRuntime {
  HomePlannerLightUI: { mount: StudyMount }
  HomePlannerAirflowUI: { mount: StudyMount }
  HomePlannerCFDUI: { mount: StudyMount }
  HomePlannerReducedUI: {
    mount(host: HTMLElement, planner: PlannerApi, kind: 'pressure' | 'thermal', runtime: Window): AnalysisController
  }
}

// Dependencies are incumbent classic modules, not another model or solver.
export const analysisScripts = [
  ['vendor/suncalc-2.0.1.js', 'SunCalc'], ['sun-model.js', 'HomeSun'],
  ['building-physics.js', 'BuildingPhysics'], ['environment-data.js', 'EnvironmentData'],
  ['environment-ui.js', 'EnvironmentUI'],
  ['planner-light.js', 'HomePlannerLight'], ['planner-light-runner.js', 'HomePlannerLightRunner'],
  ['planner-light-display.js', 'HomePlannerLightDisplay'], ['planner-light-ui.js', 'HomePlannerLightUI'],
  ['planner-airflow-field.js', 'HomePlannerAirflowField'], ['planner-airflow.js', 'HomePlannerAirflow'],
  ['planner-airflow-runner.js', 'HomePlannerAirflowRunner'], ['planner-airflow-display.js', 'HomePlannerAirflowDisplay'],
  ['planner-airflow-inputs.js', 'HomePlannerAirflowInputs'], ['planner-airflow-ui.js', 'HomePlannerAirflowUI'],
  ['planner-cfd.js', 'HomePlannerCFD'], ['planner-cfd-ui.js', 'HomePlannerCFDUI'],
  ['planner-reduced-ui.js', 'HomePlannerReducedUI'],
] as const
const styles = ['planner-light-ui.css', 'planner-airflow-ui.css', 'planner-cfd-ui.css', 'environment-ui.css']
let loading: Promise<AnalysisRuntime> | undefined

export function loadAnalysisRuntime(): Promise<AnalysisRuntime> {
  if (loading) return loading
  loading = (async () => {
    const base = new URL(`${import.meta.env.BASE_URL}classic/`, document.baseURI)
    const globals = window as unknown as Record<string, unknown>
    // The supplied planner is created by Design; never instantiate a second bridge.
    for (const dependency of ['HomePlannerModel', 'HomePlannerProjection', 'HomePlannerRegions', 'HomePlannerDrafts'])
      if (!globals[dependency]) throw new Error('Open Design first so its shared project runtime is available.')
    for (const file of styles) {
      if (document.querySelector(`link[data-analysis-style="${file}"]`)) continue
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = new URL(file, base).href
      link.dataset.analysisStyle = file; document.head.append(link)
    }
    for (const [file, global] of analysisScripts) {
      if (globals[global]) continue
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = new URL(file, base).href
        script.setAttribute('data-homeplanner-manual', '')
        script.onload = () => globals[global] ? resolve() : reject(new Error(`${file} did not register its analysis adapter.`))
        script.onerror = () => { script.remove(); reject(new Error(`Local analysis asset ${file} is unavailable. Current Design edits are unchanged.`)) }
        document.head.append(script)
      })
    }
    return window as unknown as AnalysisRuntime
  })().catch(error => { loading = undefined; throw error })
  return loading
}
