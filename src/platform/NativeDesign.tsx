import { useEffect, useRef, useState } from 'react'
import { loadDesignRuntime, type DesignDocument, type DesignMount } from './design-runtime'
import './native-design.css'
import type { PlannerApi } from '../domain/project/planner-api'
import type { WorkspaceRecord, Evaluation } from './native-api'
import { designSiteSource, type NativeDesignSiteSource } from './design-site-adapter'
import { assertEditableDesign } from './design-document'

export interface NativeDesignCache { document: DesignDocument | null }

// Keep this component mounted (hide its native panel on navigation) to retain
// the incumbent controller's Undo and scoped inspector drafts.
export function NativeDesign({ cache, onDocumentChange, onPlannerChange, record, evaluation, blocked = false, savedDocumentText }: {
  cache: NativeDesignCache
  onDocumentChange?: (document: DesignDocument) => void
  onPlannerChange?: (planner: PlannerApi | null) => void
  record?: WorkspaceRecord | null
  evaluation?: Evaluation | null
  blocked?: boolean
  savedDocumentText?: string | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const mount = useRef<DesignMount | null>(null)
  const inspector = useRef<{
    getPendingDrafts(): readonly unknown[]
    getActionState(): { canDelete: boolean }
    requestDeleteSelection(): unknown
  } | null>(null)
  const change = useRef(onDocumentChange); change.current = onDocumentChange
  const plannerChange = useRef(onPlannerChange); plannerChange.current = onPlannerChange
  const [document, setDocument] = useState(cache.document)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const savedBaseline = useRef(savedDocumentText); savedBaseline.current = savedDocumentText
  const hasPending = () => {
    const drafts = (window as Window & { HomePlannerDrafts?: { hasPending(planner: PlannerApi): boolean } }).HomePlannerDrafts
    return !!inspector.current?.getPendingDrafts().length ||
      !!(mount.current && drafts?.hasPending(mount.current.planner))
  }
  const unsaved = () => savedBaseline.current === undefined ? dirty :
    !!mount.current && JSON.stringify(JSON.parse(mount.current.planner.exportProject())) !== savedBaseline.current
  const [version, setVersion] = useState(0)
  const openSequence = useRef(0)
  const [source, setSource] = useState<NativeDesignSiteSource | null>(null)
  const [controlsMarkup, setControlsMarkup] = useState<{ settings: string; palette: string } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const update = () => setFullscreen(window.document.fullscreenElement === host.current)
    window.document.addEventListener('fullscreenchange', update)
    return () => window.document.removeEventListener('fullscreenchange', update)
  }, [])

  async function createFromSite() {
    if (!record || !evaluation || blocked || cache.document) return
    try {
      const next = designSiteSource(record, evaluation)
      if (!Number.isFinite(next.site.latitude) || !Number.isFinite(next.site.longitude) || !next.site.time_zone)
        throw new Error('Apply the Site location and time zone first. The shared Design model requires them; no location is invented.')
      const runtime = await loadDesignRuntime()
      setControlsMarkup(runtime.Controls); setSource(next); setInitializing(true); setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Apply Site first.') }
  }

  useEffect(() => {
    if ((!document && !initializing) || !host.current) return
    let active = true
    let dispose: (() => void) | undefined
    let releaseBindings: (() => void) | undefined
    setReady(false); setError('')
    loadDesignRuntime().then(runtime => {
      if (!active || !host.current) return
      if (document) assertEditableDesign(document)
      releaseBindings = () => { runtime.RoomInputs.releaseBindings(window.document) }
      const root = host.current
      if (!root.querySelector('#bedCount')) {
        root.querySelector('[data-design-settings]')!.innerHTML = runtime.Controls.settings
        root.querySelector('[data-design-library]')!.innerHTML = runtime.Controls.palette
      }
      const mounted = runtime.Design.mount(root.querySelector('svg')!, root, document, {
        Model: runtime.Model, Bridge: runtime.Bridge, Regions: runtime.Regions, Layout: runtime.Layout,
        Generator: runtime.Generator, RoomInputs: runtime.RoomInputs, siteSource: source,
        onChange: (next: DesignDocument) => {
          cache.document = next; change.current?.(next); setVersion(value => value + 1)
        },
      })
      mount.current = mounted
      dispose = () => { mounted.destroy(); mount.current = null }
      const editor = runtime.Editor.init(mounted.planner, window.document, runtime.Model)
      inspector.current = editor
      dispose = () => { editor.destroy(); mounted.destroy(); mount.current = null; inspector.current = null }
      const three = runtime.Three.mount(root.querySelector('[data-native-three]')!, mounted.planner, runtime.Model, { editor })
      const unsubscribe = mounted.planner.subscribe(event => {
        if (event.type !== 'selection') setDirty(true)
        setVersion(value => value + 1)
      })
      dispose = () => {
        plannerChange.current?.(null)
        unsubscribe(); three.destroy(); editor.destroy(); mounted.destroy()
        mount.current = null; inspector.current = null
      }
      setReady(true)
      if (!document) setDirty(true)
      cache.document = mounted.planner.getProject() as unknown as DesignDocument
      change.current?.(cache.document)
      plannerChange.current?.(mounted.planner)
    }).catch(failure => {
      dispose?.(); dispose = undefined
      releaseBindings?.()
      if (active) {
        setError(failure instanceof Error ? failure.message : 'Design could not load.')
        if (!document) setInitializing(false)
      }
    })
    return () => { active = false; dispose?.() }
  }, [document, cache, initializing, source])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsaved() && !hasPending()) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function open(file: File) {
    if ((unsaved() || hasPending()) &&
      !window.confirm('Replace this Design working copy? Export wanted edits first. Unapplied inspector drafts are not included.')) return
    const sequence = ++openSequence.current
    const owner = mount.current
    const source = owner?.planner.exportProject()
    const drafts = JSON.stringify(inspector.current?.getPendingDrafts() ?? [])
    try {
      const runtime = await loadDesignRuntime()
      const next = runtime.Model.parseProject(await file.text())
      assertEditableDesign(next)
      setControlsMarkup(runtime.Controls)
      if (sequence !== openSequence.current) return
      if (mount.current !== owner || owner?.planner.exportProject() !== source ||
        JSON.stringify(inspector.current?.getPendingDrafts() ?? []) !== drafts)
        throw new Error('Design changed while the JSON was being opened. Current edits and drafts were kept; choose the file again when ready.')
      if (owner) {
        owner.planner.replaceProject(next as unknown as Parameters<PlannerApi['replaceProject']>[0])
        cache.document = owner.planner.getProject() as unknown as DesignDocument
      } else {
        cache.document = next; setDocument(next)
      }
      setDirty(true); setError('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The JSON could not be opened. Current work was kept.') }
  }
  function download() {
    if (!mount.current) return
    const url = URL.createObjectURL(new Blob([mount.current.planner.exportProject()], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url; link.download = 'homeplanner-design.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const planner = mount.current?.planner
  const current = planner?.getProject()
  return <section className="native-design" aria-labelledby="native-design-title" data-version={version}>
    <h2 id="native-design-title">Design</h2>
    <details><summary>Import / export & storage</summary>
    <p>Browser-saved Room Planner projects are not automatically imported or overwritten. JSON includes committed geometry, not pending drafts.</p>
    <label>Open Room Planner JSON <input type="file" accept=".json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void open(file)
    }} /></label></details>
    {error && <p role="alert">{error}</p>}
    {!document && !initializing && <div>
      <button disabled={blocked || !record || !evaluation} onClick={() => void createFromSite()}>Create layout from applied Site</button>
      <p>Uses the saved plot envelope, frontage, setbacks and location. No JSON or coordinate registration is needed.</p>
    </div>}
    {(document || initializing) && <div ref={host}>
      <div className="native-design-toolbar">
        <button disabled={!ready || !planner?.canUndo()} onClick={() => {
          try { planner?.undo() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Undo failed.') }
        }}>Undo</button>
        <button disabled={!ready || !planner?.canRedo()} onClick={() => {
          try { planner?.redo() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Redo failed.') }
        }}>Redo</button>
        <button disabled={!ready || !inspector.current?.getActionState().canDelete}
          onClick={() => inspector.current?.requestDeleteSelection()}>Delete selected…</button>
        <button type="button" disabled={!ready} onClick={download}>Export Design JSON</button>
        <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>Rooms & settings</button>
        <button disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}>Zoom in</button>
        <button disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}>Zoom out</button>
        <button onClick={() => setZoom(1)}>Fit plan</button>
        <button onClick={() => {
          const request = fullscreen ? window.document.exitFullscreen() : host.current?.requestFullscreen()
          void request?.catch(() => setError('Fullscreen is unavailable in this browser. The editor remains usable.'))
        }}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
        {record && evaluation && <button disabled={!ready || blocked} onClick={() => {
          try {
            if (hasPending()) throw new Error('Apply or discard pending inputs before reviewing Site changes.')
            const next = designSiteSource(record, evaluation)
            if (!window.confirm('Apply the saved Site to this Design? Existing room coordinates and independent floors will be preserved. An incompatible envelope is rejected; this does not regenerate the layout.')) return
            mount.current?.applySite(next); setError('')
          } catch (failure) { setError(failure instanceof Error ? failure.message : 'Site was not linked.') }
        }}>Review / apply Site changes</button>}
      </div>
      <details><summary>{ready ? `${current?.name} · Floors & history` : error ? 'Editor unavailable — see import guidance above' : 'Loading editor…'}</summary>
        <div id="plannerProjectTools" />
      </details>
      <p id="roomEditHint" role="status">Select and drag an existing room or component. A completed gesture has one Undo entry. Escape cancels.</p>
      <button type="button" id="roomReset">Reset to suggested layout</button>
      <p id="componentStatus" role="status" />
      <div className="native-design-grid">
        <aside hidden={!expanded}>
          <div data-design-settings dangerouslySetInnerHTML={controlsMarkup ? { __html: controlsMarkup.settings } : undefined} />
          <div data-design-library dangerouslySetInnerHTML={controlsMarkup ? { __html: controlsMarkup.palette } : undefined} />
        </aside>
        <svg id="roomPlan" viewBox={`${400 - 400 / zoom} ${280 - 280 / zoom} ${800 / zoom} ${560 / zoom}`} aria-label="Editable Room Planner floor plan" />
        <div id="plannerInspector" />
      </div>
      <div data-native-three />
      <details><summary>Model scope</summary><p>Existing generator, destination checks, programme/library, shared inspector and 3D. Account save is separate from working-copy edits. Schematic geometry is not structural, accessibility or legal approval.</p></details>
    </div>}
  </section>
}
