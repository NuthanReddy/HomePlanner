# Optional thermal, psychrometric and engine tools

Official API documentation checked **17 Sep 2026** (including current
model-specific pythermalcomfort signatures). No optional library/engine was
installed or executed. The [stdlib reference](../scripts/example.py) only checks
the [explicit equations and synthetic inputs](calculations.md).
Preserve the [existing toolchain research](../../../../docs/research/building-analysis-toolchain.md).

| Distribution → import | Appropriate selection | Prerequisites / limits |
| --- | --- | --- |
| `psychrolib` → `psychrolib` | Moist-air thermodynamic properties | Call `SetUnitSystem(SI)`; RH fraction 0..1, pressure Pa, temperature °C. Not surface-temperature prediction, transport or mold. |
| `pythermalcomfort` → `pythermalcomfort.models` | A specifically chosen comfort model | Supplied air/radiant temperatures, relative speed, RH, metabolic/clothing/work inputs and applicability; no compliance by invocation. |
| Matching EnergyPlus installation → `pyenergyplus.api` | Separately authorized complete-building engine runs | Shipped Python API plus matching native EnergyPlus library/executable, supported Python/platform, version-compatible model and weather. Not a generic pip-only package. |
| `geomeppy` → `geomeppy.IDF` | Explicit IDF geometry preparation using eppy facilities | Initialized version-compatible IDD and IDF; EnergyPlus installation for simulation. Never assume bare `IDF()` is a runnable model. |
| `honeybee-core` / `honeybee-energy` → `honeybee` / `honeybee_energy` | Headless model and selected energy translation workflow | Compatible Ladybug/Honeybee plus required OpenStudio/EnergyPlus versions and complete constructions/operations; core boxes alone are insufficient. |
| OpenStudio SDK / supported `openstudio` distribution → `openstudio` | The selected compatible SDK workflow | Application GUI and SDK/bindings are different installations; confirm supported engines/Python/platform. Not automatically present with every Honeybee import. |

## PsychroLib: units first, not a dynamic moisture model

[Official API](https://psychrometrics.github.io/psychrolib/api_docs.html).
The state below is synthetic. Unlike pythermalcomfort, this API expects RH
as **0.60**, not 60. `GetHumRatioFromRelHum` returns kg water/kg dry air in SI.

```python
import psychrolib

psychrolib.SetUnitSystem(psychrolib.SI)
air_c, rh_fraction, total_pa = 25.0, 0.60, 101325.0
humidity_ratio = psychrolib.GetHumRatioFromRelHum(air_c, rh_fraction, total_pa)
dew_point_c = psychrolib.GetTDewPointFromRelHum(air_c, rh_fraction)
surface_c = 15.0
surface_psat_pa = psychrolib.GetSatVapPres(surface_c)
vapor_pa = psychrolib.GetVapPresFromRelHum(air_c, rh_fraction)
precondensation_surface_ratio = vapor_pa / surface_psat_pa
```

Surface temperature is **independently supplied**, not calculated by PsychroLib
from room RH. At exactly dry air, don't demand a finite dew point; some routines
also enforce a minimum humidity ratio, so document that library behavior instead
of claiming exact zero-preserving round trips. Property-domain/phase limits
remain relevant. PsychroLib is not the Finnish/VTT dynamic mold model or WUFI Bio.

## Current pythermalcomfort API, not an old generic `pmv_ppd`

[Model documentation](https://pythermalcomfort.readthedocs.io/en/latest/documentation/models.html).
The documented imports are `pmv_ppd_iso` and `pmv_ppd_ashrae`.
The reviewed API uses `model="7730-2005"` for ISO and `model="55-2023"` for
ASHRAE, `vr` for **relative** airspeed, RH in **percent**, and a `PMVPPD`
result with `.pmv`, `.ppd` and `.tsv` attributes. Recheck these versioned options
before adopting a different release; do not assume an old generic entry point.

```python
import math
from pythermalcomfort.models import pmv_ppd_iso, pmv_ppd_ashrae

inputs = dict(tdb=25.0, tr=25.0, vr=0.1, rh=60.0, met=1.2, clo=0.5,
              wme=0.0, units="SI", limit_inputs=True, round_output=False)
iso = pmv_ppd_iso(**inputs, model="7730-2005")
ashrae = pmv_ppd_ashrae(**inputs, model="55-2023", airspeed_control=True)
for result in (iso, ashrae):
    if not (math.isfinite(float(result.pmv)) and math.isfinite(float(result.ppd))):
        raise ValueError("Synthetic inputs are outside the selected model's supported result domain.")
```

These are supplied toy occupant/environment conditions, not recommendations or
measured room inputs. Relative speed and clothing corrections depend on the
chosen method; do not substitute a depth-averaged room field or air temperature
for relative speed/mean radiant temperature.
Keep `limit_inputs=True`; NaN can indicate out-of-domain inputs, not a zero
comfort result. A finite PMV/PPD is neither ASHRAE compliance, a clinical
assessment nor assurance for a particular person.

## EnergyPlus shipped API

[API layout](https://energyplus.readthedocs.io/en/latest/api.html),
[state lifecycle](https://energyplus.readthedocs.io/en/latest/state.html) and
[runtime](https://energyplus.readthedocs.io/en/latest/runtime.html).
Use the API from the **same engine installation**, with its library directory
configured deliberately. An unrelated package on PyPI named similarly is not
evidence of the supported EnergyPlus runtime.

The following definition is an **unexecuted external-run example**. Calling it
would run native code and write engine outputs; it must not be part of the
stdlib check or an automatic app action.

```python
from pyenergyplus.api import EnergyPlusAPI

def run_reviewed_model(model_path, weather_path, output_directory):
    api = EnergyPlusAPI()
    state = api.state_manager.new_state()
    try:
        exit_code = api.runtime.run_energyplus(
            state, ["-d", str(output_directory), "-w", str(weather_path), str(model_path)]
        )
        if exit_code != 0:
            raise RuntimeError(f"EnergyPlus exited with {exit_code}")
        return exit_code
    finally:
        api.state_manager.delete_state(state)
```

Before any authorized run require a compatible IDF/epJSON, correct units/closed
zone surfaces/adjacencies, actual openings and constructions, schedules/loads,
ventilation/HVAC assumptions, simulation settings and appropriate EPW/design
weather. Use a reviewed isolated project-relative output location.
Exit code zero is not the acceptance gate: inspect engine errors/warnings,
completeness, warmup/convergence, conservation, benchmark evidence and source IDs.
Weather interval-end standard time, civil time and thermal interval starts need
an explicit tested mapping. Do not silently replace unknowns or fetch weather.

## geomeppy initialization is mandatory

[Official start tutorial](https://geomeppy.readthedocs.io/en/latest/Start%20here.html)
and [geometry API](https://geomeppy.readthedocs.io/en/latest/Basics.html).
The tutorial explicitly targets EnergyPlus **9.1.0**; that is historical evidence,
not a claim of compatibility with every current engine. Choose/test a release
matrix. `setiddname` is process-level eppy/IDD state; don't silently switch
versions inside an existing translator session.

```python
from geomeppy import IDF

def synthetic_geometry_draft(idd_path, compatible_base_idf_path, supplied_epw_path):
    IDF.setiddname(str(idd_path))
    idf = IDF(str(compatible_base_idf_path))
    idf.epw = str(supplied_epw_path)
    idf.add_block(
        name="synthetic_box", coordinates=[(0, 0), (4, 0), (4, 3), (0, 3)],
        height=2.8, num_stories=1,
    )
    return idf
```

This would read explicitly supplied files if called. It creates a geometry draft,
not a validated complete building. Do not call default-construction/window/HVAC
shortcuts as if they were sourced project data. Validate nondegenerate geometry,
boundary conditions and all simulation-critical objects before any run.

## Headless Honeybee/OpenStudio and unsupported moisture methods

[Honeybee Energy run module](https://www.ladybug.tools/honeybee-energy/docs/honeybee_energy.run.html)
documents energy translation/run preparation and required simulation parameters;
[OpenStudio SDK](https://openstudio-sdk-documentation.s3.amazonaws.com/index.html)
documents the SDK separately from the Application GUI.
Headless Python need not use Rhino, but compatible OpenStudio/EnergyPlus
dependencies remain for the selected workflow. Choose one tested translator
path; don't run multiple automatic converters or confuse visual mesh success
with retained zone/opening/material semantics.

[Finnish mould growth model](https://research.tuni.fi/buildingphysics/finnish-mould-growth-model/)
needs its specified surface temperature/RH history, material sensitivity and
growth/decline rules. [WUFI Bio](https://wufi.de/en/wufi-bio/) is a separate
biohygrothermal workflow with its own limitations/licensing, not a drop-in
open-source PsychroLib function. No mold model, moisture-drying prediction,
clinical advice or compliance assurance is supplied by these snippets.
