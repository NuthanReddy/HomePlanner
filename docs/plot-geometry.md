# Plot geometry and setback loss

## Coordinate model

All geometry is calculated in metres. User inputs may be in metres or feet and
are converted before computation. The site keeps explicit North, East, South,
and West extents so a corner-road change updates both setbacks and diagrams.

The basic non-high-rise footprint is:

```text
buildable width  = plot east-west extent - west setback - east setback
buildable depth  = plot north-south extent - north setback - south setback
footprint        = max(0, buildable width) x max(0, buildable depth)
usable footprint = max(0, footprint - organised-open-space deduction)
```

Percentage lost is:

```text
100 x (1 - usable footprint / net plot area)
```

## What changes percentage lost

- Plot-size band: Table III side/rear setbacks rise in steps.
- Selected height: taller rows usually require larger setbacks.
- Road band: the front setback changes across <=12, 12-18, 18-24, 24-30,
  and >30 m roads.
- Road widening: a sub-9 m road first removes land from the gross plot.
- Plot dimensions/aspect ratio: fixed setbacks consume a larger share of a
  narrow dimension.
- Corner configuration and elected front edge.
- High-rise Table IV all-round setback.
- Organised open space/tot lot: 5 percent above 750 sq m for non-high-rise and
  10 percent for the high-rise model.
- Junction splay, transformer/public-utility bay, planting strips, and parking
  affect practical site use even when not all are subtracted from the main
  footprint statistic.
- Optional Rule 26(d) scenario changes side/rear geometry only.
- Qualifying TDR can change height/floors or high-rise setbacks.

## Optimal rectangular aspect ratio

For fixed plot area `A`, frontage `W`, depth `D`, front setback `f`, and equal
side/rear setback `s`:

```text
envelope = (W - 2s) x (D - f - s)
D / W    = (f + s) / (2s) at the mathematical optimum
W        = sqrt(2sA / (f + s))
```

Interpretation:

- `f > s`: the optimum is deeper than wide.
- `f < s`: the optimum is wider than deep.
- `f = s`: the optimum is square.

The objective is flat near the optimum. Plot-band boundaries, road width,
usable frontage, access, marketability, and floor count normally matter more
than a small theoretical aspect-ratio gain.

For a road up to 12 m and the tallest non-high-rise row in each band, the
model's representative depth/frontage ratios are:

| Plot band (sq m) | Ratio D/W |
|---|---:|
| 50-100 | 2.00 |
| 100-200 | 1.25 |
| 200-300 | 1.167 |
| 300-400 | 1.25 |
| 400-500 | 1.10 |
| 500-750 | 0.929 |
| 750-1000 | 0.875 |
| 1000-2500 | 0.80 |
| Above 2500 | 0.75 |

Wider roads raise the front setback and can shift the optimum back toward a
deeper plot. A side setback of zero makes the closed-form ratio undefined.

## Split-plot comparison

The split tool assumes both resulting plots directly front the selected road.
For each candidate split it independently:

1. Computes each sub-plot area.
2. Selects that sub-plot's Table III band.
3. Applies its setbacks, height, floor count, and open-space deduction.
4. Adds the two footprints and built-up areas.

It brute-forces split fractions from 15/85 through 85/15 to show the best
footprint. Splitting can help when each half falls into a cheaper setback band,
but can hurt because two plots create four side edges and may lose a height
band. It does not replace subdivision approval, minimum frontage/access, title,
registration, or separate LRS review.

The full derivation is also retained in `../optimal-plot-shape.md`.

