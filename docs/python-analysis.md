# Local Python calculations

This optional first slice **actually executes PsychroLib and pvlib** through the
existing Flask service. It does not replace the vanilla UI, Three.js, SunCalc,
the project model, or the airflow solver. No extra engine, frontend dependency,
database or cloud solver is installed. Optional Open-Meteo weather retrieval is
user-invoked; no automatic weather/location request is involved.

## Run

Use the existing Python 3.11+ virtual environment, from the HomePlanner folder:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-analysis.txt
.\.venv\Scripts\python.exe -B app.py
```

The existing property-service `requirements.txt` is also required. Open
**http://127.0.0.1:8000/**, not `file://`, a different static server, or an older
running service. Restart the local process after installing/updating the
optional requirements. `HOMEPLANNER_PORT` can explicitly select another port.
The UI makes only same-origin requests on loopback hosts.

Optional libraries are imported lazily. Missing or incompatible packages do not
block property-report startup; an explicit calculation returns an unavailable
message with the install/restart command. There is no JavaScript or fake-success
fallback. Mounting, navigating, selecting weather and editing fields do not
request even a capability check.

Verified on Windows / Python **3.11.9**, Flask **3.1.3**:

| Distribution | Installed version |
| --- | --- |
| PsychroLib | 2.5.0 (pinned) |
| pvlib | 0.15.2 (pinned; no extras) |
| pandas | 3.0.5 |
| NumPy | 2.4.6 (existing installation, unchanged) |
| SciPy | 1.17.1 |
| h5py | 3.16.0 |
| tzdata | 2026.3 |
| pytz | 2026.3.post1 |

`pip check` passes alongside the existing OCR/property dependencies. pvlib
0.15.2 declares Python ≥3.10, NumPy ≥1.21.2, pandas ≥1.3.3 and SciPy ≥1.7.2.
The real calculation tests exercise the installed version combination, including
pandas 3 timezone-aware indices. This is not a claim about every possible
future transitive dependency combination.

## Use the cards

### Air density

1. Import/retain weather through the existing **Site** workflow. The new card
   reads the normalized `project.environment.weather`, without fetching or
   modifying it. Select a **weather record number**; its timestamp, temperature,
   absolute pressure and RH appear automatically. `0% RH` is a real supplied
   input; missing fields/quality flags are not converted to zero.
2. Alternatively choose **Manual temperature, pressure & RH**, supplying °C,
   **hPa absolute station pressure**, and RH %. Manual hPa is converted to Pa
   once. Sea-level-reduced meteorological pressure is not station pressure.
3. **Calculate & use density** runs PsychroLib and explicitly updates the current
   airflow scenario's `densityKgM3` and its source note. This does not run
   airflow, change geometry, save the project or create a new model.
   Use the airflow workbench's existing Run and scenario JSON export separately.

#### One-click weather for the saved location

**Get weather for this location — Open-Meteo** is an explicit alternative.
The adjacent disclosure displays the **current saved site coordinates** and
says that clicking sends them to Open-Meteo, then calculates/uses density.
This does **not** use the Sun Path's exploratory coordinates or unapplied Site
form text, and never invokes geolocation. Apply a different site first if needed.
Only coordinates and fixed public weather parameters go to the provider, not
project IDs, geometry, imported weather files, scenario notes or browser cookies.

The local endpoint requests exactly `temperature_2m`,
`relative_humidity_2m` and **`surface_pressure`**, Celsius, UNIX time and GMT.
Declared hPa is converted to absolute Pa once; `pressure_msl` is never
substituted. Missing values/units, stale provider timestamps and bad air states
fail visibly without a city constant or success-shaped fallback.
The real PsychroLib calculation runs after this explicit retrieval action.

The returned **current model sample** is not an on-site measurement or historical
weather. Its UTC valid time, retrieval time, returned grid coordinates and model
elevation (when provided) are displayed. `intervalSeconds` retains the provider's
update interval; it is **not** recast as an imported interval-end record's
`durationSeconds`. Temperature/RH are model values at 2 m above ground. A model
grid/elevation is not a surveyed house location.

The sample is retained only in this project's **session state**. Neither
`project.environment.weather` nor the imported EPW/JSON is replaced; imported
record selection and manual temperature/pressure/RH drafts remain available.
The **Fetched Open-Meteo sample (session only)** option reuses that sample through
the local density endpoint without another provider request. A saved-location
change requires another explicit lookup before using the retained sample.
Failed refreshes retain the previous sample and accepted airflow/manual inputs.

Retrieval shares density's project/site/scenario/controller/typing-generation
guards; an old response cannot replace a later edit or attach to another project.
Only successful, still-current retrieval **and** calculation updates the airflow
draft through `setDraft`. Nothing is autosaved or polled.
Open-Meteo data require CC BY 4.0 attribution; its free API is non-commercial
and subject to quotas and [provider terms](https://open-meteo.com/en/terms).

The API calls `SetUnitSystem(SI)`,
`GetHumRatioFromRelHum(temperatureC, rhPct / 100, pressurePa)`, and then
`GetMoistAirDensity(temperatureC, humidityRatio, pressurePa)`. It also checks the
library's water-vapour pressure against total absolute pressure.

The result is **a weather/scenario property estimate, not measured indoor
density**. Coordinates alone cannot determine it. PsychroLib's minimum humidity
ratio is **1e-7 kg water/kg dry air**, including at exactly 0% RH. The API
retains that library result and reports the floor; it does not claim an exactly
zero humidity-ratio round trip. No humidity transport, room temperature,
condensation, comfort or mold model is implemented.

### Python solar position & daily path

The card follows the current **Sun Path** latitude, longitude, IANA time zone,
civil date/time and repeated-time choice. These can be exploratory Sun Path
drafts; calculating does not apply them to the project. Existing SunCalc plots
are unchanged.

Weather mode uses the selected record's temperature/absolute pressure and
explicit `weather.source.elevationM` where available. A supplied site or adapter
`altitudeM`, or an explicit altitude override, takes precedence. All are **metres
above sea level**; `building.baseElevationM` is never used as atmospheric
altitude. A station/grid altitude is clearly not a surveyed house elevation.

Missing altitude/pressure/temperature requires either supplied values or the
explicit reference checkbox. Only missing fields receive the acknowledged
**0 m above sea level, 101325 Pa, 15 °C** values. Supplied values are not
overwritten. The response identifies precisely which fields were references.
The supplied/reference pressure and temperature remain constant along the path;
one weather record is not misrepresented as a full day's weather.

**Calculate Python sun path** calls:

```python
pvlib.solarposition.get_solarposition(
    time=timezone_aware_index,
    latitude=latitude, longitude=longitude,
    altitude=altitude_m, pressure=pressure_pa, temperature=temperature_c,
    method="nrel_numpy", delta_t=None, atmos_refract=0.5667,
)
```

The card renders actual returned samples in a labelled SVG:

- Azimuth: degrees clockwise from true north, N=0°, E=90°.
- Geometric elevation excludes refraction; apparent elevation includes the
  supplied/reference atmospheric correction. Both are reported separately.
- Negative elevations remain visible as night, not an unavailable or zero sun.
- Horizontal distance is **elapsed UTC time**, with local-time/offset ticks.
  Civil-day lengths of 23/25 hours are retained. The final sample is the next
  day's boundary, explicitly an endpoint, not an extra daylight interval.
- `delta_t=None` selects pvlib's year/month polynomial TT–UT1 estimate;
  `atmos_refract=0.5667°` is the disclosed sunrise/sunset refraction threshold.

The UI uses the existing `HomeSun.resolveLocal()` for civil clock resolution.
Skipped times fail and repeated times need earlier/later selection; the API
accepts only explicit-offset instants and independently checks their IANA date.
Python `zoneinfo` uses a configured system IANA database or the installed tzdata
package (needed on ordinary Windows installations). The package version is
included as provenance, not falsely identified as a system database version.

**Position only:** no building/terrain intersections, shadows, irradiance,
energy, PV yield, thermal or comfort calculation follows from this card.

## Shell integration hooks

The shell owns host placement and the script/style includes:

```html
<link rel="stylesheet" href="planner-python-analysis.css">
<!-- Airflow route: outside the workbench's renderer-owned subtree,
     or append after HomePlannerAirflowUI.mount() has finished. -->
<div id="python-density-analysis"></div>
<!-- Beside the existing Sun Path results -->
<div id="python-solar-analysis"></div>
<script defer src="planner-python-analysis.js"></script>
```

Load after the project bridge, `planner-airflow-ui.js` and its local foundation,
`environment-data.js`, `sun-model.js` / its vendored SunCalc, and the existing
Sun Path controls. No changes to `environment-ui.js` or `planner-airflow-ui.js`
are needed. Place hosts before this module's DOM-ready mount. A later-inserted
host can explicitly call `mount` instead of using the automatic mount.

```js
const analysis = HomePlannerPythonAnalysis.mount({
  densityHost: document.getElementById('python-density-analysis'),
  solarHost: document.getElementById('python-solar-analysis'),
  planner: HomePlanner,
  // Controller or a getter; never a project mutation callback.
  airflowController: () =>
    document.getElementById('workspaceAirflow')?.homePlannerAirflow,
  // Optional; defaults shown. Return the existing normalized dataset.
  getWeather: project => project.environment?.weather,
  // Optional; defaults to the named existing sun* controls, then saved site/
  // environment.sunSelection. May also include explicit altitudeM/instantUTC.
  getSolarInput: project =>
    HomePlannerPythonAnalysis.readSolarInput(document, project)
});
```

`mount()` defaults to both named hosts and automatically runs once on DOM ready.
An absent host is harmless; repeated mounting returns the same live controller
stored on `host.homePlannerPythonAnalysis`. A single card can be mounted by
providing only the relevant existing host. `dispose()` cancels jobs,
unsubscribes, removes its own cards/properties and allows remounting.

The controller API (also available without a DOM through `createController`):

- `getState()`, `subscribe(listener)`, `sync()`, `dispose()`.
- `setDensityInputs({mode, recordIndex, temperatureC, rhPct, pressureHpa, sourceNote})`.
- `calculateDensity({apply: true})` (default) or explicit `{apply:false}` for
  compute-only callers. Returns the accepted response or `null`; never rejects
  for ordinary input/service/cancellation failures.
- `getWeatherForLocation()` is the explicit retrieval-and-use action, connected
  to `hp-python-density-get-weather`. It sends only the current saved
  coordinates with `acknowledgeOpenMeteo:true`. No call is made by mounting,
  navigation, solar animation or ordinary Calculate. Density input modes are
  `weather` (imported), `manual`, and `current` (previously fetched session sample).
- `setSolarInputs({mode, recordIndex, altitudeM, temperatureC, pressureHpa,
  acknowledgeReferenceAtmosphere, sampleMinutes})`, `calculateSolar()`.
- `cancel('density'|'solar')`, `notifyDensityDraftInput()` for another native
  draft editor that commits only on blur/change.
- States: `unknown`, `pending`, `failed`, `unavailable`, `stale`, `cancelled`,
  `current`. Results are present only in the matching `current` state.

Buttons/statuses use `hp-python-density-calculate`, `hp-python-density-status`,
`hp-python-density-output`, and equivalent `hp-python-solar-*` IDs. All native
controls have associated labels; advanced input/provenance details start closed.
The chart scrolls internally on narrow screens.

### Ownership and freshness

All form values are session drafts separated by exact project ID. Calculations
capture project/site, selected weather content/quality/source evidence, relevant
inputs and a job token. Density also captures the exact airflow controller,
selected scenario and accepted draft. It applies only via
`airflowController.setDraft({densityKgM3, sources:{...}})`. Existing source notes
for other quantities remain intact.

Input/owner changes abort and revoke pending results, with a second content
check at completion; same IDs/revisions alone are not sufficient. Delegated
native `input` events under the stable `#hp-airflow-inputs` host veto pending
density **before** the existing form's `change` handler commits the draft.
This protects a user still typing into density or another scenario field.
Scenario changes, replacement controllers, Cancel and disposal cannot publish
an old response. A 20-second client deadline handles an unreachable/hung service.

Unrelated floor/presentation selections, project renames, unselected weather
records, wind filters and the other card's record selection do not revoke
matching evidence. Solar does not depend on weather RH. No new project schema,
history, worker or persistence implementation is introduced. Existing authored
project/Undo behavior is untouched; results/forms are not claimed to be saved.

## Local HTTP contracts

`python_analysis.py` has lazy optional imports, two local calculations and a
separate explicitly acknowledged fixed-provider retrieval. Flask retains its property routes, existing 16 KiB global cap,
trusted-loopback hosts, same-origin write checks, static-file whitelist and
response headers. Analysis POSTs add an **8 KiB** cap and reject cross-site
Fetch Metadata. At most **two calculation requests** execute concurrently;
excess requests return 429 instead of an unbounded queue.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/analysis/capabilities` | Explicit readiness/version query; each feature has `available`; overall ready/partial/unavailable. Not fetched at mount. |
| `POST /api/analysis/air-density` | `{temperatureC, rhPct, pressurePa, source?}`. |
| `POST /api/analysis/current-weather-density` | `{latitude, longitude, acknowledgeOpenMeteo:true}`. Fetch one current model sample and run real local PsychroLib. |
| `POST /api/analysis/solar-position` | `{latitude, longitude, timeZone, date, instantUTC, altitudeM?, pressurePa?, temperatureC?, acknowledgeReferenceAtmosphere?, sampleMinutes?, source?}`. |

`source` is an optional small object with `kind` (`manual`, `weather-record`,
`site`), `label`, `weatherId`, `recordTimestamp`, `durationSeconds`, `timeBasis`.
No request accepts a file path, code, command, model document or remote URL.
The original calculation endpoints perform no network requests.
Only `current-weather-density` may contact the fixed
`https://api.open-meteo.com/v1/forecast` URL, with redirects disabled and without
ambient netrc credentials, proxy configuration or cookies. It has 3.05 s connect
and 6 s read timeouts, a 10 s elapsed budget checked during body reading, and a
32 KiB uncompressed JSON response cap. No retries or background refreshes occur.
All endpoints perform no result/cache/file writes. Model valid time must be no
more than 3 h old or 1 h ahead of the service clock—an explicit adapter freshness
policy, not a claimed observation-accuracy bound.

Numerical limits:

- Density: **−100…200 °C**, **0…100% RH**, **1000…120000 Pa absolute**;
  total pressure must exceed water-vapour pressure.
- Solar: latitude **−90…90°**, longitude **−180…180°**, altitude
  **−500…9000 m**, **−100…100 °C**, **1000…120000 Pa**.
- Dates/instants **1900…2100**, one IANA civil day **20…26 h**,
  integral sample interval **5…60 minutes** (default 15), at most **313 path
  samples**. A clipped final interval is identified, not silently coarsened.
  Skipped/unsupported day boundaries fail rather than inventing a calendar day.

Success: `{status:"ok", kind, inputs, output, units, engine, assumptions}`.
Density output has `densityKgM3`, `humidityRatioKgKgDryAir`, `vapourPressurePa`,
`humidityRatioFloorApplied`. Solar output has `selected`, `path`, `day`;
positions carry UTC/offset-local timestamps, `azimuthDeg`,
`geometricElevationDeg`, `apparentElevationDeg`, `aboveHorizon`.
The retrieval endpoint returns the ordinary density result plus `weather`,
containing `requestedSite`, returned grid coordinates, `fetchedAtUTC`, the one
sample, canonical density-input units, timestamp meaning and provider provenance.
It does not return or author a replacement project/imported-weather document.

Failures have `error:{code,message,field?}` and correct non-success HTTP status:
400 invalid/unsupported inputs, 403 cross-origin, 413 size, 415 content type,
422 invalid numerical output, 429 busy, 503 optional dependency unavailable,
500 unexpected calculation failure. No internal traceback/file path is returned
to the client. Service errors do not produce success-shaped zero output.
Weather-specific failures additionally include 429 provider rate limit,
502 unavailable/invalid/stale provider response, and 504 provider timeout.

## Verification

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_python_analysis.py
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_property_api.py
node --test tests\planner-python-analysis.test.cjs tests\planner-airflow-ui.test.cjs tests\environment-data.test.cjs tests\sun-model.test.cjs
```

Real optional-engine tests skip only when the optional manifest is not installed.
Missing-dependency/startup/validation tests still run in that configuration.
Tests cover actual PsychroLib API calls, dry/humid/saturation cases, source/units,
pvlib noon/night, polar night, timezone gaps/repetitions, 23/25-hour days,
reference acknowledgement, same-origin/size failures and error redaction.
Node tests use the real airflow public controller with a bounded mock transport,
covering tokens, scenario/project/draft changes and no unsolicited requests.
Weather tests mock the provider, asserting the exact fixed URL/parameters,
consent, unit conversion, 0% RH, returned elevation, failure redaction and
preservation. They still execute the installed PsychroLib. No test sends the
user's saved coordinates or private project data to Open-Meteo.

`tests\python-analysis-browser.cjs` exercises **real HTTP responses and rendered
cards** in a disposable Edge context with synthetic normalized weather. It does
not load/clear a live user project. Run an independent local service, set
`HOMEPLANNER_ANALYSIS_URL` (default `http://127.0.0.1:8018`) and
`PLAYWRIGHT_MODULE` to an already installed `playwright-core` path, then run
`node tests\python-analysis-browser.cjs`. `HOMEPLANNER_BROWSER` can identify
another installed Chromium executable. No browser/test package install is needed.

Verified synthetic browser examples:

- 25 °C, 0% RH, 95000 Pa → **1.110051985167255 kg/m³**.
- 30 °C, 80% RH, 95000 Pa → **1.0769855387186518 kg/m³**.
- Midnight/daytime solar, 23/25-hour dates, explicit reference checkbox,
  stale native/controller edits, mobile containment, offline/static-service
  guidance and zero unhandled browser errors.
- One-click retrieval UI with a **mocked provider response** and the real local
  PsychroLib endpoint, including saved-versus-Sun-Path coordinates, failure
  retention, imported-data preservation and disclosure.

These are implementation/property checks, not measured building performance,
validated CFD, engineering design or regulatory approval.

## Verified library sources

Checked 17 September 2026, using Context7 and the official documentation:

- [PsychroLib API](https://psychrometrics.github.io/psychrolib/api_docs.html):
  SI, RH fractions, absolute Pa, humidity-ratio floor, moist-air density.
- [pvlib get_solarposition](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.get_solarposition.html):
  explicit atmospheric inputs and angle columns.
- [pvlib spa_python](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.spa_python.html):
  `nrel_numpy`, delta-T and refraction controls.
- [pvlib 0.15.2 metadata](https://pypi.org/pypi/pvlib/0.15.2/json):
  actual release prerequisites, distinct from optional extras/engines.
- [Open-Meteo Forecast/current API](https://open-meteo.com/en/docs) and
  [current-variable definitions](https://open-meteo.com/en/docs/dwd-api):
  current model data, WGS84 coordinates, `current` variables, UNIX/GMT time,
  2 m temperature/RH, surface pressure in hPa and returned elevation. Current
  conditions are based on 15-minute model data (interpolated where applicable),
  not automatically measured weather at the selected house.
