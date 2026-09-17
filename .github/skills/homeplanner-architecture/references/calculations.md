# Rectangles, reservations and coordinate frames

Checked **17 Sep 2026**. These are independent geometric reference calculations,
not a second editor, packing algorithm or permission to rearrange a saved plan.
Read the [source scope](sources.md), [project model](../../../../docs/project-model.md)
and [research baseline](../../../../docs/research/building-performance.md).
Optional mesh/BIM workflows are distinguished in the
[toolchain review](../../../../docs/research/building-analysis-toolchain.md).

## Symbols and frames

| Symbol | Meaning | Unit / sign |
| --- | --- | --- |
| `(x,y,w,h)` | Axis-aligned rectangle, clear carpet unless stated otherwise | m; x right, y toward the rear/down the plan |
| `C`, `M`, `F` | Clear carpet, wall-centreline module, full reserved footprint | Different rectangles; never interchangeable |
| `aW,aN,aE,aS` | Carpet-to-module side allowances | m, nonnegative; normally half the respective wall thickness |
| `A` | Plan area | m² |
| `beta` | Front bearing clockwise from true north | degrees; trigonometry uses radians |
| `E,N,U` | East, north, up in the selected world frame | m |
| `(ox,oy)` | Actual plot origin in the input local frame | m; not the building or buildable-plate origin |

## Equations

Rectangle area is `A = w*h`. For rectangles a and b, positive-area intersection is

```text
left = max(ax,bx)                 top = max(ay,by)
width = max(0,min(ax+aw,bx+bw)-left)
height = max(0,min(ay+ah,by+bh)-top)
Aintersection = width*height
```

Edge contact has zero intersection area, but physical tolerances and clearance
requirements are separate. Reject nonpositive rectangle dimensions.

For a module that contains the complete carpet:

```text
aW = Cx-Mx                     aN = Cy-My
aE = (Mx+Mw)-(Cx+Cw)            aS = (My+Mh)-(Cy+Ch)
Fx = Mx-aW                     Fy = My-aN
Fw = Mw+aW+aE                  Fh = Mh+aN+aS
```

Thus the outer wall is one more *side-specific* half-wall beyond the module.
Do not add the same guessed thickness to every side, or mistake the module for
the outside wall boundary.

For an ordinary host H and reservations `Fi`:

```text
reservedHostArea = area(H intersect union(Fi))
netHostArea = area(H) - reservedHostArea
grossHabitableArea = netHabitableArea + reservedHostArea
totalUsableRoomArea = netHabitableArea + serviceClearCarpetArea
```

Clip to each host before subtracting. Adding individual intersections can
double-deduct overlaps; adding all footprint areas can deduct walls or unassigned
space that was never inside a host. Overlapping service reservations are invalid
authoring: the union identity is a robust area calculation, not approval of them.
`usableRegions: []` has zero area; it must not fall back to the nominal rectangle.

Registered site-local points use `xs=x-ox`, `ys=y-oy` **once**, followed by:

```text
E = xs*cos(beta) - ys*sin(beta)
N = -xs*sin(beta) - ys*cos(beta)
U = z
```

The inverse horizontal transform is `xs=E*cos(beta)-N*sin(beta)`,
`ys=-E*sin(beta)-N*cos(beta)`. A null absolute site elevation remains unknown;
if explicitly supplied, absolute elevation is `datum+z`, not another storey offset.
The older `HomePlannerModel.localToWorld` instead centres the input about
`floor.w/2,floor.h/2` before that same rotation/reflection. Never mix these origins.
At heading 0, positive y is south; at heading 90, the front points east.
General numeric transform tests do not add arbitrary surveyed-bearing authoring.

## Worked synthetic cases

1. H = `(0,0,6,5)`; C = `(2,2,1.5,1.5)`; M =
   `(1.94,1.94,1.62,1.62)` m. Each allowance is 0.06 m. F =
   `(1.88,1.88,1.74,1.74)` m. Reserved host area = **3.0276 m²**;
   net host area = **26.9724 m²**, not 27.75 m². H stays authored as 6 × 5 m.
2. Cuts `(1,1,2,2)` and `(2,1,2,2)` in H each cover 4 m² but overlap by 2 m².
   Their union is **6 m²** and the net is **24 m²**, not 22 m².
3. C = `(2,2,1,1)`, M = `(1.9,1.8,1.4,1.5)` gives unequal allowances
   `(0.1,0.2,0.3,0.3)` and F = `(1.8,1.6,1.8,2)` m.
4. Site-local `(2,3,4)` at heading 90° becomes ENU `(-3,-2,4)` m.
   Rotation preserves horizontal distance; it does not establish a surveyed site.

The [stdlib example](../scripts/example.py) computes these values and an actual
labelled plan SVG. Its x-slab union integration is an independent rectangle-area
oracle, deliberately **not** a port/replacement of the application's region kernel.

## Domain, missing and failure cases

Require finite coordinates, positive resolvable dimensions and finite areas.
Missing geometry, negative margins, overflow and coordinates too large to
represent the requested width are errors, not zero areas. No cuts means the
original host area; a cut covering the host means zero usable area; a remote
cut has no effect. Tiny coordinate slivers need the application's numerical
resolution policy, not a new planning clearance. The reference is 2D and
axis-aligned; it does not validate polygons, wall topology, structural safety,
stairs, circulation or local approval.

## Implementation and primary references

- Current implementation: `HomePlannerRegions.reservationBounds`,
  `subtractRectangle`, `area`; canonical scene `usableRegions`; existing bridge
  commands and projection transforms. Use these for app work, not the Python oracle.
- [LibreCAD drawing setup](https://docs.librecad.org/en/latest/guides/dwg-setup.html)
  separates full-size model coordinates from units and printed scale.
- [Sweet Home 3D official guide](https://www.sweethome3d.com/users-guide/)
  supports explicit dimensions, coherent views and reversible editing, not
  HomePlanner-specific reservation semantics.
- [Shapely set operations](https://shapely.readthedocs.io/en/stable/reference/shapely.union_all.html)
  provide an optional independent union/difference comparison. Precision-grid
  snapping is an explicit geometry change, not free accuracy.
