# Conceptual structural sheets (Phase 4)

**Not engineered. Not for construction. Qualified structural review is required.**
Soil, loads, seismic actions, reinforcement/rebar, connections and capacity are
not assessed. Supplied sizes, materials, references and engineer-provided claims
are inputs, not certification. Every successful sheet visibly prints this note
and all relevant coordination findings in the complete sheet set. There is no
structural safety solver or engineering pass.

## API and source of truth

`planner-structure-drawing.js` is a pure classic-script/CommonJS renderer:

```js
const StructureDrawing = require('./planner-structure-drawing.js');
const sheets = StructureDrawing.createSheets(drawingScene, {
  floorId: 'ground',
  paper: 'A3',
  orientation: 'landscape',
  scaleDenominator: 100,
  units: 'metric',
  maxPages: 100
});
const svgs = sheets.map(sheet => StructureDrawing.toSVG(sheet));
// Pass the entire array to HomePlannerDrawingExport.pdfBytes(sheets).
```

In the browser, load the existing model/drawing module and
`planner-structure.js` before this module; its global is
`HomePlannerStructureDrawing`. Script wiring and export/UI integration are
separate work. No dependencies, DOM, caches or editable structural model are
introduced. The API members are `createSheet`, `createSheets` and `toSVG`.

`createSheets(scene, options)` returns a deeply frozen, nonempty
`Array<version-1 sheet>`. It keeps one page when the existing schedule fits.
Otherwise it returns the structural plan first and the **complete** schedule,
findings and relevant source diagnostics on continuation pages. Do not export
only the first page of this array.

`createSheet(scene, options)` remains the strict single-sheet API: the same
layout, metadata, scale, complete content and explicit overflow behavior as
before. It never returns a plan-only page or silently omits overflowing records.
Its overflow message now points callers to `createSheets`; pagination is
implemented in Phase 4, not deferred to Phase 10.

The input is the captured version-1 `DrawingScene` from
`HomePlannerProjection.build`/the planner bridge, **not a raw project**.
`HomePlannerStructure.build` runs once per call over the complete input before floor selection,
preserving its cross-floor coordination. Its element geometry and findings are
authoritative; see [conceptual-structure.md](conceptual-structure.md).
Neither input nor authored records are modified. Continuation pages reuse this
one build, not a build per page. For multiple selected floors, call `createSheets`
once per floor with the same captured scene, then concatenate the arrays for
export. Each call's page numbering identifies that floor's set. No recapture or
cross-floor subsetting is needed.

Options have the architectural renderer's shape, with one additional
`createSheets`-only budget:

| Option | Values / default |
| --- | --- |
| `floorId` | Required, one registered site-local floor |
| `paper` | `A4`, `A3` (default), `A2` |
| `orientation` | `portrait`, `landscape` (default) |
| `scaleDenominator` | `50`, `75`, `100` (default) |
| `units` | `metric` (default), `imperial` |
| `title` | Optional, default `CONCEPTUAL STRUCTURAL FLOOR PLAN` |
| `floorName` | Optional, default selected floor ID |
| `layers` | Optional boolean `furniture`, `fixtures`, `dimensions`, `site` |
| `maxPages` | `createSheets` only: integer `1`-`100`, default `100`, including the plan page |

`site` defaults true and draws the supplied plot boundary; false uses the
building as the base extent instead. All known structural footprints and anchor
positions still contribute to the extent, including off-plot members.
`dimensions` controls the one-metre scale reference, not schedule dimensions.
Furniture/fixtures are accepted for option compatibility but not rendered in
this wall-only coordination underlay. No option hides structural intent,
the schedule, findings or review notes. Unknown keys/invalid values fail.

## Geometry, labels and schedule

- Paper dimensions and primitive coordinates are millimetres with the common
  top-left sheet origin. Resolved site x/y axes are preserved, translated to
  the plan viewport and multiplied by `1000 / scaleDenominator`. A ten-metre
  segment is exactly 100 mm at 1:100 in either display unit system. There is
  no fit-to-page transform or automatic physical-scale adjustment.
- Faint wall polygons use the actual `solidSections` intersecting the plane
  1.20 m above the selected floor. Segment distances follow projected wall
  start/end coordinates, including diagonal walls. Removed walls are omitted.
  Doors/windows at the cut remain open gaps; sections above/below an aperture
  remain solid only when they actually intersect the cut. Missing compiled
  sections fail instead of fabricating an unbroken wall or guessed openings.
- Complete column, slab and footing box footprints use the structure module's
  site x/y minima and width/depth. Slab/footing rectangles express rectangular
  intent only, not designed foundations, arbitrary slab outlines or holes.
- Beams use their actual two bottom endpoints and perpendicular horizontal
  width, not an axis-aligned bounding rectangle or vertical beam depth.
  Grids are the exact geometric reference segment, with no volume/material.
- Structural footprints show selected-floor intent at the scheduled
  elevations, not a structural cut. No hidden members or inferred supports
  are drawn. Null geometry stays null: an incomplete member gets a cross at
  each known anchor and a `?` keyed label; unresolved locations appear only
  in the schedule. In particular, absent height does not become storey height.
- Keys `S1`, `S2`, etc. are assigned in ID order within the selected floor,
  independent of input array order. Additional incomplete-anchor markers
  append `/2`, etc. Keys remain stable for the same element set; adding or
  removing IDs can renumber them. Full authored labels and IDs are preserved
  in the schedule, never squeezed into the plan.
- Number labels are placed conservatively outside wall/structural bounding
  rectangles and other labels, including large slab footprints. Thin leaders
  connect to the known anchor; leaders may cross geometry/other leaders, but
  cannot cross another label. These are identification leaders, not members.
- Every element has full label, kind, ID, W/D/H, anchor bottom elevations,
  known geometry top elevation, material, `sizeSource` and reference.
  Beam/grid lengths come only from valid geometry. Null values are
  `unknown`; grids additionally explain that sizes, material and volume are
  inapplicable. Metres display up to six decimals; imperial display uses
  signed feet and inches up to four decimals. Formatting does not alter
  geometry or claim measurement accuracy.
- Findings include all project-wide warnings, selected-floor warnings and
  warnings referencing a selected element. Relevant available source
  diagnostics are also printed. Findings are not deduplicated by code:
  separate opening conflicts and beam endpoint findings remain separate.

## Readability and bounded failure

The plan occupies the left approximately 55% of the page; when everything fits,
the complete schedule/findings occupy the right. Mandatory review notes span the footer.
Body text is 2.2 mm (the scale-reference caption is 2 mm). Long text wraps,
including unbroken IDs/reference strings, using conservative character widths.
No labels, schedule cells, findings or references are ellipsized or truncated.
Title and floor/header text each have a two-line limit.

When this content overflows, `createSheets` keeps the same plan viewport and
physical scale and prints:

> Schedule and findings continue on pages 2-N; review complete set

The freed right panel contains a bounded key legend, record/finding/diagnostic
counts and reading instructions, not a potentially overflowing element index
or a partial schedule. All schedule content moves together to the continuation
pages. Keys remain the same ID-sorted `S1`, `S2`, etc. used by the plan.

Continuation pages use two columns, read left then right. An element's block
stays together when it fits an empty column; longer blocks split with repeated
`S-number - ELEMENT SCHEDULE (continued)` headings. Findings and source
diagnostics use `F-number` and `D-number` headings, also repeated at splits.
These finding/diagnostic numbers follow the captured model's order; unlike
element keys, they are not stable across reordered input. No field is ellipsized,
even when an ID, label, reference or finding spans several columns or pages.
Each content line starts with a printed `| ` delimiter: remove that delimiter
and concatenate a block's lines (ignoring repeated headings) to reconstruct
the full text, including whitespace-only fragments.

Every page returned by `createSheets`, including a one-page set, visibly prints
`Page n/N`, project ID, floor ID, floor name, revision, requested scale and the
mandatory conceptual/engineering caveats. Pages retain the exact common
version-1 metadata schema, including identical paper, orientation, project,
revision, floor, title, units and scale. No page-number fields are added to that
schema. The plan and all continuation pages must be reviewed together.

Limits are explicit and atomic: at most 100 pages (or the lower `maxPages`
budget), 500,000 UTF-16 code units of formatted source schedule/findings/
diagnostics, and 1,000,000 code units of final printed text including repeated
headers and footers. The source budget is checked before wrapping. The complete
array is validated and frozen only after successful layout; exceeding a limit
throws rather than returning a subset. Project/floor identity has a two-line
footer limit. Shared input, primitive, text and export limits still apply.
The PDF exporter's 100-page limit applies to the concatenated all-floor array
as well; callers can reserve a stricter per-floor `maxPages` budget.

Changing scale does not solve schedule overflow. For a physical-plan fit or
label-clearance failure, choose larger paper or another explicit scale.
If explicitly partitioning input, retain cross-floor coordination context:
discarding findings or support context changes the available evidence.

All known plan extents must fit with label clearance at the requested scale.
No collision-free keyed-label location is also an actionable failure.
The renderer uses the common version-1 sheet contract and calls
`HomePlannerDrawing.validateSheet` before returning; common media-box,
primitive/text validation and workload limits apply. `toSVG` delegates to the
common validating/escaping serializer. The same sheet is usable by the existing
export contract without a second structural export format. `pdfBytes(sheets)`
accepts the entire returned set; SVG serializes each page separately. No clipping,
auto-shrink or partial-success sheet set is returned.

## Targeted validation

```powershell
node --test tests\planner-structure-drawing.test.cjs tests\planner-drawing-export.test.cjs
```

Tests cover CommonJS/global exposure, shared serialization and clipping checks,
all kinds/findings, metric/imperial sizes and elevations, true rotated beam
footprints, missing-height markers, floor isolation, ten metres at physical
scale, solid-section apertures, actual model/projection input, immutable input,
media/orientation fit, legacy dense overflow, frozen array contracts, one build
per selected floor, full-text reconstruction across page/column boundaries,
20 long-ID columns, page/text budgets, real multipage PDF acceptance,
collision-free stable keys and adversarial label/reference escaping.

The five record field values are transcribed from the Phase 4
`phase4-browser-acceptance.json` artifact and generate the same 14 structural
findings. That artifact did not retain random UUIDs or the complete projected
scene; the portable test uses fixed UI-shaped UUIDs and checks the record-only
case plus a separate explicitly diagnostic-heavy overflow case. It does not
claim to replay the lost browser snapshot. The diagnostic-heavy case retains
all five records and 14 findings in two A2 landscape pages at 1:100.
