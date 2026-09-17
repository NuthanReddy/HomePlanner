# Room light workbench

The Light workspace is an **explicit supplied-model study**, not a lux,
daylight-factor, illumination-adequacy, irradiation or artificial-light tool.
The existing whole-house Sun Exposure and Airflow tools remain independent.
Unknown context remains unknown even when computation finishes.

## Integration and lifecycle

Load the existing foundation dependencies, bundled `vendor/suncalc-2.0.1.js`
and `sun-model.js`, then `planner-light.js`, `planner-light-runner.js`,
`planner-light-display.js`, and `planner-light-ui.js`; include
`planner-light-ui.css`. Serve the worker assets on the same HTTP(S) origin.
The UI requires the existing `HomeSun.position(instant, latitude, longitude)`
and `HomeSun.resolveLocal(date, time, IANATimeZone, occurrence)` helpers.
`HomeSun.localCandidates(date,time,zone)` supplies the explicit DST occurrence
labels. These are existing helper implementations, not another ephemeris.
Both helpers are exposed by the existing HomeSun module for this shared
interval-preparation path; tests use the actual public exports.

The parent owns the outer `#workspaceLight` and its guidance. Add an inner
`<section id="workspaceLightStudy"></section>`; the workbench never clears the
outer content.

```js
const controller = HomePlannerLightUI.mount(document); // idempotent
// Also available as innerHost.lightController and innerHost.homePlannerLight.
const controllerWithoutDOM = HomePlannerLightUI.createController(bridge, runtime);
```

The browser global and CommonJS API are identical:
`createController`, `mount`, `numeric`, `csvCell`, `sensorCSV`,
`prepareIntervals`, `LIMITS`. `mount(document, runtime?)` uses
`document.defaultView` unless a runtime is explicitly supplied. The bridge must
provide `getProject()`, `getDrawingScene()`, and preferably `subscribe()`.
The workbench never calls a mutating bridge command.
The original runtime is passed unchanged to the worker runner: native Window
accessors must not be accessed through an object inheriting from Window.
An explicitly supplied document is used separately for events and Sun Path controls.

Controller methods:

| Purpose | Methods |
| --- | --- |
| Inventory / worker | `prepare()`, `run()` → Promise, `cancel()`, `clearResult()`, `sync()`, `dispose()` |
| State | `getState()`, `subscribe(listener)` → unsubscribe |
| Configuration | `setDraft(patch)`, `replaceDraft(config)`, `importConfig(text)` |
| Solar preparation | `setSite(patch, source?)`, `setSelection(patch)`, `useProjectSite()`, `useSunPathSelections(document?)`, `prepareSunIntervals()`, `localOccurrences("start" \| "end")` |
| Workplanes | `addRoom({floorId,entityId})`, `updateWorkplane(id,patch)`, `removeWorkplane(id)` |
| Context | `addBox()`, `updateBox(id,patch)`, `removeBox(id)`, `setNeighbor(side,state,boxIds?)`, `setRoof(floorId,patch)` |
| Session studies | `addScenario(label?,clone?)`, `selectScenario(id)`, `renameScenario(label)`, `deleteScenario(id)` |
| Compare | `pinHistory(snapshotId)`, `clearPin()` |
| View | `setFloor(floorId)`, `setVisualization(patch)` |
| Downloads | `exportData("config" \| "json" \| "csv" \| "svg")` → `{blob,fileName}` |

Synchronous failed edits return `null`, expose `state.error`, and preserve the
previous accepted config. `run()` returns a frozen detached terminal result or
`null`; no partial progress result is presented as success. `getState()` exposes
`draft`, `selection`, `siteSource`, `intervalSource`, `floorId`, `scenarios`,
`selectedScenarioId`, `inventory`, `result`, `preview`, `visualization`, `busy`,
`error`, `previewError`, `message`, `displayStatus: {code,message}`, `progress`, `history`, `baselineId` and
`comparison`. Drafts/selections are detached copies; numerical snapshots and
display views are recursively frozen.

Construction, route navigation and floor selection do not run discovery or
analysis automatically. Explicit inventory preparation captures all registered
floors. Once an inventory exists, bridge notifications and workspace changes
verify its actual physical fingerprint; equal project ID/revision is not enough.
Worker start and completion each capture a fresh physical snapshot. A changed
window, geometry, project or draft cancels the pending generation and revokes
current evidence. Missing Worker support, script failure and a 120-second
timeout produce a visible error, never a main-thread calculation fallback.

## Native controls and first use

The first viewport has the short heading, metric warning, Prepare / Run /
Cancel / Clear controls, a **Review study inputs** shortcut, status and a closed
view/scenario selector; the plan follows. The initial empty preview always paints
prerequisite instructions, even before a first inventory or image exists.
Long input editors, warnings, tables, provenance and imports sit below it.
No modal, autoplay or animation is used. All native controls have 44 px minimum
targets. Workbench text, surfaces, borders and disclosures inherit the parent
theme rather than its lower-contrast global accent or a new green palette.

1. **Prepare inventory** opens **Study inputs → Select rooms & workplanes**.
   Select exact discovered room references. Supply each workplane height in
   metres above its already-projected floor; no physical height is assumed.
2. Supply study coordinates/time zone yourself or explicitly **Use project
   site**. This copies only actually available latitude/longitude/IANA metadata;
   its provenance warns that a project value may be a default, not a survey.
   Nothing is auto-applied on mount. **Use Sun Path selections** copies the
   existing `sunDate`, `sunTime`, `sunLatitude`, `sunLongitude`, `sunTimeZone`,
   `sunOccurrence` controls into this exploratory draft only.
3. Choose start date/time and end date/time. Blank end date uses the start date;
   overnight studies need an explicit next date. Repeated DST clock times need
   **earlier** or **later** choices. Nonexistent clock times are rejected.
4. **Prepare sun intervals** resolves both endpoints with HomeSun, divides their
   actual UTC duration, clips the last positive interval, and samples the exact
   UTC midpoint with HomeSun's degree-based SunCalc position/vector helper.
   No browser-local date parsing, fixed UTC offset, assumed 24-hour day or second
   solar model is used. Date/time/site/stride edits discard previously prepared
   samples and period. Prepare again, then explicitly run.
5. Explicitly choose ideal-clear apertures or visible transmittance plus source;
   irradiance transmittance/SHGC is not silently reused. Supply the near-horizon
   cutoff. Sky access is time-independent; disabling it means unavailable, not
   zero. Night is decided by the foundation's actual supplied sun vector.
6. Review all four neighbor states and each existing floor's roof declaration.
   Unknown is the default. A modeled side references exact user-authored box IDs.
   Box x/y/width/depth/base/height are explicit site-local metres; transmission is
   explicit 0–1. A corner box may be referenced by multiple sides but remains one
   object. It does not mutate the project or override existing facade geometry.
   Do not enter the same obstacle again as a box. Roof absence requires a source
   and cannot remove an actual supplied roof; missing slabs, levels or
   interstorey connections are not inferred.

The only numerical defaults are grid spacing **0.5 m**, sky **16 radial bands /
64 azimuth sectors**, and interval stride **30 minutes**. These are documented
computational discretizations, not recommended physical design values. Sky is
initially enabled; optics, cutoff, heights, site, times and context remain
repairable unknowns. See [the executable config contract](light-visualizer.md)
and `HomePlannerLight.CONFIG_SCHEMA`.

The expert JSON importer accepts the complete strict config, including exact
UTC/sun directions or angles, period and original site metadata. It does not
rewrite valid imported fields or pretend the imported astronomy was verified.
Use it for deliberate analytical fixtures, not as the only authoring workflow.

### What an empty or uncolored view means

The always-visible status next to the plan distinguishes:

- **Not prepared / inventory only:** no calculation has run. A prepared empty
  project directs the user to place rooms in Design, not to invent workplanes.
  An inventory with no projected floors uses the display's empty-frame state;
  it does not try to select an unregistered active floor.
- **Blocked:** the first blocking findings and the recovery path are visible;
  the input and warning disclosures open. No cells imply a successful study.
- **Another floor:** choose a studied display floor. The app does not switch
  the active project floor or analysis selection automatically.
- **Night / known zero:** legitimate zero direct sun is separate from missing
  values. Daytime occlusion can also give zero; sky access is independent of
  the selected night interval.
- **Unknown context / unresolved horizon / unprocessed interval / disabled sky:**
  these remain unavailable. Only explicit modeled-only selection shows the
  supplied-model columns; it never confirms the missing context.
- **Renderer or image failure:** the viewport contains an actionable message,
  and the equivalent evidence tables remain available. Failed Blob creation
  and SVG image loading cannot leave only an empty frame. Prepare again to retry.

**Clear result** cancels pending work, removes numerical cells and publishes
`result:null, stale:true` to 3D. It retains the study inputs, inventory and history.
Run explicitly to recalculate. Physical edits likewise revoke old cells; the
status identifies stale evidence rather than displaying an old result as current.
The compact numerical legend is visible outside the longer warning disclosure.
Neither the SVG plan nor its tables requires WebGL.

**Reserved geometry is supported:** the numerical grid is intersected with the
supplied disjoint `usableRegions`. Each positive-area fragment has its own exact
cell, midpoint and area weight, so lift/stair reservations are deducted rather
than sampled as host room floor. The main plan shows actual walls/openings and a
spectral light-access field with a vertical numeric legend. The legend retains
the actual metric—sky/path access or hours—not the reference image's lux units.
Unknowns remain hatched; blue is known zero. The scale's range comes from the
computed values, with a readable range also shown outside the image.

No physical service geometry is mutated, and supported reservations are not
rejected as generic overlaps. Empty usable regions cannot contain a workplane;
invalid/overlapping/out-of-bounds regions still fail explicitly. Existing sensor,
ray, comparison and export budgets are unchanged and never silently coarsened.

## Cached visualization and 3D contract

```js
state.visualization = {
  metric: "direct", // direct | presence-hours | equivalent-hours | sky
  intervalIndex: 0,
  modeled: false,
  showElectrical: false
};
```

The manual interval slider and matching UTC interval dropdown use cached results.
Metric/time/model/electrical changes do **not** invalidate numerical evidence or
resimulate. They replace the SVG preview; an SVG download always uses this same
current view. The floor selector changes the displayed floor only, never the
analysis room set. Choices survive refresh and the interval index is bounded
when a different study has fewer intervals.

On current result publication, invalidation, visualization change and disposal,
the controller dispatches a document `CustomEvent("homeplanner:light-result")`:

```js
{
  result: currentResultOrNull,
  visualization: { metric, intervalIndex, modeled, showElectrical },
  stale: false // true on invalidation or disposal, always with result:null
}
```

3D consumers may read `innerHost.lightController.getState()` (also aliased as
`innerHost.homePlannerLight`). A navigation link calls
`HomePlannerWorkspace.navigate("design/layout")` without toggling the 3D layer;
the user opts into that layer there. No global current-visualization singleton
or alternate project physical model is introduced.

## Evidence, comparison and resource limits

- Results distinguish computation completion from known-context study
  completeness. Unknown primary values never become grey zeroes. An explicit
  **modeled-only** view is labeled independently from primary evidence.
- Sensor and room tables use the display adapter's exact values and unit fields,
  with 100 rows per page and internal horizontal scrolling. JSON exports retain
  all rows and exact canonical keys; provenance stays in a closed disclosure.
- CSV includes site-local coordinates/metres, cell area/m², normalized sky
  access/0–1, presence/h and transmitted-equivalent/h. Unknown primary values
  are empty, modeled processed quantities have separate columns. Text cells
  beginning with spreadsheet formula triggers are neutralized; signed numbers
  remain numbers. No third-party export package is used.
- Session-only named studies support clone, rename, delete and selection without
  modifying the physical project. Keep up to **24 studies per project**, **12
  recent captured results**, plus **one pinned comparison**. Project switches
  isolate their drafts and history. Comparison calls the foundation's exact
  `compare`; incompatible physical/sensor/period/optical definitions show its
  reason codes and `deltas:null`, not fabricated cross-sensor deltas.
- Maximum **2,048 UTC intervals**; stride is an integer **1–1,440 minutes**.
  Config imports are limited to **1,000,000 characters**. Each Blob image,
  result/download is limited to **20 MiB** (a conservative character check is
  also applied before result cloning). Foundation ray/sensor/model budgets
  remain authoritative. No budget violation is silently truncated.
- The preview uses SVG-as-Blob-image, not inserted SVG/HTML. Replacing a view or
  disposing revokes its prior object URL. Missing display dependencies produce
  a visible error while native study inputs remain usable. Worker progress
  changes the compact status, not a partial result painting.

## Parent browser integration checklist

Primary stable IDs:
`workspaceLightStudy`, `light-prepare`, `light-run`, `light-cancel`, `light-clear`, `light-inputs`,
`light-status`, `light-view-status`, `light-scale`, `light-error`, `light-viewport`, `light-floor`, `light-scenario`,
`light-metric`, `light-interval`, `light-interval-slider`, `light-modeled`,
`light-electrical`, `light-design`, `light-room`, `light-add-room`,
`light-project-site`, `light-sun-path`, `light-latitude`, `light-longitude`,
`light-time-zone`, `light-date`, `light-endDate`, `light-startTime`,
`light-endTime`, `light-strideMinutes`, `light-start-occurrence`,
`light-end-occurrence`, `light-prepare-sun`, `light-optics`,
`light-visible-transmission`, `light-optics-source`, `light-sky`,
`light-radialBands`, `light-azimuthSectors`, `light-horizon`,
`light-neighbor-front/right/rear/left`, `light-add-box`,
`light-study-name`, `light-new-study`, `light-clone-study`, `light-delete-study`,
`light-history`, `light-pin`, `light-unpin`, `light-export-config/json/csv/svg`,
`light-import-config`, `light-import`.

Run `node --test tests\planner-light-ui.test.cjs`. Tests use the real project
bridge, projection/foundation, display and bundled SunCalc with a deterministic
worker transport fake. They cover 23/25-hour DST dates, ambiguity/gaps,
midpoint chronology, unknown physical inputs, independent context boxes,
same-ID/revision staleness, cancellation, immutable results, explicit site
copying/import metadata, cached-view export/event updates, comparison refusal,
formula-safe evidence and native focus/Blob lifecycle.

`tests\planner-studies-browser.cjs` additionally opens disposable headless browser
contexts against a local server. It uses the real bridge factory with a
synthetic-context storage adapter, native study forms, the real projection,
SunCalc, workers and SVG displays. It never attaches to a running browser profile,
imports into the user's live project, or saves a user project.

```powershell
$env:HOMEPLANNER_PLAYWRIGHT_MODULE = 'C:\path\to\validation\node_modules\playwright'
node tests\planner-studies-browser.cjs
```

Playwright may be installed separately for validation; it is not an application
dependency. The server defaults to `http://127.0.0.1:8000/`; override with
`HOMEPLANNER_STUDY_URL` (local hosts only). Windows uses installed Edge by default;
`HOMEPLANNER_BROWSER_CHANNEL` overrides the channel. Optional
`HOMEPLANNER_STUDY_ARTIFACTS` saves desktop/mobile screenshots to the caller's
chosen artifact directory. Checks include 390 px layout, visible loaded images,
clear/rerun, unknown context, real night zeros, invalidation, empty/unsupported
geometry, missing Worker/renderer errors and a deliberately unavailable WebGL
context. They do not claim lux, CFD, surveyed inputs or all-device coverage.
