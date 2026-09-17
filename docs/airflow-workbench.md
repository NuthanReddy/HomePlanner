# Airflow scenario workbench

Phase 8's local selected-network workbench consumes the
[pure airflow foundation](airflow-visualizer.md),
[dedicated worker runner](airflow-worker.md), and
[plan display](airflow-display.md) and [optional 2D potential-flow estimate](airflow-field.md).
It reuses the existing pressure solver,
persist a second physical model, fetch weather, or run analysis on navigation.
This is **not validated CFD**, measured occupant-level airspeed, complete fresh-air delivery, or a ventilation
compliance assessment. Report package integration remains a later phase.

## Browser integration

The shared shell owns the `environment/airflow` route and its
`<section id="workspaceAirflow">` host. Include `planner-airflow-ui.css`.
Load the existing project bridge, `planner-regions.js`, `building-physics.js`,
`planner-airflow-field.js`, `planner-airflow.js`,
`planner-airflow-runner.js`, `planner-airflow-display.js`, then
`planner-airflow-ui.js`. Serve the worker and its dependencies over same-origin
HTTP(S). No new package dependency is required.

```js
const controller = HomePlannerAirflowUI.mount(document);
// Idempotent: repeated mount returns exactly the same live instance.
controller === document.getElementById('workspaceAirflow').homePlannerAirflow;
```

The browser entry mounts on DOM ready when the host exists. A host inserted later
must call `mount(document)` explicitly. `mount()` defaults to the global document;
an absent host returns null without work. A missing bridge yields an actionable
message instead of a partial controller. Foundation, display and runner globals
are resolved lazily: the empty form can mount before they are loaded. Preparing
or editing requires the foundation; running requires the worker runner; a missing
display retains the native forms, inventory tables and explicit error guidance.
There is no alternate renderer-derived model or main-thread solver fallback.

Stable integration IDs:

* `workspaceAirflow` → `host.homePlannerAirflow`
* `hp-airflow-prepare`, `hp-airflow-run`, `hp-airflow-cancel`, `hp-airflow-clear`, `hp-airflow-inputs`
* `hp-airflow-scenario`, `hp-airflow-floor`
* `hp-airflow-status`, `hp-airflow-view-status` (live statuses), `hp-airflow-error` (alert)
* `hp-airflow-preview` (image-only Blob SVG)
* `hp-airflow-add-room`, `hp-airflow-add-opening`, `hp-airflow-add-manual`
* `hp-airflow-json`, `hp-airflow-import`, `hp-airflow-pin`
* `hp-airflow-export-json`, `hp-airflow-export-csv`, `hp-airflow-export-svg`

Dynamic fields have associated native labels; they are not public stable IDs.
The host listens to bridge notifications, document
`homeplanner:workspace-change`, and window `popstate`. These perform read-only
synchronization, never automatic analysis. `dispose()` cancels the owned run,
disposes the runner, unsubscribes listeners, revokes owned URLs, clears session
drafts/snapshots and removes the host controller property. Remount is then safe.

## Explicit authoring workflow

1. **Prepare inventory** captures one detached DrawingScene and discovers all
   registered floors. The preview shows geometry and unknown results, no arrows.
   No rooms or links are automatically selected. Empty geometry directs the user
   to place rooms in Design and prepare again; it is not a ready numerical study.
2. **Scenario, rooms & opening inputs** opens after preparation; the always-visible
   **Review scenario inputs** shortcut opens it again. Supply density in kg/m³. Use
   **Add room** for each exact floor/room reference, and enter its clear volume
   in m³. Optional sources and notes describe assumptions without verifying them.
   Blank numbers are null/unknown, never zero.
3. Add a known physical opening. Both of its actual adjacent room zones must
   already be selected; outside is offered only for known exterior adjacency.
   Exact physical references are mapped through zone room references, never
   inferred from wall or identifier prefixes. New links are **disabled**.
4. Choose from/to orientation, explicitly enable the link, and supply operating
   free area (m²), coefficient `0 < Cd ≤ 1`, and signed forcing (Pa). Positive
   numerical flow means from → to; negative flow reverses the actual direction.
   Reversing endpoints does not silently negate the supplied forcing.
5. Review modeled operation and the read-only gross area / current fraction /
   aperture cap. Known compiled operation cannot be overridden by the scenario.
   Positive area on a closed modeled opening blocks rather than leaking.
6. Press **Run scenario**. Missing inputs return qualified blocking findings.
   The UI never repairs unknown physical values by guessing numbers.
   The exposed **Calculate a 2D potential-flow velocity estimate** option uses
   actual solved opening flows to calculate a bounded cell field. Its uniform
   model depth is declared clear volume / supplied usable area, not a measured
   clear height. New scenarios enable this option with 0.5 m numerical spacing;
   older imports without it remain network-only until explicitly enabled.

At most one zone per physical room and one link per physical opening are allowed,
including disabled links. Removing a room retains its links for explicit repair;
missing imported references are not silently rehosted or discarded. Invalid
native edits revert to the accepted draft and report the failure.

### Physical operation is a separate, explicit model edit

**Edit modeled operation — physical project change** shows a new fraction field
and **Apply operation to model…** with confirmation of old versus new state.
Only this confirmed action changes the project. It uses the existing bridge
`execute({type:'update-door', id, openFraction})` for compiled `hinged`/`sliding`
openings or `update-window` for windows, and only on the already active floor.
It does not fabricate an `adjust-opening` or `editAction` API.
The exact inventory reference is rechecked immediately before execution.

Other floors, passages or an unavailable command require the adjacent Design /
Layout navigation link. There is no hidden floor switch or assumed editable
passage. The model change applies across **all** scenarios, is undoable through
the existing project bridge, invalidates current numerical output, and does not
derive or silently resize aerodynamic free area. Review and run explicitly.
When modeled operation is unknown, a separate scenario fraction field is
available. A retained imported fraction cannot override a known model fraction.

### Manual cross-floor connections

**Add explicit manual connection** starts disabled with no guessed anchors.
Choose from/to zone endpoints (or explicit outside), operating fraction and
physical inputs. Each anchor needs its own registered floor plus all three
numeric site-local coordinates in metres. `z` is absolute site-local elevation,
not height above the selected floor. This records user intent only: it does not
establish a shaft, penetration, containment, internal route, buoyancy, or forcing
from elevation. The foundation diagnoses incomplete/incompatible anchors.

## Scenarios, cancellation and staleness

New, clone, rename, delete and selection operate only on session drafts, grouped
by exact project ID. There are at most 24 scenarios per project and 12 recent
explicit-run snapshots per project; an explicitly pinned baseline may retain an
older snapshot. Switching projects restores its scenarios and history, never
the other project's current numerical result. A page reload intentionally loses
session drafts; use explicit JSON export to keep them.

Run captures one immutable DrawingScene and normalized scenario, records their
actual canonical keys and a request generation, then calls
`HomePlannerAirflowRunner.createRunner(runtime).run({scene,scenario,
expectedPhysicalFingerprint})`. It never calls the synchronous foundation solver.
On publication it captures geometry again and compares actual project,
physical fingerprint, normalized draft key and generation before accepting the
complete returned snapshot. Same ID/revision content replacement and operation
changes are therefore detected. Supplied scene keys/revision alone are not proof.

Actual draft changes cancel and invalidate output; canonical no-op edits do not.
Physical input changes cancel and revoke current output. Floor navigation with
identical physical inputs only updates the display; it does not rerun or cancel
the network. Preparation, publication and export failures revoke unverifiable
output. Both runner and UI have bounded 120-second timeouts; cancellation and
timeout produce no fallback result. Out-of-order callbacks cannot publish.
**Clear result** cancels an outstanding run and returns to inventory-only
geometry without discarding the scenario, history or comparison pin. Old arrows
and numerical exports are revoked immediately. Run explicitly to recalculate.

Pin a historical run explicitly, clone/select another scenario, then run it.
`HomePlannerAirflow.compare` decides comparability: different projects, changed
physical inputs/operation, unbalanced results or changed selected room sets
refuse numerical deltas and show the reasons. Accepted deltas are current minus
baseline, matched by exact physical room references.

## Evidence and accessibility

Run/Cancel, compact status, scenario/floor selection and the plan precede long
forms, tables and provenance. Native keyboard disclosures collapse secondary
controls. Controls have 44px touch targets; wide tables scroll inside their own
named regions rather than forcing page overflow. SVG is rendered as an `<img>`
using a local Blob URL, never injected as interactive markup. Its `R`/`O` keys
resolve to complete names and exact references in accessible tables, including
unknown inventory values before solving.

Converged, blocked, nonconverged and numerical-error status remains explicit.
Unbalanced output is diagnostic, not a successful ventilation assessment.
All qualified foundation findings, source diagnostics, warnings and original
solver state remain available. Direct outside ACH excludes transfer inflow;
aperture-mean speed is not room or occupant airspeed.

The visible plan status separately explains **no inventory**, **no rooms**,
**not run**, **blocked inputs**, **another preview floor**, **zero net flow** and
**display unavailable**. A balanced zero-flow network has no arrows; this is not
a missing result or a prediction of single-sided exchange. Disabled/zero-area
links and a single-opening dead end must not be illustrated as moving room air.
The first blocking findings and the input/finding disclosures are exposed on a
blocked run. All original qualified findings remain available below.

Rendering errors live in `state.previewError`, independently of form validation;
a successful edit or preparation cannot accidentally erase them. Missing display
scripts, blocked Blob URLs and failed SVG image loads show viewport recovery
instructions while native inputs and tables remain usable. Prepare again to retry.
The plan does not require WebGL, and no 3D layer is enabled automatically.

**Reserved geometry is supported:** supplied `usableRegions` define host room
area and air cells, with lift/stair footprints excluded. The architectural plan
retains the actual service walls; no generic room-overlap conflict substitutes
for this supported case. A completely reserved room has no usable zone to solve.
The potential field refuses disconnected/unbalanced air regions, interior walls
absent from the supplied partition, or a port that cannot be mapped to its actual
usable boundary. Its network tables remain available; no connection is invented.

The primary 2D field has physical walls/openings, spectral speed cells, small
black computed vectors and a vertical numeric **Velocity [m s⁻¹]** scale.
The scale uses the actual computed maximum; no example-image values are copied.
Clear/edits remove both cells and vectors. Field assumptions and exact cell
values are included in evidence tables and exports, with 100-row pagination.

The expert disclosure supplements, rather than replaces, the room/link forms.
JSON replacement or append is atomic through `normalizeScenario`; malformed,
duplicate, unsupported or oversized inputs preserve the old draft. Input text
is bounded to 1,000,000 characters and foundation budgets still apply. Missing
versus null properties survive untouched import/export.

Downloads occur only on explicit clicks:

* Scenario JSON: complete session draft.
* Result JSON: entire immutable foundation snapshot, including physical inventory,
  normalized scenario, solverInput, original solver output, provenance and findings.
* CSV: unit-labeled room/link metrics, signed flows, findings, provenance and full
  captured scenario/inventory/solver input and original solver evidence. Unknowns
  remain blank; textual spreadsheet formulas are apostrophe-prefixed and CSV
  quoting escapes quotes/newlines. Signed numeric values remain numeric.
  Full input cells can exceed spreadsheet display limits: prefer JSON for
  machine round-trip or large inventories; nothing is silently truncated.
* SVG: the same current plan/field preview, not a physical-scale construction sheet.

Canonical fingerprints are equality encodings, **not cryptographic hashes**.
Their potentially long text is confined to a collapsed provenance disclosure and
local exports. Result download controls are invalidated with their snapshot;
Blob URLs are revoked after download, on invalidation and on disposal.
The Report link navigates only; it does not claim current Report package support.

## Controller API and focused validation

CommonJS: `require('./planner-airflow-ui.js')`. Browser:
`HomePlannerAirflowUI`. Exports are `createController(bridge,runtime)`,
`mount(document?)`, `numeric(value)`, `csvCell(value)`, `csv(result)`,
and `IMPORT_LIMIT`.

Controller methods: `getState`, `subscribe`, `sync`, `prepare`, async `run`,
`cancel`, `clearResult`, `dispose`, `setDraft(patch)`, `replaceDraft(value)`,
`selectScenario(id)`, `addScenario(label,clone=false)`, `renameScenario(label)`,
`deleteScenario(id,confirmed=false)`, `importScenario(text,append=false)`,
`addRoom(ref)`, `updateZone(id,patch)`, `removeZone(id)`,
`openingEndpoints(ref)`, `addOpening(ref)`, `addManual()`,
`updateLink(id,patch)`, `removeLink(id)`,
`setAnchor(id,'from'|'to','floorId'|'x'|'y'|'z',value)`,
`applyOperation(ref,fraction,confirmed=false)`, `pinBaseline(snapshotId)`,
`clearBaseline()`, and `exportData('scenario'|'json'|'csv'|'svg')`.
Mutating commands return null on validation failure and set `state.error`.
`exportData` returns `{blob,fileName}` without starting a download.

State includes project/floor metadata, scenario summaries/current draft,
inventory, current immutable result/preview, busy/error/previewError/message,
`displayStatus: {code,message}`,
history summaries, baselineId and comparison. Scenario selection IDs are
session-local handles, not necessarily imported scenario document IDs.

```powershell
node --test tests\planner-airflow-ui.test.cjs tests\planner-airflow-runner.test.cjs
```

Tests exercise the real bridge/foundation/display with deterministic async runner
fixtures and a native-DOM harness. `tests\planner-studies-browser.cjs` additionally
authors a synthetic network through native forms in a fresh headless browser
context, executes actual workers and checks visible SVG loading, signed/reversed
arrows, zero flow, clear/rerun, stale operation changes, missing dependencies and
390 px layout. It never attaches to or changes the user's live browser project.
See [the Light workbench browser command](light-workbench.md#parent-browser-integration-checklist)
for the external Playwright validation dependency, local-server and screenshot
options. The controlled analytical fixture is not a measured wind result.
