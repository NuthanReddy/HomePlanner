# Airflow display — pure SVG and accessible table model

`planner-airflow-display.js` is a read-only consumer of the
[Phase 8 foundation](airflow-visualizer.md). It does not solve, edit, store,
download, infer physical inputs, or construct a second editable floor model.
It needs no DOM, network, third-party dependencies, clock or random source.

## Exact public API

Browser: load `planner-airflow-display.js` to obtain
`globalThis.HomePlannerAirflowDisplay`. CommonJS:
`require('./planner-airflow-display.js')`.

```js
const { VERSION, createView, createInventoryView } = HomePlannerAirflowDisplay;

// After a run: pass the complete foundation snapshot, including blocked results.
const view = createView(result, { floorId: 'ground' });

// Before inputs are complete: pass the actual discover() inventory.
const preview = createInventoryView(HomePlannerAirflow.discover(drawingScene), {
  floorId: 'ground'
});
```

Both return this detached, recursively frozen, finite JSON shape:

```text
{
  version: 1,
  svg: string,
  roomRows: array,
  openingRows: array,
  legend: string[],
  warnings: string[],
  floorId: string | null
}
```

An explicitly computed `result.planField` adds `fieldRows`, containing the full
cell records plus display `inScope`. Network-only views keep the original shape.

`svg` is the complete accessible SVG, not a fragment. There is no separate
`toSVG` call. `createView` accepts only a version-1 `AirflowResult`.
`{inventory, status: "not-run"}` is **not** a supported substitute.
`createInventoryView` accepts only a version-1 `AirflowInventory` from
`discover()` or `result.inventory`; both paths share the same renderer.

The sole option is `floorId`. Omitted/null selects the first inventory floor;
an empty inventory produces an empty drawing with `floorId:null`.
An unregistered floor, extra option, malformed input or exceeded budget throws.
Explicit `undefined` is not finite JSON. Callers should catch errors and show
their message rather than replace an unavailable drawing with invented geometry.

**Floor selection changes display scope, not the network or analytics.** All
inventory rows, selected unresolved records and all manual links remain in both
tables, including foreign-floor rows. Only `inScope` and the SVG change when
switching floors. Keys and numerical values do not change. A floor with no
selected zones can still show its physical inventory, without flow arrows.

## Rows, unknowns and accessibility

`roomRows` begins with the foundation inventory order, then unresolved selected
zones. `openingRows` begins with inventory openings, then manual links and
unresolved selected opening links in scenario order. No physical entity is
identified by splitting its ID. References retain exact `{floorId,entityId}`
values, including existing namespaces.

Every row has `key` (opaque stable identity), `shortKey` (`R1` / `O1`, etc.),
`id`, `floorId`, `inScope`, `selected`, `geometry`, `numericalStatus`,
`diagnostic`, and `display`. Short keys are stable for the same inventory and
scenario when changing the display floor, not persistent entity IDs across
changed inventories. The diagram uses these short keys instead of large IDs.
Long names remain **complete** in rows and escaped SVG titles; a whole short
name can supplement a room key if it fits without obscuring geometry.

Numerical fields are numbers or **null**, never a fabricated zero. `display`
contains corresponding seven-significant-digit strings and the literal
`"unknown"` for nulls. Calculations and exports should use the unrounded numeric
fields. Render null flags as unknown as well, not `false`.

`rawInputs` is the detached exact scenario zone/link record or null for an
unselected inventory item. Omitted properties remain omitted and explicit nulls
remain null; no inputs are backfilled. A missing display value must be rendered
as **unknown**, even when an inactive link has a known zero flow.

These rows are **data, not HTML**. The final UI must escape names, IDs, references,
raw inputs, warnings and all table text (for example with `textContent`). Only
`svg` is generated safe markup. Keep tables, legend, warnings, units and status
with the image. A responsive image alone is not an adequate accessible results
surface, especially at narrow screen widths.

### Room fields

* `roomRef`, `label`, `zoneId`, `solverId`, and exact inventory `geometry`.
  An unresolved zone has null geometry; its qualified reference is retained.
* `volumeM3`, `volumeProvenance`: the explicitly supplied selected-zone volume,
  never polygon area multiplied by a guessed ceiling height.
* `pressurePa`, `gauge`, `referenceZoneId`, `referencePressurePa`.
  Gauge is the foundation component's `outside-zero-Pa` /
  `arbitrary-zero-Pa`, otherwise `"unknown"`.
* `inflowM3s` (**total** inflow), `outflowM3s`,
  `directOutsideInflowM3s`, `transferInflowM3s`.
* `netOutflowM3s`: signed outgoing-minus-incoming volume residual;
  `massResidualKgS`: signed constant-density mass residual.
* `directOutsideInflowACH`, `achLabel`. Preserve the exact label:
  **“Direct outside inflow ACH; not complete fresh-air delivery or a mixing
  estimate.”** Transfer inflow is not included. ACH is null unless trusted
  converged output exists.
* `sealed`, `deadEnd`, `connectedToOutside`: selected-network flags, null if
  unavailable. Omitted physical openings are not thereby asserted sealed.

`display` supplies strings for volume, pressure, ACH and the six flow/residual
fields. Unknown volumes, pressures and flows remain unknown before a run or
when blocked.

### Opening / connection fields

* `linkId`, `openingRef`, `kind`, `label`, `solverId`, `solverFrom`, `solverTo`.
  A physical row's `kind` retains inventory kind (door/window/passage);
  manual records use `"manual"`. `id` is the selected link ID, otherwise the
  inventory entity ID; use `key`, not `id`, for table identity.
* `from`, `to`: supplied scenario orientation; `fromRoomRef`, `toRoomRef`;
  `fromFloorId`, `toFloorId`. Outside is the reserved endpoint `"outside"`,
  not an invented room. Unavailable references are null.
* `state`, `enabled`, `awaitingInputs`, `operation`, `grossAreaM2`,
  `freeAreaM2`, `effectiveAreaM2`, `cd`. Gross physical aperture area is
  separate from explicit aerodynamic free area; no area is inferred or applied
  a second time.
* `m3s`: signed **from → to** flow. `direction` is the actual signed
  `{from,to}` direction, null for zero/unknown.
* `imposedPressurePa` and compatibility alias `pressurePa`: supplied signed
  forcing, **not** the solved total pressure difference.
* `fromPressurePa`, `toPressurePa`: raw solver endpoint pressures, with outside
  zero only when solver evidence exists.
* `solverPressureDifferencePa`: `fromPressurePa - toPressurePa +
  imposedPressurePa`, only when all three are finite and known; otherwise null.
  No wind pressure, hydrostatic head or pressure from anchor elevation is added.
* `meanOpeningSpeedMps`: exact foundation output, when available. This is
  `abs(m3s)/effectiveAreaM2`, **not** occupant/room speed or resolved velocity.
  A manual link does not thereby establish a measured aperture.
* `directionVector`: unit `{x,y}` in the common site-local plan frame for a
  drawable, trusted opening arrow; otherwise null. It is symbolic direction,
  not speed, displacement or a CFD vector.

`display` supplies flow, free/effective area, Cd, imposed/endpoint/total pressure,
mean-opening-speed strings and `direction` (`"zero net flow"` / `"unknown"` /
actual signed endpoint names). Tables may preserve raw signed diagnostic flows
even when `directionVector` is null and no arrow is drawn.

## Visual semantics and numerical status

White paper, high-contrast dark ink, blue arrows and sienna dashed manual
connections inherit the existing drawing language. The SVG includes its own
white background and explicit colors; it does not depend on the surrounding
light/dark stylesheet for contrast. Direction and state are not communicated by
color alone. There are no external resources, external URL paint references, scripts,
foreign objects, animation or interactive SVG controls. User text is escaped
for XML text and attributes. The root has `role="img"`, an accessible name,
`title` and a descriptive `desc`.

The status remains visible above the plan and in the legend:

| Input | Drawing and values |
| --- | --- |
| Inventory | **NOT RUN**; geometry only, unknown numerical values |
| Blocked | **BLOCKED**; inventory plus repair notes, no arrows, no fallback zero |
| Converged + balanced + converged solver status | Opening arrows for active positive-area nonzero links |
| Nonconverged | **DIAGNOSTIC ONLY**; no arrows, signed raw diagnostics retained, no ACH |
| Numerical error | **DIAGNOSTIC ONLY**; no arrows; finite raw solver flows/pressures/residuals retained if present |

Disagreement between top-level balance/convergence and solver convergence also
suppresses arrows. Disabled, closed, zero, unknown, unselected and unresolved
openings never receive flow arrows. Known zero flow remains a valid table zero;
it does not imply turbulent single-sided exchange or occupant comfort.

Room polygons and opening start/end/center come from the single discovered
inventory, not a separately projected model. Known-adjacency opening arrows
cross the center of the **actual aperture segment**, perpendicular to its wall
axis. The exact from/to room centers determine orientation, with a confirmed
outside endpoint handled only relative to its known room. Negative signed flow
reverses that orientation. Arrow length is a constant 30 display units: it does
not encode magnitude. No generic wind direction, room-through streamline,
arbitrary room-center route or spatial velocity field is invented.

### Computed velocity field

When `result.planField` is present, the primary view switches to the
[computed 2D potential-flow field](airflow-field.md). It shows actual physical
walls/apertures, spectral cell colors clipped to `geometry.usableRegions`,
small black computed velocity vectors and a vertical **Velocity [m s⁻¹]**
legend. The maximum is the current field's actual maximum across its calculated
floors, not a copied 0–4 range. Native legend text repeats the numeric range for
readability at narrow sizes.

Cells retain exact rectangles, center coordinates, components and speed; the
renderer performs no flow calculation, interpolation through walls or generic
wind-path generation. The local SVG gradient is used only for the numeric
legend. Known zero is blue with a zero scale; unavailable/uncalculated regions
stay uncolored. Cell identity, input fingerprint, units, magnitude and
containment in a supplied usable region are checked before drawing. These are
**uncalibrated depth-averaged estimates, not validated CFD or measured airspeed**.
Legacy aperture-mean speed and the new room-field estimate remain separate.

Valid lift/stair reservations are represented by their supplied usable-region
holes and physical walls, not rejected as overlapping rooms. Their service
geometry is not changed. Region-aware inventory views can draw the same plan
before a field is available.

Manual connections show only the foundation's **two explicit anchors**, a
dashed straight intent connection and two rings labeled `Ona` / `Onb` (supplied
from/to anchors). They never receive opening-flow arrows. Coincident XY anchors
stay coincident: their different z values do not create an invented plan span.
Missing either resolved anchor means no manual geometry is drawn.

An active-floor-touching cross-floor manual connection shows both anchors and
the **entire foreign span** in shared site-local XY, even beyond that floor's
footprint. This changes the display fit. A persistent cross-floor caption and
warning explain that **no foreign-floor room overlay** is projected onto the
active floor. Coincidence with an active-floor room does not establish physical
containment, a penetration, a shaft or a valid path. z remains the exact absolute
anchor elevation in row geometry, not a basis for stack-effect forcing.

## Bounds and density failures

The legacy network diagram fits its selected geometry into a `1000 × 800` viewBox, reserving
separate header and legend bands. Scale and centering are **display-only**,
shared across everything drawn; geometry in table rows is unchanged. This is
not a fixed-mm paper sheet, survey, construction detail or spatial simulation.
Region/field plans use a `1040 × 820` viewBox and a shared all-floor extent,
with the numeric scale beside the plan. Exact geometry and full cross-floor
manual-anchor spans are retained; floor filtering does not change the solved field.

The foundation's 64 floors / 4,096 rooms / 16,384 openings / 128 zones / 512 links
and 500,000 JSON values / 16,000,000 text characters / 64 levels remain upper
bounds. Input and output traversals are bounded. Room names are limited to
16,384 characters. Display coordinates must be finite site-local x/y/z within
±1e9 m; larger finite analytical coordinates explicitly refuse drawing.

Additionally, a single selected-floor image refuses more than **512 drawable
records**. A label-placement pass checks keys against other labels, room edges,
apertures, manual spans, arrows and image bounds. If a short key cannot fit
legibly, the call throws a descriptive density error instead of overlapping
critical geometry, shrinking text to illegibility, hiding an entity, clipping
geometry or truncating names. Use another floor or the source inventory/result
tables to inspect such a case. SVG titles and rows retain complete labels when
only short keys fit in the image.

## Focused evidence

```powershell
node --test tests\planner-airflow-display.test.cjs tests\planner-airflow.test.cjs
```

Tests use actual compiler/bridge/projection inputs, unequal floor origins and
room sizes, qualified IDs, exterior/interior flow reversal, zero/closed/disabled
and unknown states, raw blocked and nonconverged diagnostics, explicit and
missing manual anchors, foreign spans, accessible SVG escaping, bounds,
determinism and recursively frozen detached outputs.
