# Room light display (Phase 9)

`planner-light-display.js` is a pure presentation adapter for the frozen
version-1 `RoomLightStudy` and discovered inventory described in
[`light-visualizer.md`](light-visualizer.md). No DOM, network, astronomy, ray
tracing, optics, scene projection, saved-record mutation or dependencies are
introduced. UI and 3D consumers should continue consuming foundation results,
not display implementation details.

## API

Browser global `HomePlannerLightDisplay` and CommonJS exports are identical:

```js
const view = HomePlannerLightDisplay.createView(result, {
  floorId: "ground",
  metric: "direct",       // direct | presence-hours | equivalent-hours | sky
  intervalIndex: 0,      // supplied sample index, not mask-array offset
  modeled: false,
  showElectrical: false
});
const pending = HomePlannerLightDisplay.createInventoryView(inventory, {
  floorId: "ground", showElectrical: false
});
const svg = HomePlannerLightDisplay.exportSVG(view); // identical to view.svg
```

`VERSION` is `1`. All options are optional; the defaults above apply except
`floorId`, which selects the first registered inventory floor (null only for
empty inventory). Options are strictly typed. Unknown keys, unknown floors or
metrics, null/nonboolean toggles, fractional/negative/out-of-range indices and
nonfinite/non-JSON inputs throw. Index zero is permitted for a blocked/pending
study without samples. Other indices must reference supplied samples and be
less than 2,048. Inventory views accept the same presentation options, but have
no sampled numerical evidence.

Both constructors return a detached recursively frozen object:

| Field | Contract |
| --- | --- |
| `version` | `1` |
| `svg` | Accessible, responsive standalone white-paper SVG string |
| `floorId` | Selected registered floor, or null for empty inventory |
| `sensorRows` | All-floor sensor evidence; `inScope` identifies selected floor |
| `roomRows` | All-floor discovered rooms, including unsampled/unresolved rooms |
| `legend` | Interpretation and metric/unit strings for accompanying UI |
| `warnings` | Deduplicated findings and display/unknown-evidence notices |
| `electricalRows` | Additive schedule contract, including unprojected intent |
| `provenance` | Additive full original result provenance; pending views retain inventory project/revision/source/physical keys |

Canonical provenance fingerprints are retained in `view.provenance`, never
drawn or shortened into misleading identifiers. Row `provenance` is compact:
project/revision, engine/version, `coordinateSpace:"site-local"` and context
status. It is not a replacement for the full evidence provenance.

### Sensor rows

Each row contains the **full unchanged** `id`, `workplaneId`, `roomRef`,
`floorId`, `point:{x,y,z}`, `world`, `grid`, `areaWeightM2`; `shortKey` is an
SVG-only sequential `S1` key. `cell:{x,y,w,h,z}` is the exact supplied workplane
cell, including clipped usable-region fragments. Older snapshots without explicit
cells retain the matching room rectangle divided by grid
columns/rows; its center is the supplied sensor point.

`primary` and `modeled` each have the four metric keys. `metric`, `units`,
`selectedValue` and `selectedStatus` describe the selected presentation.
`selectedStatus`, `primaryStatus[metric]` and `modeledStatus[metric]` distinguish
`unknown`, `known-zero` and positive `finite`. Missing evidence is always null,
not a formatted zero. The name `known-zero` describes finite zero in the
respective column; it does not promote supplied-model evidence to primary.

Additional columns preserve:

- `knownProcessedPositivePathPresenceHours`
- `knownProcessedTransmittedEquivalentSunHours`
- `modeledProcessedPositivePathPresenceHours`
- `modeledProcessedTransmittedEquivalentSunHours`
- `skyStatus`, `numericalStatus`, `provenance`, `inScope`
- `interval:{sampleIndex,startUTC,endUTC,sampleUTC,directSunStatus,status,committed}`

Those explicitly named subtotals are **processed contributions only**. They
remain useful with partial/cancelled/gapped evidence, but cannot stand in for
the requested period. Blocked results expose no numerical values.

### Room rows

Rows retain full `id`, `roomRef`, `floorId`, `label`, original `geometry`,
`supportedHeightM`, `heightMeaning`, and `floor` metadata (including elevation,
plot and original source origin). `shortKey` is `R1`, etc. Rows include
`sensorIds`, `sensorCount`, `finiteSensorCount`, `unknownSensorCount`, `inScope`,
`metric`, `units`, `numericalStatus` and compact `provenance`.

`primary` and `modeled` are area-weighted workplane sensor means for each
metric, **not room-total hours**. The mean is null if any constituent value is
missing or the room is unsampled. `aggregation` carries that interpretation.
`status` is `finite-sensors`, `unknown-sensors` or `not-sampled` for the selected
metric. Original per-sensor values remain available for evidence tables; the
renderer never fills a whole room with its mean.

### Electrical schedule rows

Rows preserve the inventory `floorId`, **unaltered** `record` (including its
point type), `point`, `positionStatus`, `photometryStatus`, and `heightM`.
Additional fields are `shortKey` (`E1`, etc.), `inScope`, `markerVisible`,
`heightStatus` (`supplied-z` / `height-unknown`) and
`emissionStatus:"not-calculated"`.

Only `showElectrical:true` and an explicitly `supplied-site-local` inventory
point whose record also declares `coordinateSpace:"site-local"` produce a
plan marker. Supplied z=0 is preserved. Null z remains a supplied XY plan point
with `?` and “height unknown”, never an assumed ceiling height. Authored anchors
are resolved by the shared electrical resolver and translated into site-local
coordinates by the projection. Unresolved records remain schedule-only; neither
raw legacy x/y nor an unprojected `record.point` is used as a position.
Markers do not emit, shade, indicate coverage, count
adequacy, or affect any metric.

## Metric and snapshot semantics

| Selection | Primary source | Model source | Units |
| --- | --- | --- | --- |
| `direct` | Committed mask `directPathWeights[sensorIndex]` | `modeledDirectPathWeights[sensorIndex]` | Path transmission 0..1 |
| `presence-hours` | `positivePathPresenceHours` | `modeledProcessedPositivePathPresenceHours`, only when direct period is complete | Hours |
| `equivalent-hours` | `transmittedEquivalentSunHours` | `modeledProcessedTransmittedEquivalentSunHours`, only when direct period is complete | Hours |
| `sky` | `cosineWeightedSkyAccess` | `modeledCosineWeightedSkyAccess` | Normalized cosine-weighted sky access 0..1 |

Primary and modeled **hour cells** require `direct.complete === true`, not
whole-study `complete`. Unknown period holes remain missing even when modeled
processed subtotals exist in the table. An entirely known-night direct period
can therefore show zero hours while unknown sky/context keeps the whole study
incomplete. This deliberately conservative presentation does not color modeled
hour subtotals as though they covered the full period.

`modeled:true` is explicit and displays **SUPPLIED MODEL ONLY / unknown context**
above the whole view and in its legend. It selects modeled fields, not a
fallback from missing primary values. Both evidence columns remain available
in rows for comparison.

Only a mask committed for the selected `sampleIndex` supplies interval values.
A future interval without a committed mask stays unknown, even if its sample
specifies night. Day, night and near-horizon-unresolved states are explicit
when committed. A sky view is geometry-only and never darkened by sun state.
The caption retains the supplied UTC timestamp and, when present, adds local
date/time using the supplied IANA zone (`result.config.site.timeZone`, or
`inventory.config.site.timeZone`). No local date is parsed as browser-local
time. Full interval bounds stay in sensor rows.

No displayed metric is lux, daylight factor, irradiance, electrical photometry,
illumination adequacy or a reconstructed annual daylight quantity. For a
one-hour .4-transmitting path, presence hours are 1 and equivalent hours .4.

## Geometry and image presentation

The fit-to-view frame includes all inventory floor plots/room rectangles and
the fixed site-local origin. The same inventory keeps exactly the same mapping
across floor and electrical-toggle changes. Coordinates are not recentered per
floor, source origins are not subtracted again, elevations are not added again,
and floor display gaps are not inserted. All-floor occlusion is already in the
foundation values; this adapter never recomputes it.

Only actual sensor cells are colored. Cells are clipped to the supplied usable
regions; lift/stair reservations remain excluded from their host workplanes.
No sample-to-sample paths, invented illumination polygons or ceiling assumptions
are added. Supplied physical walls and aperture positions remain visible.
Unknown cells have gray hatch and a `?` when large enough; known zero is blue.
Blue → cyan → green → yellow → red maps the exact selected values, with the
actual computed maximum shown on a vertical numeric legend. The sole gradient
is the legend, not an invented floor field. Exact values and real units remain
in cell titles, `data-value`, and the rows. No lux label is copied from a visual
reference; color is a display encoding, not additional physics.

The numeric scale sits beside the plan; compact limitations stay below it and
room markers use short keys. Native UI text also shows the actual numeric range.
SVG titles use escaped, length-bounded label previews; rows retain complete
labels and IDs. SVG has an accessible title/description and image role, a
white background independent of application dark mode, no external resources,
scripts, foreign objects or event handlers. The hatch uses only a local SVG
fragment references for the hatch and numeric spectrum. Export returns the same image, without executing or
downloading anything. Empty/blocked/pending views explain missing geometry or
samples instead of returning blank success.

## Bounds and verification

Inputs use finite acyclic JSON budgets: 500,000 nodes, depth 64 and 16,000,000
text characters. Bounds are 64 floors, 32,768 combined room/wall/opening/electrical
records, 4,096 sensors and 2,048 committed intervals. Output traversal is bounded
at 2,000,000 nodes and 16,000,000 text characters to accommodate the expanded
4,096-row presentation contract. Coordinates are finite within ±1e9 m.
Invalid or inconsistent grid/fragment geometry rejects. Only exact intersections
with supplied usable regions are supported; there is no arbitrary clipping,
truncation, implicit floor selection or unbounded generation loop.

`node --test tests\planner-light-display.test.cjs` covers analytic value
mapping, unknown/zero distinctions, partial and cancelled masks, period gaps,
known night with unknown context, sky independence, normalized cross-floor
coordinates, UTC/IANA captions, escaping, electrical zero/null/unprojected
positions, pending/empty views, strict options and 4,096-cell bounds.
The tests make no browser/UI or whole Phase 9 completion claim.
