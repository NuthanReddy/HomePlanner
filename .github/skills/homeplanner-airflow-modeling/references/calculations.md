# Pressure flow, conservation and bounded dilution

Checked **17 Sep 2026**. Use the [primary-source scope](sources.md), current
[network](../../../../docs/airflow-visualizer.md) and
[field](../../../../docs/airflow-field.md) contracts. The
[bathroom research](../../../../docs/research/bathroom-exhaust-effectiveness.md),
[IAQ review](../../../../docs/research/indoor-air-quality-ventilation.md) and
[gym review](../../../../docs/research/gym-co2-humidity.md) motivate a **separate**
well-mixed reference, not an installed contaminant or moisture model.

## Symbols, units and signs

| Symbol | Meaning | Unit / sign |
| --- | --- | --- |
| `pFrom,pTo,pImposed` | Zone and imposed pressure terms | Pa; gauge datum is explicit |
| `deltaP` | `pFrom-pTo+pImposed` | Pa, positive drives from → to |
| `Cd,A,rho` | Discharge coefficient, operating free area, constant density | fraction in (0,1], m², kg/m³ |
| `Q` | Signed link volume flow | m³/s, positive from → to |
| `V` | Supplied clear zone volume | m³, positive |
| `d,W` | Model depth and channel width | m |
| `phi,u` | Potential and depth-averaged velocity | m²/s and m/s; not pressure/receiver-height velocity |
| `C,Cin,G` | Scalar concentration, inlet concentration, source rate | e.g. mg/m³, mg/m³, mg/s; use one consistent quantity |
| `t` | Elapsed time | s |

## Orifice network and ACH

```text
deltaP = pFrom - pTo + pImposed
Q = Cd*A*sign(deltaP)*sqrt(2*abs(deltaP)/rho)
massFlow = rho*Q
zoneVolumeResidual = sum(signed outward Q)
zoneMassResidual = rho*zoneVolumeResidual
directOutsideInflowACH = 3600*directOutsideInflow/V
```

At zero pressure or zero area, Q is zero **when required inputs are known**.
Reversing all pressure differences reverses Q. A known operating free area is
already the aerodynamic area; do not multiply it by `openFraction` again.
Check it against physical width × height × allowed operating fraction first.
One pressure reference is needed per connected component. A sealed component
does not acquire an outdoor connection merely by fixing its gauge.

Residuals must be checked **at every node**, with declared tolerance/iterations
and solver status. A signed global sum can cancel local failures. Direct-outdoor
ACH is not total transfer airflow, fresh-air effectiveness, pollutant removal,
single-sided two-way exchange or ventilation compliance.

## Depth-averaged potential field

For uniform declared depth `d=V/usableArea`, the current field's sign convention is

```text
u = -grad(phi)                 div(d*u) = 0
Qij = d*faceWidth/centreDistance * (phi_i-phi_j)
sum(outward face fluxes at cell) = 0
uniform-channel mean velocity = Q/(d*W)
```

Boundary outlet flux is positive, inlet negative; solid boundaries have zero
normal flux. Each disconnected usable component must balance independently.
Phi has units m²/s, not Pa. Its additive gauge does not affect velocity.
The uniform-channel formula is an analytical test of a special geometry,
not a replacement for the aperture mapping/finite-volume solve.
`abs(Q)/A` is aperture-mean velocity and is yet another quantity.

The field does not resolve no-slip layers, turbulence, jet entrainment, furniture
drag, buoyancy, vertical mixing or occupant-height airspeed. Lower residuals
or a finer grid do not establish validated CFD.

## Independent well-mixed scalar reference

With constant V, equal delivered inlet/outlet flow Qd, constant inlet scalar
and constant source:

```text
V*dC/dt = G + Qd*(Cin-C)
lambda = Qd/V
C(t) = Cin + (C0-Cin)*exp(-lambda*t) + (G/Qd)*(1-exp(-lambda*t))  [Qd>0]
C(t) = C0 + G*t/V                                               [Qd=0]
```

Use `expm1` for `1-exp(-lambda*t)` near zero. For source-free monotonic decay
with `C0 > Ctarget > Cin`, the finite reach time is
`tTarget=(V/Qd)*ln((C0-Cin)/(Ctarget-Cin))`. An already met target takes zero;
no delivered flow or a target at/below the inlet concentration gives no finite
decay time (`null`) unless it was already met.

The bathroom RH form treats RH as a passive scalar **only under explicitly
equal-temperature, fixed-condition isothermal dilution, with no continuing
moisture source**. Here RH is a fraction 0..1, not percent. It is an educational
approximation, not general humidity-ratio transport. For unequal temperatures
use a separately defined dry-air/water mass balance and psychrometric properties.
No wet-surface evaporation, sorption, condensation or drying time is calculated.
Fan nameplate CFM, door-gap area and a wind rose do not determine delivered Qd.
CO2 additionally needs supplied generation and ppm/volume-fraction conversion;
do not import the gym review's inconsistent commercial rate claims.

## Worked synthetic numbers

- `Cd=0.5`, `A=0.2 m²`, `rho=1.2 kg/m³`, `deltaP=0.6 Pa` yield
  **Q=0.1 m³/s**, mass flow **0.12 kg/s**. Reversal gives -0.1 m³/s.
  Outward flows `[-0.1,+0.1]` have zero nodal residual.
- Direct outdoor inflow 0.1 m³/s into a supplied 30 m³ volume gives **12 h⁻¹**.
  A 15 m² usable area gives d=2 m; W=2 m gives channel velocity **0.025 m/s**.
- A **separate delivered-flow scenario**, Qd=0.05 m³/s, V=30 m³,
  C0=0.90, Cin=0.40, both air streams 25°C, no continuing source:
  after 600 s, RH scalar = **0.5839397206**; target 0.50 takes
  **965.6627475 s**. This is room-air dilution, not bathroom/material drying.

The [stdlib example](../scripts/example.py) computes these results and plots the
actual synthetic dilution samples in a labelled SVG. Normal and `--check`
outputs use exactly the same example calculations.

## Domain and current-versus-reference boundary

Missing/nonfinite inputs, nonpositive rho/V/depth/width, Cd outside (0,1],
negative free area/delivered flow/time or nonfinite results fail explicitly.
Zero forcing, closed area, zero source and zero elapsed time are valid known
states. Tiny positive flow coefficients that underflow must not masquerade as
sealed links. Equal-temperature RH requires supplied temperatures, not defaults.

The app implements the selected-room orifice network and optional numerical
plan field. It does **not** implement this scalar/CO2/RH scenario merely because
this package contains the reference equation.

## Primary sources

- [NIST CONTAM](https://www.nist.gov/services-resources/software/contam):
  airflow and contaminant transport are separate model capabilities.
- [EnergyPlus AirflowNetwork](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/airflownetwork-model.html):
  pressure links and nodal conservation; its mass-flow/components differ from
  the constant-density one-way volumetric model here.
- [EnergyPlus zone integration](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/basis-for-the-zone-and-air-system-integration.html):
  source, storage and exchange balances with separate moisture physics; no
  inherited solver validation.
- [NASA grid convergence](https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html):
  refinement of the same problem, not empirical validation or mixing effectiveness.
