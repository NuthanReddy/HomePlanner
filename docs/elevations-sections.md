# Saved elevations and finite sections (Phase 5)

`planner-elevation.js` is a pure renderer. It reads a version-1
`HomePlannerProjection.build(project)` DrawingScene, including its saved
`documentation.views`, without modifying the scene, document, active floor or UI.
Load Model, Projection, Drawing and Structure before the browser script.
CommonJS loads these existing modules directly. No dependencies are added.

```js
const pages = HomePlannerElevation.createSheets(scene, {
  viewId: 'saved-view-id',
  paper: 'A3',
  orientation: 'landscape',
  units: 'metric',
  // scaleDenominator: 100, // required only when the saved scale is null
  // title: 'North elevation',
  // floorName: 'Ground floor'
});
const svg = HomePlannerElevation.toSVG(pages[0]);
// HomePlannerDrawingExport.pdfBytes(pages) accepts the same sheet array.
```

The frozen global/CommonJS API contains exactly `createSheets(scene, options)`,
`createSheet(scene, options)` and `toSVG(sheet)`. Outputs are deeply frozen common
Drawing sheet primitives, version 1, in millimetres. Every page is checked by
`HomePlannerDrawing.validateSheet`; SVG uses its existing XML-safe serializer.
`createSheet` throws when the full drawing and notes need continuation.
`createSheets` retains all notes and schedules on additional pages; it never
splits or rescales the geometry. Exceptions are actionable and must be surfaced
by the calling UI, not replaced with a successful blank preview.

## Saved view and integration contract

`viewId` is required and must identify exactly one saved elevation or section.
It is not an arbitrary direction or ephemeral view definition. Plan views,
unknown options and explicitly undefined option values are rejected.
Elevation direction must be N/E/S/W, not null. A section needs two cut anchors.
The saved `floorId` supplies the attachment and common sheet metadata; it does
**not** filter the physical building to one floor. Pass `floorName` for a friendly
attachment title because projected scenes do not carry the saved floor name.
Title otherwise uses the saved view name.

Paper defaults to A3, orientation to landscape and units to metric. Supported
paper is A4/A3/A2 and scale denominators are 50/75/100. A non-null saved scale
governs; a conflicting option is an error. If the saved scale is null, an
explicit supported option scale is mandatory. Units change labels, not physical
geometry: 10 metres is 100 mm at 1:100. Output must be printed at 100%, not
"fit to page." Long headers and geometry outside fixed media fail rather than
shrinking. Continuations preserve identical project/revision/floor metadata.

The UI owns creation of front/rear/left/right saved views, persisted scale
changes, printing and export. Convert building-relative sides through the
existing project front-cardinal convention before persisting geographic
directions. Do not pass a new renderer `front`, `heading`, `floorId`, `cut` or
`layers` option. No UI, core model or script registration is changed here.

## Geographic and vertical coordinates

All geometry uses the common plot-local site frame in metres. The renderer calls
`HomePlannerProjection.siteToWorld`, including numeric headings supported by that
helper (project authoring remains cardinal):

```text
east  = x cos(heading) - y sin(heading)
north = -x sin(heading) - y cos(heading)
up    = z
```

Direction means the **geographic side occupied by the viewer**, looking toward
the project, not the direction of the viewing ray:

| Saved direction | Screen right | Looking toward | Nearness coordinate |
| --- | --- | --- | --- |
| N | east | south | north |
| E | south | west | east |
| S | west | north | south |
| W | north | east | west |

Paper y increases down; physical z increases up. Labels explicitly print the
view/right/look convention and site heading. All floors must have finite true
elevations, the same heading/plot dimensions, zero projected plot origin and a
known source plot origin. Missing/unregistered geometry on **any** floor blocks
the whole drawing, even when the view attaches to another floor. Other saved
views with broken anchors do not redefine the chosen view.

Wall top is `baseM + heightM`. Floor level bars keyed L1, L2, etc. reference a
printed schedule of exact `floorElevationM` values. Equal levels have separate
nonoverlapping keys; unequal floor heights and setbacks are not normalized.
Slab/footing/member bottom and top and opening sill/head are scheduled relative
to project zero. A supplied site datum also produces absolute floor levels;
absent datum is explicitly unknown. No geodetic reference is inferred.

## Physical geometry and visibility

Walls are the extrusions of their compiled `solidSections` at actual base,
height and thickness, not a horizontal plan cut or an enclosing facade rectangle.
Openings use their supplied sill/head, and the solid sections leave the real
aperture voids. Full-height doors can leave `wall.removed === true` with no
solids: the aperture is still scheduled and checked by Structure for conflicts.
Door leaves, frames and glazing have no supported physical volume here, so are
omitted with a printed caveat. Seeing a rear solid through an aperture is a
geometric representation, not a glass transmission calculation.

Elevations use analytic hidden-surface removal. Each convex rectangular prism
contributes its near vertical faces. Depth varies linearly across each face.
A bounding tree finds overlapping screen rectangles; depth comparisons split
their overlap at crossings, and nearer faces subtract the covered rectangles.
Only surviving rectangles and their outlines are printed. Walls and structural
members behind a nearer opaque wall therefore cannot draw X-ray lines over it.
Shared coplanar ties use stable identities. Subdivision seams are diagrammatic;
this is not a material/finish or photorealistic renderer.

Structural geometry comes exclusively from `HomePlannerStructure.build(scene)`,
with the same bottom-centred box/beam conventions. Columns, horizontal beams,
explicit rectangular slabs and footings are real independent solids. An
aperture cannot erase a structural conflict. All Structure findings and
provenance are printed. Incomplete structural intents are explicitly listed as
omitted, not given guessed dimensions.

Supplied `scene.obstacles` with `type: 'building'` use their exact x/y footprint,
base, height and transmittance, including facade boxes carrying later metadata.
They participate in visibility at their supplied site position. A nonzero
transmittance uses a lighter **opaque diagram mass**, with a printed warning that
this is not ray tracing. Trees and unsupported obstacle types are individually
listed as omitted, never converted into opaque rectangular trees. Furniture,
fixtures, stairs and services are omitted with a general printed caveat.
No roof, parapet, canopy or structural slab is inferred. Even an exposed legacy
`roofThicknessM` is insufficient to define a roof volume.

## Finite sections and anchors

The two saved cut endpoints A and B define a **finite vertical plane**:
horizontal station 0 at A, station length at B, screen right along A to B.
The viewer stands left of A to B in geographic east/north coordinates and
looks to its right. Reversing endpoints mirrors the drawing and reverses the
look bearing. Section `direction`, if present, is printed as unused: endpoint
order is authoritative. Endpoint z values must agree within `1e-7` m; slopes,
coincident horizontal endpoints and broken anchors fail explicitly.

The plane intersects the actual oriented footprint of each physical solid and
clips that intersection to the A-B station range. Wall cross-sections use solid
poche; supplied structural/obstacle cross-sections retain their mass colors.
Closed-volume boundary contacts are included. **No geometry beyond the cut is
drawn.** This deliberately avoids inventing sliced interiors or ambiguous
beyond-plane visibility. A finite cut missing every solid prints an explicit
no-intersection note, floor references and its A-B range.

Anchor resolution is private and pure, matching the existing foundation:

- Point: subtract the referenced floor's `sourcePlotOrigin` from x/y; add that
  floor's `floorElevationM` to z.
- Wall: exact scene wall ID, nonremoved host, offset/height within actual bounds
  and a nonvoid compiled solid section. Position uses `Model.wallPoint` and
  `wall.baseM + heightM`. Aperture boundary surfaces (including a door's zero
  sill) remain valid within `1e-7` m, consistently with foundation anchors;
  positions strictly inside the opening void do not.
- Room/furniture: exact rectangle centre at floor elevation. Opening: actual
  host aperture centre at wall base plus sill plus half height; removed host is
  unresolved, consistently with the foundation's anchor semantics.
- Obstacle: exact footprint and physical volume centre.
- Fixture/stair/structural/service-node: exact authored collection and identity,
  using only its existing resolved projected anchor results, averaged as in the
  foundation. Unresolved, cyclic or depth-limited results cannot become valid
  through a fallback.

Raw authored records are not recursively traversed. The existing projection
has already applied its bounded 64-depth host resolution. No scene mutation,
ephemeral authored dimension, project rebuild or guessed replacement host is
needed.

## Limits and failure behavior

All text is at least 2.2 mm; names and identifiers follow common text validation.
Notes, caveats, source diagnostics, level schedules and structural findings are
printed, not merely put in metadata. Resource limits are explicit:

| Resource | Bound |
| --- | --- |
| Registered scenes / authored records | 1,000 / 70,000 |
| Total indexed wall/opening/room/furniture/obstacle records | 70,000 |
| Physical prism volumes | 4,000 |
| Visibility tree visits, candidates and subtraction steps | 500,000 combined |
| Intermediate or emitted visible fragments | 20,000 each |
| Source notes text / pages | 500,000 characters / 100 pages |

Structure also enforces its existing element and coordination-work limits.
The visibility budget prevents adversarial overlap from becoming hundreds of
millions of comparisons; no approximate partial success is returned when a
budget is exhausted. Missing wall dimensions/solid sections, malformed apertures,
missing building-obstacle physical inputs, invalid site frames and unresolved
selected cut anchors block output. Unknown optional structural geometry and
unsupported representations are disclosed rather than fabricated.

Geometry must fit one fixed-scale page including all floor heights and supplied
off-plot masses. Sections retain full-project vertical extents but clip horizontal
range to A-B. An elevation consisting solely of full-height openings can retain
the known wall envelope and level references without fabricated solids.

Run the independent renderer checks with:

```powershell
node --test tests\planner-elevation.test.cjs
```
