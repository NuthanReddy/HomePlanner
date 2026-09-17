# Optional solar and weather references

Official API documentation checked **17 Sep 2026**. No optional packages or
engines were installed/run. The [stdlib example](../scripts/example.py) checks
supplied-angle geometry and explicit-offset UTC intervals only.

| Distribution → import | Appropriate use | Additional requirements |
| --- | --- | --- |
| `pvlib` → `pvlib` | Independent identified solar-position or irradiance-model comparison | NumPy/pandas/SciPy dependencies; choose a method and atmospheric inputs. `nrel_numpy` does not need an external EnergyPlus/Radiance engine. Other methods have their own dependencies. |
| `pandas` → `pandas` | Explicit timezone-aware index alignment | Naive input can be interpreted as UTC by pvlib; reject it at the adapter. Timezone database version and ambiguous/nonexistent policies matter. |
| `ladybug-core` → `ladybug` | EPW parsing, climate collections and solar references | Not the unrelated package named `ladybug`; needs compatible Ladybug geometry/core dependencies and a supplied EPW. No Rhino requirement for these core operations. |
| Python stdlib `zoneinfo`; optional data distribution `tzdata` | IANA civil-time reference resolution | Windows may lack an IANA database. `tzdata` supplies data, not a new solar solver. Never silently fall back to a guessed fixed offset. |

## Synthetic pvlib call

[get_solarposition API](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.solarposition.get_solarposition.html)
and [time/timezone guide](https://pvlib-python.readthedocs.io/en/stable/user_guide/modeling_topics/timetimezones.html).
This is an optional comparison, not a new HomePlanner runtime provider.

```python
import pandas as pd
from pvlib.solarposition import get_solarposition

times = pd.DatetimeIndex(["2026-06-21T12:00:00+00:00"])
positions = get_solarposition(
    time=times, latitude=0.0, longitude=0.0,
    altitude=0.0, pressure=101325.0, temperature=20.0, method="nrel_numpy",
)
angles = positions[["apparent_elevation", "azimuth"]]
```

Coordinates, altitude, pressure (Pa) and temperature (°C) are deliberately
synthetic supplied conditions. `apparent_elevation` differs from geometric
`elevation`; compare matching definitions. Azimuth is degrees east of north,
compatible with the north-clockwise convention after frame review.
Specify/version the ephemeris, refraction and timestamp assumptions; agreement
with one example is not a general accuracy guarantee.

## EPW is not IANA civil time

[Ladybug EPW API](https://www.ladybug.tools/ladybug/docs/ladybug.epw.html),
[EnergyPlus EPW data dictionary](https://bigladdersoftware.com/epx/docs/25-1/auxiliary-programs/energyplus-weather-file-epw-data-dictionary.html),
[Python zoneinfo](https://docs.python.org/3/library/zoneinfo.html).

```python
from ladybug.epw import EPW

def inspect_supplied_epw(path):
    weather = EPW(path)
    return {
        "location": weather.location,
        "dry_bulb": weather.dry_bulb_temperature,
        "direct_normal_radiation": weather.direct_normal_radiation,
    }
```

This function would read the explicitly supplied file if called; it is not
called by the stdlib fixture. Retain each collection's header/units and interval
semantics. EPW radiation fields are interval energy per area (Wh/m²), not a
permission to relabel every value W/m² without the interval conversion.
The app's normalized weather representation has its own documented units.
Inspect raw missing/sentinel coverage before library normalization: the EPW
radiation documentation describes missing/invalid-as-zero behavior, which must
not erase HomePlanner's unknown masks. The snippet is collection inspection,
not complete weather QA.

Use `ZoneInfo` only when the selected civil zone and its database are available.
Constructing a timezone-attached datetime does not itself reject nonexistent
wall times; round-trip to UTC and inspect earlier/later candidates. For EPW,
use its declared fixed standard offset instead. No daylight-saving "correction"
should be invented.

## Explicit limits

pvlib position calculation alone does not intersect a building mesh, model
neighbors, choose array layout, calculate PV electrical yield or infer savings.
PV models additionally require equipment, irradiance, thermal/loss models and
coverage; compare them as separately authorized methods.
Honeybee/Radiance and Blender are separate optical/geometry workflows, not
implicit pvlib features; preserve the
[existing toolchain boundary](../../../../docs/research/building-analysis-toolchain.md).
