# Native Solar: bounded site charts, not whole-house parity

**Follow-up:** actual imported Design geometry is now connected to the separate
[native house direct-sun hours section](native-house-sun.md). Its existing
client-side geometry kernel, explicit project/account source selector and
cumulative time slider restore house-hours display. The site-only inventory
below documents the original Python chart work; geometry-dependent irradiance
remains pending and full Solar parity is still not claimed.

The React Solar tab now explicitly calculates astronomical/seasonal charts for
the **applied native Site**. Python owns numerical outputs through the existing
pvlib NREL SPA adapter. It neither reads nor replaces a legacy house with a
native envelope, sample layout or repeated permitted-storey model.

## Legacy inventory and restored site displays

Inventory was checked against `docs/sun-path.md`, `sun-model.js` (`referencePaths`,
`hourlyPaths`, `annualSamples`, `daylightSegments`, `daySummary`, `shadowLengthM`)
and the actual `sun-planner.js` `drawDaily`/`drawAnnual` displays.

| Legacy capability | Native implementation / difference |
| --- | --- |
| Selected position, azimuth/elevation/zenith | Apparent and geometric elevation, true-north azimuth and apparent zenith readout (90 minus elevation) |
| Equidistant sky diagram | True north up, 10-degree elevation rings / 15-degree azimuth spokes, selected daily path and position |
| Monthly and seasonal daily paths | 21st of all 12 months plus March 20 / September 22, 5-minute UTC sampling, solstice hemisphere legend, fixed reference dates not calculated astronomical event dates |
| Hourly civil-clock guides | All 24 local clock hours, one resolved point per calendar date; independently hideable |
| Selected-time yearly curve | 365/366 dates, apparent/geometric annual elevation chart and amber sky curve; skipped clocks unknown and offset jumps disconnected |
| Reference-date intersections and sampled extrema | Reference dots, daily min/max sky marks and times; no above-horizon extrema in polar night |
| Monthly 09/12/15 comparisons | Explicit date/time/UTC/azimuth/apparent-elevation table |
| Day summary and light phases | SPA sunrise/noon/sunset and UTC elapsed daylight; retained -6/-12/-18/+6-degree twilight/golden boundaries solved using SPA geometric elevation |
| 1 ft pole estimate | Explicit 0.3048 m button, arbitrary supplied metre height, length in m and ft, opposite true-north bearing and daily shadow chart |
| CSV | Explicit annual same-clock download including unavailable rows, site/UTC/offset/angle definitions, engine and workspace identity |
| Actual house neighbour-blocked direct sun | Restored in the separate [actual Design house study](native-house-sun.md); incumbent client-side geometry kernel, not this Python position response |
| Geometry/obstacle/weather irradiance | **Pending native integration**; still requires actual geometry and explicit interval-matched DNI/DHI/GHI; not inferred from these charts |

These are display/series semantics reused from HomeSun, **not a claim of
numerical equivalence to SunCalc 2.0.1**. Native position and event calculations
use the identified pvlib engine. SPA sunrise/sunset use its standard -0.8333°
geometric solar-centre horizon and do not vary with supplied pressure/temperature.
Phase boundaries use SPA geometric-centre -6/-12/-18/+6° crossings, bracketed at
5 minutes within ±18 hours of the nearest local-noon transit, solved with SciPy
[`brentq`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.brentq.html)
to 0.1 UTC second. Non-convergence fails explicitly rather than inventing an
event; no crossing stays null. Golden boundaries are not
guaranteed hour-long lighting or weather predictions.

The sky diagram has its own uncapped aspect-ratio sizing, with notes alongside
on wide screens. Narrow screens scroll a readable 730-pixel diagram rather
than shrinking its labels. Daily/annual charts have bounded widths instead of
full-width empty frames. **Explore time of day** scrubs the calculated UTC
samples, updating position readouts, day/sky markers and the matching pole shadow.
It preserves local UTC offsets across DST and does not rerun calculations or
change daily totals and the annual curve's original same-clock input.

Daylight is UTC sunrise-to-sunset duration for the solar cycle nearest resolved
local noon, not wall-clock subtraction, civil-day duration or shaded sunlight.
Both missing SPA crossings are classified as polar day/night only when all
selected-day geometric samples lie above/below its horizon threshold; otherwise
the duration remains unavailable. Polar day has **no invented 24 h duration**.
Events show full local dates and offsets, including crossings outside the
selected civil date. Civil paths retain actual 23/25-hour durations and clipped
last intervals. Repeated annual clocks use the explicitly requested occurrence,
or the explicitly labelled earlier occurrence if the selected instant did not
require a choice. Skipped annual clocks remain gaps.

Pole shadows use apparent elevation and `height/tan(elevation)` on level ground.
Unknown height remains unknown; night/horizon has no finite positive daytime
shadow. A visible default 1° cutoff omits near-horizon estimates rather than
clipping long shadows. Setting 0° retains finite positive-horizon lengths.
Zenith yields zero. Omitted samples never mean zero shade.

## Explicit bounded API and session drafts

An untouched Solar clock initializes to the current date and time in the applied
Site IANA zone once it is available. Existing session drafts are retained;
clearing or changing a field does not continually reset it. **Use current date
and time** explicitly refreshes the clock without starting a calculation.

The existing authenticated `/workspace/solar` route and scope
`site-solar-position-not-shading` remain unchanged. It still accepts only the
applied workspace site, validates the expected version and rechecks it after
calculation; failures/stale completions do not attach results or write projects.

`SolarInput` adds optional `pole_height_m` (unknown by default; positive, at most
1000 m) and `low_sun_cutoff_deg` (default 1°, permitted 0–10°). The existing
`SolarDraft` fields remain compatible; added fields are optional strings and
`normalizeSolarDraft` restores only missing study defaults, without replacing
manual values or authoring workspace commands. `solarInputs` normalizes old
session drafts. Parent cache users may also call the exported normalizer.

The base result remains compatible; `output.charts` adds schemaVersion 1,
14 references, 24 hourly curves, selected annual curve, 12 monthly comparisons,
extrema, event summary, pole array and explicit `geometry.status: legacy-only`.
Inputs include clock/occurrence/pole/cutoff provenance. The client validates
calendar counts, position units/timestamps, event durations and pole equations.
Legacy base-only response fixtures remain readable but cannot claim chart parity.

At most 14000 seasonal positions are calculated in one vectorized SPA batch.
The selected day remains 5–60 minute sampling; seasonal reference paths stay at
5 minutes. Event solving uses 433 bracket positions, at most 20 iterations per
crossing and a 20-second **cooperative** calculation budget. Checks occur between
bounded stages/solver calls; this is not process-level cancellation of an
in-flight NumPy call. A normal response is around 3–4 MB uncompressed, bounded
by fixed date counts. No weather fetch, geolocation, analysis on navigation or
persistent browser/project mutation occurs. Generation/project/version/draft
guards and explicit clear-result cancellation are retained.

## Actual house integration and remaining irradiance handoff

`sun-exposure.js` uses the actual `HomePlanner.getScenes()` and `prepareScenes`
site transform; its neighbour screens, area-weighted direct-beam-equivalent
hours, low-sun exclusions, save/fingerprint behavior and current legacy house
studies remain available in **Environment → Sun Path & shading**. They have
not been transplanted onto invented native geometry. The two project snapshots
are not silently synchronized. The separate `HouseSunStudy` now receives the
actual mounted Design `PlannerApi`, connects actual modeled storeys,
offsets/headings and openings/opaque surfaces, and supplies explicit neighbour
drafts to this same existing kernel. Its location source is explicit, with
Design Site as default and account Site only as a selected override. Interval
weather/irradiance integration remains pending.
Astronomical site charts alone do **not** complete the Solar migration.

## Targeted validation

```powershell
.\.venv-platform\Scripts\python.exe -B -m unittest discover -s tests -p test_platform_solar.py
npx tsx --tsconfig tsconfig.app.json --test tests\platform-solar.test.tsx tests\platform-native-api.test.ts
npx tsc -p tsconfig.app.json --noEmit
node --test tests\sun-model.test.cjs tests\sun-planner.test.cjs
```

Tests calculate real pvlib series, verify phase-angle crossings, DST/polar/leap
and quarter-hour zones, level-ground pole equations, chart markup, old drafts,
unknown/skipped inputs, bounded evidence and stale owner/version failures.
API tests use isolated in-memory SQLite and TestClient, not live services or
user browser data. They establish equation/contract behavior, not surveyed-site,
weather, SunCalc numerical equivalence or engineering certification.
