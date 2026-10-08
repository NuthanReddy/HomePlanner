import type { Evaluation, WorkspaceRecord } from './native-api'

type Box = { x: number; y: number; width: number; depth: number }
export interface NativeDesignSiteSource {
  version: 1
  accountProjectId: string
  workspaceVersion: number
  fingerprint: string
  site: WorkspaceRecord['document']['site']
  gross: Box
  net: Box
  envelope: Box
  registration: { grossNorthWestX: number; grossNorthWestY: number; baseOffsetM: number; acknowledged: true }
  plateRegistrations?: Record<string, NativeDesignSiteSource['registration']>
  result: Record<string, unknown>
}
const edges = ['N', 'E', 'S', 'W'] as const
const box = (value: unknown): Box => {
  const row = value as Box
  if (!row || !['x', 'y', 'width', 'depth'].every(key => Number.isFinite(row[key as keyof Box])) ||
    row.width <= 0 || row.depth <= 0) throw new Error('Applied Site has no valid positive rectangular geometry.')
  return { x: row.x, y: row.y, width: row.width, depth: row.depth }
}
export function designSiteSource(record: WorkspaceRecord, evaluation: Evaluation): NativeDesignSiteSource {
  if (record.project_id !== evaluation.project_id || record.version !== evaluation.version ||
    evaluation.feasibility.status !== 'computed') throw new Error('Apply and evaluate the current Site before creating Design.')
  const f = evaluation.feasibility, site = record.document.site
  const gross = box(f.gross), net = box(f.net), envelope = box(f.envelope)
  const front = String(f.front) as typeof edges[number]
  if (!edges.includes(front) || !Number.isFinite(f.usable_m2) || !Number.isFinite(site.floor_height_m))
    throw new Error('Applied Site lacks its elected frontage, usable area or floor spacing.')
  const setbacks = f.setbacks_m as Record<string, number>, required = f.required_setbacks_m as Record<string, number>
  if (![setbacks, required].every(row => row && edges.every(edge => Number.isFinite(row[edge]))))
    throw new Error('Applied and required Site setbacks must both be retained.')
  const origins = {
    N: { grossNorthWestX: -net.x, grossNorthWestY: -net.y },
    E: { grossNorthWestX: -net.y, grossNorthWestY: net.x + net.width },
    S: { grossNorthWestX: net.x + net.width, grossNorthWestY: net.y + net.depth },
    W: { grossNorthWestX: net.y + net.depth, grossNorthWestY: -net.x },
  }
  const result: Record<string, unknown> = {
    F: { bw: envelope.width, bd: envelope.depth }, E: setbacks, requiredE: required,
    W: front === 'N' || front === 'S' ? net.width : net.depth,
    D: front === 'N' || front === 'S' ? net.depth : net.width,
    usable: f.usable_m2, frontEdge: front, floors: f.floors, maxFloors: f.max_floors,
    ffh: site.floor_height_m, stilt: site.stilt, customSetbacks: site.custom_setbacks,
    highRise: f.high_rise, selH: site.height_m, nonCompliant: f.non_compliant, splitOn: false,
  }
  const plateRegistrations: Record<string, NativeDesignSiteSource['registration']> = {
    whole: { ...origins[front], baseOffsetM: 0, acknowledged: true },
  }
  const split = evaluation.utilization.split as {
    edge: typeof edges[number]
    selected: { a: Record<string, unknown>; b: Record<string, unknown> }
  } | null
  if (site.split_edge && split?.edge === site.split_edge && split.selected) {
    const convert = (part: Record<string, unknown>) => {
      const rect = box(part.envelope)
      const applied = part.applied_setbacks_m as Record<string, number>
      return {
        bw: rect.width, bd: rect.depth, usable: part.usable_m2, floors: part.floors,
        maxFloors: part.max_floors, h: part.height_m, nonCompliant: part.non_compliant,
        front: applied.front, rear: applied.rear, left: applied.left, right: applied.right,
        frontage: part.frontage_m, depth: part.depth_m,
        requiredSetbacks: {
          N: (part.required_setbacks_m as Record<string, number>).front,
          E: (part.required_setbacks_m as Record<string, number>).right,
          S: (part.required_setbacks_m as Record<string, number>).rear,
          W: (part.required_setbacks_m as Record<string, number>).left,
        },
      }
    }
    result.splitOn = true; result.axis = split.edge
    result.split = { A: convert(split.selected.a), B: convert(split.selected.b) }
    const orientedGrossOrigins = {
      N: { x: 0, y: 0 }, E: { x: 0, y: gross.width },
      S: { x: gross.width, y: gross.depth }, W: { x: gross.depth, y: 0 },
    }
    const origin = orientedGrossOrigins[split.edge]
    for (const [key, part, offset] of [
      ['A', split.selected.a, 0],
      ['B', split.selected.b, Number(split.selected.a.frontage_m)],
    ] as const) {
      plateRegistrations[key] = {
        grossNorthWestX: origin.x - offset,
        grossNorthWestY: origin.y - Number(part.widening_m),
        baseOffsetM: 0, acknowledged: true,
      }
    }
  }
  return {
    version: 1, accountProjectId: record.project_id, workspaceVersion: record.version,
    fingerprint: JSON.stringify({ site, feasibility: f, utilization: evaluation.utilization }),
    site: structuredClone(site), gross, net, envelope,
    registration: plateRegistrations.whole, plateRegistrations, result,
  }
}
