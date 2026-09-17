# Optional airflow/scalar reference tools

Documentation checked **17 Sep 2026**. No optional package or external engine
was installed/run. The [stdlib example](../scripts/example.py) independently
checks the [orifice, channel and scalar equations](calculations.md).

| Distribution → import | Selection | Prerequisites / limits |
| --- | --- | --- |
| `scipy` → `scipy.optimize` | Small, explicitly formulated pressure-residual reference problems | NumPy/SciPy numerical dependencies; a root finder supplies neither connectivity, gauge selection, Cd nor boundary conditions. |
| `numpy` → `numpy` | Array/residual calculations for a separately specified numerical benchmark | Preserve units and invalid masks; arrays are not a CFD model. |
| `matplotlib` → `matplotlib.pyplot` | Optional residual/refinement or scalar-history figures | Explicit headless backend and labelled units; no invented room-velocity heatmap. |
| Matching EnergyPlus distribution → `pyenergyplus.api` | Separately authorized AirflowNetwork/zone-model comparisons | Engine's Python API and matching native library, valid complete model and weather/boundaries; not a generic pip-only solver. |

## A bounded SciPy example

[scipy.optimize.root](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.root.html).
One synthetic zone between fixed 2 Pa and 0 Pa boundaries, equal known
orifices and no source. There is one free zone pressure, not a singular network.

```python
import math
from scipy.optimize import root

cd, area_m2, density_kg_m3 = 0.6, 0.1, 1.2

def flow(delta_pa):
    return cd * area_m2 * math.copysign(
        math.sqrt(2.0 * abs(delta_pa) / density_kg_m3), delta_pa
    )

def residual(pressures):
    p = float(pressures[0])
    return [flow(p) - flow(2.0 - p)]

result = root(residual, [0.8])
if not result.success or not math.isfinite(float(result.x[0])):
    raise RuntimeError(result.message)
if abs(residual(result.x)[0]) > 1e-9:
    raise RuntimeError("Synthetic nodal residual exceeds 1e-9 m3/s.")
assert math.isclose(float(result.x[0]), 1.0, abs_tol=1e-8)
```

The stated tolerance is for this reference fixture, not a ventilation-design
threshold. Check the nonsmooth square-root law near zero and every node on
larger networks. `success` alone is not a mass-balance acceptance test.
Root convergence does not imply empirical airflow accuracy or CFD validation.

## Scalar histories and external engines

For constant forcing the stdlib exponential is exact for its declared ODE;
an ODE package is unnecessary. A future time-varying source model may use
[SciPy solve_ivp](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html)
with explicit intervals, tolerances, source units and conservation checks.
Do not supply hidden occupant emission rates, commercial VRP tables, MERV
effectiveness or a fan-flow derating from door geometry.

[EnergyPlus Python API](https://energyplus.readthedocs.io/en/latest/api.html) and
[AirflowNetwork method](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/airflownetwork-model.html)
are an external path, not a replacement for the current local network/field.
Use the [thermal engine prerequisites](../../homeplanner-thermal-modeling/references/python-tools.md)
for version/model/runtime setup. The installed release must actually support
the chosen components; Honeybee does not expose every EnergyPlus feature.

Detailed 3D airflow would require a separately chosen maintained CFD solver,
mesh, fluid/thermal boundary conditions, turbulence/wall model and validation
plan; see [OpenFOAM's official documentation](https://doc.cfd.direct/openfoam/user-guide-v13/index)
and the [persisted toolchain review](../../../../docs/research/building-analysis-toolchain.md).
An ambiguous name such as “PyFlow” is not an identified distribution/API.
No external solver, executable or hosted service is invoked by this package.
