import type { PlannerApi } from '../domain/project/planner-api'
import type { NativeDesignSiteSource } from './design-site-adapter'

export type DesignDocument = Record<string, unknown>
export interface DesignMount {
  planner: PlannerApi
  getContext(): unknown
  render(): void
  applySite(source: NativeDesignSiteSource): void
  destroy(): void
}
interface ClassicRuntime {
  Editor: { init(planner: PlannerApi, document: Document, model: unknown): {
    destroy(): void; getPendingDrafts(): readonly unknown[]
    getActionState(): { canDelete: boolean }
    requestDeleteSelection(): unknown
  } }
  Model: { parseProject(text: string): DesignDocument }
  Design: { mount(svg: SVGSVGElement, controls: HTMLElement, project: DesignDocument | null, dependencies: Record<string, unknown>): DesignMount }
  Three: { mount(host: HTMLElement, planner: PlannerApi, model: unknown, options?: Record<string, unknown>): { destroy(): void } }
  Bridge: unknown
  Generator: unknown
  RoomInputs: { releaseBindings(document: Document): boolean }
  Controls: { settings: string; palette: string }
  Regions: unknown
  Layout: unknown
}
type Globals = Window & {
  HomePlannerModel: ClassicRuntime['Model']
  HomePlannerDesignRuntime: ClassicRuntime['Design']
  HomePlanner3D: ClassicRuntime['Three']
  HomePlannerBridge: unknown
  HomePlannerRegions: unknown
  HomePlannerLayoutRuntime: unknown
  HomePlannerEditor: ClassicRuntime['Editor']
  HomePlannerLayoutGenerator: unknown
  HomePlannerRoomInputs: ClassicRuntime['RoomInputs']
  HomePlannerDesignControls: ClassicRuntime['Controls']
}
let loading: Promise<ClassicRuntime> | undefined
const base = new URL(`${import.meta.env.BASE_URL}classic/`, window.document.baseURI)

export function loadDesignRuntime(): Promise<ClassicRuntime> {
  if (loading) return loading
  loading = (async () => {
    if (!document.getElementById('native-design-importmap')) {
      const map = document.createElement('script')
      map.id = 'native-design-importmap'; map.type = 'importmap'
      map.textContent = JSON.stringify({ imports: { three: new URL('vendor/three/three.module.min.js', base).href } })
      document.head.append(map)
    }
    if (!document.getElementById('native-design-three-style')) {
      const style = document.createElement('link')
      style.id = 'native-design-three-style'; style.rel = 'stylesheet'
      style.href = new URL('planner-3d.css', base).href; document.head.append(style)
      const editorStyle = window.document.createElement('link')
      editorStyle.rel = 'stylesheet'; editorStyle.href = new URL('planner-editor.css', base).href
      window.document.head.append(editorStyle)
    }
    for (const name of ['planner-features', 'planner-drafts', 'planner-regions', 'planner-model', 'planner-projection',
      'planner-room-inputs', 'planner-bridge', 'planner-layout-generator', 'planner-layout-runtime',
      'planner-design-controls', 'planner-design-runtime', 'planner-editor', 'planner-3d']) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = new URL(`${name}.js`, base).href
        script.setAttribute('data-homeplanner-manual', '')
        script.onload = () => resolve()
        script.onerror = () => { script.remove(); reject(new Error(`The existing Design runtime could not load (${name}). Reload with all local assets present.`)) }
        document.head.append(script)
      })
    }
    const globals = window as unknown as Globals
    return { Generator: globals.HomePlannerLayoutGenerator, RoomInputs: globals.HomePlannerRoomInputs,
      Controls: globals.HomePlannerDesignControls, Editor: globals.HomePlannerEditor, Model: globals.HomePlannerModel, Design: globals.HomePlannerDesignRuntime,
      Three: globals.HomePlanner3D, Bridge: globals.HomePlannerBridge,
      Regions: globals.HomePlannerRegions, Layout: globals.HomePlannerLayoutRuntime }
  })().catch(error => { loading = undefined; throw error })
  return loading
}
