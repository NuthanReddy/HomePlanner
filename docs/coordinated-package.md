# Coordinated conceptual package (Phase 10)

`planner-package.js` is a pure, offline assembler. It accepts **one captured
DrawingScene**, calls existing drawing/numerical-model APIs, and returns frozen
shared sheet primitives and evidence. It does not edit geometry, run airflow or
light studies, save derived sheets, access storage, fetch files, create ZIPs, or
render PDF/PNG itself.

## API and dependencies

The exact browser global/CommonJS API is:

```js
const Package = require('./planner-package.js'); // from the repository root
Package.defaults();
Package.normalizeSettings(value);
Package.build(drawingScene, settings, { airflow: null, light: null });
```

In the browser load these classic scripts in dependency order:

1. `planner-features.js`, `planner-model.js`, `electrical-planner.js`,
   `planner-projection.js` (electrical must precede capturing a projection).
2. `building-physics.js`.
3. `planner-drawing.js`, `planner-elevation.js`.
4. `planner-structure.js`, `planner-structure-drawing.js`.
5. `planner-services.js`, `planner-services-drawing.js`.
6. `planner-drainage.js`, `planner-drainage-drawing.js`.
7. `planner-airflow.js`, `planner-light.js`.
8. `planner-package.js` exposes `HomePlannerPackage`.

The existing `planner-drawing-export.js` adapter is optional for assembly and
required for UI format export. It owns the local PDF library and PNG raster
policy; the package adds no alternate graphics engine or dependencies.

`defaults()` returns a fresh object:

```json
{
  "version": 1,
  "title": "",
  "paper": "A3",
  "orientation": "landscape",
  "scaleDenominator": 100,
  "units": "metric",
  "pngDpi": 150
}
```

`normalizeSettings(value)` accepts **complete settings only**, validates through
the canonical features validator, and returns a detached, deeply frozen copy.
Missing, extra, non-JSON, accessor, runtime-object and invalid fields throw.
To override a default use `{...Package.defaults(), paper: 'A2'}` explicitly.
`build(scene)` defaults its settings; explicit null/partial settings are errors.

Allowed papers: A4/A3/A2; orientations: portrait/landscape; scales: 50/75/100;
units: metric/imperial; PNG DPI: 72/150. Titles may be empty, contain at most
200 UTF-16 code units, and cannot contain control characters, malformed
surrogates or U+FFFE/U+FFFF. Unicode is retained, never transliterated.

## Compatible persistence

The only new persisted field is optional `project.documentation.package`,
with exactly the full settings shape above. No project schema version changes.
Old absent documentation, and `{version:1, views:[], sheets:[]}` without
`package`, remain unchanged. Assembly does not add defaults to a project.

Use the existing canonical command and retain all other documentation fields:

```js
const documentation = controller.getProject().documentation ||
  { version: 1, views: [], sheets: [] };
controller.execute({
  type: 'set-documentation',
  value: { ...documentation, package: Package.normalizeSettings(settings) }
});
```

Shared settings survive undo/redo, JSON save/reopen, floor duplication/removal,
canonical document generation and projection. They are not copied into floors.
Never persist the returned package's sheets/manifest as editable geometry.

## Returned snapshot

The exact top-level keys are:

```text
{
  version: 1,
  sheets: SharedSheet[],
  manifest: {
    version: 1,
    source: {projectId, revision, inputFingerprint, drawingSceneFingerprint},
    settings: Settings,
    floorIds: string[],
    pages: [{
      page, number, type, title, floorId, viewId,
      widthMm, heightMm, scaleDenominator, status, findingIds
    }],
    analyses: {
      airflow: AnalysisAcceptance,
      light: AnalysisAcceptance
    },
    electrical: ElectricalIntent[],
    siteDatum,
    limitations: string[]
  },
  findings: [{
    id, code, message, floorId, entityId, reference, discipline, severity
  }],
  attachments: [{fileName, mime, content}]
}
```

`AnalysisAcceptance` is `{status, reason, currentPhysicalFingerprint,
originalProvenance, attachment, originalStatus, samePhysicalOtherRevision}`.
Absent/rejected evidence has status `unavailable` and an explicit reason;
unprovided provenance/status/attachment are null. Accepted status retains
`converged`, `complete`, or `incomplete`, not an invented engineering pass.

`ElectricalIntent` is `{floorId, entityId, type, label, purpose, heightM,
elevationReference, coordinateSpace, point, positionStatus, source}`.
`heightM` retains the original electrical `elevationM` reference measurement,
not inferred envelope height. `point` is the existing resolver's projected
`resolvedPoint` (including nullable z), or null. Coordinates are site-local
metres even with imperial drawing labels. `source` retains the whole supplied
record and its diagnostic/anchor fields. Missing registration falls back to
the original floor's electrical records, with unavailable positions.
No circuit, luminaire strength or photometric output is inferred.

Every array/object in the result is deeply frozen and detached from input.
Pages are one-based; stable package sheet numbers are P001, P002, etc.
The shared renderer's strict metadata is not extended or overwritten with
package-only fields. Printed outer-margin package numbers and manifest numbers identify
pages, while the original title, floor identity and scale remain intact.

## Ordering and physical drawing policy

The ordered packet contains:

1. Conceptual cover and the complete paginated index (including index pages).
2. Actual site boundary/registered floor plates/building footprints and site
   context schedule.
3. Architecture for **every canonical source floor**, not just projected scenes.
4. Every saved elevation/section; unavailable saved-sheet view references.
5. Each floor's structural sheets.
6. Each floor's plumbing plan, then plumbing riser.
7. Each floor's drainage plan, then supported drainage profile.
8. Complete electrical intent schedule.
9. Supplied airflow evidence, supplied light evidence.
10. Linked coordination findings.

All `createSheets` continuation pages are flattened in order. The index uses
fixed-point pagination so inserting index continuations never skips or
misnumbers a sheet. Maximum **100 total pages**, including cover, index,
placeholders, and all schedule continuations. Overflow throws atomically:
no returned partial packet, automatic shrink, clipping or discarded rows.

Architecture now calls `Drawing.createSheets` as well: unknown-rich floors
can have assumption-only continuation pages even on A2. These retain the
original floor/project/revision and scale and each receives its own manifest
and index entry. The geometry page does not move or shrink to accommodate
more notes; an explicit marker points to the next assumption page. All
assumptions remain in metadata, with printed lines continuing in order without
omission. The site's own shared primitives are unaffected. The architectural
200-assumption and 100-sheet limits remain independent of, and cannot bypass,
the package's 100-total-page cap.

Paper millimetres are fixed by A4/A3/A2 and orientation. Existing drawing
renderers retain their fixed-scale fit requirements; some content genuinely
requires larger paper. Saved view scales override the package default; a
null saved scale uses the package setting. No scale conflict is hidden.

The site page uses the shared `path`/`text` primitives and actual projected
plot, buildable floor and building rectangles, dimensions and geographic
north. It is **not** an architecture page renamed as a site plan. Registered
plots must share one site origin, extent and heading. Multiple floor
footprints are overlaid, never recentered. A following schedule identifies
each exact floor's rectangles and unavailable registrations. A supplied
absolute datum is printed; unknown datum, terrain, roads, legal boundary
verification and discharge remain explicitly unknown. The rectangular model
boundary is not asserted surveyed. No terrain or discharge paths are invented.

Plumbing risers and drainage profiles deliberately preserve the existing
per-selected-floor semantics: own-floor routes plus endpoint-touching routes.
Cross-floor routes may therefore appear on both endpoint floors; these are
qualified floor-scoped diagrams, not falsely distinct global networks.
The shared renderer's profile gaps and unknown invert evidence remain intact.

## Findings, prerequisites and analysis integrity

Missing geometry, plot registration, saved direction/cut prerequisites, saved
views, and analysis produce explicit unavailable pages, index status and
finding IDs. Invalid/rejected physical geometry and renderer/layout errors
abort assembly; unexpected renderer exceptions are never converted to a
plausible unavailable placeholder.

Coordination findings come from the source projection and the existing
Structure, Services, Drainage and accepted analysis numerical models.
Exact qualified references are preserved. Raw related IDs are only linked
when the corresponding floor/entity pair exists; ambiguous foreign IDs are
not assigned guessed floors. Warnings without source references remain
unlinked. Printed text is never scraped to manufacture references.

Analysis acceptance calls only `Airflow.discover`/`Light.discover`, never
`run`, `createStudy`, a solver, or worker. It checks project identity, original
revision, source keys, current **actual physical** fingerprints, original
inventory content, configuration/sensor/input fingerprints and result shape.
An identical project ID/revision or cached input string alone is insufficient:
an in-memory physical change invalidates evidence.

An older revision with the same actual physical inventory is accepted, but
its original revision/source keys remain unchanged and the package records
`samePhysicalOtherRevision` plus an explicit finding. The package does not
claim that analysis ran on the new revision.

Only converged airflow has numeric report pages. Blocked/nonconverged,
numerical-error, cancelled, malformed or stale results get unavailable pages.
Light must be computationally complete; completed computation with unknown
context may retain original `incomplete` status and clearly named model-only
metrics. Unknown primary metrics remain null, not zero. Original
`modeledProcessed...`/`knownProcessed...` evidence keys are not renamed as
full-period validated sunlight hours. No illuminance or light-strength claim
is made.

Serializable supplied results, even rejected evidence, are preserved as the
exact parsed JSON payload (no provenance rewriting) in fixed collision-free
`airflow-evidence.json` / `light-evidence.json` sidecars. The manifest's
acceptance status governs use, not the mere presence of a sidecar. Malformed
non-JSON values have no sidecar. Complete original configuration and source
fingerprints remain available for audit; no shortened hash stands in for
them.

The manifest records both the source input fingerprint and a canonical
serialization of the **actual captured DrawingScene**, so same-revision
in-memory changes are distinguishable. These keys are deterministic content
keys, not cryptographic signatures or proof of a trusted analysis producer.
No generation clock is added. Identical input snapshots produce identical
package data.

## Export and validation

Pass `packet.sheets` directly to the existing export adapter. Use
`packet.manifest.settings.pngDpi` for PNG. UI download naming should prepend
its own bounded safe project prefix; the pure builder does not access a
filesystem. SVG preserves Unicode. The existing standard-font PDF adapter
explicitly rejects unsupported glyphs rather than dropping text.

New tabular text is character-wrapped (including long unbroken IDs), bounded
to 200 code points per line and paginated; all sheets pass
`HomePlannerDrawing.validateSheet` both before assembly and after pagination
numbers. Existing renderer constraints remain authoritative.

Tests:

```powershell
node --test tests\planner-package.test.cjs tests\planner-package-settings.test.cjs
```

These exercise frozen real projections, fixed-scale imperial A2 PDF media,
all-floor prerequisites, genuine site footprints, saved-view scale and
continuations, long electrical labels, exact JSON evidence, stale and
same-physical/different-revision provenance, model-only light unknowns,
malformed/cancelled evidence, multipage complete index, atomic page limits,
Unicode PDF rejection, and real bridge/storage compatibility.

Native printing calibration, browser PNG rasterization and package UI
download interactions belong to the existing export/UI integration and are
not claimed as validated by the pure builder tests.
