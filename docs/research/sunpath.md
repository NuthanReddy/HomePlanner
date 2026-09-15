# Sun path research and feature-gap plan

Research date: **2026-09-10**. Status: **research and proposed work only**;
the features below have not been implemented by this document.

Reference: [Simulations4All - Sun Path Diagram Tool: Solar Position Calculator
for Architecture & Solar Design](https://simulations4all.com/simulations/sun-path-diagram-tool).
The supplied article is preserved in [Appendix A](#appendix-a-supplied-source-text),
including its original extracted equation formatting. It is third-party source
material, not HomePlanner documentation or independently established evidence.
The reviewed findings and implementation requirements take precedence over its
claims.

Related current documentation: [Sun Path](../sun-path.md),
[Environment](../environment-analysis.md),
[Building physics](../building-physics.md), and
[Project model](../project-model.md).

Additional supplied calculators are tracked in the
[building-performance research catalog](building-performance.md), covering HVAC,
daylight, ventilation, humidity, exhaust and energy assessment. Those references
are pending review and are not part of the live-tool findings below.

## 1. Scope and evidence

The goal is to cover the reference calculator's useful capabilities without
replacing HomePlanner's stronger existing site/time handling or duplicating its
environment solver. Application examples in the article are tracked separately
from capabilities actually visible in the tool.

The live page and its embedded interactive calculator were opened in a browser.
The controls, readouts and charts were inspected, including a rendered screenshot.
Playback was paused, time and location sliders were changed, the Equator preset
was applied, and Optimize Panel Tilt was invoked. No project/site data were sent
to the reference tool; only its example settings were used.

| Evidence | Observation |
| --- | --- |
| Presets | My First Home, Solar Planner, Massing Study, Passive Solar, Urban Canyon, Garden Planner, Golden Hour, Equator. |
| Location | Latitude slider -66 to +66 degrees, longitude -180 to +180, integer UTC offset -12 to +12. |
| Date/time | Month, day and a time slider labelled **solar hours**, 04:00-20:00 in 15-minute increments; no visible year input. |
| Building | Height 3-60 m, window azimuth 0-359 degrees, SHGC 0.1-0.9. These are example-control bounds, not recommended HomePlanner limits. |
| Playback | Play, Pause and speed 0.2x-4x; the pasted article also describes arrow keys and Shift for larger steps. Keyboard behavior was not exercised. |
| Readouts | Altitude, azimuth, sunrise, sunset, day length, solar noon, shadow ratio, peak irradiance, morning golden-hour interval, optimal tilt. |
| Visuals | Monthly sky arcs with hour lines and selected sun marker; building-shadow section; month/hour irradiance heatmap; monthly day-length bars and peak-altitude line; an optimization panel. |
| Optimizer | At the initial 40-degree latitude, invoking optimization returned a 32-degree readout immediately. A later rendered view showed 40 degrees again and an empty optimization area. This is an observation, not proof of a stable annual optimum. |
| Clock experiment | At June 21, 12 solar hours, 40 degrees north, changing longitude/offset from -74/-5 to 0/0 left the displayed positions/events unchanged, including solar noon 12:00. This is consistent with a solar-time display, not evidence of correct civil-time conversion. |
| Report | Export Report is present; help describes downloadable HTML. The download and report contents were not exercised. |
| Article only | Overhang sizing, agricultural supplemental lighting, LEED/daylight compliance, and broader energy-yield claims are discussed, but dedicated implementations were not established by this inspection. |

Do not copy the reference site's proprietary implementation, branding or styling.
Retain the supplied text as attributed research and implement independently.

## 2. Current HomePlanner baseline

The baseline below is grounded in the local source, not inferred from tab names.

| Existing surface | Evidence and behavior to preserve |
| --- | --- |
| Solar engine and civil time | `sun-model.js`: `validate`, `resolveLocal`, `calculate`; locally bundled SunCalc 2.0.1, IANA zones, explicit DST gaps/repeated times, north-clockwise azimuth and apparent elevation. |
| Day and year samples | `sun-model.js`: `dailySamples`, `daylightExtrema`, `annualSamples`; 15-minute UTC samples filtered to the civil day, daylight min/max, 365/366 selected-clock-time annual rows. |
| Solar UI | `sun-planner.js`: `skyPoint`, `drawDaily`, `drawAnnual`, `update`; equidistant daily SVG, annual elevation plot, selected position, sunrise/noon/sunset, polar-state messages. |
| Controls and download | `index.html` Sun Path section and `sun-planner.js` handlers; manual coordinates, optional device location, date/time/year scrubbing, reference-date buttons, Now, local annual CSV. |
| Shared geometry | `planner-model.js` and `planner-bridge.js`; project site, heading, floor scenes, walls, openings, heights and obstacles. Do not introduce a second editable building model. |
| Shadows and irradiation | `building-physics.js`: `shadowAt`, `surfaceExposure`; finite-thickness wall/opening geometry, simple building/tree prisms, ground projections, receiver beam fractions and explicit-input irradiation. |
| Environment workflow | `environment-ui.js`: `solarInputs`, `renderSolar`, `env-monthly` handler; selected-instant exposure, explicit glazing SHGC screen, 36 monthly 09/12/15 snapshots per floor. |
| Weather and handoff | `environment-data.js` and `environment-ui.js`; EPW/JSON imports, opt-in weather retrieval, source/interval metadata, expert JSON export and stale-result handling. |
| Existing test coverage | `tests/sun-model.test.cjs`, `tests/building-physics.test.cjs`, `tests/environment-data.test.cjs`, plus project/bridge/storage tests. These include clock, geometry and numerical cases, not independent SPA certification. |

Important existing boundaries: all-floor shading evaluates scenes independently;
there is no mutual-storey occlusion. The annual Sun Path plot and monthly
Environment snapshots are not integrated annual energy or sunlight hours.
Constant-SHGC gain is not daylight lux or calibrated indoor temperature.

## 3. Source corrections and scientific requirements

1. **Algorithm identity and accuracy.** The article alternates between "NREL
   SPA" and a Spencer approximation. Spencer's declination/EoT series is not the
   full SPA algorithm. Keep the explicit SunCalc identity; neither the article's
   +/-0.01-degree claim nor full SPA's advertised accuracy transfers to this
   application. Independent reference fixtures must identify engine, date,
   atmospheric assumptions and absolute angle error. Comparing an adapter with
   its own underlying library checks integration, not independent accuracy.
2. **Projection terminology.** Stereographic and azimuthal equidistant are
   different. With altitude `alpha` and horizon radius `R`, equidistant uses
   `r = R * (90 - alpha) / 90`; stereographic uses
   `r = R * tan((90 - alpha) / 2)` with degree-to-radian conversion. Both put
   the zenith at zero and the horizon at `R`, but their intermediate rings
   differ. Do not relabel the current equidistant plot.
3. **Solar versus civil time.** Preserve site longitude and IANA timezone
   conversion. A proposed solar-time display must be separately labelled and
   include the actual correction; noon is not generally 12:00 on the civil clock.
   Leap years, half/quarter-hour offsets, DST and full polar coverage must not
   regress to the reference tool's narrower controls.
4. **Altitude and event definitions.** Distinguish geometric from apparent
   altitude, and geometric horizon crossings from apparent sunrise/sunset.
   Solar-disk radius, refraction, observer height and horizon assumptions affect
   events. Daily minimum above-horizon samples are not exact sunrise angles.
   Equinox dates do not guarantee exactly zero declination; polar-boundary
   examples require explicit date/year/event conventions.
5. **Irradiance attribution.** `AM = 1 / sin(alpha)` is the simple plane-parallel
   approximation, not the full Kasten-Young 1989 expression. The article's
   simplified attenuation formula must not be presented as a verified Hottel
   implementation merely because it is labelled that way. An educational
   clear-sky mode needs a selected documented model, validity bounds, sources
   and separately identified DNI/DHI/GHI. Weather is not an inferred default.
6. **Power versus energy.** W/m2 is irradiance; Wh/m2 or kWh/m2 requires
   integration over time. "Peak" needs a defined domain and surface. A panel's
   incident solar energy is not its electrical yield without area, efficiency,
   temperature and loss assumptions. `abs(latitude)` is a starting heuristic,
   not an exact annual optimum.
7. **Overhang geometry.** Do not adopt the article's
   `d = h * tan(alpha_summer) / tan(alpha_winter)` as a general sizing rule.
   For an ideal horizontal overhang and a sun-facing facade,
   `tan(profileAngle) = tan(alpha) / cos(A - A_facade)` and the vertical shadow
   drop is `d * tan(profileAngle)`. Required depth therefore depends on window
   height, offset, facade bearing and target time; finite width and side sun
   require actual geometry. Winter admission must be checked separately.
8. **Standards and claims.** Article references to LEED, IES LM-83, EN 17037,
   IECC and ASHRAE are research leads, not a jurisdictional compliance engine.
   Do not repeat thresholds, chapter references, percentage energy savings or
   validation-table PASS results as verified HomePlanner facts. Lux-based
   daylight metrics require a suitable solver, sky/weather data and review.

The source bibliography is retained below. Primary-reference verification is a
planned gate, not completed certification. In particular, the legacy NREL SPA
web endpoint could not be retrieved during this research session.

## 4. Complete gap register

Status is relative to the inspected baseline. **Partial** means reuse and extend,
not rebuild. P0 establishes correctness; P1 adds geometry/chart parity; P2 adds
radiation/design workflows; P3 is advanced, explicitly bounded follow-on work.

| ID | Capability | Status | Planned work / completion criterion |
| --- | --- | --- | --- |
| SP-01 | Location, calendar and time basis | Partial / P0 | Keep current inputs and DST safeguards; add explanatory civil/solar-time help. Only add a solar-time/EoT readout with a documented calculation and reference cases. Preserve full latitude and calendar support. |
| SP-02 | Reproducible solar reference evidence | Partial / P0 | Add independent position/event fixtures with source, timestamp, units, atmospheric conventions and justified absolute tolerances; keep existing adapter tests. Do not assert SPA-equivalent accuracy. |
| SP-03 | Day length and golden hour | Missing UI / P1 | Add sunrise-to-sunset duration and both morning/evening 0-6-degree intervals with a stated altitude convention. Handle no events, all-day qualifying intervals and crossings outside the civil date explicitly. |
| SP-04 | Monthly sky-path comparison | Partial / P1 | Overlay 12 reference-day arcs, selectable seasons/months, a legend, hour markers/curves, selected-date emphasis and accessible numerical data. Preserve the existing annual elevation plot as a different view. |
| SP-05 | True stereographic option | Missing / P1 | Add a projection selector; retain equidistant as the existing default. Recompute rings, labels, arcs and markers consistently; compare both projections at 0, 45 and 90 degrees altitude. |
| SP-06 | Playback and keyboard navigation | Missing / P1 | Add Play/Pause, speed and 15-minute/Shift-hour stepping. Define playback as chronological UTC stepping across the selected civil day, displaying repeated-time occurrence. Pause on manual edits, tab/project changes and reduced-motion preference; do not intercept typing controls. |
| SP-07 | Scenario presets and guidance | Partial / P1 | Add equivalents of all eight observed presets with explicit example coordinates, timezone, date/year, building/window assumptions and purpose. Preview changes and use coordinator commands/undo; never silently relocate or overwrite a real project. |
| SP-08 | Shadow ratio and section visual | Partial / P1 | Reuse `shadowAt`; add a clearly idealized vertical-object section, height/length/ratio/direction readouts and an opposite-sun bearing. Preserve solver low-sun cutoffs and distinguish clipped/omitted projections from zero shadow. |
| SP-09 | Shared Sun Path / Environment selection | Partial / P1 | Add an explicit action to analyze the selected Sun Path instant in Environment, carrying timezone/DST occurrence and floor scope. Current selections are independent; do not silently overwrite saved experiments on every playback frame. |
| SP-10 | Monthly day-length/noon-altitude chart | Missing / P1 | Add bars/line and a table for the 21st of each month, with month/year and solar-noon conventions. Do not substitute the existing 09/12/15 geometry snapshots or selected-clock-time annual plot. |
| SP-11 | Clear-sky demonstration source | Missing / P2 | Add an opt-in, documented radiation scenario only after SP-02's scientific review. Explicitly label model/atmosphere/elevation assumptions, valid altitude range and absent components. Preserve imported/manual modes and never fill missing weather with this model. |
| SP-12 | Month/hour irradiance heatmap | Missing / P2 | Add selectable quantity/surface, source and units, a readable scale, keyboard cell inspection and table/CSV. Distinguish representative 21st-day samples from weather aggregates; preserve missing cells and interval coverage. |
| SP-13 | Peak irradiance and facade/SHGC comparison | Partial / P2 | Reuse actual facade normals, areas, radiation and explicit SHGC. Add orientation comparisons and a peak with a stated surface/time domain. Provide an explicitly hypothetical facade mode when no scene exists; keep VLT, SHGC and U distinct. |
| SP-14 | Panel orientation and tilt optimizer | Missing / P2 | Add tilt, azimuth and objective controls; compute a full candidate curve with documented time/angle resolution, irradiance source and coverage. Return reproducible optima/ties and seasonal alternatives, not a latitude-only recommendation. |
| SP-15 | Passive-solar overhang/fins workflow | Missing / P2 | Add explicit host opening, overhang dimensions/offsets and optional fins; preview summer exclusion/winter admission with profile-angle explanation. Extend numerical geometry and project validation before claiming device shadows; avoid an isolated calculator disconnected from the plan. |
| SP-16 | Integrated sunlight / urban shadow impact | Partial / P3 | Integrate receiver visibility over a selected period and compare baseline/proposal with identical time grids. Report binary direct-sun hours separately from transmission-weighted hours. Coupled storeys, horizon masks and terrain need new supported contracts or explicit exclusion. |
| SP-17 | Solar HTML/print report | Partial / P2 | Add a local self-contained report combining inputs, plots, tables, numerical methods, units, warnings, source provenance and scenario identity. Keep existing CSV/expert JSON; export unavailable states and original result snapshots, not stale values presented as current. |
| SP-18 | Help, equations and source tables | Partial / P1-P2 | Add contextual help, corrected formulas, assumptions and links; generate monthly reference tables from the identified engine rather than hand-copying the article. Keep optional EoT/declination outputs absent until their method is defined. |
| SP-19 | Accessibility, responsiveness and performance | Partial / all phases | Every new chart has text/table equivalents, keyboard access, clear units and non-color-only distinctions. Bound/cancel long calculations, discard stale results, respect reduced motion and preserve offline use. |
| SP-20 | Advanced energy/daylight use cases | Not provided / P3 | Track PV electrical yield, greenhouse supplemental-light demand, HVAC benefit and LM-83/LEED/EN daylight metrics as separately scoped expert integrations. Provide honest handoff or unsupported-state guidance, never infer them from sun angle/day length alone. |

Photography and garden presets can use SP-03 without claiming lighting quality,
plant yield or supplemental-lamp demand. Massing and Urban Canyon presets can
demonstrate currently supported prisms without claiming terrain or complete
urban simulation. These distinctions keep all article use cases accounted for.

## 5. Delivery sequence and integration plan

### Phase 0 - Establish the calculation contract (SP-01, SP-02)

Document quantity definitions and independent reference sources first. Reuse
`HomeSun` as the only production solar-position provider. If new geometry or
solar-time calculations need capabilities not exposed by it, choose and document
an additive approach before implementation; do not silently replace SunCalc or
fork the astronomy code.

Separate pure numerical/sampling helpers from DOM rendering. Preserve existing
`calculate`, daily/annual sample and CSV behavior. Gate: reference fixtures and
clock/hemisphere/polar cases support every new scientific claim.

### Phase 1 - Geometry-only experience (SP-03 through SP-10, SP-18, SP-19)

Extend `sun-model.js` with event/series helpers where appropriate; extend
`sun-planner.js`, `sun-planner.css` and the Sun Path markup in `index.html` for
comparison charts, readouts and controls. Reuse `BuildingPhysics.shadowAt`
through an explicit shared-scene integration rather than another shadow engine.

Use the existing coordinator for preset and selection changes. Treat chart
projection, visible month sets and playback state as view settings; keep
animation ticks transient rather than flooding undo/autosave with edits.
Version and validate any persisted solar-analysis settings, preserving old
project imports and the independent Environment selection.

Cache comparison geometry by site/year/time basis/projection. During playback,
update the marker and cheap instantaneous readings, not all annual rows or
all-floor ray samples each frame. Use revision tokens and cancellable chunked
work for heavier updates. Gate: complete offline geometry-only workflow with
no missing-weather errors for position, events or idealized shadow readouts.

### Phase 2 - Radiation and design (SP-11 through SP-15, SP-17)

First implement explicit radiation-source selection, temporal aggregation and
coverage metadata; then heatmaps/facade comparisons and the optimizer; then
device-geometry design and the combined report.

Reuse `environment-data.js` interval-end/duration semantics. Integrate
`sum(irradianceWm2 * durationHours)` for solar energy per area, splitting or
subsampling intervals when needed for changing incidence. Do not use the
one-sample-per-date elevation series for annual energy. TMY month/year mapping,
partial coverage and daylight intervals must be explicit; no silent calendar
relabeling or annualizing incomplete data.

For panels, define an ENU normal from tilt/bearing and clamp back-facing direct
incidence at zero. A proposed screening objective is total incident energy per
area over a selected year/season, using identified DNI/DHI/GHI and an explicit
diffuse/ground model. A hypothetical unobstructed plane is acceptable if labelled;
rooftop placement, obstruction visibility and self-shading require supported
geometry. Weather-dependent optimum, geometric optimum and electrical yield
must remain distinct. Publish candidate grid, integration step, tie tolerance
and a finer-grid comparison before describing a result as optimized.

Add panel/device inputs under a versioned environment-analysis schema, with
coordinator validation, import/export, undo and invalidation coverage in
`planner-model.js` / `planner-bridge.js`. Extend `building-physics.js` only with
explicit supported receiver/occluder types; preserve existing behavior.
Gate: computed comparisons reproduce from saved inputs, missing data remain
visible, and exports contain the same result and limitations as the UI.

### Phase 3 - Advanced analysis (SP-16, SP-20)

Deliver period-integrated direct-sun visibility and baseline/proposal impact
first. Define coupled-storey and site-obstruction geometry separately; existing
independent floor scenes are not sufficient for mutual shading.

Certified daylight/energy metrics, calibrated thermal outcomes and electrical
PV production require separate scope, validated solver/data choices, licensing
review and professional review. Until then, report exactly what remains
unsupported and retain the existing expert JSON handoff. These are planned
follow-ons, not prerequisites for useful chart/tool parity.

## 6. Acceptance and regression plan

Extend the repository's existing Node built-in test suites rather than adding a
new build or test tool solely for this work. UI behaviors need browser checks in
addition to pure numerical cases.

| Area | Required evidence |
| --- | --- |
| Time | Same UTC instant across zones gives the same position; DST gaps/repeats, 23/25-hour days, leap day, quarter-hour offsets, year rollover and timezone changes remain explicit. Playback never invents a skipped local instant. |
| Position | Independent north/south/equatorial/high-latitude fixtures, azimuth wrap, near-zenith behavior and matched apparent/geometric conventions. Use absolute angular/time error, not percentage error near zero. |
| Projection | Zenith/horizon invariants; 45-degree altitude gives radius 0.5R equidistant and approximately 0.4142R stereographic. All cardinal labels and hour paths remain consistent. |
| Events | Both golden-hour intervals, no-crossing and polar states, cross-midnight events and day length agree with the chosen definitions. Do not derive day length from rounded display strings. |
| Shadows | At 45-degree altitude a 10 m ideal vertical object casts a 10 m level-ground shadow, opposite the sun. Check heading rotation, elevated bases, overlap, transmittance and near-horizon cutoff/omission labels. |
| Radiation | Night is physically zero only where supported; unknown source cells stay unknown. For a constant 100 W/m2 over two hours, energy is 200 Wh/m2. Check mixed intervals, missing components, surface orientation and coverage. |
| Optimizer | A sun-normal panel maximizes instantaneous direct incidence; back-facing beam is zero. Verify hemisphere handling, horizontal/vertical candidates, ties, partial-year labeling, source changes and finer-grid convergence. Do not require the live tool's 32-degree result. |
| Devices | Profile-angle analytical fixtures plus explicit shadow geometry, wall bearing, window offset, side sun and finite-width limits; rejected unsupported shapes and stale host IDs. |
| State | Presets preview before project mutation; undo/import/restore round-trip settings; project/floor/site/weather edits invalidate only the relevant results. Old project files remain readable. |
| UI/export | Playback pauses appropriately; no shortcut hijacking of form fields; small-screen and keyboard usability; tables match plots. HTML escapes user text, needs no external assets, identifies stale snapshots and retains missing-data warnings. |

Targeted commands for future implementation, selected according to touched files:

```powershell
node --test tests\sun-model.test.cjs
node --test tests\building-physics.test.cjs tests\environment-data.test.cjs
node --test tests\planner-model.test.cjs tests\planner-bridge.test.cjs tests\planner-storage.test.cjs
```

Update the current-feature docs only as each phase ships. This research document
must not make the existing Sun Path or Environment tabs appear to support
unimplemented capabilities.

## Appendix A: supplied source text

The following is the user-supplied 848-line extraction, preserved as received.
Equations, numerical examples, accuracy statements, PASS labels and standards
claims belong to that source. See the corrections above before using them.

```text
Sun Path Diagram Tool: Solar Position Calculator for Architecture & Solar Design
Free sun path diagram calculator with stereographic projection, solar altitude/azimuth computation, shadow analysis, and solar panel tilt optimization. Uses NREL SPA algorithm for precise solar position at any location worldwide. Interactive animated sun path arcs and building shadow visualization.

Sun Path Diagram Tool: Solar Position Calculator for Architecture & Solar Design
✓ Verified Content: All equations, formulas, and reference data in this simulation have been verified by the Simulations4All engineering team against authoritative sources including the NREL Solar Position Algorithm (Reda & Andreas, 2004), ASHRAE Fundamentals Handbook (2021), Duffie & Beckman's Solar Engineering of Thermal Processes (4th ed.), and Meeus's Astronomical Algorithms (2nd ed.). See verification & validation

Quick Answer
How do I find the sun's position at any location and time?

The solar altitude angle 
α
α is computed from the fundamental solar geometry equation 
sin
⁡
(
α
)
=
sin
⁡
(
ϕ
)
sin
⁡
(
δ
)
+
cos
⁡
(
ϕ
)
cos
⁡
(
δ
)
cos
⁡
(
ω
)
sin(α)=sin(ϕ)sin(δ)+cos(ϕ)cos(δ)cos(ω), where 
ϕ
ϕ is latitude, 
δ
δ is the solar declination, and 
ω
ω is the hour angle [1]. For example, at latitude 40\textdegree N on the summer solstice (June 21, 
δ
=
23.44
δ=23.44\textdegree) at solar noon (
ω
=
0
ω=0), the altitude is 
α
=
90
−
40
+
23.44
=
73.44
α=90−40+23.44=73.44\textdegree. This calculator implements the Spencer (1971) approximation of the NREL SPA algorithm with animated stereographic projection, shadow analysis, and panel tilt optimization.

Introduction
Here is a surprising efficiency gap that most architects never quantify: a building oriented 15 degrees off optimal solar alignment can lose 10-15% of its potential passive heating gain in winter while simultaneously increasing cooling loads by a comparable margin in summer. Energy in must equal energy out, plus whatever the HVAC system has to compensate for -- and that compensation starts with understanding where the sun actually is. Sun path diagrams sit at the intersection of astronomy, architecture, and energy engineering. They translate the predictable geometry of Earth's orbit into actionable design data: when does direct sunlight hit a south-facing window? How long is the shadow cast by a proposed 30-meter tower on December 21? What tilt angle maximizes annual energy collection on a rooftop solar array?

I first encountered the practical importance of sun path analysis when reviewing daylighting studies for a mixed-use development in Boston. The architects had oriented their building based on street grid alignment, not solar geometry, and the south-facing apartments received barely 2 hours of direct winter sun. In practice, you lose energy to poor orientation more than almost any other single design decision. A 15-degree rotation would have doubled the solar gain. The second law tells us that heat flows spontaneously from warm to cold, and a well-oriented building harnesses that solar influx rather than fighting it with mechanical systems -- think of solar geometry as the ultimate free energy budget that requires zero fuel cost.

The math behind solar position is surprisingly old. The declination equation dates back to astronomical tables from the 18th century, and stereographic projection has been used in celestial navigation since the astrolabe era. What has changed is accessibility. Until the 1990s, architects relied on printed sun path charts for specific latitudes (the classic Olgyay and Olgyay diagrams from 1957). Today, algorithms like the NREL Solar Position Algorithm (SPA) compute solar coordinates to \textpm 0.0003\textdegree accuracy for any point on Earth, any moment in time, across millennia [2]. No real system achieves Carnot efficiency because real buildings have thermal mass, air leakage, and occupant behavior that complicate the energy balance -- but getting the solar geometry right is the essential first step. This tool implements a simplified version of that algorithm optimized for real-time interactive visualization.

Architects use sun path diagrams for passive solar design, daylighting analysis, and shading device geometry. Solar engineers use them to determine optimal panel tilt and orientation, estimate annual energy yield, and identify potential shading obstructions. Photographers time their shoots around golden hour. Urban planners assess shadow impacts on public spaces. The underlying physics is the same for all of these applications.

How to Use This Calculator
Start with a preset that matches your use case. My First Home loads a residential scenario at 40\textdegree N with south-facing windows on the summer solstice. Solar Panel Planner shifts to 35\textdegree N (Albuquerque) with the equinox selected, showing balanced sun paths for annual optimization. Passive Solar Design sets a winter date to demonstrate low sun angles ideal for thermal mass heating. Try Equator to see the symmetric sun paths that define tropical architecture.

Drag the Time slider and watch the sun dot animate along the stereographic path arc. The building shadow visualization updates in real time, showing the shadow length and direction. Change the Month slider to see how the sun arc shifts between solstices. Click Optimize Panel Tilt to generate an annual insolation curve showing the tilt angle that maximizes solar energy at your latitude. Press Export Report for a downloadable HTML document with complete solar position data.

The keyboard arrow keys (left/right) step through time in 15-minute increments. Hold Shift for 1-hour steps. This is particularly useful for studying shadow progression through a winter day.

What Is a Sun Path Diagram?
A sun path diagram is a two-dimensional projection of the sun's apparent path across the sky dome, plotted for a specific latitude. The most common projection is stereographic (also called equidistant azimuthal), where the horizon forms the outer circle, the zenith sits at the center, and concentric rings represent altitude angles at equal angular intervals [3].

Each curved line on the diagram represents the sun's path on one day of the year, typically plotted for the 21st of each month. The outermost arcs correspond to summer (longest paths, highest altitudes) and the innermost arcs to winter (shortest paths, lowest altitudes). Radial lines crossing the monthly arcs mark clock times, creating an analemma-like grid that lets you read off altitude and azimuth for any date and time by interpolation.

The key insight is that sun paths at a given latitude are completely deterministic. The only variables are the date (which determines the solar declination) and the time (which determines the hour angle). Cloud cover, atmospheric refraction, and local horizon obstructions affect how much sunlight actually reaches a surface, but the geometric position of the sun is fixed by orbital mechanics.

How the Calculator Works
Key Parameters
Parameter	Symbol	Unit	Reference	Typical Range
Latitude	
ϕ
ϕ	\textdegree	WGS 84	-66 to +66
Solar declination	
δ
δ	\textdegree	Spencer (1971)	-23.45 to +23.45
Hour angle	
ω
ω	\textdegree	Definition	-180 to +180
Solar altitude	
α
α	\textdegree	Eq. (1)	0 to 90
Solar azimuth	
A
A	\textdegree	Eq. (2)	0 to 360
Equation of Time	EoT	min	Spencer (1971)	-14.3 to +16.4
Day of year	
n
n	day	Calendar	1 to 365
Building height	
H
H	m	User input	3 to 60
Shadow ratio	
L
/
H
L/H	--	
cot
⁡
(
α
)
cot(α)	0 to 
∞
∞
Clear-sky irradiance	
I
D
N
IDN​	W/m\textsuperscript{2}	Hottel (1976)	0 to ~1000
Panel tilt	
β
β	\textdegree	Optimization	0 to 90
SHGC	--	--	ASHRAE	0.1 to 0.9

Show more
Core Formulas
Solar Declination (Spencer, 1971): 
δ
=
180
π
(
0.006918
−
0.399912
cos
⁡
B
+
0.070257
sin
⁡
B
−
0.006758
cos
⁡
2
B
+
0.000907
sin
⁡
2
B
−
0.002697
cos
⁡
3
B
+
0.00148
sin
⁡
3
B
)
δ=π180​(0.006918−0.399912cosB+0.070257sinB−0.006758cos2B+0.000907sin2B−0.002697cos3B+0.00148sin3B)

where 
B
=
(
n
−
1
)
⋅
360
/
365
B=(n−1)⋅360/365 in degrees and 
n
n is the day of the year. The maximum declination of 
±
23.44
±23.44\textdegree occurs at the solstices [4].

Hour Angle: 
ω
=
15
∘
×
(
t
solar
−
12
)
ω=15∘×(tsolar​−12)

where 
t
solar
tsolar​ is solar time in hours. The hour angle is negative before solar noon (morning) and positive after.

Solar Altitude Angle (fundamental equation of solar geometry): 
sin
⁡
(
α
)
=
sin
⁡
(
ϕ
)
sin
⁡
(
δ
)
+
cos
⁡
(
ϕ
)
cos
⁡
(
δ
)
cos
⁡
(
ω
)
sin(α)=sin(ϕ)sin(δ)+cos(ϕ)cos(δ)cos(ω)

This is the single most important equation in solar engineering. It gives the angle of the sun above the horizon for any latitude 
ϕ
ϕ, declination 
δ
δ, and hour angle 
ω
ω [1].

Solar Azimuth Angle (measured from north, clockwise): 
cos
⁡
(
A
)
=
sin
⁡
(
δ
)
−
sin
⁡
(
ϕ
)
sin
⁡
(
α
)
cos
⁡
(
ϕ
)
cos
⁡
(
α
)
cos(A)=cos(ϕ)cos(α)sin(δ)−sin(ϕ)sin(α)​

For afternoon hours (
ω
>
0
ω>0), the azimuth is 
A
=
360
∘
−
arccos
⁡
(
above
)
A=360∘−arccos(above) [5].

Equation of Time (Spencer, 1971): 
EoT
=
229.18
(
0.000075
+
0.001868
cos
⁡
B
−
0.032077
sin
⁡
B
−
0.014615
cos
⁡
2
B
−
0.04089
sin
⁡
2
B
)
EoT=229.18(0.000075+0.001868cosB−0.032077sinB−0.014615cos2B−0.04089sin2B)

The Equation of Time accounts for Earth's orbital eccentricity and axial tilt, producing a correction of up to 
±
16.4
±16.4 minutes between clock time and solar time [6].

Sunrise/Sunset Hour Angle: 
cos
⁡
(
ω
s
)
=
−
tan
⁡
(
ϕ
)
tan
⁡
(
δ
)
cos(ωs​)=−tan(ϕ)tan(δ)

The day length in hours is 
2
ω
s
/
15
2ωs​/15. When 
∣
tan
⁡
(
ϕ
)
tan
⁡
(
δ
)
∣
>
1
∣tan(ϕ)tan(δ)∣>1, there is either no sunrise (polar night) or no sunset (midnight sun).

Shadow Length: 
L
=
H
⋅
cot
⁡
(
α
)
=
H
tan
⁡
(
α
)
L=H⋅cot(α)=tan(α)H​

where 
H
H is the object height and 
α
α is the solar altitude. At solar noon on the winter solstice in New York (
α
≈
26.6
α≈26.6\textdegree), a 10 m building casts a shadow of 
10
/
tan
⁡
(
26.6
)
=
20.0
10/tan(26.6)=20.0 m.

Clear-Sky Direct Normal Irradiance (Hottel, 1976, simplified): 
I
D
N
=
I
S
C
⋅
0.7
A
M
0.678
IDN​=ISC​⋅0.7AM0.678

where 
I
S
C
=
1367
ISC​=1367 W/m\textsuperscript{2} is the solar constant and 
A
M
=
1
/
sin
⁡
(
α
)
AM=1/sin(α) is the air mass (Kasten & Young, 1989) [7].

Panel Tilt Optimization — Angle of Incidence on Tilted Surface: 
cos
⁡
(
θ
)
=
sin
⁡
(
α
)
cos
⁡
(
β
)
+
cos
⁡
(
α
)
sin
⁡
(
β
)
cos
⁡
(
A
−
A
panel
)
cos(θ)=sin(α)cos(β)+cos(α)sin(β)cos(A−Apanel​)

where 
β
β is the tilt angle, 
A
panel
Apanel​ is the panel azimuth (typically 180\textdegree for south-facing in the northern hemisphere), and 
θ
θ is the incidence angle. The annual-optimal tilt is approximately 
β
opt
≈
∣
ϕ
∣
βopt​≈∣ϕ∣ for a south-facing fixed panel [8].

Design Codes & Standards
Solar position calculations and daylighting design are referenced by several international standards and building codes:

NREL Solar Position Algorithm (SPA) — The authoritative algorithm for computing solar zenith and azimuth angles, published by Reda and Andreas at the National Renewable Energy Laboratory (2004, updated 2008). SPA achieves \textpm 0.0003\textdegree accuracy for the period -2000 to +6000 CE using the Jean Meeus astronomical algorithm framework. Our calculator implements the Spencer (1971) approximation, which is accurate to \textpm 0.01\textdegree and computationally efficient for real-time use [2].

ASHRAE Fundamentals Handbook, Chapter 14 — Solar radiation data and methods for computing solar heat gain through fenestration. Defines the SHGC (Solar Heat Gain Coefficient) and provides clear-sky irradiance models for HVAC design calculations. The 2021 edition includes updated solar geometry equations consistent with NREL SPA [9].

IES (Illuminating Engineering Society) LM-83 — Approved method for measuring spatial daylight autonomy (sDA) and annual sunlight exposure (ASE) in buildings. Requires sun position data as input to daylighting simulation software like Radiance, DIVA, and ClimateStudio.

LEED v4.1 EQ Credit: Daylight — Requires sDA300/50% compliance, meaning 55% of regularly occupied floor area must receive at least 300 lux from daylight for at least 50% of annual occupied hours. Sun path analysis is the starting point for determining window placement and shading strategies.

EN 17037:2018 Daylight in Buildings — European standard specifying minimum daylight provisions. Uses a target illuminance approach (300 lux for at least half the daylight hours) and references CIE standard overcast and clear sky models.

IECC 2021 Section C402.4 — Fenestration SHGC requirements that vary by climate zone. Designers use sun path diagrams to determine which windows need exterior shading to meet maximum SHGC limits.

Verification & Validation
All computed solar positions have been cross-checked against NREL SPA published test cases, the U.S. Naval Observatory astronomical data, and Meeus (1998) worked examples.

ID	Test Case	Reference	Key Inputs	Expected	Calculated	Error	Status
TC-001	Summer solstice solar noon altitude, 40\textdegree N	Meeus (1998), Ch. 13	
ϕ
=
40
ϕ=40\textdegree, Jun 21, 
ω
=
0
ω=0	73.44\textdegree	73.47\textdegree	0.04%	PASS
TC-002	Winter solstice solar noon altitude, 40\textdegree N	Meeus (1998), Ch. 13	
ϕ
=
40
ϕ=40\textdegree, Dec 21, 
ω
=
0
ω=0	26.56\textdegree	26.53\textdegree	0.04%	PASS
TC-003	Equinox sunrise azimuth (should be 90\textdegree)	Astronomical identity	
ϕ
=
40
ϕ=40\textdegree, Mar 21, sunrise	90.0\textdegree	89.98\textdegree	0.02%	PASS
TC-004	Equinox sunset azimuth (should be 270\textdegree)	Astronomical identity	
ϕ
=
40
ϕ=40\textdegree, Mar 21, sunset	270.0\textdegree	270.02\textdegree	0.01%	PASS
TC-005	Equinox day length (should be ~12h)	Astronomical identity	
ϕ
=
40
ϕ=40\textdegree, Mar 21	12.00 h	12.02 h	0.09%	PASS
TC-006	Equator summer solstice noon altitude	Direct calculation	
ϕ
=
0
ϕ=0\textdegree, Jun 21, 
ω
=
0
ω=0	66.56\textdegree	66.53\textdegree	0.04%	PASS
TC-007	Arctic Circle midnight sun day length	Astronomical definition	
ϕ
=
66.56
ϕ=66.56\textdegree, Jun 21	24.0 h	24.0 h	0.00%	PASS
TC-008	Shadow ratio at 45\textdegree altitude	Trigonometric identity	
α
=
45
α=45\textdegree, H=10 m	10.0 m	10.0 m	0.00%	PASS
TC-009	Spencer declination vs. simplified formula	Cross-check	Jun 21 (
n
=
172
n=172)	23.44\textdegree	23.41\textdegree	0.06%	PASS
TC-010	Equation of Time, Feb 12	Spencer (1971), Table 1	
n
=
43
n=43	-14.2 min	-14.18 min	0.08%	PASS

Show more
All ten test cases pass with errors below 0.1%. TC-001 and TC-002 confirm solstice noon altitudes against the standard formula 
α
noon
=
90
−
∣
ϕ
−
δ
∣
αnoon​=90−∣ϕ−δ∣. TC-003/TC-004 verify the fundamental property that equinox sunrise and sunset azimuths are exactly 90\textdegree and 270\textdegree at all latitudes (small deviation is due to the Spencer approximation not being exact for the equinox date). TC-007 confirms polar day behavior at the Arctic Circle.

Real-World Applications
Passive Solar Home Design: An architect designing a home at 38\textdegree N latitude uses the sun path diagram to size south-facing overhangs. On December 21 (
α
noon
≈
28.5
αnoon​≈28.5\textdegree), direct sun penetrates deep into the room for passive heating. On June 21 (
α
noon
≈
75.4
αnoon​≈75.4\textdegree), the same overhang blocks direct sun entirely. The overhang depth 
d
=
h
⋅
tan
⁡
(
α
summer
)
/
tan
⁡
(
α
winter
)
d=h⋅tan(αsummer​)/tan(αwinter​) balances winter gain against summer overheating [10].

Solar Panel Farm Orientation: A utility-scale solar installation in Phoenix (33.4\textdegree N) optimizes annual energy yield by tilting panels at approximately 33\textdegree from horizontal, facing due south. The tilt optimization curve shows that deviations of \textpm 10\textdegree from optimal reduce annual yield by only 2-3%, providing design flexibility for terrain constraints. At higher latitudes (e.g., 55\textdegree N in Scotland), the optimal tilt steepens to 55\textdegree and the penalty for east/west-facing panels increases significantly.

Urban Shadow Impact Assessment: Before approving a 50-meter office tower in Manhattan (40.7\textdegree N), planners use shadow analysis to determine how many hours of direct sun nearby parks and residential streets will lose. On the winter solstice at solar noon, the shadow extends 50 / tan(26.0\textdegree) = 102 meters. At 3 PM (
α
≈
15
α≈15\textdegree), it stretches to 187 meters, potentially reaching across an entire city block.

Daylighting Compliance for LEED: A commercial office project targeting LEED Gold must demonstrate sDA300/50% compliance. The designer uses sun path data to determine which perimeter zones receive sufficient daylight hours. Rooms facing north at high latitudes may need skylights or light shelves to compensate for the low winter sun angles.

Agricultural Growing Season Analysis: A market gardener at 45\textdegree N uses day length data to plan greenhouse supplemental lighting. From November through February, day length drops below 10 hours, requiring 4-6 hours of artificial light to maintain tomato production. The sun path diagram also reveals that a south-facing greenhouse wall receives 5x more solar radiation in January than an east-facing wall at this latitude.

Photography Planning: A landscape photographer in Los Angeles (34\textdegree N) uses golden hour timing — when the solar altitude is between 0\textdegree and 6\textdegree — to plan shoots. The calculator shows that October 15 golden hour begins at approximately 6:10 AM (sunrise) and ends at 6:45 AM, giving a 35-minute window of warm, directional light.

Reference Data
Monthly Solar Declination (21st of Each Month)
Month	Day of Year	Declination (\textdegree)	Sunrise HA (\textdegree) at 40\textdegree N	Day Length (h) at 40\textdegree N	Noon Altitude (\textdegree) at 40\textdegree N
January	21	-20.1	70.7	9.4	29.9
February	52	-11.2	78.5	10.5	38.8
March	80	-0.4	89.7	12.0	49.6
April	111	+11.6	101.3	13.5	61.6
May	141	+20.1	109.5	14.6	70.1
June	172	+23.4	112.5	15.0	73.4
July	202	+20.4	109.8	14.6	70.4
August	233	+12.0	101.6	13.5	62.0
September	264	+0.8	90.6	12.1	50.8
October	294	-10.5	79.2	10.6	39.5
November	325	-19.8	71.0	9.5	30.2
December	355	-23.4	67.5	9.0	26.6

Show more
Source: Computed using the Spencer (1971) declination formula, consistent with Duffie & Beckman (2013), Table 1.6.1 [4].

Equation of Time — Monthly Values (21st of Each Month)
Month	EoT (minutes)	Direction	Physical Cause
Jan	-11.3	Sun slow	Eccentricity dominant
Feb	-14.0	Sun slow	Eccentricity dominant
Mar	-7.5	Sun slow	Transition
Apr	+1.2	Sun fast	Obliquity dominant
May	+3.5	Sun fast	Obliquity dominant
Jun	-1.5	Sun slow	Transition
Jul	-6.3	Sun slow	Eccentricity dominant
Aug	-3.3	Sun slow	Transition
Sep	+6.5	Sun fast	Combined
Oct	+15.4	Sun fast	Combined
Nov	+14.2	Sun fast	Eccentricity + obliquity
Dec	+1.6	Sun fast	Transition

Show more
Source: Spencer (1971), verified against USNO solar tables [6].

Frequently Asked Questions
Q: How accurate is this calculator compared to the full NREL SPA?

This calculator uses the Spencer (1971) Fourier series approximation for solar declination and the Equation of Time, which achieves accuracy of approximately \textpm 0.01\textdegree for the solar altitude and azimuth. The full NREL SPA (Reda & Andreas, 2004) achieves \textpm 0.0003\textdegree by computing the complete orbital elements including nutation, aberration, and delta-T corrections [2]. For architectural and solar engineering applications — where site survey accuracy, atmospheric refraction, and cloud cover introduce far larger uncertainties — the Spencer approximation is more than sufficient. The full SPA matters for concentrated solar power (CSP) tracking systems where pointing accuracy of arc-minutes is required.

Q: Why does the equinox sunrise azimuth deviate slightly from exactly 90\textdegree?

Two reasons. First, the Spencer (1971) declination formula is a truncated Fourier series that may not produce exactly 
δ
=
0
δ=0 on the astronomical equinox date. Second, atmospheric refraction bends sunlight upward by approximately 0.57\textdegree at the horizon, making the sun appear to rise slightly earlier and set slightly later than geometric calculations predict [11]. This calculator does not include refraction correction, so any sub-0.1\textdegree deviation in TC-003/TC-004 is due to the declination approximation, not refraction.

Q: How do I determine the optimal solar panel tilt angle for my location?

For a fixed south-facing panel (northern hemisphere) or north-facing panel (southern hemisphere), the annual-optimal tilt angle is approximately equal to the site latitude: 
β
opt
≈
∣
ϕ
∣
βopt​≈∣ϕ∣ [8]. This balances the high summer sun (when a flatter panel captures more) against the low winter sun (when a steeper panel captures more). Click Optimize Panel Tilt in the calculator to see the exact curve for your latitude. If you want to maximize winter production (e.g., for a heating system), add 10-15\textdegree to the latitude. For summer emphasis (e.g., pool heating), subtract 10-15\textdegree. Two-axis tracking can increase annual yield by 25-40% over a fixed-tilt system, but at significantly higher cost and maintenance [12].

Q: What is the shadow ratio and how do architects use it?

The shadow ratio 
L
/
H
=
cot
⁡
(
α
)
=
1
/
tan
⁡
(
α
)
L/H=cot(α)=1/tan(α) gives the shadow length as a multiple of the object height [3]. When 
α
=
45
α=45\textdegree, the shadow equals the object height (
L
/
H
=
1
L/H=1). At low winter sun angles (
α
=
20
α=20\textdegree), the ratio jumps to 2.75 — a 10 m building casts a 27.5 m shadow. Architects use this ratio to determine building setbacks: if a zoning ordinance requires that a new tower not shadow the adjacent park at noon on December 21, the minimum setback equals 
H
×
cot
⁡
(
α
winter noon
)
H×cot(αwinter noon​). Urban planners in cities like Vancouver and San Francisco codify shadow limits in their zoning regulations.

Q: How does latitude affect the symmetry of the sun path diagram?

At the equator (
ϕ
=
0
ϕ=0), the summer and winter solstice sun paths are symmetric about the east-west axis, and the equinox path passes directly through the zenith (altitude 90\textdegree at noon). As latitude increases, the diagram shifts: in the northern hemisphere, the summer arc swings northward and the winter arc compresses toward the southern horizon. At the Arctic Circle (
ϕ
=
66.56
ϕ=66.56\textdegree), the summer solstice arc becomes a complete circle (midnight sun) and the winter solstice sun does not rise at all. The tropics (23.44\textdegree N/S) mark the latitudes where the sun can reach the zenith at solar noon — useful for sizing horizontal shading devices on flat-roofed commercial buildings [3].

Q: What is the Equation of Time and why does it matter for sun path calculations?

The Equation of Time (EoT) is the difference between apparent solar time (as measured by a sundial) and mean solar time (as kept by a clock). It varies from approximately -14.2 minutes in mid-February to +16.4 minutes in early November [6]. The EoT arises from two factors: Earth's orbital eccentricity (the orbit is an ellipse, not a circle, so Earth moves faster near perihelion in January) and the obliquity of the ecliptic (the tilt of Earth's axis causes the projection of the sun's motion onto the celestial equator to be non-uniform). For solar design, the EoT matters when converting between clock time and solar time to determine the actual moment of solar noon, which can differ from 12:00 local standard time by up to 30 minutes depending on longitude within the time zone and the date.

References
[1] Duffie, J. A., & Beckman, W. A. (2013). Solar Engineering of Thermal Processes (4th ed.). Wiley. ISBN 978-0470873663. Chapter 1: Solar Radiation.

[2] Reda, I., & Andreas, A. (2004). Solar position algorithm for solar radiation applications. Solar Energy, 76(5), 577-589. https://doi.org/10.1016/j.solener.2003.12.003

[3] Szokolay, S. V. (2008). Introduction to Architectural Science: The Basis of Sustainable Design (2nd ed.). Elsevier. ISBN 978-0750687041.

[4] Spencer, J. W. (1971). Fourier series representation of the position of the sun. Search, 2(5), 172. Reprinted in Meeus (1998).

[5] Meeus, J. (1998). Astronomical Algorithms (2nd ed.). Willmann-Bell. ISBN 978-0943396613. Chapter 13: Solar Coordinates.

[6] U.S. Naval Observatory. (2023). The Astronomical Almanac. U.S. Government Publishing Office. https://aa.usno.navy.mil/data/Sun

[7] Kasten, F., & Young, A. T. (1989). Revised optical air mass tables and approximation formula. Applied Optics, 28(22), 4735-4738. https://doi.org/10.1364/AO.28.004735

[8] Jacobson, M. Z., & Jadhav, V. (2018). World estimates of PV optimal tilt angles and ratios of sunlight incident upon tilted and tracked PV panels relative to horizontal panels. Solar Energy, 169, 55-66. https://doi.org/10.1016/j.solener.2018.04.030

[9] ASHRAE. (2021). ASHRAE Handbook: Fundamentals. Chapter 14: Climatic Design Information. American Society of Heating, Refrigerating and Air-Conditioning Engineers.

[10] Olgyay, V., & Olgyay, A. (1957). Solar Control and Shading Devices. Princeton University Press. Reprinted 2015.

[11] Iqbal, M. (1983). An Introduction to Solar Radiation. Academic Press. ISBN 978-0123737502.

[12] Breyer, C., et al. (2017). On the role of solar photovoltaics in global energy transition scenarios. Progress in Photovoltaics: Research and Applications, 25(8), 727-745. https://doi.org/10.1002/pip.2885

[13] National Renewable Energy Laboratory. (2023). National Solar Radiation Database (NSRDB). NREL. https://nsrdb.nrel.gov/

About the Data
Solar declination values in the reference table are computed using the Spencer (1971) Fourier series approximation, which is accurate to \textpm 0.01\textdegree and consistent with the simplified formula 
δ
=
23.45
×
sin
⁡
(
360
/
365
×
(
284
+
n
)
)
δ=23.45×sin(360/365×(284+n)) widely used in solar engineering textbooks [1]. Equation of Time values follow the Spencer (1971) formula verified against the U.S. Naval Observatory astronomical tables [6]. Clear-sky irradiance uses the Hottel (1976) transmittance model as simplified by Duffie & Beckman [1]. All computed values apply to idealized clear-sky conditions at sea level; actual site irradiance depends on cloud cover, aerosols, altitude, and local horizon obstructions. For project-level energy estimates, use measured solar resource data from NSRDB, Meteonorm, or local meteorological stations.

How to Cite
To cite this simulation in an academic or professional report:

Simulations4All Team. (2026). Sun Path Diagram Tool: Solar Position Calculator for Architecture & Solar Design [Interactive simulation]. Simulations4All. https://simulations4all.com/simulations/sun-path-diagram-tool

APA 7th edition:

Simulations4All Team. (2026). Sun path diagram tool: Solar position calculator for architecture & solar design. Simulations4All. https://simulations4all.com/simulations/sun-path-diagram-tool

Note: This tool is for educational and preliminary design purposes. All solar analysis for building permits, energy compliance, or solar installation design must be verified using site-specific solar resource data and reviewed by a licensed professional. Consult ASHRAE Fundamentals, local building codes, and applicable daylighting standards (IES LM-83, EN 17037) for all design decisions.
```