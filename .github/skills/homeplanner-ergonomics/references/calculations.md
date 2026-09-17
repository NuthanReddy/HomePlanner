# Supplied clearance and door-sweep geometry

Checked **17 Sep 2026**. Read the [applicability sources](sources.md),
[circulation/components](../../../../docs/circulation-and-components.md) and
[electrical measurement contract](../../../../docs/electrical-planning.md).
Every dimensional target below is **synthetic and user-supplied**, not an ADA,
Indian, medical or universal ergonomic threshold.

## Symbols, units and claims

| Symbol | Meaning | Unit / convention |
| --- | --- | --- |
| `c,cTarget` | Verified/supplied clear measure and selected target | m, nonnegative / positive |
| `margin` | `c-cTarget` | m; negative falls short of this target only |
| `W` | Supplied width at a particular route cross-section | m, positive |
| `[li,ri]` | Obstructed intervals across that section | m in the same local x frame |
| `r,h,theta` | Supplied leaf radius, hinge point, opening angle | m, (m,m), radians |
| `zLow,zHigh` | Known object/door vertical extent | m in a declared floor datum |

## Measured versus requested clearance

`margin=c-cTarget` is a useful signed comparison **only if c is known and its
measurement convention matches the target**. A requested clear width, nominal
leaf, wall opening or a drawn device centre is not a verified clear measure.
If width is unknown/unverified, margin is null regardless of nominal size.
An in-range height does not prove approach, knee/toe clearance or continuous access.

To find free intervals at one declared route cross-section:

```text
blocked = union([li,ri] intersect [0,W])
free = [0,W] minus blocked
largestClearInterval = max(length(free_j)), or 0 when no free interval exists
totalUnblockedWidth = sum(length(free_j))
```

Never replace the largest connected interval by total unblocked width: separated
slivers cannot be added into a person-sized passage. This is a **cross-section**
screen, not a path planner. Even clear sampled sections cannot prove a connected
route, turning space, slope/level change, door approach or access at unmeasured
stations. A room-access graph is likewise not a continuous-clearance proof.

## Supplied hinged-leaf geometry

In local x-right/y-down axes, for closed direction gamma and an explicitly
supplied positive opening angle theta:

```text
tip(theta) = hinge + r*(cos(gamma+theta), sin(gamma+theta))
sweptSectorArea = r²*theta/2          [theta in radians, thin radial leaf]
```

The stdlib collision reference is restricted to a 0→90° sweep starting along
+x, toward +y, with a hinge translated to the origin. For an axis-aligned
obstacle rectangle clipped to `x>=0,y>=0`, the sector intersects it if the clip
is nonempty and its closest point to the hinge satisfies `x²+y² <= r²`.
This includes boundary contact as a potential conflict. It avoids accepting
the whole r×r bounding square as the actual quarter-circle.

This thin-leaf plan test omits thickness, handles, frame, stops and vertical
bands. Actual physical swept-volume review requires those supplied extents.
Unknown heights prevent a verified clash/clear conclusion. A nominal 90°
glyph is independent of operating `openFraction`, and sliding doors have no
hinged quarter-circle. Use canonical `doorGeometry` in the app.

## Worked synthetic cases

1. cTarget=0.90 m; nominal leaf 0.90 m but no verified clear opening:
   **margin=null**, not a pass. If a matching measured clear width is supplied
   as 0.86 m, margin is **-0.04 m** against that target.
2. At a 1.40 m-wide section, obstruction [0.45,0.65] m leaves free intervals
   [0,0.45] and [0.65,1.40]. Total free width is 1.20 m but the largest
   interval is only **0.75 m**, margin **-0.15 m** against the supplied target.
3. A 0.90 m thin leaf sweeping 90° covers **0.636172512 m²**.
   Its 90° tip is (0,0.90) m. A cupboard rectangle
   `(0.50,0.50,0.20,0.20)` intersects the plan sector because its closest
   corner is about 0.7071 m from the hinge. Vertical overlap remains unassessed.
4. With r=1 m, a rectangle at `(0.80,0.80,0.10,0.10)` is inside the broad
   square but outside the swept sector: closest distance ≈1.1314 m.

The [stdlib example](../scripts/example.py) calculates these results and plots
the actual sector, cupboard and separated route intervals. It does not mutate
furniture or issue an aggregate accessibility result.

## Domain, unknowns and implementation

Finite points, positive radius/section width/target and properly ordered finite
intervals are required. Invalid measurements and overflow fail. Empty obstacles
leave the full supplied section; complete blockage yields no free interval.
Touching is flagged as plan contact, not interpreted as adequate clearance.
Missing/unverified clear width remains null. Missing dimension/height evidence
must remain in the handoff, not become a false safe result.

Current HomePlanner uses heuristic placement/circulation helpers and canonical
door/usable-region geometry. The reference is not a replacement route solver
and does not justify arbitrary layout changes. Dragging a room checks a valid
destination; a person needs a real continuous path. UI accessibility additionally
requires keyboard/focus and single-pointer alternatives, not a geometry equation.

## Primary references

- [US Access Board door guide](https://www.access-board.gov/ada/guides/chapter-4-entrances-doors-and-gates/):
  clear-opening and approach measurement distinctions; US-specific applicability.
- [US Access Board operable parts](https://www.access-board.gov/ada/guides/chapter-3-operable-parts/):
  functional operable part and unobstructed approach, not symbol-height presets.
- [WAI dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
  and [keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html):
  interaction requirements are separate from physical access.
- [Shapely set operations](https://shapely.readthedocs.io/en/stable/reference/shapely.union_all.html):
  optional geometric verification, not a human-clearance standard.

No clinical data, personal functional profile, proprietary standard tables or
unverified software-coverage claims are used. See the
[existing research baseline](../../../../docs/research/building-performance.md)
before deriving any comfort/health claim from environmental displays.
