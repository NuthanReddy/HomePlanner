---
name: homeplanner-solar-shading
description: "Use when implementing, debugging, reviewing, or explaining HomePlanner sun paths, solar position, pole shadows, neighbor shading, direct-sun hours, or solar exposure. Preserve local SunCalc degree conventions, IANA/DST time handling, actual plot and building geometry, sampling provenance, and the distinction between astronomical daylight, blocked sunlight and weather energy."
---

# HomePlanner solar and shading

## When to use

- Use for solar clocks, seasonal paths, shadow geometry, house sunlight studies,
  obstruction inputs, irradiance comparisons or stale solar results.
- Example task: "Compare the current house's September and December shading at
  09:30 local time." Hold the real site/time zone and geometry explicit, resolve
  each date separately, and report snapshots rather than annual energy.

## Repository anchors

- `sun-model.js`: `HomeSun.calculate`, `position`, `resolveLocal`,
  `localCandidates`, `daySummary`, `shadowLengthM`, `dailyIntervals`,
  `annualSamples`, `referencePaths`, `hourlyPaths`, `daylightSegments`.
- `vendor\suncalc-2.0.1.js`: locally bundled SunCalc. Read its current adapter
  contract before changing conventions; no second ephemeris or CDN is needed.
- `sun-exposure.js`: `HomeSunExposure.validateNeighbors`, `prepareScenes`,
  `inputKey`, `groupSurfaces`, `mount`.
- `building-physics.js`: `BuildingPhysics.shadowAt`, `createSunlightStudy`,
  `surfaceExposure`; `environment-ui.js`: `EnvironmentUI.mount`.
- `planner-bridge.js`: `HomePlanner.getProject`, `getScene`, `getScenes`,
  `getDrawingScene`, `execute`; `planner-projection.js`:
  `HomePlannerProjection.projectScene`, `siteToWorld`.
- Read [sun path](../../../docs/sun-path.md),
  [physics](../../../docs/building-physics.md),
  [environment](../../../docs/environment-analysis.md),
  [plot geometry](../../../docs/plot-geometry.md), and
  [project model](../../../docs/project-model.md).

## Required inputs

- Actual site latitude/longitude, provenance and IANA zone; selected civil date,
  time and earlier/later choice where needed. Default example coordinates are
  not a verified site or consent to location detection.
- Current active project and relevant modeled floor scenes, actual net plot,
  building offsets/heading, wall/opening geometry, elevations and slab data.
  Planned/permitted floor counts do not establish physical storeys.
- For whole-house side screens: explicit unknown/clear/block state for each side,
  block height and gap in metres from the net plot boundary, including any road.
  For physical obstacle boxes: actual dimensions, bases and transmittance.
- Explicit temporal/spatial sampling controls and low-sun cutoff; pole height
  and requested length units. Missing physics/geometry remains unknown.
- Irradiance additionally needs complete interval-matched DNI/DHI/GHI in W/m²
  and the applicable ground-albedo assumption. Sun hours alone supply no energy.

## Workflow

1. **Choose the right result.** Separate astronomical positions/events,
   level-ground pole shadows, neighbor-blocked direct-beam-equivalent hours, and
   weather-driven incident irradiance. Explain scope before comparing numbers.
2. **Preserve the local solar convention.** SunCalc 2 returns apparent altitude
   in degrees and azimuth clockwise from geographic north: N=0, E=90, S=180,
   W=270. `HomeSun.position` supplies the unit ENU vector toward the sun.
   Do not apply a v1 radians or south-origin conversion to these outputs.
3. **Resolve time, never guess it.** Use `resolveLocal`/`localCandidates` with the
   selected IANA zone, not browser-local Date parsing or longitude-derived offsets.
   Reject skipped times; require a choice for repeated ones. Integrate actual UTC
   duration, including 23/25-hour civil dates and clipped final intervals.
4. **Use current geometry.** Obtain the shared active project whether unchanged
   or edited; never substitute a sample or require an edit to make analysis work.
   For whole-house exposure, pass raw `getScenes()` through
   `prepareScenes(project, scenes)`: it translates the actual plot origin once.
   Already-projected DrawingScene consumers must not apply that translation again.
   Keep buildable `floor`, net `plot` and physical `building` distinct.
5. **Preserve physical extents.** Use supplied usable regions/net areas whenever
   sampling room floors: full lift/stair footprints are excluded from hosts.
   This is not permission to remove those services' physical walls or casters.
   Use actual modeled storeys and roofs for mutual shade where supported;
   per-scene `surfaceExposure` is not the all-storey sunlight-study contract.
6. **Model obstruction assumptions honestly.** Whole-house height/gap inputs
   represent conservative full-side opaque screens, not measured neighbor widths.
   Unknown sides block a complete result. Respect wall thickness/reveals, supplied
   roof thickness, elevated gaps, obstacle bases and once-per-object transmission.
   Do not infer terrain, connecting slabs, canopy species or nonexistent floors.
7. **Sample consistently.** Reuse `dailyIntervals` UTC midpoints and
   `createSunlightStudy` area-weighted surface samples. Record spacing/count,
   cutoff and excluded low-sun duration; first/last sun intervals may contain gaps.
   Refine time and surface sampling separately before asserting stable comparisons.
8. **Keep seasonal displays honest.** `referencePaths` draws monthly daily paths;
   `annualSamples` holds the selected local clock time across calendar dates.
   Same-clock comparisons are not same UTC or solar time. Keep skipped times,
   offset jumps and below-horizon sections disconnected. Fixed solstice/equinox
   reference dates and monthly 09/12/15 snapshots are not an annual energy model.
9. **Handle boundaries and units.** Preserve absent polar crossings and explicit
   polar-day/night states; do not invent a 24-hour civil-day duration.
   `daySummary` uses elapsed UTC sunrise-to-sunset duration, not blocked sun hours.
   Pole length is `height/tan(altitude)` on level ground: a 1 ft pole is 0.3048 m.
   Night/horizon has no finite positive shadow estimate; zenith yields zero.
   Keep numerical cutoff suppression distinct from physically resolved shade.
10. **Publish only matching evidence.** Keep revision, geometry/input keys, site,
    date, assumptions and engine with results. Recheck `inputKey` and generation
    after yielding; workers, if involved, must reject stale snapshots too.
    Date/geometry/site/neighbor changes invalidate a day study; changing only its
    display clock does not. Preserve manual drafts and explicit Apply/Save actions.

## Do not do

- Do not treat astronomical daylight as measured sunshine, neighbor-clear hours
  as weather energy, irradiance as absorbed heat/lux, or shade as automatic cooling.
- Do not replace the true plot with its buildable plate, measure neighbor gaps
  from the building edge, or fabricate missing site/height/optical inputs.
- Do not clip very long low-sun shadows into plausible small ones, hide omitted
  projections/cutoffs, or claim exact accuracy from a coarse surface grid.
- Keep edits in one shared project through existing HomePlanner commands.
  No automatic network/geolocation, remote solver or live-project mutation;
  offline use and manual inputs must remain available.

## Validation

Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-solar-shading\scripts\example.py --check
```

Run relevant groups from the repository root:

```powershell
node --test tests\sun-model.test.cjs tests\sun-planner.test.cjs tests\sun-exposure.test.cjs tests\sun-exposure-ui.test.cjs
node --test tests\building-physics.test.cjs
```

Check v2 angle parity, cardinal/noncardinal headings, DST gaps/repetitions,
quarter-hour zones, leap dates, polar states and same-clock seasonal curves.
Verify 30°/45°/60° pole/shadow cases, true-plot boundary gaps, elevated casters,
openings/reveals, partial transmission, area weighting and sampling refinement.
Use isolated UI fixtures for unchanged/edited active plans and stale completion.
These are equation/contract tests, not surveyed-site or weather validation.

## Output contract

State the snapshot, real/example site status, local and UTC times, zone, engine,
coordinate/angle/length units, modeled storeys, obstruction assumptions and
sampling/cutoffs. Separate daylight duration, blocked direct sun and irradiance.
Report tests, unresolved inputs and professional survey/solar-design review needs.

## References

Use the verified [primary sources and method caveats](references/sources.md).

- [Equations, time/angle units and worked calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
