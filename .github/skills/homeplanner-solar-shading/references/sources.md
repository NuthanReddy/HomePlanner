# Solar and shading sources

These original summaries establish conventions and limitations, not a new
astronomy implementation or a certification of site conditions.

## 1. SunCalc — upstream version 2.0.1 README

- URL: https://raw.githubusercontent.com/mourner/suncalc/v2.0.1/README.md
- Checked: 17 Sep 2026.
- Establishes: solar apparent altitude and north-clockwise azimuth are degrees.
  Sun events are absolute instants; absent crossings are null, with explicit
  polar-state flags. Displaying a local clock requires a named time zone.
- Limits: this is a version-pinned API source. Upstream accuracy statements do
  not validate HomePlanner's geometry, event presentation or sampling. Earlier
  SunCalc conventions are incompatible; do not use v1 angle conversion examples.
- Application: keep the local bundle/adapter as the single ephemeris. Verify
  cardinal directions, apparent altitude, absent events and degree-to-vector
  conversion against the bundled API, not a second online calculator.

## 2. IANA — Time Zone Database

- URL: https://www.iana.org/time-zones
- Checked: 17 Sep 2026.
- Establishes: local-time rules reflect historical and political changes in UTC
  offsets, boundaries and daylight-saving practice; implementations need updated
  rule data rather than an offset inferred from longitude.
- Limits: the database is rule data, not a building location service. Browser/OS
  tzdata versions can differ, and converting an ambiguous local wall time still
  requires an explicit application policy.
- Application: resolve and record UTC instants plus IANA zone and occurrence.
  Test skipped/repeated times, non-whole-hour offsets and actual civil-day duration.
  Do not assume every date contains 24 hours or repair a skipped time silently.

## 3. EnergyPlus 25.1 — Shading Module

- URL: https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/shading-module.html
- Publisher/content: EnergyPlus Engineering Reference; public HTML mirror
  published by Big Ladder Software.
- Checked: 17 Sep 2026.
- Establishes: sunlit receiving areas depend on solar direction, surface geometry
  and overlap with obstructions. The documentation distinguishes world and relative
  frames and describes surface normals and solar incidence.
- Limits: its polygon/solar procedures are not the repository's midpoint-ray
  implementation. Matching the concept does not imply EnergyPlus equivalence,
  identical tolerances or inherited validation.
- Application: use actual extents, height/datum, orientation and occluders; avoid
  double transformations or double-counted shaded area. Verify analytical shadow
  lengths and refine spatial/temporal sampling. Geometric sunlight is not weather
  irradiance, heat gain, visible illuminance or legal setback approval.

## 4. NOAA/GML — Solar Calculation Details

- URL: https://gml.noaa.gov/grad/solcalc/calcdetails.html
- Checked: 17 Sep 2026.
- Establishes: observed sunrise/sunset can differ from astronomical calculations
  because atmospheric refraction depends on conditions; shallow solar paths at
  high latitude amplify those differences.
- Limits: this page explicitly says the NOAA calculator is no longer maintained
  and cannot certify/authenticate its results. Its own date/accuracy assumptions
  are not the SunCalc contract.
- Application: use this as evidence for horizon/refraction uncertainty only, not
  as a replacement runtime or a certification source. `height/tan(altitude)` is
  especially sensitive near the horizon; numerical cutoffs must remain visible.

## Local validation boundary

`docs\sun-path.md` and `docs\building-physics.md` describe two different day
quantities: astronomical event duration and sampled direct-beam-equivalent house
sunlight. Whole-house side screens require net-plot-relative gaps; their unknown
widths are an explicit full-side approximation. Preserve unmodeled geometry,
actual storey inventory, source assumptions and sampling limitations.

Same-local-time monthly comparisons are sampled geometry studies, not annual
weather-energy calculations. Stronger claims require independently established
site/obstruction data and an appropriately validated professional workflow.
