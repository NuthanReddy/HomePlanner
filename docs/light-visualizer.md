# Room light foundation (Phase 9)

## Metric decision and benchmark gate

This foundation selects **normalized cosine-weighted sky access** at explicit
horizontal room workplane sensors:

`A = (1 / pi) integral(upper hemisphere) T(direction) cos(theta) dOmega`.

`T` is the product of supplied physical path transmissions. This is uniform-sky
geometric visibility (optionally transmission weighted), **not daylight factor,
indoor lux, illumination adequacy, solar irradiation, or artificial photometry**.
No interreflection, sky brightness distribution, weather, annual daylight model,
ground reflection, furniture inference or electrical-light emission is included.
Day/night applies to the sun sample, not this time-independent geometric index.

The deterministic quadrature uses equal cells in azimuth and `u = sin²(theta)`,
with midpoints in both coordinates. Each ray has equal cosine-integral weight.
Refinement doubles both axes, partitioning the same domains; midpoint nodes are
not reused. Workplane refinement halves cell spacing on the same room rectangle.
These are numerical parameters, never room sizes or physical geometry.

Before numerical release, tests must establish full sky = 1, full block = 0,
half hemisphere = .5, and an independently integrated rectangular aperture.
The aperture reference integrates `d*z/(d²+x²+z²)² / pi` over a vertical opening,
including the far-face reveal of the finite wall thickness. Compare at successively
doubled directional resolution and spatial grids. Discontinuous shadow boundaries
can alias: no monotonic convergence or universal error guarantee is claimed.

Window modes must be explicit: `ideal-clear` assumes closed windows are ideal
clear geometric apertures; `visible-transmission` uses an explicitly supplied
visible transmittance, not the irradiance module's solar transmittance or SHGC.
Doors retain their supplied spatially averaged operating fraction. Neighbor and
facade boxes use their supplied physical transmittance, once per physical object.
Partial transmission produces a path weight, not a fractional count of hours:
positive-path-presence hours and transmitted-equivalent sun hours are separate.

## Entry points and dependencies

`planner-light.js` exports frozen `HomePlannerLight` in browsers and the same
CommonJS object: `VERSION`, `LIMITS`, `CONFIG_SCHEMA`, `normalizeConfig`, `discover`, `createStudy`,
`run`, `compare`. Load the existing `BuildingPhysics` and `HomePlannerProjection`
globals first. There is no DOM, network, worker construction, astronomy engine,
saved-record mutation, rendering, export or artificial-light calculation here.
The existing whole-house `sun-exposure.js` study is unchanged.

- `normalizeConfig(config)` strictly validates and returns detached frozen JSON.
  It preserves absent/null repairable controls rather than inserting defaults.
  Unknown keys, numeric strings, nonfinite numbers, malformed geometry/ranges,
  duplicate references, non-JSON/cyclic/sparse data and ambiguous times throw
  `TypeError`/`RangeError`. This API does not coerce saved data.
- `CONFIG_SCHEMA` is frozen JSON Schema for the executable configuration shape,
  suitable for future control discovery without another hand-maintained schema.
  Draft missing/null controls remain repairable through `normalizeConfig`.
  Cross-field interval order/midpoints, unit-vector norm, physical references,
  IANA zones and combined computational budgets still need `createStudy`'s
  semantic validation; shape validation alone is not execution approval.
- `discover(drawingScene)` consumes `Projection.build()` / bridge
  `getDrawingScene()` version-1 `DrawingScene`, **all** registered floor scenes.
  It returns `{version, projectId, revision, sourceFingerprint,
  physicalFingerprint, floors, rooms, openings, electrical, findings}`.
- `createStudy(drawingScene, config, {expectedPhysicalFingerprint?})` validates
  inputs, prepares sensors and compiles the shared kernel. The optional expected
  key is **`discover().physicalFingerprint`**, not the study's augmented key.
  A stale key or missing physical/control reference creates a repairable
  `blocked` result; it does not run a guessed model.
- The frozen accumulator exposes `step(maxRays=4096)`, `progress()`,
  `getResult()`, `finalize()`, `cancel()`. All returned snapshots are detached,
  recursively frozen finite JSON. The accumulator itself contains methods and
  should not be posted to a worker; create it inside the worker.
- `step()` does **at most** the requested number of receiver operations
  (including zero-ray night/unresolved mask entries), then yields control to its
  caller. It performs sky work first, then the supplied chronological samples.
  Sky output for an unfinished sensor is null; a direct interval mask is
  committed only when all its sensors have finished. `progress.processedRays`
  counts actual intersection rays, not those zero-ray entries.
- `finalize()` is terminal. Calling it early does not finish the remaining work:
  it returns `incomplete`. `cancel()` is terminal and returns `cancelled`.
  Further `step()` calls do nothing. Completed component/subtotal evidence stays
  available, explicitly separated from guarded full-period totals.
- `run()` synchronously steps and finalizes. Use it for bounded tests or inside
  a worker, **not** as a main-thread cancellation strategy. For a responsive
  worker, yield its event loop between `step()` calls to receive cancellation.
  Neither preparation nor one bounded batch is asynchronously interruptible.
- `compare(first, second)` returns `{comparable, reasons, revisionMetadata,
  deltas}`. Incomplete studies, different project/physical content/sensors,
  optical/context definitions, periods, horizon cutoffs or sky enablement return
  `deltas:null` and exact reason codes. Revision history alone does not prevent
  comparison. Same-sensor numerical quadrature and sun-forcing experiments can
  compare; changed sensor density requires convergence evaluation, not paired
  sensor subtraction.

### Explicit sky-only studies

`direct: {enabled: false}` requests only the time-independent sky-access
calculation. It requires `sky.enabled: true`, `samples: []`, and a null or absent
`period`; retained intervals or a retained period are rejected, never silently
discarded. No location, date, time or solar horizon cutoff is required.
`minSunAltitudeDeg` may be absent/null, but if supplied must still be strictly
between 0 and 90 degrees. Explicit workplanes, numerical sky quadrature,
window optics and physical context retain their existing contracts.
Omitting `direct` preserves legacy direct-sun behavior and required period and
horizon controls; normalization never inserts an enablement choice.

For a floor-level whole-house map, callers explicitly provide `heightM: 0` for
each actual inventory room, without editing geometry or guessing a workplane
height. The shared receiver kernel includes all registered physical floors.
An explicit `ideal-clear` window assumption must remain prominently labeled.
Unknown neighbors or roof context still produce null primary sky values and
finite, explicitly labeled supplied-model-only fractions, not a claim of clear
surroundings, complete physical evidence or lux.

Sky-only results have `direct.status: "disabled"`, `direct.complete: false`,
no masks and null direct hour fields, including all sensor subtotals. Ray budgets
include no direct rays; interval progress stays zero while actual sky rays are
counted. Overall `complete` can become true after finalization when all requested
sky work and physical context are complete; this never means direct hours were
computed. Early finalization and cancellation preserve incomplete sky evidence.
The full config fingerprint includes explicit direct enablement. Comparison
rejects mixed enablement with `different-direct-metric-enablement`; two complete
sky-only studies compare sky fractions only, with null hour deltas.
The dedicated runner validates completion against requested sky evidence rather
than requiring direct completion. It rejects disabled-direct responses containing
direct rays, masks, interval progress or numeric hour totals/subtotals. Tests
exercise both known and unknown context through the actual worker script in an
isolated worker thread, as well as deterministic browser-protocol fixtures.

## Complete configuration shape

This is an explicit **analytical example**, not recommended operating/design
inputs. Required fields may be absent/null in a repairable draft, but execution
requires them except for the sky-only solar controls above.
`id`, `label`, `site`, `roofContext`, and `direct` are optional.

```js
{
  version: 1,
  id: "room-study", label: "Selected interval experiment",
  workplanes: [{
    id: "desk-plane",
    room: {floorId: "ground", entityId: "ground:living"},
    heightM: 0.8, // relative to this floor's already-projected elevation
    spacingM: 0.5 // numerical maximum cell spacing, NOT room dimensions
  }],
  sky: {enabled: true, radialBands: 16, azimuthSectors: 64},
  // Or sky: {enabled: false}; disabled means unavailable, not zero.
  windowOptics: {mode: "ideal-clear"},
  // Alternative, both fields required:
  // {mode:"visible-transmission", visibleTransmittance:0.6,
  //  source:"Explicit hypothetical visible optical property"}
  neighbors: {
    front: {state: "unknown"},
    right: {state: "clear"},
    rear: {state: "modeled", boxIds: ["north-house"]},
    left: {state: "clear"}
  },
  neighborBoxes: [{
    id: "north-house", x: 1, y: 12, w: 4, h: 6,
    baseM: 0, heightM: 8, transmittance: 0
  }],
  // Optional declarations, one per floor. "none" is an explicit assumption,
  // never an automatic consequence of absent height/slab data.
  roofContext: [{
    floorId: "terrace", state: "none",
    source: "Explicit open workplane fixture with no ceiling or roof"
  }],
  minSunAltitudeDeg: 1,
  period: {
    startUTC: "2026-09-15T06:00:00Z", endUTC: "2026-09-15T07:00:00Z"
  },
  samples: [{
    startUTC: "2026-09-15T06:00:00Z", endUTC: "2026-09-15T07:00:00Z",
    sampleUTC: "2026-09-15T06:30:00Z",
    sunENU: {east: 0, north: 0, up: 1}
    // Alternatively sunAnglesDeg: {altitudeDeg:45, azimuthDeg:180}
  }],
  site: {latitudeDeg:17.385, longitudeDeg:78.4867, timeZone:"Asia/Kolkata"}
}
```

Neighbor states are `unknown`, `clear`, `modeled`; omitted sides are unknown.
`modeled` requires existing IDs in `neighborBoxes`, and every supplied box must
be referenced. All boxes participate regardless of side or selected floor.
Side labels do not rotate or place boxes: **x/y/baseM are physical site-local
coordinates**, not gap distances. Large/corner buildings may be referenced by
multiple sides but their box is applied once. Boxes do not become infinite
screens. Facades already in projected `obstacles` remain physical casters.
Neighbor boxes are reconciled against projected obstacle IDs and explicit
`sourceId` aliases before caster compilation. An exact identity, extent, type
and transmittance match reuses the project caster once, with an informational
`reused-project-obstacle` finding; its supplied side context and the original
configuration/provenance remain intact. A shared identity with different extent,
type (including tree versus neighbor building), or material blocks the study.
Identical extents under different identities are ambiguous physical duplicates
and also block pending explicit identity/geometry review, including duplicate
study boxes. Near or partially overlapping independently identified boxes are
not deduplicated or blocked: each still attenuates intersecting rays. Exact
canonical extent/identity hash indexes bound this preparation without pairwise
box comparisons.

`roofContext.state` is `none`, `unknown` or `supplied`, with exact `floorId` and
nonempty `source`. `none` cannot remove an existing supplied roof. A missing
roof location/thickness with no explicit absence declaration stays unknown.
An explicit zero roof thickness denotes a supplied opaque plane; null/absence
does not. Explicit gaps between stacked supplied roof tops and the next floor's
base are `unmodeled-interstorey-gap` unknown context, never proof of clear air.

### Time and solar conventions

Every interval has positive UTC duration, nonoverlapping chronological bounds,
and its exact midpoint `sampleUTC`. Only valid ISO UTC timestamps ending `Z`
(optional three-digit milliseconds) are accepted. Local wall-clock times,
offset timestamps, leap seconds, invalid dates and ambiguous DST times are
rejected. Gaps anywhere in the requested period, including first/last coverage,
remain unknown. Full totals require complete known period coverage.

`sunENU` is a unit vector **toward** the sun, checked within `1e-6` before
roundoff normalization. Alternatively, `sunAnglesDeg` uses altitude [-90,90] and
azimuth [0,360] clockwise from geographic north, exactly the existing HomeSun
consumer convention. This is coordinate conversion, not a third ephemeris.
Use one representation only. `site` records latitude/longitude/IANA zone for
later UI integration with existing HomeSun/SunPath helpers; it does not calculate
or verify the submitted sun directions. Those helpers must resolve selected
local date/time to UTC first. Never parse a local date as browser-local time here.

`up <= 0` is `night` with known zero direct path weights, even if neighbor
context is unknown. Positive altitude at/below the explicit cutoff (strictly
between 0 and 90 degrees) is `near-horizon-unresolved`: mask values null, duration
reported separately, not false physical shade. Above it is
`sun-above-horizon`. There is no sky quadrature horizon cutoff: the sky integral
covers the complete upper hemisphere with finite midpoint rays. No shadow
projection-distance clipping is used for either kind of receiver ray.

## Geometry, inventory and provenance

The nominal grid uses the projected **carpet** bounds `room.rect`, with
`ceil(size/spacingM)` cells per axis. It is intersected with the supplied disjoint
`room.usableRegions` when present; otherwise the full carpet is used. Lift/stair
reservations therefore produce exact rectangular fragments, each with a
`cell:{x,y,w,h}`, midpoint and actual `areaWeightM2`. A nominal cell may produce
multiple sensors, whose IDs include a fragment index after the first fragment.
No point lies in a reserved hole. Empty usable area blocks that workplane.
An alternative polygon without supported usable regions remains unsupported,
rather than being replaced by its bounding box. Midpoint position cannot be
represented at an extreme floating-point scale? Reject rather than place it on
the wall. Only one workplane per exact `{floorId,entityId}` is supported per study.

The horizontal z is `floorElevationM + heightM`, once. Height must be below the
supplied owner-floor `wallHeightM` extent. This is **not** an inferred room clear
height or a physical ceiling. If that extent is unknown, no ceiling is inserted;
the height remains user intent and primary geometry availability is unavailable.

The scene has already subtracted each floor's own `sourcePlotOrigin`. Do not
recenter, subtract it again or add storey heights again. Sensor `world` positions
call **`HomePlannerProjection.siteToWorld`** directly (including optional site
datum); ray directions use the existing physics inverse transform once. All
floors must have the same projected plot/heading; arbitrary headings are supported.

All supplied floor walls, their actual finite-thickness solid sections around
canonical apertures, roof slabs, facades and obstacles are used, not just the
selected room/floor. The existing kernel derives solids from canonical opening
offset/sill/width/height, not the width-only `solidSegments` summary. No wall is
invented from a room rectangle. A supplied roof needs both location
`floorElevationM+wallHeightM` and `roofThicknessM`. Unprovided stair/ceiling/roof,
parapet, connecting slab, terrain, furniture or service geometry is not invented.
Identical projected obstacles with the same explicit `sourceId` across floors
are deduplicated; inconsistent repetitions are rejected. Electrical intent is
never an occluder or emitter.

Inventory `rooms` carry `{ref,label,geometry:{rect,polygon,coordinateSpace},
supportedHeightM,heightMeaning}`. `openings` carry exact `ref`, `wallId`, `kind`,
`openFraction`, and canonical aperture dimensions. `floors` retain elevations,
heading, height/slab metadata, plot and source origin. Findings are
`{code,reference,message,severity}` (`blocking`, `warning` or `info`).

Electrical rows are returned under `inventory.electrical` as
`{floorId,record,point,positionStatus,photometryStatus,heightM}`. The shared
projection resolves ordinary editor `anchor` + `elevationM` records with the
existing electrical resolver against the raw owner-floor scene, then subtracts
that source's actual plot origin once. The projection-only `record.resolvedPoint`,
`coordinateSpace`, `positionStatus` and `positionDiagnostics` preserve the authored
anchor/elevation and do not mutate saved project records. Inventory `point` uses
that resolved position, never an arbitrary legacy `point` field on a rejected
record. External explicit site-local point-only DrawingScene records remain
supported for compatibility. `heightM` means the authored mounting `elevationM`
above finished floor (or null), whereas `point.z` is the resolver's project-relative
elevation. Missing/invalid hosts and unconfirmed ceiling/floor mounting heights
remain schedule-only; supported wall positions with unknown height may draw in
2D with null z but produce no 3D marker. Projection diagnostics are surfaced as
findings. Missing resolver dependency is explicit, never silently located.
`photometryStatus` remains `not-calculated`: these markers do not emit light.

Physical fingerprints are canonical **actual content**, not project ID/revision
or a claimed source key. The scene key includes all floor physical dimensions,
openings, obstacles, geometry diagnostics and room geometry. It conservatively
also includes electrical records and their derived positions/diagnostics so a
changed electrical intent cannot retain stale result inventory or markers.
Electrical changes invalidate the snapshot even though they do not affect rays.
The study physical
key augments it with supplied neighbor boxes; the sensor key includes exact
locations, cell areas and world positions. The input key adds the complete
normalized config. `sourceFingerprint` and `revision` are separate historical
metadata. Replacing physical input at the same ID/revision cannot reuse results.
Object property order does not change keys. Array order is conservatively
significant. Later UI date/model edits must invalidate its pending/result handles.

## Complete result contract

`getResult()` / `finalize()` return:

| Field | Meaning |
|---|---|
| `version`, `kind` | `1`, `RoomLightStudy` |
| `status` | `running`, `blocked`, `cancelled`, `incomplete`, `complete` |
| `complete`, `computationalComplete` | Known-context full study vs all scheduled computation done; not interchangeable |
| `config`, `inventory`, `findings` | Frozen normalized inputs, discovered model, repair/warning evidence |
| `provenance` | `engineId`, `engineVersion`, `projectId`, `revision`, `sourceFingerprint`, `physicalFingerprint`, `scenePhysicalFingerprint`, `sensorFingerprint`, `inputFingerprint` |
| `progress` | `processedRays`, `totalRays`, `completedIntervals`, `totalIntervals`, `completedSkySensors`, `totalSensors`, `computationalComplete`, `cancelled`, `finalized`, `blocked` |
| `sensors[]` | `id`, `workplaneId`, `room`, exact `cell:{x,y,w,h}`, site-local `point:{x,y,z}`, shared `world`, `areaWeightM2`, nominal `grid:{column,row,columns,rows}` |
| `context` | `status` (`known-supplied-model` / `unknown-context`), `neighbors`, `windowOptics`, `roofContext`, `unsuppliedRoofFloorIds` |
| `sampling` | `method`, `directionCount`, `skyRays`, `directRays`, `totalRays`, `rayComparisonUpperBound`, `outputNodeUpperBound`, `outputCharacterUpperBound`, `kernel`, `minSunAltitudeDeg`, `nearHorizonMeaning`, `sensorMeaning` |
| `limitations[]` | Persisted interpretation limits; retain with evidence |

`sky` fields:

- `status`: `blocked`, `disabled`, `incomplete`, `complete`, or
  `modeled-context-only`.
- `metric:"normalized-cosine-weighted-sky-access"`,
  `units:"dimensionless-0-to-1"`,
  `timeDependence:"geometry-only-not-day-night"`.
- `sensorResults[]`: `{sensorId,status,cosineWeightedSkyAccess,
  modeledCosineWeightedSkyAccess}`. Primary access is null for unknown context;
  the explicitly named supplied-model estimate may be shown with warnings.
  Unfinished sensor estimates are null, never optimistic zero or one.
  Multiplication by 100 is a percentage of this visibility index only.

`direct` fields:

- `status` (`blocked`, `incomplete`, `complete`), `complete`, `units:"hours"`,
  `periodHours`, `processedIntervalHours`, `knownIntervalHours`,
  `unknownOrUnprocessedHours`, `nearHorizonUnresolvedHours`.
- `masks[]`: `{sampleIndex,startUTC,endUTC,sampleUTC,durationHours,
  directSunStatus,status,directPathWeights,modeledDirectPathWeights,
  positivePathPresence}`. Arrays use `sensors[]` order.
  `status` is `known`, `modeled-context-only`, or `unresolved`.
  Weights are [0,1] or null; presence is boolean or null. No facing cosine or
  W/m² weighting is applied to hours.
- `sensorResults[]`: `{sensorId,positivePathPresenceHours,
  transmittedEquivalentSunHours,knownProcessedPositivePathPresenceHours,
  knownProcessedTransmittedEquivalentSunHours,
  modeledProcessedPositivePathPresenceHours,
  modeledProcessedTransmittedEquivalentSunHours}`.

Full-period sensor totals are null until `direct.complete`. Known processed
subtotals count only resolved contributions; modeled processed subtotals show
only committed supplied-model intervals, not gaps/cancelled work. In an entirely
nighttime period direct totals can be known zero while sky/context remain
unknown and the **whole study** stays incomplete.

For a one-hour interval through a .4-transmitting path: presence hours = 1,
transmitted-equivalent hours = .4. Neither is named raw/unobstructed sunshine
hours. Do not convert a visibility percentage, these hours or solar W/m² to lux.
`compare().deltas[]` uses `sensorId`, `positivePathPresenceHours`,
`transmittedEquivalentSunHours`, `cosineWeightedSkyAccess` (null if sky disabled);
positive means second minus first.

## Numerical benchmark evidence

Automated analytic fixtures in `tests\planner-light.test.cjs` enable this reduced
metric only within the above meaning. They are equation checks, not measurements
or external lighting-engine calibration.

- Open horizontal plane, explicitly no ceiling: exactly **1**.
- Finite enclosing walls and supplied opaque roof, no opening: exactly **0**.
- Half-hemisphere wall at the receiver's physical face: exactly **.5** at
  4×16, 8×32, 16×64 and 32×128 quadrature resolutions.
- Real closed ideal-clear window in otherwise opaque walls under a supplied
  roof: aperture half-width .5 m, height 1 m above the sensor, far-face distance
  1.1 m (wall thickness .2 m). Independent analytic answer:

```text
d/pi * [atan(a/d)/d - atan(a/sqrt(d²+h²))/sqrt(d²+h²)]
= 0.0593817567684876
```

| Radial × azimuth | Computed access | Absolute error |
|---|---:|---:|
| 8 × 32 | .054687500000 | .004694256768 |
| 16 × 64 | .054687500000 | .004694256768 |
| 32 × 128 | .060546875000 | .001165118232 |
| 64 × 256 | .058227539063 | .001154217706 |
| 128 × 512 | .059753417969 | .000371661200 |

The nonmonotonic values demonstrate directional aliasing, not a claimed
universal error bound. At the finest grid error is .03717 percentage points.
Explicit .4 visible transmission multiplies the result by .4. Direct rays
through/outside the aperture, open-fraction mixtures and opaque doors are tested
separately.

For a fixed .8×.8 m room carpet, 64×256 directional quadrature and nested
1×1, 2×2, 4×4, 8×8 **spatial** grids give average sky access:
.058227539063, .061187744141, .062042236328, .062210083008.
Independent 128×128 midpoint integration of the analytic aperture expression
over that same room gives .062265893437; finest error is .000055810430.
This reference is itself an explicitly refined numerical room-area integral.

A separate sharp vertical direct-sun shade edge with exact visible fraction .7
gives .5, .75, .75, .6875, .6875 on 2², 4², 8², 16², 32² grids. Spatial
refinement is not guaranteed monotonic either. Tests also cover actual bridge
projection with unequal plot origins and elevations, headings 17°, 123.456°,
271° and 37.25°, all four neighbor sides, fractional facades, roof/inter-storey
occlusion, night and near horizon, unknowns, immutable inputs, replacement
fingerprints, strict timestamps, chunked masks and bounded sparse/dense inputs.

## Bounds and non-goals

`LIMITS`: 64 floors; 32,768 total discovered rooms/walls/openings/obstacles;
4,096 sensors; 2,048 intervals; 2,000,000 sky rays; 4,000,000 total physical rays;
50,000,000 conservative ray/caster comparisons; 1,000,000 sensor/interval mask
entries; 65,536 receiver operations per batch. Quadrature allows 1–128 radial
bands and 4–512 azimuth sectors (multiple of four). `createReceiverKernel`
additionally rejects >32,768 physical entities, >100,000 potential tessellation
pieces or >8,000,000 preparation comparisons before tessellation.

JSON budgets are 500,000 traversed nodes, 16,000,000 cumulative text characters,
depth 64; canonical fingerprint serialized text is also capped at 16,000,000.
Fingerprint strings are **not** short identifiers capped at 16,384. A conservative
full snapshot node/text bound is checked before rays, so dense output can reject
below the independent mask/ray limits. No budget truncates inventory or samples.
Actual snapshots are checked again for finite JSON. Counts are operation/memory
bounds, not a hardware runtime guarantee.

The reused kernel has 1e-7 m ray-intersection tolerance and no artificial
receiver bias for user points. It models building-scale straight walls and
rectangular prisms/slabs, not submicron geometry or a finite solar disk. Missing
physical references block execution; unknown neighbor/roof/height/gap context
preserves separately labeled supplied-model estimates without a trusted result.

Phase 9 UI, worker transport, display/3D, accessible legends, evidence exports
and actual browser review are **not** implemented here. This foundation does not
pass the whole Phase 9 gate and does not start Phase 10.

Foundation verification: `node --test tests\*.test.cjs` passed **1,061 tests,
0 failures**, including the existing physics, sunlight and airflow suites plus
the new light and shared-receiver benchmarks. No browser/UI acceptance is claimed.
