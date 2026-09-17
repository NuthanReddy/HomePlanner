# Project document and effective physical scene

`planner-model.js` is a pure browser IIFE exposing
`window.HomePlannerModel`. Node can `require('../planner-model.js')`; both exports
have the same API. Its feature and rectangle helpers are local offline modules,
not third-party runtime dependencies. It performs no DOM access, storage, network requests, location
detection or source mutation. `createProject()` is the only nondeterministic API:
it allocates a new project ID.

## Public APIs

| API | Result |
| --- | --- |
| `createProject()` | A fresh schema-1 document with one ground-floor record, independent active/floor legacy records and empty supplemental collections. |
| `validateProject(project)` | Returns the **same** document on success; throws a descriptive `Error` on invalid input. Does not normalize, repair or mutate it. |
| `parseProject(text)` | Parses and validates a detached document; throws on invalid JSON or schema. Unknown schema versions are not guessed or migrated. |
| `buildScene({plate,g,plan,cfg}, project)` | Deterministically compiles the active-floor projection into a new scene. Invalid base geometry throws; unresolved geometry/attachments produce diagnostics. |
| `localToWorld({x,y,z?}, scene)` | Returns metre coordinates `{east,north,up}`. Omitted `z` means `scene.floorElevationM`; explicit `z` is already an absolute elevation, not an offset to add again. |
| `worldVectorToLocal({east,north,up?}, scene)` | Returns `{x,y,z}` without translation. Omitted `up` means zero. |
| `wallPoint(wall, offsetM)` | Interpolates a point along oriented `wall.start → wall.end`. Rejects nonfinite/out-of-range offsets and zero-length walls. |
| `retainedWallSpan(wall, retained?)` | Validates and returns `{startM,endM}` inside the original oriented wall span. A supplied `endM:null` follows the original host end. |
| `wallOpeningSpan(wall, options)` | Computes a full, fixed-width partial or exact-to-end full-height connection within the retained span. Does not author or round a width. |
| `doorGeometry(opening, wall)` | For a hinged door, returns `{hinge,closedEnd,openEnd,arcSweep,radiusM}` for the schematic 90° plan glyph. Rejects sliding/window/passage kinds. |

The model does not own commands, transactions, history, selection, source-ID
reconciliation or persistence. Those belong to `HomePlanner` / the coordinator.
Scenes are detached outputs; consumers must still send edits through commands,
not edit a returned scene or maintain another editable geometry store.

### Document boundaries

Schema 1 retains:

- `id`, `revision`, optional `name`; `site`, `building`, and `environment`.
- The active `legacy:{controls,manualLayouts,context?}` projection.
  `manualLayouts` is the existing array of `[signature, layout]` records.
- `floors:[{id,name,heightM,legacy,...}]` and `activeFloorId`.
- Active `wallEdits`, `doorEdits`, `windowEdits`, `furnitureEdits`, `obstacles`
  and `electrical`. Each floor may retain its own copies of all these fields,
  plus `wallHeightM`.
- JSON-safe, feature-owned environment/electrical metadata and additional
  same-schema fields. Feature modules must validate their own scientific or
  electrical record semantics; accepting JSON does not validate a simulation.
- Optional versioned authored/documentation envelopes, including
  `documentation.package` for shared package print intentions. The feature
  validator checks these additive records without a project schema bump.
  Derived sheets, manifests and analysis evidence remain separate snapshots;
  see [drawing foundation](drawing-foundation.md).

Captured `legacy.context` preserves `{plate,g,plan,cfg}` for inactive floors.
Optional `legacy.roomIdentities` stores each generated room prefix's active
`ids` and monotonically increasing `next` suffix. Selected-room deletion removes
only the requested identity and reduces its type count; surviving rooms are
not renumbered, and new rooms do not reuse deleted identities. The active-floor
adapter captures/restores this state with its controls and manual layouts.
Old documents without it retain their original generated IDs.
The same optional state accepts the `balcony` prefix. A balcony is a separate
`g.balconies` source, not a fake habitable room. Its derived `scene.balconies`
record is `{id,sourceId,type:'balcony',label,rect,roomId}`; `roomId` is the
floor-namespaced attached room, or `null` when unresolved/unrecorded. Source IDs
must be supplied and unique. Balcony areas are not added to room usable/carpet
area or service reservation totals. Deleting a selected balcony decrements the
balcony programme and preserves the surviving IDs/rectangles; it is not a
renderer-only removal.
Site projections must translate `balcony.rect` through the same `shift` as
furniture/room rectangles exactly once, retaining dimensions and IDs. The
3D renderer must consume that scene's coordinate frame and expose
`{kind:'balcony',id}` on its balcony mesh; adding the model collection alone
does not establish a selectable 3D balcony surface.
Runtime Maps, Sets, DOM nodes and functions do not belong in this snapshot.
Compilation reads the **active top-level projections**, not potentially stale
copies in the corresponding floor record. The coordinator saves and loads those
slices when switching floors, and can build all floors without changing the UI.

Floor elevation is building base elevation plus the ordered heights of all
preceding floors. The legacy regulatory `plate.floorElevation` is deliberately
not a physical-storey offset. An optional `context.floorElevationM` explicitly
overrides the derived elevation for an adapter preview. A wall base equals that
floor elevation. Explicit obstacle `baseM` values retain their absolute datum.
Additive `scene.roofThicknessM` copies the project's explicit preview thickness:
the flat roof underside is at `floorElevationM + wallHeightM`, and its geometric
top adds `roofThicknessM`. This supplies geometry, not a material assembly or
thermal/optical property.

For read-only comparisons, additive `scene.regulatory` exposes:

```text
allowedFloors: number | null
plannedFloors: number | null
customSetbacks: boolean
nonCompliantSetbacks: boolean
requiredSetbacks: object | null
appliedSetbacks: object | null
basis: string
source: 'legacy-optimizer'
plateId: string | null
selectedHeightM: number | null
floorToFloorM: number | null
stiltParking: boolean | null
```

`allowedFloors` is `plate.maxFloors` when supplied, or the older `plate.floors`
estimate for backward compatibility. `plannedFloors` retains the selected count
without replacing the maximum. These are Plot Planner scenarios for the
selected plate/height and road-cap/TDR configuration, not an independently
verified legal maximum or planning permission. It counts habitable floors,
excluding stilt parking. Missing/malformed allowance stays `null`; the model
does not substitute editable-floor count, enforce approval, or use the estimate
to derive physical storey elevations. Consumers must display the supplied basis.

`scene.floor` is the **buildable floor plate**, not necessarily the property.
Additive `scene.plot` carries the actual net plot rectangle in that same local
coordinate frame. Its origin may be negative because the front/left setbacks
lie outside the buildable plate. It comes from `plate.sitePlot`, or is recovered
from a complete legacy `localSetbacks`, `width` and pre-tot-lot `rawDepth`.
Without that evidence it stays `null`; the model never calls the buildable
plate the whole plot. Site-based sunlight analysis translates each scene to the
common plot origin before measuring boundary gaps.

Defaults are **Hyderabad EXAMPLE**, not detected position, and **ASSUMED preview
dimensions**: 2.7432 m wall height, zero base elevation, 0.15 m roof thickness
and 3 m storey height. The codec does not make these measured inputs or consent
to geolocation, persistence or numerical analysis.

### Validation and imports

Validation rejects unsupported schemas, missing required fields, duplicate floor
IDs, invalid active floors, nonfinite numbers anywhere, invalid geometry-edit
enums/ranges, invalid site coordinates/time zones, invalid obstacle dimensions,
cyclic data, sparse/extended arrays, accessors and non-JSON runtime instances.
`__proto__`, `constructor` and `prototype` keys are forbidden recursively.
It checks property descriptors without invoking accessor getters.

Imports are limited to 32 MiB of JSON text, nesting depth 64, one million
visited values, arrays of 200,000 items and 100 floors. These are defensive
document limits, not a promise to render large projects interactively.
Unknown host references are **retained**, not silently rebound or discarded.
JSON backups therefore preserve incomplete drafts and support exact undo/redo
snapshots without a command/event-log dependency.

## Coordinates and identity

All planar scene geometry is local: x right, y toward the rear, z up.
Local N/E/S/W mean negative y / positive x / positive y / negative x.
`headingDeg` is the road/front bearing: N=0, E=90, S=180, W=270.
For `dx = x - floor.w/2`, `dy = y - floor.h/2`:

```text
east  = dx*cos(heading) - dy*sin(heading)
north = -(dx*sin(heading) + dy*cos(heading))
Three.js = (east, up, -north)
true head bearing = (local head bearing + headingDeg) modulo 360
```

Do not rotate the room rectangles before applying this transform.
In plan coordinates the **left** side of a start-to-end wall tangent `(tx,ty)`
has normal `(ty,-tx)`; right is `(-ty,tx)`. A door's swing side is relative
to the wall orientation, not to whichever hinge is chosen. Its hinge changes
which arc sweep is used, not the meaning of left/right.

Room/furniture/opening scene IDs have the form `${floorId}:${sourceId}`.
Legacy `sourceId` values remain unchanged for adapter mutations. Missing room
or furniture IDs can use a supplied stable legacy `seq`; neither array indexes
nor current coordinates are invented as identity. Generated opening fallback
IDs use room, kind, edge and target identity. Missing ambiguous identities are
reported instead of silently assigned. Floor IDs cannot contain `:`, which
keeps the floor namespace unambiguous even when legacy source IDs contain it.
Scene obstacle IDs are also floor-namespaced (without doubling an existing
floor prefix), with their authored ID preserved as `sourceId`.

Wall IDs encode owning room/edge or shell-edge identity and endpoint/junction
lineage. Geometry is used to discover topology, but coordinates are not wall
IDs. Reordering rooms or moving a boundary without changing its relationships
preserves identity. A real topology split/merge can invalidate an old host:
the model does not claim a nearest wall is its successor. Electrical authored
IDs remain as supplied; that feature's schema requires floor-namespaced IDs.

## Effective walls and openings

Clear room `rect` values are copied from legacy `carpet`; `module` retains
packing/half-wall allowances. Logical rooms and their labels persist when a
physical partition disappears.

### Explicit lift/stair footprint reservations

Only a placed room whose request has **both**
`req.reserveFootprint === true` and `req.type` equal to `lift` or `staircase`
opts into reservation semantics. `service:true`, a service-zone hint, a
non-service room with that flag, and old unflagged lift/stair fixtures do not
opt in. Old scenes retain their original geometry, overlap errors and enumerable
room/quantity fields. Imports are not upgraded or mutated by compilation.

`planner-regions.js` supplies the dependency-free, frozen
`HomePlannerRegions` browser/CommonJS API. Load it before the first reserved
`buildScene` call; the model looks up the browser helper at compilation time.
Node requires it directly. A missing browser helper does not change unflagged
scenes; an opted-in scene fails explicitly rather than inventing geometry.

| Rectangle API | Contract |
| --- | --- |
| `intersection(a, b)` | New frozen `{x,y,w,h}` for a positive-area intersection, or `null` for separated/touching rectangles. |
| `subtractRectangle(base, cutters)` | New frozen, deterministically ordered array of frozen non-overlapping rectangles covering the base minus the cutters' union. Cutters may overlap each other or extend beyond the base. An entirely reserved base returns `[]`. |
| `area(rectangles)` | Finite total square-metre area of supplied non-overlapping rectangles; `[]` is zero. Positive overlap is rejected rather than double-counted. |
| `reservationBounds(carpet, module)` | New frozen full reservation rectangle; the supplied wall-centreline module must contain the complete carpet. Each module edge expands outward by its own clear-to-centreline margin. |

The kernel never mutates inputs, executes rectangle accessors, uses the DOM or
network, or chooses default dimensions. Coordinates, positive dimensions,
endpoints and areas must be finite and numerically representable. Contact is
compared at floating-point resolution (`4 * Number.EPSILON` times the magnitudes
of the compared coordinates), not a fixed building-size allowance. Roundoff
contact does not create phantom slivers; rectangles below that coordinate
resolution, underflowing areas and overflowing totals fail explicitly.

The legacy module remains a **wall centreline box**, not the full outer wall
extent. For carpet `x=2, w=1.5` and module `x=1.94, w=1.62`, the 0.06 m margins
represent 0.12 m walls: reservation `x=1.88, w=1.74`. Each of the four margins
is evaluated independently, including asymmetric wall allowances. Opted-in
services require a supplied module; the old missing-module fallback does not
invent new reservation walls. Full footprints outside the building fail;
footprints intruding into the exterior wall are geometry errors. Placement
should keep the full footprint inside the building walls, not merely its carpet.

New fields on an opted-in service room:

```text
reservesSpace: true
reservationFootprint: {x,y,w,h}
usableRegions: [{x,y,w,h}]          // detached copy of its own clear carpet
grossAreaM2: number                // its carpet area, not its outer reservation
usableAreaM2: number               // its own carpet area
reservedAreaM2: 0
hostRoomIds: string[]              // ordinary rooms with positive footprint intersections
```

New fields on each affected ordinary (`!room.service`) host:

```text
usableRegions: [{x,y,w,h}, ...]     // may be empty, disconnected or nonrectangular in union
grossAreaM2: number                // original bounding carpet area
usableAreaM2: number               // area of usableRegions
reservedAreaM2: number             // union of full service footprints intersected with its carpet
reservationRoomIds: string[]       // floor-namespaced service room IDs
```

`room.rect` and `room.module` remain unchanged editable bounding rectangles.
Renderers, label placement and sampling must use
`room.usableRegions ?? [room.rect]`, **not** fall back when the region array is
empty. A full reservation can consume one host or intersect several hosts.
Service carpet is usable only as the service's own floor, never a second copy
under a host. Overlapping ordinary carpets and overlapping service reservations
remain errors, including service wall allowances overlapping without carpet
overlap. Furniture intersecting a reservation is retained with
`reservationRoomIds` and an error diagnostic; neither its source nor edits are
silently deleted, and its presence cannot restore reserved host area.

Ordinary wall bands are normalized using the existing interfaces, then
subtracted by the full reservations before the existing wall noding step.
Crossing spans are trimmed; a partially cut wall band retains its real narrower
remainder. Identity uses original room-edge and reservation-edge lineage, not
coordinates or array indexes. Service walls retain their supplied centreline
and per-edge thickness. Their spans gain adjacent ordinary `roomIds` only where
usable floor actually meets their outer face, splitting at host boundaries.
This adjacency is **not** additional ownership of the host's old room edge.

Surviving ordinary wall and shell spans also lose or split host adjacency where
reserved space replaces that host's usable floor, including footprints that only
touch the wall rather than remove its material. A narrowed shared-wall remainder
retains only rooms whose clear face still meets it. Original source tokens remain
in its lineage; lost adjacency cannot host an aperture, even with an explicit
wall ID. The shell remains a known exterior boundary; a one-sided internal wall
is not promoted to an outdoor boundary.

Saved hosts invalidated by splitting remain unresolved. A door cannot straddle
two host spans or silently move from an old wall onto a narrower shifted remnant
or new service wall. An aperture through adjacent wall bands that lacks one
valid host must be explicitly resolved; the compiler does not invent a
multi-wall cut, two leaves or a structural junction solution. Sub-`1e-7` m
wall remnants or centreline shifts below the existing topology resolution fail
explicitly rather than being discarded. Shaft/slab penetrations, treads,
clearances, construction details and structural approval remain unspecified.

`HomePlannerProjection.projectScene` translates `usableRegions` and
`reservationFootprint` alongside `rect`/`module` into the common site frame,
without changing dimensions or areas. Architectural sheets place host labels
only inside available usable regions (or key them to the room schedule), and
report `NET` and `RESERVED` area instead of calling the whole bounding box
`CLEAR`. These area disclosures remain when linear dimensions are hidden.
Reserved services are local cutouts, not building-wide `BAY` divisions.
Missing usable label space, unresolved apertures, invalid geometry and fixed
scale/schedule overflow still fail explicitly; no packing size, automatic
shrink, shaft or stair construction is inferred.

The compiler:

1. Retains the configured exterior shell even when the programme is empty.
2. Suppresses room-module perimeter duplicates at that shell. The legacy
   half-internal-wall perimeter allowance is not extra carpet or a second
   external wall; it is not asserted to be a surveyed room-face dimension.
3. Unifies coincident room interfaces. Opposing legacy wall bands that actually
   overlap/touch are consolidated between unchanged carpet faces, including
   unequal allowances. A real gap between wall bands is not welded by a
   display or legacy access-distance tolerance.
4. Splits partial overlaps and orthogonal T/cross junctions into uniquely
   identified spans with consistent adjacent `roomIds`.
5. Resolves legacy/custom apertures and supplemental edits before computing
   solid geometry and quantities.

Every wall has oriented `start/end`, `thicknessM`, `heightM`, absolute `baseM`,
`exterior`, `structuralRole`, `roomIds`, `openings`, `solidSegments` and `removed`.
`structuralRole` is **unknown**: legacy outlines/material/role hints are not
structural evidence. No unknown wall is declared safe to demolish. Exterior
removal is rejected by the coordinator and cannot cut the model through an
imported edit or legacy passage.
An internal module edge without positive wall allowance is diagnosed rather
than given fabricated thickness that would consume its clear carpet.

`wall.openings` contains the same opening objects as the scene's flat collection.
Every effective aperture has a bounded along-wall interval
`[offsetM, offsetM+widthM]` and vertical interval `[sillM,sillM+heightM]`.
`segment` is the derived local centerline segment on its actual host.
Doors/windows do not straddle unrelated hosts or junctions by inventing two
leaves. Invalid host/height/width intervals are diagnosed, not clamped into a
different valid edit.

- `solidSegments:[{startM,endM}]` describes **full-height piers**, excluding
  aperture spans. It alone is not enough to render window sills or lintels.
- Additive `solidSections:[{startM,endM,sillM,heightM}]` describes all surviving
  rectangular solid regions, including sill/head infill and vertically stacked
  apertures. `sillM` is relative to wall base. Renderers can use these directly,
  or derive the same interval union from openings.
- `removed:true` means no masonry remains over the entire span and height.
  A door spanning the length but retaining a lintel is not a removed wall.
  A full-span/full-height door or window can still retain a canonical infill
  record: omit masonry, not its leaf/glazing or declared optical operating
  state. Wall absence alone is not proof of a transparent/open-air boundary.
- Full/partial partition edits create full-height `passage` apertures; they do
  not erase paint. Legacy `full` shared partitions use the true interface span,
  not the old shortened glyph. Room-to-passage removal uses the actual passage
  overlap when available.
- Duplicate source proposals share one physical opening. Merged aliases are
  retained in additive `sourceIds`. Overlapping incompatible apertures and
  doors/windows on removed partitions go into additive `unresolvedOpenings`
  and diagnostics. Original legacy records and edits are never deleted.

Custom legacy `fraction` denotes the **center** of its room-module edge.
Width overrides are anchored at the original aperture start. `hinged` and
`sliding` remain distinct. All four bed head polarities survive square
footprints; missing legacy polarity is marked `headDirectionAssumed` and
diagnosed, rather than pretending a rotation boolean establishes the head end.

### Direct wall and opening commands

The shared inspector accepts selections from either view; commands always
resolve the exact ID on the **active** floor. Selecting an object on another
3D storey never grants permission to edit it from the current floor.

`wallEdits[wallId]` has these additive schema-1 forms:

```js
{ full: true }                                   // all retained material
{ full: false, offsetM: 1, widthM: 2.7 }           // intentional fixed width
{ full: false, offsetM: 1, toEnd: true }           // exact end-following intent
{ retainedSpan: { startM: 0.3, endM: 3.4 } }      // trim only
{ retainedSpan: { startM: 0.3, endM: null } }     // keep original host end
```

A retained span can coexist with one of the three opening forms. Offsets use
the **original** `wall.start`, not a shifted renderer origin. `wall.start/end`,
room footprints, wall lineage and attachment offsets remain unchanged. The
compiler exposes the effective numeric `wall.retainedSpan` and models the
trimmed-away ends as full-height passages. `solidSegments`, `solidSections`,
quantities, 2D material and 3D cutouts therefore agree without a second wall
graph. Existing wall-anchor resolution diagnoses those passage interiors as
`host-void`; independent authored and electrical records are retained.

`toEnd:true` computes `retainedEndM - offsetM` on every compilation. For a
3.7255 m host and 1 m offset, the opening is exactly 2.7255 m. An explicit
2.7 m width still deliberately leaves 25.5 mm; the model never rounds it away
or accepts an arbitrary oversized width. A fixed retained end stays fixed,
while `endM:null` follows the host end if same-lineage geometry changes.
Out-of-range imported spans remain saved and diagnosed **without partial
application**. Exterior, protected and unclassified walls are guarded.

`open-wall`, `trim-wall` and `restore-wall` require
`confirmConceptual:true`. `trim-wall` takes `startM` and `endM` (finite metres,
or `endM:null`); it cannot move or extend the original wall. Restoration
removes the wall edit, including its trim, and the matching legacy passage,
not unrelated independent attachment records.

`add-door` takes `wallId,offsetM,widthM,heightM,openFraction,hinge,swing`.
`add-window` takes `wallId,offsetM,widthM,sillM,heightM,openFraction`.
All dimensions are metres; door sill is zero. New apertures use the existing
legacy `customOpenings` / saved `openings` collection with an explicit
`wallId` and `offsetM,widthM,heightM,sillM`, not another editable opening
store. The legacy adapter must bypass fraction-based glyph clamping and
room-wide generated-window replacement for these records.

The bridge checks active host identity, retained ends, vertical bounds,
typed dimensions/operating state and overlapping aperture rectangles,
including full-height cuts. Current schematic minimum spans remain 0.68 m
for doors and 0.30 m for windows; these are editor limits, not verified clear
passage or regulatory minima. It verifies that the committed real aperture
retains the requested interval and that existing apertures/furniture were not
removed or repositioned. Failure restores the prior project, adapter state,
selection and history. A furniture-conflicting placement is rejected rather
than silently repacking the room.

Both `doorEdits` and `windowEdits` additionally accept `offsetM` and `heightM`.
Window head controls translate to height; there is no `headM` edit field.
Explicit wall-hosted opening records are retained when a later host is
missing, split or cut away. They are not attached to the nearest wall.

Door/window edits also accept optional boolean `suppressed`. A true value
removes that source's effective aperture/infill without erasing its original
record or other edit metadata; false/absent retains normal compilation.
Source identities and conflicting-duplicate checks still run before suppression.
The edit key is the canonical floor-prefixed input identity. A compiled merged
opening's `sourceIds` are **raw input source IDs**, so the coordinator prefixes
each with its floor when suppressing every shared source. Derived fragment IDs
are not a replacement for this source mapping. JSON backups retain suppression
and prior fields; Undo restores the former authored state.

### Door and window assumptions

Door metadata separates:

- `requestedClearWidthM`: design target, not proven clearance.
- `widthM`: schematic host aperture span.
- `nominalLeafWidthM`: specified nominal value or explicit schematic proxy
  used by `doorGeometry` as its radius.
- `dimensionConvention:'schematic-proxy'`, `clearWidthVerified:false`,
  `leafWidthAssumed` and `handingAssumed`.

No universal frame allowance is fabricated. Frame/stops, hardware, hinge
offsets and actual clearance measurement remain unspecified. A 90° glyph is
independent of `openFraction`; operating state defaults to closed.
Handing copied back from a legacy glyph is still assumed; explicit project
hinge/swing edits distinguish a confirmed design choice from that proxy.
Legacy window `operability` becomes `operableFraction` (potential capacity),
not an actual opening state. Only explicit `openFraction` sets that state.
Glazing must not become a free airflow portal simply because a wall has a
window aperture. Defaults for missing door height, window sill/head and
handing are schematic assumptions exposed in diagnostics.

## Quantities and limits

- `wallFootprintM2` is the planar **union** of wall material at floor level.
  It counts corners/T overlaps once, removes floor-level doors/passages, and
  retains material below elevated window sills.
- `solidWallFaceAreaM2` is a **single nominal wall-elevation area** per physical
  span, minus the union of aperture rectangles. It is not both paint faces,
  revealed frame area, an exterior-only envelope area or a construction bill.
- `roomCarpetM2` is the union of actual usable room regions, including service
  clear carpet separately. Unflagged scenes retain their clear-rectangle
  calculation. Reserved service walls are not counted as usable host floor;
  overlapping invalid rooms are diagnosed rather than numerically counted twice.

Scenes with opted-in reservations additionally expose finite union quantities:

| Metric | Area measured |
| --- | --- |
| `grossHabitableCarpetM2` | Ordinary rooms' original bounding carpets, before reservations. |
| `habitableCarpetM2` | Ordinary rooms' actual usable regions after all reservations. |
| `serviceCarpetM2` | Service rooms' own clear carpets, not their wall allowances. |
| `reservedHostAreaM2` | Full reservations intersected with ordinary carpets, counted once across hosts. |
| `reservedFootprintM2` | Full service reservation footprints, including parts in former wall bands or otherwise unassigned space. |

For valid non-overlapping programmes, gross habitable area equals usable
habitable area plus reserved host area, and `roomCarpetM2` equals habitable
plus service carpet area (within floating-point resolution). The full reserved
footprint need not equal the host deduction: it may also intersect existing
wall allowances or unassigned floor. These are geometric floor quantities,
not certified habitable-area, accessibility or regulatory classifications.

This is an orthogonal schematic adapter, not arbitrary polygon/CSG, structural
engineering, a certified accessibility check, a CFD mesh or a calibrated
thermal enclosure. Service-room outlines do not establish stair/lift shafts,
slab penetrations or real structural construction. The frontage entrance
marker alone does not establish a physically connected host aperture.
Unmodelled clearances, envelope continuity, materials, operating scenarios,
zones and assumptions need explicit review before numerical analysis.

Run the existing Node runner for this slice:

```powershell
node --test tests\planner-regions.test.cjs tests\planner-reservations.test.cjs tests\planner-model.test.cjs tests\planner-foundation.test.cjs tests\planner-drawing.test.cjs tests\planner-drawing-pagination.test.cjs
```
