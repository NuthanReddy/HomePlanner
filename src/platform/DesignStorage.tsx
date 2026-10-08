import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, request, errorMessage } from './api'
import { loadDesignRuntime, type DesignDocument } from './design-runtime'
import type { NativeDesignCache } from './NativeDesign'
import type { PlannerApi } from '../domain/project/planner-api'

type SavedDesign={project_id:string;version:number;document:DesignDocument|null}
function draftToken(planner:PlannerApi|null) {
  if(!planner)return null
  const drafts=(window as Window & {HomePlannerDrafts?:{token(owner:PlannerApi):number}}).HomePlannerDrafts
  if(!drafts)throw new Error('Design draft tracking is unavailable. Current fields cannot safely be replaced.')
  return drafts.token(planner)
}
async function readRecord(value:unknown,id:string):Promise<SavedDesign> {
  if(!value||typeof value!=='object'||!('project_id' in value)||value.project_id!==id||
    !('version' in value)||typeof value.version!=='number'||!Number.isSafeInteger(value.version)||value.version<0||
    !('document' in value))throw new Error('Invalid saved Design response; the working copy was retained.')
  const document=value.document===null?null:(await loadDesignRuntime()).Model.parseProject(JSON.stringify(value.document))
  return {project_id:id,version:value.version,document}
}

export function DesignStorage({id,csrf,cache,planner,children}:{
  id:string;csrf:string;cache:NativeDesignCache;planner:PlannerApi|null;children:(savedDocumentText:string|null)=>ReactNode
}) {
  const [saved,setSaved]=useState<SavedDesign|null>(null)
  const [ready,setReady]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [status,setStatus]=useState('Loading saved Design...')
  const [dirty,setDirty]=useState(false)
  const [loadAttempt,setLoadAttempt]=useState(0)
  const [conflict,setConflict]=useState(false)
  const [mountVersion,setMountVersion]=useState(0)
  const savedText=useRef<string|null>(null)
  const lock=useRef(false)
  const mounted=useRef(true)
  const endpoint=`/projects/${encodeURIComponent(id)}/design`
  useEffect(()=>{
    mounted.current=true
    let active=true
    request(endpoint).then(value=>readRecord(value,id)).then(record=>{
      if(!active)return
      savedText.current=record.document?JSON.stringify(record.document):null
      if(!cache.document)cache.document=record.document
      setSaved(record);setReady(true)
      setStatus(record.document?`Saved Design version ${record.version}`:'No Design saved to this account yet')
    }).catch(failure=>{if(active){setError(errorMessage(failure));setStatus('Saved Design could not be loaded. No working copy was replaced.')}})
    return ()=>{active=false;mounted.current=false}
  },[id,endpoint,cache,loadAttempt])
  useEffect(()=>{
    if(!planner)return
    const update=()=>setDirty(JSON.stringify(JSON.parse(planner.exportProject()))!==savedText.current)
    update()
    return planner.subscribe(update)
  },[planner,saved])
  async function save() {
    if(!planner||!saved||lock.current)return
    lock.current=true;setBusy(true);setError('')
    try {
      const snapshot=planner.exportProject()
      const runtime=await loadDesignRuntime()
      const document=runtime.Model.parseProject(snapshot)
      const result=await readRecord(await request(endpoint,'POST',{expected_version:saved.version,document},csrf),id)
      if(!mounted.current)return
      savedText.current=result.document?JSON.stringify(result.document):null
      setSaved(result);setConflict(false);setStatus(`Saved Design version ${result.version}; unapplied fields are not included`)
    } catch(failure) {
      if(mounted.current){setError(errorMessage(failure));setConflict(failure instanceof ApiError&&failure.status===409);setStatus('Design not saved; current edits are retained. Export JSON for recovery.')}
    } finally {lock.current=false;if(mounted.current)setBusy(false)}
  }
  async function openSaved() {
    if(lock.current||!window.confirm('Open the saved account Design? This replaces the current working copy and unapplied fields. Export wanted edits first.'))return
    lock.current=true;setBusy(true);setError('')
    const before=planner?.exportProject()
    try {
      const beforeDrafts=draftToken(planner)
      const result=await readRecord(await request(endpoint),id)
      if(!mounted.current)return
      if(planner?.exportProject()!==before||draftToken(planner)!==beforeDrafts)throw new Error('Design or its fields changed while loading. Current edits were kept; try again.')
      if(!result.document)throw new Error('There is no saved account Design to open. Current edits were kept.')
      cache.document=result.document;savedText.current=JSON.stringify(result.document)
      setSaved(result);setConflict(false);setDirty(false);setMountVersion(value=>value+1)
      setStatus(`Opened saved Design version ${result.version}`)
    } catch(failure) {if(mounted.current)setError(errorMessage(failure))}
    finally {lock.current=false;if(mounted.current)setBusy(false)}
  }
  return <>
    <div className="design-save-bar">
      <button type="button" disabled={!planner||!saved||busy||!dirty} onClick={save}>{busy?'Saving Design...':'Save Design'}</button>
      <span role="status">{dirty?'Unsaved Design edits. ':''}{status}</span>
      {conflict&&<button type="button" disabled={busy} onClick={openSaved}>Open saved Design; discard working copy</button>}
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {!ready&&error&&<button type="button" onClick={()=>{setError('');setLoadAttempt(value=>value+1)}}>Retry loading saved Design</button>}
    {ready&&<div key={mountVersion}>{children(savedText.current)}</div>}
  </>
}
