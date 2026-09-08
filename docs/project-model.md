# Project document and effective physical scene

`planner-model.js` is a dependency-free browser IIFE exposing
`window.HomePlannerModel`. Node can `require('../planner-model.js')`; both exports
have the same API. It performs no DOM access, storage, network requests, location
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

Captured `legacy.context` preserves `{plate,g,plan,cfg}` for inactive floors.
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
basis: string
source: 'legacy-optimizer'
plateId: string | null
selectedHeightM: number | null
floorToFloorM: number | null
stiltParking: boolean | null
```

`allowedFloors` is the existing `plate.floors` optimizer estimate for that
selected plate/height and its road-cap/TDR configuration, not an independently
verified legal maximum or planning permission. It counts habitable floors,
excluding stilt parking. Missing/malformed allowance stays `null`; the model
does not substitute editable-floor count, enforce approval, or use the estimate
to derive physical storey elevations. Consumers must display the supplied basis.

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
- `roomCarpetM2` is the union of clear room rectangles; overlapping invalid
  rooms are diagnosed rather than numerically counted twice.

This is an orthogonal schematic adapter, not arbitrary polygon/CSG, structural
engineering, a certified accessibility check, a CFD mesh or a calibrated
thermal enclosure. Service-room outlines do not establish stair/lift shafts,
slab penetrations or real structural construction. The frontage entrance
marker alone does not establish a physically connected host aperture.
Unmodelled clearances, envelope continuity, materials, operating scenarios,
zones and assumptions need explicit review before numerical analysis.

Run the existing Node runner for this slice:

```powershell
node --test tests\planner-model.test.cjs
```
