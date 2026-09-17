# Geometric sky access and transmitted hours

Checked **17 Sep 2026**. Read [source/method limits](sources.md), the
[current light foundation](../../../../docs/light-visualizer.md) and
[daylight-calculator review](../../../../docs/research/daylight-factor-calculator.md).
The historical calculator's lux, DF and certification labels do not redefine
HomePlanner's implemented geometric quantities.

## Symbols, units and reference plane

| Symbol | Meaning | Unit / domain |
| --- | --- | --- |
| `T(omega)` | Known transmission along a ray toward the sky | fraction 0..1 |
| `theta` | Angle from upward horizontal-workplane normal | radians, 0..pi/2 |
| `phi` | Azimuth in the chosen local quadrature frame | radians, 0..2pi |
| `dOmega` | Solid-angle element `sin(theta)dtheta dphi` | sr |
| `A` | Cosine-weighted normalized sky access | dimensionless, 0..1 |
| `ai` | Actual clipped usable sensor-fragment area | m², positive |
| `dt` | Interval's elapsed UTC duration | s |
| `E` | Illuminance, only for an independently supplied photometric model | lux = lm/m² |

The physical workplane z is `floorElevationM + suppliedHeightM`, applied once.
Use the real room's clipped `usableRegions`, not its bounding rectangle or a
default furniture height. A full lift/stair wall-inclusive reservation is not
a sensor surface for its host.

## Normalized cosine integral

```text
A = (1/pi) integral_upper_hemisphere T(omega)*cos(theta)*dOmega
```

The denominator is pi because the cosine integral of the full hemisphere is
pi. It is not the unweighted 2pi solid angle. For a uniform T=tau, A=tau.
An opaque hemisphere gives 0; one unobstructed azimuthal half gives 0.5.
This is uniform-sky geometric/path access, with no photometric source scaling,
interreflections or electric lights.

For the midpoint quadrature used by the current model, set `u=sin²(theta)`:

```text
cos(theta)*sin(theta)*dtheta = du/2
A = (1/(2*pi)) integral_0^1 integral_0^(2*pi) T(u,phi) dphi du
u_j = (j+0.5)/Nr               phi_k = 2*pi*(k+0.5)/Nphi
directionLocal = (sqrt(u)*cos(phi), sqrt(u)*sin(phi), sqrt(1-u))
A_approx = sum_jk(T(direction_jk))/(Nr*Nphi)
```

Those x/y directions are in the selected local quadrature frame, not necessarily
east/north. Rotate/reflect once with the shared site-to-world transform.
For an ideal unobstructed zenith cone `theta <= thetaMax`,
`A = sin²(thetaMax)` analytically. Discontinuous aperture/shadow boundaries can
alias under midpoint sampling; refine directions and spatial cells separately,
without promising monotonic convergence.

Across positive sensor fragments, the room area-weighted mean is
`Aroom=sum(ai*Ai)/sum(ai)`. Missing Ai prevents a complete mean, and no usable
area yields no mean (`null`), not zero sky access.

## Distinct direct-sun metrics

For known interval path transmissions:

```text
presenceHours = sum(1[T_i>0] * dt_i/3600)
transmittedEquivalentHours = sum(T_i * dt_i/3600)
```

At night direct-path values can be known zero; the static sky fraction is not
zeroed by night. Missing/unprocessed, near-horizon unresolved, disabled-sky or
unknown-neighbor evidence is **unknown**, not blocked. Full-period totals
require full coverage. Keep model-only and primary complete evidence distinct.

For contrast only, daylight factor is
`DF_percent = 100*Einside/Eoutside` for the defined simultaneous unobstructed
outdoor condition under the specified overcast sky, with Eoutside > 0.
The current A is not that DF, and multiplying A by an assumed outdoor lux does
not implement DF or a calibrated indoor illuminance model.
Annual sDA/ASE/UDI and glare need their own source/optics/schedule/metric methods.

## Worked synthetic examples

- Full sky: A=**1**. Opaque sky: **0**. Clear azimuthal half: **0.5**.
- That half transmitting 0.6 gives A=**0.3**.
- Clear cone through thetaMax=60°: A=sin²60°=**0.75**.
  The example's radial grid aligns this special case; that is not a universal
  aperture error bound.
- Fragments 1 m² at A=0.2 and 3 m² at A=0.6 yield mean **0.5**, not 0.4.
- A 1 h path at T=0.4 followed by 0.5 h at known T=0 gives
  **1 presence h**, **0.4 equivalent h**, with **1.5 h known coverage**.
  Replacing the second value by unknown leaves both full-period totals null.

The [stdlib example](../scripts/example.py) calculates these cases and renders
their actual fractions as labelled SVG bars, not an invented room heatmap.

## Domain, current implementation and sources

Require finite fractions, positive finite durations/areas, complete matching
sensor arrays and bounded positive integer quadrature counts. Reject out-of-range
transmission and invalid directions/inputs rather than clamping. Zero transmission
is a valid known result; absent transmission is not. These quadrature examples
do not reproduce finite-reveal ray intersection or arbitrary scene topology.

`HomePlannerLight` currently computes geometric sky/path access and duration
over the actual captured scene, with explicit optics and worker freshness.
Radiance/Honeybee are **external reference/integration candidates**, not installed
features:

- [LBNL rtrace manual](https://radsite.lbl.gov/radiance/man_html/rtrace.1.html):
  sensor origin/orientation and irradiance versus radiance modes.
- [LBNL gendaylit manual](https://radsite.lbl.gov/radiance/man_html/gendaylit.1.html):
  defined sky scaling, visible/radiometric conventions and luminous efficacy.
  Its 179 lm/W convention is not a universal solar-W/m²-to-lux conversion.
- [EnergyPlus daylighting calculations](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/daylighting-calculations.html):
  sky luminance, glazing, geometry and reflected components, beyond A.
- [Existing external-tool research](../../../../docs/research/building-analysis-toolchain.md):
  optics, source, engine and metric completeness are separate gates.
