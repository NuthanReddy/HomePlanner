# Daylight sources and evidence boundaries

The following original summaries distinguish physically scaled photometry from
the repository's normalized geometric access metric.

## 1. Lawrence Berkeley National Laboratory — Radiance rtrace manual

- URL: https://radsite.lbl.gov/radiance/man_html/rtrace.1.html
- Checked: 17 Sep 2026.
- Establishes: ray inputs include measurement origin and direction; the `-I`
  mode interprets these as a measurement point and orientation for irradiance,
  rather than returning view radiance. Direct and indirect sampling controls
  belong to the rendering calculation.
- Limits: choosing a measurement mode is not sufficient to obtain meaningful
  illuminance. Scene geometry, source scaling, optical materials and integration
  settings still matter. HomePlanner does not execute Radiance.
- Application: retain an explicit workplane height and normal, and distinguish
  a physical quantity from its visual color encoding. A future benchmark must
  match sensor coordinates, optics, source distribution and modeled effects.

## 2. Lawrence Berkeley National Laboratory — Radiance gendaylit manual

- URL: https://radsite.lbl.gov/radiance/man_html/gendaylit.1.html
- Checked: 17 Sep 2026.
- Establishes: Perez sky calculations distinguish direct-normal and
  diffuse-horizontal components, radiometric W/m² inputs and photometric lm/m²
  inputs. Luminous-efficacy modeling and explicit output spectral conventions
  connect solar radiation with visible-light quantities.
- Limits: the Radiance 179 lm/W convention applies within its defined visible
  representation; it is not a universal conversion from broadband solar energy,
  nor any conversion from geometric access. Global-only decomposition is a
  separate approximate model with its own uncertainty.
- Application: label sky access/path transmission as dimensionless, hours as
  hours, irradiance as W/m², and illuminance as lux only when actually calculated.
  This manual's azimuth is west of south and its clock is standard/solar time:
  never import those conventions into the north-clockwise degree-based HomeSun
  API. An explicitly requested future external adapter needs its own tested mapping.

## 3. EnergyPlus 25.1 — Daylighting Calculations

- URL: https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/daylighting-calculations.html
- Publisher/content: EnergyPlus Engineering Reference; public HTML mirror
  published by Big Ladder Software.
- Checked: 17 Sep 2026.
- Establishes: reference-point daylight calculations account for sky luminance,
  glazing, geometry, direct light and interreflections; exterior illuminance and
  time/sky conditions are needed to scale daylight contributions.
- Limits: EnergyPlus uses model-specific daylight factors/coefficient procedures.
  Those are not permission to label an arbitrary visible-solid-angle fraction
  "daylight factor", nor evidence for UDI, sDA or ASE. Such metrics require their
  own formal definitions, coverage, thresholds, operating schedules and validation.
- Application: keep the current uniform-sky access index separate from absolute
  indoor illumination. Do not imply missing reflection, weather or electric-light
  physics merely because their inputs appear in another program's documentation.

## Repository-specific benchmark

`HomePlannerLight.createStudy` integrates transmission times cosine weighting
over a horizontal upper hemisphere, normalized by pi. Its local benchmark
integrates a finite-reveal vertical aperture independently and checks successively
refined directional and spatial grids. Full/blocked/half-sky fixtures test the
normalization; they do not calibrate indoor illuminance.

The current `docs\light-visualizer.md`, `docs\light-display.md` and named tests
define masks, committed intervals, usable-region fragments and primary versus
supplied-model evidence. Discontinuous visibility can alias under midpoint
sampling; report convergence experiments rather than universal accuracy or
monotonicity. No current lux, daylight-factor, UDI, sDA or ASE claim is supported.
