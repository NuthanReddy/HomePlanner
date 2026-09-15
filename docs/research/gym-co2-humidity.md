# Gym CO2 and humidity simulator research

Research date: **2026-09-10**. Source:
[Simulations4All Gym CO2 & Humidity Build-Up Simulator](https://simulations4all.com/simulations/gym-co2-humidity-buildup-simulator).

Status: article extracted and embedded transient simulator inspected.

## Page scope

The page models minute-by-minute CO2 and moisture for a fitness space using
occupant count, activity MET, room volume, outdoor conditions and supply/outdoor
air. It compares constant-volume, demand-controlled and economizer-assisted
ventilation and reports ASHRAE-oriented compliance.

## Observed calculator

Presets: Yoga Class, HIIT Session, Basketball Game, Empty Gym and Custom.

| Input | Default | Range/options |
| --- | ---: | --- |
| Room L / W / H | 30 / 20 / 4.5 m | 5-60 / 5-40 / 2.5-10 |
| Occupants | 25 | 0-200 |
| Activity | 3 MET | 1-12 |
| Strategy | CAV | CAV, DCV, economizer + DCV |
| Supply airflow | 2,000 CFM | 200-20,000 |
| Minimum outdoor-air fraction | 20% | 10-100% |
| Outdoor CO2 | 420 ppm | 350-600 |
| Outdoor temperature / RH | 30 C / 50% | -10-45 C / 10-95% |
| Duration | 60 min | 10-240 |

Actions: run, reset and export report. Views: timeline, CO2 particles, humidity
gauge, ventilation airflow and ASHRAE compliance. Result cards report peak CO2,
peak RH, effective ACH and compliance; they are blank until the simulation is
run.

## Stated model

- CO2 generation is proportional to MET and DuBois body surface area.
- Body area is calculated from height and mass, although those are not visible
  calculator inputs; fixed person assumptions therefore appear to be embedded.
- CO2 uses a transient well-mixed mass balance solved by forward Euler at a
  stated 10-second step.
- Moisture generation derives from metabolic heat, a MET-dependent latent
  fraction and latent heat of vaporization.
- Humidity is advanced as humidity ratio and converted with a saturation-vapor-
  pressure expression.
- Outdoor flow is supply CFM multiplied by outdoor-air fraction, modified by
  the selected strategy.

## Important source inconsistency

The article first states an ASHRAE health-club/aerobics requirement of
`20 CFM/person + 0.06 CFM/ft2`, but its later numbered formula states
`7.5 CFM/person + 0.06 CFM/ft2`. This material conflict changes the compliance
result and must be resolved directly against the cited standard and exact
occupancy category before either value is used.

## Review findings

1. **Well-mixed assumption.** Real gyms have stratification, supply short-
   circuiting, localized occupancy and sensor placement effects.
2. **Supply CFM is not outdoor CFM.** The outdoor fraction and delivered
   distribution must remain explicit.
3. **CO2-based DCV does not control every moisture case.** Humid outdoor air and
   activity moisture can require dehumidification even at acceptable CO2.
4. **Economizer logic needs enthalpy/control detail.** Outdoor temperature alone
   is insufficient in humid climates.
5. **Fixed body characteristics are hidden.** Activity source rates need
   population assumptions and sensitivity analysis.
6. **Compliance is not established by one simulation.** Standard edition,
   category, design population, distribution and controls need project review.

## HomePlanner relevance

The transient mass-balance and scenario playback are reusable patterns for
residential gatherings or exercise rooms. HomePlanner should first support
explicit occupancy schedules and delivered outdoor airflow, and should keep
CO2, humidity and thermal comfort as distinct result channels.

## Complete page-content coverage

The page provides an introduction to gym IAQ, a parameter table, preset
activities, run/reset/export controls, timeline and airflow views, and
compliance cards that populate after a simulation is run. It explains
metabolic CO2, latent moisture, transient well-mixed balances, outdoor-air
fraction, CAV, DCV and economizer-assisted strategies.

The learning activities cover a baseline yoga class, a high-intensity
interval-training stress test, the advantage of an economizer and a humidity
control challenge. Reference data describe activity MET levels and source
assumptions. Applications include fitness-facility design, sensor/control
discussions and scenario-based ventilation planning.

The page includes common-mistake guidance, an FAQ, references, citation
instructions and verification material. The conflicting 20-versus-7.5
CFM/person statements are preserved as an unresolved source issue; the
calculator must not be used for a compliance claim until the exact standard,
space category and edition are reconciled.
