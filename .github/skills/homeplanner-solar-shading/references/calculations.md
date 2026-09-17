# Solar directions, shadows and interval totals

Checked **17 Sep 2026**. Preserve the [local source conventions](sources.md),
[sun-path contract](../../../../docs/sun-path.md) and the corrections in the
[existing sunpath research](../../../../docs/research/sunpath.md). That older
research is a historical gap list, not authority over newer implementation.
No reference here implements a second production ephemeris.

## Symbols and conventions

| Symbol | Meaning | Unit / sign |
| --- | --- | --- |
| `alpha` | Supplied apparent solar altitude | degrees, horizon 0, zenith 90 |
| `A` | Solar azimuth | degrees clockwise from true north: N0/E90/S180/W270 |
| `s=(sE,sN,sU)` | Unit ENU direction **toward** the sun | dimensionless |
| `h,L` | Vertical pole height and level-ground shadow length | m |
| `n` | Supplied outward unit surface normal in ENU | dimensionless |
| `tau` | Direct-path transmission | fraction 0..1 |
| `dt` | Actual UTC elapsed interval duration | s, positive |
| `I` | Supplied interval-average incident irradiance | W/m², not illuminance |

Convert degrees to radians before `sin/cos/tan`:

```text
sE = cos(alpha)*sin(A)
sN = cos(alpha)*cos(A)
sU = sin(alpha)
dot(s,s) = 1
```

These are **SunCalc 2 / HomeSun** conventions. Do not apply SunCalc 1's
south-origin/radian conversion. Site-local plan axes and ENU axes differ;
apply the canonical project transform once before incidence or ray tests.

## Pole and simple incidence geometry

For a vertical pole on level ground with `0 < alpha < 90°`:

```text
L = h/tan(alpha)
shadowBearing = (A + 180°) mod 360°
shadowEast = -L*sin(A)
shadowNorth = -L*cos(A)
```

At zenith, `L=0`. At/below the horizon there is **no finite daytime estimate**
(`null`), not zero shade. The limit as positive alpha approaches zero is
unbounded for positive h; show low-sun exclusion rather than clipping to a
plausible length. Zero pole height yields zero only for an above-horizon sun.
This formula does not cover slopes, finite canopies, terrain, elevated receiving
planes or arbitrary mesh intersection.

For an above-horizon sun and a supplied unit normal:
`directPlaneWm2 = DNI*max(0,dot(n,s))*tau`, where DNI is W/m².
The horizon gate matters: a tilted surface normal can face a below-horizon
direction mathematically. Diffuse and ground-reflected components require their
own explicit sky/ground model; this equation supplies neither.

## Duration, transmission and energy

For complete, nonoverlapping positive intervals:

```text
presenceHours = sum(1[tau_i>0] * dt_i/3600)
transmittedEquivalentHours = sum(tau_i * dt_i/3600)
incidentWhPerM2 = sum(I_i * dt_i/3600)
```

Only integrate known values. Missing intervals, unknown obstruction states and
omitted low-sun samples are not zeros. A 1 h path at tau=0.4 contributes 1 h of
presence and 0.4 equivalent h; neither is electrical production or lux.
When I is a midpoint sample rather than an interval average, the energy sum is
numerical quadrature; report its refinement and coverage.

Use resolved UTC instants for subtraction, not wall-clock arithmetic. IANA
civil dates can last 23/25 hours, and skipped/repeated times need explicit
resolution. EPW uses a fixed **local standard-time** offset and interval-end
weather records; do not apply IANA DST or label an interval end as its midpoint.
Astronomical sunrise-to-sunset time is not these obstruction-weighted totals.

## Worked synthetic examples

- A 2 m pole at 30°, 45°, 60° casts respectively
  **3.464101615**, **2.000000000**, **1.154700538 m** on level ground.
- At alpha=30°, A=90°, `s=(0.866025404,0,0.5)`;
  the 2 m pole shadow is **(-3.464101615,0) m**, westward.
- Two contiguous intervals of 1 h at tau=0.4 and 0.5 h at tau=0 give
  **1 presence h**, **0.4 transmitted-equivalent h**.
- Supplied interval-average irradiances 500 W/m² for 1 h and 200 W/m²
  for 0.5 h total **600 Wh/m²**. This is incident energy, not absorbed heat/PV.
- `2026-06-21T12:00:00+05:30` and `2026-06-21T06:30:00+00:00`
  represent the same instant. The example uses explicit offsets, **not** a
  substitute IANA resolver or a verified site.

The [stdlib example](../scripts/example.py) computes the numbers and a labelled
pole section SVG from the actual h/L outputs. It uses supplied angles; it cannot
benchmark SPA/SunCalc astronomical accuracy.

## Domain and implementation boundary

Reject missing/nonfinite numbers, negative heights, altitudes outside [-90,90],
transmissions outside [0,1], non-unit normals, naive timestamps, reversed/zero
durations and noncontiguous intervals when claiming a complete period.
Keep zero/night/null distinct. Finite-input operations that overflow also fail.

Current `HomeSun`, `HomeSunExposure` and `BuildingPhysics` supply astronomy,
declared geometry shadows and sampled sunlight/irradiance within their separate
contracts. PV equipment, arbitrary mesh shade and weather-energy models are not
created by an optional position library.

## Primary references

- [SunCalc 2.0.1 README](https://raw.githubusercontent.com/mourner/suncalc/v2.0.1/README.md):
  pinned local angle/event API.
- [IANA time zones](https://www.iana.org/time-zones): evolving civil-time rules.
- [EnergyPlus shading reference](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/shading-module.html):
  frames, receiving surfaces and incidence; not numerical equivalence.
- [pvlib solar position](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.get_solarposition.html):
  a separately identified optional astronomical reference, not a mesh solver.
- [NOAA solar calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html):
  horizon/refraction uncertainty; the calculator is explicitly no longer maintained.
