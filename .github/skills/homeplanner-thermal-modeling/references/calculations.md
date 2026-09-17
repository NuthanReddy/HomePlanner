# Assemblies, sensible RC states and supplied psychrometric evidence

Checked **17 Sep 2026**. Read [source/method limits](sources.md) and the
[current building-physics contract](../../../../docs/building-physics.md).
The [HVAC](../../../../docs/research/hvac-load-calculator.md),
[humidity](../../../../docs/research/building-humidity-mold-risk.md),
[energy comparison](../../../../docs/research/building-energy-model-comparator.md)
and [audit](../../../../docs/research/home-energy-audit-simulator.md) reviews
separate educational screens from calibrated/design/health claims.

## Symbols, units and signs

| Symbol | Meaning | Unit / convention |
| --- | --- | --- |
| `d,k,rho,c` | Layer thickness, conductivity, density, specific heat | m, W/(m·K), kg/m³, J/(kg·K) |
| `Rsi,Rse,R,U` | Explicit films, total resistance, transmittance | m²·K/W, m²·K/W, m²·K/W, W/(m²·K) |
| `Careal,C` | Areal material heat capacity, effective lumped zone capacity | J/(m²·K), J/K; not interchangeable |
| `H,Hi,j` | Outside/interzone conductance | W/K, nonnegative |
| `T,Tout` | Zone state and boundary temperature | °C; differences equal K differences |
| `P` | Declared sensible gains | W, positive adds heat, negative extracts heat |
| `dt,E` | Elapsed interval duration and energy | s, J |
| `p,pv,psat(T)` | Total pressure, water-vapor partial pressure, saturation pressure | Pa |
| `phi,w,epsilon` | RH fraction, humidity ratio, water/dry-air molar mass ratio | 0..1, kg water/kg **dry** air, dimensionless |

## Series layers, capacity and conduction

For homogeneous one-dimensional series layers with explicit films:

```text
R = Rsi + sum(d_i/k_i) + Rse
U = 1/R
Careal = sum(rho_i*c_i*d_i)
componentGainW = U*suppliedArea*(Tout-Tin)
```

Specific heat in kJ/(kg·K) must be multiplied by 1000 before use. Parallel
framing paths, thermal bridges, moisture, cavities and layer temperature
dependence are separate models. Equal U does not imply equal lag or peak
temperature. `Careal*someArea` is not automatically the effective zone C.
Glazing whole-window U, SHGC and VLT have distinct units/spectral meanings.
Neither incident solar W/m² nor VLT is an automatic sensible zone gain.

## Sensible RC equation and timestepping

For supplied piecewise-constant forcing and initial state:

```text
C_i*dT_i/dt = Hout_i*(Tout-T_i) + sum_j(Hij*(T_j-T_i)) + P_i
```

For one zone with H>0:

```text
Teq = Tout + P/H
tau = C/H
Texact(t+dt) = Teq + (T(t)-Teq)*exp(-dt/tau)
```

For H=0, `Texact=Told+P*dt/C`. Zero elapsed time leaves the initial state.
An exact exponential is available only for this constant single-zone forcing;
it is not the app's general multizone implementation.

The app uses backward Euler. For one zone:

```text
(C+dt*H)*Tnew = C*Told + dt*(H*Tout+P)
deltaT = dt*(H*(Tout-Told)+P)/(C+dt*H)
```

For multiple zones, the linear system has diagonal
`C_i/dt+Hout_i+sum(Hij)`, off-diagonal `-Hij`, and right-hand side
`(C_i/dt)*Told_i+Hout_i*Tout+P_i`.
It is first-order in time: numerical stability does **not** imply accuracy for
large steps. Refine dt over the same physical forcing; changing both dt and
the input schedule is not a convergence test. No automatic warmup exists.

For the actual implicit step's energy ledger:

```text
stored_i = C_i*(Tnew_i-Told_i)
outdoor_i = dt*Hout_i*(Tout-Tnew_i)
exchange_i,j = dt*Hij*(Tnew_j-Tnew_i)
gains_i = dt*P_i
residual_i = stored_i - outdoor_i - sum(exchange_i,j) - gains_i
```

Interzone terms are equal/opposite for the same Hij and temperatures. Check
each residual and maximum absolute residual as well as the global sum; global
cancellation can hide local error. These end-temperature energies are a
**discrete** backward-Euler ledger, not exact continuous integrals evaluated
using the exact exponential endpoint.

## Psychrometric identities: separate reference, not current app coupling

For a supplied consistent moist-air state and a chosen saturation-pressure
method/phase:

```text
pv = phi*psat(Tair)
w = epsilon*pv/(p-pv)
pv = p*w/(epsilon+w)
psat(TdewPoint) = pv
surfaceSaturationRatio = pv/psat(Tsurface)
```

All pressures must be in the same unit; this package uses Pa. RH input is a
fraction, not percent. Humidity ratio uses dry-air mass, not total moist-air
mass. At phi=0, pv=w=0 in this ideal identity; finite dew point is unavailable.
Saturation-pressure methods distinguish water/ice and their valid ranges.

The stdlib reference **does not invent a saturation-pressure curve or derive
surface temperature from zone air**. It accepts explicitly supplied
temperature/psat pairs. If surface temperature or its consistent saturation
pressure is missing, the surface result is null.
For a supplied surface, ratio >1 indicates thermodynamic condensation
potential under the stated common vapor pressure; ratio=1 is saturation, not
a finite amount/rate of liquid. A ratio above one is a hypothetical
pre-condensation saturation ratio, not a sustainable measured surface RH.
Air pressure/saturation pairs still need sourced property consistency checks.

A surface/dew-point comparison says nothing about interstitial transport,
rain, leaks, sorption, wet-surface evaporation/drying or mold presence/growth.
PsychroLib provides properties, not a dynamic VTT/Tampere or WUFI Bio model.
Those need a chosen published method/version, hourly **surface** conditions,
material sensitivity and exposure/decline history. A generic 80% RH threshold
or condensed-air flag is neither that model nor clinical/code assurance.

## Worked synthetic calculations

1. Explicit layers `(d,k,rho,c)` =
   `(0.10,0.50,800,1000)` and `(0.05,0.04,30,1400)` in the units above;
   films Rsi=0.13, Rse=0.04 m²·K/W:
   **R=1.62 m²·K/W**, **U=0.6172839506 W/(m²·K)**,
   **Careal=82,100 J/(m²·K)**. These are toy properties/films, not product presets.
2. C=360,000 J/K, H=100 W/K, T0=20°C, Tout=10°C, P=0, dt=3600 s:
   tau=3600 s; **exact T=13.678794412°C**,
   **one backward-Euler step=15°C**. Ten 360 s implicit steps give
   **13.855432894°C**, closer but not exact.
   The one-step stored/outdoor energies are both **-1,800,000 J**.
3. C=100,000 J/K, H=0, P=500 W for 600 s from 20°C gives **23°C**
   and **300,000 J** stored, in either integration method.
4. Independently supplied air `(25°C, psat=3169 Pa)`, phi=0.60,
   p=101325 Pa, epsilon=0.621945 give pv=**1901.4 Pa** and
   w≈**0.01189422052 kg/kg dry air**.
   A separately supplied surface `(15°C, psat=1705 Pa)` gives a hypothetical
   saturation ratio **1.115190616**, hence condensation potential under this
   input model. The rounded pressures are synthetic supplied values, not an
   implemented property table. With surface temperature absent, the result is null.

The [stdlib fixture](../scripts/example.py) computes these quantities and an
actual exact-versus-implicit temperature SVG. Neither curve is a real-room
prediction; the psychrometric example is a different, uncoupled reference.

## Domain, current implementation and primary references

Require finite positive layer d/k/rho/c and zone C, nonnegative films/H, explicit
physical temperatures, signed gains and nonnegative reference elapsed time.
The current app requires positive step durations; zero time here tests the
analytical identity only. Reject unknown required values, zero total R,
nonfinite/overflow results and increments too small to resolve in temperature.
Zero H is adiabatic, not missing H. `pv>=p`, invalid RH, nonpositive saturation
pressure or absent required pressure is invalid, not a dry/zero-moisture result.

Current app support is series assembly descriptors and sensible lumped RC
scenarios. Weather/solar/airflow/HVAC/moisture coupling, surface temperature,
comfort and mold are not inferred. Imported EPW interval-end, fixed-standard
time is not an IANA-DST thermal interval-start timestamp.
Degree-day UA screens and simple payback from the historical research are not
annual HVAC consumption, calibrated savings, Manual J/S or rating certification.

- [EnergyPlus zone integration](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/basis-for-the-zone-and-air-system-integration.html):
  storage/exchange/gain balances and separate moisture physics.
- [EnergyPlus material inputs](https://bigladdersoftware.com/epx/docs/25-1/input-output-reference/group-surface-construction-elements.html#material):
  distinct SI material properties; not product recommendations.
- [PsychroLib API](https://psychrometrics.github.io/psychrolib/api_docs.html):
  SI selection, RH fractions, pressure and dry-air humidity-ratio semantics.
- [NFRC](https://nfrc.org/): distinct U, SHGC, VLT and condensation-related ratings.
- [Finnish mould growth model](https://research.tuni.fi/buildingphysics/finnish-mould-growth-model/)
  and [WUFI Bio](https://wufi.de/en/wufi-bio/): distinct model scope, not a
  diagnosis or an established generic Python dependency.
