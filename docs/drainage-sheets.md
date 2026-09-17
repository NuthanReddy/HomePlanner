# Drainage plan and profile sheets

Phase 7's pure renderer consumes the
[drainage foundation](drainage-coordination.md), not a second network model.
It prints **authored intent and supplied measurements**, not hydraulic design,
pipe sizing, code compliance, safe cover, infiltration/septic capacity, flood
safety, receiving permission or construction approval.

## API and integration

Load the existing model/projection and shared drawing/services stack, followed
by `planner-drainage.js` and `planner-drainage-drawing.js`. Classic scripts expose
the frozen `HomePlannerDrainageDrawing` API; CommonJS has the same exports:

```js
const Drawing = require('./planner-drainage-drawing.js');
const Export = require('./planner-drawing-export.js');

const sheets = Drawing.createSheets(drawingScene, {
  floorId: 'ground',
  view: 'profile',
  systems: ['waste', 'rain'],
  paper: 'A3',
  orientation: 'landscape',
  scaleDenominator: 100,
  units: 'metric'
});
const svgs = sheets.map(sheet => Drawing.toSVG(sheet));
const pdfBytes = await Export.pdfBytes(sheets);
// Browser: await Export.pngBlob(sheets[0], {pixelsPerMm: 4});
```

The input is a real version-1 `DrawingScene` from
`HomePlannerProjection.build(project)`. Each call builds
`HomePlannerDrainage.build(scene, {systems})` **once**. Results are detached,
deeply frozen and deterministic for the same scene/options. No DOM, network,
model writes, cache, automatic fitting, persistence, loader/UI, report or 3D
integration is added here.

Options accept exactly:

| Option | Accepted values |
| --- | --- |
| `floorId` | Required, exactly one registered site-local floor |
| `view` | `plan` (default), `profile` |
| `systems` | Unique dense array of `waste` and/or `rain`; default both; `[]` means no networks |
| `paper` | `A4`, `A3` (default), `A2` |
| `orientation` | `portrait`, `landscape` (default) |
| `scaleDenominator` | `50`, `75`, `100` (default) |
| `units` | `metric` (default), `imperial`; labels only, never geometry |
| `title`, `floorName` | Optional shared-validator text; defaults to drainage view title / floor ID |

Unknown keys/IDs, unsupported values, duplicate/sparse system arrays, explicit
null/undefined, missing selected geometry and unreadable header text reject.
Large geometry requires a user-selected larger paper or supported scale; it
never silently shrinks.

`createSheets(scene, options)` is the complete-set API. It returns ordinary
shared version-1 sheets with **exactly** `version`, `widthMm`, `heightMm`,
`metadata`, `primitives`. Metadata is the unchanged shared schema:
`projectId`, `revision`, `floorId`, `floorName`, `title`, `paper`, `orientation`,
`scaleDenominator`, `units`, `assumptions`. No drainage-only primitive or
metadata fields are added; every sheet passes `HomePlannerDrawing.validateSheet`.

`createSheet(scene, options)` is strict: it refuses any multipage result rather
than returning an incomplete first page. Normal route diagrams have separate
complete schedule pages; an empty profile scope can share one page with its
entire schedule if that schedule fits. Prefer `createSheets` for general output.
`toSVG(sheet)` delegates directly to the shared SVG renderer. The
`toSVG(scene, options)` convenience uses strict `createSheet`, and therefore
also refuses a multipage result. Export each sheet explicitly to preserve
continuations.

## Plan

- Uses physical site-local XY points from the foundation. The actual rectangular
  `scene.plot` frame is printed, **not** the setback/buildable floor plate.
  This frame remains a registration assumption, not a surveyed legal boundary.
- Faint wall underlay uses represented physical `solidSections` at selected
  floor elevation + 1.20 m. Apertures crossing that cut remain open. No assumed
  room bounds, fittings or pipe dimensions are substituted.
- Only consecutive known route points are connected. Known later XY spans can
  be drawn without inventing the preceding gap.
- A neutral cross locates each known node. Its short key includes the explicit
  purpose code (role, or required base kind when role is absent). Purpose
  markers and line ink are paper-sized symbols, not measured equipment,
  diameter, clearance or access envelopes.
- Brown soil / green waste belong to sanitary `waste`; blue storm belongs to
  `rain`. Vent is purple, unknown circuit grey. System/circuit membership is
  never inferred from purposes or neighbours.
- Arrows show the authored from-to order only. They are **not hydraulic flow**.
  Stars identify foreign endpoints/cross-floor proposals; full known foreign
  and off-plot geometry participates in the fixed-scale fit check.

## Profiles

Each scoped route receives its **own diagram page**, including unsupported or
unavailable profiles. Horizontal coordinates are foundation cumulative
**physical XY chainage**; vertical coordinates are **independently supplied
invert levels**. Both axes use exactly `1000 / scaleDenominator` paper
millimetres per model metre, explicitly named on the page. Invert increases
upward; chainage increases rightward. There is no vertical exaggeration or
nonspatial topology-lane substitution.

For example, 10 m horizontal run and 0.2 m measured invert fall print as
100 mm horizontally and 2 mm downward at 1:100. Anchor z can be completely
different without changing this profile.

The renderer takes `stationsM` and `invertsM` from the foundation verbatim:

- A profile line requires *adjacent* known cumulative stations and known
  supplied inverts. Missing intermediate inverts are never interpolated.
- Missing horizontal spans leave all subsequent cumulative stations unknown.
  Independently known later local run/fall remains in the schedule; it does
  not restart at station zero or bridge the missing span.
- Known isolated station/invert pairs remain keyed marks when a route has
  other drawable intervals. A route with no drawable interval prints
  **PROFILE UNAVAILABLE**, explains why, and still has its complete schedule.
- Zero horizontal run with known distinct invert levels is drawn vertically
  at the same chainage. Gradient stays undefined, never infinite. Coincident
  levels/marks are not offset to manufacture clearance.
- Vent and unknown/contradictory gravity intent print explicit unavailable
  pages, with raw supplied levels, slope, references and ordered vias retained.
- Measured endpoint/segment fall, measured gradient, supplied slope intention,
  expected fall from intention and measured-minus-expected difference are
  distinctly named. Endpoint agreement never proves internal completeness.

No local ground/finished-floor plane, invert, fitting allowance, terrain,
shaft, cover, landing or external connection is inferred from axis z.

## Complete scope and schedules

Both views include routes owned by the selected floor **plus** routes whose
from/to references touch that floor. Each is included in full, even if its
entire known span lies on a foreign floor. Selected-floor nodes and referenced
foreign endpoint nodes are scheduled using floor-qualified identities.

Stable short `N` and `R` keys are assigned by sorted `[floorId, id]` identity
within the selected-system foundation result, before floor scoping. Therefore
the same system selection shares keys across views/floors; changing the
selected systems may renumber them. `R1.2` means segment 2 and `R1.p2` point 2.
Raw identifiers never become geometry overlay labels. Labels and leaders are
placed using conservative physical paper-mm text bounds, avoiding prior text,
leader strokes, centerlines and represented solid footprints. Coincident
geometry remains coincident; it does not create a new connection.

Paginated schedules retain:

- Full IDs, owner floors, labels, systems, circuits, node kinds/roles,
  authored anchors and qualified endpoint references.
- Every ordered point/via and independently supplied invert; cumulative
  chainages and local segment values, with explicit unknowns.
- Ground/finished-floor/invert levels, nominal diameters, clearance/access
  review distances, level/slope sources and references, discharge intent.
- Component qualified keys, entity issues, measured versus intended falls,
  full XY versus XYZ lengths, and independent completeness flags.
- Complete authored node/route JSON alongside interpreted values.
- **All** drainage-foundation findings for selected systems, including global
  caveats and findings owned outside the selected diagram floor. Their
  `entityRefs` and original `entityIds` are retained separately: an unqualified
  related ID is not assigned an invented floor.
- Project/floor projection diagnostics.

Records wrap Unicode by code point without replacing or shortening text.
Continuation columns repeat short record headings. Every page carries the
view/system/floor scope, scale, project/revision, page count and mandatory
engineering/geometry caveats. Read the **entire set**, not just diagram pages.

## Shared exports and limits

SVG, PDF and PNG use the unchanged shared pipeline. PDF stays vector geometry
plus searchable text, with the original physical media size/page count.
The existing PDF Helvetica/WinAnsi backend **rejects unsupported Unicode
explicitly** and recommends SVG/PNG; drainage rendering does not replace,
transliterate or silently discard source text. PNG requires the existing
browser canvas/Image backend and its existing pixel limits.

Limits apply to the complete call and fail without returning a partial result:

- **100 complete pages**, including every route diagram and continuation.
- **500,000 source schedule characters** and **1,000,000 output text characters**.
- **20,000 geometry work items** (including inspected wall sections).
- **2,000 keyed positions per diagram**.
- **2,000,000 combined label-candidate and text/solid/stroke comparison checks**,
  charged inside comparisons, not merely once per outer placement attempt.
- Existing foundation coordination budgets and shared sheet/export primitive,
  command and text limits still apply.

No page, field, warning, route or geometry is silently truncated. If geometry
cannot fit at the fixed selected scale or collision-free labels cannot be
placed within budget, the call reports an explicit error. Choosing a different
floor or system set changes scope intentionally; it is not an automatic
workaround performed by the renderer.

## Validation

```text
node --test tests\planner-drainage-drawing.test.cjs tests\planner-drainage.test.cjs tests\planner-services-drawing.test.cjs tests\planner-drawing-export.test.cjs
```

The new real-model tests cover exact shared schemas/browser parity, one
foundation build, deep freezing/no mutation, strict options/floor IDs, physical
scales in both label units, null gaps, zero-run drops, unequal/mixed floors,
unavailable vent/unknown profiles, storm/sanitary filtering, actual plot bounds,
full provenance/warning continuations, collision-free short labels, page/text
bounds, shared vector PDF/SVG and PNG adapter handoff. The PNG test verifies the
shared SVG input and raster dimensions using a browser-adapter harness; it is
not a screenshot or pixel-rendering test.
