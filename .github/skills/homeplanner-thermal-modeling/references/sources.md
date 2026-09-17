# Thermal sources and evidence boundaries

These original summaries support dimensional/model reasoning. They do not
transfer another solver's empirical validation to HomePlanner.

## 1. EnergyPlus 25.1 — Basis for the Zone and Air System Integration

- URL: https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/basis-for-the-zone-and-air-system-integration.html
- Publisher/content: EnergyPlus Engineering Reference; public HTML mirror
  published by Big Ladder Software.
- Checked: 17 Sep 2026.
- Establishes: a zone temperature follows a heat balance involving storage,
  surface exchange, internal gains, air exchange and system loads. Moisture
  balance is a distinct part of a more complete zone model. Numerical integration
  has algorithm/time-step assumptions and truncation error.
- Limits: EnergyPlus's surface, airflow, HVAC and moisture components are not
  present in a generic RC equation. Its Euler/predictor-corrector implementation is
  not automatically identical to HomePlanner's implicit increment solve.
- Application: demand explicit effective capacity, conductances, initial state
  and all interval gains/boundaries. Verify timestep convergence independently
  of conservation; a small energy residual is not a bound on temperature error.

## 2. EnergyPlus 25.1 — Surface Construction Elements / Material

- URL: https://bigladdersoftware.com/epx/docs/25-1/input-output-reference/group-surface-construction-elements.html#material
- Publisher/content: EnergyPlus Input Output Reference; public HTML mirror
  published by Big Ladder Software.
- Checked: 17 Sep 2026.
- Establishes: material thickness, conductivity, density and specific heat are
  separate inputs with SI dimensions. Resistance-only material descriptions do
  not supply thermal storage. Visible, solar and longwave properties have
  different spectral meanings.
- Limits: sample named materials and software-specific admissibility limits are
  not universal product data or recommendations for local construction.
  HomePlanner's assembly descriptor does not implement transient layer conduction,
  cavities, bridges, moisture or surface radiative balance.
- Application: retain source/condition and explicit kJ-to-J conversion. Calculate
  homogeneous series resistance and areal heat capacity only within their stated
  assumptions; do not make areal capacity an inferred zone capacitance.

## 3. National Fenestration Rating Council — product-rating explanations

- URL: https://nfrc.org/
- Checked: 17 Sep 2026.
- Establishes: NFRC explains U-factor, solar heat gain coefficient and visible
  transmittance as different product-performance measures; its condensation
  resistance measure is also separate.
- Limits: product ratings depend on their rating basis and units. An NFRC label
  is not a whole-building forecast; condensation resistance does not establish
  a room's humidity, mold risk or occupant health.
- Application: request product-specific whole-window U, SHGC and VLT separately.
  Verify units rather than copying an unqualified U-factor number into an SI API.
  Never treat VLT as heat gain, SHGC as visible transmittance, or either as
  aerodynamic opening free area.

## Repository-specific numerical and moisture limits

`BuildingPhysics.simulateThermal` solves a lumped sensible RC network with
backward Euler. The local independent checks include the discrete single-zone
response, continuous-response refinement, adiabatic invariance and equal/opposite
interzone transfer. Per-step and per-zone ledgers must be examined in addition
to the signed run-total residual.

`docs\building-physics.md` and `docs\environment-analysis.md` describe explicit
initial conditions, no automatic warmup and no weather/airflow/solar coupling.
Imported outdoor RH does not provide indoor humidity history, vapor transport,
latent loads, moisture storage, surface condensation or mold-growth physics.
Mark those requests unsupported unless both the necessary model and boundary
evidence are actually implemented and separately validated.
