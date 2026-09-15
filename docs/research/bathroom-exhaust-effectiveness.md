# Bathroom exhaust effectiveness research

Research date: **2026-09-10**. Source:
[Simulations4All Bathroom Exhaust Effectiveness Explorer](https://simulations4all.com/simulations/bathroom-exhaust-effectiveness-explorer).

Status: article extracted and live calculator inspected. This page states its
scope more carefully than most reviewed references.

## Page scope

The calculator is an educational well-mixed, isothermal post-shower dilution
scenario. The user supplies a starting RH and **delivered** exhaust airflow. It
does not generate shower moisture or calculate psychrometric humidity ratio,
duct/static-pressure loss, infiltration, condensation, surface drying or mold.

The article cites ASHRAE 62.2-2022 values while explicitly noting that a 2025
edition exists and that the screen is not current-code compliance.

## Observed calculator

Presets: Half-Bath, Standard Bath, Master with Tub and Large with Shower+Tub.

| Input | Default | Range/options |
| --- | ---: | --- |
| Room L / W / H | 8 / 5 / 8 ft | 4-20 / 3-15 / 7-12 |
| Delivered exhaust | 80 CFM | 0-200 |
| Fan power / sound | 30 W / 1.5 sones | 10-120 / 0.3-6 |
| Strategy | Timer | Timer, humidistat, occupancy, continuous |
| Timer | 20 min | 5-60 |
| RH target | 55% | 40-70% |
| Door undercut / width | 0.75 / 30 in | 0-2 / 24-36 |
| Makeup-air / initial RH | 40 / 95% | 20-70 / 20-99% |
| Occupancy event duration | 10 min | 0-30; adds five-minute post-run |
| Daily events | 2 | 0-6 |
| Playback speed | 1x | 0.25-4x |

The tool has play/pause/stop animation, a main dilution canvas, a strategy
comparison canvas and HTML report export. Result cards show volume, delivered
ACH, the 62.2-2022 airflow reference, geometric door opening/check, time to
target RH, a sone-reference check and target outcome.

## Stated model

- `ACH = 60 * Q / V`, with Q in CFM and V in ft3.
- `RH(t) = RHa + (RH0 - RHa) * exp(-Q * t / V)`.
- Reach time:
  `t = V / Q * ln((RH0 - RHa) / (RHtarget - RHa))`.
- If target is at/below makeup-air RH, no finite ventilation-only result is
  reported.
- Door geometry is reported but deliberately does not generate a CFM derating.
- Strategy energy uses entered fan watts, runtime/event assumptions and a
  displayed $0.15/kWh scenario tariff.

## Review findings

1. The exponential use of RH is only defensible under the page's equal-
   temperature passive-scalar assumption. A general moisture model must use
   humidity ratio/mass.
2. Wet surfaces and continuing evaporation often control real drying after the
   air initially clears; the result is not a bathroom drying time.
3. Delivered airflow must come from measurement or an installed-condition fan
   curve. Box CFM and door-gap area are not delivered CFM.
4. Sound and airflow references are edition- and test-condition-specific.
5. An RH target does not establish mold safety, material dryness or compliance.

## HomePlanner relevance

This is a strong candidate for a deliberately bounded educational scenario.
HomePlanner should connect room volume and an explicit delivered airflow while
keeping initial/makeup RH user supplied. A later psychrometric model must be a
separate capability, not an invisible reinterpretation of this equation.

## Complete page-content coverage

Unlike the longer calculator pages, this page is intentionally compact. Its
full content is organized around the quick answer, scope definition, inputs
and assumptions, makeup-air and duct discussion, runtime/energy comparison,
worked example, non-claims, references, verification notes and citation
guidance. It explains how to select a bathroom preset, enter delivered CFM,
set a target RH and compare timer, humidistat, occupancy and continuous
strategies.

The worked example and strategy comparison are illustrative scenarios. The
page repeatedly separates room-air dilution from wet-surface drying,
psychrometrics, duct design, code compliance and mold diagnosis. Related
simulation links are included for broader IAQ, airflow and HVAC analysis.
