import type { DesignDocument } from './design-runtime'

// Drawing-only snapshots can compile successfully without the incumbent editor's
// packing/plate inputs. Reject them before the live adapter or cache is touched.
export function assertEditableDesign(document: DesignDocument): void {
  const floors = document.floors as { name?: string; legacy?: { context?: unknown } }[] | undefined
  const contexts = [document.legacy, ...(floors ?? []).map(floor => floor.legacy)]
  for (const legacy of contexts) {
    const context = (legacy as { context?: Record<string, any> } | undefined)?.context
    const valid = context?.plate && context?.g && context?.cfg && context?.plan &&
      ['width', 'depth'].every(key => Number.isFinite(context.plate[key]) && context.plate[key] > 0) &&
      ['W', 'D', 'outerW', 'outerD', 'coreW', 'coreD'].every(key => Number.isFinite(context.g[key])) &&
      context.cfg.walls && context.cfg.corridors && context.cfg.counts &&
      Array.isArray(context.plan.placed) && Array.isArray(context.g.balconies)
    if (!valid) throw new Error('This project is valid for drawings but lacks the complete Room Planner editor context on one or more floors. Open it in the original Room Planner and export its full project. Current Design and drafts were kept.')
  }
}
