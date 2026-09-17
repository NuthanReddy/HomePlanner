# Optional clearance illustration tools

Documentation checked **17 Sep 2026**. No optional package was installed/run.
The [stdlib example](../scripts/example.py) evaluates the
[supplied clearance equations](calculations.md), not accessibility compliance.

| Distribution → import | Appropriate use | Limits |
| --- | --- | --- |
| `shapely` → `shapely` | Independent plan footprints, interval/region differences and distance checks | GEOS/native wheel, planar coordinates. z, reach, hardware and continuous navigation are not solved automatically. |
| `matplotlib` → `matplotlib.pyplot`, `matplotlib.patches` | Labelled offline plan and clearance figures | A drawn arc is a symbol, not a measured clear opening or exact physical swept-volume model. |
| stdlib `math`, `xml.etree.ElementTree` | Exact small analytical cases and SVG inspection | No external engine needed for the supplied rectangle/quarter-sector cases. |

## A synthetic section, not an accessible-route solver

[Shapely box](https://shapely.readthedocs.io/en/stable/reference/shapely.box.html)
and [set operations](https://shapely.readthedocs.io/en/stable/reference/shapely.union_all.html).

```python
import math
from shapely import box

section_strip = box(0.0, 0.0, 1.4, 0.1)
obstruction = box(0.45, 0.0, 0.65, 0.1)
free = section_strip.difference(obstruction)
assert math.isclose(free.area, 0.12)
pieces = list(free.geoms) if free.geom_type == "MultiPolygon" else [free]
widths = [piece.bounds[2] - piece.bounds[0] for piece in pieces]
largest_clear_m = max(widths)
assert math.isclose(largest_clear_m, 0.75)
```

The 0.1 m strip thickness is a synthetic plotting aid. The largest gap here is
not the sum of separated gaps and does not prove continuity along a route.
For arbitrary polygons, bounding-box width is not generally traversable width;
the example deliberately uses straight rectangular strips.
Never add a hard-coded ADA/medical threshold or buffer distance.

## Optional noninteractive figure

[Matplotlib Arc](https://matplotlib.org/stable/api/_as_gen/matplotlib.patches.Arc.html)
and [Rectangle](https://matplotlib.org/stable/api/_as_gen/matplotlib.patches.Rectangle.html).

```python
import matplotlib
matplotlib.use("Agg")
from matplotlib import pyplot as plt
from matplotlib.patches import Arc, Rectangle

fig, ax = plt.subplots()
ax.add_patch(Arc((0, 0), 1.8, 1.8, theta1=0, theta2=90))
ax.add_patch(Rectangle((0.5, 0.5), 0.2, 0.2, fill=False))
ax.set(xlim=(-0.1, 1.1), ylim=(1.1, -0.1),
       xlabel="local x (m)", ylabel="local y (m)")
ax.set_aspect("equal")
plt.close(fig)
```

This in-memory plot uses supplied r=0.9 m; it performs no clearance certification.
Circle/sector polygons produced by buffering or sampled arcs have discretization
error. Disclose angular resolution and verify limiting cases rather than treating
the drawn perimeter as exact. Missing object heights remain unknown.

Reuse HomePlanner's actual `doorGeometry`, `usableRegions`, shared commands and
Undo for app work, rather than placing a Python geometry store behind the UI.
Thermal comfort tools are a [separate modelling topic](../../homeplanner-thermal-modeling/references/python-tools.md),
not a medical/physical-access oracle. Review keyboard, pointer alternatives and
focus with the existing browser tests and appropriate assistive technology;
Python geometry cannot establish those outcomes.
