# Conceptual structural foundation (Phase 4)

**Geometry coordination only. Structural engineering is not assessed.**
No result here establishes safety, capacity, compliance or construction readiness.
A qualified engineer must determine structural adequacy. No loads, soil,
reinforcement, connections, analysis or cost are inferred. The first finding
always repeats the caveat, even when the element list is empty. Consumers must
display it alongside any future presentation of these results.

## Authored intent and compatibility

The project remains the only editable source. Use the existing bridge
`set-authored`, `upsert-authored`, and `delete-authored` commands with the existing
`floors[].authored.structural` array. Feature version and project schema remain 1.
The required fields are unchanged:

```js
{id, kind, anchors, widthM, depthM, material}
```

Kind is `grid`, `column`, `beam`, `slab`, or `footing`. Beam/grid require exactly
two anchors; the others require one. Existing strict scoped IDs and point/wall/
entity/null anchor contracts apply, including cross-floor references and
repairable unresolved hosts. Width/depth are positive metres or null. Material is
text or null. Grids require width, depth and material to be null.

Four optional fields are accepted:

| Field | Permitted value |
| --- | --- |
| `heightM` | Positive finite metres or null; beam/grid require absent or null |
| `label` | Nonempty text or null |
| `sizeSource` | `unspecified`, `assumed`, `authored`, `engineer-provided` |
| `reference` | Nonempty text or null |

Numeric magnitude is at most 1e9. Text follows the foundation's length/control
character restrictions. Every present optional field is validated, including
rejecting `undefined`. Other extra keys are rejected. `reference` and
`engineer-provided` are provenance **claims only**, not verified credentials,
drawings or dimensions. A missing reference for an engineer-provided claim is
diagnosed; it does not invalidate the editable record.

Absence is unknown/unspecified; validation never backfills old records. Upsert
replaces a complete record. Active/inactive floor duplication remaps scoped IDs
and local anchor references, preserves external-floor references, and copies
labels/reference text verbatim. Delete retains surviving references for repair.
Undo/redo and JSON preserve both new fields and old records exactly.

## Geometry conventions

The module consumes resolved **site-local** points from the existing projection,
not legacy plate-local coordinates or centered 3D coordinates. X/y share the plot
origin and axes; z is project-relative elevation, not geodetic elevation.
Unequal floor origins and explicit floor elevations have already been resolved.

- **Column/slab/footing:** anchor is the bottom center. Width runs along site x;
  depth along site y. Explicit height is the vertical extent, independently of
  storey/wall height. The box starts at `(anchor.x-width/2, anchor.y-depth/2,
  anchor.z)`. Slabs and footings are rectangular solids only, not arbitrary
  footprint polygons, holes, rebar or foundations designed for a soil condition.
- **Beam:** two bottom-center endpoints. Width is horizontal, perpendicular to
  the segment; depth is vertical thickness extending upward from its bottom.
  Length comes only from the endpoints; no overhang or end connections are
  invented. `heightM` is not an alternate beam thickness.
- **Grid:** horizontal planar reference segment, with no volume or material.
  Distinct parallel/intersecting grids are not automatically a framing system.

Coincident plan endpoints or sloping beam/grid endpoints produce null geometry
with diagnostics. Geometry tolerance is 1e-7 metres: differences within tolerance
are treated as coincident/planar/contact. Stored and projected points are not
snapped or rewritten. Unresolved anchors or unknown required dimensions yield
null geometry. In particular **no height means no box**. Missing material or
provenance does not erase otherwise explicit geometry, but always produces the
appropriate warning. Dimensions are never inferred from labels, references,
nearby members, floor heights or legacy wall dimensions.

## API

`planner-structure.js` is a pure classic-script/CommonJS module. It has no DOM,
network or runtime dependency, and exports only `build`:

```js
const Structure = require('./planner-structure.js');
const result = Structure.build(planner.getDrawingScene());
// Browser equivalent: HomePlannerStructure.build(drawingScene)
```

The input must be a version-1 `DrawingScene` from `HomePlannerProjection.build`
(or the bridge). Its authored records have already passed strict model
validation. This is not a replacement raw-project importer. All input remains
unchanged. Output is deeply frozen and disposable, never saved back:

```js
{
  version: 1, projectId, revision, inputFingerprint,
  elements, findings, engineeringStatus: 'not-assessed'
}
```

Identity/revision/fingerprint are copied from the input; they identify captured
inputs, not a certified design or solver convergence. Every element has:

```js
{
  id, floorId, kind, label, sizeSource, reference,
  anchors: [/* resolved site-local {x,y,z} or null */],
  widthM, depthM, heightM, material, geometry, issues: [/* code strings */]
}
```

Read-only defaults: `label = record.label || id`, absent sizeSource =
`unspecified`, absent reference/height = null. Those defaults are **not written
to authored records**. Geometry is one of:

```js
null
{kind: 'box', x, y, z, w, d, h} // x/y minima, z bottom, plan w/d, vertical h
{kind: 'beam', start: {x,y,z}, end: {x,y,z}, widthM, depthM}
{kind: 'grid', start: {x,y,z}, end: {x,y,z}}
```

Findings have exactly `{code, severity: 'warning', elementIds, floorId, message}`.
Project-wide caveats use an empty ID list and null floor. Opening conflicts
include both structural and opening IDs; the floor is the member owner floor.
Codes are deduplicated in each element's `issues`, but findings can repeat a
code for different aperture conflicts or beam endpoints.

## Coordination scope and findings

- `engineering-not-assessed`: unconditional engineering caveat.
- `unknown-dimensions`, `unknown-material`, `unknown-provenance`,
  `assumed-dimensions`, `unverified-reference`, `missing-reference`: missing or
  claimed input provenance. Grid's inapplicable dimensions/material do not
  generate unknown-size/material warnings.
- `unresolved-anchor`, `degenerate-endpoints`, `sloping-endpoints`: unusable
  member positions; no fabricated replacement geometry. Original host failure
  details remain in the input DrawingScene diagnostics.
- `geometry-precision-limit`: positive authored sizes collapse at the supplied
  coordinates in JavaScript numeric precision. Such records remain markers
  rather than becoming zero-area solids or spurious support/contact evidence.
- `out-of-plot`, `missing-plot-information`: compares full known plan extents
  (including oriented beam width) against the plot rectangle. Incomplete boxes
  still use known width/depth for this check; otherwise only known anchors can
  be checked. This is not a setback or permission determination.
- `opening-volume-conflict`: positive-volume intersection with a compiled
  aperture, using its projected segment, host wall thickness, wall base, sill
  and height. A bounds-tree broadphase is followed by vertical overlap and
  separating-axis tests of actual oriented footprints. A diagonal beam's
  enclosing rectangle alone never establishes a conflict. Face touching and
  plan/height near misses do not conflict. Physical volumes are checked across
  floors, not just owner-floor IDs.
- `missing-opening-information`, `unresolved-openings`: unusable aperture
  evidence cannot establish conflicts. Removed walls are omitted. The model's
  existing aperture/thickness assumptions are not upgraded to measurements.
- `column-support-mismatch`: a column has no complete bottom-footprint contact
  with a known support top, and known solids exist on the nearest lower
  registered floor or a candidate top contact exists. Contact requires one
  solid to contain the entire column footprint at the same elevation.
  Offsets, partial footprint coverage and vertical gaps remain coordination
  concerns; there is no snap-to-support or storey-height inference.
- `unsupported-endpoint`: a beam bottom endpoint has no known support top at
  its elevation containing that point. This is a point-contact check only,
  not bearing area, connection, continuity or capacity analysis.
- `missing-support-information`: incomplete geometry, unknown/absent column
  contacts, incomplete nearest-lower-floor intent, or unknown beam endpoint
  contacts. Ground-column information remains incomplete without a lower
  registered floor. Every slab and footing retains this warning because slab
  support layout and ground/foundation support are not evaluated.

Support candidates are supplied column/beam/slab/footing solids, never inferred
load-bearing walls. Contacts use actual site geometry and elevations; a contact
can belong to the same owner floor or another floor. Partial/combined supports
are not unioned. A footprint contained in a support top is merely a geometric
contact; it emits **no structural pass/safe status**. Missing authored members
cannot be distinguished from intentional absence, so missing support information
is never interpreted as a failed structural design.

Defensive `unsupported-kind`, `unsupported-height`, and `invalid-grid-input`
findings also prevent unsupported geometry if a caller supplies manually altered
projected entries; normal strict model validation rejects those records earlier.

## Workload limits and excluded work

One build accepts at most 1000 structural elements, 1000 projected scenes, 70000
total authored entries, 10000 compiled openings and 20000 walls. More than 100000
spatial candidate comparisons across aperture and support queries also fails.
Limits throw explicit `RangeError`s; there is no silent truncation, incomplete
success result or cached partial output. Dense coincident layouts can reach the
comparison limit even below the element limit. Callers must explicitly partition
inputs with awareness that cross-partition coordination is then unavailable.

No edits to UI, 3D, architectural drawings, workspace, index/script wiring or
export formats are included. This foundation adds no meshes to existing views.
It does not provide member sizing, slab holes, reinforcement, structural
analysis, beam-to-beam connection design, lateral systems, soil/load assumptions,
material strength, engineering verification or cost.
