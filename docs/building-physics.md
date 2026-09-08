# Building physics: reduced numerical scenarios

`building-physics.js` exposes the same five pure functions through
`window.BuildingPhysics` and CommonJS. It needs no framework, DOM, network,
astronomy implementation, dependencies, account or solver service. Inputs are
not mutated; outputs contain ordinary JSON-compatible objects, arrays, finite
numbers, strings and booleans.

**These are uncalibrated numerical scenarios, not actual-site indoor-temperature
predictions, CFD, daylight lux, structural analysis, HVAC sizing, moisture
analysis, comfort certification or code compliance.** Numerical conservation
and equation-based tests are not empirical calibration or external-solver
validation.

## Input and error conventions

- Use metres, seconds, pascals, W, J, Celsius and the explicit compound SI units
  in the property names. Numeric strings, `null`, `NaN`, infinities and missing
  required properties are rejected, not coerced to zero.
- Thickness, conductivity, density, specific heat, zone volume and heat capacity
  must be positive. Conductances, film resistances, radiation and free opening
  area may be zero. A zero-area airflow link is explicitly closed.
- IDs must be nonempty strings and unique within their namespace. Unknown
  linked nodes/hosts and thermal/airflow self-links are rejected.
- Unsupported numerical-input fields are rejected rather than silently
  interpreting, for example, a two-way opening as a one-way link. Scene metadata
  outside the geometry contract is not a new physical model.
- Errors are `TypeError`/`RangeError` with field/context messages. Derived
  overflow, underflow of required positive coefficients, and unresolved thermal
  matrix conditioning fail explicitly; there is no broad catch-and-default.
- UI callers must display errors and warnings, obtain acknowledgement of their
  complete scenario inputs, and retain their own source/condition/operation
  provenance. No material selection is silently mapped to a room temperature.

## `assemblyProperties(layers, films?)`

Each layer requires:

```js
{
  thicknessM: 0.2,
  conductivityW_MK: 0.4,
  densityKgM3: 1000,
  specificHeatJ_KgK: 900,
  label: "Hypothetical homogeneous layer", // optional
  source: "Explicit analytical fixture"   // optional
}
```

These numbers are a test example, **not a recommended construction**.
Optional `films` is `{inside, outside}` in m² K/W. Both entries must be supplied
when the object is present. Omission explicitly assumes `0.13` inside and `0.04`
outside, with a warning and a returned copy under `films`; these are not
universal coefficients for every direction or boundary condition.

```text
R = Rinside + Σ(d/k) + Routside               [m² K/W]
U = 1/R                                     [W/(m² K)]
Careal = Σ(rho * c * d)                      [J/(m² K)]
```

Returns `resistanceM2K_W`, `uValueW_M2K`,
`arealHeatCapacityJ_M2K`, `films` and `warnings`. For the example layer and
default films, R = 0.67, U = 1/0.67 and Careal = 180000.

Unknown density/specific heat causes an error even if resistance could otherwise
be evaluated. There is no guessed universal Cp, material-by-name lookup, or
implicit kJ-to-J conversion. Only homogeneous, one-dimensional layer conduction
is included. Cavity resistance models, bridges, contact/mortar effects, moisture,
whole-window U/SHGC and dynamic layer-order/time-lag effects are not calculated.
This capacity descriptor is **not automatically the effective zone capacity**.

## `shadowAt(scene, sunENU, options?)`

### Coordinates and supported scene geometry

Provide the contract's **unit vector toward the sun**, `{east,north,up}`, from
the existing SunCalc/HomeSun adapter. Norm is checked within `1e-6`; only its
roundoff is normalized. Angles, degrees, downward light-travel vectors or Three.js
coordinates are not accepted as substitutes. No solar ephemeris is implemented.

All geometry and returned polygon points stay in building-local coordinates:
x right, y rear, z up. `headingDeg` is the road/front true-north-clockwise bearing.
The contract's position transformation is:

```text
dx = local.x - floor.w/2
dy = local.y - floor.h/2
east  = dx*cos(heading) - dy*sin(heading)
north = -(dx*sin(heading) + dy*cos(heading))
```

Ray direction uses its inverse exactly once; vectors have no centre translation:

```text
localSun.x = east*cos(heading) - north*sin(heading)
localSun.y = -(east*sin(heading) + north*cos(heading))
localSun.z = up
```

The module supports:

- A bounded rectangular `scene.floor` ground receiver, and an opaque, flat roof
  over `scene.building`. Its underside is at
  `scene.floorElevationM + scene.wallHeightM`. When additive
  `scene.roofThicknessM` is supplied as a finite nonnegative number, the roof
  receiver is on the top at `underside + roofThicknessM`; a positive thickness
  produces a solid rectangular slab for ray intersections and projection of
  both underside/top vertices. Missing thickness explicitly assumes a
  zero-thickness plane with a warning; an explicit zero also requests a plane.
  Roof-edge/underside areas are not separate irradiance receivers. No thickness,
  thermal assembly properties, parapets or other storeys are inferred.
- Straight **vertical** walls with positive length, thickness and height, and
  explicit `baseM`, `removed` and `exterior`. Walls may have any planar direction.
  Masonry is partitioned into 3D rectangular prisms around openings. Rays
  intersect actual finite thickness, so sill/lintel/jamb reveals can cast shade.
- Canonical `scene.openings` joined by `wallId`, with kind `hinged`, `sliding`,
  `window` or `passage`; `offsetM`, `widthM`, `sillM`, `heightM` and
  `openFraction` are required. Apertures must fit the host wall; a `1e-9` m
  boundary tolerance accommodates floating-point edge roundoff. Overlapping
  apertures on the same host are ambiguous and rejected.
- `wall.solidSegments` is the model's **2D width-only** summary. It is not
  interpreted as missing full-height masonry: the canonical openings provide
  the actual sill/lintel geometry. `removed` suppresses masonry, not a separately
  declared opaque door leaf in a full-wall opening.
- Rectangular building/tree obstacle prisms with local `x,y,w,h,heightM,baseM`
  and **explicit** `transmittance` from 0 to 1.
- Flat, above-ground scenarios only: building floor, wall and obstacle bases
  must not be below the declared ground plane. Sloping roofs, terrain,
  subsurface effects and arbitrary mesh objects are unsupported.

Exterior wall orientation points away from its single adjacent room's centre
when available, otherwise away from the rectangular building centre. An
ambiguous coplanar centre is rejected. The fallback is not a courtyard/enclosure
inference algorithm: such scenes require valid physical adjacency.

### Receivers, opacity and samples

Receiver IDs/types:

| Receiver | ID | Type |
|---|---|---|
| Exterior masonry face | wall ID | `wall` |
| Exterior aperture plane | opening ID | `window` or `opening` |
| Interior wall/aperture faces | ID + `:side-a` / `:side-b` | same corresponding type |
| Main roof | floor ID + `:roof`, or `roof` without floor ID | `roof` |
| Outdoor plot ground | floor ID + `:ground`, or `ground` | `ground` |
| External building faces | obstacle ID + `:roof`, `:west`, `:east`, `:front`, `:rear` | `obstacle-roof` / `obstacle-wall` |
| Rectangular tree envelope faces | same obstacle face suffixes | `canopy` |

Obstacle face names are **local**, not geographic. Ground area excludes the main
building footprint and ground-touching building obstacle footprints; overlapping
exclusions are counted once. Elevated blockers can shade ground below them.
Zero-area material/ground receivers are omitted.

Each receiver consists of rectangular patches. Each patch has an area-weighted
midpoint grid; its row/column counts scale with its size relative to that
receiver's full spans. More samples refine the geometric estimate, but thin
features/off-grid shadow edges can alias. There is no claimed universal
fraction-error bound. Repeat with a finer grid for a scenario convergence check.
Rays use a `1e-7` m intersection tolerance and a `4e-7` m outward receiver bias;
this is building-scale geometry, not submicron modelling.

`sunlitFraction` is in [0,1] and means **effective direct-beam transmission**
averaged over the receiver area, including its facing direction. It is not always
the binary fraction seeing an unobstructed solar disk:

- Opaque objects have zero transmission. Multiple overlapping opaque shadows
  cannot subtract the same receiver area twice.
- Each intersected tree/prism applies its supplied angle-independent
  transmittance once; distinct overlapping objects multiply their transmissions.
  This is a rectangular-canopy scenario, not foliage-area or evapotranspiration
  modelling.
- A window's transmission through its aperture is
  `openFraction + (1-openFraction)*windowTransmittance`. Default closed glazing
  is **explicitly assumed ideal clear, 1**, for geometry only. This is not a
  measured optical property, VLT, SHGC or permission to infer airflow.
- For hinged/sliding doors and passages, optical aperture transmission is
  `openFraction`: the remaining area is assumed opaque. Fractional opening is
  spatially averaged over the aperture, not a reconstructed hinged leaf/sash.
  A displayed swing/hinge angle is not the operating state.
- Transmission applies once per aperture ID, including rays on shared boundaries
  of its sill/lintel tessellation; partitioning does not invent extra panes.
- An exterior window/door receiver reports irradiance incident **before**
  crossing its glazing/leaf. Changing its transmission changes receivers behind
  it, not the irradiance arriving at its outward face.
- Tree receiver area is rectangular-envelope area, not actual leaf area.

Return value:

```js
{
  receivers: [{ id, type, areaM2, sunlitFraction }],
  groundPolygons: [{ obstacleId, points: [{x, y}], transmittance }],
  directSunStatus: "daylight", // or statuses below
  sampling: {method: "area-weighted midpoint rays", samplesPerAxis: 16},
  warnings: [...]
}
```

### Projection bounds and options

Ground polygons are convex projected supports of individual rectangular
casters, not a union and not an energy estimator. Wall pieces can return several
polygons with the same wall ID. For a point at elevation z:

```text
xGround = x - (z-groundElevationM) * localSun.x/localSun.z
yGround = y - (z-groundElevationM) * localSun.y/localSun.z
```

For an upright block touching ground, projection includes both base and top
vertices, producing the footprint plus its shadow. An elevated block's bottom is
also projected, not incorrectly dropped vertically onto the ground.
At height 3 m and elevations 30°, 45°, 60°, the added horizontal extents are
approximately 5.196, 3, 1.732 m.

| `options` field | Default | Allowed/support meaning |
|---|---:|---|
| `samplesPerAxis` | 16 | Integer 1–128; refinement of each receiver's patch grid |
| `groundElevationM` | 0 | Finite elevation of the flat ground plane |
| `minSunAltitudeDeg` | 1 | Greater than 0, less than 90 |
| `maxShadowDistanceM` | 1000 | Positive maximum **horizontal projection displacement** |
| `windowTransmittance` | 1 | Explicit closed-window geometric beam transmission, [0,1] |

- `up <= 0`: status `below-horizon`, fractions zero, polygons empty.
- Positive altitude at/below the cutoff: `near-horizon-suppressed`, fractions
  zero and polygons empty with an explicit warning. Zero here is a numerical
  cutoff, **not a resolved low-sun estimate**.
- Above the cutoff, a caster polygon exceeding the distance bound is omitted
  with a named warning, never replaced by a tiny/clipped fake shadow. Receiver
  rays still use the real supplied geometry. The bound is displacement, not an
  arbitrary constraint on local map coordinates.

Do not sum polygon areas or repeatedly alpha-paint overlapping pieces to infer
energy. Use the independently sampled receiver fractions. No GPU/screenshot
shadow maps enter the calculation.

## `surfaceExposure(scene, sunENU, radiation)`

Required nonnegative finite fields are `dniWm2`, `dhiWm2`, `ghiWm2`.
Optional `groundAlbedo` is [0,1], default **assumed 0.2**, disclosed in warnings.
Radiation must already represent the intended weather/scenario interval in W/m²;
the function does not fetch, interpolate, repair missing records or convert EPW
Wh/m².

This frozen three-argument API uses `shadowAt`'s **default** geometric settings,
not settings from a previous call. Internal faces are excluded: interior
aperture/diffuse view factors are unavailable and explicitly warned about.
For each exterior wall/aperture, roof, obstacle face or ground receiver:

```text
mu = max(0, normal dot localSun)
beam = DNI * mu * sunlitFraction
Fsky = (1 + normal.z)/2
Fground = (1 - normal.z)/2
skyDiffuse = DHI * Fsky
groundReflected = GHI * groundAlbedo * Fground
incident = beam + skyDiffuse + groundReflected       [W/m²]
```

**Separate view assumptions:** the isotropic diffuse and Lambertian ground terms
assume unobstructed sky/ground hemispheres according to tilt. Beam shade is not
reused as a diffuse-darkness fraction. Urban sky occlusion, ground shading,
anisotropy, near-field reflection, canopy diffuse scattering and multiple
reflections are not solved. These are upper-access screening assumptions, not
measured view factors. A shaded vertical face can retain diffuse/reflected
irradiance. Supplied positive diffuse radiation remains separate even when the
sun vector is below the horizon; records are not silently rewritten.

Returns `{surfaces, directSunStatus, warnings}`. Each surface contains
`id,type,areaM2,sunlitFraction,incidentWm2` and separate `beamWm2`,
`skyDiffuseWm2`, `groundReflectedWm2`, `skyViewFactor`, `groundViewFactor`.
This is incident irradiance, not absorbed heat, window solar gain, visible lux,
plant cooling, or automatically an input to `simulateThermal`.

## `solveAirflow(input)`

```js
{
  zones: [{id: "room", volumeM3: 30}],
  links: [
    {id: "in", from: "outside", to: "room", freeAreaM2: 0.5, cd: 0.6, pressurePa: 10},
    {id: "out", from: "room", to: "outside", freeAreaM2: 0.5, cd: 0.6, pressurePa: 0}
  ],
  outsideId: "outside", // optional; default shown
  densityKgM3: 1.2     // optional; assumed constant default is warned about
}
```

The numbers above are analytical fixtures, not inferred opening properties.
`0 < cd <= 1` is required explicitly for this orifice definition. Free area is
the aerodynamic operating area, not automatically glazing area or a plan-symbol
width. All wind/stack forcing is already provided in Pa with a **from-to sign**:

```text
deltaPij = pi - pj + pressurePa_ij
Qij = cd * freeAreaM2 * sign(deltaPij) * sqrt(2*abs(deltaPij)/rho)  [m³/s]
Σ outgoing Q - Σ incoming Q = 0                                [each zone]
```

Positive flow is from `from` to `to`. A consistent constant density on all links
makes mass residual rho times the volume-flow residual. `volumeM3` is validated
but does not enter a steady pressure balance; it cannot establish room airspeed.
No default facade Cp, discharge coefficient, stack forcing or leakage is inferred.

The solver:

1. Builds connected components using only positive-area links.
2. Fixes the external reference to 0 Pa. A disconnected component fixes its first
   listed zone to an arbitrary 0 Pa gauge with a warning. A sealed node has zero
   flow; no phantom outside link is inserted.
3. Balances unknown nodes by cyclic safeguarded scalar bracketing. The monotone
   nodal residual is bracketed by neighbour-pressure/forcing targets, so no
   singular square-root derivative at zero pressure is needed.
4. Checks the actual signed orifice flows and **every zone's residual**, including
   the reference zone in a disconnected component.

At most 4096 sweeps and 110 bisections per scalar root are attempted. Unchanged
pressures or 256 sweeps without residual improvement report `stalled`; exhaustion
reports `iteration-limit`. The flow tolerance is
`1e-9 + 1e-10*Qscale` m³/s, where Qscale is the largest absolute initial link
flow at zero gauge pressures. Returned diagnostics make this explicit:

```js
{
  converged, pressures: {outside: 0, room: 5},
  flows: [{id, from, to, m3s}],
  residualM3s, zoneResidualsM3s, toleranceM3s, iterations,
  status, references: [{id, pressurePa, connectedToOutside}], warnings
}
```

A nonconverged result is diagnostic only, not a balanced ventilation estimate.
Extreme coefficient ratios can make pressure loss too small to represent;
the solver reports that failure rather than inventing leakage.

For `K = cd*A`, series restrictions satisfy
`Kequivalent = (Σ(1/Ki²))^(-1/2)`. Two equal restrictions have K/√2, not 2K.
A disconnected forced circuit can circulate while conserving each zone; a
passive disconnected tree cannot. A single opening can reach zero steady net
flow without representing actual single-sided turbulent/two-way exchange.

Unsupported: two-way large openings, single-sided turbulence exchange, variable
upstream density, moisture transport, pressure-dependent fan models, wind-field
generation, wakes, occupant velocities and CFD. Explicitly supplying unsupported
link fields fails rather than implying that those processes were solved.

## `simulateThermal(input)`

```js
{
  zones: [{id: "room", capacityJ_K: 100000, initialC: 20, outsideConductanceW_K: 100}],
  links: [], // or {from, to, conductanceW_K} between known different zones
  steps: [{durationSeconds: 100, outdoorC: 30, gainsW: {room: 0}}]
}
```

Effective zone capacity must be supplied, not guessed from air volume, wall
conductivity, material names or density alone. Conductances are nonnegative W/K.
Gains are signed W, explicitly supplied for **every zone in every step**, including
zero; unknown gain keys fail. Outdoor temperature is required even for an
adiabatic interval. Temperatures below absolute zero are rejected.

Each zone is one lumped sensible-heat state:

```text
Ci * dTi/dt = Hi,out*(Tout - Ti) + ΣHij*(Tj - Ti) + Gi
```

Backward Euler uses interval-end temperatures in all exchange terms and constant
supplied gains/conductances/outdoor temperature over that interval:

```text
[diag(C/dt + Hout) + conductance-Laplacian] * ΔT
  = G + Hout*(Tout - Tprevious)
      + ΣHij*(Tprevious,j - Tprevious,i)
Tnew = Tprevious + ΔT
```

The symmetric positive-definite system uses Cholesky factorization. Unresolved
pivots (at or below `Number.EPSILON * zoneCount * diagonal`) fail explicitly.
Solving increments preserves an exactly uniform adiabatic/no-gain state and
avoids unnecessary cancellation of large absolute Celsius terms. Backward Euler
is stable for stiff passive RC networks, but has first-order timestep error.
It is not an exact continuous-time solver.

Samples start with the supplied initial condition at elapsed time zero, followed
by one sample per completed interval:

```js
{
  samples: [{elapsedSeconds, temperaturesC: {zoneId: Celsius}}],
  energyResidualJ,
  maxZoneEnergyResidualJ,
  energyBalances: [{
    elapsedSeconds, storedEnergyChangeJ, outdoorEnergyJ, gainsEnergyJ,
    interzoneTransfers: [{from, to, energyJ}],
    residualJ, zoneResidualsJ
  }],
  warnings: [...]
}
```

Each interzone transfer is computed once,
`Hij*(Ti,new-Tj,new)*dt`, and applied equal/opposite to the two nodes. The ledger
uses those same final temperatures:

```text
residual_i = Ci*(Ti,new-Ti,old)
             - dt*Hi,out*(Tout-Ti,new)
             - dt*Gi
             - netInterzoneHeatInto_i
```

`energyResidualJ` is the **signed sum of all nodal residuals over the run**.
`maxZoneEnergyResidualJ` prevents local errors being hidden by signed
cancellation. Per-step records let callers independently check stored, exterior,
gain and interzone energies. These are numerical diagnostics, not estimates of
modelling uncertainty. A nodal error greater than `1e-6 + 1e-10*scale` J, where
scale is the largest absolute stored/exterior/gain/interzone term for that node
and step, produces an explicit unresolved-energy warning. Such outputs are
diagnostic, not a balanced thermal solution; even a temperature increment lost
to floating-point resolution does not get a fabricated zero residual.

### Time, initial conditions and limits

The frozen duration-based interface is sufficient. As an optional additive
field, `steps[].timestamp` may specify each **interval start** in UTC ISO format
with seconds and `Z` (up to millisecond precision). Either every step supplies
one or none do. Starts must be contiguous according to the preceding duration;
gaps, overlap, invalid dates and sub-millisecond timestamped durations fail.
When supplied, initial and interval-end sample timestamps are returned too.
No timestamps are fabricated for duration-only scenarios.

There is **no automatic warmup**. The initial condition is explicit, including
for an empty schedule. To use a warmed state, the caller must run an appropriate
schedule, verify convergence and supply the resulting state. A coarse scenario
cannot be made accurate by relabelling initial temperatures as measured.

No wall/air multilayer states, automatic weather interpolation, solar gains,
SHGC, ventilation-to-thermal Cp coupling, latent heat, longwave surface balance,
HVAC control, occupancy inference or comfort/health prediction is added.
Caller-supplied negative gains remain explicit signed heat extraction, not an
HVAC simulation. Removing a partition does not automatically combine thermal or
pressure zones; that mapping remains a scenario decision.

## Verification and references

Run the focused, dependency-free tests:

```powershell
node --test --test-reporter=spec .\tests\building-physics.test.cjs
```

Fixtures check:

- R/U/Careal equations and missing-property/unit failures.
- 30°/45°/60° rectangular projections, all cardinal directions and all four
  headings, elevated blocks, explicit roof-slab top/underside elevations,
  sampled partial/overlap shade, wall reveals,
  window/door operation, tree transmission, removed masonry, ground areas,
  cutoff bounds, diffuse/beam separation and grid refinement.
- Zero forcing, sealed/closed paths, pressure reversal, equal/unequal/three-link
  series orifices, branched nodal balance, disconnected gauges/circulation,
  invalid links, unsupported physics and numerical stalling.
- Analytic single-zone RC decay with a continuous-time refinement bound,
  no-gain adiabatic invariance, Q·dt/C heating, equal/opposite interzone energy,
  actual per-step energy ledgers, stiff timesteps, invalid capacities,
  timestamp continuity and pure JSON/frozen-input behaviour.

For constant exterior/no-gain single-zone cooling or heating, the discrete
solution is `Tout + (T0-Tout)*(1+dt/tau)^(-n)`, with `tau=C/H`.
For `t=n*dt`, the continuous-solution error is bounded by
`abs(T0-Tout)*exp(-t/tau)*expm1((t/tau)*(dt/tau)/2)`, using
`log(1+r) >= r-r²/2`. Tests check the discrete formula, this bound and error
reduction on timestep halving—not an unjustified equality with continuous decay.

Primary equation/scope references:

1. [pvlib total plane-of-array irradiance](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.get_total_irradiance.html),
   [isotropic sky](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.isotropic.html),
   [ground diffuse](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.get_ground_diffuse.html):
   separate direct, sky-diffuse and ground-reflected components and tilt factors.
2. [EnergyPlus shading source](https://github.com/NatLabRockies/EnergyPlus/blob/5b898844e92b3718ab91b858c77eaf8782eb56b6/doc/engineering-reference/src/climate-sky-and-solar-shading-calculations/shading-module.tex):
   3D surface shading/sunlit-area formulation. This implementation uses its own
   simpler ray-sampled supported geometry, not EnergyPlus's shading algorithm.
3. [EnergyPlus 25.1 AirflowNetwork engineering reference](https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/airflownetwork-model.html)
   and [versioned source](https://github.com/NREL/EnergyPlus/blob/v25.1.0/doc/engineering-reference/src/alternative-modeling-processes/airflownetwork-model.tex):
   pressure-link flow equations, nodal mass balance and the distinction from CFD
   and large-opening models.
4. [EnergyPlus zone/air-system integration basis](https://github.com/NatLabRockies/EnergyPlus/blob/v26.1.0/doc/engineering-reference/src/integrated-solution-manager/basis-for-the-zone-and-air-system-integration.tex)
   and [warmup convergence](https://github.com/NatLabRockies/EnergyPlus/blob/v26.1.0/doc/engineering-reference/src/overview/warmup-convergence.tex):
   heat-balance dynamics and the need to distinguish initialization from a
   converged warmed state.
5. [EnergyPlus outside-surface heat balance](https://github.com/NatLabRockies/EnergyPlus/blob/5b898844e92b3718ab91b858c77eaf8782eb56b6/doc/engineering-reference/src/surface-heat-balance-manager-processes/outside-surface-heat-balance.tex):
   the richer surface processes deliberately omitted from this lumped model.

**No EnergyPlus, CONTAM, pvlib solver comparison, BESTEST/Standard 140 run,
CFD run, site measurement or calibration was executed for this implementation.**
References justify equations and delimit scope; they do not transfer those
projects' validation status to this code.
