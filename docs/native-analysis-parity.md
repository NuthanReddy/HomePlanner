# Native Analyze reuse parity

## Scope and sign-off

`src/platform/AnalysisTabs.tsx` mounts **only the existing analysis workbenches**.
There is no iframe, hidden full application, alternate project, sample-plan
fallback or new solver. The supplied `PlannerApi` remains the authority for all
registered floors, shared Site and applied Environment inputs. The component
must remain mounted while the parent changes its `activeTab`; inactive hosts are
hidden. No worker, weather request, geolocation or GPU starts on navigation.

The four tabs have working bounded native adapters. This is **not** a claim that
every service and account workflow has end-to-end parity. The explicit remaining
integration gaps below prevent an unconditional whole-product sign-off.

| Tab | Incumbent capability inventory and retained adapter | Evidence / intentional difference |
| --- | --- | --- |
| Light | `HomePlannerLightUI.mount`: whole-house sky map; all-floor inventory; selected workplanes/heights/spacing; custom solar intervals and DST occurrence; optical model/VLT; sky quadrature/horizon; neighbor boxes/roof declarations; floor/metric/interval/model-only/electrical display; named session scenarios, clone/delete/rename; history/pinned comparison; cancel/clear; config import and config/JSON/CSV/SVG exports | Original controller, local worker, display and fingerprint guards. Browser check calculated six workplanes across two fixture floors and exported SVG. Added explicit **Use shared Materials VLT**, retaining source and real zero; SHGC/null are not substituted. **Use current Solar selection** accepts only the parent's current computed Solar response with matching applied/shared Site; see wiring below. |
| Airflow | `HomePlannerAirflowUI.mount`: inventory; whole-house plan volume estimates; geometric opening-area estimates; saved project weather reference; density, zone/link values, sources; exact opening operation commands; manual connections/anchors; optional numerical field controls; floor/scenario/history/compare; import/export scenario, JSON/CSV/SVG; cancel/clear | Original controller, dedicated local worker and field/display modules. Browser calculated a supplied zero-pressure six-room scenario and CSV export. Physical changes still use the supplied planner; no global `window.HomePlanner` is required. No pressure forcing or Cd is inferred from weather. |
| Pressure / CFD | `HomePlannerCFDUI.mount`: active-room selection; physical geometry findings; all numeric material/boundary/mesh/time/receiver inputs; source notes and acknowledgements; fully-open/closed commands; explicit saved-input conflict handling; Save inputs; Check engine; Prepare/download case; Run/cancel/clear; job log; scalar/vector plots, probe table, conservation diagnostics; history/comparison and result/comparison exports | Existing single-room OpenFOAM case/job adapter, **not** a pressure-network fallback. No service call on mount. Browser checks nullable input saving, explicit unavailable-engine error, disabled Run and clean dispose/remount. Real OpenFOAM execution is not verified. |
| Expert pressure (disclosure within Pressure / CFD) | Environment's older current-floor JSON network template, null-required inputs, sources/acknowledgement, save unevaluated draft, explicit solve, signed flow table/residual diagnostics | Narrow `HomePlannerReducedUI` presentation/controller extraction reuses `EnvironmentUI.buildAirflowTemplate`, `validatePressureInput`, `geometryKey`, `reducedResultMarkup` and the exact `BuildingPhysics.solveAirflow`. No hidden Environment workspace or copied physical equations. Original input/result schema and one-command transaction retained. |
| Thermal & energy | Environment's current-floor RC template; null capacities/temperatures/conductances/gains; explicit source notes/acknowledgement; save draft; run; modeled temperature/time table; residual/warnings; saved matching result restoration; analysis JSON evidence | Same bounded adapter uses incumbent `buildThermalTemplate`, `validateThermalInput`, `simulateThermal` and shared result markup. Actual numerical output includes the energy ledger in JSON. Desktop shows output beside the editor; mobile stacks them. Table displays first plus final 239 samples when bounded, with all samples retained in export. No EnergyPlus, annual energy, humidity/HVAC or calibrated indoor prediction is claimed. |

## Shared inputs, drafts and persistence

- Project Site is reused by Light's explicit **Use project site** action; physical
  scene geometry is already shared. Analysis does not autosynchronize account
  coordinates or resize imported geometry.
- The parent owns the explicit saved-Materials/imported-weather bridge. Applied
  `project.environment.weather`, `materials` and `glazing` are available directly:
  Airflow reads the saved wind reference; Light can copy VLT/source; reduced-model
  tabs expose current Site, weather coverage/first interval and construction data
  read-only. There is no duplicate weather/Material entry form here.
- Weather availability does not establish pressure boundaries, zone capacity,
  gains or interval-start thermal forcing. Material areal heat capacity is not
  automatically an effective room RC capacity. These genuinely missing inputs
  remain required, not silently inferred.
- Reduced-model drafts are registered in `HomePlannerDrafts` and owned by
  project/floor. Concurrent saved changes block submission until the user keeps
  the draft for review or reloads saved input. Geometry changes revoke evidence
  and acknowledgement. Failed validation leaves the prior saved pair untouched.
- Template preparation retains the incumbent explicit one-command authored
  template behavior. Save/Evaluate commits only its own scenario and merges other
  Environment results. Undo/Redo restores matching evidence without rerunning.
- Light/Airflow named scenarios and histories remain session-only, as before.
  Export their config/scenario explicitly. Reduced-model/CFD committed inputs and
  reduced results are included in Design JSON and the parent's Design Save flow;
  this component does not independently claim a successful durable save.
- Reduced analysis exports use the explicit
  `homeplanner.reduced-analysis` envelope, retaining all scenes, shared environment,
  current-result status and an explicitly identified unapplied raw draft. This is
  a **tab-scoped download**, not a replacement for the incumbent all-Environment
  Report export. A stale saved output remains in source environment with
  `currentResult:null`/`resultCurrent:false`; it is not exported as current success.

## Lifecycle and integration contract

```tsx
<AnalysisTabs
  planner={designPlanner}
  activeTab={workspace === 'Analyze' ? study : ''}
  onNavigate={() => navigateToDesign()}
  solarSource={appliedRecord ? {
    record: appliedRecord, result: currentSolarResult, blocked: appliedBlocked
  } : null}
/>
```

Exact native tab values: `Light`, `Airflow`, `Pressure / CFD`, `Thermal & energy`.
The optional navigation callback receives `design/layout`; wire it to native
Design navigation rather than the classic hash/router.

### Native Solar selection wiring (parent-owned files)

`analysis-solar.ts` exports `AnalysisSolarSource` and `nativeSolarSelection`.
The parent should expose SolarStudy's already-derived `current` response rather
than reconstructing a result from its editable draft:

1. Add optional `onCurrentResultChange?: (result: SolarResult | null) => void` to
   `SolarStudy`. Immediately after deriving `current`, publish it in an effect
   keyed by `[current, onCurrentResultChange]`; clean up by publishing null. This
   means clear, pending calculation, rejected input, changed draft, changed
   workspace version/project, blocked source, and unmount withdraw the source.
2. Forward that callback unchanged through `NativeWorkspace` to a stable
   `setCurrentSolarResult` in `PlatformApp`.
3. Pass `solarSource` as above using the existing applied record/blocked state.
   Clear parent result when switching account project even before new record load.
   Do not pass an old result merely because its civil date matches.

The explicit Light copy action reads the **latest** source ref, without
remounting any workbench or replacing other scenario inputs. It checks account
project/version, result coordinates and exact shared Design Site. Mismatched
imported geometry/Site is not silently rewritten. It then verifies the selected
UTC instant independently with `HomeSun.resolveLocal`, including earlier/later
and skipped-clock rejection. It copies date, start clock, occurrence and Site
provenance only, clearing previously prepared samples/period and old end time.
The user supplies an end time and explicitly prepares/runs the Light study.
The original spacing, optics, room selection, context and other scenarios remain
untouched. Native pvlib directions, atmosphere, pole cutoff and sampling defaults
are **not** repurposed as Light physical/numerical inputs.

The three incumbent `mount` functions accept an optional third `planner`
argument; their original defaults remain compatible. Light has an optional fourth
options object for native navigation and Sun Path copy availability. A
`data-homeplanner-manual` script attribute suppresses their startup auto-mount and
Environment's full-workspace auto-mount. All runner calls receive the original
Window, not an object inheriting from Window. CFD disposal now removes its own
delegated listeners, pagehide listener, URLs and host controller so remounts do
not return disposed controllers or duplicate Save commands.

The parent must serve/copy these same-origin **classic** assets in addition to the
Design model/projection/regions/drafts and existing SunCalc/HomeSun/physics assets:

```text
environment-data.js
environment-ui.js
environment-ui.css
planner-light.js
planner-light-runner.js
planner-light-worker.js
planner-light-display.js
planner-light-ui.js
planner-light-ui.css
planner-airflow-field.js
planner-airflow.js
planner-airflow-runner.js
planner-airflow-worker.js
planner-airflow-display.js
planner-airflow-inputs.js
planner-airflow-ui.js
planner-airflow-ui.css
planner-cfd.js
planner-cfd-ui.js
planner-cfd-ui.css
planner-reduced-ui.js
```

Workers import their local foundation/model dependencies from the same directory.
An HTML fallback is not a successful JavaScript asset. Production copy/worker
transport must be checked after parent integration, not inferred from a Vite
TypeScript build.

## Verified evidence

Commands:

```powershell
node --test tests\planner-reduced-ui.test.cjs tests\environment-ui-state.test.cjs tests\planner-light-ui.test.cjs tests\planner-airflow-ui.test.cjs tests\planner-cfd-ui.test.cjs
npx tsc -b --pretty false
npx tsx --tsconfig tsconfig.app.json --test tests\platform-analysis-solar.test.ts
node tests\platform-analysis-browser.cjs
```

The standalone browser check accepts `HOMEPLANNER_PLAYWRIGHT_MODULE`,
`HOMEPLANNER_BROWSER_CHANNEL` (default installed Edge), and
`HOMEPLANNER_PLATFORM_URL` (default local Vite 5173). It opens and closes a fresh
context and synthetic current-project bridge; no account requests, browser
storage import or live project mutation is used.

Scoped controller regression outcome: **100 tests passed**; TypeScript build
typecheck passed.

The browser check was executed through the available Playwright connector against
the actual React component, original workers and classic source modules:

- Six Light workplanes and six Airflow rooms across two registered fixture floors.
- Real local worker result/map and SVG/CSV export availability.
- No worker or `/api/` request on mounting/navigation; one explicitly clicked,
  synthetic unavailable-CFD-runtime response. No fake CFD output.
- Thermal JSON input, explicit evaluation, result export request, Undo/Redo and
  retained unapplied draft when navigating away/back.
- CFD Save as one shared command; disposed/remounted controller handles one Save.
- All four tabs fit a 390 px viewport (375 px document content), with no page
  errors; numerical views are also exercised at 1280 px.
- Clear revokes Light evidence. Unit regressions cover same-revision physical
  invalidation, stale workers, missing dependencies, output scope, known zeros,
  nullable inputs, multi-floor ownership and concurrent draft conflicts.

The first browser verification temporarily routed classic assets to exact local
source. After parent integration the full browser suite **passed without asset
routes on fresh Vite 5175**, including real local workers. The expanded browser
suite additionally verified native Solar copying and rejection after its source
was cleared, without starting a worker/request. Its computed-selection envelope
is explicitly synthetic; the browser test does not pretend to execute pvlib.
Three focused Solar bridge tests cover source ownership/version, matching Site,
no project mutation, retained inputs, repeated DST UTC matching and skipped times.
No numerical conservation, browser or equation test establishes CFD, lux or
whole-building energy validation.

## Explicit remaining gaps / blockers

1. **CFD service/runtime:** incumbent `/api/cfd/*` requests require the local
   Python service and separately configured OpenFOAM runtime. Native account API
   ownership/routing and actual engine execution are not implemented here. Missing
   service/runtime is an explicit error; case preparation is never reported as a
   successful solver run.
2. **Native Solar callback wiring:** the complete analysis-side selection adapter
   and browser/controller checks are implemented; connect the parent's current
   response as specified above. Until supplied, the copy action explains that a
   current computed Solar selection is required and leaves Light drafts intact.
3. **Native 3D overlay:** Light retains its original `homeplanner:light-result`
   event and host state, but viewing that layer still requires the separately
   migrated Design 3D consumer and explicit user opt-in. No GPU starts here.
4. **Account persistence / shared-source application / packaged assets:** parent
   responsibilities. This adapter provides the shared command and mount contracts,
   not an independent account save or source-sync authority.
5. **External engine migration:** Light/airflow/RC remain plainly labeled local
   JavaScript reuse adapters. No actual Python Radiance/EnergyPlus replacement was
   supplied, and working incumbent capabilities were not replaced by placeholders.

## Bounded CFD native integration contract (investigation; not implemented)

The gap is concrete, not merely “engine missing”:

- `planner-cfd-ui.js` sends relative `/api/cfd/*` requests, cookies, and JSON, but
  no native `x-csrf-token`. It currently allows only loopback page hosts.
- `vite.config.mts` proxies **only `/api/v1`** to native API8001. The CFD URL may
  therefore return the HTML fallback. The controller now identifies that content
  type as “Native API routing is not connected,” never JSON evidence or a ZIP.
- `backend/api.py` has no CFD routes. Its existing `AUTH` dependency requires the
  session and mutation CSRF token; `owned_project` checks account ownership.
  Its default request limit is 16,384 bytes, whereas the incumbent case request
  permits **262,144 bytes**. Merely forwarding the current request is insufficient.
- `app.py` provides local `/api/cfd/capabilities`, `runtime`, `prepare`, `package`,
  `jobs`, `jobs/{id}`, `jobs/{id}/cancel`, `jobs/{id}/result`. Its host/origin guards
  belong to the standalone loopback app, not native account access control.
  Adding a broad Vite proxy or relaxing those guards would not supply ownership.

Recommended bounded first increment: authenticated project-scoped **case
preparation/package only**, reusing `CfdService.prepare/package` with execution
off. Proposed routes:

| Native route beneath `/api/v1/projects/{accountId}/cfd` | Incumbent service method |
| --- | --- |
| `GET /capabilities` | `capabilities()`; report execution unavailable unless separately approved |
| `POST /prepare` | `prepare(caseRequest)` → `{status:"prepared",manifest}` |
| `POST /package` | `package(caseRequest)` → `application/zip` |
| Later: `POST /runtime` | explicit `probe()` only |
| Later: `POST /jobs` | `submit(caseRequest)` → 202 `{job}` |
| Later: `GET /jobs/{jobId}` | `get_job(jobId)` |
| Later: `POST /jobs/{jobId}/cancel` | `cancel(jobId)` |
| Later: `GET /jobs/{jobId}/result` | `get_result(jobId)` |

Parent backend/API work required before claiming the connection:

1. Use native `AUTH`, allowed-origin policy and `owned_project` for **every**
   endpoint, including reads/downloads/cancellation. Keep a narrowly scoped
   262,144-byte *case-request* bound and strict JSON decoder; if adding a wrapper
   with account/design version, separately bound its small overhead.
2. Bind preparation/job metadata to the authenticated account project, separately
   from client `source.projectId` (an imported Design's stable ID is not the
   account UUID). Record the request's actual geometry/input identity and saved
   Design version when applicable; explicitly identify an unsaved working-copy
   case rather than calling it the stored Design. Reject changed expected Design
   versions before and after bounded preparation. Preserve original manifest/
   request hashes and the frontend's existing stale-result guards.
3. Add an optional explicit transport to the incumbent controller, rather than
   installing a global fetch/URL override. Parent transport supplies the scoped
   path, cookie and CSRF, validates response type, and preserves exact success/
   error envelopes, job source and case hash. No cross-origin plan upload or
   source rewriting. Keep standalone `/api/cfd` compatibility.
4. Before enabling jobs, durably map `(account owner, account project, job UUID)`
   to the server-owned case and verify that mapping on poll/result/cancel. The
   incumbent runtime's local workspace lock/job ID is **not** account authorization.
   Retain one active execution/no queue, bounded retained jobs, cancellation and
   shutdown cleanup; do not instantiate a per-request service that loses jobs.
5. `CfdService` has two preparation slots, one active job and existing mesh/file/
   CPU/memory/wall-time limits. Reuse these, its fixed stage commands and output
   validation; never accept user shell commands or case paths. Server lifespan
   must call `shutdown()` on an owned long-lived service.
6. Runtime remains opt-in: `HOMEPLANNER_CFD_ENABLED=1`, reviewed distribution
   (`HOMEPLANNER_CFD_DISTRIBUTION`), OpenCFD v2606 bashrc
   (`HOMEPLANNER_CFD_BASHRC`) and dedicated configured workspace semantics.
   Defaults do not demonstrate an installed engine. Do not install/enable/probe
   from navigation. Current case preparation needs no WSL or OpenFOAM execution.

Validation for that later increment must cover owner/CSRF rejection, bounded
payloads, same-account different-project job isolation, changed Design versions,
JSON/ZIP routing, unavailable runtime, preparation independent of execution,
exact-job cancellation and restart recovery. Synthetic parser tests and runtime
readiness still cannot claim a validated CFD run. No backend routes, runtime
configuration or engine installation were changed during this investigation.
