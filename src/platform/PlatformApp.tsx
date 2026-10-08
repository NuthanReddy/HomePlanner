import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, errorMessage, platformApi, type AccountSession, type Challenge, type Jobs, type ProjectRecord } from './api'
import { AnalysisTabs } from './AnalysisTabs'
import { NativeWorkspace, type NativeDraftCache, type AppliedWorkspaceState } from './NativeWorkspace'
import { NativeDesign, type NativeDesignCache } from './NativeDesign'
import type { PlannerApi } from '../domain/project/planner-api'
import { DesignStorage } from './DesignStorage'
import { DesignDisciplineTabs } from './DesignDisciplineTabs'
import type { SolarResult } from './solar-api'

type Workspace = 'Site' | 'Design' | 'Analyze' | 'Compare'
const workspaces: Workspace[] = ['Site', 'Design', 'Analyze', 'Compare']

function SignIn({ onSignedIn }: { onSignedIn: (session: AccountSession) => void }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [delivery, setDelivery] = useState<'local-inbox' | 'sms' | null>(null)
  const [localCode, setLocalCode] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [challenge])
  useEffect(() => {
    let active = true
    platformApi.delivery().then(value => { if (active) setDelivery(value) })
      .catch(failure => { if (active) setError(errorMessage(failure)) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!challenge) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [challenge])

  async function sendCode() {
    setBusy(true); setError('')
    try {
      const next = await platformApi.challenge(phone)
      setChallenge(next); setCode(''); setLocalCode(''); setNow(Date.now())
      setResendAt(Date.now() + next.resend_after * 1000)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  async function readLocalCode() {
    if (!challenge?.local_inbox_ticket) return
    setBusy(true); setError('')
    try { setLocalCode(await platformApi.localCode(challenge.local_inbox_ticket)) }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!challenge) { await sendCode(); return }
    setBusy(true); setError('')
    try { onSignedIn(await platformApi.verify(challenge.challenge_id, code)) }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  const countdown = Math.max(0, Math.ceil((resendAt - now) / 1000))
  return <main className="account-page">
    <h1>HomePlanner</h1>
    <form onSubmit={submit} className="account-form">
      <h2>{challenge ? 'Verify your phone' : 'Sign in to your projects'}</h2>
      {delivery === 'local-inbox' && <p role="status">Local development: simulated OTP delivery. No SMS is sent and phone ownership is not verified. Use a fictional valid-format number such as +12025550123.</p>}
      <p>{challenge ? delivery === 'local-inbox' ? 'Open the local inbox, then enter its random code.' : 'Enter the code sent by SMS.' : 'Use your phone number with its country code.'}</p>
      {challenge?.local_inbox_ticket && <div>
        <button type="button" disabled={busy} onClick={readLocalCode}>Open local OTP inbox</button>
        {localCode && <p role="status">Simulated local code: <strong>{localCode}</strong></p>}
      </div>}
      <label htmlFor="sign-in-value">{challenge ? 'Verification code' : 'Phone number'}</label>
      {challenge
        ? <input ref={input} id="sign-in-value" autoComplete="one-time-code" inputMode="numeric"
            pattern="[0-9]{6}" maxLength={6} required value={code}
            aria-describedby={error ? 'sign-in-error' : undefined}
            onChange={event => setCode(event.target.value)} disabled={busy} />
        : <input ref={input} id="sign-in-value" type="tel" autoComplete="tel" placeholder="+ country code and number"
            maxLength={32} required value={phone}
            aria-describedby={error ? 'sign-in-error' : undefined}
            onChange={event => setPhone(event.target.value)} disabled={busy} />}
      {error && <p id="sign-in-error" role="alert" className="error">{error}</p>}
      <button className="primary" disabled={busy || delivery === null}>{busy ? 'Please wait...' : challenge ? 'Verify' : delivery === 'local-inbox' ? 'Create local code' : 'Send code'}</button>
      {challenge && <div className="actions">
        <button type="button" disabled={busy} onClick={() => { setChallenge(null); setCode(''); setLocalCode(''); setError('') }}>Change phone</button>
        <button type="button" disabled={busy || countdown > 0} onClick={sendCode}>
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
        </button>
      </div>}
    </form>
  </main>
}

function ProjectWorkspace({ project, name, onNameDraft, csrf, onUpdate, onBack, nativeCache, designCache }: {
  project: ProjectRecord; name: string; onNameDraft: (name: string) => void
  csrf: string; onUpdate: (project: ProjectRecord) => void; onBack: () => void
  nativeCache: NativeDraftCache
  designCache: NativeDesignCache
}) {
  const [designPlanner,setDesignPlanner]=useState<PlannerApi|null>(null)
  const [solarResult,setSolarResult]=useState<SolarResult|null>(null)
  const [applied,setApplied]=useState<AppliedWorkspaceState>({record:null,evaluation:null,blocked:true})
  const [workspace, setWorkspace] = useState<Workspace>('Site')
  const [tab, setTab] = useState('Layout')
  const [study, setStudy] = useState('Solar')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(name === project.name ? 'Saved' : 'Unsaved name')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)
  const [jobs, setJobs] = useState<Jobs | null>(null)
  const [jobsError, setJobsError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setStatus('Saving...')
    try {
      const saved = await platformApi.rename(project, name, csrf)
      onUpdate(saved); onNameDraft(saved.name); setStatus('Saved'); setConflict(false)
    } catch (failure) {
      setError(errorMessage(failure)); setStatus('Not saved')
      setConflict(failure instanceof ApiError && failure.status === 409)
    } finally { setBusy(false) }
  }
  async function reload() {
    setBusy(true); setError('')
    try {
      onUpdate(await platformApi.project(project.id)); setConflict(false)
      setStatus('Server version reloaded; your name draft is retained')
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  async function toggleJobs() {
    const opening = !jobsOpen
    setJobsOpen(opening)
    if (!opening) return
    setJobs(null); setJobsError('')
    try { setJobs(await platformApi.jobs(project.id)) }
    catch (failure) { setJobsError(errorMessage(failure)) }
  }
  const tabs = workspace === 'Design'
    ? ['Layout', 'Structure', 'Elevations', 'Plumbing', 'Drainage', 'Electrical', 'Review']
    : workspace === 'Analyze' ? ['Solar', 'Light', 'Wind & windows', 'Materials', 'Airflow', 'Pressure / CFD', 'Thermal & energy', 'Costs', 'Utilization'] : []
  return <div className="project-layout">
    <header className="project-header">
      <strong>HomePlanner</strong>
      <form className="project-name" onSubmit={save}>
        <label className="visually-hidden" htmlFor="project-name">Project name</label>
        <input id="project-name" value={name} maxLength={150} required disabled={busy}
          onChange={event => { onNameDraft(event.target.value); setStatus('Unsaved name') }} />
        <button disabled={busy || name === project.name}>Save name</button>
      </form>
      <span role="status">{status}</span>
      <button aria-expanded={jobsOpen} aria-controls="project-jobs" onClick={toggleJobs}>Jobs</button>
    </header>
    {error && <div className="workspace-error" role="alert">{error}
      {conflict && <button disabled={busy} onClick={reload}>Reload server version; keep draft</button>}
    </div>}
    <nav className="project-nav" aria-label="Project workspaces">
      <button onClick={onBack} disabled={busy}>My projects</button>
      {workspaces.map(item => <button key={item} aria-current={workspace === item ? 'page' : undefined}
        onClick={() => { setWorkspace(item); window.requestAnimationFrame(() => heading.current?.focus()) }}>{item}</button>)}
    </nav>
    <main className="project-workspace">
      {tabs.length > 0 && <nav className="local-tabs" aria-label={`${workspace} sections`}>
        {tabs.map(item => <button key={item}
          aria-current={(workspace === 'Design' ? tab : study) === item ? 'page' : undefined}
          onClick={() => workspace === 'Design' ? setTab(item) : setStudy(item)}>{item}</button>)}
      </nav>}
      <div className="workspace-tools">
        <h1 ref={heading} tabIndex={-1}>{workspace}</h1>
      </div>
      <section hidden={workspace !== 'Compare'} className="migration-boundary" aria-labelledby={`migration-boundary-${project.id}`}>
        <h2 id={`migration-boundary-${project.id}`}>No alternatives generated</h2>
        <p>Explicit generation will compare your current plan with three ranked alternatives. No plan has been generated here.</p>
        <p>No legacy browser project has been uploaded or replaced. Continue using the current planner for editing and studies during migration.</p>
        <a href="/index.html">Open current planner</a>
      </section>
      <DesignStorage id={project.id} csrf={csrf} cache={designCache} planner={designPlanner}>
        {savedDocumentText=><div hidden={workspace!=='Design'||tab!=='Layout'}>
          <NativeDesign cache={designCache} savedDocumentText={savedDocumentText} onPlannerChange={setDesignPlanner} record={applied.record} evaluation={applied.evaluation} blocked={applied.blocked}/>
        </div>}
      </DesignStorage>
      <DesignDisciplineTabs planner={designPlanner} activeTab={workspace==='Design'?tab.toLowerCase():''}
        onNavigate={next=>{setWorkspace('Design');setTab(next.charAt(0).toUpperCase()+next.slice(1))}}/>
      <NativeWorkspace id={project.id} csrf={csrf} workspace={workspace} study={study} cache={nativeCache} planner={designPlanner} onAppliedChange={setApplied} onSolarResultChange={setSolarResult}/>
      <AnalysisTabs planner={designPlanner} activeTab={workspace==='Analyze'?study:''}
        solarSource={applied.record?{record:applied.record,result:solarResult,blocked:applied.blocked}:null}
        onNavigate={()=>{setWorkspace('Design');setTab('Layout')}}/>
    </main>
    {jobsOpen && <aside id="project-jobs" className="jobs-panel" aria-labelledby="jobs-heading">
      <div className="actions"><h2 id="jobs-heading">Jobs</h2><button onClick={() => setJobsOpen(false)}>Close</button></div>
      {jobsError ? <p role="alert" className="error">{jobsError}</p>
        : jobs ? <p>{jobs.reason}</p> : <p role="status">Loading jobs...</p>}
    </aside>}
  </div>
}

export function PlatformApp() {
  const [account, setAccount] = useState<AccountSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [records, setRecords] = useState<ProjectRecord[]>([])
  const [selected, setSelected] = useState<ProjectRecord | null>(null)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const nativeCache=useRef<NativeDraftCache>(new Map())
  const designCaches=useRef(new Map<string,NativeDesignCache>())
  if(selected&&!designCaches.current.has(selected.id))designCaches.current.set(selected.id,{document:null})

  async function restore() {
    setLoading(true); setError('')
    try { setAccount(await platformApi.session()) }
    catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 401)) setError(errorMessage(failure))
    } finally { setLoading(false) }
  }
  useEffect(() => { void restore() }, [])
  useEffect(() => {
    if (!account) return
    let active = true
    setBusy(true); setError('')
    platformApi.projects(offset).then(items => { if (active) setRecords(items) })
      .catch(failure => { if (active) setError(errorMessage(failure)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [account, offset])

  async function create() {
    if (!account) return
    setBusy(true); setError('')
    try {
      const project = await platformApi.create(account.csrf_token)
      setRecords(previous => [project, ...previous]); setSelected(project)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  async function logout() {
    if (!account) return
    setBusy(true); setError('')
    try {
      await platformApi.logout(account.csrf_token)
      setAccount(null); setRecords([]); setSelected(null); setNameDrafts({}); setOffset(0)
      nativeCache.current.clear()
      designCaches.current.clear()
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  if (loading) return <main className="account-page"><h1>HomePlanner</h1><p role="status">Checking sign-in...</p></main>
  if (!account && error) return <main className="account-page"><h1>HomePlanner</h1>
    <p role="alert" className="error">{error}</p><button onClick={restore}>Retry connection</button></main>
  if (!account) return <SignIn onSignedIn={setAccount} />
  return <>
    <div className="account-controls"><button onClick={logout} disabled={busy || !!selected}
      title={selected ? 'Return to My projects before signing out to preserve input drafts.' : undefined}>Sign out</button></div>
    {selected ? <ProjectWorkspace key={selected.id} project={selected} csrf={account.csrf_token} nativeCache={nativeCache.current} designCache={designCaches.current.get(selected.id)!}
      name={nameDrafts[selected.id] ?? selected.name}
      onNameDraft={draft => setNameDrafts(previous => ({ ...previous, [selected.id]: draft }))}
      onUpdate={next => { setSelected(next); setRecords(previous => previous.map(item => item.id === next.id ? next : item)) }}
      onBack={() => setSelected(null)} />
      : <main className="projects-page">
          <header className="actions"><h1>My projects</h1><button className="primary" onClick={create} disabled={busy}>New project</button></header>
          {error && <p role="alert" className="error">{error}</p>}
          {busy && <p role="status">Loading...</p>}
          {!busy && !error && records.length === 0 && <p>No projects yet. Create one to begin.</p>}
          <ul className="project-list">{records.map(record => <li key={record.id}>
            <button onClick={() => setSelected(record)}><strong>{record.name}</strong>
              <span>Last saved {new Date(record.updated_at * 1000).toLocaleString()}</span></button>
          </li>)}</ul>
          <div className="actions">
            <button disabled={busy || offset === 0} onClick={() => setOffset(previous => Math.max(0, previous - 50))}>Previous</button>
            <button disabled={busy || records.length < 50} onClick={() => setOffset(previous => previous + 50)}>Next</button>
          </div>
        </main>}
  </>
}
