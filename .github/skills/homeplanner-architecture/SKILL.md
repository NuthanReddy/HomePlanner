---
name: homeplanner-architecture
description: "Use for HomePlanner requests such as 'plan room adjacency', 'move or resize rooms', 'reserve a lift inside a room', 'fix staircase placement', 'preserve a saved layout', or 'apply a named starter'. Guides the rectangular generator, authored project commands, physical geometry, usable regions and true-north orientation. Route clearance reviews to homeplanner-ergonomics and sheet/export work to homeplanner-drawing-exports only when needed."
---

# Architectural planning and geometry

## When to use
- Change the room programme, packing, adjacency, service reservations, movement, independent floors or authored-to-derived geometry boundary.
- Use `homeplanner-ergonomics` for human circulation, reach and interaction accessibility; use `homeplanner-drawing-exports` for sheet conventions and file output.
- Load only the matching additional specialist for a concrete regulatory, structural, services or environmental subtask. Do not load every skill for a room edit.

## Repository anchors
| Owner | Actual entry points and contracts |
| --- | --- |
| `index.html` | Legacy functions `deriveRoomGeometry`, `makeRoomRequests`, `roomPackProgram`, `roomApplyManualLayout`, `roomRecalculatePlan`, `roomModuleClear`, `roomEditableError`, `roomMoveCandidate`, `roomCommitManual`, `roomSaveManualLayout`, `initRoomEditing`. These are generator/adapter functions, not a new CommonJS API. |
| `planner-model.js` / `HomePlannerModel` | `validateProject`, `parseProject`, `buildScene`, `canonicalDocument`, `inputFingerprint`, `localToWorld`, `worldVectorToLocal`, `wallPoint`, `doorGeometry`. Compiles effective walls, openings and quantities without authoring edits. |
| `planner-regions.js` / `HomePlannerRegions` | `reservationBounds(carpet, module)`, `intersection`, `subtractRectangle`, `area`: frozen rectangle operations; use these instead of another subtraction/union kernel. |
| `planner-bridge.js` | CommonJS `createController`, `remapFloor`; browser `HomePlanner.getProject/getScene/getScenes/getDrawingScene`, `execute`, `subscribe`, `undo/redo`, `exportProject`. The controller owns transactions and floor slices. |
| `planner-projection.js` / `HomePlannerProjection` | `localToSite`, `siteToWorld`, `projectScene`, `build`, `snapshot`: detached registered-site geometry and provenance, not editable state. |
| `planner-editor.js` / `HomePlannerEditor` | `init`, `numberValue`, `rectCommand`, `openingCommand`, `wallOpeningCommand`, `floorPatchCommand`; inspector edits use the bridge, not renderer mutations. |
| `planner-workspace.js` / `HomePlannerWorkspace` | `mount`, `navigate`, `getRoute`, `dockInspector`; move existing live controls, preserving selection and drafts. Navigation is not a project edit. |

Read [Room Planner](../../../docs/room-planner.md), [project model](../../../docs/project-model.md), [plot geometry](../../../docs/plot-geometry.md), [editor](../../../docs/editor-workspace.md), [drawing foundation](../../../docs/drawing-foundation.md) and [workspace navigation](../../../docs/workspace-navigation.md) for the touched boundary.

## Required inputs
- Current project ID/revision, active floor, existing manual edits, requested change and what must remain fixed. Identify new-layout work versus modification of an occupied/saved plan.
- Room quantities, supplied dimensional ranges and their units; distinguish clear carpet dimensions, centreline modules and full wall-inclusive footprints.
- Selected whole/split plot, setbacks, buildable plate, external corridors, actual building envelope and wall thicknesses. Keep missing site or physical evidence unknown.
- Front/road-facing cardinal bearing relative to true north, adjacency/access requirements, and separately enabled cultural/passive preferences.
- For a named starter: its explicit name and supplied constraints, intended floor and permission to apply it. There is no generic named-starter API to assume exists.

## Workflow
1. **Capture the source.** Read `HomePlanner.getProject()` and active `getScene()`; obtain `getDrawingScene()` for registered multi-floor consumers. Track project, revision and floor. Never substitute an optimizer rectangle, stale inactive-floor copy or sample house for current Room Planner geometry.
2. **Separate authoring from compilation.** Schema-1 project/floor records and legacy manual layouts are authored inputs. Effective walls/openings, `usableRegions`, projections and drawings are derived. Use `execute({type:'update-room', id, rect})` with the current scene ID, or the existing legacy gesture transaction; do not mutate scenes or create a second editable geometry store.
3. **Establish physical coordinates.** Work in metres and square metres; convert feet/inches at the existing input boundary. `scene.plot` is the net site boundary (possibly absent), `scene.floor` the buildable plate, and `scene.building` the dwelling envelope. Corridors, wall bands, regulatory floor selection and physical storey heights are different things.
   - Local x is right and y rear; local N is negative y. `headingDeg` is the front bearing clockwise from true north.
   - Use model transforms for the incumbent centred ENU frame and projection transforms for the common site-origin frame. Do not rotate room rectangles twice or mix those origins.
   - Numeric headings in transform helpers do not mean arbitrary surveyed-bearing authoring exists; current project input is cardinal.
4. **Apply the reservation invariant.** Lift/stair requests with `req.reserveFootprint === true` reserve full physical wall-inclusive footprints **inside ordinary rooms**. Intentional service/host overlap is not an ordinary-room collision.
   - Compute the reservation with `reservationBounds(carpet, module)`; a module is a wall-centreline box, not the outside wall extent. Each side's supplied allowance matters.
   - Keep the full footprint inside the dwelling interior, including all service walls. Ordinary rooms cannot overlap each other; service reservations cannot overlap each other, even if only their walls clash.
   - Subtract reservation unions from each intersected ordinary host. A reservation may affect several hosts. Preserve the host's editable `rect/module`; use `room.usableRegions ?? [room.rect]` downstream. `[]` means no usable floor, never a fallback to the rectangle.
   - Check gross habitable area = net habitable area + reserved host area; total usable room area = net habitable area + service clear carpet. Do not count the service floor twice. Full reservation area need not equal host deduction where walls/unassigned space are intersected.
   - Old unflagged services are not silently upgraded; `service:true` alone does not enable reservations. Preserve their source records and explicit diagnostics.
5. **Validate destinations, not drag travel paths.** Use the existing move/resize candidates and `roomEditableError`/`roomModuleClear`. A kitchen can jump past a bedroom into a valid destination. Intermediate collision previews do not commit; a valid release commits once, invalid release/Escape preserves the old layout.
   - Lifts/stairs have free X/Y placement: no forced corners, corridor ends or corridor anchoring.
   - Evaluate access separately: retain the internal access graph, common-bathroom/ensuite relationships and prohibited pooja/bathroom adjacency. A missing connection during a multi-step edit is an explicit issue, not grounds to snap the service elsewhere.
6. **Preserve intent while regenerating.** Reuse `roomPackProgram` and the manual-layout adapter. Explicitly list unmet requests and invalid saved placements. A named starter is an opt-in proposal, not permission to reset manual layouts, pins, openings or all floors; show changed constraints before applying.
   - Current new-project defaults are one bedroom, one kitchen and two bathrooms. Suggested positions prefer bedrooms NW/NE, kitchen SE, and bathrooms S/W in geographic coordinates. These are proposal preferences, not hard constraints on manual edits.
   - Restore manual snapshots directly rather than repacking before restore. Adding a room places only the new request against the fixed current layout; preserve existing room/furniture dimensions, positions and deliberately absent starter furniture.
   - Keep stable source IDs and floor namespaces; surviving rooms are not renumbered and deleted identities are not reused. Use commands/Undo for accepted edits.
   - Rebuild through `buildScene` and existing topology/host resolution. Missing/split wall hosts remain repairable and unresolved, not rebound to the nearest wall. Retain furniture covered by reservations for relocation; do not silently delete it.
7. **Check downstream and persistence boundaries.** Reconcile net schedules, derived wall/opening geometry and current analysis input fingerprints. Keep saved edits on untouched floors. Saving is explicit/opt-in; browser storage is not a backup and navigation does not save or run analyses.
   - Distinguish legacy room-edge palette rules from canonical wall-hosted commands. The latter supports eligible internal or exterior windows; do not silently restrict the shared 2D/3D inspector to the older palette's exterior-only rule.
   - Generated and added openings use shared source-preserving suppression for deletion. Merged `sourceIds` are raw input IDs; namespace them by floor rather than treating a rendered fragment ID as the source authority.

## Do not do
- Do not introduce a second wall graph or topology engine to repair a renderer. Arbitrary wall-graph editing, nonrectangular authored rooms, general polygon/CSG and engineered stair/shaft geometry are **new capabilities**, not current editor features.
- Do not equate geometric fit with legal approval, accessible circulation or structural feasibility. An unknown wall role is not permission to remove it.
- Do not fill unknown dimensions from an unrelated default, force corridor-based service placement, overwrite saved layouts or drop unmet rooms to make a proposal appear successful.
- Do not copy another product's designs/source, or send project snapshots, coordinates or user data to public research tools.

## Validation
Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-architecture\scripts\example.py --check
```

Run from the repository root; select only the affected slice:
- Movement/placement: `node --test tests\room-movement.test.cjs`
- Reservation geometry/area/hosts: `node --test tests\planner-regions.test.cjs tests\planner-reservations.test.cjs`
- Commands, identity and projection: `node --test tests\planner-bridge.test.cjs tests\planner-foundation.test.cjs tests\room-delete.test.cjs`
- If changing plot/workspace integration: `node --test tests\plot-planner.test.cjs tests\workspace-navigation.test.cjs`

Cover contained/partial/multi-host reservations, wall-only service clashes, empty usable regions, invalid boundaries/hosts, reordered IDs, Undo/Redo and saved-layout round trips. For gestures also verify pointer cancellation, one-commit release and numeric alternatives in an isolated browser; extracted-function Node tests alone do not exercise real pointer capture.

## Output contract
Return the intended authored change and owning commands/files, project/floor identity, before/after net and reserved areas, constraint decisions, explicit unmet requests/unresolved hosts, and selected test results. Separate implemented behaviour from proposed capability work. Preserve the original plan when a requested layout cannot be represented or validated.

## Example
Synthetic calculation, from the repository root; the supplied module implies 0.12 m full walls:

```js
const Regions = require('.\\planner-regions.js');
const host = { x: 0, y: 0, w: 6, h: 5 };
const carpet = { x: 2, y: 2, w: 1.5, h: 1.5 };
const moduleBox = { x: 1.94, y: 1.94, w: 1.62, h: 1.62 };
const footprint = Regions.reservationBounds(carpet, moduleBox);
const usable = Regions.subtractRectangle(host, [footprint]);
const netM2 = Regions.area(usable);
```

Expect a 1.74 × 1.74 m reservation and approximately 26.9724 m² net host area, not a 2.25 m² deduction. Keep the 6 × 5 m authored host unchanged. Moving this lift to another valid destination restores the old host area; it does not require a corridor anchor.

## References
- [Verified public primary sources and limits](references/sources.md).
- [Equations, frames and worked calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
- [Circulation and components](../../../docs/circulation-and-components.md), [local persistence](../../../docs/local-persistence.md), [architectural drawings](../../../docs/architectural-drawings.md).
