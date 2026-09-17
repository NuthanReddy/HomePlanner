---
name: homeplanner-structural-engineering
description: "Use for HomePlanner structural intent, grid/column/beam/slab/footing modelling, structural coordination, size/material provenance, support-contact diagnostics, structural sheets, and the optional 3D layer. Triggers include 'structural model', 'beam elevation', 'column support', 'structural workbench', and 'structural analysis inputs'. Separate modelling and coordination from analysis and code design; preserve unresolved anchors and never infer safe sections, foundations or professional certification."
---

# Structural intent and engineering boundaries

## When to use

Use for structural model contracts, coordination findings, workbench authoring,
sheet output and shared 3D inspection. Keep four activities distinct:
**modelling** records intent; **coordination** compares geometry; **analysis**
solves a declared mechanical problem; **code design** applies adopted requirements
with qualified review. The current foundation implements the first two only.

## Repository anchors

Inspect the current code contracts and relevant tests before changing them.
Optional schema support, renderer support and engineering capability are separate.

- `planner-features.js`: strict schema-1 `floors[].authored.structural` records,
  allowed optional fields and anchor cardinality.
- `planner-projection.js` and `planner-bridge.js`: shared anchor resolution,
  `getDrawingScene`, `inputFingerprint`, authored commands, history and duplication.
- `planner-structure.js`: pure `HomePlannerStructure.build`; geometry and findings.
- `planner-structure-ui.js`: `createController`, draft preservation, explicit
  anchor replacement, `save`, `refresh` and same-revision replacement detection.
- `planner-structure-drawing.js`: `createSheets`, strict `createSheet`, shared
  version-1 sheet validation/serialization; `planner-drawing-ui.js` owns Report.
- `planner-3d.js`: `buildContent`, `structureObject`, `toThree` and default-off
  structural inspection; no second editable model.
- [Foundation](../../../docs/conceptual-structure.md),
  [workbench](../../../docs/structure-workbench.md),
  [sheets](../../../docs/structural-sheets.md),
  [3D conventions](../../../docs/structural-3d.md),
  [shared Report](../../../docs/drawing-report.md).

## Required inputs

- Record/floor identities; grid, column, beam, slab or footing kind; explicit
  point/wall/entity/null anchors; floor/site registration and elevation conventions.
- Supplied widths/depths and applicable height in metres, or `null`; material
  description or `null`; optional label, `sizeSource` and reference.
  Preserve absent older optional fields rather than backfilling them.
- Provenance distinguishing unspecified, assumed, authored and engineer-provided
  sizes. A reference or engineer-provided label is an unverified author claim.
  Keep material specification/source evidence in the existing reference or handoff,
  not invented schema fields.
- **Before new structural analysis:** spans and topology; supports, restraints,
  releases and boundary conditions; material properties and units; load cases,
  magnitudes/directions, combinations and applicable environmental actions;
  jurisdiction, adopted code edition/amendments and intended analysis method.
  Foundations additionally need appropriate geotechnical/support evidence.
- If any analysis input is missing, stop analysis and return the missing-input
  list for qualified review. Existing conceptual dimensions are not substitute
  strengths, load assumptions, soil data or design approval.

## Workflow

1. **Declare the level of work.** Default to existing modelling/coordination.
   Read source applicability before using numerical thresholds. Do not present
   an academic mechanics example or NASA simulation guidance as a building code.
2. **Inspect schema and preserve anchors.** Required structural fields remain
   `{id, kind, anchors, widthM, depthM, material}`. Beam/grid need two anchors;
   column/slab/footing need one. Validate present optional fields without adding
   defaults. Metadata edits retain wall/entity/cross-floor/null anchors; replacement
   requires explicit user action, never flattening a host to displayed coordinates.
3. **Keep frames explicit.** Workbench point inputs are owner-floor plate-local
   x/y with z relative to that floor. Projection resolves site-local x/y and
   project-relative z, applying floor origin/elevation once. Do not paste resolved
   coordinates back into local inputs without the established conversion.
4. **Respect member geometry.**
   - Column/slab/footing: bottom-centre anchor; width along site x, depth along
     site y, explicit height upward. Missing height means no box.
   - Beam: two bottom-centre endpoints; width perpendicular in plan; `depthM`
     is vertical thickness upward. `heightM` is absent/null, not alternate depth.
   - Grid: horizontal reference segment, no volume; width/depth/material null,
     height absent/null. Grids do not synthesize a framing system.
   - Coincident/sloping endpoints, unresolved hosts or unknown necessary sizes
     yield null geometry and diagnostics. Do not snap, invent extents or size by label.
5. **Coordinate with one captured scene.** On explicit refresh, pass the same
   `getDrawingScene()` result to core and presentation consumers. Keep all-floor
   context for opening intersections and support contacts, then scope display.
   Use project ID, revision, canonical input fingerprint and presentation options
   for freshness; same ID/revision alone cannot validate a replacement.
6. **Interpret findings narrowly.** Beam endpoint contact is not bearing/connection
   adequacy. Full column-footprint contact is not load transfer certification.
   Unknown support differs from a proven absence; rectangular slabs/footings do
   not establish reinforcement, slab support layout or soil/foundation behavior.
   Retain `engineeringStatus: 'not-assessed'` and the unconditional caveat.
7. **Reuse existing editing and presentation.** Explicit saves/deletes use bridge
   `upsert-authored`/`delete-authored` for `structural`; preserve other collections
   and surviving references. Reuse shared Undo/Redo and JSON. Sheets consume frozen
   derived geometry and retain all schedule/findings continuation pages at fixed
   scale. 3D uses matching `drawing.scenes`, all-floor site registration and
   `toThree`, with opt-in, missing-geometry counts and resource disposal intact.
8. **Gate any later analysis implementation.** Treat this as a separately
   authorized task, not a hidden consequence of modelling. Stop without the
   required inputs and professional review. If an analysis method is actually
   implemented, document its supported problem class, units, sign conventions,
   restraints, convergence and failure states; validate force/moment equilibrium,
   dimensional consistency and independent analytical fixtures before using results.
   Test declared simply supported/cantilever cases only where supported, plus
   zero load, unstable restraints and limiting cases. Never convert singularity
   or nonconvergence into zero demand or a safe section.

### Example: bottom-centre beam, not an engineered selection

Synthetic regression inputs supplied explicitly, not recommended dimensions:
resolved endpoints `(1, 2, 3)` and `(5, 2, 3)` m, `widthM: 0.2`,
`depthM: 0.3`, `heightM: null`, `material: null`, `sizeSource: 'assumed'`.
Expect a 4 m horizontal beam with bottom z = 3 m and top z = 3.3 m; the
renderer must not centre its depth about z = 3 m. Retain assumed-size and
unknown-material findings and unassessed engineering. If depth becomes `null`,
geometry becomes null rather than borrowing a storey height.

## Do not do

- Do not guess safe sections, reinforcement/rebar, foundations, capacities,
  demolition permissions or a certified load path.
- Do not equate explicit sizes, clean intersections, provenance colours,
  solver convergence or a drawing with professional certification.
- Do not add independent editable geometry to a renderer, automatically mutate
  a user's live plan, erase unresolved references or write derived findings to JSON.
- Do not fetch external data without user action or send private code,
  coordinates, project data or user records to web services.

## Validation

Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-structural-engineering\scripts\example.py --check
```

Run the smallest real existing `node --test` selector(s) covering the touched
contract, from the repository root; do not run every presentation suite by default.

| Scope | Existing selector |
| --- | --- |
| Core/schema/geometry | `node --test .\tests\planner-structure.test.cjs` |
| Workbench | `node --test .\tests\planner-structure-ui.test.cjs` |
| Structural sheets | `node --test .\tests\planner-structure-drawing.test.cjs` |
| Shared 3D integration | `node --test .\tests\planner-structure-3d.test.cjs .\tests\planner-3d.test.cjs` |
| Report/export changes | `node --test .\tests\planner-drawing-ui.test.cjs .\tests\planner-drawing-export.test.cjs` |

Verify null/absent fields, strict grids, rotated beams, unequal floors, exact
bottom/top elevations, unresolved anchors, immutable results, same-revision
replacement, complete fixed-scale pages and reversible edits. Existing geometry
tests are not structural-analysis benchmarks or proof of engineered adequacy.

## Output contract

Return scope and snapshot identity; records/anchors and coordinate frames;
supplied/null sizes and material provenance; derived geometry/findings; unresolved
inputs; explicit proposed edits; and actual validation commands/results.
Separate modelling, coordination, analysis-not-performed and code-design status.
Keep modelled quantities separate from professional certification, preserve
`not-assessed`, and identify the qualified review and unavailable standards needed.

## References

[Verified primary-source notes, S1–S2](references/sources.md), checked
**17 Sep 2026**. These inform mechanics and model credibility, not local approval.

- [Equilibrium/beam equations and worked calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
