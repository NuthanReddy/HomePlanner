import { useEffect, useRef, useState } from 'react'
import type { PlannerApi } from '../domain/project/planner-api'
import { loadAnalysisRuntime, type AnalysisController } from './analysis-runtime'
import { nativeSolarSelection, type AnalysisSolarSource } from './analysis-solar'
import './analysis-tabs.css'

const tabNames = ['Light', 'Airflow', 'Pressure / CFD', 'Thermal & energy'] as const
export function AnalysisTabs({ planner, activeTab, onNavigate, solarSource }: {
  planner: PlannerApi | null
  activeTab: string
  onNavigate?: (route: string) => void
  solarSource?: AnalysisSolarSource | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const navigate = useRef(onNavigate); navigate.current = onNavigate
  const solar = useRef(solarSource); solar.current = solarSource
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const active = tabNames.some(tab => tab === activeTab)
  // Once first opened, retain the hosts/controllers across tab navigation.
  const [opened, setOpened] = useState(active)
  useEffect(() => { if (active) setOpened(true) }, [active])
  useEffect(() => {
    if (!opened || !planner || !host.current) return
    let cancelled = false
    const controllers: AnalysisController[] = []
    const root = host.current
    setError(''); setReady(false)
    loadAnalysisRuntime().then(runtime => {
      if (cancelled) return
      const add = (controller: AnalysisController | null) => {
        if (!controller) throw new Error('An incumbent analysis workbench could not mount. Inspect the section error and retry.')
        controllers.push(controller)
      }
      add(runtime.HomePlannerLightUI.mount(document, window, planner, {
        navigate: route => navigate.current?.(route),
        getSolarSelection: () => nativeSolarSelection(planner, solar.current),
      }))
      add(runtime.HomePlannerAirflowUI.mount(document, window, planner))
      add(runtime.HomePlannerCFDUI.mount(document, window, planner))
      add(runtime.HomePlannerReducedUI.mount(root.querySelector('[data-native-pressure]')!, planner, 'pressure', window))
      add(runtime.HomePlannerReducedUI.mount(root.querySelector('[data-native-thermal]')!, planner, 'thermal', window))
      setReady(true)
    }).catch(failure => {
      controllers.splice(0).reverse().forEach(controller => controller.dispose())
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Analysis could not load.')
    })
    return () => {
      cancelled = true
      controllers.reverse().forEach(controller => controller.dispose())
      root.querySelectorAll('[data-native-study-host]').forEach(node => node.replaceChildren())
    }
  }, [opened, planner, attempt])
  return <div className="native-analysis" ref={host} hidden={!active}>
    {!planner && <p role="status">Create or open the shared project in Design first. These studies use that exact project, its Site and saved environment inputs.</p>}
    {planner && opened && <>
      <p className="native-analysis-method">Current Design project · incumbent local analysis adapters. Run explicitly; navigation does not calculate, fetch weather or start an engine.</p>
      {!ready && !error && <p role="status">Loading local analysis controls…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry loading</button></p>}
      <section hidden={activeTab !== 'Light'}><div id="workspaceLightStudy" data-native-study-host /></section>
      <section hidden={activeTab !== 'Airflow'}><div id="workspaceAirflow" data-native-study-host /></section>
      <section hidden={activeTab !== 'Pressure / CFD'}>
        <div id="workspaceCfd" data-native-study-host />
        <details className="native-pressure-expert"><summary>Expert pressure-network JSON · separate from CFD</summary>
          <div data-native-pressure data-native-study-host />
        </details>
      </section>
      <section hidden={activeTab !== 'Thermal & energy'}><div data-native-thermal data-native-study-host /></section>
    </>}
  </div>
}
