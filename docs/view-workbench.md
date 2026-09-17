# Design → Elevations / sections: saved view workbench

This panel authors **saved drawing views**, not physical facade geometry. The
adjacent physical facade panel is independently mounted by the workspace.
Neither panel calls the other panel's API. A saved elevation or finite section
is a reference drawing, not engineering certification or a construction detail.

## Authoring

Choose **New view**, enter a name, owner floor, kind, geographic viewer side
(for elevations) and saved scale, then **Save view**. A blank ID generates a
collision-checked project-scoped ID. A supplied new ID must be unique across
documentation views and sheets. Existing IDs cannot be renamed.

The table includes all saved elevations and sections, across floors. Select
the name to edit. Existing plan views remain in the document but are not
editable in this panel. Owner floor is a documentation attachment and the
coordinate frame for **new** section endpoints; it does not restrict an
elevation to that floor's physical geometry.

On phones the table scrolls horizontally inside its labeled, keyboard-focusable
region; name buttons keep a readable minimum column width. Each **ID** disclosure
is a native keyboard-accessible details/summary control containing the complete
stable identifier. Expand it to read/copy the ID; identifiers are never omitted.

**Create front/rear/left/right views** explicitly appends four named elevation
views in one Undo step. It captures the selected owner's compiled DrawingScene
heading, which derives from the legacy plate/site orientation, not an assumed
`project.site.front` property. Only cardinal headings can be authored here.
Direction is the compass location occupied by the viewer, not the viewing ray:

| Front heading | Front | Rear | Left | Right |
| --- | --- | --- | --- | --- |
| N / 0° | N | S | W | E |
| E / 90° | E | W | N | S |
| S / 180° | S | N | E | W |
| W / 270° | W | E | S | N |

The IDs and directions are saved values, not continuously regenerated aliases.
Changing the site heading later does not silently retarget them. Repeating the
operation appends another collision-free set; it never overwrites existing
views. This explicit operation projects once to obtain the heading, but does
not generate sheets.

### Finite section cuts

For a new section, explicitly enter **A x/y/z and B x/y/z**, all in metres.
There are no default zero coordinates. x/y are plate-local on the selected
owner floor; z is relative to that floor's true elevation. A and B must have
equal z and distinct horizontal positions. Endpoint order defines the screen
right axis and viewer bearing; reversing it reverses the section.

Existing point, wall and entity hosts—including cross-floor, unresolved and
null hosts—are shown verbatim and preserved on metadata edits. Changing the
owner floor does **not** rehost existing cuts. Check **Replace cut anchors**
to author a new pair of explicit points on the selected owner floor. Coordinate
edits without that checkbox do not replace an existing section's anchors.
Converting a section to elevation also requires this explicit acknowledgement,
because it removes the cut. Wall/entity host authoring is not exposed in this
form; imported/existing hosts are retained and resolved by the pure renderer.

Only physical solids intersecting the finite A-B vertical plane are shown.
**There is no beyond-cut geometry.** Missing floor levels, unresolved hosts,
invalid geometry or fixed-scale overflow fail visibly rather than producing
generic plan previews or guessed cut lines. No exposed stair, parapet, roof,
canopy or unprovided slab levels are fabricated. See
[the pure renderer contract](elevations-sections.md) for full geometry and
visibility limitations.

### Persistence and history

Each save, deletion or four-view creation uses exactly one bridge
`execute({ type: 'set-documentation', value })` transaction. The existing
version-1 envelope, **every sheet**, plan view and unedited elevation/section
are retained. Deleting a view requires native confirmation. Surviving sheet
`viewIds` are not rewritten; they may become unresolved until Undo or another
explicit authoring operation restores the reference.

Saved fields are exactly `id`, `name`, `kind`, `floorId`, `scaleDenominator`,
`direction` and `cut`. The bridge validates the complete transaction atomically.
Undo/Redo and project JSON round-trips preserve these values and identities.
Invalid edits show a text-only alert and do not create partial records.

Workspace and homeowner/expert mode navigation do not recreate the controller
or render drawings; unsaved drafts remain. Active-floor navigation retains the
draft's explicit owner floor and discards the preview. Changed project content,
including same-ID/same-revision replace/import, invalidates the preview. Unrelated
edits retain pending fields. A changed/deleted selected view retains its draft
with a conflict; it cannot overwrite the changed source until the user explicitly
discards/reloads fields. Project switches park input drafts by project/view ID;
returning restores them and their explicit owner floor. These session-only drafts
are registered with `planner-drafts.js`, never written into project JSON by typing.
Apply them before browser Save or exporting a backup.

## Preview and shared exports

**Refresh preview** is explicit. It renders the selected *saved* view, not
unsaved form changes, using one frozen DrawingScene. The pure renderer returns
all continuation pages; every page passes the common drawing validator. The
native page selector switches cached pages without recapturing or recomputing
geometry. Previews use image-only SVG object URLs, never inserted SVG HTML;
URLs are revoked on replacement, invalidation or disposal.

**View zoom (screen only)** defaults to **Fit to width**. **Full resolution
(intrinsic size)** restores the SVG image's intrinsic browser size with internal
scrolling. This is display-only, not physical print calibration: neither option
changes millimetre SVG dimensions, saved scale, renderer geometry or exports.
Zoom is local to the mounted panel and does not recapture scenes, invalidate
cached pages or require Refresh. It resets on reload.

Saved scale choices are **1:50, 1:75, 1:100 or Unknown**. A non-null saved scale
is authoritative: the UI passes the same value to the renderer, even if the
session preview fallback differs. Unknown requires the explicit preview or
Report fallback scale. A3 landscape / 1:100 fallback / metric are the initial
preview preferences. A4/A3/A2, portrait/landscape and metric/imperial are
supported. Scale never silently shrinks to fit.

Use **Report → Drawings → Elevations / sections** for PDF, SVG or PNG. The
report's **Selected view** scope uses that view's owner floor. **All saved
elevation/section views** iterates saved views once in document order and
flattens every continuation from one snapshot—not once per project floor.
The Report floor selector and plan layer controls are hidden. A saved scale
overrides Report scale; Unknown uses Report's explicit fallback. No saved
views produces an actionable link back to this workbench, never a plan fallback.
The workbench's export link selects **Elevations / sections** and the currently
selected saved view in one navigation. A missing/deleted requested ID shows an
actionable error instead of silently selecting another view. Neither this link
nor the facade Report link starts rendering, analysis, PDF loading or downloads.

There is no additional export implementation in this workbench. Report reuses
`HomePlannerDrawingExport.pdfBytes` / `pngBlob`, its download links and their
existing lifetime/stale-task guards. PDF remains local and vector. Preview
paper/units/page preferences and draft text are session-only, not new saved
sheet-schema fields.
Report provides **72 dpi · fast screen review** and **150 dpi · print review**
(default) PNG resolution options, plus **Cancel export**. These change raster
sampling only, never sheet geometry or drawing scale. Cancellation suppresses
publication of the entire batch and subsequent pages; an already-running encode
may finish. Report preview cache is retained when still current. All export
formats and previews are bounded to 100 total pages, failing without truncation.

## Parent integration hooks

The host/index/workspace integration belongs to the parent change:

1. Register `design/elevations` in the workspace route and put a **persistent**
   element with `id="workspaceViews"` inside that section. Place the independent
   `workspaceFacades` host alongside it, not inside it.
2. Load `planner-elevation-ui.css`. Load the bridge/model/projection, common
   Drawing, Structure and `planner-elevation.js` before `planner-elevation-ui.js`.
   Report additionally needs `planner-drawing-export.js` and the existing
   `planner-drawing-ui.js`. No dependency or PDF loader is added here.
3. The classic global is `HomePlannerElevationUI`; CommonJS exports the same
   `{ createController, frontDirections, mount }` API. Browser mount runs once
   at DOMContentLoaded (or immediately if the DOM is ready).
4. `mount(document)` looks up only `workspaceViews`, returns null if absent,
   and returns the existing `host.homePlannerViews` controller when already
   mounted. If a parent dynamically inserts the host later, explicitly call
   `HomePlannerElevationUI.mount(document)` afterward. Keep the host mounted
   across routes/modes rather than calling dispose on every navigation.
5. `createController(bridge, runtime)` exposes `getState`, `subscribe`, `sync`,
   `select`, `setDraft`, `save`, `createFrontViews`, `deleteSelected`,
   `setPreviewSettings`, `refresh` and `dispose`. Bridge requirements:
   `getProject`, `execute`, `getDrawingScene`, `inputFingerprint`; optional
   `subscribe`, with mounted Undo/Redo using the existing bridge methods.
6. `HomePlannerDrawingUI` now accepts `settings.discipline = 'views'` and
   `settings.viewId`. Runtime renderer is **HomePlannerElevation**, not a
   separate exporter. Workspace links carry the existing `data-workspace`
   and `data-section` attributes for in-page navigation.

This change intentionally does not edit the index, route registry, 3D viewer,
facade core or pure elevation engine. Until the parent adds the host/script/
stylesheet/route integration, the standalone authoring panel is not reachable.

## Validation

```powershell
node --test tests\planner-elevation-ui.test.cjs tests\planner-drawing-ui.test.cjs
```

Tests cover real-bridge atomic history/JSON preservation, four non-N compass
mappings, existing hosted cut preservation, explicit points, replacement
invalidation, mounted host isolation and URL lifetime, cached pagination,
one-snapshot multi-floor/multi-view schedule continuations, actual local PDF
page count and stale asynchronous export cancellation. Mock DOM checks are not
a substitute for a parent-integrated visual/browser smoke test.
