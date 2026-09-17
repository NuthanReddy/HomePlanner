# Supplied power quantities and spatial envelopes

Checked **17 Sep 2026**. Read [source applicability](sources.md) and the
[current point-layer contract](../../../../docs/electrical-planning.md).
HomePlanner presently records/coordinates electrical points, not circuit loads,
cables, protective devices or a power-system model. These reference formulas
do not add such fields to `loadCategory` or confer installation authority.

## Symbols and units

| Symbol | Meaning | Unit / sign |
| --- | --- | --- |
| `V,I` | Supplied sinusoidal RMS voltage and current | V, A; nonnegative consumption magnitude |
| `phi,pf` | Current lag angle, displacement power factor `cos(phi)` | radians, fraction |
| `P,Q,S` | Active, reactive and apparent power | W, var, VA; Q positive for lagging/inductive consumption |
| `t,E` | Elapsed operating time and active energy | s, J or kWh |
| `zFF,z,e` | Floor elevation, floor-relative datum height, envelope height | m |
| `w,twall,s` | Envelope width, wall thickness, distance from oriented wall start | m |
| `tx,ty,nx,ny` | Unit wall tangent and selected face normal | dimensionless, local x right/y down |

## Power and energy, only for the declared problem

For single-phase steady sinusoidal conditions:

```text
S = V*I
P = V*I*cos(phi) = S*pf
Q = V*I*sin(phi) = signReactive*S*sqrt(1-pf²)
P² + Q² = S²
```

The reference uses nonnegative P and `pf in [0,1]`; Q is positive for
lagging and negative for leading. Generation needs an explicitly different
sign convention. For balanced sinusoidal three-phase loads with line-line
RMS voltage and line current, replace S by `sqrt(3)*VLL*IL`.
Do not use that factor with phase-neutral voltage or for an unbalanced network.
Under distortion, total power factor, displacement power factor and reactive
power definitions differ: `sqrt(S²-P²)` is not generally just reactive power.
At S=0, the ratio P/S is undefined, although P=Q=S=0 is valid.

For supplied piecewise constant active power:

```text
EJ = sum(P_i*dt_i)
EkWh = EJ / 3,600,000
```

Use actual active power, not VA, for kWh. No duty-cycle, diversity, starting
current, tariff or installed operating schedule is inferred. Cable ampacity,
voltage drop, fault current, earthing and protective-device coordination need
complete supply/load/installation/product inputs, adopted code and qualified review.

## Supplied mounting geometry

For wall endpoints a,b:
`length=hypot(bx-ax,by-ay)`, `t=(b-a)/length`. In local x-right/y-down coordinates
the **left** normal is `(ty,-tx)`; right is its negative.

```text
facePoint = a + s*t + (twall/2)*n
plateAlongWallSpan = [s-w/2, s+w/2]          [centre datum in plan]
absoluteZ = zFF + floorRelativeZ
```

The whole along-wall and vertical span must lie on actual supporting solid
sections, not merely have its centre inside the wall. This simple reference
does not resolve apertures, hosts or wall-lineage repairs.

For a supplied vertical envelope height e:

```text
plate-centre datum:   bottom=z-e/2, top=z+e/2
plate-bottom datum:   bottom=z,     top=z+e
operable-part datum:  bottom=z-offsetToBottom, top=bottom+e
```

An operable-part-to-bottom offset must be explicitly supplied; plate centre is
not a substitute. Unknown datum/envelope evidence cannot prove reach or clearance.
Vertical overlap length of two known bands is
`max(0,min(top1,top2)-max(bottom1,bottom2))`. Zero means no positive-height
overlap, not a safe installation gap. Plan overlap with unknown height remains
unassessed. Door sweep, plug projection, furniture and wet-area context need
the actual supplied 3D envelopes and specialist review.

## Worked synthetic examples

- 230 V RMS, 10 A RMS, pf=0.8 lagging yields **S=2300 VA**,
  **P=1840 W**, **Q=1380 var**. Leading gives Q=-1380 var.
  Operating at that P for 2 h gives **3.68 kWh**, not 4.6 kWh from VA.
- A supplied 30 W fan for 30 minutes uses **0.015 kWh**; this does not
  determine delivered ventilation, sound or a safe circuit.
- Wall `(0,0)`→`(4,0)` m, thickness 0.2 m, offset 1 m, left face gives
  point **(1,-0.1) m**.
- A 0.08 m-high plate centred 0.30 m above finished floor spans
  **[0.26,0.34] m**. At floor elevation 3.2 m its absolute band is
  **[3.46,3.54] m**, with the floor offset applied once.

The [stdlib fixture](../scripts/example.py) calculates a power triangle and a
labelled envelope SVG using these actual values. All numbers are synthetic
inputs, not device/mounting/circuit recommendations.

## Domain, unknown and primary references

Reject nonfinite/missing power inputs, nonpositive voltage, negative consumption
current/power/time, invalid pf, unsupported phase count, zero-length walls and
out-of-wall offsets. Zero current/power/duration is valid. A missing envelope
height yields a null band, not an invented standard plate. Negative derived
floor-relative plate bottoms fail rather than being clamped. Overflow fails.

- [OpenStax, power in an AC circuit](https://openstax.org/books/university-physics-volume-2/pages/15-4-power-in-an-ac-circuit):
  sinusoidal RMS/average-power basis; not building installation guidance.
- [BIPM SI brochure](https://www.bipm.org/en/publications/si-brochure):
  coherent unit definitions; electrical installation ratings are separate.
- [US Access Board operable parts](https://www.access-board.gov/ada/guides/chapter-3-operable-parts/)
  and [door guidance](https://www.access-board.gov/ada/guides/chapter-4-entrances-doors-and-gates/):
  measurement/approach context, not universal residential mounting thresholds.
- [HSE electrical FAQs](https://www.hse.gov.uk/electricity/faq.htm):
  competence and environmental review, not local code adoption.

Preserve the [energy-audit research limits](../../../../docs/research/home-energy-audit-simulator.md)
and [toolchain baseline](../../../../docs/research/building-analysis-toolchain.md):
energy arithmetic and point drawings are not an audit or engineering certification.
