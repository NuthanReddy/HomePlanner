# Architectural plan sheets (Phase 3)

`planner-drawing.js` is a pure, offline sheet renderer, not another editable
model. Load `planner-features.js`, `planner-model.js`, `planner-projection.js`,
then `planner-drawing.js`. CommonJS `require` works without a DOM. Browser code
uses `window.HomePlannerDrawing`.

```js
const scene = controller.getDrawingScene(); // or HomePlannerProjection.build(project)
const sheets = HomePlannerDrawing.createSheets(scene, {
  floorId: 'ground',
  floorName: 'Ground floor',
  title: 'Architectural floor plan',
  paper: 'A3',
  orientation: 'landscape',
  scaleDenominator: 100,
  units: 'metric',
  layers: { furniture: true, fixtures: true, dimensions: true, site: true }
});
const svgs = sheets.map(HomePlannerDrawing.toSVG);
```

## Contract and physical units

The API is `createSheet`, `createSheets`, `validateSheet`, `toSVG`, `PAPER_SIZES`.
`createSheets` returns the plan and every assumption continuation. It is an
own, non-enumerable additive export so existing enumeration of the original
four exports remains compatible; access it directly, not through object spread.
`createSheet` still returns exactly one sheet, and throws with an explicit
`use createSheets` recovery message if complete notes need more pages.
`floorId` is required. Defaults are A3 landscape, 1:100, metric and all four
layers visible. Optional `title` defaults to `ARCHITECTURAL FLOOR PLAN`;
`floorName` defaults to the selected ID because the projection does not include
floor display names. Pass the actual project floor name from the controller.
Only A4/A3/A2, portrait/landscape, 1:50/1:75/1:100 and metric/imperial are
accepted. `PAPER_SIZES` exposes frozen portrait `{widthMm, heightMm}` records.

Sheets have exactly `{version:1,widthMm,heightMm,metadata,primitives}`.
Metadata contains `projectId`, `revision`, `floorId`, `floorName`, `title`,
`paper`, `orientation`, `scaleDenominator`, `units`, and `assumptions`.
Every coordinate, stroke width and font size is in **paper millimetres**,
with top-left origin and y downward. No viewport, display zoom or pixel ratio
changes geometry: 10 m at 1:100 is exactly 100 mm. Imperial strings round to
whole inches (with feet carry) without rounding the actual paths.

The only primitives are:

- `{type:'path',commands,fill,stroke,strokeWidthMm}`. Commands are `['M',x,y]`,
  `['L',x,y]`, `['C',x1,y1,x2,y2,x,y]` and `['Z']`; colors are six-digit
  hex strings or `null`.
- `{type:'text',xMm,yMm,text,fontSizeMm,align,rotationDeg,color}`. y denotes
  the baseline; positive rotation is clockwise; alignment is start/middle/end.

`validateSheet` returns the identical sheet or throws. It validates the complete
schema, finite numbers, required metadata, supported media, colors, dense
arrays, command order, text ink bounds and stroked path bounds. Cubic bounds
use curve extrema: valid control handles outside the page are not themselves
clipping. Bounds include conservative text ascent/descent and rotation, not
just anchor positions. Limits are 30,000 primitives, 250,000 commands, 200
assumptions and 2,000 physical wall-cut rectangles. Excessive inputs fail
explicitly. Validation never modifies its input.

SVG carries physical mm dimensions and a matching `viewBox`, escaped title and
metadata, and self-contained vector paths/text. All user text is XML-escaped,
never interpreted as markup. Unicode is preserved, not silently transliterated.
The renderer loads no fonts or networks. SVG uses the viewer's sans-serif font;
conservative deterministic bounds are not a font-embedding guarantee. The
separate export module owns the pinned PDF font policy and format conversion.

## Geometry and architectural conventions

- Input must be a real version-1 `DrawingScene` from the shared projection.
  Missing geometry, absent plot registration, inconsistent site frames and
  unknown selected floors fail descriptively. A missing scene is never replaced
  by another floor. Rejected openings and geometry errors block drawing.
  Legacy fixtures which deliberately omit a plot need an explicitly authored
  plot; the renderer does not invent one.
- The horizontal cut is **1.20 m above the selected floor** in project-relative
  elevation. Shared `solidSections`, wall bases, heights and thicknesses produce
  actual wall poche and aperture holes. Rectilinear cuts are unioned before
  drawing, so junctions do not duplicate filled wall solids. Unsupported
  diagonal walls fail rather than acquiring guessed thickness.
- Window glazing has three procedural lines only where the cut intersects the
  aperture. A high-level window above the cut remains solid wall at this height,
  with a printed explanatory assumption. Removed walls are not rendered.
- Hinged doors use **`HomePlannerModel.doorGeometry`** for handed hinge, leaf
  and quarter-circle swing (a cubic approximation). The glyph intentionally
  shows nominal 90-degree handing, not `openFraction` or verified clear opening.
  Other opening kinds show thresholds only; mechanisms are not inferred.
- Furniture uses supplied footprints with original procedural symbolic bed,
  sofa, table, counter and wardrobe interiors. Sanitary records are drawn only
  if explicitly present as supplied furniture or authored fixtures. Authored
  fixture sizes are centered on resolved anchors and site-axis aligned, with
  the unspecified orientation/mounting limitation printed.
- Stairs show only supplied start/end/width intent. **No treads, landing,
  rise/run solution or sanitary internals are invented**, even when a stair's
  riser count is supplied. Incomplete records have explicit notes/markers.
- Room `CLEAR` dimensions use the shared carpet rectangle. `BUILDING` totals
  use outside extent; `PLOT` totals use the supplied boundary. `BAY` chains
  locate room-module divisions inside the building extent, not certified grid
  lines. Authored dimensions are identified as `AUTHORED 3D`, because their
  shared projection distances include z; zero plan spans are noted, not
  misrepresented as horizontal lengths.
- North follows the scene heading. Open-strip labels describe model allowances,
  not verified vacant land or certified setbacks. A non-compliant setback flag
  stays visible. Contained modeled site obstacles show footprint outlines;
  off-plot/boundary-crossing obstacles are explicitly noted as omitted.
  Road, hatch/paving and landscape are not inferred from blank space. The current
  authored schema does not supply paving polygons or road geometry.

## Layout, failure states and layer behavior

Every sheet includes border, title, project/revision/floor, units, fixed scale,
physical scale bar, legend and printed conceptual/professional-review and
plan-cut assumptions. Geometry is never silently reduced to fit. Paper fit
reserves room for these elements and dimensions, so a bare plot fitting a page
does not imply the complete annotated sheet fits.

Room labels are deterministically wrapped and tested against cut walls, door
swings, glazing, furniture, fixture/stair footprints and other labels. Font size
does not drop below 2 mm. A free room tag and keyed room schedule are used when
the full label cannot fit and the page has spare horizontal room. Dense plans
can require A2 at 1:50. When no collision-free layout exists, the renderer throws
a descriptive overflow error instead of covering geometry or clipping text.
Long titles/identities, crowded bay chains and outside anchors likewise fail
explicitly. Assumption overflow is handled by `createSheets`, not by
recommending larger paper when the geometry already fits.

### Assumption continuations

The first plan keeps exactly the same geometry, origin, fixed scale, title
block and reserved note area as the single-page renderer. When all notes fit,
its output is unchanged, including the original note wrapping. When notes do
not fit, the last note slot is reserved for an explicit continuation marker;
remaining lines move to clearly titled architectural assumption pages.
Nothing is shrunk, clipped, omitted or resolved from unknown to known to make
a document fit. A larger paper is still necessary when **physical geometry**
does not fit; continuations solve note capacity only.

Continuation pages retain the original project ID, revision (including zero),
floor ID/name, paper, orientation, units and plan scale. Their titles identify
assumption continuations and their page numbers, while their printed headers
retain the original plan title/context. All pages carry the complete original
`metadata.assumptions` list. The rendered assumption lines appear exactly once,
in original order across the plan and continuations; repeated metadata is not
a repeated printed note schedule. Intermediate pages explicitly point forward,
and the last page marks the end of assumptions.

Notes retain the readable 2.05 mm type and existing 3 mm line spacing.
The ordinary width-aware wrapper is reused; an overlong unbroken identifier
is split at Unicode character boundaries without deleting characters or
changing its exact metadata text. No shortened identifiers replace source IDs.
Every resulting sheet passes the shared `validateSheet` contract.

The existing limit of **200 full assumptions** applies to the entire plan,
not independently to each continuation. Maximum **100 returned sheets**,
including the geometry page. Both limits throw atomically, never return a
partial result. PDF, Drawing UI all-floor export, and coordinated-package
assembly retain their own shared 100-total-page bounds, which also count every
architectural continuation. There are no private pagination options accepted
through the public strict options schema.

Authored annotation anchors are deterministic preferred locations with bounded
nearby placement; editing the persisted anchor/text provides a stable override.
They are not model mutations or a second editable label store. Authored dimension
offsets crossing occupied geometry fail for correction rather than hiding walls.
Collision checks use the actual three line segments and their physical stroke
widths (including touching and round caps), after a bounding-box broad phase.
Furniture inside the dimension's enclosure is not itself a line collision;
slanted dimensions use the same segment test. Text placement still conservatively
reserves the dimension enclosure and occupied geometry, so this does not permit
labels over lines or furniture.

`dimensions:false` removes room size strings and modeled/authored dimension
lines, not the required scale or explanatory notes. `site:false` excludes the
plot/north/allowance layer and frames the building. `fixtures:false` excludes
authored fixtures/stairs and sanitary furniture; ordinary furniture is
controlled by `furniture`. The layers never alter wall openings or model data.

This is a schematic architectural review sheet, **not a construction document,
survey, stair design, plumbing design or planning permission**. Unknown physical
inputs and model defaults remain assumptions. Retained diagnostics are printed
or cause an explicit prerequisite/layout failure; a rendered sheet is not an
engineering readiness certificate.

## Validation

`node --test tests\planner-drawing.test.cjs` exercises real fixture projects and
bridge/projection APIs, deterministic physical scale, all media/orientations,
units, metadata, floor selection/prerequisites, aperture voids at the cut,
wall unions, handed swings, high windows, layer behavior, dense-label fallback,
authored unknowns, authored dimension enclosure/segment/stroke collisions,
XML/Unicode handling and strict schema/media validation.
It does not claim native-printer calibration or font availability in every SVG
viewer. Print at actual size / 100%, not “fit to page”.

`node --test tests\planner-drawing-pagination.test.cjs` adds byte-identical
single-page regression hashes, A4/A3/A2 continuation/geometry checks, exact
note/ID coverage, original 10 m at 1:100 = 100 mm geometry, readable long-token
wrapping, immutable unknown inputs, real multipage PDF, automatic Drawing UI
integration, package/index flattening and atomic note/page limits.
Set `HOMEPLANNER_PHASE10_FIXTURE` to the original
`initial-overflow-fixture.json` browser-review artifact to additionally run the
hash-checked unchanged-fixture acceptance test (the synthetic regressions run
without that optional external artifact).
