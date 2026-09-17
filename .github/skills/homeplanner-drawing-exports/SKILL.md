---
name: homeplanner-drawing-exports
description: "Use for HomePlanner requests such as 'export a scaled floor plan', 'fix PDF or SVG dimensions', 'show net room area', 'fix drawing overflow', 'add continuation pages', 'export an elevation or section', or 'assemble a coordinated report'. Guides fixed paper-mm sheets, pinned local SVG/PDF/PNG exporters and revision-safe packages. Treat DXF/IFC exchange as new unsupported semantics; route layout and clearance questions to the complementary skills."
---

# Drawing sheets and export integrity

## When to use
- Change architectural sheets, saved elevations/sections, print geometry, fonts, dimensions, page layout, export adapters or coordinated Report packages.
- Use `homeplanner-architecture` only for the underlying authored geometry/host issue, and `homeplanner-ergonomics` for human-clearance or UI-accessibility findings.
- Bring in a structural/services/environment specialist only for that discipline's missing semantics; a drawing package must not manufacture engineering results.

## Repository anchors
| Owner | Actual exported API and responsibility |
| --- | --- |
| `planner-drawing.js` / `HomePlannerDrawing` | `createSheet`, `createSheets`, `validateSheet`, `toSVG`, `PAPER_SIZES`. `createSheets` is non-enumerable: call it directly, do not lose it through object spread. |
| `planner-drawing-export.js` / `HomePlannerDrawingExport` | `pdfBytes(sheets)` returns `Promise<Uint8Array>`; `pngBlob(sheet, options)` returns a browser PNG Blob. Consumes shared sheets, not DOM screenshots. |
| `planner-elevation.js` / `HomePlannerElevation` | `createSheets`, `createSheet`, `toSVG`; saved geographic elevations and finite sections using existing solids and shared paper primitives. |
| `planner-package.js` / `HomePlannerPackage` | `defaults`, `normalizeSettings`, `build(drawingScene, settings, evidence)`; frozen sheets, manifest, findings and evidence attachments from one capture. |
| `planner-drawing-ui.js` | `HomePlannerDrawingUI.defaults/fileName/createController/mount`; preview/export lifecycle, selected floors/views, named page files and stale-job rejection. |
| `planner-elevation-ui.js`, `planner-package-ui.js` | `HomePlannerElevationUI.createController/frontDirections/mount`; `HomePlannerPackageUI.createController/mount`. Saved view commands, package settings and staged download publication. |
| `planner-bridge.js`, `planner-projection.js` | `HomePlanner.getProject/getDrawingScene/createSnapshot`; `HomePlannerProjection.build/projectScene/localToSite/siteToWorld/snapshot`. The active authored floor overrides stale stored aliases before projection. |
| `planner-model.js`, `planner-regions.js` | `HomePlannerModel.doorGeometry/wallPoint/buildScene`; `HomePlannerRegions.reservationBounds/subtractRectangle/area`. Reuse effective walls, apertures and net regions rather than rebuilding topology. |
| `vendor\pdf\pdf-lib-1.17.1.min.js` | Existing pinned local PDF runtime. Preserve its provenance/notices and the export adapter; do not add a CDN, alternate writer or silent font download. |

Read [architectural drawings](../../../docs/architectural-drawings.md), [export formats](../../../docs/drawing-export-formats.md), [drawing foundation](../../../docs/drawing-foundation.md), [elevations/sections](../../../docs/elevations-sections.md), [Report UI](../../../docs/drawing-report.md) and [coordinated package](../../../docs/coordinated-package.md).

## Required inputs
- Captured project ID/revision and physical input fingerprint; selected current/all floors or exact saved view IDs, with real display names.
- Requested format, paper/orientation, explicit scale, units, layers, title and intended review/printing use. State unknown survey/engineering inputs rather than filling title-block credentials.
- Saved elevation direction or finite section anchors, applicable site datum and registered plot origin; missing inputs cannot be replaced with a different view.
- Actual text/scripts, output page expectations and PNG pixel/DPI intent. PDF font coverage and browser font availability are separate inputs.
- For exchange/import proposals: source file kept intact, exact format/version and supported entity subset, units/origin, staging destination and explicit acceptance criteria. Existing SVG/PDF/PNG export does not imply a CAD/BIM importer.

## Workflow
1. **Capture once.** Start from the current active Room Planner via `getDrawingScene()` and matching `getProject()` metadata, not an optimizer footprint or stale preview. Use the same captured scene for every selected floor/view/page. Preserve authored records, selection and active floor; rendering/export is not an author command.
2. **Resolve physical prerequisites.** Use the shared registered site frame and true-north heading. Keep plot, buildable floor plate and building footprint distinct. Missing plots, inconsistent registrations, unsupported walls and unresolved apertures must produce actionable prerequisites/errors, not invented geometry.
3. **Build shared sheets at fixed scale.**
   - Version-1 sheets contain `widthMm`, `heightMm`, metadata and `path/text` primitives. Coordinates, font sizes and stroke widths are paper millimetres, top-left origin and y down.
   - Supported media are A4/A3/A2, portrait/landscape, 1:50/1:75/1:100, metric/imperial. `paperMm = modelMetres * 1000 / scaleDenominator`; changing display units or viewport zoom must not change paths.
   - PDF converts paper mm to points with `72 / 25.4`, once. The exporter must not reapply drawing scale. Print at 100%/actual size and verify the scale bar; preview Fit-to-width is presentation only.
4. **Keep geometry and dimension semantics.**
   - Architectural plan cut is 1.20 m above the selected floor. Use wall bases/heights/thickness and compiled `solidSections` to leave real aperture voids and preserve sill/head infill. Above-cut windows remain wall at this cut with a note.
   - Reuse `doorGeometry` for nominal handed swing; the glyph does not prove clear opening or operational `openFraction`. Do not erase physical walls just to draw symbols.
   - `CLEAR` is an unreserved carpet-rectangle size; `BUILDING` and `PLOT` are outside extents; `BAY` locates room-module divisions, not a certified structural grid. Authored `point/wall/entity` anchors retain their reference kinds and resolution failures; `AUTHORED 3D` dimensions include z, not merely horizontal plan distance.
   - For reserved hosts, labels and fill use actual `usableRegions`; `[]` does not restore the bounding rectangle. Show `NET` and `RESERVED` areas including full service-wall deductions, even when linear dimensions are hidden. Service clear carpet is separate and reservations are not building-wide BAY divisions.
   - A zero-usable host remains authored/scheduled upstream, but the sheet can explicitly fail when no readable label/key fits. Do not promise a bounding-box or zero-area label fallback the renderer does not implement.
5. **Use the real view renderer.** Elevations require saved N/E/S/W viewer-side directions and all-floor registration; sections use the ordered finite A–B vertical cut. Saved non-null scale governs; a conflicting override is an error.
   - Preserve analytic visibility and real solid/aperture geometry. A section is not a screenshot or a horizontal-cut fallback; it does not invent geometry beyond its finite cut.
   - Missing treads, landings, roofs, frames, structural sizes and service details stay absent with their existing notes; a supplied outline is not sufficient evidence to complete them.
6. **Lay out without hiding evidence.** Call `createSheets` for complete notes/schedules; `createSheet` deliberately fails if continuation pages are needed.
   - Keep geometry scale/origin fixed while notes continue. Retain every printed assumption exactly once in order; preserve source IDs and project/revision/floor metadata on every page.
   - Reuse label collision/wrapping and keyed-schedule logic; never place host labels inside reservations or reduce architectural label text below the existing 2 mm floor.
   - Note continuation solves note capacity, not geometry overflow. Surface crowded labels, outside anchors, unsupported primitives and fixed-page overflow. Suggest an explicit paper/orientation/allowed-scale choice, not automatic shrinking.
   - Preserve shared limits: 200 assumptions per architectural plan, 100 returned sheets and the independent 100-total-page PDF/UI/package cap including all continuations, indexes and placeholders. Exceeding limits fails atomically.
7. **Encode the actual requested format.**
   - SVG: shared escaped serializer, physical mm dimensions plus matching `viewBox`, vector paths/text. Preserve Unicode; installed sans-serif fallback is not embedded-font certainty.
   - PDF: pinned local pdf-lib 1.17.1, multipage vector path operators and Helvetica regular/WinAnsi text. Reject unsupported glyphs with the page/code point; offer SVG/PNG or an explicit user text edit, never silent stripping/transliteration.
   - PNG: browser-only rasterization of the validated SVG, not an editor screenshot or CAD master. Respect the adapter's 8192-pixel side and 16-million-pixel budget; disclose resulting pixel dimensions when resolution is capped. Pixels are not guaranteed print-DPI metadata.
   - Validate/copy inputs before awaiting encoders; release Blob URLs/canvas resources and report failures. Do not treat a Blob allocation or attempted download as a verified file on disk.
8. **Publish a complete, consistent batch.** Use existing UI generation/fingerprint guards and stage all outputs before offering links. Recheck project/revision/settings/content after asynchronous work; cancellation or stale state publishes no partial set.
   - Packages reuse `HomePlannerPackage.build`, full normalized settings and original evidence. Include complete ordered page index, manifest and available sidecars. No automatic analysis run.
   - Evidence acceptance follows the existing physical/configuration fingerprints. Same-physical evidence from another revision can be explicitly labelled by the assembler; do not rewrite its original provenance to the report revision.
   - Persist only explicit documentation/view/package intentions through commands such as `set-documentation`. Do not save derived sheets/manifests as editable project geometry.
9. **Stage exchange work safely.** Current outputs are SVG/PDF/PNG and package JSON/evidence. DXF/IFC import/export requires new versioned entity, unit, host and CAD/BIM semantics; describe that capability gap before implementation. Retain the source, validate the declared subset, preview unsupported/unresolved records and require explicit application to a separate staged project/copy. Never overwrite a project merely by reading or exporting a file.

## Do not do
- Do not pass screenshots off as vector PDF/SVG, CAD or BIM; a file extension is not an interoperability guarantee.
- Do not silently fit to page, omit failed floors/assumptions, export only the first continuation, round physical geometry for imperial labels or replace unknown quantities with attractive defaults.
- Do not invent engineering-complete title blocks, approval stamps, certified dimensions, surveys, structural details or accessible stair/lift construction.
- Do not add another exporter/topology engine, download fonts, upload project data to converters or change the pinned runtime without an explicit dependency task and provenance review.

## Validation
Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-drawing-exports\scripts\example.py --check
```

Run the smallest relevant command from the repository root:
- Plans/labels/continuations: `node --test tests\planner-drawing.test.cjs tests\planner-drawing-pagination.test.cjs`
- Actual PDF encoding and browser-raster contract: `node --test tests\planner-drawing-export.test.cjs`
- Saved elevations/finite sections: `node --test tests\planner-elevation.test.cjs`
- Package source/index/evidence: `node --test tests\planner-package.test.cjs`
- Report lifecycle/publication: `node --test tests\planner-drawing-ui.test.cjs tests\planner-package-ui.test.cjs`

Check emitted SVG mm/viewBox, real PDF media boxes and vector/text operators, and decoded PNG dimensions in a real browser for raster changes. Verify 10 m at 1:100 = 100 mm, net host labels, mixed-revision rejection, unsupported scripts, page-order/assumption coverage and cancellation cleanup. Node raster doubles are not real-browser/font/print proof. The optional `HOMEPLANNER_PHASE10_FIXTURE` test needs the original supplied artifact; report a skip honestly and never fabricate that fixture.

## Output contract
Deliver actual staged files or an explicit export failure, plus format/page inventory, paper/scale/units, source project/revision/fingerprint, font/resolution limits, assumptions/unavailable content, manifest/sidecars where applicable and validation evidence. Identify unsupported exchange semantics separately. Confirm authored state is unchanged; an attempted download is not proof that a user saved every file.

## Example
In the existing browser app, capture an active-floor A3 1:100 plan including every assumption continuation:

```js
const project = HomePlanner.getProject();
const scene = HomePlanner.getDrawingScene();
if (scene.projectId !== project.id || scene.revision !== project.revision)
  throw new Error('Capture changed; retry from one project snapshot.');
const floor = project.floors.find(item => item.id === project.activeFloorId);
const sheets = HomePlannerDrawing.createSheets(scene, {
  floorId: floor.id, floorName: floor.name,
  paper: 'A3', orientation: 'landscape', scaleDenominator: 100
});
const svgs = sheets.map(sheet => HomePlannerDrawing.toSVG(sheet));
const pdf = await HomePlannerDrawingExport.pdfBytes(sheets);
```

These are staged outputs, not published downloads. Let the existing UI recheck its job/fingerprint before offering links. If labels contain unsupported PDF glyphs, retain the original text and offer the SVG files; if geometry overflows, report the exact prerequisite instead of fitting it silently.

## References
- [Verified first-party format specifications and their limits](references/sources.md).
- [Scale/unit equations and worked calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
- [Project model and net regions](../../../docs/project-model.md), [package workbench](../../../docs/package-workbench.md), [local JSON persistence](../../../docs/local-persistence.md).
- [Pinned PDF runtime provenance](../../../vendor/pdf/PROVENANCE.md).
