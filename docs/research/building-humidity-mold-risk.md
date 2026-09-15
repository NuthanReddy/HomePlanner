# Building humidity and mold-risk research

Research date: **2026-09-10**. Source:
[Simulations4All Building Humidity & Mold Risk Explorer](https://simulations4all.com/simulations/building-humidity-mold-risk-explorer).

Status: article extracted and embedded calculator inspected.

## Page scope

The page combines psychrometric properties, a steady-state wall temperature and
vapor-pressure profile, a Glaser-method condensation screen, a simplified
VTT/ASHRAE 160-oriented mold index and a steady ventilation moisture balance.
It repeatedly notes that moisture risk depends on temperature, RH, material and
duration, although some marketing language overstates what a simplified tool
can diagnose.

## Observed calculator

Presets: Cold Climate, Hot-Humid, Temperate and Tropical. Material sensitivity:
Very Sensitive, Sensitive, Medium and Resistant. Views: Psychrometric, Wall
Assembly, Mold Risk and Ventilation.

| Input | Default | Range |
| --- | ---: | ---: |
| Indoor temperature / RH | 21 C / 55% | 10-35 C / 20-95% |
| Outdoor temperature / RH | -15 C / 75% | -40-50 C / 20-100% |
| Wall thermal resistance | 3.5 m2 K/W | 0.5-10 |
| Interior / exterior film resistance | 0.13 / 0.04 m2 K/W | 0.04-0.30 / 0.02-0.15 |
| Vapor permeance | 1 perm | 0.01-10 |
| Exposure duration | 720 h | 1-8,760 |
| Ventilation | 0.5 ACH | 0.1-5 |
| Room volume | 75 m3 | 10-500 |
| Moisture generation | 0.5 kg/h | 0-3 |

There are four chart canvases, a "Find Safe Operating Conditions" action and
report export. Initial result cards showed dew point, interior surface
temperature, condensation yes/no and mold index.

## Stated model

- Saturation vapor pressure uses a modified Antoine/Magnus-style exponential
  expression.
- Dew point is inverted from vapor pressure.
- Humidity ratio is
  `0.62198 * Pv / (Patm - Pv)`.
- Interior surface temperature is
  `Ti - Rsi / (Rsi + Rwall + Rse) * (Ti - To)`.
- The wall screen compares actual and saturation vapor pressure through the
  assembly.
- Mold growth is presented as a sensitivity- and RH-dependent rate integrated
  over exposure time.
- The room moisture balance relates generation to ventilation mass flow and
  indoor/outdoor humidity-ratio difference.

## Review findings

1. **Glaser is steady state.** It omits rain, capillary/liquid transport,
   sorption/storage, construction moisture, solar effects and transient
   reversal. Hygroscopic or complex assemblies need hygrothermal simulation.
2. **One wall R-value is not an assembly.** Layer order, vapor resistance by
   layer, thermal bridges and air leakage determine the actual condensation
   plane.
3. **Mold index is not a diagnosis.** Material sensitivity, surface conditions,
   cleaning, spores and real exposure history are uncertain. It cannot support
   a health conclusion.
4. **Ventilation can add moisture.** ACH alone does not guarantee drying when
   outdoor humidity ratio is high.
5. **Standard claims need exact algorithms.** The article presents a compact
   growth-rate expression; do not label an implementation "VTT" or
   "ASHRAE 160" without reproducing the selected published procedure and
   reference cases.

## HomePlanner relevance

Reuse explicit indoor/outdoor psychrometric states and material layers only
after the project model supports their provenance. A safe initial feature is
surface-temperature/dew-point screening with strong assumptions. Interstitial
condensation and mold-growth predictions should remain expert integrations.

## Complete page-content coverage

The page guides the reader through the psychrometric, wall-assembly,
mold-risk and ventilation views, preset selection, material sensitivity,
exposure duration and the “find safe operating conditions” action. It
explains the difference between dew point, surface temperature, vapor
pressure, condensation and accumulated mold index.

The learning activities cover cold-climate condensation, material sensitivity,
ventilation optimization and wall-R-value changes. Applications and reference
tables discuss typical moisture generation, material RH sensitivity and
climate design conditions. The article contrasts simple RH thresholds with a
time-dependent mold index and discusses ERV/HRV effects, insulation placement
and why ventilation can either remove or introduce moisture.

The page includes common-mistake guidance, an FAQ, references, citation
instructions and verification material. Its claims are retained as
article-attributed claims; they are not treated as proof that the compact
Glaser or mold-index implementation reproduces EN ISO 13788, VTT or ASHRAE
160 in full.
