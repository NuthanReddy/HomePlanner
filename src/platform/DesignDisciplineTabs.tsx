import { useEffect, useRef, useState } from 'react'
import type { PlannerApi } from '../domain/project/planner-api'
import { scopedDocument } from './design-discipline-scope'
import { loadDisciplineRuntime, type IncumbentController } from './design-disciplines-runtime'
import './design-disciplines.css'
import { ReviewWorkbench } from './ReviewWorkbench'

export interface DesignDisciplineTabsProps {
  planner: PlannerApi | null
  activeTab: string
  onNavigate?: (tab: string) => void
}
const tabs = ['structure', 'elevations', 'plumbing', 'drainage', 'electrical', 'review']
const drawings: Record<string, string> = {
  structure: 'structural', elevations: 'views', plumbing: 'plumbing', drainage: 'drainage',
}

// Keep mounted across routes: incumbent forms own draft parking and shared Undo.
export function DesignDisciplineTabs({ planner, activeTab, onNavigate }: DesignDisciplineTabsProps) {
  const host = useRef<HTMLDivElement>(null)
  const drawingHost = useRef<HTMLDivElement>(null)
  const mounted = useRef<Record<string, IncumbentController[]>>({})
  const drawing = useRef<IncumbentController | null>(null)
  const navigate = useRef(onNavigate); navigate.current = onNavigate
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof loadDisciplineRuntime>> | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [, update] = useState(0)
  useEffect(() => {
    if (!planner) return
    let active = true
    setError('')
    loadDisciplineRuntime().then(value => { if (active) setRuntime(value) })
      .catch(cause => { if (active) setError(String(cause.message || cause)) })
    return () => { active = false }
  }, [planner, attempt])

  useEffect(() => {
    if (!planner) return
    const unsubscribe = planner.subscribe(() => update(value => value + 1))
    return unsubscribe
  }, [planner])

  useEffect(() => {
    return () => {
      Object.values(mounted.current).flat().forEach(controller => {
        if (controller.dispose) controller.dispose(); else controller.destroy?.()
      })
      mounted.current = {}
      drawing.current?.dispose?.(); drawing.current = null
      host.current?.replaceChildren()
      drawingHost.current?.replaceChildren()
    }
  }, [planner])

  useEffect(() => {
    if (!planner || !runtime || !host.current || !tabs.includes(activeTab)) return
    const root = host.current
    let created: HTMLElement | undefined
    try {
      if (!mounted.current[activeTab]) {
        const panel = document.createElement('section')
        created = panel
        panel.dataset.discipline = activeTab
        root.append(panel)
        const add = (id: string, mount: (doc: Document) => IncumbentController | null) => {
          const section = document.createElement('section'); section.id = id; panel.append(section)
          const controller = mount(scopedDocument(section, planner, runtime))
          if (!controller) throw new Error(`${activeTab} workbench could not mount.`)
          mounted.current[activeTab].push(controller)
        }
        mounted.current[activeTab] = []
        if (activeTab === 'structure') add('workspaceStructure', doc => runtime.HomePlannerStructureUI.mount(doc))
        if (activeTab === 'plumbing') add('workspacePlumbing', doc => runtime.HomePlannerServicesUI.mount(doc))
        if (activeTab === 'drainage') add('workspaceDrainage', doc => runtime.HomePlannerDrainageUI.mount(doc))
        if (activeTab === 'elevations') {
          add('workspaceViews', doc => runtime.HomePlannerElevationUI.mount(doc))
          add('workspaceFacades', doc => runtime.HomePlannerFacadeUI.mount(doc))
        }
        if (activeTab === 'electrical')
          mounted.current[activeTab].push(runtime.HomePlannerElectrical.mount(panel, planner, runtime.HomePlannerModel))
      }
      root.querySelectorAll<HTMLElement>('[data-discipline]').forEach(panel => {
        panel.hidden = panel.dataset.discipline !== activeTab
      })
      if (drawings[activeTab] && drawingHost.current) {
        if (!drawing.current) {
          drawingHost.current.id = 'workspaceDrawings'
          drawing.current = runtime.HomePlannerDrawingUI.mount(scopedDocument(drawingHost.current, planner, runtime))
          if (!drawing.current) throw new Error('Source drawing exports could not mount.')
          const selector = drawingHost.current.querySelector<HTMLSelectElement>('#hp-drawing-discipline')
          if (selector) selector.closest('label')!.hidden = true
        }
        const selectedId = mounted.current.elevations?.[0]?.getState?.().selectedId
        drawing.current.setSettings?.({
          discipline: drawings[activeTab],
          ...(activeTab === 'elevations' && selectedId ? { viewId: selectedId } : {}),
        })
      }
      setError('')
    } catch (cause) {
      if (created) {
        mounted.current[activeTab]?.forEach(controller => {
          if (controller.dispose) controller.dispose(); else controller.destroy?.()
        })
        delete mounted.current[activeTab]
        created.remove()
      }
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [planner, runtime, activeTab, attempt])

  const project = planner?.getProject()
  const floor = project?.floors.find(item => item.id === project.activeFloorId)
  function follow(event: React.MouseEvent) {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-workspace]')
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (link.dataset.workspace === 'design') navigate.current?.(link.dataset.section || 'layout')
    else if (link.dataset.workspace === 'report') {
      const selectedId = mounted.current.elevations?.[0]?.getState?.().selectedId
      if (activeTab === 'elevations' && selectedId) drawing.current?.setSettings?.({ viewId: selectedId })
      const details = drawingHost.current?.closest('details')
      if (details) details.open = true
      drawingHost.current?.scrollIntoView({ block: 'nearest' })
    }
  }
  return <div className="native-design-disciplines" hidden={!tabs.includes(activeTab)} onClick={follow}>
    {!planner ? <p role="status">Apply a Site layout or open a schema-1 Room Planner project in Layout first. These tabs use that same editable project.</p> :
      <p className="discipline-source">{floor?.name} · revision {project?.revision} · Uses shared Site, building and Environment inputs. Change those at their source.</p>}
    {error && <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>Retry assets</button></p>}
    {planner && !runtime && !error && <p role="status">Loading local Design workbenches…</p>}
    <div ref={host} />
    {planner && <div hidden={activeTab !== 'review'}><ReviewWorkbench planner={planner} onLayout={() => onNavigate?.('layout')} /></div>}
    <details className="discipline-drawings" hidden={!planner || !drawings[activeTab]}>
      <summary>Drawings &amp; export — {activeTab}</summary>
      <p>Uses saved source records, not pending form text. Refresh explicitly; PDF/SVG/PNG are reference sheets, not engineered drawings.</p>
      <div ref={drawingHost} />
    </details>
  </div>
}
