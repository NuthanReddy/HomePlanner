# Home energy audit simulator research

Research date: **2026-09-10**. Source:
[Simulations4All Home Energy Audit Simulator](https://simulations4all.com/simulations/home-energy-audit-simulator).

Status: article extracted and live calculator inspected.

## Page scope

The article presents a DIY screening audit using degree days, envelope UA,
infiltration, equipment efficiency, end-use estimates, upgrade costs and simple
payback. It distinguishes walk-through, diagnostic and comprehensive audits,
and admits that the simulator is not equivalent to blower-door testing,
infrared inspection, duct testing or a calibrated professional model.

## Observed calculator

Presets: 1970s Ranch, 2000s Colonial, 2020 Energy Star and Apartment.

| Input | Default | Range/options |
| --- | ---: | --- |
| Home type / year / area | Single family / 1975 / 1,800 ft2 | Single, townhouse, apartment / 1900-2025 / 400-10,000 |
| Stories / climate / fuel | 1 / zone 4 / gas | 1, 1.5, 2, 3 / zones 1-7 / gas, electric, oil, propane |
| Attic / wall / floor R | 11 / 11 / 0 | 0-60 / 0-40 / 0-30 |
| Windows | Double | Single, double, double Low-E, triple |
| Airtightness | 12 ACH50 | 1-25 |
| Framing | Wood 2x4 at 16 in | Wood 2x4, wood 2x6, steel, SIP |
| Thermal bridges | Five toggles | Wall-floor, wall-roof, window perimeter, corners, balcony |
| Furnace / cooling | 78% AFUE / SEER 10 | 60-98% / 8-25 |
| Water-heater efficiency | 0.60 EF | 0.5-3.5 |
| LED share / appliance age | 20% / 15 years | 0-100% / 0-25 |

Views: house diagram, energy-flow Sankey, end-use breakdown, monthly chart,
before/after, payback and equations. Actions include Apply All Upgrades, reset
and report export. Initial metrics showed annual cost, energy, CO2 and a 1-10
home score.

## Stated model

- Component conduction: `Q = U * A * deltaT`.
- Annual heating screen: `UA * 24 * HDD`.
- Infiltration is described from natural ACH, with ACH50 divided by an
  approximate factor around 20.
- Simple payback is installed cost divided by annual savings.
- Whole-wall U is calculated by parallel framing and cavity paths.
- End uses include heating, cooling, water heat, lighting, appliances, plugs
  and thermal bridges.

## Review findings

1. **Geometry is inferred.** Area, stories and type cannot establish actual
   exposed wall/roof/floor areas, orientation or adjacencies.
2. **ACH50 conversion is climate-dependent.** A fixed divisor is a rough screen;
   shielding, height, stack and wind require a defined infiltration model.
3. **Cooling needs more than CDD.** Solar, humidity, schedules and thermal mass
   are not represented by a simple degree-day load.
4. **Costs and savings are scenarios.** Upgrade prices, tariffs, interactions,
   degradation and rebound need location/date provenance.
5. **A DIY result is not an audit.** It cannot locate leaks, hazards, combustion
   safety problems, moisture damage or failed ducts.
6. **Scores are proprietary to this page.** The 1-10 result must not be confused
   with DOE Home Energy Score.

## HomePlanner relevance

HomePlanner can improve on inferred geometry by using its actual floor scenes,
walls and openings. A useful screening audit should show component UA, assumed
infiltration, weather coverage, end-use uncertainty and before/after deltas.
Professional diagnostics and savings guarantees remain out of scope.

## Complete page-content coverage

The page distinguishes walk-through, diagnostic, comprehensive and DIY
assessment levels, then guides the user through the home preset, climate,
envelope, airtightness, framing, thermal bridges, equipment and end-use
controls. It describes house-diagram, Sankey, monthly, before/after, payback
and equation views, plus upgrade application, reset and report export.

The article’s learning activities cover envelope investigation, air-sealing
sensitivity, climate comparison and upgrade optimization. Its reference
material discusses insulation values and costs, window performance, framing
factors and thermal bridges, including parallel paths and linear
transmittance (Psi) as a more detailed bridge representation.

It also includes challenge questions, common mistakes, an FAQ, references,
citation guidance and a verification log. The page emphasizes that inferred
geometry, ACH50 conversion, upgrade prices, tariffs and simple payback are
screening assumptions, not a blower-door audit, infrared investigation,
combustion-safety inspection or guaranteed savings analysis.
