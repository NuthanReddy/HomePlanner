# Optional 3D light inspection

Enable **Light study (computed 2D result)** using
`[data-hp3d="lightStudy"]`. It is independent of structure, plumbing and
drainage and is off by default. The existing `[data-hp3d="light"]` paragraph
continues to describe illustrative inspection illumination; it is not a study
control. The legacy preview works without the light foundation or a Worker.

## Integration

The viewer reads
`document.getElementById('workspaceLightStudy').homePlannerLight.getState()`
on enabling/rebuilding and on document `homeplanner:light-result` notifications.
The snapshot supplies `result` and `visualization`:

```js
{
  metric: 'direct', // or presence-hours, equivalent-hours, sky
  intervalIndex: 0,
  modeled: false,
  showElectrical: false
}
```

The parent UI emits `{ result, visualization, stale }` on publication,
invalidation, view changes and disposal. Events only trigger a fresh controller
read; their result/visualization payloads are never used as study data. A null
result or stale event clears the layer immediately, even if the controller has
not yet cleared its snapshot. A subsequent non-stale publication permits a new
controller read. There is no historical-result cache.

Before displaying a result, `currentLight` requires registered **all-floor**
DrawingScene geometry, matching real project IDs and matching
`HomePlannerLight.discover(drawing).physicalFingerprint` against
`result.provenance.scenePhysicalFingerprint`. Revision/source metadata alone
does not establish freshness; same-ID/same-revision physical replacements,
foreign-floor changes and actual wall clipping invalidate the old result.
The module uses only foundation discovery, never `createStudy`, `run`, Workers,
sun-vector generation or the receiver kernel. Mount tests inject `lightModel`
for the same discovery-only contract. Exported `buildLight` and `buildContent`
are rendering helpers; callers must supply data validated by `currentLight`.

Missing dependencies/registration produce a clear recoverable error and
`[data-hp3d="lightStudy-off"]` restores access to other layers. Missing, stale,
blocked, cancelled or running results show unavailable status with no old
sensor geometry. Finalized incomplete results retain genuinely known values;
unknown primary values never become modeled values implicitly.
If light discovery fails while the architectural geometry remains valid (for
example a light-inventory resource limit), `currentLight` instead returns `result:null`, `inventory:null`
and an actionable `error`. The light layer has no cells and displays that reason;
architectural inspection and the camera remain available. Valid reserved
usable-area regions are supported rather than rejected as overlapping rooms.
Malformed base room-floor regions remain architectural input errors; they are
not replaced with a bounding-box floor under this light-only recovery path.

## Measurements and display

- Direct uses the selected mask's `directPathWeights`; explicit modeled
  opt-in uses `modeledDirectPathWeights`. Known night zeros come from the
  foundation, including unknown-context nights. The viewer invents no zeros.
- Presence/equivalent hours use primary sensor totals only when
  `direct.complete` is true. Modeled opt-in displays the corresponding processed
  modeled subtotal, explicitly marked **MODELED SUBTOTAL**, not full-period
  hours.
- Sky uses cosine-weighted geometric access, or its explicitly opted-in
  modeled counterpart. It is dimensionless, not lux or daylight factor; night
  does not modify it.
- Known zero is blue; positive values are amber. Alpha scales with the
  dimensionless metric or the study period for hours. Unknowns are distinct
  gray wireframe cells. There is no spatial interpolation or blur.

Each exact rectangular cell uses the supplied `sensor.cell.w` and
`sensor.cell.h`, centered at its midpoint. These may be clipped fragments of a
nominal grid cell; they never cover host floor reserved for a lift/stair.
Older full-grid snapshots without `cell` retain the rectangle/grid fallback. Cells are
numerical sample footprints, not a continuous field or a measured room-average
value; schedules preserve the numeric `areaWeightM2` for each midpoint.
Each workplane/room also has a clearly labeled numerical area-weighted
midpoint average. It requires all cell values and positive areas; missing
values make the average unavailable rather than silently omitting unknown
cells. Modeled averages retain the modeled/SUBTOTAL designation.
Site-local x/y use the common plot center and heading. The already
project-relative `point.z` maps to Three Y **once**, without restacking or
recentring unequal floors.

The architectural base uses the same registered all-floor path as the other
intent layers. Active-floor inspection filters matching-floor sensors only;
it never re-runs analysis or claims hidden foreign occluders were absent.
Shared plumbing/drainage geometry remains deduplicated. Cutaway changes only
architectural presentation caps.

Architectural room finishes also use `room.usableRegions` when supplied.
Each non-overlapping piece is a separate floor mesh with the same original
`{kind:"room", id}` picking reference, grouped under one room entry for selection.
Host finishes do not extend through the reserved service footprint; a lift/stair
can retain its own separate floor and picking identity. An explicit empty array
has no room finish, while omission retains the legacy `room.rect` convention.
The parent-owned model/projection supplies these regions; the viewer neither
repartitions the project nor changes its floor elevations, heading or viewport.
Invalid/unrepresentable region data fails visibly instead of painting a guessed
bounding-box floor.

Cells and electrical points are nonpickable, unshadowed, depth-write-disabled
display objects. They add no physical emitter or point light and do not change
global inspection illumination. Electrical records appear separately only when
`showElectrical` is true and xyz are explicitly known; unprojected records and
null z stay schedule-only, without ceiling inference. Electrical data is read
from the current discovery inventory, not a stale physical-result cache.

`lightStudy-note` above the canvas is brief: metric, UTC time/scope, result
status, units and **NOT LUX**. Closed `lightStudy-details` below the canvas
contains caveats and the scrollable `lightStudy-schedule`, with full IDs,
values, coordinates, z, geometry availability and electrical records. No
photometry, adequacy, safety or compliance approval is asserted.

Light-result/date/view events replace and dispose only light display objects;
camera, controls, architectural meshes, selection, illumination and panel open
state are retained. Ordinary project/layer rebuilds retain the existing camera
behavior; Reset view is explicit. Closing/destroying releases meshes and the
destroyed mount removes its document listener.

## Validation boundary

`node --test tests\planner-light-3d.test.cjs` exercises real foundation studies,
registered projections and real vendored Three geometry/materials. A small
fake DOM/WebGL renderer tests lifecycle and parent-controller integration
without a browser GPU. Existing architectural and intent suites cover shared
base geometry regressions. These are renderer/contract tests, not optical
validation or browser pixel/screenshot acceptance.
