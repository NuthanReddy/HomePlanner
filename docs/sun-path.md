# Sun path

The **Sun Path** tab reuses the locally bundled **SunCalc 2.0.1** script. It does
not implement astronomical algorithms, fetch weather, detect location or require
an API key. Open `index.html` with the accompanying scripts and `vendor` folder,
including when offline.

## Location and clock

The initial coordinates are an explicitly labelled Hyderabad example. Enter the
actual site latitude (north positive) and longitude (east positive), plus its
IANA time zone. The selected local date/time is resolved to a UTC instant rather
than using the computer's timezone or an assumed longitude-based offset.

Clock times skipped by daylight-saving/calendar changes are rejected. Repeated
times require an earlier/later selection. The annual plot labels repeated-time
handling and leaves skipped times as gaps, never invented positions.

## Readings and plots

- Azimuth is degrees clockwise from geographic north: N=0, E=90, S=180, W=270.
- Elevation is SunCalc's apparent/refraction-corrected altitude above the horizon.
- Apparent zenith is `90 - elevation`; a negative elevation is below the horizon.
- Daily sky paths use 15-minute UTC samples filtered to the selected civil date.
  The diagram uses an equidistant altitude radius, with zenith at the centre
  and the horizon at the outer ring. It is not a stereographic chart.
- The annual plot uses one sample per calendar date at the selected local clock
  time (365 or 366 dates). It is not an 8760-hour energy calculation.
- Solar events refer to the solar cycle near local noon with an unobstructed,
  ground-level horizon. Events outside the selected civil date include their date.
  Polar sunrise/sunset absence is shown explicitly.
- Reference-date buttons are convenient seasonal comparisons, not exact
  astronomical equinox/solstice timestamps.

CSV export includes local date/time, timezone, coordinates, UTC instant, angle
units, availability and engine version. Calculations and exports stay local.
Inputs are session-only and are not saved across page reloads.

## Boundaries

This feature provides astronomical positions only. Building/terrain/tree shadows,
irradiance, daylight lux, weather and indoor temperatures are separate future
models. The existing room-planner daylight/ventilation checklist is still a
heuristic and is not replaced by these sun readings.

## Dependency and development

The published npm distribution is pinned to `suncalc@2.0.1`. Its unmodified
`suncalc.cjs` browser/CommonJS bundle is saved as `vendor/suncalc-2.0.1.js` so it is
served as JavaScript; the upstream BSD-2-Clause notice is retained in
`vendor/suncalc-LICENSE.txt`. The planned GitHub v2.0.2 tag was not available from
the npm registry during integration, so no new bundler was introduced to build it.

Sources: [upstream v2.0.1](https://github.com/mourner/suncalc/tree/v2.0.1),
[license](../vendor/suncalc-LICENSE.txt). Version 2 uses different angle
conventions from older SunCalc examples; do not copy v1 conversion formulae.

The adapter and time/series cases use Node's built-in runner:
`node --test tests\sun-model.test.cjs`. No dependency installation or build is
needed to use the browser app.
