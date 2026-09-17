# Optional hydraulic-reference tools

Official documentation checked **17 Sep 2026**. No optional dependency or engine
was installed/run. The [stdlib fixture](../scripts/example.py) checks only the
[supplied reference equations](calculations.md).

| Distribution → import | Appropriate selection | Prerequisites / limitations |
| --- | --- | --- |
| `wntr` → `wntr` | Pressurized distribution-network research, EPANET model inspection and explicitly configured simulations | Complete INP/model, boundary heads, demands/patterns, internal diameters and selected loss method. EpanetSimulator needs the compatible native EPANET toolkit supplied/supported by the chosen WNTR distribution. |
| `pyswmm` → `pyswmm` | Explicit SWMM drainage/storm simulation/control workflow | A complete SWMM INP and compatible native SWMM toolkit (check the selected package's `swmm-toolkit` dependency/engine version). Not a pure-Python solver or a simple invert plot. |
| `swmm-toolkit` → `swmm.toolkit` | Lower-level SWMM engine bindings when explicitly needed | Native/platform compatibility and SWMM unit/model semantics; not the same import as `pyswmm`. |
| `pint` → `pint` | Independent flow/length/pressure unit checks | No source of fluid data, friction factors or local design criteria. |

No general “plumbing” package provides approved pipe sizing from fixture icons.
Do not install all candidates or assume the newest desktop engine matches a
wrapper. A shipped native library is still an external numerical engine with
version and platform prerequisites.

## Optional supplied pressure-model inspection

[WNTR WaterNetworkModel](https://usepa.github.io/WNTR/waternetworkmodel.html)
and [WNTR simulation documentation](https://usepa.github.io/WNTR/hydraulics.html).

```python
import wntr

def inspect_supplied_pressure_model(inp_path):
    network = wntr.network.WaterNetworkModel(str(inp_path))
    return {
        "node_names": list(network.node_name_list),
        "link_names": list(network.link_name_list),
        "headloss_method": network.options.hydraulic.headloss,
    }
```

This function would read the supplied file if called; it is never called by
the stdlib fixture. Successful parsing/topology is not a solved hydraulic
network. `wntr.sim.EpanetSimulator(network).run_sim(...)` is a **separate**
execution step that can create output files and requires a reviewed output
location, supported engine version, complete inputs and result/error checks.
WNTR's internal SI conventions and EPANET INP unit conventions differ; inspect
the declared INP units and formula-specific roughness conversion. Do not assume
a roughness number has the same units/meaning in Darcy–Weisbach and Hazen–Williams.
Pressure-driven and demand-driven analyses also have different input/behavior
contracts; record which was used.

## SWMM is not pressure-water EPANET

[PySWMM quick start](https://pyswmm.github.io/pyswmm/quickstart.html),
[PySWMM documentation](https://pyswmm.github.io/pyswmm/),
[SWMM toolkit](https://github.com/pyswmm/swmm-python)
and [EPA SWMM](https://www.epa.gov/water-research/storm-water-management-model-swmm).

The documented high-level imports are `from pyswmm import Simulation, Nodes, Links`.
`Simulation` is a context-managed engine session; iterating it advances a
simulation and may write report/binary outputs. `Nodes(sim)[id]` and
`Links(sim)[id]` access actual model/results, not HomePlanner geometry IDs.
A `step_advance` Python/control interval does not necessarily replace the
engine's routing time step.

Require geometry/cross-sections, complete inverts, inflows/rainfall and loss
assumptions, storage, tailwater/outfall evidence and routing method. Preserve
input/output unit-system metadata and check continuity/error reports. No API
invocation certifies capacity, permitted discharge, minimum slopes or flood safety.

## Synthetic unit conversion only

[Pint API tutorial](https://pint.readthedocs.io/en/stable/getting/tutorial.html).

```python
from pint import UnitRegistry

units = UnitRegistry()
supplied_flow = 2.0 * units.liter / units.second
flow_m3_s = supplied_flow.to("meter**3 / second").magnitude
supplied_internal_diameter = (100.0 * units.millimeter).to("meter").magnitude
```

Here 100 mm is explicitly supplied **internal** diameter, not inferred from the
app's nominal symbol diameter. A conversion is not a sizing recommendation.
Use existing shared commands, nullable route/level records and immutable
projections for app work; do not introduce an external editable network by stealth.
