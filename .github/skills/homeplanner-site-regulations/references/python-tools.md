# Python tools for site reference calculations and renders

These are optional reference tools, not newly installed HomePlanner
dependencies. Keep the JavaScript rule engine and current project as the
application authority. Do not send saved plots, addresses, reports or project
JSON to external services.

## Module selection

| Module | Concrete use | Boundary / official reference |
| --- | --- | --- |
| `decimal`, `math` (stdlib) | Exact decimal unit factors; finite bounds; square-root optimum; tolerance checks | [Decimal](https://docs.python.org/3/library/decimal.html), [math.isclose](https://docs.python.org/3/library/math.html#math.isclose). Precision is not survey accuracy. |
| `xml.etree.ElementTree` (stdlib) | Standalone labelled SVG of gross, net and applied envelopes | [ElementTree](https://docs.python.org/3/library/xml.etree.elementtree.html). It emits XML, not a measured survey or print-scale certificate. |
| `pint` (optional) | Reject length/area unit mismatches before calculation | [UnitRegistry and Quantity.to](https://pint.readthedocs.io/en/stable/getting/tutorial.html). Select international versus legacy survey units explicitly. |
| `shapely` (optional) | Polygon/strip unions, differences and planar area in a known metric frame | [difference](https://shapely.readthedocs.io/en/stable/reference/shapely.difference.html). A planar calculation on longitude/latitude returns degree-based geometry, not m2. Do not silently repair invalid surveyed boundaries or apply one uniform buffer to unequal edge setbacks. |
| `pyproj` (optional) | Explicit CRS conversion or documented ellipsoidal area/distance work | [Geod API](https://pyproj4.github.io/pyproj/stable/api/geod.html). Require a supplied datum/CRS and appropriate survey basis; geodesic area is not automatically the authority's cadastral area. This package does not query a site or choose a CRS for the user. |
| `matplotlib` (optional) | Unit-labelled area comparisons and undistorted plan diagrams; SVG/PDF/PNG publication | [Rectangle](https://matplotlib.org/stable/api/_as_gen/matplotlib.patches.Rectangle.html), [equal aspect](https://matplotlib.org/stable/api/_as_gen/matplotlib.axes.Axes.set_aspect.html), [savefig](https://matplotlib.org/stable/api/_as_gen/matplotlib.figure.Figure.savefig.html). Equal data aspect does not guarantee physical print scale. |

The supplied [example.py](../scripts/example.py) needs **none** of the optional
packages. If optional code is needed, use a reviewed isolated environment and
the selected library's installation guidance; do not bulk-install this table.
Optional snippets below are illustrative API usage, not the executed app path.

## Exact unit calculation

```python
from decimal import Decimal

foot_m = Decimal("0.3048")
area_m2 = Decimal("100") * foot_m ** 2
assert area_m2 == Decimal("9.29030400")
```

Equivalent dimensional checking with an already-available optional Pint:

```python
from pint import UnitRegistry

units = UnitRegistry()
area = (100 * units.foot ** 2).to("meter ** 2")
print(area.magnitude, area.units)
```

Do not convert an area with a linear factor or silently treat unlabelled
coordinates as metres.

## Polygon difference for a supplied metric example

```python
import shapely

gross = shapely.box(0, 0, 12, 18)
north_strip = shapely.box(0, 0, 12, 1)
net = shapely.difference(gross, north_strip)
assert net.area == 204.0
```

This uses a schematic top-left origin with y increasing south. No map
coordinates are involved. Multiple strips require a union before subtraction
or successive differences, not a sum of their areas. A chosen `grid_size` is
an explicit geometric precision operation and can move boundaries; do not
enable snapping simply to make a result pass.

## Optional Matplotlib render

With Matplotlib already available, this explicitly writes a synthetic example
SVG in the current working folder:

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

fig, ax = plt.subplots(figsize=(5, 6))
ax.add_patch(Rectangle((0, 0), 12, 18, fill=False, label="Gross: 216 m2"))
ax.add_patch(Rectangle((0, 1), 12, 17, fill=False, edgecolor="blue",
                       label="Net: 204 m2"))
ax.add_patch(Rectangle((1.5, 4), 9, 12.5, facecolor="none",
                       edgecolor="green", label="Envelope: 112.5 m2"))
ax.set_xlim(-1, 13)
ax.set_ylim(19, -1)
ax.set_aspect("equal")
ax.set_xlabel("East-west distance (m)")
ax.set_ylabel("North-south distance (m), south positive")
ax.set_title("Synthetic site example - not an approval drawing")
ax.legend(loc="upper left", fontsize="small")
fig.savefig("site-reference.svg")
plt.close(fig)
```

This preserves x/y length proportions, not a requested 1:n sheet scale.
For fixed paper scale, use the
[drawing skill's calculation reference](../../homeplanner-drawing-exports/references/calculations.md)
and verify printed dimensions; do not rely on `bbox_inches="tight"` to preserve
a specified sheet size.

## Run the dependency-free reference

From the repository root:

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-site-regulations\scripts\example.py --check
```

The JSON contains `skill`, `checks`, `examples` and `limitations`.
`examples.svg` is a self-contained labelled diagram from the computed values.
Nothing is written, fetched or imported into the live app by that invocation.
