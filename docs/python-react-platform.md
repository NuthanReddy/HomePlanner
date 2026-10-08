# Python / React platform migration

The incremental platform entry point is `platform.html`. The incumbent
`index.html`, Flask endpoints and React `migration-preview.html` remain intact.
The locked target navigation is **Site / Design / Analyze / Compare**.
AI assistance belongs within Design; exports belong in the source tab. Jobs is
a compact header panel, not a fifth workspace.

## Implemented foundation

**Selected hosting target:** Azure SQL Database's free General Purpose serverless
offer for dev/test, with pause on monthly free-limit exhaustion. The code and
configuration below still implement PostgreSQL; do not substitute an Azure SQL
connection URL until the driver, migrations, transactional auth limits and
auto-pause connection handling have been migrated and verified.

- FastAPI endpoints under `/api/v1`; Azure Communication Services SMS adapter
  using `DefaultAzureCredential`, with live sends **disabled by default**.
- E.164 phone validation, keyed OTP digests, expiry, five-attempt budget,
  one-time consumption and resend supersession.
- Database-backed per-phone, per-source and aggregate send limits across API
  replicas. PostgreSQL row locks coordinate limits and OTP verification.
- Opaque HttpOnly sessions with hashed credentials, SameSite cookies, explicit
  origin checks and CSRF verification. Production uses Secure host-only cookies.
  Logs and validation responses do not include phone numbers or OTP values.
- Account-owned project metadata, paginated listing, creation, explicit name
  saves, metadata revision history and compare-and-swap conflict rejection.
- Alembic initial migration; no automatic schema creation at API startup.
- HTTP-backed React sign-in, code verification, project list, project-name
  editing, frozen workspace navigation and explicit unavailable-engine states.

Project metadata records are **not canonical geometry documents**. Their `version`
is a persistence version, not `HomePlanner`'s geometry revision or
`inputFingerprint`. Existing project geometry, IDs, floors, drafts, browser
storage and Undo history are not read, uploaded or replaced. No migration from
legacy geometry is implied by creating a platform project.

## Native Site migration: first stage

The React platform now has an independent native **Site/Costs document**, owned
and validated by Python. This is not a migrated legacy schema-1 room document.
No browser project is embedded, imported, uploaded or replaced.

| Destination | Implemented in this stage | Still pending |
| --- | --- | --- |
| Site / Plot & Feasibility | Structured plot/road/building inputs with independent m/ft road units; draft-derived height/floor options; latitude, longitude and opt-in device detection; gross/net/envelope drawing; retained Table III/IV, TDR, custom setbacks and separate compounding scenarios | Junction splay and parking geometry; fresh amendment review |
| Site / Environment | Automatic offline coordinate-to-IANA lookup on Apply; current offset display; cuboid/tree drag or two-click drawing, on-canvas selection/movement/corner resizing, including beyond roads; equivalent numeric placement/resize; default location weather source and explicit Open-Meteo current-model fetch | Full weather-file/time-series migration and connection of obstacles to native Python shadow studies |
| Site / Regulatory sources | Source links and scope qualifications | Fresh comprehensive amendment/eligibility review |
| Analyze / Costs | Saved explicit land/construction rates; opt-in retained LRS/BRS/compounding/betterment/impact/cess schedules; line-by-line Python amounts, treatment and calculation basis | Current fee/eligibility verification, TDR acquisition and permit/scrutiny costs (also absent from the incumbent estimate); export |
| Analyze / Utilization | Applied metrics; 9 aspect ratios × 91 hypothetical net-area samples; loss/built-up/intensity/cost curves; required/applied setbacks; whole, selected split and best of 281 splits with diagrams and tables; best/mirrored fraction copied to draft only | Continuous/global optimization, subdivision approval, editing actual rooms; export |
| Design / Layout | Incumbent Site-driven generator, split geometry, 2D/Three.js editor, inspector, programme/library, fullscreen/zoom and deletion controls; explicit account snapshot save/load with CAS and retained revision records; saved-baseline warnings preserve pending drafts | Drawings without full editor context require a full Room Planner document; incompatible imports are rejected without replacing the working copy |
| Design / Structure, Elevations, Plumbing, Drainage, Electrical | Actual shared-planner discipline workbenches and source-owned SVG/PDF/PNG exports where supported; shared history and parked drafts | Engineering/hydraulic/electrical certification is not implemented; see [discipline parity](native-design-disciplines-parity.md) |
| Design / Review | Incumbent science/green/Vastu scorecards, individual fixes, Fix all feasible and guarded Undo last fix, plus current-model diagnostics | Heuristic findings are not measured performance or approval; Undo last fix deliberately refuses to overwrite subsequent independent edits |
| Analyze / Solar | Applied-Site pvlib charts and current-clock defaults; actual Design roof/wall direct-sun hours and cumulative slider; shared-weather irradiance snapshots using registered Site objects and known Materials SHGC. See [scope and engine differences](native-solar-charts.md) and [house-study limits](native-house-sun.md) | Noncardinal obstacle registration, monthly house comparisons/maps; irradiance snapshots retain independent-floor and unobstructed-diffuse assumptions. Room-light studies remain a separate Light tab |
| Analyze / Materials | Python port of retained homogeneous-layer assembly calculations; explicit film resistances, sourced example comparisons, separate glazing values, nullable inputs and Undoable Apply | Room/envelope assignments, thermal bridges, dynamic indoor simulation and EnergyPlus integration |
| Analyze / Wind & windows | Explicit EPW/JSON import, Python 16-sector wind rose, clock/month filters and weather provenance; per-project session drafts; explicit reuse of the complete normalized weather in Design studies, durable after Save Design | Window proposals and room-linked ventilation; raw import text and Wind filter drafts are session-only |
| Analyze / Light, Airflow, Pressure / CFD, Thermal & energy | Actual current-Design controller mounts, Light/Airflow workers and exports, shared environment inputs, explicit calculated Solar-clock transfer to Light, incumbent reduced pressure/thermal scenarios; PsychroLib supplied-input utility remains functional | Actual CFD service/runtime integration; see [analysis parity](native-analysis-parity.md). Solar copying uses the calculated clock, not the display-only chart scrubber |

Prohibited Properties is omitted from the native navigation for now. Legacy
destinations remain intact while their native replacements are staged.

### Reusing Design instead of rewriting it

The existing `roomSvgPlan` / room interaction runtime, `HomePlanner` coordinator,
`planner-editor.js` and `planner-3d.js` remain the Design implementation.
React is a host, not a reason to replace their geometry, service reservations,
openings, selection or Undo semantics. The typed facade in
`src/domain/project/legacy-planner-api.ts` already forwards to that authority.
The existing Three.js view accepts an explicit bridge and model through
`HomePlanner3D.mount`; its pinned local runtime remains compatible. Python
analysis and account persistence do not require a different graphics engine.

Site inputs and the schema-1 Design document remain distinct persisted records.
Design mounts the incumbent editor for an explicitly generated plan from applied
Site inputs or an explicitly opened full Room Planner JSON. Its working copy is
cached per account project, with explicit **Save Design**
and JSON export. Keep the mounted controller across workspace tabs for Undo/drafts.
There is no hidden iframe, automatic import, new sample plan or replacement
geometry store. Generated designs retain their applied Site source and schematic
coordinate registration. Later Site changes require explicit review/apply and do
not regenerate edited rooms. Solar receives this actual mounted controller and
reuses matching Site registration; saved Environment objects require explicit
shared-origin and vertical-datum registration for an independently imported,
unlinked Design.

`0003_design_snapshots` stores full schema-1 Design JSON independently from native
Site history. Owner-scoped `/projects/{id}/design` GET/POST use their own monotonic
save version and compare-and-swap. Python validates the bounded JSON envelope
without dropping same-schema metadata; the incumbent model validates geometry
on frontend save/load. Server envelope acceptance is not physical validation.
Failed saves retain edits; conflicting replacements require explicit review.
Save excludes unapplied fields. Every accepted changed save retains a revision;
Site Undo never silently rewinds room geometry, and no autosave is enabled.

`tests/platform-design-storage-browser.cjs` exercises the full account workspace
against the disposable API, including actual Design save/reload, multiple floors,
unknown metadata, rejected concurrent save with edits retained, and explicit
saved-copy recovery. It never opens a saved browser profile. The isolated
analysis and discipline browser probes also pass using the actual classic asset
allowlist, without replacing local script responses. These checks do not close
the remaining feature gaps listed above.

Saved Materials and selected EPW/JSON weather can be reused through the
**Use ... in all Design studies** actions without re-entry. They use the shared
`set-environment` command, preserve unknown properties and source metadata, and
produce one Design Undo entry. Weather uses the complete incumbent normalized
dataset, not the wind table's truncated preview or the current-weather sample.
Subsequent **Save Design** durably stores these shared analysis inputs.

The repository root retains CommonJS semantics for its existing UMD modules and
Node regression tests. `vite.config.mts` explicitly selects ESM for Vite, while
`vendor/three/package.json` scopes ESM to the pinned Three.js distribution. This
keeps `require('../planner-model.js')` and the original Three.js tests functional
without converting the mature modules or rewriting their test imports.

### Native Wind and weather

Wind & windows mounts the imported-weather study in the native Analyze workspace.
Choosing a local EPW/JSON file reads it locally; Calculate explicitly sends it to
the application Python API, not a weather provider. File text and filter drafts
are cached per project for the signed-in session. They are not stored in the
workspace document or included in Undo/Redo. Navigation does not start a study.
Results are invalidated when project revision or study inputs change.

The rose uses 16 FROM-direction sectors relative to true north and record-count
frequencies, with explicit calm and unusable records. Source fixed-offset and
applied Site IANA clock filters remain distinct. Partial-year, missing-field
and source warnings stay visible; a current sample is not annual climate.
Window proposals remain pending the actual authored-room/opening integration.

### Native Materials

Materials adds an optional versioned section to existing native documents.
Old documents read with empty unknown inputs without a database rewrite.
Layers retain IDs, labels, sources, conditions and explicit SI properties;
film resistances require values and provenance rather than silent defaults.
The Python calculation ports the retained homogeneous-layer equations:
`R = Rinside + sum(d/k) + Routside`, `U = 1/R`, and
`Careal = sum(rho*c*d)`. Example comparisons retain their source links and
conditions; their presence does not select an assembly for a room.
Whole-window U, SHGC and VLT remain independent supplied glazing properties.

Apply uses the existing owner-scoped workspace CAS/Undo transaction. Inspector
drafts survive tab/project navigation, unrelated saves and conflicts; evaluation
uses only the saved revision, never unfinished text. Explicit evaluation is
read-only and rejects stale output. Assembly descriptors are not indoor
temperatures, effective zone capacities, cooling loads or savings predictions.

Applying Plot coordinates resolves the zone with pinned `timezonefinder==6.5.9`
geographic boundary data, without sending coordinates to a remote service
([package and API](https://pypi.org/project/timezonefinder/6.5.9/)).
The resolved IANA ID is saved in the same Undoable command as the coordinates.
Missing coordinates produce an unknown zone; lookup failures reject the command.
Existing saved zones/history are not rewritten on read or unrelated edits.
The Environment tab displays the applied zone and current UTC offset, not a
selector; date-specific studies must still use IANA/DST rules. Boundary lookup
is an estimate near disputed/border locations, not a surveyed determination.

Surrounding buildings and elliptical tree-canopy bounds can be selected directly
on the canvas, moved, and resized from any corner. Drawing supports drag or two
clicks with a live preview. The numeric editor is prefilled on selection.
Pointer cancellation restores the pre-gesture footprint; Escape cancels a gesture
or placement. Add/Save explicitly commits one revision; previewing never writes
to the project. Resizing retains the object ID and unknown physical properties.

`0002_native_workspace` adds `workspaces` and `workspace_revisions`, leaving
accounts, auth sessions, metadata revisions and existing browser storage intact.
Owner-scoped GET `/projects/{id}/workspace` returns an unknown-input initial
document without saving defaults. POST `/workspace/commands` accepts
`{expected_version, action, value}`, with partial validated `site`/`costs`
updates or `undo`/`redo`. Accepted changes, including one object Add/Save/Remove,
commit one durable transaction. No-ops do not advance the revision.
Undo/Redo restores full document content through a new monotonic revision;
new edits after Undo discard only the abandoned redo branch. Conflicts reject
the change and retain UI drafts for explicit reload/review.

Typing, drawing two corners, navigation and geolocation results are drafts.
Plot Apply, weather Apply and cost Apply own separate fields; adding an
obstacle does not consume unfinished numeric inputs elsewhere. Native numeric
drafts survive section and project navigation within the signed-in session.
They are not durable until Apply; browser refresh warns while mounted drafts
exist. Object footprint/properties are an unsaved preview until Add/Save.
Coordinates use metres from the gross plot north-west corner, x east and y
south. Negative or beyond-plot footprints are allowed; base elevation, height
and transmission remain null unless supplied. Tree ellipses are canopy-bound
proxies, not a species or validated optical model.

GET `/workspace/evaluation` derives Site, Costs and Utilization from the saved
native version. Results retain project identity/version and are discarded if
the active version changes. Drafts never masquerade as applied results.
The bounded Table III port is compared against the incumbent calculator across
area/road thresholds and all frontage choices. This verifies implementation
parity, **not current legal approval**. Invalid selected bands/floor counts
require review instead of silently changing the user's selection.

### Native Costs and Utilization

Costs defaults to the earlier partial supplied-rate scope. Selecting retained
schedules additionally requires explicit LRS/BRS applicability, LRS rebate choice
when payable, and violated built-up area for due BRS. The response provides
`line_items` alongside legacy-compatible `lines_inr`; each row has its amount,
inclusion treatment and calculation basis. Already-paid/not-applicable and
subsumed-in-BRS rows remain explicit zero additions, not missing values.
Flat/built-up SRO and onward-sale registration are omitted from the native UI:
construction needs only the construction rate, not a separate finished-property
valuation. Historical flat SRO values remain in storage/API for compatibility,
are preserved by unrelated commands, and never enter the subtotal.
Construction uses the separate compounded footprint only when enabled;
non-compliant custom scenarios retain their warning in Costs and Utilization.
These ports reproduce the incumbent schedules, not current tax or legal advice.

The Cost inputs follow the legacy Plot Planner order and terminology: plot
purchase, land SRO, construction, stilt, stamp/transfer/
registration, GST, LRS/rebate and BRS/violated area. Land rates display in
**INR/sq yd**; construction and stilt rates display in
**INR/sq ft**, with BRS violated area in **sq ft**. Storage and Python formulas
remain canonical INR/m² and m². Display conversion uses 0.83612736 m²/sq yd
and 0.09290304 m²/sq ft; applying unchanged rates preserves the exact saved
canonical value. In-session older metre-based drafts are converted once using
an explicit display-version marker, rather than reinterpreting their numbers.
GST retains legacy scenario choices and any saved custom percentage; no tax
eligibility is inferred. The legacy 55% stilt shortcut requires explicit opt-in
instead of turning an unknown blank into an assumed rate.

Utilization's logarithmic area curves span 50–5,000 yd² of **net** hypothetical
area, with frontage:depth aspect ratios. They independently choose Table III
bands, so they are not the active site's selected-height output. Missing or
zero-built-area cost samples remain gaps; the UI never connects across unknown
samples. A selected aspect has a solid curve and its full numeric sample table,
including dimensions, floors and required/applied setbacks.

Split scenarios independently deduct widening and apply Table III bands to each
half of the **gross** plot frontage. The diagrams use a local frontage frame
with the selected road at the top, explicitly not geographic north. Amber
indicates widening; envelopes do not spatially place the numeric open-space
deduction. Best sampled maximizes usable footprint, not total built-up or price;
both selected and best cases are compared with the independently evaluated
whole plot. TDR and compounding do not apply to split comparisons, matching the
incumbent comparator. Copy-best/mirrored buttons modify only the split draft;
Apply commits once and Undo restores the prior setting. No subdivision, storey
or room geometry is created.

Location-based weather is selected by default but does not trigger third-party
access on navigation. The explicit fetch button acknowledges sending the saved
coordinates to Open-Meteo; Python reuses
`python_analysis.calculate_current_weather_density` and its fixed-provider,
bounded response/time/unit checks and actual PsychroLib calculation. The
session-only sample retains source/timestamp/grid/units and cannot replace an
imported EPW/JSON dataset. Free API use is non-commercial and subject to provider
terms; it is not an annual weather series or an on-site measurement.

Restart the local API after code changes to run the additive migration;
the dedicated local launcher preserves its existing database and session secret.
The Vite dev frontend reloads code automatically.

## Local configuration and execution

Use the isolated environment rather than altering legacy Python dependencies:

```powershell
.\.venv\Scripts\python.exe -m venv .venv-platform
.\.venv-platform\Scripts\python.exe -m pip install -r requirements-platform.txt
```

### Offline development (no Azure database or SMS)

In one terminal, start the loopback API:

```powershell
.\.venv-platform\Scripts\python.exe -m backend.local
```

In a second terminal:

```powershell
npm run dev:platform
```

Open **http://127.0.0.1:5173/platform.html**. Use a fictional valid-format number
such as `+12025550123`, select **Create local code**, **Open local OTP inbox**,
then enter the displayed random code. This is **simulated delivery**, not phone
ownership verification. Normal OTP expiry, attempt/replay limits and session
guards remain enforced. Inbox data exist only in server memory; restarting
invalidates inbox access and requires a new code if not already signed in.

The explicit local launcher initializes/migrates its dedicated SQLite database
and persists a random session secret under ignored `.local-platform`; existing
sessions and saved project metadata survive restart. It ignores `.env.platform`
and explicitly selects development, loopback origins and simulated delivery.
Do not share that directory or use it for real customer data. `--data-dir`
selects a different dedicated local directory; `--init-only` initializes without
starting a server. No browser project is imported or overwritten.

The local inbox is forbidden in production, with live SMS, or with non-loopback
origins. Requests require a loopback client and hostname; inbox reads also require
the challenge's unguessable ticket and the ordinary exact-Origin JSON boundary.
Codes are not logged or stored in database records in plaintext. Vite binds
loopback with a strict fixed port; the API does not trust proxy headers.

### Configured SMS / PostgreSQL runtime (Azure SQL migration pending)

Create ignored `.env.platform`, supplying your own values:

```dotenv
HOMEPLANNER_ENVIRONMENT=development
HOMEPLANNER_DATABASE_URL=postgresql+psycopg://<user>:<password>@<host>:5432/<database>?sslmode=require
HOMEPLANNER_AUTH_SECRET=<independent-random-secret-at-least-32-characters>
HOMEPLANNER_ALLOWED_ORIGINS=["http://localhost:5173"]
HOMEPLANNER_SMS_ENABLED=false
```

For local development only, a SQLite URL such as
`sqlite:///platform-local.db` is supported. It is not production storage or
evidence of PostgreSQL concurrency correctness. Do not point tests or trial
migrations at an existing project database.

### Analyze Python modules

Analyze **Solar** calls `python_analysis.calculate_solar` through the native
`POST /api/v1/projects/{id}/workspace/solar` adapter and executes pinned pvlib.
The form accepts a civil date/time, optional repeated-time occurrence, explicitly
supplied atmosphere inputs or acknowledged missing-field reference values, and a
5–60 minute sample interval. Coordinates and IANA zone come exclusively from the
saved Site; client coordinate overrides are rejected. Python zoneinfo resolves
the civil clock by round-trip: skipped times fail, repeated times require an
earlier/later choice. Results retain the native workspace version, checked both
before and after computation, with client input-generation guards.

The native chart uses elapsed UTC hours (including 23/25-hour days), distinguishes
geometric and apparent elevations, retains negative night values and labels the
next-day endpoint. The numeric table includes UTC and local offsets. Study
settings survive tab/project navigation within the signed-in session, but settings
and results are not durably saved. Site drafts/conflicts block calculation; edits
invalidate mismatched results. Nothing runs on navigation.

Analyze **Airflow** still exposes the supplied-JSON `calculate_density` utility,
executing pinned PsychroLib. It is not a room-velocity or ventilation study.
Neither path alters the authored project or generates alternatives.

The earlier `POST /api/v1/projects/{id}/analysis/solar-position` and `/air-density` remain compatible and accept
`{"inputs": {...}}` using the existing contracts in [Python analysis](python-analysis.md).
Ownership and CSRF checks apply; responses retain project identity and metadata
version, explicitly tagged `supplied-input-utility-not-plan-study`. This version
is not a geometry fingerprint. Missing inputs/libraries fail explicitly.

Full section engine paths follow [toolchain research](research/building-analysis-toolchain.md):
Light uses Honeybee Radiance/Radiance, detailed Airflow uses the existing Python
OpenFOAM case/runtime adapter, and Thermal & energy needs the selected compatible
EnergyPlus translation/runner. These full engines are **not integrated here**:
the new platform has no canonical room geometry yet and lacks reviewed optical,
boundary, material/operation and weather inputs. Native runtimes are not installed
by the utility requirements. Do not replace them with fake values or label
PsychroLib density as airflow velocity. `Run study` and alternative generation
remain unavailable until their complete snapshot/engine pipelines exist.

Apply migrations explicitly, then run the API and Vite in separate terminals:

```powershell
.\.venv-platform\Scripts\python.exe -m alembic upgrade head
.\.venv-platform\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8001 --no-proxy-headers
npm run dev:platform
```

Vite proxies `/api/v1` to the loopback API, retaining the browser Origin. Production
must expose frontend and API under the same HTTPS origin; no permissive CORS
policy or cross-site cookie workaround is provided.

SMS sign-in deliberately returns an unavailable error until a delivery adapter
is configured. There is no runtime fixed code, OTP response field or console-code
bypass. The disposable browser fixture below is the only fixed-code server and
must **never** be deployed.

### Azure SMS setup boundary

Set `HOMEPLANNER_SMS_ENDPOINT`, `HOMEPLANNER_SMS_SENDER` and
`HOMEPLANNER_SMS_ENABLED=true` only after configuring the ACS resource, appropriate
managed identity permissions and approved sender. No connection string is
required by this adapter. Enabling delivery incurs SMS charges.

Sender/subscription eligibility, recipient countries, registration requirements,
service changes and actual delivery must be verified before production use.
Provider acceptance is not proof of delivery to a handset. No live send was
performed by the migration tests.

Reference: [Microsoft ACS Python SMS quickstart](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/sms/send?pivots=programming-language-python).

## Validation

```powershell
.\.venv-platform\Scripts\python.exe -m unittest discover -s tests -p test_platform_api.py -v
.\.venv-platform\Scripts\python.exe -m unittest discover -s tests -p test_platform_workspace.py -v
npm run test:platform
npm run build
```

API regressions use a migrated temporary SQLite database and injected recording
sender. They cover ownership isolation, missing authentication, origin/CSRF
guards, expiry/replay/attempt/send limits, delivery rejection, migration shape,
revision conflicts and unavailable engine semantics. PostgreSQL integration,
replica concurrency and real ACS delivery remain separate deployment gates.

For isolated browser checks, stop other listeners on the chosen ports only if
they belong to you, or use another fixture configuration:

```powershell
.\.venv-platform\Scripts\python.exe tests\platform_browser_server.py
npm run dev:platform
```

The fixture uses temporary storage, accepts a synthetic `+12025550123` phone,
and records SMS in memory; its verification code is `123456`. This is an
explicit test fixture, not application authentication. Stop it after checking
the UI; it never uses Azure credentials or user projects.

## Remaining migration

Python canonical project validation/commands, transactional geometry Undo/Redo,
active-floor rendering, site/requirements inputs and legacy import are pending.
Light/airflow/thermal/solar and other domain engines require specialist-guided
Python adapters with numerical parity and snapshot protections.

Service Bus dispatch, durable job storage, worker cancellation, Blob artifacts,
contextual exports and alternative-plan generation/ranking are not implemented.
Run study must analyze only the authored plan. Only **Generate alternate optimal
plans**, or explicit Design AI assistance, starts a search; present current plus
three distinct evaluated feasible alternatives, and never silently apply them.

Production hardening still requires database integration and load tests, account
recovery/phone-change policy, abuse controls at ingress, secret rotation,
expired-auth retention cleanup, telemetry, private networking, backup/restore,
deployment validation and SMS eligibility checks. The implemented foundation
is not a completed or production-ready migration.
