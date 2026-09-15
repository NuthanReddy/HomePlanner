# Daylight factor calculator research

Research date: **2026-09-10**. Source:
[Simulations4All Daylight Factor Calculator](https://simulations4all.com/simulations/daylight-factor-calculator).

Status: article extracted and embedded tool inspected. Page text and observed
behavior are recorded separately; standards and accuracy claims remain
unverified against primary sources.

## Page scope

The page explains daylight factor (DF) as indoor horizontal illuminance divided
by simultaneous unobstructed outdoor horizontal illuminance under a CIE
standard overcast sky. It describes sky, externally reflected and internally
reflected components, a BRE-style average-DF estimate, uniformity, room-depth
limitations, surface reflectance and external obstruction.

It also discusses annual metrics such as sDA and ASE, LEED and WELL. Those are
context only: daylight factor is a static overcast-sky ratio and cannot by
itself calculate climate-based annual metrics, glare, direct sunlight or
circadian performance.

## Observed calculator

Presets: Office, Open Plan, Classroom, Corner and Skylit. Glazing shortcuts:
Clear, Low-E, Triple and Tint. Finish shortcuts: Standard, Light and Dark.

| Input | Default | Range/options |
| --- | ---: | --- |
| Room length / width / height | 4 / 3 / 2.8 m | 2-15 / 2-10 / 2.4-5 m |
| Window width / height | 1.8 / 1.5 m | 0.5-6 / 0.5-3 m |
| Sill height | 0.9 m | 0-1.5 m |
| Visible light transmittance | 70% | 20-90% |
| Ceiling / wall / floor reflectance | 80 / 50 / 20% | 30-95 / 20-80 / 10-50% |
| Obstruction angle | 0 degrees | 0-60 degrees |
| Corner window | Toggle | Adds perpendicular glazing |
| Skylight and size | Toggle, 1.5 m | 0.5-3 m |
| Point probe | Toggle | Floor-plan sampling |

Actions include Animate/stop, Plan/Section/3D views, report export and a
knowledge check. The initial output exposed average DF, sky component,
internally reflected component, uniformity, minimum/maximum DF, probe value and
an approximate lux value based on a labelled 10,000-lux sky. A compliance tab
displayed LEED/WELL-style status, but the page does not establish that the
simple DF model performs the required annual simulations.

## Stated model

- `DF = indoor illuminance / outdoor illuminance * 100%`.
- Total DF is described as sky component + externally reflected component +
  internally reflected component.
- The article gives a split-flux-style internally reflected component.
- Its average formula is presented as approximately
  `Ag * tau * skyAngle * maintenance * frameFactor /
  (interiorArea * (1 - averageReflectance^2))`.
- Uniformity is minimum DF divided by average DF.

## Review findings

1. **Static versus annual metrics.** DF, sDA, ASE and direct-sun hours need
   separate names, solvers, weather inputs and acceptance criteria.
2. **Approximation boundary.** The article claims roughly +/-20% for ordinary
   rectangular rooms, while also offering corner windows, skylights and a 3D
   view. Those geometries require independent validation rather than inheriting
   the simple method's stated accuracy.
3. **Obstruction is one angle.** A single horizon angle cannot represent
   azimuth-varying urban obstructions or reflected exterior luminance.
4. **Lux readout is conditional.** Multiplying DF by a fixed 10,000-lux outdoor
   condition is a scenario, not a measured or weather-derived illuminance.
5. **Compliance claims need primary checks.** Thresholds and point awards
   change by standard edition, space type and documentation route.

## HomePlanner relevance

HomePlanner can reuse rooms, physical openings, orientation and obstruction
geometry. A first independent feature should be an explicitly approximate
overcast-sky screen with a numerical grid and accessible table. Climate-based
daylight, glare and certification should remain unsupported until a validated
solver and weather workflow exist.

## Complete page-content coverage

The page includes a quick-start sequence, control reference, keyboard
shortcuts, animation and plan/section/3D viewing guidance, report export and a
knowledge check. It explains how to change window size and transmittance,
reflectance, sill height, obstructions, corner glazing and skylights, then
use a point probe to inspect spatial variation rather than relying only on the
average.

The article separates sky, externally reflected and internally reflected
components, explains the split-flux approximation, and discusses why
uniformity and room depth matter. Its learning activities test window-size
impact, surface finishes, corner-office benefits and deep-floor-plate
limitations. Applications and reference material discuss room-type targets,
LEED/sDA context, design iteration and the difference between a static
overcast result and annual climate-based simulation.

The page also contains challenge questions, misconception checks, an FAQ,
references, citation instructions and a verification section. The page’s
accuracy statement is limited to ordinary rectangular-room cases; the note
does not extend that claim to the optional corner, skylight or 3D scenarios.
