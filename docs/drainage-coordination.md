# Drainage coordination — Phase 7 foundation

This is **authored intent and geometric review**, not drainage engineering.
This pure foundation supports the [drainage workbench](drainage-workbench.md),
[plan/profile sheets](drainage-sheets.md) and [3D inspection](drainage-3d.md).
It adds no separate persistence store, dependency or hydraulic solver.
The editable source remains schema-1 `floors[].authored`.
Existing records validate and JSON-round-trip without backfill or mutation.

## Load and call

Load the existing model/features/projection stack and `planner-services.js`,
then `planner-drainage.js` as classic scripts. CommonJS is also supported:

```js
const Drainage = require('./planner-drainage.js');
const allDrainage = Drainage.build(drawingScene);
const storm = HomePlannerDrainage.build(drawingScene, {systems: ['rain']});
```

The only export is frozen `{build}`. Input is a version-1 `DrawingScene` from
`HomePlannerProjection.build(project)` or the bridge, not an arbitrary JSON
document. Validate/import through the real model first. Options accept only
`systems`: a unique array from `waste`, `rain`, defaulting to both; `[]` returns
no networks. Unknown keys, water selection, duplicate systems, null options and
explicit undefined systems are errors. No tolerance/capacity/code options exist.
Absent options use the default. There are no caches, DOM calls or network calls.

The complete `HomePlannerServices.build(drawingScene)` graph is built first,
including water. Output selection must not hide a crossing water pipe or a
wall/member on another floor. Selected drainage nodes/routes are detached copies;
fixtures are not repeated in the drainage result. Original service output is
unchanged. Only this drainage build removes `rain-coordination-deferred` from
its copied findings/issues and rephrases the global engineering/unknown-slope
messages. Standalone core consumers do not thereby gain drainage analysis.

## Compatible saved fields

Original required fields, system/circuit validation, size limits, references and
anchor semantics remain unchanged. All numeric fields are finite and magnitude
at most 1e9. Text follows the existing nonempty, no-controls, 16384-character
limit. Unknown keys and explicit undefined are rejected.

| Scope | Additional optional field | Values and meaning |
| --- | --- | --- |
| Node | `groundM`, `finishedFloorM` | signed number/null; independently supplied project-relative levels, **not** offsets from owner-floor elevation |
| Node | `levelSource` | null / `assumed` / `surveyed` / `engineer-provided` |
| Node | `levelReference` | text/null; unverified reference for supplied level inputs including invert |
| Node | `accessRadiusM` | nonnegative number/null; explicit plan review radius, not a regulatory distance |
| Outlet-kind node only | `discharge` | null or exactly `{kind, reference}`; reference text/null |
| Route | `viaInvertsM` | array of number/null, exactly matching `via.length` and order; no holes/undefined; array itself cannot be null |
| Route | `slopeSource` | same nullable enum as `levelSource` |
| Route | `slopeReference` | text/null; unverified claimed provenance for supplied slope |
| Route | `clearanceM` | nonnegative number/null; supplied radial review distance, not a statutory or engineered allowance |

Discharge kinds are `sewer`, `surface-outfall`, `soakaway`, `septic`, `reuse`,
`other`. Even explicit `discharge: null` is accepted only on an outlet-kind
node. A choice is not a proven external connection, permission, capacity or
destination design. Unknown/absent discharge never means sewer.

The base kind remains required and explicit:

| Base kind | Accepted non-null role |
| --- | --- |
| fixture | port, fixture, trap, **floor-trap, gully-trap, roof-outlet** |
| junction | junction, stack, valve, trap, cleanout, **chamber, downpipe** |
| supply | supply |
| outlet | outlet, **outfall** |

Unknown role typos and role/base-kind mismatches reject. Unusual purpose/system
combinations remain editable but diagnosed by the shared services core:
water/vent traps, cleanouts and chambers; non-water valves/supplies; water
outlets; non-rain roof outlets/downpipes; non-waste floor traps. These are intent
review warnings, not code or capacity rules. Roles do not generate equipment,
fittings, chambers, roof terminals, downpipes or shafts.

Sanitary waste is system `waste`, circuits `soil`/`waste`. Vent stays circuit
`vent` but is not a gravity drain. Storm remains system `rain`, circuit `storm`.
System membership and circuit are never inferred from neighboring records or
purpose labels. No new parallel drainage graph is saved.

Metadata survives existing bridge upsert/set-authored, JSON import/export,
floor duplication, deletion and undo/redo. Duplication remaps explicit same-floor
references and anchors, not textual provenance references, supplied levels or
invert-array values. External-floor anchors remain external.

## Exact frozen output

The result is a deeply frozen, detached, plain-JSON object, with these exact
top-level keys:

```js
{
  version: 1, projectId, revision, inputFingerprint,
  nodes: [/* below */],
  routes: [/* below */],
  findings: [/* below */],
  engineeringStatus: 'not-assessed'
}
```

Every node contains the existing core keys:

```js
{
  id, floorId, system, kind, role, label, circuit,
  anchor, diameterMm, invertM, issues,
  groundM, finishedFloorM, levelSource, levelReference, accessRadiusM, discharge,
  componentId,
  invertBelowGroundM, finishedFloorAboveGroundM
}
```

Core nullable metadata and anchors retain the [services contract](plumbing-networks.md).
Added optional saved fields become null only in the disposable output when
absent. `discharge` is null or a detached copy of the supplied object.
`invertBelowGroundM = groundM - invertM` and
`finishedFloorAboveGroundM = finishedFloorM - groundM` only when both respective
inputs exist; otherwise null. Neither needs nominal diameter because neither
claims pipe cover. There is **no coverDepthM**: nominal pipe size does not
establish actual outside height, wall thickness or invert/axis relationship.
Supplied FF/ground comparisons do not use a terrain or floor plane.

Every route contains:

```js
{
  id, floorId, system, label, circuit, from, to, via, points,
  diameterMm, slope, lengthM, isRiser, issues,
  viaInvertsM, slopeSource, slopeReference, clearanceM, componentId,
  gravityStatus, // 'applicable' | 'not-applicable' | 'unknown'
  profile: {
    invertsM, stationsM, segments,
    horizontalLengthM, axisLengthM,
    planComplete, invertFallAvailable, invertProfileComplete, profileComplete,
    measuredFallM, measuredGradient, expectedFallM, slopeDifferenceM
  }
}
```

`viaInvertsM` is a copied supplied array, or an array of nulls matching `via`.
`points` and `via` retain the shared core's physical geometry, including holes.
`axisLengthM` repeats core `lengthM` explicitly to distinguish it from horizontal
run. `gravityStatus` is `not-applicable` for a vent route; otherwise `applicable`
only for an explicitly soil/waste or storm route without circuit contradiction
or a mixed-circuit endpoint component. Other intent is `unknown`; no circuit
default is selected. “Applicable” does not mean safe, verified or compliant.

Each segment has exactly:

```js
{
  fromIndex, toIndex, horizontalRunM, axisLengthM,
  measuredFallM, measuredGradient, verticalDrop,
  expectedFallM, slopeDifferenceM
}
```

All missing scalar measurements are null, not undefined/NaN/Infinity or guessed
zeroes. `verticalDrop` and completeness/availability fields are booleans.
Arrays preserve authored traversal/physical point order.

Each finding has exactly:

```js
{
  code, severity, floorId, entityIds, message,
  componentId,
  entityRefs: [/* {floorId, entityId} */]
}
```

Severity is `warning`, except inherited `network-cycle` which remains `info`.
Global findings have null floorId/componentId. Entity issue codes deduplicate;
findings may repeat for individual segments or endpoint totals. New
multientity findings use exact pair-qualified `entityRefs`, including unselected
water routes and other-floor members. Related selected routes also receive the
new finding's issue code; one pair finding covers both records. Core findings preserve original
`entityIds` verbatim; their `entityRefs` identify only the selected owner because
the core does not qualify related IDs. Do not guess a related floor from a raw
core ID. Findings whose core owner is an unselected network or fixture are
excluded; global core warnings remain, including unknown represented solids.

`componentId` is the JSON pair string `[floorId,id]` of the first authored node
in a weak component. It is shared by its nodes, compatible routes and owned
findings. It is contextual identity for this snapshot, **not** a saved ID:
reordering or graph edits can change it. Components use the core's same-system,
noncontradictory edge rules. Excluded/dangling/mismatched routes have null
componentId, never a borrowed connection. Missing outlets, unknown destinations
and unknown outlet inverts are reported separately within each component.
The presence of an outlet does not establish directed reachability.

Use projectId + inputFingerprint + selected systems to validate reuse.
Revision alone is insufficient: same-ID/revision replacements can change the
fingerprint; history restores content with new revisions. A built result never
updates itself and is never written into project JSON.

## Profile rules and numerical meaning

- Physical points are from the existing projection/services graph in site-local
  metres. Floor elevations have already been applied once. No invert or slope
  changes an axis point.
- Invert stations are `[from.invertM, ...viaInvertsM, to.invertM]`. Wrong-system
  or missing endpoints yield null invert stations. Anchor z is **not** invert,
  terrain, a pipe centerline guarantee, or an outside pipe level.
- Horizontal station starts at 0 only when the first point resolves, and
  accumulates consecutive XY Euclidean runs. A missing span makes that and all
  subsequent cumulative stations null; no jump bridges it. Local later segments
  can still have measured runs/falls. Total horizontal run is null if any point,
  aggregate resolution or numeric accumulation is unresolved.
- A segment fall is invert A minus invert B, only with both supplied levels and
  applicable gravity intent. Segment gradient is fall/run only when run exceeds
  1e-7 m. Axis length separately uses XYZ Euclidean distance.
- Pure vertical drop has zero/sub-tolerance run, positive supplied fall and
  `verticalDrop: true`; its gradient is null, never infinity. Coincident axis
  points retain the core zero-length warning even if entered inverts differ.
- Known endpoints permit total `measuredFallM` even if internal invert stations
  or geometry are unknown. `invertFallAvailable` expresses that independently
  of length. `invertProfileComplete` requires all supplied invert stations and
  applicable gravity intent. `planComplete` requires complete horizontal
  geometry; `profileComplete` requires both. Never present known endpoint fall
  or an average gradient as proof of complete internal falls.
- With complete plan points, positive horizontal run and supplied slope,
  expected fall is run × slope. Total expectation is null for incomplete plan
  geometry or zero run. Segment expectations likewise require complete plan
  points. There is no interpolation through missing via inverts.
- `slopeDifferenceM` is measured minus expected fall when both exist. Difference
  exceeding **1e-6 m** causes `slope-intent-mismatch`; reverse/zero falls and
  explicit zero slope receive separate warnings. These are numerical review
  tolerances, not regulatory minima, physical accuracy or a design pass.
  Unknown internal intervals remain incomplete even when endpoint intention
  happens to agree. Nothing is automatically adjusted.
- Vent and unresolved/mixed-circuit intent retains physical lengths and supplied
  invert arrays but gravity falls, gradients and expectations are null, with
  explicit not-applicable/unresolved warnings.

## Coordination, boundary and access rules

1. **Core axis/solid checks:** reuse full services build for actual represented
   wall solid sections and supported structural boxes across all floors.
   Unknown extents and unsupported geometry remain warnings. No duplicated
   penetration logic, aperture approval or fabricated wall/shaft geometry.
2. **Actual property bounds:** compare selected node/route points with the
   projected owner's actual `scene.plot`, never `scene.floor` or buildable
   setbacks. For straight-segment polylines in a convex rectangular plot,
   checking every endpoint/via vertex is sufficient for axis containment,
   including diagonal segments. Null points make the check incomplete.
   This excludes pipe/access envelopes, easements, surveyed boundary proof and
   permissions. External outfalls outside the plot are review warnings, not
   rejected authoring. Plot registration remains a shared-projection assumption.
3. **Route pairs:** compare real 3D line segments for every route pair with at
   least one selected drainage route, including water and unselected drainage.
   Potential envelope conflict requires known positive nominal diameters and
   positive supplied clearances for **both** routes:
   distance <= diameterA/2000 + diameterB/2000 + clearanceA + clearanceB
   (plus 1e-7 m tolerance).
   These are nominal-size-plus-review-distance envelopes, not verified outside
   pipe surfaces. Skew, parallel and coincident/degenerate segments are handled;
   a plan crossing with adequate z separation does not become a 3D hit.
   Shared connection endpoints can be candidates too; joint internals are not
   modeled or automatically exempted. No self-route/bend envelope check exists.
   Missing or explicit zero clearance does not become a safe default.
   `route-pair-clearance-unknown` reports the first incomplete pair per owner;
   additional unknown pairs are not individually listed. Per-route unknown
   diameter/clearance warnings remain. Selection does not imply exhaustive
   water-only coordination.
4. **Shared riser review:** coincident XY vertical segments with overlapping
   nonzero z ranges produce `shared-riser-zone-needs-review` even without
   diameter/clearance. Cross-floor diagonal `isRiser` flags alone do not qualify.
   The finding describes overlapping proposed routes, not an invented shaft.
5. **Access:** supplied node circles are compared with represented wall-section
   and structural footprints across all floors. Known plan width/depth may
   support a candidate even when structural height is unknown. Circles versus
   oriented rectangles use nearest-point distance, not a box-diagonal proxy.
   `access-review-plan-only` always accompanies supplied radius:
   vertical working extent/access height is unknown, so even remote-height
   footprint overlap is only `access-plan-candidate`, not a physical clash.
   Explicit zero is retained as a zero-radius review point, not a compliant
   access provision. Unknown radius is not given a default.

## Finding codes added here

Existing selected-owner/core global findings remain except the specifically
rephrased/removed scope messages above. Added codes are:

- Context and external conditions: `plot-frame-assumption`,
  `unknown-plot-boundary`, `incomplete-property-check`,
  `outside-property-boundary`, `unknown-discharge-destination`,
  `unknown-outfall-level`, `discharge-not-assessed`.
- Levels/provenance: `unknown-ground-level`, `unknown-finished-floor-level`,
  `unverified-level-provenance`, `unverified-slope-provenance`,
  `cover-depth-not-assessed`, `invert-above-ground`, `finished-floor-below-ground`.
- Profiles: `vent-gravity-not-applicable`, `gravity-circuit-unresolved`,
  `profile-precision-limit`, `incomplete-invert-profile`,
  `incomplete-horizontal-profile`, `reverse-fall`, `zero-fall`,
  `vertical-drop`, `zero-slope-intent`, `slope-intent-mismatch`.
- Review geometry: `unknown-clearance`, `zero-clearance-intent`,
  `route-pair-clearance-unknown`, `potential-route-envelope-conflict`,
  `shared-riser-zone-needs-review`, `unknown-access-radius`,
  `access-review-plan-only`, `access-plan-candidate`.

An empty local issue list, agreement with intention, supplied “surveyed” source
or selected destination **never** becomes engineering approval. Global
`engineering-not-assessed`, `coordination-incomplete` and unsupported-equipment
warnings remain. No sewer/infiltration capacity, septic sizing, rainfall/runoff
design, ground water, soil, pumps, tanks, safe cover, flood safety, maintenance
access compliance or pipe-flow capacity is inferred.

## Workload bounds and validation

All [services foundation bounds](plumbing-networks.md#workload-bounds) apply
before selected-system filtering, including its separate 1,000,000 axis/solid
comparison budget. The drainage layer has a further combined **1,000,000**
budget for eligible route-pair overhead + known segment-pair comparisons +
access-circle/footprint comparisons. Route-pair work is counted analytically
before quadratic evaluation; excessive density throws a descriptive RangeError
before candidate output. Access comparisons are also counted before their loop,
share the remaining budget and throw on exhaustion. No partial result or silent truncation is returned.
Pair selection avoids scanning all unselected/unselected combinations.
Graph traversal and deep freezing are iterative.

Run:

```text
node --test tests\planner-drainage.test.cjs tests\planner-services.test.cjs tests\planner-foundation.test.cjs tests\planner-phase1-regressions.test.cjs
```

Tests exercise strict additive schema and exact old JSON, actual shared
projection/bridge history and duplication, claimed provenance, separate storm
and sanitary/vent intent, 10 m × .02 = .2 m falls, unequal-floor vias,
unknown stages, reversal, vertical/coincident geometry, component-local outlet
unknowns, actual plot rather than setback boundaries, full-service 3D crossings
and near misses, missing clearance, plan-only access, shared riser candidates,
immutable replacement provenance and bounded dense work.

Authoring, plan/profile sheets, Report exports and optional 3D inspection use
this same contract. Browser journey evidence does not establish hydraulic
capacity, compliant access or a safe discharge connection.
