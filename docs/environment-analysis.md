# Environment workspace

This is a local-first **analytical workbench**, not an actual-site temperature,
comfort, energy-code, structural or CFD assessment. It uses the shared physical
scene and the separately implemented `BuildingPhysics` numerical APIs. Missing
weather and physical inputs remain missing; no compass score becomes degrees
Celsius, ACH or occupant airspeed.

## Integration

Mount `#environmentWorkspace` in the Environment app page. Load
`environment-ui.css` and, in dependency order:

1. The locally vendored SunCalc bundle and `sun-model.js` (`HomeSun`).
2. `planner-model.js`, the existing app startup, and `planner-bridge.js`
   (`HomePlanner`).
3. `planner-location.js` (`HomePlannerLocation.detect`).
4. `building-physics.js` and `environment-data.js`.
5. `environment-ui.js`.

The coordinator owns actual HTML/script placement. No package manager, build
system, runtime CDN, account or backend is needed.

`EnvironmentUI.mount(element?, planner?)` initializes once, renders immediately,
then subscribes to changes. Defaults are `#environmentWorkspace` and
`window.HomePlanner`. Its return value has `render()` and `destroy()`. The browser
entry point mounts automatically after DOM readiness. CommonJS import exposes the
API without touching the DOM. Existing inspector focus and unsaved form values
are not replaced during unrelated project notifications.

Geometry edits use **only** coordinator commands: `update-site`,
`update-building`, `update-floor`, `set-obstacles`, and previewed `add-window`.
Scenario/weather persistence uses `set-environment`. `getScene()` supplies the
editable floor; `getScenes()` supplies all-floor drawing/analysis snapshots.
The UI neither mutates project snapshots nor keeps another editable layout.

### State owned inside `project.environment`

| Key | Meaning |
| --- | --- |
| `schemaVersion` | Environment state format, currently `1`. |
| `siteProvenance` | Manual/device entry, coordinates, device accuracy/time when available, explicit building-site confirmation. |
| `buildingAssumptions` | User-reviewed preview dimensions and acknowledgement, not surveyed geometry. |
| `weather` | Normalized selected weather variables, source/header/request metadata, coverage, units and warnings; `null` after Clear. |
| `solar` | Independent calendar/time/DST selection, active/all-floor scope, geometry/manual/weather radiation mode. |
| `materials` | Explicit opaque layers, inside/outside film resistances and comparison thickness. |
| `glazing` | Separate whole-window U, SHGC, VLT and source. |
| `wind` | Imported/hypothetical wind, filtering, calm threshold and proposed window dimensions. |
| `pressure`, `thermal` | Scene-linked input JSON, source/operation notes, geometry signature and acknowledgement. Unevaluated drafts may contain required `null` values. |
| `results` | Versioned, time-stamped inputs/outputs, source evidence and the geometry snapshot used for each calculation. |

Other environment keys, including the standalone SunCalc tab's selection, are
preserved. Source weather records survive project JSON export/import and the
storage module's opt-in local saves. There is **no independent autosave or cloud
storage** in this slice. Typing alone is a draft: use the relevant Save/Evaluate
control. The reduced-model panels have explicit **Save unevaluated draft**
buttons. Files retain the selected normalized variables and EPW header/source-time
metadata; an EPW's other unused fields are not an archival copy of its entire
original 35-column body. Keep the original file for an expert solver.

## Site and geometry

Default Hyderabad coordinates are labelled **EXAMPLE**, not detected location.
Manual latitude, longitude and IANA time zone are always available.
**Detect current location** calls `HomePlannerLocation.detect()` only in its click
handler. It saves returned coordinates with `update-site`, shows reported accuracy,
does not infer a time zone or reverse-geocode, and does not assert that the device
is at the building. Manual edits/project changes invalidate pending detection.
Permission/timeout errors remain visible without erasing prior coordinates.

Wall height, floor-to-floor height, building base elevation and roof/slab thickness
are explicitly assumed preview dimensions. Obstacles are active-floor, local
rectangles with x/y/width/depth, height, absolute base elevation and beam
transmittance. The coordinator owns per-floor synchronization.

Tree rectangles are simplified canopy/obstruction assumptions. They are not
species, growth, roots, humidity, evapotranspiration or guaranteed-cooling models.
Structural/fire/egress/survey review remains necessary.

## Pure weather API

Browser namespace: `window.EnvironmentData`. CommonJS:

```js
const {parseEPW, parseWeatherJSON, fromOpenMeteo, windRose} =
  require('./environment-data.js');
```

The four contract functions are pure. `InputError`, `UNITS` and
`PROVIDER_FIELDS` are also exposed. All parsers return:

```js
{
  id, kind, source, latitude, longitude, timeZoneOffsetHours,
  records, warnings, coverage, units, timestampMeaning
}
```

`timeZoneOffsetHours` is optional for normalized JSON. Unknown coordinates are
`null` with warnings; a weather grid/station never silently becomes the project
site. Supported kinds are `unclassified`, `historical`, `reanalysis`, `tmy`,
`forecast` and `scenario`. Classification is user-confirmed unless identified by
file metadata or an explicitly known provider request.

### Canonical record and clock convention

```json
{
  "timestamp": "2024-01-01T01:00:00.000Z",
  "durationSeconds": 3600,
  "temperatureC": null,
  "rhPct": null,
  "pressurePa": null,
  "dniWm2": null,
  "dhiWm2": null,
  "ghiWm2": null,
  "windSpeedMps": null,
  "windFromDeg": null,
  "missing": [
    "temperatureC", "rhPct", "pressurePa", "dniWm2",
    "dhiWm2", "ghiWm2", "windSpeedMps", "windFromDeg"
  ]
}
```

This example is a **format example with no weather values**, not a site record.

**`timestamp` is the UTC interval end.** Radiation is mean W/m² over the preceding
`durationSeconds`; its interval start is `timestamp − durationSeconds`. Source
metadata distinguishes temperature/wind sampling from radiation averaging.
An explicit UTC or offset suffix is mandatory in normalized JSON. Invalid dates
such as February 30, hour 24 in ISO strings, unzoned local timestamps, and missing,
zero or invalid durations are not silently normalized.

Optional `sourceTime` retains EPW's original year/month/day/hour/minute.
`requestedOverlapSeconds`, when present, describes the portion of the unchanged
source interval overlapping an online request's local-date window.

### EPW

- Reads all eight named headers, including LOCATION, comments and DATA PERIODS.
  Preserves station/city/country/source, elevation, fixed UTC offset, header values
  and records per hour. Quoted commas and CRLF/LF are supported.
- EPW hour **1–24** and minute **60** identify interval ends. For example,
  `2024,2,29,1,60` at UTC+5:30 becomes `2024-02-28T19:30:00Z`, ending the
  preceding hour; hour 24 ends at the following local midnight.
- Sub-hour files must declare a records-per-hour count dividing 60. Minute
  values must match that grid. For a 30-minute interval, 300 Wh/m² becomes
  **600 W/m²**, not 300 W/m².
- Uses local **standard** time with the LOCATION fixed offset, not IANA DST.
- Recognized TMY/IWEC metadata establishes `tmy`; otherwise classification is
  unconfirmed. Source years remain untouched. Month-years in a typical-year file
  are not relabelled as a real chronological history or automatically mapped to
  the solar control's year.
- Malformed dates/short rows are skipped with counts; unusable headers/no valid
  intervals throw. Duplicate timestamps keep the first record with a warning.
  Nonchronological order, gaps, overlaps and partial-year coverage are visible.

### Normalized JSON

`parseWeatherJSON(text)` accepts an object with a `records` array, a bare canonical
record array (with missing-metadata warnings), or an Open-Meteo hourly response.
A units object is strongly recommended:

```json
{
  "kind": "scenario",
  "source": {"label": "Replace with source and condition", "license": "Verify rights"},
  "latitude": null,
  "longitude": null,
  "units": {
    "temperatureC": "C", "rhPct": "%", "pressurePa": "Pa",
    "dniWm2": "W/m2", "dhiWm2": "W/m2", "ghiWm2": "W/m2",
    "windSpeedMps": "m/s", "windFromDeg": "deg"
  },
  "records": []
}
```

Add valid records before importing; an empty array is rejected. Missing units
use the canonical field-name units with a warning. Explicit K, hPa, Wh/m²,
km/h, knots and mph are converted where appropriate. Unknown declared units are
not guessed. JSON numeric strings, nulls and nonfinite values are not measurements.
Explicit `missing` flags are respected even when a numeric value is also present;
malformed quality arrays are not silently ignored.

### Range and missing-data policy

These deliberately broad terrestrial screening bounds are validation limits,
not climate normals or recommended operating ranges:

| Field | Accepted normalized range | EPW missing sentinel |
| --- | --- | --- |
| Temperature | −100 to +70 °C | 99.9 |
| Relative humidity | 0–100 % | 999 |
| Pressure | 10,000–120,000 Pa | 999999 |
| DNI | 0–1600 W/m² | 9999 Wh/m² |
| DHI | 0–1500 W/m² | 9999 Wh/m² |
| GHI | 0–2000 W/m² | 9999 Wh/m² |
| Wind speed | 0–150 m/s | 999 |
| Wind FROM | 0–360°, with 360 normalized to 0 | 999 |

Sentinels are tested before unit conversion. Out-of-range, absent and invalid
values become `null` plus a field name in `missing`; nothing fills them with zero.
Warnings aggregate missing-field counts. Duplicate timestamps are not
double-weighted in a rose. The parser limit is 200,000 records and the UI import
limit is 20 MiB; project validation/storage may impose a smaller effective limit.
Long records should be split, and local storage failures must be handled by the
storage module rather than ignored.

### Open-Meteo adapter and opt-in request

The known archive request specifies **ERA5**, `timezone=UTC`,
`timeformat=unixtime`, `wind_speed_unit=ms`, and these hourly variables:

| Provider field | Normalized field |
| --- | --- |
| `temperature_2m` | `temperatureC` |
| `relative_humidity_2m` | `rhPct` |
| `surface_pressure` | `pressurePa` (hPa × 100, not sea-level pressure) |
| `direct_normal_irradiance` | `dniWm2` |
| `diffuse_radiation` | `dhiWm2` |
| `shortwave_radiation` | `ghiWm2` |
| `wind_speed_10m` | `windSpeedMps` |
| `wind_direction_10m` | `windFromDeg` |

Provider unit metadata is checked. Absent units, non-array variables, unequal
array lengths, nulls and ambiguous timestamps produce missing records/warnings
or an explicit error, never guessed alignment. Unix seconds are UTC regardless
of returned offset metadata. Naive ISO strings are accepted only when the response
explicitly establishes UTC/GMT. A raw response alone does not prove its model or
historical/forecast classification; a known archive request adds that evidence.

Temperature, humidity, pressure and wind are instantaneous model fields;
radiation is a **preceding-hour mean**, not the `_instant` variant. ERA5/model
wind at 10 m is not measured façade or occupant wind.

The online form:

- Requires a visible, specific consent checkbox and an explicit **Fetch** action.
  Consent is not persisted as general permission.
- Derives UTC bounds from inclusive **site-local dates** via `HomeSun.resolveLocal`,
  including half/quarter-hour zones and 23/25-hour DST days. Midnight gaps or
  ambiguities are errors, not guessed offsets.
- Requests the covering UTC dates, then selects overlapping source intervals.
  Boundary-hour durations are preserved with explicit overlap seconds; do not
  sum full boundary hours as exact local-day energy.
- Limits requests to 1–366 local dates and leaves at least six days for archive
  publication. There is no forecast substituted for unavailable history.
- Sends only coordinates, dates and provider parameters, with omitted credentials
  and referrer. Never sends the plan, materials, occupancy or imported documents.
- Does not fetch on site/date/slider edits, retry automatically or embed API keys.
  Edits, project changes, a new import/Clear or Cancel invalidate pending requests.
  A 45-second timeout, network/CORS failures, invalid responses and quota errors
  preserve previously loaded data. Late results cannot overwrite newer state.
- Retains requested and returned grid coordinates, model, units, transformations,
  retrieval time, provider terms and attribution. Imported data remain usable
  without a network.

Open-Meteo's free API is non-commercial, quota-limited and subject to its separate
terms; its weather data use CC BY 4.0 attribution. A public website is not proof
of free-service eligibility. Coordinates may appear in provider logs. No real
site coordinates were sent during implementation/testing.

## Wind rose and window proposals

`windRose(records, options?)` always returns sixteen 22.5° **FROM** bins:

```js
{
  bins: [{directionDeg, count, meanSpeedMps}, /* 16 */],
  calmCount, missingCount, total, excludedCount, unknownTimeCount,
  calmThresholdMps, directionConvention, frequencyBasis, timeBasis,
  daytimeDefinition
}
```

Empty-bin means are `null`. Defaults: calm below 0.5 m/s (zero is always calm),
all months/hours, fixed UTC for filtering. Calm can have missing direction without
becoming a fictitious north wind. Opposing modes remain separate.

Options:

```js
{
  calmThresholdMps: 0.5,
  months: [6, 7, 8],            // [] = all
  daytime: "day",              // "all", "day", "night"
  dayStartHour: 6,
  dayEndHour: 18,              // exclusive; a crossing-midnight window is allowed
  timeZone: "Asia/Kolkata"     // OR timeZoneOffsetHours, never both
}
```

Filters use the UTC **sample timestamp**, not a guessed source year or browser
time zone. “Daytime” is a user-defined clock window, not astronomical daylight.
Records whose filter time cannot be determined are reported separately as missing.
Counts are **record frequency**, not duration weighting; mixed-duration files
carry a warning. The UI includes calendar-season presets without assuming a
particular hemisphere's hot season.

Window proposals use only actual eligible exterior walls, available spans,
wall height, room association and scene heading. Outward normals are transformed
once to ENU. They preserve the top two populated wind sectors separately or use
one explicit hypothetical bearing; no cancelled annual mean is substituted.

Paths traverse actual internal portals with positive operating area to an
opposite-facing operating exterior opening. Closed internal doors or closed
glazing break these schematic paths. Service/contaminant routes are not promoted
as clean ventilation routes. An absent outlet path is explained, not disguised
by extra inlet glazing.

Preview shows the wall ID and exact `add-window` command, proposed dimensions and
tradeoffs. Apply issues that one validated command, never an update to an existing
manual opening. Geometry/input changes invalidate previews. Review structural,
rain, solar, fire, security, pollution, noise, privacy and fall-protection issues.
Only the coordinator supplies undo and actual editable-opening persistence.

No schematic arrow/normal/path is called a pressure result, ACH estimate, CFD
field or occupant airspeed. Free area is distinct from discharge coefficient.

## Solar, materials and reduced models

- Solar selection uses the existing local SunCalc/HomeSun model, not a second
  astronomy implementation. IANA clock ambiguity/gap errors are surfaced.
- `shadowAt(scene, sunENU)` supplies computed ground polygons and per-receiver
  sunlit fractions. The drawing distinguishes computed geometry, assumptions and
  the separately styled unapplied-window preview.
- `surfaceExposure(scene, sunENU, radiation)` runs only with complete explicit
  DNI/DHI/GHI/albedo or an exact matching imported interval. Interior/unavailable
  receiver irradiance stays unevaluated; its beam fraction can still be displayed.
  The solver's low-sun, glazing-transmission, sampling and isotropic-sky warnings
  are displayed, not suppressed.
- **Monthly 09/12/15** samples the 21st of twelve months at three local times.
  These are 36 snapshots per selected floor, not integrated annual direct-sun
  hours, seasonal energy or a weather history. Date/time edits cancel stale work.
- All-floor mode evaluates individual scenes at their actual elevations.
  **Mutual storey shading is not supported by this contract** and is labelled so;
  roof/overhang/terrain detail is not invented.
- Opaque comparisons call `assemblyProperties(layers, films)` with explicit
  thickness, k, density, specific heat, labels and source/condition. Same U is not
  equal peak delay, cooling, nighttime release or dynamic retention.
- The dense clay face-brick example uses EnergyPlus 24.2's named
  **A2 – 4 IN DENSE FACE BRICK** values. The AAC reference uses BEE ENS 2024,
  including **1.24 kJ/kg K → 1240 J/kg K**. Thickness/films are labelled assumptions.
  These are not universal local product properties.
- The Lyon rammed-earth preset identifies Losini et al.'s specific material, but
  leaves missing k/density/c values unresolved. Generic “mud”, adobe, rammed earth,
  stabilized blocks and roof mud-phuska are not interchangeable.
- Whole-window U, SHGC and VLT are separate product inputs. A displayed
  area × incident irradiance × constant SHGC comparison is a simplified glazing
  solar-gain screen, not angular optics, frame modelling or daylight lux.

### Pressure experiment

The current scene provides room-volume estimates and actual opening identities.
Density, Cd and signed imposed wind/stack pressure are **required user inputs**.
Each link's editable free area cannot exceed its current geometric operating
area; closed glass does not become a ventilation aperture. The user must review
mapping, volumes, sources and operating state. No Cp, wind-height correction,
leakage or arbitrary pressure is inferred from the wind rose.

Only then does the UI call `solveAirflow(input)`. Solver errors and
`converged: false` are explicit failures/limitations; numerical convergence is not
site validation. Sealed/dead-end warnings are retained. No automatic thermal
coupling, turbulent single-sided exchange or two-way large-opening physics is
claimed.

### Thermal experiment

`simulateThermal(input)` requires user-supplied effective capacity, initial
temperature, outside/inter-zone conductance, interval duration/outdoor temperature
and explicit net gains for every zone, including explicit zeros. Source/operation
notes and an **uncalibrated experimental-assumption acknowledgement** are required.
Geometry changes require review again.

Output is labelled **hypothetical sensible RC state temperature**, never actual
site temperature, comfort or health guidance. No hidden material-to-room capacity,
HVAC/occupancy schedule, infiltration, weather substitution, moisture, radiation
balance, calibrated warmup or airflow coupling is supplied. Full numerical
samples and energy residual are retained; the UI limits long tables to 240 rows.
The numerical agent's own conservation/reference tests define its mathematical
evidence; this UI does not inherit EnergyPlus/CONTAM/BESTEST validation.

## Local expert export

**Export analysis inputs & results** creates a browser-local Blob with schema
`homeplanner.environment-analysis`, version `1`. It includes all floor scenes,
coordinate convention, site/building data, explicit environment inputs, source
weather/provenance, results, their original geometry snapshots and mismatch flags
against current saved geometry/inputs. Independent monthly comparison inputs are
identified snapshots, not live slider-driven outputs. Draft DOM edits are not
silently treated as saved/calculated inputs.

`externalSolverExecuted` is always `false`. This is an expert handoff record,
**not** an EnergyPlus IDF, CFD mesh, IFC model or proof of external simulation.
Normalized weather also has its own local export.

## Validation and source references

Run the existing Node built-in runner:

```powershell
node --test tests\environment-data.test.cjs
node --check environment-ui.js
```

Tests cover browser/CommonJS API parity, EPW headers/end intervals/sub-hour
normalization/sentinels, leap dates, invalid/duplicate/gapped coverage, explicit
JSON units/quality flags, provider array/unit/time failures, circular and bimodal
roses, calm/missing/filter states, UTC/DST request bounds, partial boundary hours,
real-wall/operating-path proposals, rotation, manual-opening preservation,
complete-input gates and source-specific presets.

Browser contract-fixture checks use synthetic coordinates/records, the actual
local model/physics/SunCalc modules, a coordinator-compatible command façade and
intercepted provider/geolocation responses. They exercise real controls, import,
source escaping, exposure, material comparison, preview/Apply, assumption gates,
pressure/thermal output, rate limits, cancellation, local export and no automatic
location/network calls. Final full-app coordinator/persistence integration is a
separate owner responsibility; no live provider or real-device location was used
to claim site accuracy.

Reference material (reviewed 2026-09-08):

- [EnergyPlus EPW data dictionary, 24.2](https://bigladdersoftware.com/epx/docs/24-2/auxiliary-programs/energyplus-weather-file-epw-data-dictionary.html)
- [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api),
  [terms](https://open-meteo.com/en/terms), and [licence](https://open-meteo.com/en/licence)
- [ERA5 hourly single levels DOI](https://doi.org/10.24381/cds.adbb2d47)
- [EnergyPlus material definition/example, 24.2](https://bigladdersoftware.com/epx/docs/24-2/input-output-reference/group-surface-construction-elements.html#material)
- [BEE Eco-Niwas Samhita 2024](https://beeindia.gov.in/WriteReadData/RTF1984/1772175926.pdf)
- [Losini et al., source-specific rammed-earth characterization](https://hal.science/hal-04301821)
- [ECMWF meteorological wind direction convention](https://confluence.ecmwf.int/spaces/CKB/pages/133262398/ERA5+How+to+calculate+wind+speed+and+wind+direction+from+u+and+v+components+of+the+wind)
- [EnergyPlus AirflowNetwork engineering reference, 25.1](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/airflownetwork-model.html)
- [NIST CONTAM](https://www.nist.gov/services-resources/software/contam)

Weather-file redistribution rights are not granted by the EPW format. No weather
archive, restricted SPA source, user reference documents or private coordinates
were bundled or uploaded by this implementation.
