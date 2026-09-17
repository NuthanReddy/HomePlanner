# Continuity, levels and separate hydraulic reference laws

Checked **17 Sep 2026**. Read [EPA source applicability](sources.md),
[service networks](../../../../docs/plumbing-networks.md) and
[drainage coordination](../../../../docs/drainage-coordination.md).
The app currently evaluates topology/geometry and invert intent, **not**
hydraulic flow, pipe capacity, receiving capacity or permitted discharge.

## Symbols and units

| Symbol | Meaning | Unit / sign |
| --- | --- | --- |
| `Q` | Signed link volume flow | m³/s, positive from → to |
| `dV/dt` | Storage increase | m³/s, positive accumulation |
| `z` | Independently supplied invert elevation | m, positive upward in the project datum |
| `Lxy,Lxyz` | Horizontal profile run and axis route length | m, different quantities |
| `S0,Sf` | Geometric fall/run and energy/friction gradient | m/m; only equal in the stated uniform-flow idealization |
| `D,A,Pw,Rh` | Internal diameter, water area, wetted perimeter, hydraulic radius | m, m², m, m |
| `v,nu,rho,g` | Mean velocity, kinematic viscosity, density, gravity | m/s, m²/s, kg/m³, m/s² |
| `fD,K,n` | Darcy friction factor, minor-loss coefficient, SI Manning roughness | dimensionless, dimensionless, s/m^(1/3) |

Do not substitute nominal `diameterMm` for verified internal D or outside clash
diameter. Convert a supplied verified mm dimension with `D_m=D_mm/1000`.
Axis anchor z, invert, ground level, finished floor and outfall are separate data.

## Geometry and continuity

```text
Lxyz = sum(sqrt(dx²+dy²+dz²))
Lxy = sum(sqrt(dx²+dy²))
fall_i = invert_i - invert_(i+1)
gradient_i = fall_i / horizontalRun_i        [horizontalRun_i > 0]
intendedFall = suppliedSlope * completeHorizontalRun
```

Vertical drops have no finite horizontal gradient (`null`), not infinity.
Reverse fall is negative and diagnostic, not clamped to a positive slope.
Missing route spans make total length unknown. Endpoints can establish a total
fall without establishing intermediate inverts or local gradients; do not
interpolate missing via levels.

For a separately supplied hydraulic node/control volume:

```text
continuityResidual = sum(Qin) - sum(Qout) - demand - dV/dt
```

Steady incompressible flow requires zero storage. A network needs each nodal
residual and applicable energy relations, boundary conditions and convergence.
Current app hydraulic residuals are **not evaluated**, not numerical zero.

## Full-pipe pressure loss: Darcy–Weisbach

For a circular, filled pipe with supplied internal D, Newtonian fluid properties
and a Darcy factor appropriate to the actual Reynolds/roughness regime:

```text
A = pi*D²/4
v = Q/A
Re = abs(v)*D/nu
signedHeadLoss = (fD*L/D + sum(K))*v*abs(v)/(2*g)
signedPressureDrop = rho*g*signedHeadLoss
```

With positive Q, head decreases in the authored from→to direction; negative Q
reverses the signed loss. The unsigned dissipated-head magnitude is nonnegative.
The Darcy factor is **four times** the Fanning factor; do not mix them.
Selecting fD additionally requires a declared method, supplied roughness and
fluid state. For fully developed laminar circular flow `fD=64/Re`, but this is
not a general rough/turbulent/transition rule and is undefined at Re=0.
The reference accepts a supplied fD, never selects a pipe or invents material data.

## Free-surface uniform flow: Manning in SI

```text
Rh = A/Pw
Q = (1/n)*A*Rh^(2/3)*sqrt(Sf)
```

This reference uses a supplied positive wetted cross-section and nonnegative
energy gradient for steady uniform free-surface flow. A rectangular channel
with water depth y and width b has `A=b*y`, `Pw=b+2*y`.
Manning n and section data must be supplied for the actual material/state.
The SI coefficient is 1; do not carry an imperial coefficient into SI.
Do not apply this as pressurized-pipe headloss, a dynamic sewer network,
backwater/tailwater routing, a dry/part-full geometry solver or flood prediction.
Nominal size and invert slope alone cannot determine any of those outcomes.

## Worked synthetic cases

1. An 8 m straight horizontal route with endpoint inverts 1.50 and 1.34 m has
   endpoint fall **0.16 m**, endpoint gradient **0.02 m/m**. At a 4 m via,
   an unknown invert remains unknown; matching a supplied 0.02 intention
   does not establish a complete profile. A separately supplied 1.42 m via
   would give two known 4 m / 0.08 m-fall spans.
2. Inflow 0.020, outflow 0.012 and demand 0.008 m³/s with zero storage give
   **0 m³/s** residual in a synthetic control-volume calculation, not the app.
3. Supplied D=0.10 m, Q=pi*D²/4 m³/s, L=10 m, fD=0.02,
   K=1, rho=1000 kg/m³, nu=1e-6 m²/s, g=9.81 m/s²:
   v=**1 m/s**, Re=**100000**, headloss≈**0.152905199 m**,
   pressure drop=**1500 Pa**. These are declared toy inputs, not pipe sizing.
4. A supplied open rectangular channel b=1 m, y=0.5 m gives A=0.5 m²,
   Pw=2 m. With n=0.025 s/m^(1/3), Sf=0.01:
   Q≈**0.793700526 m³/s**. No domestic drain rating follows from this example.

The [stdlib script](../scripts/example.py) checks these equations and plots
known endpoint levels while leaving the unknown via level unplotted.
It never assigns a default invert or a pipe size to the application.

## Domain and primary references

Require finite resolved geometry, positive internal D/rho/nu/g/n/Pw/A and an
appropriate positive supplied fD; L and minor K may be zero. Negative Manning
gradient, missing hydraulic inputs and overflow fail. Q=0 gives v/headloss=0
for known filled-pipe data; Manning Sf=0 gives Q=0 in that idealization.
Neither case supplies missing data. Zero XY run gives null gradient; unresolved
spans/inverts are retained independently.

- [EPA EPANET](https://www.epa.gov/water-research/epanet) and
  [EPANET 2.2 algorithms](https://usepa.github.io/EPANET2.2/12_analysis_algorithms.html):
  nodal continuity, link headloss and declared pressure-network inputs.
- [EPA SWMM](https://www.epa.gov/water-research/storm-water-management-model-swmm):
  manuals distinguish runoff, conduit/free-surface routing, storage and
  dynamic-wave assumptions. Manning's uniform-flow relation is not the complete solver.
- [WNTR model documentation](https://usepa.github.io/WNTR/waternetworkmodel.html):
  explicit network, options, element data and engine handoff.

These hydraulic references do not supply local code minima, legal outfalls,
fixture discharge rates, rainfall, safe cover or professional approval.
Retain the [toolchain distinction](../../../../docs/research/building-analysis-toolchain.md)
between geometry and an actually configured/validated external model.
