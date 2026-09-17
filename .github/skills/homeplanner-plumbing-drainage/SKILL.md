---
name: homeplanner-plumbing-drainage
description: "Use for HomePlanner service nodes/routes, fixture ports, water/waste/storm separation, invert profiles, drainage gradients, connectivity and coordination findings, plumbing/drainage workbenches, sheets and 3D. Triggers include 'plumbing network', 'drainage slope', 'pipe clash', 'outfall level', and 'water network validation'. Distinguish pressure-network inputs from gravity drainage and implemented geometry from hydraulic sizing; retain unknowns and use shared commands and snapshot protections."
---

# Plumbing and drainage intent

## When to use

Use for service-network modelling, connectivity, geometric profiles, coordination
and reports. Keep pressurised water distinct from sanitary gravity drainage,
stormwater and vent intent. Current diagrams are not hydraulically sized networks;
modelled quantities and professional certification must remain separate.

## Repository anchors

Inspect the current code contracts and relevant tests before changing them.
Do not infer an installed hydraulic solver from the references below.

- `planner-features.js`: authored `fixtures`, `serviceNodes`, `serviceRoutes`;
  strict systems/circuits/roles, optional levels/provenance and `viaInvertsM`.
- `planner-projection.js`, `planner-bridge.js`: shared anchor resolution,
  `getDrawingScene`, `inputFingerprint`, authored commands and history.
- `planner-services.js`: pure `HomePlannerServices.build`, topology and XYZ lengths.
- `planner-drainage.js`: pure `HomePlannerDrainage.build`, profiles and geometric
  coordination over the shared service graph, including other systems.
- `planner-services-ui.js`: shared controller; `planner-drainage-ui.js` selects
  `{domain: 'drainage'}` rather than implementing a second editor/store.
- `planner-services-drawing.js`, `planner-drainage-drawing.js`,
  `planner-drawing-ui.js`, `planner-drawing-export.js`, `planner-3d.js`:
  disposable representations and the existing Report/export pipeline.
- [Networks](../../../docs/plumbing-networks.md),
  [drainage contract](../../../docs/drainage-coordination.md),
  [plumbing workbench](../../../docs/plumbing-workbench.md),
  [drainage workbench](../../../docs/drainage-workbench.md),
  [drainage sheets](../../../docs/drainage-sheets.md),
  [Report](../../../docs/drawing-report.md),
  [plumbing 3D](../../../docs/plumbing-3d.md),
  [drainage 3D](../../../docs/drainage-3d.md).

## Required inputs

- For modelling: exact `(floorId, entityId)` endpoint references, explicit
  system/circuit and node kind/role, supplied anchors/ordered vias and provenance.
  Coordinates/lengths are metres, nominal `diameterMm` is millimetres, `slope`
  is nonnegative fall/run. Unknown physical values remain `null`, not zero.
- For geometric gravity profiles: independently supplied endpoint/via inverts,
  horizontal route geometry, explicit sanitary/storm circuit, and supplied slope
  when comparing intention. Ground/finished-floor/outfall levels and discharge
  purpose remain independent inputs, with sources and unresolved values visible.
- Before any future **pressurised-water hydraulics**: topology, pipe lengths and
  internal diameters, roughness formula/coefficient/units, demands and time patterns,
  fluid/unit conventions, supply head/pressure boundaries, and relevant pump,
  valve, loss and storage data. The current schema does not hold a full solver model.
- Before any future **gravity/storm hydraulics or sizing**: cross sections and
  diameters, roughness, connected invert/slope profile, inflows, outfall/tailwater
  boundaries and discharge evidence. Runoff additionally requires declared rainfall
  units/duration, catchments, losses/infiltration, storage and routing method.
- Engineering work also needs current jurisdiction/code edition, design criteria
  and qualified review. Stop with missing inputs or unsupported methods rather
  than populating records with assumed sizes, demands, coefficients or levels.

## Workflow

1. **Choose implemented scope.** Read source applicability before using numerical
   thresholds. `Services.build` supports selected water/waste/rain intent;
   `Drainage.build` accepts waste/rain only and builds the complete services graph
   first. Core services do not calculate hydraulics or drainage fall; drainage
   adds geometric invert comparisons, not pressure, capacity or runoff.
2. **Capture and retain.** On explicit refresh capture one immutable DrawingScene
   for core and sheet consumers. Reuse project ID, revision, canonical input
   fingerprint and selected systems/options for freshness. Same ID/revision can
   hide changed inputs; invalidate results and pending exports through the
   existing controllers/task-generation guards rather than publishing stale output.
3. **Resolve ownership and coordinates.** New point/via inputs are owner-floor
   plate-local x/y and floor-relative z. Projected anchors are site-local x/y
   and project-relative z; floor offsets/elevations are already applied once.
   Node invert, ground and finished-floor values are independently supplied
   project-relative levels, not offsets or substitutes for anchor z.
4. **Check explicit topology.** Compare exact endpoint pairs, system and circuit.
   Water cold/hot, waste soil/waste/vent, and rain storm do not auto-convert.
   Check dangling endpoints, disconnected nodes/fixture ports, mixed components
   and direction conflicts. Each weak component needs its own explicit supply
   or outlet; presence does not prove directed reachability or external capacity.
   Water cycles can be intentional. Proximity and fixture symbols do not create ports.
5. **Measure only supported geometry.** XYZ route length sums consecutive resolved
   points; any unresolved span makes total length null, not a partial total.
   Gravity stations accumulate XY run; inverts follow
   `[from.invertM, ...viaInvertsM, to.invertM]` without interpolation.
   Fall is upstream minus downstream invert; gradient is fall/horizontal run
   only for a usable nonzero run. Vertical drops have null gradient, not infinity.
   Compare supplied slope × complete run to measured fall without changing either.
   Keep endpoint-fall availability separate from complete internal profiles.
   Vent and unresolved/mixed gravity intent do not acquire gravity results.
6. **Coordinate within implemented limits.** Retain wall/structural axis-crossing
   findings across represented floors. Drainage compares actual 3D route pairs,
   including crossing water routes, using nominal-size plus supplied review
   clearance only when the required inputs exist. Null/zero clearance is not a
   verified safe envelope; nominal diameter is not verified outside diameter.
   Review fixture ports and supplied fixture dimensions; full pipe-to-fixture
   solid clash checking is not implemented by these cores, so report it unassessed.
   Node access checks are plan-only wall/member candidates, not clearance approval.
7. **Review levels and discharge honestly.** Check reverse/zero falls, slope-intent
   mismatch, missing intermediate inverts, outfall levels and component-local
   discharge unknowns. Invert-below-ground is not cover depth; do not infer
   `anchor.z = invert + diameter/2`, terrain, shafts or a sewer connection.
   Software tolerances are numerical comparisons, not minimum design gradients.
8. **Keep hydraulic checks explicit.** Current flow/head/demand outputs do not
   exist: mass balance is **not evaluated**, not zero residual or a pass.
   For a separately authorized, actually implemented hydraulic method, use
   declared units/signs and verify nodal mass balance, link energy/head relations
   where applicable, storage/inflow/outflow continuity, convergence and boundary
   behavior against applicable analytical/solver fixtures. P1–P3 guide evidence;
   they do not authorize installing/running EPANET or SWMM as a hidden side effect.
9. **Save and present through shared contracts.** Require explicit user saves via
   `upsert-authored`/`delete-authored`. Preserve hosted/null/cross-floor anchors and
   vias during metadata edits; waypoint replacement must explicitly retain or
   repair the matching ordered `viaInvertsM`. Preserve optional absence and
   outlet-only discharge metadata. Keep dangling surviving references repairable.
   Reuse shared Undo/Redo, complete `createSheets` output, fixed print scale and
   Report cancellation. Plan/riser/profile/3D arrows are authored order, not flow;
   3D lines and points are nonphysical symbols, never editable pipe geometry.

### Example: endpoint agreement is not a complete drain

Synthetic supplied sanitary route: 8 m straight horizontal run, three resolved
axis points, endpoint inverts 1.50 m and 1.34 m, one unknown via invert and
supplied slope `0.02`. Expect endpoint fall 0.16 m and agreement with the intended
total fall, but `invertProfileComplete: false`, `profileComplete: false` and an
`incomplete-invert-profile` finding. Do not interpolate the missing invert,
change axis z, size the pipe or call the network compliant. These values are
test inputs, not a prescribed gradient or a real plan change.

## Do not do

- Do not infer hydraulic sizing, pressure adequacy, safe cover, minimum gradients,
  septic/infiltration capacity, flood safety or permitted discharge from drawings.
- Do not invent fittings, fixture ports, clearances, roughness, demands or outfalls;
  do not silently rewire systems, bridge null gaps or drop unresolved records.
- Do not create an independent editable network in a renderer, automatically
  mutate a user's live plan, or save derived findings into authored data.
- Do not fetch external data without user action. Never send private code,
  coordinates, project data or user records to web services.

## Validation

Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-plumbing-drainage\scripts\example.py --check
```

Run the smallest real existing `node --test` selector(s) for the affected contract,
from the repository root. Combine related selectors, not every suite by default.

| Scope | Existing selector |
| --- | --- |
| Network/profile cores | `node --test .\tests\planner-services.test.cjs .\tests\planner-drainage.test.cjs` |
| Authoring | `node --test .\tests\planner-services-ui.test.cjs .\tests\planner-drainage-ui.test.cjs` |
| Sheets | `node --test .\tests\planner-services-drawing.test.cjs .\tests\planner-drainage-drawing.test.cjs` |
| 3D layers | `node --test .\tests\planner-services-3d.test.cjs .\tests\planner-drainage-3d.test.cjs` |
| Shared Report/export | `node --test .\tests\planner-drawing-ui.test.cjs .\tests\planner-drawing-export.test.cjs` |

Check independent elevations, mm/metre conversion, signed fall, vertical/null
profiles, disconnected/mismatched systems, fixture-port retention, structural
crossings, 3D near misses, stale replacement, immutability and JSON/history.
Test software behavior, not professional approval; report unimplemented checks.

## Output contract

Return snapshot and selected systems; qualified node/route IDs and topology;
supplied/null dimensions and levels; XY/XYZ lengths and profile completeness;
finding codes, missing solver inputs, source applicability and proposed explicit
repairs; complete report scope; and actual test command/results.
Retain `engineeringStatus: 'not-assessed'`, identify mass balance as unassessed
until a solver actually exists, and disclose standard/access/adoption uncertainty.

## References

[Verified primary-source notes, P1–P3](references/sources.md), checked
**17 Sep 2026**. EPA reference solvers are not HomePlanner runtime dependencies.

- [Continuity, invert and separate hydraulic equations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
