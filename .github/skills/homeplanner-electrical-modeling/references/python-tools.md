# Optional units and electrical-reference tools

Documentation checked **17 Sep 2026**. Optional packages were not installed or
executed. The [stdlib example](../scripts/example.py) needs no dependency and
implements only the [supplied power/envelope equations](calculations.md).

| Distribution → import | Suitable use | Boundary |
| --- | --- | --- |
| `pint` → `pint` | Explicit dimensional conversions for supplied quantities | Units do not validate physical assumptions or installation ratings. |
| `shapely` → `shapely` | Independent plan-envelope intersections | GEOS/native wheel; 2D ignores vertical bands and electrical/wet-area semantics. |
| `pandapower` → `pandapower` | A separately specified steady-state network study | NumPy/pandas/SciPy-based dependencies, full buses/lines/transformers/supply/load data and convergence checks. Not required for point placement and not an automatic protection design. |

## Synthetic energy conversion

[Pint UnitRegistry tutorial](https://pint.readthedocs.io/en/stable/getting/tutorial.html).
Keep reactive/apparent quantities labelled separately even though their SI
dimensions match active power.

```python
from pint import UnitRegistry

units = UnitRegistry()
active_power = 1840.0 * units.watt
elapsed = 2.0 * units.hour
energy_kwh = (active_power * elapsed).to("kilowatt_hour").magnitude
```

The result is 3.68 kWh for this supplied constant active-power interval.
This neither measures actual energy nor chooses a breaker/cable.

## Optional plan geometry

[Shapely box](https://shapely.readthedocs.io/en/stable/reference/shapely.box.html).
This is a broad plan comparison only; unknown mounting/obstacle heights must
still prevent a verified 3D clash/clearance conclusion.

```python
from shapely import box

device_plan = box(0.95, -0.15, 1.05, -0.10)
obstacle_plan = box(1.02, -0.18, 1.20, -0.12)
positive_plan_overlap_m2 = device_plan.intersection(obstacle_plan).area
```

Do not call `buffer` with an unsourced “safety” distance or treat no 2D overlap
as electrical/accessibility certification. Reuse the app's actual door/host and
usable-region model for application work.

## Network quantities require a different model

[pandapower load API](https://pandapower.readthedocs.io/en/stable/elements/load.html)
and [unit conventions](https://pandapower.readthedocs.io/en/stable/about/units.html).
`pandapower.create_load(net, bus, p_mw, q_mvar)` uses **MW/Mvar**, not W/var.
Its normal consumer convention has positive active consumption and inductive
reactive demand; use the appropriate generator element for generation.
`create_bus` uses nominal kV. Do not interpret the point layer's qualitative
`loadCategory` as any of these numeric inputs.

Power-flow execution (`runpp`) requires a complete supplied network, supply/slack
conditions, impedances, operating data, connectivity and actual residual/status
checks. A converged power flow is not ampacity, fault-protection coordination,
earthing, installation instructions or local approval. No pandapower network
is synthesized or run here. Any future sizing task needs code/product sources
and qualified review before a solver is selected.
