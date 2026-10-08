import { loadDesignRuntime } from './design-runtime'
import { scripts, styles } from './design-discipline-scope'

export interface IncumbentController {
  dispose?(): void
  destroy?(): void
  getState?(): { selectedId?: string }
  setSettings?(settings: Record<string, unknown>): void
}
export interface DisciplineRuntime extends Window {
  HomePlannerStructureUI: { mount(document: Document): IncumbentController | null }
  HomePlannerServicesUI: { mount(document: Document): IncumbentController | null }
  HomePlannerDrainageUI: { mount(document: Document): IncumbentController | null }
  HomePlannerElevationUI: { mount(document: Document): IncumbentController | null }
  HomePlannerFacadeUI: { mount(document: Document): IncumbentController | null }
  HomePlannerDrawingUI: { mount(document: Document): IncumbentController | null }
  HomePlannerElectrical: { mount(host: HTMLElement, planner: unknown, model: unknown): IncumbentController }
  HomePlannerModel: unknown
}
let pending: Promise<DisciplineRuntime> | undefined

export function loadDisciplineRuntime() {
  if (pending) return pending
  pending = (async () => {
    await loadDesignRuntime()
    const base = new URL(`${import.meta.env.BASE_URL}classic/`, document.baseURI)
    for (const name of styles) {
      if (document.querySelector(`link[data-design-discipline="${name}"]`)) continue
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = new URL(`${name}.css`, base).href
      link.dataset.designDiscipline = name; document.head.append(link)
    }
    // The existing pinned offline encoder, not a second drawing/export engine.
    for (const name of ['vendor/pdf/pdf-lib-1.17.1.min', ...scripts]) {
      if (document.querySelector(`script[data-design-discipline="${name}"][data-loaded]`)) continue
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = new URL(`${name}.js`, base).href
        script.dataset.designDiscipline = name
        script.setAttribute('data-homeplanner-manual', '')
        script.onload = () => { script.dataset.loaded = ''; resolve() }
        script.onerror = () => { script.remove(); reject(new Error(`Design asset unavailable: ${name}.js. Retry after restoring local assets.`)) }
        document.head.append(script)
      })
    }
    const runtime = window as unknown as DisciplineRuntime
    for (const key of ['HomePlannerStructureUI', 'HomePlannerServicesUI', 'HomePlannerDrainageUI',
      'HomePlannerElevationUI', 'HomePlannerFacadeUI', 'HomePlannerDrawingUI', 'HomePlannerElectrical'] as const) {
      if (typeof runtime[key]?.mount !== 'function')
        throw new Error(`${key} is unavailable. Check the classic asset allowlist and retry.`)
    }
    return runtime
  })().catch(error => {
    pending = undefined
    document.querySelectorAll('script[data-design-discipline]').forEach(script => script.remove())
    throw error
  })
  return pending
}
