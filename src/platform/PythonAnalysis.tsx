import { useEffect, useRef, useState, type FormEvent } from 'react'
import { errorMessage, platformApi, type ProjectRecord, type PythonCalculation } from './api'

type Kind = 'solar-position' | 'air-density'
const templates: Record<Kind, Record<string, unknown>> = {
  'solar-position': {
    latitude: null, longitude: null, timeZone: '', date: '', instantUTC: '',
    altitudeM: null, pressurePa: null, temperatureC: null,
    acknowledgeReferenceAtmosphere: false, sampleMinutes: 15,
  },
  'air-density': { temperatureC: null, rhPct: null, pressurePa: null },
}

export function PythonAnalysis({ project, csrf, kind }: {
  project: ProjectRecord; csrf: string; kind: Kind
}) {
  const [draft, setDraft] = useState(JSON.stringify(templates[kind], null, 2))
  const [result, setResult] = useState<PythonCalculation | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const isSolar = kind === 'solar-position'
  useEffect(() => {
    generation.current += 1
    setResult(null); setBusy(false)
    return () => { generation.current += 1 }
  }, [project.id, project.version])

  async function calculate(event: FormEvent) {
    event.preventDefault()
    const run = ++generation.current
    setBusy(true); setError(''); setResult(null)
    try {
      const inputs: unknown = JSON.parse(draft)
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
        throw new Error('Supply a JSON object containing the documented inputs.')
      }
      const next = await platformApi.calculate(project, kind, inputs as Record<string, unknown>, csrf)
      if (generation.current !== run) return
      if (next.project_id !== project.id || next.metadata_version !== project.version) {
        throw new Error('The project changed during calculation. Review inputs and run again.')
      }
      setResult(next)
    } catch (failure) {
      if (generation.current === run) setError(errorMessage(failure))
    } finally {
      if (generation.current === run) setBusy(false)
    }
  }

  return <section className="python-analysis" aria-label={isSolar ? 'Python solar utility' : 'Python density utility'}>
    <h2>{isSolar ? 'Solar position & daily path - pvlib' : 'Air density - PsychroLib'}</h2>
    <p>Supplied-input Python utility, not a study of this project's room geometry. Runs only when requested; no plan changes or alternatives are generated.</p>
    <p>{isSolar
      ? 'Supply coordinates, IANA time zone, civil date and an ISO instant with explicit offset. Altitude is metres above sea level; pressure is absolute Pa; temperature is Celsius. Explicit reference acknowledgement supplies missing values only: 0 m, 101325 Pa and 15 C. No building shade or energy is calculated.'
      : 'Supply temperature in Celsius, relative humidity in percent (0-100) and absolute station pressure in Pa, not sea-level-reduced pressure. This calculates a scenario property, not room velocity, ventilation or measured indoor density.'}</p>
    <form onSubmit={calculate}>
      <label htmlFor={`python-${kind}-inputs`}>Calculation inputs (JSON; replace nulls with supplied values)</label>
      <textarea id={`python-${kind}-inputs`} rows={isSolar ? 15 : 6} value={draft}
        spellCheck={false} onChange={event => {
          generation.current += 1; setDraft(event.target.value); setResult(null); setBusy(false); setError('')
        }} />
      <div className="actions">
        <button className="primary" disabled={busy}>{busy ? 'Calculating...' : 'Calculate Python utility'}</button>
        <button type="button" onClick={() => {
          generation.current += 1; setResult(null); setBusy(false); setError('')
        }}>Clear result</button>
      </div>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <div>
      <p role="status">Python calculation complete. Metadata version {result.metadata_version}; no geometry study or saved analysis is implied.</p>
      <pre aria-label="Python result with inputs, units, engine and assumptions">{JSON.stringify(result.result, null, 2)}</pre>
    </div>}
  </section>
}
