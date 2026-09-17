# Site calculations: units, envelopes and bounded scenarios

These are reference calculations, not a sanction, survey or title opinion.
Read [the legal source hierarchy](sources.md) before selecting a statutory
parameter. The runnable example supplies synthetic dimensions and setbacks;
it does not reproduce the rule tables or determine TDR eligibility.

## Symbols and units

| Symbol | Meaning | Unit / constraint |
| --- | --- | --- |
| \(W_g,D_g\) | Gross rectangular east-west / north-south extents | m, positive |
| \(u_N,u_E,u_S,u_W\) | Explicit boundary-strip deductions | m, nonnegative |
| \(W_n,D_n,A_n\) | Net property extents and area, after deductions | m, m, m2 |
| \(s_N,s_E,s_S,s_W\) | Applied cardinal setbacks | m, supplied, nonnegative |
| \(r_e\) | Required setback on edge \(e\), from the chosen rule scenario | m, not inferred |
| \(B_W,B_D,A_b\) | Envelope width, depth and area | m, m, m2 |
| \(q,A_o,A_u\) | Modelled open-space fraction, deduction and usable footprint | 1, m2, m2 |
| \(H,h_f,F\) | Scenario height, floor-to-floor spacing, planned floor count | m, m, integer |

No formula below accepts an unknown road width or missing setback as zero.
An explicit zero setback is different from a missing input. Heights for
statutory classification and actual editable storey elevations are different
inputs.

## 1. Exact conversions and arithmetic precision

For the **international** foot and yard:

\[
L_m=0.3048L_{\rm ft},\qquad
A_{m^2}=0.09290304A_{\rm ft^2}
=0.83612736A_{\rm yd^2}.
\]

The area multiplier is the **square** of the length multiplier. For example,
100 ft2 is exactly 9.290304 m2, not 30.48 m2. These definitions are supported
by [NIST's conversion factors](https://www.nist.gov/pml/us-surveyfoot/revised-unit-conversion-factors).
The historical US survey foot is a different unit; do not silently select it
for a drawing or imported survey.

Use `Decimal("0.3048")` when checking exact decimal boundary examples, not
`Decimal(0.3048)`, which retains the binary float's approximation. See the
[Python Decimal reference](https://docs.python.org/3/library/decimal.html).
Keep full precision through computation; round for display only. Exact
arithmetic does not remove uncertainty in the underlying measurement.

## 2. Gross boundary, widening and net property

For an axis-aligned rectangle with explicitly supplied strips:

\[
W_n=W_g-u_W-u_E,\quad D_n=D_g-u_N-u_S,
\]
\[
A_g=W_gD_g,\quad A_n=W_nD_n,\quad A_{\rm surrendered}=A_g-A_n.
\]

Require \(W_n,D_n>0\) before using a net area as a denominator. Subtract the
**union** of strips: adding four full strip areas counts corner intersections
twice. A 12 x 18 m rectangle with a 1 m north strip and a 1 m west strip has
net area \(11(17)=187\) m2 and surrender \(216-187=29\) m2, not 30 m2.

In current `index.html:compute` and `envelopeFor`, an entered positive primary
road width \(R<9\) m invokes the modelled centreline deduction

\[
u_f=\max(0,4.5-R/2),\quad R_{\rm effective}=9\ {\rm m}.
\]

That branch assumes the existing boundary is at the represented road edge.
It is not a surveyed road-reservation intersection. Current `compute` deducts
the **elected primary frontage** strip; the four-strip equation above is a
general geometry reference, not evidence that every corner-road strip is
implemented. No road entry is not evidence of a zero-width road.

## 3. Setback envelope, usable area and comparison

\[
B_W=W_n-s_W-s_E,\quad B_D=D_n-s_N-s_S,\quad A_b=B_WB_D.
\]

For positive \(A_n\), and a separately supplied model deduction fraction:

\[
A_o=qA_n,\quad A_u=\max(0,A_b-A_o),
\]
\[
C=100A_u/A_n,\qquad {\rm loss}=100-C.
\]

Require \(0\le q\le1\). An envelope consumed by setbacks or by \(A_o\) is
**not buildable**, even if a display shows zero. The web calculator clamps
consumed dimensions to zero; the standalone reference deliberately raises
`ValueError` for a nonpositive geometric envelope and returns an explicit
consumed status when the separate open-space deduction exhausts it.
Neither behavior is a permission result.

For each edge preserve required and applied values separately:

\[
\Delta_e=s_e-r_e,\qquad
{\rm belowRequired}_e=(\Delta_e<-\epsilon_g).
\]

Here \(\epsilon_g\) is the application's declared numerical geometry tolerance,
not an additional legal allowance. Do not round before comparison or replace
missing \(r_e\) with zero. A custom setback below a required value must retain
its non-compliant flag; it is not automatically compoundable.

**Worked case:** gross 12 x 18 m; a supplied 1 m north strip gives 12 x 17 m
net, \(A_n=204\) m2. Applied N/S/E/W setbacks 3/1.5/1.5/1.5 m give 9 x 12.5 m
and \(A_b=112.5\) m2. With explicitly supplied \(q=0\), coverage is
55.14705882352941% and loss is 44.85294117647059%. Three repeated **scenario**
plates total 337.5 m2; this is not automatically sanction-counted floor area
or an approved FAR.

See [plot geometry](../../../../docs/plot-geometry.md) and
`index.html:compute`, `envelopeFor`, `scenarioSettings`.

## 4. Fixed-area aspect-ratio optimum

Only for a single fixed rule band with fixed summed lateral setback
\(a=s_W+s_E>0\), longitudinal setback \(b=s_N+s_S>0\), and fixed area \(A>ab\):

\[
D=A/W,\quad E(W)=(W-a)(A/W-b)=A+ab-bW-aA/W,
\]
\[
E'(W)=-b+aA/W^2,\qquad E''(W)=-2aA/W^3<0,
\]
\[
W_*=\sqrt{aA/b},\quad D_*=\sqrt{bA/a},\quad
D_*/W_*=b/a,\quad E_{\max}=(\sqrt A-\sqrt{ab})^2.
\]

For \(A=216\) m2, \(a=3\) m and \(b=4.5\) m: \(W_*=12\) m,
\(D_*=18\) m and \(E_{\max}=121.5\) m2. The optimum is invalid if \(a=0\),
\(b=0\), the dimensions cannot exceed setbacks, or frontage/access constraints
exclude it. The reference requires finite positive inputs rather than
silently producing infinity. This derivation does not optimize changing
height bands, subdivision legality, access, road election or market value.

## 5. Floors, TDR and discontinuous rule branches

The current schematic count in `compute` is:

\[
F_{\rm base}=\min\!\left(\left\lfloor H/h_f+\epsilon_f\right\rfloor,
F_{\rm road}\right),\quad
F_{\max}=F_{\rm base}+F_{\rm TDR},
\]
\[
F_{\rm plan}=\min(F_{\rm requested},F_{\max}),\quad
A_{\rm scenario}=F_{\rm plan}A_u.
\]

`\(\epsilon_f=10^{-9}\)` is the code's dimensionless floor-division tolerance,
not extra physical height. Validate \(h_f>0\) and integral floor counts.
G+n means n+1 habitable floors in these labels. Do not create editable floors
from \(F_{\max}\); actual floor \(k\)'s elevation comes from base elevation plus
the heights of its preceding stored floors.

Review these **implementation distinctions** before changing a boundary:

- Current high-rise classification is \(H\ge21\) m. The explicit TDR-band
  branch uses \(18<H<21\), and `fillHeights` offers its 20 m scenario for
  750 <= net area <= 2,000 m2 with TDR enabled.
- The extra-floor branch requires net area **above** 2,000 m2 and TDR.
  Its code thresholds are 12/18/24 m, while labels say 40/60/80 ft.
  Those are rounded bands: 40 ft is exactly 12.192 m, not 12 m. This reference
  documents the discrepancy; it does not silently change a legal threshold.
- The modelled high-rise TDR setback uses
  \(s_{\rm relaxed}=\max(7,0.9s_{\rm base})\) m and
  \(s_{\rm front}=\max(s_{\rm relaxed}, {\rm buildingLine})\).
  This is not a waiver of every other condition.
- The 18-21 m band's setback row is a disclosed interpretation in this
  repository, not a restated table from the amendment.

The [regulatory basis](../../../../docs/regulatory-basis.md) and
[source hierarchy](sources.md) explain which original/amended documents need
verification. Test both sides of every boundary, exact conversions, zero and
missing inputs. A numeric branch alone is not legal eligibility.

## 6. Split plots

\[
W_1=tW,\quad W_2=(1-t)W,\quad
A_{\rm combined}=A_{u,1}+A_{u,2}.
\]

Evaluate each sub-plot with **its own** net area and rule band; do not divide
the already-computed whole-plot footprint. Current `bestSplit` samples
15/85 through 85/15 in 0.0025 increments. A sampled best is not a proven
continuous global optimum or subdivision approval.

## Runnable evidence

Run [the standard-library example](../scripts/example.py) with `--check`.
It checks exact conversions, both-strip corner accounting, a worked envelope,
finite/invalid cases, open-space exhaustion and the fixed-band optimum, and
returns a labelled schematic SVG. Optional GIS and publication tools are in
[python-tools.md](python-tools.md).
