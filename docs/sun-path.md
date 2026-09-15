# Sun path

The **Sun Path** tab reuses the locally bundled **SunCalc 2.0.1** script. It does
not implement astronomical algorithms, fetch weather or require an API key.
Location detection runs only when **Detect current location** is clicked.
Open `index.html` with the accompanying scripts and `vendor` folder,
including when offline.

## Location and clock

The initial coordinates are an explicitly labelled Hyderabad example. Enter the
actual site latitude (north positive) and longitude (east positive), plus its
IANA time zone. The selected local date/time is resolved to a UTC instant rather
than using the computer's timezone or an assumed longitude-based offset.

The optional location button requests browser permission and reports the device's
latitude, longitude and accuracy. It does not prove the device is at the planned
site, change the timezone, or reverse-geocode an address. Permission denial,
timeout and unsupported/insecure origins leave manual input usable. Coordinates
edited while a request is pending are preserved. HTTPS or localhost may be
required by the browser for this optional capability.
Project replacement, restoration or floor-context changes invalidate a pending
request. A late result cannot overwrite a newly opened project, even if its
coordinate strings happen to match the previous project.

Clock times skipped by daylight-saving/calendar changes are rejected. Repeated
times require an earlier/later selection. The annual plot labels repeated-time
handling and leaves skipped times as gaps, never invented positions.

## Readings and plots

- Azimuth is degrees clockwise from geographic north: N=0, E=90, S=180, W=270.
- Elevation is SunCalc's apparent/refraction-corrected altitude above the horizon.
- Apparent zenith is `90 - elevation`; a negative elevation is below the horizon.
- The sky diagram overlays a full daily path for the **21st of every month**,
  with the selected date in blue. Daily paths use 5-minute UTC samples filtered
  to each civil date, retaining 23/25-hour DST days. Horizon crossings are
  interpolated between adjacent samples rather than stopping short of the ring.
  The model's default sampling interval remains 15 minutes for existing callers.
  The diagram uses an equidistant altitude radius, with zenith at the centre,
  10-degree elevation rings and 15-degree azimuth spokes. It is not stereographic.
- June 21 and December 21 are highlighted solstice **reference paths**, not just
  markers. Green identifies the longest-day reference and purple the shortest;
  these roles reverse in the Southern Hemisphere. At the equator the labels
  simply name the June and December solstices. March 20 and September 22 have
  distinct dashed equinox reference paths. These fixed dates are not calculated
  astronomical event dates or exact longest/shortest civil-day determinations.
- Dashed hourly curves connect each local clock hour across all 365/366 dates.
  The amber curve highlights the selected time, including non-whole-hour times;
  small dots show its intersections with the reference dates. The larger dot
  remains the selected date/time. These are civil-clock curves, not solar-time
  hour lines: skipped times, UTC-offset changes and below-horizon portions
  remain disconnected. Sunrise/sunset interpolation does not bridge those gaps.
- **Monthly paths** and **Hourly guides** are on by default and can be hidden
  independently. The selected date/time, solstice and equinox paths remain.
  Month labels sit outside the sky circle; hover a reference path for its date.
  Narrow screens can scroll the diagram without widening the page.
- Min/Max callouts identify the lowest and highest **above-horizon elevation**
  in the daily samples, with their local times. These are sampled extrema, not
  exact sunrise/horizon crossings. A polar night has no daylight extrema or
  above-horizon daily path; the diagram explicitly lists invisible reference dates.
- The annual plot uses one sample per calendar date at the selected local clock
  time (365 or 366 dates). It is not an 8760-hour energy calculation.
- Solar events refer to the solar cycle near local noon with an unobstructed,
  ground-level horizon. Events outside the selected civil date include their date.
  Polar sunrise/sunset absence is shown explicitly.
- Reference-date buttons are convenient seasonal comparisons, not exact
  astronomical equinox/solstice timestamps.

CSV export includes local date/time, timezone, coordinates, UTC instant, angle
units, availability and engine version. Calculations and exports stay local.
Site coordinates and the selected date/time are part of the shared project.
Use explicit JSON backup or the opt-in local project database to retain them
across reloads; without a save/export they remain memory-only.

## Boundaries

This tab provides astronomical positions only. The separate
[Environment workspace](environment-analysis.md) provides limited geometric
shadows, weather and explicitly supplied analytical scenarios. Calibrated indoor
temperatures, terrain/microclimate, CFD and daylight lux are not supplied by the
sun-path chart. The existing room-planner daylight/ventilation checklist remains
a heuristic and is not replaced by sun readings.

## Dependency and development

The published npm distribution is pinned to `suncalc@2.0.1`. Its unmodified
`suncalc.cjs` browser/CommonJS bundle is saved as `vendor/suncalc-2.0.1.js` so it is
served as JavaScript; the upstream BSD-2-Clause notice is retained in
`vendor/suncalc-LICENSE.txt`. The planned GitHub v2.0.2 tag was not available from
the npm registry during integration, so no new bundler was introduced to build it.

Sources: [upstream v2.0.1](https://github.com/mourner/suncalc/tree/v2.0.1),
[license](../vendor/suncalc-LICENSE.txt). Version 2 uses different angle
conventions from older SunCalc examples; do not copy v1 conversion formulae.

Reference curves are cached for the current site, year, timezone and repeated-time
choice, so scrubbing the date or time does not regenerate the whole reference
grid. Work is yielded between curves and stale calculations are discarded.

The adapter, time/series and diagram cases use Node's built-in runner:
`node --test tests\sun-model.test.cjs tests\sun-planner.test.cjs`. No dependency
installation or build is needed to use the browser app.
