# HVAC load calculator research

Research date: **2026-09-10**. Source:
[Simulations4All HVAC Load Calculator (Manual J)](https://simulations4all.com/simulations/hvac-load-calculator-manual-j).

Status: article extracted and embedded calculator inspected in its initial
rendered state. This is attributed third-party research, not a copied
implementation or an independent verification of its standards claims.

## Page scope

The article presents an educational, early-sizing load calculator built around
Manual J concepts: envelope conduction, outdoor-air loads, glazing/solar gains,
internal gains, ducts and a Manual S-style equipment comparison. It correctly
argues that floor-area rules of thumb omit major load drivers, but it also calls
the tool both a "Manual J" calculator and a "Manual J style" calculator. The
latter is the safer interpretation: the page says its data are educational and
not for permit submission.

The article covers:

- conduction through opaque assemblies and fenestration;
- sensible and latent infiltration/ventilation loads;
- window U-factor, SHGC, orientation and a shading multiplier;
- occupant/internal gains and duct penalties;
- design heating/cooling temperatures;
- cooling tons, heating load, airflow and equipment/load ratio;
- imperial/SI conversion, scenarios, snapshots and report export.

## Observed calculator

The embedded tool exposes three setup tabs: **Envelope**, **Climate** and
**Equipment**. Presets are Cold/Tight, Hot/Humid, Mixed and Hot/Dry. It has
Imperial/SI toggles, envelope-quality shortcuts (Poor/Average/Good/High),
snapshot saving, HTML/CSV selection and report export.

| Input | Observed default | Observed range/options |
| --- | ---: | --- |
| Floor area | 2,000 ft2 | 400-4,500; step 50 |
| Ceiling height | 8 ft | 7-12; step 0.5 |
| Window type | Low-E, U 0.32 | Single 1.05; double 0.50; Low-E 0.32; triple 0.22 |
| Glazing percentage | 18% | 5-35% |
| Orientation | South | North, east, south, west |
| Shading multiplier | 0.90 | 0.60-1.20 |
| Wall / roof / floor R | 13 / 30 / 19 | 8-30 / 15-70 / 10-50 |
| Climate | Mixed | Cold, mixed, hot-humid, hot-dry, marine, custom |
| Indoor heat / cool setpoint | 70 / 75 F | 60-75 / 70-78 F |
| Outdoor heat / cool design | 20 / 90 F | -10-50 / 75-110 F |
| Air changes | 0.45 ACH | 0.15-1.50 |
| Mechanical ventilation | 50 CFM | 0-120 |
| Occupants | 4 | 1-8 |
| Internal gains | 2,000 BTU/h | 500-6,000 |
| Duct location / loss | Conditioned / 6% | Conditioned, attic, basement / 0-20% |
| Equipment size | 3 tons | 1-8; step 0.25 |
| Room count / bias | 4 / 1.00 | 2-8 / 0.70-1.30 |

The initial results showed cooling BTU/h and tons, heating BTU/h, airflow CFM
and equipment capacity as a percentage of calculated cooling load. A canvas
breakdown labelled sensible, latent, infiltration and solar components. The
article also describes room allocation, report detail and before/after
snapshots.

## Stated model

- Envelope: `Q = U * A * deltaT`, with `U = 1 / R`.
- Sensible air load: `Q = 1.08 * CFM * deltaT`.
- Latent air load: `Q = 0.68 * CFM * deltaGrains`.
- Cooling capacity: `tons = total BTU/h / 12,000`.
- ACH is converted to flow from building volume; controlled ventilation is
  added separately.
- Duct loss is represented as a percentage penalty rather than a duct-network
  heat-transfer/air-leakage calculation.
- Solar gain is parameterized by glazing, SHGC/type, orientation and shading,
  but the article does not establish an hourly weather or full Manual J
  fenestration procedure.

## Review findings

1. **Not compliance software.** A real Manual J submission requires the current
   ACCA procedure, local design data, complete assemblies, room-by-room inputs
   and approved software/reporting. The simplified calculator cannot establish
   equipment size, permit compliance or duct design.
2. **Air constants are conditional.** The 1.08 and 0.68 imperial constants
   depend on standard air/property conventions. SI conversion should derive
   from mass flow and psychrometrics rather than only relabeling constants.
3. **ACH meaning is unclear.** The control is labelled ACH, not ACH50. Natural
   infiltration, test pressure, shielding and stack/wind conversion must not be
   conflated.
4. **Solar method needs definition.** A scalar orientation/shading factor is
   useful for teaching but is not a replacement for site/time/weather geometry.
5. **Manual S comparison is indicative.** Equipment nominal tons do not prove
   sensible/latent capacity at design conditions.

## HomePlanner relevance

Reuse project geometry, openings, material U-values, weather provenance and
explicit occupancy schedules. A future load screen should separate peak
heating, sensible cooling and latent cooling; expose every assumed boundary;
and provide an expert handoff rather than branding an estimate as Manual J.

## Complete page-content coverage

The page also provides a guided operating workflow: choose a preset, review
the envelope, climate and equipment tabs, run the estimate, inspect the
component chart, save a snapshot, compare a change, and export an HTML or CSV
report. Keyboard shortcuts, reset/animation controls, and tips emphasize
changing one assumption at a time, using measured or documented assembly
values, and treating the result as an early design estimate.

Its educational material explains why floor-area rules of thumb fail, how
Manual J differs from Manual S, why design temperatures and safety margins
matter, and how insulation, air sealing, glazing, orientation, duct location,
occupancy and equipment selection interact. The suggested explorations cover
air-sealing sensitivity, window upgrades, attic versus conditioned ducts and
orientation stress tests. Applications include equipment sizing discussions,
energy-audit scenarios, HVAC proposals, early glazing decisions and room-level
airflow planning.

The page includes reference data, challenge questions, misconception checks,
an FAQ, citation guidance, a verification log and related Simulations4All
tools. Those sections repeat that the calculator is educational, that local
weather, complete assemblies, room-by-room data and current ACCA procedures
are required for professional work, and that the reported verification cases
are claims made by the page rather than independent validation.
