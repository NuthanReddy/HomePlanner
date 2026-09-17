# Design → Structure workbench

**Engineering status is always NOT ASSESSED.** This workbench edits conceptual
structural intent, not an engineered structural design. It does not infer loads,
soil, reinforcement, connections, strengths, safe sizes, materials or costs.
See [conceptual-structure.md](conceptual-structure.md) for exact geometry semantics
and the limitations of every coordination finding.

## Editing and persistence

Select an existing current-floor element or **New element**, then choose grid,
column, beam, slab or footing. All applicable point coordinates must be entered
explicitly; no coordinates or dimensions are prefilled for new intent.

- Input x/y are **active-floor plate-local metres**, and z is relative to that
  floor's elevation. They are not the projected site coordinates shown below.
- Column/slab/footing points are bottom centers. Width/depth are the site-axis
  footprint and height is explicit vertical extent; absent height creates no box.
- Beam points are bottom-center endpoints. Width is horizontal cross-axis width,
  depth is upward vertical thickness, and height must be blank.
- Grids are two-point planar references: width, depth, height and material must
  be blank. Coincident/sloping endpoints remain authored but produce diagnostics.
- Blank sizes/material/reference mean unknown. No material is recommended.
  Size source can be unspecified, assumed, authored or engineer-provided;
  source/reference are **unverified author claims**, never engineering evidence.

Existing anchors—including wall/entity hosts, foreign-floor points and unresolved
or null anchors—are retained exactly during metadata edits. The anchor summary
shows authored hosts and, after Refresh, resolution information. Coordinate inputs
for existing records are disabled until **Replace anchors with entered point
coordinates** is checked. Replacement explicitly removes the old hosts and uses
the current floor's point frame. Changing anchor cardinality also requires that
action. No host is silently flattened or moved to the active floor.

Save uses one bridge `upsert-authored` command for the `structural` collection.
Delete requires an existing selection and native confirmation, then uses
`delete-authored`. Other structural records, other authored collections,
documentation and surviving references are never discarded. IDs are stable
across edits. Existing absent optional metadata stays absent unless edited.
The standard project Undo/Redo and JSON save/import preserve authored changes.
Validation errors are displayed in an alert; invalid forms do not edit the model.

Workspace/mode navigation, ordinary selection and unrelated project edits preserve
pending input fields. `planner-drafts.js` retains drafts by project, floor and
element in this session; changing floors/projects shows that owner's fields and
returning restores its draft, without rehosting anchors or authoring geometry.
If the selected saved record changes or disappears, the draft remains visible
with a conflict and cannot overwrite that record. Copy needed values, then use
**Discard draft / reload fields** to adopt the current source explicitly.
Changed project fingerprints still invalidate derived coordination/preview.
Drafts are not project JSON or browser saves; apply them before making a backup.

## Schedule, coordination and preview

The view-only current-floor schedule shows named elements, positions, individually
labelled dimensions in metres, material/source and drawing status rather than
JSON geometry or issue-code lists. Position cells use floor names and available
authored object names; exact host identifiers remain in technical details.
**Not supplied** means no value was entered,
never zero; grids and beam height remain **Not applicable**. An early sketch can
retain missing sizes/material. Supply dimensions from drawings or measurements
to show solids, and obtain material descriptions from the engineer's specification.
The short form help and closed coordinate-conventions disclosure explain this
without adding a setup page.

Every authored field, including absent versus null metadata, stable identifier,
original host and computed result, remains in initially closed **Technical details**.
The selected-position summary is readable; its separate technical disclosure
retains exact authored and resolved anchors. Resolution and shape status appear
after **Refresh coordination & 2D preview**. Projected x/y are **site-local** and z is **project-relative**:
do not paste those numbers into plate-local inputs without converting frames.
Project-wide caveats and current-floor findings are listed alongside the schedule.
Missing-input findings name the required evidence or repair; original finding
records and codes remain in technical details. Identical warnings with matching
code, owner, related IDs, message and severity are deduplicated for display only.
Different owners or evidence remain separate, and controller/export records are
unchanged. Unrecognized findings keep their original warning text.
Technical disclosures remain open while typing an unrelated pending field.
Stale findings are discarded, not shown as current.

Refresh captures one `HomePlanner.getDrawingScene()` and passes that same scene
to `HomePlannerStructure.build` and `HomePlannerStructureDrawing.createSheets`
when available (otherwise `[createSheet(scene, options)]`). The sheet factory
runs once for the current floor, not once per page. Every returned version-1
sheet passes the common validator once at the UI boundary, without adding
UI fields to the sheet schema.
No background coordination, route-triggered build or periodic analysis runs.
Saving or external edits invalidate results and require another explicit refresh.
Paper A4/A3/A2, orientation and fixed 1:50/1:75/1:100 scale are session-only controls.
**Preview page** is a native keyboard-accessible select, visible only for multiple
pages. It offers the plan and every schedule/findings continuation, labeled with
floor and page number. Selecting a page uses the already captured sheets, does
not recompute coordination or author a revision, and retains current findings
and the permanent engineering caveat. The zero-based `previewSettings.pageIndex`
is session-only. Floor/project and layout-setting changes reset it to zero;
refresh bounds it if the page count shrinks. Project replacement discards all
cached pages, even when ID/revision are unchanged.
Fit failures are explicit; choose paper/orientation/scale manually. The UI never
shrinks scale silently. Renderer absence still permits editing and coordination.
Preview SVG is an image-only object URL; page switching, replacement and disposal
revoke the old URL.
The shared Design/Layout link opens the existing 2D/3D workspace; there is no
second 3D scene in this module. Structural drawing downloads use the shared
[Report → Drawings discipline selector](drawing-report.md).

## Integration API

Load `planner-drafts.js`, the bridge/foundation, `planner-structure.js`, `planner-drawing.js`,
`planner-structure-drawing.js`, then `planner-structure-ui.js`; include
`planner-structure-ui.css`. The host section is `id="workspaceStructure"` in
Design/structure. Host/router/layer integration belongs to the surrounding app.

The global `HomePlannerStructureUI.mount(document = window.document)` mounts
once per host, automatically at DOMContentLoaded (or immediately when ready).
It stores its controller on `host.homePlannerStructure`. Explicit disposal
unsubscribes and removes the mount, allowing a later clean remount. Pagehide
disposes except when the page is entering the back/forward cache.

`createController(planner, runtime)` is also CommonJS-exported. Its API:
`getState()`, `select(id = '')`, `setDraft(patch)`, `save()`,
`deleteSelected({confirmed: true})`, `discardDraft()`, `refresh()`, `setPreviewSettings(patch)`,
`sync()`, `subscribe(listener)` (returns unsubscribe), and `dispose()`.
Save returns the saved record; deletion returns true; refresh returns state.
Failures return null and expose `state.error` (settings/select API misuse throws).
State exposes draft, selectedId, floor/project identity, raw/projected schedule,
anchor summaries, findings, engineeringStatus, stale, preview and previewSettings.
`preview` includes the selected `sheet`/`svg`, all `pages`, `pageCount` and
zero-based `pageIndex`. `setPreviewSettings({pageIndex})` selects a cached page;
paper/orientation/scale changes still require explicit refresh.
No derived state is written to the project.

Validation:

```powershell
node --test tests\planner-structure-ui.test.cjs tests\planner-drawing-ui.test.cjs
```
