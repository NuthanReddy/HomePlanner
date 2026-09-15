# Building-performance research references

Added: **2026-09-10**. Status: **article and live-tool review complete**.
These user-supplied links extend the [sun path research](sunpath.md). Each page
now has a dedicated document separating article claims from controls and
results observed in the embedded calculator. The documents summarize rather
than reproduce the third-party articles.

## Reference catalog

| Reference | Research direction | Review boundary |
| --- | --- | --- |
| [Free HVAC Load Calculator (Manual J)](https://simulations4all.com/simulations/hvac-load-calculator-manual-j) | Heating/cooling loads, envelope inputs, occupancy, ventilation and sizing assumptions. | [Research notes](./hvac-load-calculator.md) |
| [Free Daylight Factor Calculator](https://simulations4all.com/simulations/daylight-factor-calculator) | Daylight factor, glazing transmittance, room geometry, obstructions and sky assumptions. | [Research notes](./daylight-factor-calculator.md) |
| [Free Indoor Air Quality & Ventilation Calculator](https://simulations4all.com/simulations/indoor-air-quality-ventilation-calculator) | Outdoor-air supply, occupancy, pollutant sources and ventilation effectiveness. | [Research notes](./indoor-air-quality-ventilation.md) |
| [Free Building Humidity & Mold Risk Explorer](https://simulations4all.com/simulations/building-humidity-mold-risk-explorer) | Moisture balance, relative humidity, surface temperatures and condensation conditions. | [Research notes](./building-humidity-mold-risk.md) |
| [Building Energy Model Comparator](https://simulations4all.com/simulations/building-energy-model-comparator) | Comparing energy-model methods, inputs, outputs and uncertainty. | [Research notes](./building-energy-model-comparator.md) |
| [Free Bathroom Exhaust Effectiveness Explorer](https://simulations4all.com/simulations/bathroom-exhaust-effectiveness-explorer) | Moisture removal, exhaust flow, make-up air, runtime and room mixing. | [Research notes](./bathroom-exhaust-effectiveness.md) |
| [Free Energy Star Score Estimator](https://simulations4all.com/simulations/energy-star-score-estimator) | Energy benchmarking, eligible building types, climate normalization and required consumption data. | [Research notes](./energy-star-score-estimator.md) |
| [Free Home Energy Audit Simulator: Free DIY Energy Assessment Calculator](https://simulations4all.com/simulations/home-energy-audit-simulator) | Household energy use, envelope/system improvements, savings estimates and retrofit comparisons. | [Research notes](./home-energy-audit-simulator.md) |
| [Free Gym CO2 & Humidity Build-Up Simulator](https://simulations4all.com/simulations/gym-co2-humidity-buildup-simulator) | Time-varying occupancy/activity, CO2 generation, moisture generation and ventilation. | [Research notes](./gym-co2-humidity.md) |

All references are published by **Simulations4All**. The supplied "Free"
labels are retained as titles, not independently verified availability claims.

## Review checklist

For each reference:

1. Inspect the article and live calculator separately, recording controls,
   outputs, units, defaults, limits and reproducible example scenarios.
2. Identify equations, primary sources, model assumptions and validation
   evidence; distinguish observed behavior from promotional claims.
3. Compare with HomePlanner's documented
   [building physics](../building-physics.md),
   [environment workspace](../environment-analysis.md) and
   [design guidance](../design-guidance.md) before proposing additions.
4. Record reusable existing behavior, missing capabilities, required project
   inputs and numerical reference cases in a reviewed gap plan.
5. Keep exploratory estimates separate from regulatory compliance, equipment
   design, professional assessments and rating-system certification. Implement
   independently rather than copying third-party code or presentation.

No implementation priorities or feature-parity claims are established by this
catalog. The dedicated notes identify possible HomePlanner integration areas,
but standards, constants and validation claims still require primary-source
review before implementation.
