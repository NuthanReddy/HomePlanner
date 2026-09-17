# Optional daylight reference toolchain

Official API documentation checked **17 Sep 2026**. Optional snippets were not
installed/run; the [stdlib example](../scripts/example.py) alone executes
the [geometric reference equations](calculations.md).

| Distribution → import | Use | Prerequisites / boundary |
| --- | --- | --- |
| `honeybee-core` → `honeybee` | Explicit rooms/faces/openings and model serialization | Geometry/identity first; box creation is not a complete energy/daylight model. No Rhino is required for core Python objects. |
| `ladybug-geometry` → `ladybug_geometry` | Points/vectors/faces supporting Honeybee | Coordinate units and normals are caller responsibilities. |
| `honeybee-radiance` → `honeybee_radiance` | Sensors, Radiance properties and model translation | Compatible Honeybee/Ladybug packages; actual studies require supported Radiance binaries and the selected recipe/runner dependencies. |
| `pyradiance` → `pyradiance` | LBNL's lower-level Radiance Python interface | Official installation docs describe bundled Radiance binaries/libraries. Verify a supported wheel/platform and bundled engine version; this is not a pure-Python renderer. |

Honeybee can be headless without Rhino/Grasshopper. That does not remove
Radiance or, for energy workflows, compatible OpenStudio/EnergyPlus. Installing
`honeybee-core` alone does not install every engine or configure a runnable recipe.
Check the selected release/recipe rather than assuming a complete stack.

## Synthetic sensor definition, not a simulation

Verified signatures:
[Room.from_box](https://www.ladybug.tools/honeybee-core/docs/honeybee.room.html#honeybee.room.Room.from_box),
[SensorGrid.from_planar_positions](https://www.ladybug.tools/honeybee-radiance/docs/honeybee_radiance.sensorgrid.html#honeybee_radiance.sensorgrid.SensorGrid.from_planar_positions).

```python
from honeybee.room import Room
from honeybee_radiance.sensorgrid import SensorGrid
from ladybug_geometry.geometry3d.pointvector import Point3D

room = Room.from_box(
    identifier="synthetic_room", width=4.0, depth=3.0, height=2.8,
    orientation_angle=0, origin=Point3D(0, 0, 0),
)
grid = SensorGrid.from_planar_positions(
    identifier="synthetic_grid",
    positions=[(1.0, 1.0, 0.8), (2.0, 1.0, 0.8)],
    plane_normal=(0.0, 0.0, 1.0),
)
sensor_definition = grid.to_dict()
```

All dimensions and the 0.8 m plane are synthetic supplied inputs, not recommended
heights. This constructs objects only; it assigns no windows, optical materials,
sky, luminaire photometry or complete simulation. An adapter must validate IDs,
closed geometry, normals, exact sensor/room membership, usable reservations and
frame mapping before translating the real current project.
Do not infer a daylight outcome from a successful `Room.from_box` call.

## Running an external optical calculation is a separate task

[Honeybee Radiance documentation](https://www.ladybug.tools/honeybee-radiance/docs/),
[PyRadiance documentation](https://lbnl-eta.github.io/pyradiance/),
[PyRadiance API](https://lbnl-eta.github.io/pyradiance/reference/),
[LBNL rtrace](https://radsite.lbl.gov/radiance/man_html/rtrace.1.html) and
[gendaylit](https://radsite.lbl.gov/radiance/man_html/gendaylit.1.html).

`pyradiance.rtrace` consumes ray bytes plus a compiled octree and returns bytes.
Choose the documented sensor-at-point irradiance mode, not an arbitrary view-ray
radiance mode. Ray positions/normals, octree sources/materials, units, direct
and ambient sampling, spectra/photometric convention and engine version must
match the benchmark. Source, output-mode and spectral settings determine whether
results can be interpreted as illuminance; do not append “lux” to raw RGB values.

For annual metrics also require complete appropriately timed weather/sky,
occupancy schedules, grid coverage, blind/control assumptions and the exact
metric edition/definition. Preserve failures, unconverged comparisons and unknown
geometry. Do not run an engine, download weather or publish scene data as a
side effect of opening a skill or displaying a light map.
See the [persisted research boundary](../../../../docs/research/building-analysis-toolchain.md)
and [thermal engine guide](../../homeplanner-thermal-modeling/references/python-tools.md)
for the distinct energy dependencies.
