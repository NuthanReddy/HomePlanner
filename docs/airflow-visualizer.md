# Airflow visualizer — foundation contract

This pure adapter supports the [scenario workbench](airflow-workbench.md),
[cancellable worker](airflow-worker.md), [plan overlays](airflow-display.md) and
[optional 2D potential-flow field](airflow-field.md).
It does not implement CFD or a second pressure solver. Coordinated Report
packages remain separate work. Scenarios are session drafts; this module does
not change project, environment, selection, history or files.

## Public API and dependencies

Load `planner-regions.js`, `building-physics.js`, `planner-airflow-field.js`
and then `planner-airflow.js` in a browser:
`globalThis.HomePlannerAirflow`. CommonJS: `require('./planner-airflow.js')`.
The module has no DOM, worker, network, clock or random dependencies.

```js
const {
  VERSION,             // 1
  LIMITS,              // immutable budgets below
  OUTSIDE,             // "outside", reserved scenario endpoint (not a room)
  normalizeScenario,   // (scenario) -> detached, frozen scenario, same fields
  discover,            // (drawingScene) -> AirflowInventory
  run,                 // (drawingScene, scenario, options = {}) -> AirflowResult
  compare              // (previousResult, nextResult) -> comparison
} = HomePlannerAirflow;
```

`drawingScene` must be the existing version-1 `DrawingScene` returned by
`planner.getDrawingScene()` / `HomePlannerProjection.build(project)`.
It contains **all registered floor scenes**, already in the common `site-local`
frame. Do not pass `getScene()`/`getScenes()` floor-local geometry, rebuild rooms,
recenter each floor, or infer an origin from an arbitrary plot rectangle.
Existing floor/entity IDs are opaque; every room/opening reference contains both
the exact `floorId` and `entityId`, including any existing namespace in the latter.

Optional `scenario.planField: {enabled:true, spacingM:0.5}` requests the bounded
[2D potential-flow estimate](airflow-field.md) after the existing pressure solve.
It adds `result.planField`; omission preserves the original network-only result.
No density, pressure, area or volume default is introduced. The extra mesh
spacing is a computational control, not a physical input.

The discovered room geometry retains supplied `usableRegions`, exact usable
area and its source module. Supported lift/stair reservations are subtracted
from host air regions instead of treated as generic room overlap. Full
rectangles remain the fallback only when no reservation regions are supplied.
Physical fingerprints include regions, modules and wall thickness, so related
edits invalidate both network and field evidence.

All public object returns are detached, recursively frozen, finite JSON, including
diagnostics and scenario copies. `JSON.parse(JSON.stringify(result))` is a portable
evidence record. There are no CSV/download side effects or helper-generated files.

## Version 1 scenario schema

```js
{
  version: 1,
  id: "trial-a",                  // optional nonempty text or null
  label: "Explicit pressure trial", // optional nonempty text or null
  notes: "Assumed test conditions", // optional nonempty text or null
  densityKgM3: null,              // explicit positive finite number, or unknown
  sources: {                     // optional text/null notes; not numeric defaults
    densityKgM3: null, freeAreaM2: null,
    cd: null, pressurePa: null, openFraction: null
  },
  zones: [{
    id: "living",                 // unique, not "outside"
    room: {floorId: "ground", entityId: "ground:living"},
    volumeM3: null,               // explicit positive clear volume
    volumeSource: null           // optional nonempty provenance note
  }],
  links: [{
    id: "entry",                  // unique across all links
    kind: "opening",
    opening: {floorId: "ground", entityId: "ground:entry"},
    from: "outside", to: "living", // scenario zone IDs or reserved outside
    enabled: true,               // explicit boolean
    freeAreaM2: null,             // >= 0; aerodynamic area in THIS operating state
    cd: null,                    // 0 < Cd <= 1
    pressurePa: null,            // signed finite from-to pressure forcing in Pa
    openFraction: null,          // required only when compiled state is unknown
    notes: null                  // optional provenance/assumptions
  }]
}
```

Only `version`, `zones`, `links`, each zone/link `id`, and link `kind` are
structurally mandatory. Missing physical values and missing/partial references are
repairable states, not schema exceptions. `enabled` may be absent (blocking), but
if present must be boolean, not null. `sources` may also be null.
Missing numeric values/references may be absent or null.

`normalizeScenario` validates and copies; it does **not** add defaults or erase
absent fields/nulls. Import/export preserves that distinction. Unknown fields,
typos, undefined (including nested undefined), sparse arrays, cycles, nonfinite
numbers and wrong types throw `TypeError`; invalid finite ranges, duplicate IDs,
duplicate physical room/opening references, reserved IDs, self-links, unsupported
versions/kinds and exceeded budgets throw `RangeError`. Physical identifiers that
no longer resolve produce findings from `run`, not destructive normalization.
Nonempty text is limited to 16,384 characters.

There is at most one zone per physical room and one link per physical opening,
including disabled links. Duplicate opening links cannot silently model parallel
orifices and double-count the aperture.

### Explicit manual connections

Replace `kind` and `opening` with:

```js
{
  id: "manual-riser", kind: "manual",
  from: "living", to: "upper-room",
  enabled: true, freeAreaM2: null, cd: null, pressurePa: null,
  openFraction: null,
  anchors: {
    from: {floorId: "ground", point: {x: 3, y: 4, z: 0.45}},
    to:   {floorId: "upper",  point: {x: 3, y: 4, z: 3.65}}
  }
}
```

Each anchor requires an existing registered floor and finite explicit site-local
x/y/z. **z is the absolute site-local elevation, not height above the floor.**
For a room endpoint the anchor floor must match that room's floor. An outside
endpoint still requires an explicit anchor and existing floor. Unknown anchor
fields/points/floors block an enabled link.

Manual anchors are supplied connection intent; the adapter does not establish
penetrations, verify a shaft, assert room containment of each point, or derive
pressure from height. A manual record cannot also claim an `opening` reference;
an opening record cannot replace compiled geometry with `anchors`. Cross-floor
links are possible **only** through this explicit manual contract. No generic
stair, open slab, temperature gradient, stack effect or buoyancy is invented.

## Discovery, adjacency and operating semantics

`AirflowInventory` fields:

* `version`, `kind: "AirflowInventory"`, `projectId`, `revision`,
  `physicalFingerprint`, `sourceInputFingerprint`, `coordinateSpace: "site-local"`.
* `floors`: `{floorId, elevationM, headingDeg, coordinateSpace}`.
* `rooms`: `{key, ref, label, geometry, volumeM3: null, volumeStatus}`.
  Geometry is `{rect, polygon, center, coordinateSpace}`; polygon has four x/y/z
  vertices at the modeled floor level. The rectangle is the compiled room carpet.
  No automatic volume or geometric-volume suggestion is provided: compiled wall
  height is not a verified clear room height.
* `openings`: `{key, ref, kind, wallRef, geometry, grossAreaM2,
  candidateAdjacency, adjacencyStatus, operation}`.
  Opening geometry is null if unresolved; otherwise it has `floorId`,
  `coordinateSpace`, `start`, `end`, `center`, `sillElevationM`, `heightM`,
  `widthM`. Start/end/center lie at the aperture's mid-height, computed from the
  actual compiled wall offset and base elevation.
* `findings`: `{code, reference, message, severity: "warning"}`;
  `sourceDiagnostics` preserves top-level projection diagnostics;
  `sourceFloorDiagnostics` preserves each floor's compiler diagnostics.
* `scope`: selection/reduced-model limitation.

Known adjacency requires the actual wall host, its compiled opening membership,
valid room hosts and consistent opening ownership. A full removed-wall passage
can retain its host; other openings on removed walls are unresolved.
For an exterior opening, **both** wall/opening must be exterior, exactly one room
must be known, and no interior target may be claimed. Candidate endpoints are
`[{kind:"room",floorId,entityId}, {kind:"outside"}]`.
An interior opening requires exactly two distinct current room hosts and both
exterior flags false. Candidate endpoints are two room references.
Otherwise `candidateAdjacency: null` / `adjacencyStatus: "unknown"`.
Never replace unknown adjacency with outside. A scenario may choose either
direction of the exact compatible candidate pair, not arbitrary zones.

`operation` is `{openFraction, source, semantics}`. The existing compiler emits
closed defaults for windows/doors and 1 for passages. These are honored as current
**compiled model state**, not described as measured operation. A supplied
scenario fraction cannot override a known current fraction. A mismatch blocks
with an action to edit modeled operation/review the draft or disable the link.
When the compiled value is absent/null, an explicit scenario fraction is needed
for nonzero operation. Optical transmission, potential operability and door
swing/glyph angle never establish a free portal.

`freeAreaM2` is supplied aerodynamic operating area, not gross glazing area.
The gross rectangle is only an upper bound. For known openings the adapter checks
`freeAreaM2 <= widthM * heightM * openFraction`. **It does not multiply the supplied
area again**, derive an area automatically, or silently clamp it.
Closed state with positive area blocks; change operation, supply zero area or
disable the link. Missing area remains unknown, never ghost leakage.

Disabled links and explicit zero-area links are excluded from the solver:
`effectiveAreaM2: 0`, flow zero, direction null. Unknown inactive Cd/forcing are
retained as informational findings and `awaitingInputs`, not substituted with
numbers. A disabled link may retain unresolved hosts; zero-area enabled links
must still have valid geometry/endpoints. Every selected zone still needs an
explicit volume, and the scenario still needs density, even for a sealed network.
Source compiler errors on a selected floor block solving.

## Run snapshot and results

`run(scene, scenario, {expectedPhysicalFingerprint?})` is synchronous.
The optional expected key is a guard against applying a draft prepared against
different physical inputs; a mismatch produces `stale-physical-input` and blocks.

```text
AirflowResult {
  version: 1, kind: "AirflowResult",
  status: "blocked" | "converged" | "nonconverged" | "numerical-error",
  balanced: boolean,
  provenance, scenario, inventory,
  zones, links, solverInput, solver,
  components, zoneResults, flowResults, findings, warnings
}
```

* `provenance`: `engineId: "HomePlannerAirflow"`, `engineVersion: "1"`,
  `solverId: "BuildingPhysics.solveAirflow"`, `solverContractVersion: 1`,
  `projectId`, `revision`, `physicalFingerprint`, `scenarioFingerprint`,
  `inputFingerprint`, `sourceInputFingerprint`.
* `zones`: `{id, solverId, roomRef, geometry, volumeM3, volumeProvenance}`.
  Volume provenance is `{source: "scenario-explicit" | "unknown", note}`.
* `links`: `{id, solverId, kind, openingRef, from, to, solverFrom, solverTo,
  enabled, state, freeAreaM2, effectiveAreaM2, cd, pressurePa, operation,
  geometry, grossAreaM2, awaitingInputs}`.
  State is `active`, `closed`, `disabled` or `blocked`. Operation source is
  `compiled-model`, `scenario-explicit` or `unknown`. A manual geometry record
  contains `from`/`to` anchor records, `coordinateSpace`, `isInterFloor`, and a
  label stating it is not a known opening.
* `findings`: `{code, path, message, severity: "blocking" | "info"}`.
  Paths qualify repairable values, links, references or selected floor errors.
* `solverInput` is null when validation blocks; otherwise it contains exactly the
  existing `BuildingPhysics.solveAirflow` contract with every physical input
  explicit and only active positive-area links.
* `solver` is null unless the solver returned; otherwise it is its complete,
  unchanged numerical output: `converged`, `status`, `pressures`, `flows`,
  `residualM3s`, `zoneResidualsM3s`, `toleranceM3s`, `iterations`, `references`,
  `warnings`. See [building physics](building-physics.md#solveairflowinput).

The adapter does not implement a second pressure solver. Solver IDs are opaque
JSON tuple strings (`["zone", scenarioId]`, `["link", scenarioId]`, `["outside"]`);
physical inventory keys are `["room"|"opening", floorId, entityId]`. Never split on
colon/pipe or concatenate IDs to recover references. Every raw solver result
maps through the provided exact IDs. Scenario array ordering is preserved.

`flowResults` extends each link with:

* `m3s`: signed solver flow, positive **from → to**.
* `direction`: `{from,to}` in actual sign direction, or **null** for zero.
* `meanOpeningSpeedMps`: `abs(m3s)/effectiveAreaM2`, or null for inactive area.
  This is aperture-mean speed from supplied free area, **not room/occupant
  airspeed or a spatial velocity field**.
* `numericalStatus`: enclosing converged/nonconverged status.

Use compiled opening center/start/end for a symbolic opening arrow; use the
signed zone pair to label direction. The metadata is not a CFD vector field.
There are no streamline points or inferred room flow paths.

`zoneResults` extends each zone with:
`pressurePa`, nonnegative `inflowM3s`, `outflowM3s`,
`netOutflowM3s` (solver outgoing-minus-incoming residual),
`massResidualKgS` (constant density times residual),
`directOutsideInflowM3s`, `transferInflowM3s`,
`directOutsideInflowACH`, `achLabel`, `sealed`, `deadEnd`,
`connectedToOutside`, `componentId`, `numericalStatus`.

ACH is **direct outside inflow × 3600 / explicit room volume**, only when
converged. Transfer inflow is never counted in this quantity. This is not complete
fresh-air delivery, pollutant dilution, mixing, infiltration certification or a
recirculation estimate. A room downstream of another room can have transfer
inflow and zero direct-outside ACH.

Components use only positive-area active links. Each component has
`{id, zoneIds, connectedToOutside, referenceZoneId, gauge, referencePressurePa}`.
Gauge is `outside-zero-Pa` or `arbitrary-zero-Pa`; the chosen first listed zone
matches the solver's disconnected reference. Degree zero is sealed; degree one
is dead-end. A disconnected forced cycle can circulate, while a passive tree
cannot. A single opening has zero steady net exchange; that says nothing about
real turbulent single-sided exchange. Flags refer to the **selected network**:
omitted physical openings are not asserted sealed.

Never label nonconverged results balanced. They retain raw pressure/flow/residual
diagnostics, but `balanced:false`, `status:"nonconverged"`, ACH null.
Solver numeric range failures become `numerical-error` with a finding; there is
no fallback solution. Nonfinite secondary metrics are suppressed, retain finite
raw solver evidence, and mark the entire result `numerical-error`.

## Provenance, comparisons and stale results

Fingerprints are canonical JSON strings, **not cryptographic hashes**. They are
collision-free encodings within the finite JSON domain and may be large: treat
them as opaque equality keys, not human-facing labels or filesystem names.
Object key ordering does not affect them. Scenario array order is intentional
(including disconnected gauge choice); absent versus null remains distinct.

Expected physical keys use the 16,000,000-character JSON budget, not the
16,384-character identifier/note limit. Aggregate request JSON limits still
apply; ordinary multi-floor inventories can legitimately exceed the short-text
limit while remaining well within the bounded guard contract.

`physicalFingerprint` is computed from the actual supplied registered floor
levels/headings/plots, room geometry, wall/host memberships, aperture dimensions,
current operation and source diagnostics. It never trusts a scene's supplied
fingerprint as proof of content. Same project ID and revision with replaced
geometry/operation is detected. Navigation and selected floor/room do not change
the input key. Cosmetic optical/furniture state is not airflow forcing.
`sourceInputFingerprint` preserves the shared model's supplied key separately.
`inputFingerprint` combines the actual physical and canonical scenario keys.
Revision is separate provenance, not an input-key dependency.

`compare(a,b)` returns `{version, comparable, reasons, differentProject,
geometryChanged, revisionChanged, scenarioChanged, sameInput, zoneDeltas}`.
`geometryChanged` means **physical input changes**, including operation and
diagnostics, not just mesh geometry. Different projects/physical keys, unavailable
or unbalanced results, or changed selected room sets refuse numerical deltas.
Reasons are `different-project`, `physical-inputs-changed`,
`unbalanced-or-unavailable`, `zone-selection-changed`.
Historical revision comparisons still return explicit metadata rather than
throwing or silently comparing changed buildings. Comparable room deltas are
matched by exact physical reference (not user label), and contain `roomRef`,
`directOutsideInflowM3s`, `inflowM3s` as next-minus-previous differences.

## Worker/UI and evidence boundary

The existing solver cannot be interrupted during a synchronous call.
This module does **not** accept an AbortSignal or pretend a main-thread abort
can execute while it blocks. The workbench runs it in a dedicated Worker,
terminate that Worker for cancellation, and discard messages whose request token,
project identity or actual input keys no longer match. The worker returns
the entire JSON snapshot; no subset is recomputed on a new scene.
See the separate [runner contract](airflow-worker.md).

Evidence export may serialize the entire snapshot as JSON. Future CSV/table
consumers should preserve units, provenance, scenario completeness and numerical
status and handle quoting/newlines and spreadsheet formula-prefix escaping.
No CSV helper is shipped here. Do not commit draft scenarios into the project
schema until the later package/persistence contract is approved.

## Budgets and validation

Budgets are explicit refusals, never truncation:

* Scenario: at most **128 zones / 512 links**, checked before scene traversal or
  solver invocation. Empty zones are a repairable `missing-zones` block.
* Inventory: at most **64 floors / 4,096 rooms / 16,384 openings / 32,768 walls**,
  both per collection and combined across floors.
* Each JSON validation traversal: **500,000 visited values / 16,000,000 string
  characters / 64 nesting levels**. This also bounds exported snapshots, whose
  repeated fingerprints can exceed the budget earlier than raw scene size.

The existing airflow solver uses sparse adjacency scalar balancing, not dense
factorization. It is already iteration-bounded at 4,096 sweeps and 110 bisections
per node/root, with stagnation detection. These scene/scenario budgets add
predictable size ceilings but are not a promise of main-thread responsiveness.
Do not raise limits in the UI or change solver tolerances to obtain a green status.

Run focused evidence:

```powershell
node --test tests\planner-airflow.test.cjs tests\building-physics.test.cjs tests\planner-bridge.test.cjs
```

Fixtures exercise real model/compiler/bridge projections, equal-orifice analytic
volume/pressure/speed, reversal and mass residuals, closed/unknown operation,
disabled links, exact adjacency/no automatic outside, transfer vs direct inflow,
manual inter-floor anchors, unequal floor origins, opaque namespaces,
disconnected circulation/dead ends, real numerical stalling, malformed versus
repairable states, pre-solver budgets, frozen JSON, actual-content staleness,
navigation invariance and explicitly qualified comparisons.
