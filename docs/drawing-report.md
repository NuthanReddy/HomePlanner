# Report → Drawings

`?workspace=report` now opens Drawings. Existing `report/schedules`,
`report/electrical` and `report/exports` deep links remain supported.
`report/package` opens the [coordinated package workbench](package-workbench.md)
for the full ordered set, saved package intentions and revision manifest.
The individual-sheet controls documented here remain session-only and independent.

The report renders architectural, structural, plumbing, drainage or saved elevation/section **reference sheets**, not screenshots of the
interactive planner. It does not certify engineering, infer missing physical
measurements, run background analysis, upload anything or save a project automatically.
Review the sheet's assumptions and diagnostics before using any output.

## Controls and persistence

The discipline and **Refresh preview** stay visible above the drawing.
**View & print settings** is an initially closed native disclosure for view,
system, scope, page, print, layer and screen-zoom controls. Its live summary
shows view, scope, paper, scale and units; saved-view scales remain authoritative.
Downloads, full revision context and caveats follow the preview. Opening the
disclosure changes presentation only, not cached sheets or download links.
The generic Report introduction/JSON shortcut stays on the other Report
sections rather than duplicating the drawing header; backups remain in the
persistent project menu.

- Defaults: architectural discipline, current active floor, A3 landscape, fixed 1:100, metric dimensions.
- Choose **Plan discipline → Structural** for structural intent sheets using the
  same projected scene, fixed-scale sheet contract and export adapters. Engineering
  remains **not assessed**; dimensions, materials and provenance are authored
  claims, not verified engineering values. Edit intent in
  [Design → Structure](structure-workbench.md).
- Choose **Drawing discipline → Plumbing** for authored water/waste intent
  sheets. **Plumbing view** selects plan/riser; **Plumbing systems** selects
  water/waste/both as an analysis filter, never a model edit. Engineering remains
  **NOT ASSESSED**. Author fixtures, explicit ports and directed routes in
  [Design → Plumbing](plumbing-workbench.md). Current/all-floor scopes flatten
  each floor's complete sheet set through the same PDF/SVG/PNG adapters.
- Choose **Drawing discipline → Drainage** for conceptual sanitary/storm
  intent. **Drainage view** selects plan/profile; **Drainage systems** selects
  both/sanitary/storm (renderer systems `['waste','rain']`, `['waste']`, or
  `['rain']`). These controls are separate from plumbing's plan/riser and
  water/waste choices, preserving both when switching disciplines.
  Drainage engineering remains **NOT ASSESSED**; see
  [foundation and numerical boundaries](drainage-coordination.md).
- Choose **Drawing discipline → Elevations / sections** for saved
  `documentation.views`. Create/edit them in
  [Design → Elevations / sections](view-workbench.md). **Selected view** uses
  the saved owner floor (not the active floor); **All saved elevation/section
  views** renders each non-plan view once in saved document order, including
  all continuation pages. The floor selector and plan-layer controls are
  hidden. There is no generic plan fallback for missing views.
- For elevations/sections, a non-null saved scale always overrides Report's
  fallback scale. The effective saved value is passed to the strict renderer,
  not the conflicting default 100. Unknown saved scale uses the explicitly
  selected Report scale. The explanatory message identifies both values;
  all-view batches may legitimately contain different saved scales.
- Choose A4/A3/A2, portrait/landscape, 1:50/1:75/1:100 or feet-and-inches labels.
- Toggle furniture, fixtures, dimensions and site layers.
- All project floors produces a multi-page PDF. Its preview-floor selector does
  not change the planner's active floor.
- **Preview page** appears only when the preview floor has multiple pages.
  The keyboard-accessible native select labels both floor and page number.
  Its zero-based `settings.pageIndex` is session-only; page changes select from
  the current captured preview without rebuilding or authoring the project.
  Prepared download links and in-progress exports remain valid: changing which
  cached page is visible does not change the captured export set.
  Floor/layout/layer/title changes reset to page one; refresh bounds the index
  if a new sheet set is shorter.
- Except for drainage, the title defaults to the project name and is editable. The sheet and download
  names include revision information. Structural download names include
  `structural` to distinguish them from architectural files.
- **View zoom (screen only)** defaults to **Fit to width**. **Full resolution
  (intrinsic size)** displays the SVG at its intrinsic browser size and permits
  internal scrolling. Zoom is local to the mounted panel, not a controller
  geometry setting, saved view property or physical print-scale calibration.
  It preserves cached geometry, preview and download URLs without Refresh.
- **PNG resolution (raster only)** selects **72 dpi · fast screen review** or
  **150 dpi · print review (default)**. Changing it does not rebuild sheets,
  change fixed scale or invalidate current previews/downloads. Each export
  captures its chosen resolution; completed PNG links identify that resolution.

Settings (including discipline) and the title are explicitly **view-only, per-project browser-session
state**. They survive report navigation, homeowner/expert mode changes and switching
between projects in the same page. They do not survive page reloads, are not
serialized in project JSON and do not author geometry or increment revision.
The existing strict `documentation` schema supports authored sheet/view intentions,
but not all these export settings; this UI does not replace that envelope or silently
discard its existing records. See [drawing-foundation.md](drawing-foundation.md).

## Preview and downloads

### Drainage integration contract

Load the shared drawing/projection/services stack, `planner-drainage.js` and
`planner-drainage-drawing.js` before `planner-drawing-ui.js`. The Report adapter
requires `HomePlannerDrainageDrawing.createSheets(scene, options)` and passes
exactly `floorId`, `floorName`, `view`, `systems`, `paper`, `orientation`,
`scaleDenominator`, and `units`. It sends neither architectural `layers` nor a
custom `title`; those controls are hidden without clearing other disciplines'
preferences. Shared `HomePlannerDrawing.validateSheet` validates every returned
sheet. Optional renderer `toSVG` is supported; otherwise the shared serializer
handles the common sheet contract.

`settings.drainageView` is `plan` or `profile`; `settings.drainageSystem` is
`both`, `sanitary`, or `storm`. Native control IDs are
`hp-drawing-drainageView` and `hp-drawing-drainageSystem`.
Authoring links use `data-workspace="report" data-section="drawings"
data-drawing-discipline="drainage"` with
`?workspace=report&section=drawings&discipline=drainage`.
The Report capture listener selects discipline before the workspace router.
Neither links, deep links, nor filter changes automatically run analysis.
These links select discipline only, preserving the prior plan/profile choice.

Preview uses the selected preview floor's entire page array. All-floor export
captures one frozen drawing scene and flattens every floor's **complete**
plan/profile/continuation array in project-floor order. The aggregate limit is
100 pages, checked before any encoding; empty or invalid arrays fail atomically.
PDF receives the full array once; SVG and PNG create one named output per page.
There is no single-page profile shortcut or implicit fixed-scale shrinking.

Drainage uses the existing fingerprint and task-generation invalidation,
including same-ID/revision replacements of supplied metadata. Export-setting
changes, project edits, cancellation and disposal cannot publish stale or
partial batches. PNG captures 72/150 dpi separately from physical scale; screen
zoom and preview-page selection preserve the captured export and its links.
No drainage or service record is mutated.
These are reference drawings, never engineering approval.

Changing a selection refreshes the preview. Title input immediately invalidates old
outputs and refreshes on change/blur; Refresh preview is also available. Project
edits discard existing preview/download links, identify them as stale and require
a fresh render. Selecting another active floor also invalidates current-floor output.
No automatic paper fitting or scale reduction occurs: if the fixed-scale sheet
does not fit, choose a larger paper, another orientation or a different listed scale.

The above automatic selection refresh applies to architectural/structural plans
only. **Elevations / sections**, **Plumbing** and **Drainage** require explicit Refresh preview or an export
action: navigating to the report, changing view/paper/title, or changing modes
does not project/render views. All-view preview includes the flattened saved-view
page set, with a native page selector using the same cached pages.
Plumbing navigation and view/system/paper/title changes likewise do not run
coordination or render sheets automatically. The page selector reuses cached
plumbing pages, and Fit/Full view never changes physical scale.

Preview is a vector SVG displayed in an image-only browser context, not injected
HTML. Fit-to-width scales the whole page to the preview container, including on
phones; use Full resolution and internal scrolling to inspect small details.
The SVG export preserves the actual sheet dimensions. Print SVG/PDF at **100% /
Actual size**, not “Fit to page”; verify against the scale bar.

- **Download PDF:** one file containing every page of the selected floor(s),
  in project-floor order, with each floor's plan before its schedule/findings
  continuations. A multipage current-floor PDF still uses that floor's name,
  not `all-floors`.
  For saved views the same PDF adapter receives every page in saved-view order
  (each view's geometry page then its notes/schedule continuations). All-view
  filenames use `views-all-views`, not `all-floors`.
- **Download SVG / PNG:** one-click download only for a single page; otherwise,
  prepare an explicit named link for each page instead of triggering a browser
  multi-download that could silently drop files.
  Links identify floor and page number. Filenames have a global ordinal to
  distinguish even identical/sanitized floor names, plus a `-page-N` suffix on
  the floor name when that floor has multiple pages.
  Saved-view labels also include the view name and ID; filenames include the
  saved-view ordinal before the name, plus the existing global page ordinal.
  This distinguishes duplicate/sanitized/truncated names and views on the same
  floor, even for separate current-view downloads. Ordinals follow document
  order and may change when views are inserted or deleted.
- PNG requests the chosen 72 or 150 dpi (`pngDpi / 25.4` pixels/mm), at most 16 million pixels.
  It is a raster derivative, not the vector master. Resource-limit failures remain
  visible rather than silently changing scale or resolution. Lower resolution
  reduces raster pixel work; no specific completion time is guaranteed.
- **Cancel export** is visible while an export is pending. It invalidates the
  task generation and publishes no files from that batch. An in-progress page
  encode or PDF build may finish internally, but later PNG pages will not start.
  A still-current preview and its cached pages are retained; cancellation is a
  status, not an error. Already downloaded files cannot be recalled.
- PDF, SVG and PNG batches are limited to **100 total pages**, across all
  selected views/floors and their continuations. Oversized batches fail before
  encoding/serialization; no pages are silently truncated. Preview collection
  has the same bound. Select fewer views/floors or reduce schedule content.
- Ready links remain available if the browser blocks an automatic download.
  Object URLs are revoked when their preview/output is replaced, on edits and
  when leaving the page (except back/forward-cache preservation).

An export captures `HomePlanner.getDrawingScene()` exactly once. Every page uses
that same frozen scene and revision; floors are never activated to gather geometry.
The UI checks project ID, revision, canonical input content and a task generation
before and after asynchronous work and immediately before automatic download.
Replacing or importing changed content invalidates previews and links even when
the ID and revision are unchanged, and cancels pending exports. The foundation's
`inputFingerprint()` is cached per immutable bridge document, not recomputed for
each page or link check. Selection and same-content replacements preserve output;
active-floor navigation preserves all-floor output but invalidates current-floor
output. Editing the project or changing sheet settings (including preview page) cancels
publication of old results and removes existing download links.
Screen zoom and PNG resolution are exceptions: they preserve cached geometry and
existing results. Resolution changes apply only to subsequent exports.
Failed multi-floor jobs publish no
partial set. Already downloaded files cannot be recalled by the application.

Active-floor navigation alone also preserves saved-view output in either scope,
because the saved owner floor is authoritative. Editing saved views, their hosted
geometry or replacing/importing the project invalidates output, including
same-ID/same-revision content changes and in-flight PDF/PNG work.

## Runtime integration and validation

Load `planner-drawing.js`, `planner-structure.js`, `planner-structure-drawing.js`
and `planner-drawing-export.js` before
`planner-drawing-ui.js`; the workspace and bridge must already be available.
The export adapter owns PDF-library loading. Opening this route does not request
a PDF library or start exports. Missing renderer/export runtimes show explicit
errors; Refresh preview retries the renderer after it becomes available.

Authoring links opt in using `data-drawing-discipline="views"` together with
`data-workspace="report"` and `data-section="drawings"`. The mounted controller's
`openViews(viewId?)` selects the discipline before the existing workspace router
runs, via a document capture-phase click listener (removed on disposal).
The workbench dynamically includes `data-drawing-view-id` for its selected view;
the facade link omits it to preserve the Report choice. Ordinary Report links
do not change discipline. Native keyboard link activation works identically;
modified clicks retain normal browser behavior. Fallback links use
`?workspace=report&section=drawings&discipline=views` and optional `viewId`; only
that exact route/discipline initializes views on page load. Missing/deleted IDs
stay unavailable with instructions to choose an existing view, not another-view
or architectural fallback. These links never automatically refresh views,
run analysis or load PDF.

For the `views` discipline also load `planner-elevation.js` (global
`HomePlannerElevation`). The report calls its strict `createSheets(scene, {
viewId, paper, orientation, scaleDenominator, units, floorName, title? })` and
`toSVG`; it does not pass unsupported `floorId`, `layers`, direction or cut
options. Every returned sheet uses the common validator. Empty title preserves
the saved view name instead of replacing it with the project name. Missing
saved views link to `design/elevations`; missing runtime names the required
script. Route/host integration is documented in the workbench guide and is
owned by the parent workspace change.

For plumbing, load `planner-services.js` and `planner-services-drawing.js`.
Session settings `serviceView: 'plan' | 'riser'` and
`plumbingSystem: 'both' | 'water' | 'waste'` map to the strict renderer's `view`
and `systems` array; `layers` is omitted. The common sheet validator and existing
100-page, PNG 72/150 dpi, cancellation and freshness guards all apply unchanged.
Links with `data-drawing-discipline="plumbing"`, `data-workspace="report"` and
`data-section="drawings"` select plumbing in the capture phase before workspace
routing, preventing an architectural fallback refresh. The fallback URL is
`?workspace=report&section=drawings&discipline=plumbing`. Neither link starts
analysis or loads PDF. A missing plumbing renderer is an explicit error.

Architectural is the default `settings.discipline`; structural switches only
the sheet factory to `HomePlannerStructureDrawing.createSheets` when available.
The optional `createSheets(scene, options)` returns a nonempty array of version-1
sheets for one floor; the compatibility fallback is `[createSheet(scene, options)]`.
Structural SVG
uses that renderer's `toSVG` when present, otherwise the common serializer.
Common `HomePlannerDrawing.validateSheet` validates either discipline's version-1
sheet, once per returned page at the UI boundary. No UI-specific fields are added
to the sheet schema. Missing structural renderer is an explicit error, not architectural fallback.
All-floor structural PDFs use exactly one scene without activating floors.
Discipline changes cancel pending outputs, including a lazy PDF already building;
structural edits also invalidate same-ID/revision replacements.

Refresh captures one scene and builds all pages for the preview floor once;
`state.preview.pageCount` and zero-based `pageIndex` drive the page selector.
Export captures a fresh scene once and flattens each selected floor's complete
page array, independently of the preview page.

The UI calls only optional `createSheets(scene, options)`, `createSheet(scene, options)`, `validateSheet(sheet)`,
`toSVG(sheet)`, `pdfBytes(sheets)` and `pngBlob(sheet, options)` from the shared
contract. Renderer errors (including fixed-scale fit errors) are shown verbatim
as text, never substituted with fabricated previews.

Run the owned behavioral tests with:

```powershell
node --test tests\planner-drawing-ui.test.cjs tests\workspace-navigation.test.cjs
```

These cover route compatibility, neutral settings, one-snapshot exports,
per-page outputs, runtime/fit failures, stale-task cancellation and URL/DOM
integration. Real renderer/PDF/browser export fidelity is validated separately
by their owning modules and the shared integration smoke.
