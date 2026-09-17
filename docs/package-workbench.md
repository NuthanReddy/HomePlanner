# Coordinated package workbench

Report → Package assembles conceptual reference sheets from one captured project
revision. It does not run airflow or light analysis, certify engineering, upload
files, or silently resize fixed-scale drawings.

## Review and download

Choose **Refresh preview** explicitly. The preview appears before the closed
settings and findings disclosures. Refresh and PDF stay above it; the other
export formats follow the preview. **Preview controls** is a closed native
disclosure with the page selector and Fit to width / 100% screen zoom.
Those controls only change the preview and preserve prepared download links.
The summary reports pages, findings, available evidence attachments and revision.
Open **Findings & missing evidence** to inspect literal source messages and follow
exact linked floors/objects. Missing targets never select guessed replacements.
Authored structural/service references select their exact owning workbench
records; electrical references use the shared electrical selection. Invalid or
unmounted targets leave the error in the visible package instead of navigating
to an empty editor and hiding the failure.

**Prepare PDF** creates one PDF containing every ordered package page.
**Prepare SVG** and **Prepare PNG** produce individual files for every page.
Every format includes the JSON manifest and all analysis attachments provided by
the package foundation. **Prepare manifest** produces the manifest plus those
attachments without drawing files. Download each listed file; no ZIP dependency
or automatic upload is used. Missing analyses remain unavailable, not invented.
PNG resolution is 72 or 150 dpi, subject to the existing exporter’s 16-million-
pixel / 8192-pixel-side caps. The workbench passes `pngDpi / 25.4` pixels per mm
to the shared exporter. Raster dimensions are floored to whole pixels, matching
its existing bounded raster contract. Print at **100% / Actual size**, not Fit to page.

All files are published together only after the last page succeeds. Cancellation,
an encoding error, model edits or changed analysis evidence discard download
links; already downloaded files remain unchanged. Cancellation stops publication
and any further pages even if a native encoder already running cannot be stopped.
Preview/export share the frozen package until source/settings/evidence change.
Changing PNG dpi discards prepared files but reuses physical sheet geometry.
Only raster-intent metadata is replaced in a new frozen manifest; its source
revision and evidence stay unchanged. Previously returned manifests remain
immutable.

## Settings are project intent

Defaults: A3 landscape, 1:100, metric, 150 dpi, empty title. Available papers are
A4/A3/A2; scales are 1:50/1:75/1:100. Titles allow up to 200 characters without
control characters.

**Save package settings** applies an undoable `set-documentation` change containing
only package intent alongside the latest existing documentation views and sheets.
It is **not** a browser-storage save: use the global project **Save** afterward.
Project load, undo and redo restore saved package settings (or defaults when
absent). Unrelated same-project edits preserve an unsaved settings draft. Changing
saved intent retains a conflicting pending draft and blocks overwriting the new
source until **Discard draft / reload settings** is explicitly chosen. Project
switches park drafts by project ID and restore them on return. `planner-drafts.js`
registers these session-only inputs with global replacement/unload protection;
browser Save and project JSON contain only applied settings.

## Integration contract

Load `planner-drafts.js`, the existing bridge/model, drawing renderer and drawing exporter, all package
foundation dependencies and `planner-package.js`, then `planner-package-ui.js`.
Load `planner-package-ui.css` alongside the incumbent workbench styles. Supply
`#workspacePackage` in Report’s `report/package` destination; workspace/index
integration is separate from this module.

`HomePlannerPackageUI.mount(document, runtime = document.defaultView)` passes the
**actual Window unchanged**, mounts idempotently and exposes its controller at
`host.homePlannerPackage`. Mount and route changes never build, analyze or export.
Late-mounted analysis controllers reconnect on `sync()` or refresh. Source results
come only from `#workspaceAirflow.homePlannerAirflow` and
`#workspaceLightStudy.homePlannerLight`; subscriptions observe result identity,
not visualization settings, with source guards before and after each async encode.

`HomePlannerPackageUI.createController(bridge, runtime, document)` exposes:
`getState`, `subscribe`, `setSettings`, `saveSettings`, `discardSettingsDraft`, `refresh`, `exportFiles`,
`setPage`, `setZoom`, `cancel`, `sync`, `openFinding`, `dispose`.
State includes `settings`, `settingsDirty`, `busy`, `error`, `message`, `preview`
(`sheet`, `svg`, `pageCount`, `pageIndex`), `outputs` (`blob`, `fileName`, `mime`,
optional local `url`), `package`, `stale` and screen-only `zoom`.
Successful export returns `{outputs, package, isCurrent}`; failed/cancelled exports
return `null`. Preview and output Blob URLs are revoked on replacement,
invalidation, cancellation, page-hide or disposal. Page changes revoke only the
old preview URL, never the complete-package download URLs.

The `.hp-package` styles inherit `--txt`, `--panel`, `--line`, `--acc` and `--warn`.
Primary layout classes are `.hp-package-actions`, `.hp-package-view-controls`,
`.hp-package-preview`, `.hp-package-controls`, `.hp-package-findings`,
`.hp-package-table-wrap` and `.hp-package-outputs`. Native disclosures start closed,
controls have 44px targets and overflow is contained within preview/evidence areas.
