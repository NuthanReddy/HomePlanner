# Building energy model comparator research

Research date: **2026-09-10**. Source:
[Simulations4All Building Energy Model Comparator](https://simulations4all.com/simulations/building-energy-model-comparator).

Status: article extracted and the three-model comparator inspected.

## Page scope

The page compares up to three commercial-building scenarios using simplified
degree-day envelope loads, system-efficiency factors, lighting/plug loads,
domestic hot water, utility cost and carbon factors. It frames energy modeling
as a comparative design tool and discusses CBECS benchmarks, ASHRAE 90.1
baselines and LEED energy points.

## Observed calculator

Building presets: Office, School, Retail, Hospital, Hotel and Warehouse. Model
tabs: A Baseline, B Proposed and C High-Performance. An automatic ASHRAE
baseline action modifies the selected scenario.

| Input | Default | Range/options |
| --- | ---: | --- |
| Climate zone | 4A | 1A, 2A, 3A, 3B, 4A, 4C, 5A, 6A, 7, 8 |
| Area / floors | 50,000 ft2 / 3 | 5,000-500,000 / 1-20 |
| Electricity / gas rate | $0.12/kWh / $1.00/therm | $0.04-$0.40 / $0.30-$3.00 |
| Wall / roof U | 0.064 / 0.048 | 0.020-0.200 / 0.010-0.100 |
| Window U / SHGC / WWR | 0.42 / 0.40 / 40% | 0.15-1.20 / 0.10-0.80 / 5-80% |
| HVAC | VAV | CAV, VAV, VRF, DOAS+radiant, geothermal |
| Heating efficiency | 0.80 | 0.50-5.00 AFUE/COP-labelled scale |
| Cooling COP | 3.50 | 2.00-8.00 |
| Lighting / plug density | 0.85 / 1.00 W/ft2 | 0.30-2.00 / 0.25-3.00 |
| DHW load | 0.20 kBtu/ft2-year | 0.05-2.00 |

Views include EUI gauges, monthly chart, Sankey, envelope, HVAC and cost. The
initial cards compared model A/B/C EUI, a CBECS median, best-model savings,
annual cost, estimated LEED points and CO2 emissions. Report export is present.

## Stated model

- `EUI = annual energy / gross area`.
- Heating uses `sum(Ui * Ai) * HDD65 * 24`.
- Cooling adds a simplified conduction term and a glazing solar term with an
  eight-hour multiplier.
- HVAC energy divides loads by heating efficiency and cooling COP, then adds
  fan energy.
- Lighting is power density * area * equivalent full-load hours.
- Cost applies electricity and gas tariffs.
- Carbon applies fixed fuel factors.
- Savings compare proposed and baseline EUI; points are mapped to claimed LEED
  percentage-improvement thresholds.

## Review findings

1. **Not an Appendix G model.** A degree-day calculator cannot establish an
   ASHRAE 90.1 performance rating or LEED credit. Those workflows require
   detailed schedules, weather, zoning, systems and modeling rules.
2. **Geometry is underdefined.** Area and floor count do not determine wall,
   roof and glazing area or orientation.
3. **HVAC labels hide system behavior.** CAV/VAV/VRF/DOAS/geothermal performance
   cannot be represented reliably by one heating efficiency and one COP.
4. **Mixed AFUE/COP scale is dimensionally risky.** Combustion efficiency and
   heat-pump COP require explicit equipment type and valid ranges.
5. **Carbon factors are scenarios.** Grid factors vary by location, year,
   accounting method and time; they need source metadata.
6. **Benchmarks are not predictions.** CBECS medians are peer context, not a
   substitute for calibrated consumption or a project baseline.

## HomePlanner relevance

The three-scenario UX, explicit tariffs, end-use chart and provenance-rich
export are useful patterns. HomePlanner should compare identical geometry and
weather across scenarios and label degree-day results as screening estimates,
not code/LEED energy models.

## Complete page-content coverage

The page explains why comparative energy modeling is useful, then walks
through climate-zone selection, baseline/proposed/high-performance scenarios,
the automatic baseline action, end-use charts, Sankey and monthly views,
cost/carbon outputs, report export and model-to-model comparison.

Its technical sections discuss ASHRAE 90.1 baseline concepts, envelope and
HVAC requirements, interior loads, CAV/VAV/VRF/DOAS+radiant/geothermal
behavior, CBECS benchmarking, window-wall-ratio sensitivity and LEED energy
credit framing. Learning activities cover climate-zone changes, HVAC
system comparisons, glazing sensitivity and targeting higher LEED performance.
Applications include schematic targets, incentive applications, carbon
planning, value engineering, tenant projections, building-performance
standards and risk discussions.

The page also includes envelope/window reference data, challenge questions,
common-mistake guidance, a substantial FAQ, references, a design-code
reference, citation guidance and verification test cases. Those sections
explicitly distinguish this degree-day comparator from EnergyPlus/eQUEST and
from a formal ASHRAE 90.1 Appendix G or LEED submission.
