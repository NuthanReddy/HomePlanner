# HomePlanner

A local-first browser workbench for GHMC/HMDA plot comparisons, editable
multi-floor layouts, sun paths, environmental scenarios and electrical-point
planning.

The six project destinations are **Overview**, **Site · Plot Planner**,
**Design**, **Environment**, **Compare**, and **Report**. Project/save context
and the shared active-floor toolbar remain available throughout. See
[workspace navigation](docs/workspace-navigation.md) for routes and state behavior.

| Tool (within its project destination) | Capabilities |
|---|---|
| Plot Planner | Setbacks, selectable G+n floor counts, explicit non-compliant setback scenarios, plot splitting and indicative costs. Regulatory sources stay on this page. |
| Room Planner | Independent floors, Apply/Enter numeric-setting drafts, destination-based movement, movable lift/stair reservations, schematic open-stair plans, shared 2D/3D object actions, Undo and complete-project JSON controls. |
| Sun Path (Environment) | Local SunCalc angles, daylight/twilight/golden-hour summary, monthly and seasonal paths, same-clock-time curves, 1 ft pole-shadow length, neighbour-blocked roof/exterior-wall sunlight hours, coordinate detection on request and CSV export. Exploratory overrides apply to the project only on explicit request. |
| Environment | Local weather import, opt-in historical-weather fetch, geometric shadows, layer comparisons, wind proposals and explicitly supplied reduced-model experiments. |
| Airflow (Environment) | Room/opening pressure scenarios, signed opening arrows, optional depth-averaged potential-flow fields, residuals, cancellation and local evidence. Optional Python air-density calculation from supplied or explicitly requested location weather; not validated CFD or measured occupant airspeed. |
| Thermal / CFD (Environment) | Current-room OpenCFD v2606 case preparation/download, explicit thermal/flow inputs, managed Run/Cancel, real-output conservation diagnostics and compatible mesh/timestep comparisons. Real solver execution and numerical verification are pending runtime setup; no placeholder simulation results. |
| Python calculations (optional local service) | Real PsychroLib air density and pvlib solar position/day-path charts. Explicit Open-Meteo weather retrieval keeps imports intact. No automatic requests or whole-building energy/CFD engine. |
| Light (Environment) | Room workplane direct-sun masks, presence/transmitted-equivalent hours, normalized cosine-weighted sky access, scenarios, local evidence and opt-in 3D cells. Real electrical-point intent remains a separate non-emitting layer. Not lux, daylight factor or lighting adequacy. |
| Electrical | Per-floor points, wall/surface anchors, unknown-height states and ergonomic/professional-review guidance. |
| Drainage (Design) | Separate sanitary/storm intent, supplied ground/finished-floor/invert levels, explicit discharge destinations, geometric fall/clearance review, plans/profiles, PDF/SVG/PNG and opt-in 3D centerlines. Not hydraulic sizing, safe discharge or construction approval. |
| Prohibited Properties (Site · Plot Planner) | Telangana location dropdowns, source reports, local Tesseract OCR, searchable tables and a Markdown cache. Requires an explicit connection to the local Flask server. |
| Document package (Report) | Ordered conceptual drawing set, coordination findings, available analysis evidence and explicit unavailable sections from one captured project snapshot. Multipage vector PDF, individual SVG/PNG sheets and revision manifest; editable package settings stay in project JSON. |

## Run locally

### Azure-backed Python / React migration

The new `platform.html` entry point adds a Python HTTP API, phone/SMS
authentication boundary and account-owned PostgreSQL project metadata. It uses
Azure SQL Database's free offer as the selected dev/test hosting target; backend
database migration is pending. The UI follows
the locked **Site / Design / Analyze / Compare** layout while keeping unavailable
geometry, simulation and optimization controls explicit. This is an incremental
foundation, not a completed production migration; the legacy planner below
remains available. See [platform setup and migration boundaries](docs/python-react-platform.md).
For offline development, run `.\.venv-platform\Scripts\python.exe -m backend.local`
and `npm run dev:platform` in separate terminals. The dedicated local SQLite
database persists metadata, native Site/Costs documents, Undo/Redo and sessions; the clearly labelled development-only
OTP inbox simulates delivery without paid SMS. Native site-linked Solar/pvlib
forms and the air-density/PsychroLib utility are available under Analyze; full room-engine
integration remains pending.
Native Site includes Python rectangular feasibility, offline location-derived
time zones and drawn/resizable cuboid/tree surroundings, including across roads.
Analyze Costs exposes land rates per sq yd, construction rates per sq ft and
opt-in retained fee schedules with calculation bases. Utilization provides size/aspect curves and
whole/selected/best-sampled split diagrams. Native Layout 2D/3D and room-linked
analysis engines remain staged, rather than embedded legacy panels.
See [architecture and required Azure resources](ARCHITECTURE.md) for service
inventory, authority boundaries and the planned background-job flow.
See [billing and free allowances](BILLING.md) for minimal configuration cost
drivers and the distinction between recurring grants and new-account offers.

Open [`index.html`](index.html) with the accompanying scripts, stylesheets and
`vendor` folder. The basic browser application has no build or dependency-install step.
The 2D tools, local data imports and numerical scenarios can operate offline.

### React migration preview

Phase 8 includes a parallel Vite, React, and TypeScript application shell for
the six project destinations: Overview, Site / Plot Planner, Design,
Environment, Compare, and Report. It supports `?workspace=<destination>`
selection, preserves `?workspace=prohibited` as a migration-preview
compatibility destination, and provides responsive navigation plus a
project/floor toolbar placeholder. The Site destination now has a focused
typed Plot Planner boundary: it distinguishes unavailable inputs, legacy
handoffs, and future migrated controls without creating a second project
store or reimplementing regulatory calculations. In development it links to
the existing legacy Plot Planner. It does not host, replace, or migrate the
current planner; [`index.html`](index.html) and its existing scripts remain the
production application. The shell intentionally does not load planner data or
saved state. A guarded browser-only adapter is available at
[`src/domain/project/legacy-planner-api.ts`](src/domain/project/legacy-planner-api.ts)
for migrated surfaces hosted by the existing application. The React entrypoint
uses that adapter only when `window.HomePlanner` already exists and passes
validation, forwarding its authority-owned read-only views, commands, selection, history,
subscriptions, and observer diagnostics to the provider. When connected, the
Plot Planner boundary consumes the provider's authority-owned read-only project
view only for project name/id and revision provenance; the plot boundary remains
unavailable until a typed boundary contract exists. It does not derive geometry, setbacks, regulatory results,
or editable controls. With no legacy global, the standalone preview remains
unchanged. An incomplete global produces a
non-fatal integration diagnostic in the shell instead of creating a provider.
The entrypoint does not create a second project store or load legacy scripts
into the migration preview.

```powershell
npm install
npm run dev
```

The React preview requires Node.js `^20.19.0` or `>=22.12.0` because it uses
Vite 7.
The development command opens
`http://localhost:5173/migration-preview.html`. Use `npm run build` to type-check
and bundle the migration preview and new platform entrypoints. Use `npm run test:adapter` for
the TypeScript-aware legacy-adapter regression tests. The generated `dist` directory
is not part of the vanilla application's runtime.

Room airflow and light studies need HTTP/HTTPS and local Web Workers; they do not
fall back to blocking the editor with main-thread analysis. The optional 3D ES
modules also need HTTP/HTTPS and WebGL2. For a full local preview
on Windows with Python installed:

```powershell
py -3 -m http.server --bind 127.0.0.1 8000
```

Open `http://127.0.0.1:8000/`. Double-click 2D remains available when 3D is
unavailable. Browser location detection may also require HTTPS or localhost.

### Working Python density and solar calculations

Use the Flask application rather than the static server for these optional tools:
reuse the existing Python 3.11+ virtual environment, or create it once with
`py -m venv .venv` for a new checkout.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-analysis.txt
.\.venv\Scripts\python.exe -B app.py
```

At `http://127.0.0.1:8000/`, **Environment > Airflow** provides density from
weather or familiar temperature/pressure/RH inputs; **Sun Path** includes the
Python solar chart. **Get weather for this location** explicitly sends the
saved coordinates to Open-Meteo; nothing fetches on page load. See
[Python calculations](docs/python-analysis.md) for units, provenance and limits.
Keep a project JSON backup before changing origin or browser profile.

### Coupled thermal / CFD preparation

The same Flask service exposes **Environment > Thermal / CFD**. Preparing and
downloading a single-room case needs no virtualization or additional Python
package. Actual runs need the separately installed OpenCFD OpenFOAM v2606
runtime, explicit server opt-in and an available engine. See
[coupled CFD](docs/coupled-cfd.md) for geometry gates, supplied inputs, local job
controls and the outstanding numerical-verification boundary.

### Prohibited-property reports

To enable the **Prohibited Properties** workspace, run the Flask application
instead of the static HTTP server:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Open `http://127.0.0.1:8000/?workspace=prohibited`. The existing planning
workspaces are served from the same origin and retain their browser storage.
Choose **Connect local lookup** to load location options. Opening the route alone
does not contact the backend.
Tesseract must be installed with English and Telugu language data; the
application does not need a GPU or a cloud OCR account.

Reports are saved under `prohibited-properties\parsed` as district / mandal /
village / optional SRO / property type / category Markdown files. Subsequent
requests render those files, including after restarts, without calling the
portal or OCR. **Force refresh** explicitly fetches and parses again. Failed
refreshes leave the previous Markdown intact. There is no scheduled refresh
or change-detection process.

See [the prohibited-property guide](README-prohibited-properties.md) for the
API, Tesseract setup, cache layout, downloader and limitations.

## Keeping projects

The persistent **Projects & backups** menu provides opt-in IndexedDB autosave,
saved-project management and JSON backup/import. Floors, manual edits,
electrical points and environment data are retained together. Browser storage
is not a backup; keep exported JSON separately. File-origin storage varies by
browser, and changing the origin/profile can hide or remove local data.

Nothing detects location or fetches weather automatically. Device location is
requested only by its button; online weather requires a separate consent/action.
There is no cloud database, account or automatic project upload.
**Report → Drawings** exports architectural and conceptual structural sheets as
fixed-scale vector PDF/SVG or PNG, including structural schedule continuation
pages. Individual drawing preferences are browser-session state.
**Report → Document package** assembles the full conceptual set and a revision
manifest. Its **Save package settings** action records editable intentions in
the project; use the shared project save or JSON backup to retain them outside
the current session. It does not save a second editable drawing model.
Missing views, levels or current analysis remain explicitly unavailable; a
generated PDF is not proof of design completeness or construction approval.
See [coordinated packages](docs/coordinated-package.md) and
[the package workbench](docs/package-workbench.md).
**Design → Structure** edits grid, column, beam, slab and footing intent with
explicit dimensions/provenance, coordination findings and an opt-in layer in the
shared 3D view. These are not engineered member designs or structural approvals.
**Design → Elevations & sections** saves geographic elevations and finite section
cuts, with real floor/opening levels and physical facade-box authoring. Export
selected or all saved views through Report. Fit-to-screen preview zoom does not
change print scale; PNG offers 72/150 dpi and cancellation.
**Design → Plumbing** authors fixtures, explicit ports, cold/hot water and
soil/waste/vent routes. Plans, riser diagrams, schedules and the optional 3D
centerline layer use the same network. Connectivity and geometric lengths are
review aids, not hydraulic sizing or approved penetrations.

## Documentation

See the [documentation index](docs/README.md) for the regulatory basis, plot
geometry, room-planning model, design guidance, cost model, and known
limitations.

Development cases use Node's built-in runner: `node --test`.
The property API, Markdown cache and OCR cases run with
`.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_property*.py"`.

## Important

HomePlanner is a feasibility and comparison tool, not a building permission,
sanctioned drawing, structural design, fire-safety assessment, accessibility
review, certification, or legal opinion. Confirm current rules and site
requirements with TG-bPASS, GHMC/HMDA, and qualified professionals.

Environmental results are uncalibrated scenarios for the supplied inputs.
The optional single-room CFD integration is unvalidated and has not yet passed
real-engine execution. The application does not provide measured microclimate/tree
cooling, automatic weather/airflow-to-thermal coupling or calibrated whole-building
temperature predictions. Environment's original shadow snapshots evaluate one
scene at a time; Sun Path's explicit whole-house sunlight study includes the
modeled storeys together. Multiple editable floors do not establish structural
safety or permission to add storeys.
