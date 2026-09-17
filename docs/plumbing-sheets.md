# Plumbing sheets — Phase 6 authored intent

These are **not engineered plumbing drawings** or construction documents. They
share the immutable graph described in [plumbing-networks.md](plumbing-networks.md);
the renderer never edits the project, resolves anchors independently, invents
fittings, or changes routing. Rain is deferred.

## API and integration

Load `planner-model.js`, `planner-projection.js`, `planner-drawing.js`,
`planner-services.js`, and **`planner-services-drawing.js`** in dependency order.
Include the model's existing feature dependencies as usual. The renderer has no
DOM, storage, networking, or third-party dependencies.

Browser global `HomePlannerServicesDrawing` and CommonJS
`require('./planner-services-drawing.js')` expose exactly:

```js
const options = {
  floorId: 'ground',
  view: 'plan',                 // 'plan' (default) or 'riser'
  paper: 'A2',                  // A4 / A3 / A2; default A3
  orientation: 'landscape',    // portrait / landscape; default landscape
  scaleDenominator: 100,       // 50 / 75 / 100; default 100
  units: 'metric',             // metric / imperial; default metric
  systems: ['water', 'waste']  // default both; unique subset; [] allowed
  // title, floorName: optional nonempty text
};
const pages = HomePlannerServicesDrawing.createSheets(drawingScene, options);
const singlePage = HomePlannerServicesDrawing.createSheet(drawingScene, options);
const svg = HomePlannerServicesDrawing.toSVG(pages[0]);
```

`drawingScene` must come from the real shared projection or bridge. `floorId` is
required; there must be exactly one registered site-local scene for that floor.
Missing **selected** floor geometry fails, rather than printing a partial plan.
Other floors can be unresolved: their links remain explicit gaps and warnings.
Options accept only the keys above. Unknown options, explicit null/undefined,
duplicates and rain selection reject. Display units do not change geometry.
Imperial schedule lengths use signed decimal feet; pipe diameters retain supplied
millimetres. The default title includes the view; default floorName is floorId.

`createSheets` returns a deeply frozen array of deeply frozen version-1 Drawing
sheets. Every page passes `HomePlannerDrawing.validateSheet`. `toSVG` is the common
serializer, not a separate export implementation. Pass the **entire array** to
`HomePlannerDrawingExport.pdfBytes`; PNG/SVG remain per-page using existing
exporters. Existing PDF media boxes and paper-sized text are preserved.
`createSheet` returns one complete sheet only when all schedules/warnings fit;
otherwise it throws with instructions to use `createSheets`. It never returns
just the diagram from a multipage set.

UI integration should supply selected floorId, current floorName, view, selected
systems, paper, orientation, scaleDenominator and units, then preview/export all
returned pages. Prefer A2 landscape for normal networks. Catch and present fit
errors without automatically changing scale or dropping entities. There are no
`layers`, `maxPages`, engineering-status, rain, or pipe-width options. Headers
identify view and selected scale; the riser header marks it as **z scale**.
The existing version-1 metadata contract is unchanged—no custom view/system
metadata fields are added.

## Shared scope and connectivity

Each call invokes `HomePlannerServices.build(drawingScene, {systems})` **once**.
Both views select:

- all nodes owned by the selected floor;
- all selected-floor-owned routes, plus routes owned elsewhere whose from/to
  floor reference touches the selected floor;
- every existing endpoint node of those routes, even when owned by another floor;
- selected-floor fixtures and explicitly fixture-hosted endpoints' fixtures.

Node, route and fixture keys (`N1`, `R1`, `F1`) use full-project selected-system
floor/ID pair order. The same scene/options retain exactly the same keys between
views and selected floors. Missing referenced nodes are identified as missing,
not fabricated. Selecting another system subset can renumber keys.
Riser level keys `L1`, etc. refer to all referenced owner/endpoint/via floors and
registered intermediate floor levels within the visible network elevation span.
Intermediate context bars do not create nodes, route landings or penetrations.

Schedules retain full IDs, names, circuits, roles, node/fixture anchor references,
from/to floor/ID pairs, original ordered via references and every resolved or
unknown route point. They distinguish selected ownership from referenced
incoming/outgoing routes. Coordinate schedules always include common-site x/y
and project-relative z, independent supplied inverts, diameters, supplied
unvalidated slope and complete 3D geometric length. No plan-projection distance
is substituted for graph length, and no incomplete route gets a partial total.

All graph findings are printed **project-wide for selected systems**, including
disconnected, unsupported-equipment and unknown-geometry findings outside the
diagram's scope. Shared scene/source diagnostics are also printed, with their
context. Unknown-field/point counts describe the scoped schedule, not a pass
score; unsupplied water slopes are counted but not asserted necessary.
No warning count, absence of a clash, or known diameter establishes safe design.

## Geometry and graphic conventions

### Plan

The plan uses the projection's common site frame. Its actual plot, selected
floor's physical wall solids, fixture footprints, foreign locations and every
known route point participate in fixed-scale bounds. Long off-plot/foreign
geometry fails fit rather than being hidden. Floor-local origins are not reused.

Faint wall underlay uses supplied `solidSections` at floor elevation +1.20 m.
Door/window voids through the cut stay empty; solids below/above an aperture are
included only if the cut intersects them. No invalid/fabricated window fill or
new door interpretation is added.

Fixtures have a centered W/D footprint only if both dimensions are supplied;
otherwise they have a paper-sized missing-size marker. Height remains scheduled,
including unknown. No fixture socket, port offset, pump, tank or device internal
is inferred. Unresolved fixture locations are schedule-only.

### Riser

The horizontal dimension is **NONSPATIAL topology columns**, 12 mm apart on paper
in stable reference-pair order. Node endpoints share their node's column.
Waypoints interpolate horizontally between endpoint columns in authored order;
that spacing does not represent plan distance, site x, site y or pipe length.
Vertical positions preserve actual project-relative z at `1000/scale` mm/metre.
Each referenced registered floor gets a true-level bar, keyed to its full floor
ID and elevation in the legend/schedule. Unknown levels stay unknown.
Fixture dimensions/locations remain in schedules, not invented riser bodies.

Equal projected segments and nodes may overlap, especially when waypoints have
the same height or multiple routes share endpoint columns. Individual keyed
leaders and explicit overlap warnings retain that ambiguity. The renderer does
not apply deceptive lateral offsets or infer connectivity from crossings.

### Both views

- Each route segment joins only **adjacent known points**. A null point breaks
  the route, including unresolved endpoints. Isolated known points are marked
  and labeled; wholly unknown locations are schedule-only.
- `R1.2` means segment 2 of route R1; `R1.p0?` means an isolated known point.
  Full route point indices are in schedules. Visible arrows follow proposed
  from-to order only; segments too short for a readable arrow retain their key.
- Purpose glyphs and keys distinguish port (P), valve (V), trap (T), cleanout (C),
  stack (S), junction (J), fixture (F), supply (I) and outlet (O). These are
  **diagram glyphs**, not measured fitting internals. Unknown roles are explicitly
  scheduled even if their base kind supplies the diagram glyph.
- Pipe centerlines always use paper-sized ink; **even known diameter does not
  become a physical pipe width**. Cold/hot/soil/waste/vent/unknown have separate
  colors and explicit circuit schedule text. Colors do not infer circuits.
- Dashed foreign footprints/marker outlines and dashed cross-floor proposals
  carry `*` keys. Full foreign floor labels are in their keyed schedules and
  referenced-level legend. A foreign location does not mean a resolved
  penetration, shaft, intermediate landing or engineered riser.
- Geometry keys are placed outside other labels and represented solid footprints,
  with leaders avoiding label text. If readable placement is impossible, the
  render fails rather than leaving an unlabeled or off-page entity.

## Pagination and bounds

Diagram geometry never auto-fits or shrinks. Text is at least 2 mm (normally
2.2 mm). When schedules do not fit the side panel, `createSheets` creates full
two-column continuation pages. Read left column, then right column, then next
page. Headings repeat when a record spans columns/pages. A printed `| ` prefix
preserves wrapped record content, including long IDs/labels and whitespace
fragments; no ellipsis drops information. Mandatory caveats, identity and page
numbers repeat on every page. Small media can use a compact first-page legend;
the full legend remains in the continuation set.

The complete set is bounded to 100 pages, 500000 source schedule characters,
1000000 output text characters, 2000 keyed diagram positions, 500000 overlap
comparisons and 2000000 label-placement candidates, plus existing shared graph/
Drawing limits. Exceeding a bound fails actionably; no bounded operation quietly
omits nodes, routes, warnings or text. Dense schedules paginate independently of
geometry. An ordinary five-node/four-route network with many warnings fits A2
with continuation pages rather than failing warning density.

## Not engineered

Geometric length excludes fitting allowances, bends, sockets, joints and purchase
waste: **not procurement quantities**. No terrain, drain fall, sizing, hydraulic
flow, pressure, capacity, demand, clearance, code compliance, construction
details or engineering adequacy is assumed. Invert is independent of anchor z.
Entered slope is neither enforced nor validated. Required professional review
and the no-engineering-pass warning are printed on every page.

## Verification

```powershell
node --test tests\planner-services-drawing.test.cjs tests\planner-services.test.cjs
```

Tests build actual model/project fixtures through shared projection, exercise
unequal floors, circuit separation, port references, unresolved floors and route
gaps, immutable deterministic global/CommonJS output, physical plan/riser scale,
wall apertures, missing fixture dimensions, incoming links, complete warning
pagination, and existing PDF/SVG exports.
