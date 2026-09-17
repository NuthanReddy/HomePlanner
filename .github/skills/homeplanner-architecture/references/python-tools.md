# Optional geometry tools

API documentation checked **17 Sep 2026**; these optional examples were **not
installed or executed**. The [stdlib fixture](../scripts/example.py) needs none
of these packages and only prints JSON/SVG. Keep the existing browser project,
commands, region kernel and Undo authoritative.

| Distribution → Python import | Appropriate use | Prerequisites and limits |
| --- | --- | --- |
| `shapely` → `shapely` | Independent rectangle/polygon union and difference checks | Shapely 2.x uses GEOS; supported wheels carry native libraries, source builds need compatible GEOS. Planar units come from the caller; z is not a 3D solid model. |
| `matplotlib` → `matplotlib` | Optional offline diagnostic plots with equal axes | Choose a noninteractive backend for headless work. Screen aspect ratio is not model geometry. |
| Blender / optional `bpy` distribution → `bpy` | Explicit offline visual assets or Geometry Nodes authoring | Blender's matching Python/runtime or a supported official wheel; version/platform/Python compatibility matters. Not required by ordinary browser users. |
| `ifcopenshell` → `ifcopenshell` | A future deliberately scoped IFC handoff | Native build/wheel, exact IFC schema, units/placements, relationships and unsupported-entity handling. A mesh is not a thermal zone or a lossless project import. |

## Independent Shapely example

[box API](https://shapely.readthedocs.io/en/stable/reference/shapely.box.html),
[union_all API](https://shapely.readthedocs.io/en/stable/reference/shapely.union_all.html).
Shapely may ignore `None` in unions; a HomePlanner adapter must reject missing
reservation evidence **before** this call, rather than silently dropping it.

```python
import math
from shapely import box, union_all

host = box(0.0, 0.0, 6.0, 5.0)
cuts = [box(1.0, 1.0, 3.0, 3.0), box(2.0, 1.0, 4.0, 3.0)]
reserved = host.intersection(union_all(cuts))
net = host.difference(reserved)
assert math.isclose(reserved.area, 6.0)
assert math.isclose(net.area, 24.0)
```

This validates a set-area identity, not the legality of overlapping services.
Do not silently use `grid_size`, buffering or validity repair to heal authored
geometry. Report the geometric deviation and require an explicit decision.

## Optional diagnostic rendering

[Matplotlib rectangle](https://matplotlib.org/stable/api/_as_gen/matplotlib.patches.Rectangle.html)
and [backend guide](https://matplotlib.org/stable/users/explain/figure/backends.html).
The snippet creates an in-memory figure, not a saved project or durable file.

```python
import matplotlib
matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.patches import Rectangle

fig, ax = plt.subplots()
ax.add_patch(Rectangle((0, 0), 6, 5, fill=False))
ax.add_patch(Rectangle((1.88, 1.88), 1.74, 1.74, fill=False, hatch="//"))
ax.set(xlim=(-0.2, 6.2), ylim=(5.2, -0.2), xlabel="local x (m)", ylabel="local y (m)")
ax.set_aspect("equal")
plt.close(fig)
```

## Mesh and engine handoffs are separate work

Use [Blender's Python API](https://docs.blender.org/api/current/info_quickstart.html)
and [Geometry Nodes manual](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/index.html)
for reviewed offline authoring; `bpy` exposes Blender state, not HomePlanner
commands. Export/import needs explicit ID, axis, unit, material and loss reports.
Do not automatically execute scripts embedded in assets.

[IfcOpenShell Python documentation](https://docs.ifcopenshell.org/ifcopenshell-python.html)
describes `ifcopenshell.open` and IFC entity access. Dedicated semantic mapping is
required; neither IFC nor arbitrary Blender import currently exists in the app.
For EnergyPlus geometry, follow the [thermal tool guide](../../homeplanner-thermal-modeling/references/python-tools.md):
`geomeppy.IDF` needs an initialized, version-compatible IDD and IDF, and geometry
alone supplies neither loads nor constructions nor valid simulation boundaries.
These limits preserve the [existing toolchain research](../../../../docs/research/building-analysis-toolchain.md).
