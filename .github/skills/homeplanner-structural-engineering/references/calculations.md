# Equilibrium and a bounded elastic beam reference

Checked **17 Sep 2026**. Read [mechanics/source applicability](sources.md) and
the [current structural intent contract](../../../../docs/conceptual-structure.md).
Current HomePlanner models geometry and coordination, **not** structural
analysis or code design. The following synthetic mechanics reference cannot
select a safe member, foundation, connection or demolition operation.

## Symbols, units and signs

| Symbol | Meaning | Unit / convention |
| --- | --- | --- |
| `L,x` | Support span and distance from left support | m; L>0, 0<=x<=L |
| `q,P` | Supplied uniform line load / point load | N/m, N; positive downward |
| `RA,RB` | Left/right support reactions | N; positive upward |
| `V,M` | Shear and sagging bending moment | N, N·m; dM/dx=V, dV/dx=-q |
| `E` | Supplied Young's modulus, not strength | Pa = N/m², positive |
| `I` | Supplied second moment about the bending axis | m⁴, positive; not kg·m² mass inertia |
| `v` | Transverse deflection | m, positive downward |
| `y` | Fibre coordinate about neutral axis | m, positive upward |
| `sigma` | Axial bending stress | Pa, tension positive |

The mechanics coordinate system is not the drawing's site-elevation convention.
The app's beam anchors are bottom-centres with depth upward, not structural
neutral-axis or support definitions. Do not derive E, I or restraints from a
rendered width/depth/material label.

## Static equilibrium

For a stable declared free body: `sum(Fx)=0`, `sum(Fz)=0`, `sum(M)=0`.
With downward point loads Pi at ai on a simply supported span:

```text
RB = sum(Pi*ai)/L
RA = sum(Pi) - RB
RA + RB - sum(Pi) = 0
RB*L - sum(Pi*ai) = 0
```

This is a pin/roller bending problem with no applied end moment and no support
settlement. Negative reactions for supplied uplift loads are algebraic results,
not evidence the physical support can resist uplift. No loads means zero
response **in this model**; self-weight is not silently added.

## Prismatic simply supported Euler–Bernoulli beam

Assume small displacement/rotation, linear elasticity, constant E/I, slender
plane bending, stable ideal supports and a uniform q across the full span:

```text
RA = RB = q*L/2
V(x) = q*(L/2-x)
M(x) = q*x*(L-x)/2
v(x) = q*x*(L³-2*L*x²+x³)/(24*E*I)
E*I*v''''(x) = q          and         v''(x) = -M(x)/(E*I)
Mmid = q*L²/8
vmid = 5*q*L⁴/(384*E*I)
```

For q>=0 the maximum moment/deflection magnitudes occur at midspan. With signed
negative q the response reverses; identify magnitudes versus signed extrema.
For a **separate** central point-load case,
`Mmid=P*L/4`, `vmid=P*L³/(48*E*I)`.
Do not superimpose nonlinear/cracked/buckling responses using these expressions.

Within elementary pure elastic bending, `sigma(y)=-M*y/I`. This is demand under
the model, not allowable stress/capacity. E is not material strength.
Shear deformation, large deflection, instability, torsion, load combinations,
creep, cracking, reinforcement, seismic response, connections, bearing,
foundations and soil are outside this reference.

## Worked synthetic calculations

Supplied L=4 m, q=1000 N/m, E=200,000,000,000 Pa, I=0.000008 m⁴:

- EI = **1,600,000 N·m²**.
- RA=RB=**2000 N**; total reaction 4000 N balances qL.
- At x=2 m, V=**0 N**, M=**2000 N·m** and
  v=**0.002083333333 m = 2.083333333 mm**.
- At x=0 or x=L, v and M are zero; the supports are not clamped (rotation
  is not constrained to zero).
- A separately supplied top-fibre y=0.10 m has sigma=**-25,000,000 Pa**.
  This says nothing about strength, safe section or applicable design limits.
- A separate central P=2000 N case at the same E/I/L gives
  vMid=**0.001666666667 m**, with reactions 1000 N each.

The [stdlib example](../scripts/example.py) computes these responses, equilibrium
residuals and the actual synthetic deflection curve in SVG. Its ordinate is
explicitly magnified for readability, not a drawing of actual building deformation.

## Domain, failures and implementation boundary

Require finite positive L/E/I, finite loads, valid load positions and finite
computed stiffness/response. Zero load is valid; zero span, missing stiffness,
out-of-span positions, overflow/underflow and nonfinite values are errors.
Arbitrary restraints, instability/singularity and nonconvergence are unsupported,
not zero-demand or “safe” outcomes. No code-specific span/deflection limit is
embedded in the reference.

The app retains `engineeringStatus: 'not-assessed'`, including when authored
sizes have an engineer-provided provenance label. Geometry/contact findings,
these equation checks, an external solver's convergence and professional code
design are four different evidence levels.

## Primary and technical sources

- [MIT Mechanics & Materials I](https://ocw.mit.edu/courses/2-001-mechanics-materials-i-fall-2006/pages/lecture-notes/):
  statics, shear/moment, elasticity and beam-deflection teaching, not a building code.
- [SymPy continuum-mechanics beam documentation](https://docs.sympy.org/latest/modules/physics/continuum_mechanics/beam.html):
  an optional independent symbolic check with explicit sign/boundary conventions.
- [NASA-STD-7009 landing page](https://standards.nasa.gov/standard/NASA/NASA-STD-7009):
  intended-use/model-credibility context, not local structural approval.
- [Existing toolchain research](../../../../docs/research/building-analysis-toolchain.md):
  imported/rendered geometry does not establish engineering semantics.
