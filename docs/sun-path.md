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
- **1 ft pole shadow** shows the shadow length in feet for a vertical 1 ft
  (0.3048 m) pole at the selected date, time and location. It uses
  `height / tan(elevation)` on level, unobstructed ground. Nighttime shows
  **No direct sun**, the horizon has no finite estimate, and a directly overhead
  sun gives zero length. This geometric estimate is particularly sensitive to
  angle/refraction errors near sunrise and sunset; it does not account for
  terrain or neighbouring buildings.
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

## Day summary

The **Day summary** shows sunrise, solar noon, sunset and **daylight duration**
for the solar cycle near the selected date's local noon. Duration is the elapsed
UTC time between the returned sunrise and sunset, rounded to the nearest minute;
it excludes twilight and is not a subtraction of wall-clock labels across DST
changes. It is not clipped to the civil date or reduced by clouds, terrain or
neighbouring buildings. Events outside the selected civil date include that date
beside their time.

The light-phase table exposes the local SunCalc event boundaries:

| Phase | Morning | Evening | Solar elevation used by the event engine |
| --- | --- | --- | --- |
| Civil twilight | Dawn begins | Dusk ends | -6 degrees |
| Nautical twilight | Dawn begins | Dusk ends | -12 degrees |
| Astronomical twilight | Dawn begins (`nightEnd`) | Dusk ends (`night`) | -18 degrees |
| Golden hour | Morning ends (`goldenHourEnd`) | Evening begins (`goldenHour`) | +6 degrees |

Golden-hour daylight portions run from sunrise to the morning endpoint, and
from the evening endpoint to sunset when those events occur. These angular
boundaries do not guarantee an hour of golden light, cloud-free conditions or
a particular photographic appearance. No new astronomical solver is introduced.

Polar day displays **Continuous daylight** rather than inventing a 24-hour
civil-day duration. Polar night displays **0 h 00 min**, but twilight events can
still occur. A missing sunrise or sunset never becomes a fabricated duration:
without a complete pair or an explicit polar state, it is **Not available**.
Phase boundaries that are not crossed show **No crossing**. Invalid/malformed
events are errors rather than legitimate missing crossings. The summary follows
the selected date, coordinates and time zone; changing only the clock time moves
the position/pole-shadow readouts but does not change the day's event times.

## Neighbour-blocked sunlight on the house

**Direct sunlight on your house** studies exposed roofs/terraces and opaque
exterior wall faces for the selected civil date. It uses the editable, modeled
floor scenes, not an assumed repetition up to the permitted G+n limit. Every
planned floor must have valid geometry. Add/duplicate actual storeys in Room
Planner when the house has more than one floor.

For each frontage-relative side, choose **Unknown**, **Clear / no block**, or
**Neighbour block**. Blocks require height and gap in metres. Gaps are measured
from the net plot boundary after road widening, not the building/floor edge;
include an intervening road in the entered gap. The actual Plot Planner boundary,
setbacks, building offset and frontage heading are carried separately from the
buildable plate and transformed into one shared site coordinate frame. Custom
setback violations remain visibly non-compliant; a sunlight result cannot approve
them.

Because neighbour width/depth are not supplied, each block is an explicit
conservative full-side opaque obstruction on the shared flat ground datum.
Unknown sides cannot be treated as clear. **Save neighbour inputs** preserves
incomplete drafts; **Calculate selected day** requires all sides to be specified
and saves the resulting study with the shared project. Date, location, geometry
or neighbour changes invalidate old results. Selected clock-time changes alone
do not invalidate a whole-day study.

The integration uses five-minute UTC midpoint intervals clipped to the civil-day
boundaries, including 23/25-hour DST dates, and an eight-axis surface grid.
Results report area-weighted direct-beam-equivalent hours, a sampled point range,
hours lost to shade relative to unobstructed orientation opportunity, and first/
last sampled sun intervals. Supplied partial-transmission obstacles weight those
equivalent hours. First/last times can contain shaded gaps. The physics model's
one-degree low-sun cutoff is explicit. Weather, measured sunshine, daylight lux,
indoor illumination, irregular neighbour footprints and terrain are not inferred.

## Boundaries

This tab provides astronomical positions, a simple level-ground pole-shadow
estimate and geometric potential direct-sun hours for the explicitly modeled
house and neighbours. The separate
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
