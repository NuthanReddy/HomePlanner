import type { PlannerApi } from '../domain/project/planner-api'
import type { WorkspaceRecord } from './native-api'
import type { SolarResult } from './solar-api'

export interface NativeSolarSelection {
  site: { latitudeDeg: number; longitudeDeg: number; timeZone: string }
  date: string
  startTime: string
  startOccurrence: '' | 'earlier' | 'later'
  instantUTC: string
  source: string
}
export interface AnalysisSolarSource {
  record: WorkspaceRecord
  result: SolarResult | null
  blocked: boolean
}

// Read only the parent's current computed selection, never a stale response or
// raw date draft. The Light controller independently resolves the civil instant.
export function nativeSolarSelection(planner: PlannerApi, source: AnalysisSolarSource | null | undefined): NativeSolarSelection {
  if (!source || source.blocked || !source.result)
    throw new Error('Calculate the current Solar selection first. Pending Site edits or cleared Solar evidence cannot be copied.')
  const { record, result } = source
  if (result.project_id !== record.project_id || result.version !== record.version)
    throw new Error('Solar evidence belongs to an older account project or workspace version. Calculate the current selection again.')
  const site = record.document.site, shared = planner.getProject().site, inputs = result.result.inputs
  if (site.latitude === null || site.longitude === null || !site.time_zone ||
    shared.latitude !== site.latitude || shared.longitude !== site.longitude || shared.timeZone !== site.time_zone)
    throw new Error('Solar and shared Design Site differ. Review/apply the shared Site explicitly before copying; no coordinates were overwritten.')
  if (inputs.latitude !== site.latitude || inputs.longitude !== site.longitude || inputs.timeZone !== site.time_zone)
    throw new Error('Computed Solar coordinates do not match the applied Site.')
  const date = inputs.date, startTime = inputs.localClock, occurrence = inputs.occurrence
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    ![null, undefined, 'earlier', 'later'].includes(occurrence as string | null | undefined))
    throw new Error('Solar evidence lacks a supported civil date, clock or repeated-time choice.')
  const selected = result.result.output.selected
  if (selected.localTime.slice(0, 10) !== date || selected.localTime.slice(11, 16) !== startTime ||
    !Number.isFinite(Date.parse(selected.instantUTC)) || Date.parse(selected.localTime) !== Date.parse(selected.instantUTC))
    throw new Error('Solar selected instant does not match its civil selection.')
  return {
    site: { latitudeDeg: site.latitude, longitudeDeg: site.longitude, timeZone: site.time_zone },
    date, startTime, startOccurrence: occurrence === 'earlier' || occurrence === 'later' ? occurrence : '',
    instantUTC: selected.instantUTC,
    source: `Explicit copy from current native Solar (${result.result.engine.name} ${result.result.engine.version}), account ${record.project_id} version ${record.version}. Only Site and civil selection copied; Light intervals use HomeSun / SunCalc, not pvlib directions or atmosphere.`,
  }
}
