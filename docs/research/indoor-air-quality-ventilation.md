# Indoor air quality and ventilation calculator research

Research date: **2026-09-10**. Source:
[Simulations4All Indoor Air Quality & Ventilation Calculator](https://simulations4all.com/simulations/indoor-air-quality-ventilation-calculator).

Status: article extracted and all visible embedded-tool modules inspected.

## Page scope

This is the broadest reviewed calculator. It combines an ASHRAE 62.1-style
Ventilation Rate Procedure (VRP), steady/transient CO2, generic pollutant
decay, multi-zone ventilation efficiency, MERV filtration comparison,
ventilation heating/cooling load, and WELL-oriented checks.

The article emphasizes that people and area ventilation components address
different source categories and that supply-air distribution effectiveness
changes the required zone outdoor airflow.

## Observed calculator

Presets: Open Office, Classroom, Conference Room, Restaurant, Hospital Ward,
Retail Store, Gymnasium and Custom. Modules: VRP, DCV/CO2, Pollutants,
Multi-Zone, Filtration, Energy and WELL.

### Main and CO2 inputs

| Input | Default | Range/options |
| --- | ---: | --- |
| Space type | Open office | 22 office, education, food, healthcare, retail, sport, hotel, assembly, lab and warehouse types |
| Area / height / occupancy | 200 m2 / 2.7 m / 20 | 10-2,000 / 2.4-6 / 1-500 |
| Supply configuration | Ceiling mixing, Ez 1.0 | Six modes, Ez 0.8-1.3 |
| Outdoor CO2 | 420 ppm | 350-500 |
| Per-person CO2 generation | 0.0052 L/s | 0.0030-0.0100 |
| Target CO2 | 1,000 ppm | 600-1,500 |
| Current outdoor-air rate | 100% | 10-150% |
| Simulation speed | 1x | 1-20x |

### Pollutant, system and energy inputs

- Pollutants: CO2, total VOC, PM2.5 and formaldehyde; initial concentration
  0-2,000, source emission 0-500 mg/h, 0.5-20 ACH and 0-99% filter removal.
- Multi-zone: editable area, population and primary airflow for three initial
  zones; add/remove zone; system primary airflow 500-50,000 L/s.
- Filtration: current MERV 6-16, proposed MERV 8-16, outdoor PM2.5 0-200
  micrograms/m3 and recirculation 0-95%.
- Energy: heating/cooling season, outdoor -20 to 45 C, indoor 18-28 C,
  outdoor RH 10-100%, indoor RH 20-70%, electricity $0.03-$0.40/kWh and
  500-8,760 operating hours/year.

The initial summary showed breathing-zone and zone outdoor airflow, ACH,
CFM/person, steady-state CO2, distribution effectiveness, energy penalty,
annual cost and pass/fail states. Two canvases support diagrams/time charts.
The tool can start/reset a simulation and export a report.

## Stated model

- `Vbz = Rp * Pz + Ra * Az`.
- `Voz = Vbz / Ez`.
- Steady CO2 is outdoor concentration plus generation divided by outdoor flow.
- Pollutant decay is first-order:
  `C(t) = Css + (C0 - Css) * exp(-lambda * t)`.
- Simplified multi-zone efficiency:
  `Ev = 1 + Xs - Zd,max`.
- Ventilation energy separates sensible
  `massFlow * cp * deltaT` and latent
  `massFlow * hfg * deltaHumidityRatio`.

## Review findings

1. **CO2 is a ventilation tracer, not complete IAQ.** It does not measure
   particles, VOC mixtures, pathogens, moisture damage or source toxicity.
2. **Generic pollutant controls need pollutant-specific units.** A common
   0-2,000 scale and mg/h source cannot be interpreted identically for ppm CO2,
   micrograms/m3 PM2.5, VOC and formaldehyde.
3. **Filtration needs airflow and pressure effects.** MERV efficiency alone is
   insufficient; bypass, loading, fan curve and filter pressure drop matter.
4. **Multi-zone equations are simplified.** Applicability, diversity,
   recirculation paths and the full selected standard procedure need review.
5. **WELL/ASHRAE status is indicative.** The tool cannot establish compliance
   with standards that require project-specific documentation and testing.
6. **Residential scope differs.** HomePlanner's houses are generally closer to
   ASHRAE 62.2/local residential codes than the commercial 62.1 space table.

## HomePlanner relevance

A useful first step is a residential, room-volume-based CO2/moisture scenario
with explicit occupancy schedules, delivered outdoor airflow and outdoor
conditions. Keep pollutant modules separate by quantity and source model.
Commercial VRP and certification checks should remain expert handoffs.

## Complete page-content coverage

The page provides a guided workflow for selecting a space type, reviewing
people and area rates, choosing a supply configuration, running the VRP or
CO2 simulation, comparing pollutant and filter cases, inspecting multi-zone
results, and exporting a report. It describes the purpose of each module,
simulation-speed controls, reset/start behavior, chart views and the
distinction between breathing-zone and zone outdoor airflow.

Its explanatory sections cover practical ventilation design, commercial
space-type differences, source categories addressed by people and area rates,
distribution effectiveness, demand-controlled ventilation, pollutant decay,
multi-zone critical-zone behavior, MERV tradeoffs and the heating/cooling
energy cost of outdoor air. Learning activities compare offices, classrooms,
restaurants, healthcare, gyms and other presets; test CO2-based DCV; identify
the critical zone; and vary operating hours and weather.

The page includes ASHRAE-rate and MERV reference tables, challenge questions,
common-mistake guidance, an FAQ, references, citation instructions and a
verification log. It also states that 62.1, 62.2 and WELL are different
workflows, that CO2 is only a proxy, and that actual compliance requires the
applicable edition, project documentation, equipment data and commissioning.
