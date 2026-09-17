# 2D potential-flow velocity estimate

`planner-airflow-field.js` adds an optional **uncalibrated, depth-averaged
potential-flow estimate** to a converged selected-room pressure network. It is
not validated CFD, a wind measurement, an occupant-height prediction, or a
comfort/compliance assessment. The map's spectral colors and black vectors
come from computed cells, not a decorative gradient or the reference image.

## Request and data

Enable it explicitly in a scenario:

```js
scenario.planField = { enabled: true, spacingM: 0.5 };
```

New workbench scenarios expose this enabled control and the model assumptions
before **Run scenario**; older imported scenarios without the property retain
network-only behavior. Spacing is numerical, not a physical dimension.

`HomePlannerAirflow.run()` adds `result.planField` when requested. The field
includes its `inputFingerprint`, method, units, status, room model depths,
boundary-port mappings, convergence/conservation diagnostics, assumptions and
cell records. Each cell has an exact site-local rectangle, center,
`velocityMps:{x,y}`, `speedMps` and `conservationResidualM3s`.
Vector components follow the existing site-local plan axes, not guessed compass
directions or an additional floor rotation.
`complete`, `partial` and `unavailable` remain distinct. A failed field does
not erase a usable pressure-network result or fabricate zero-velocity cells.

Browser dependency order is `planner-regions.js`, `building-physics.js`,
`planner-airflow-field.js`, `planner-airflow.js`. The dedicated worker imports
these fixed local files itself. CommonJS resolves the same helpers locally.
No package, remote solver, weather request or main-thread fallback is added.

## Numerical model

For each selected room:

1. Use its supplied disjoint `geometry.usableRegions` in the shared site frame.
   A legacy full rectangle is used only when no reservation regions are supplied.
   Actual reserved lift/stair footprints therefore leave holes in the host air
   domain; the physical project is never altered.
2. Set a **uniform model depth** to the explicitly declared clear volume divided
   by the actual usable area. This ratio is a dimensional model reduction, not
   an inferred or measured ceiling/clear height. Review the volume after area edits.
3. Build a bounded rectilinear finite-volume mesh aligned with usable-region
   boundaries and aperture endpoints. No cell crosses a reserved region.
   A supplied physical wall occupying claimed usable air area causes a refusal,
   not flow through the wall or an invented replacement partition.
4. Project each actual solved opening volume flow onto its matching room
   boundary. Normal projection is bounded by supplied wall thickness plus the
   supplied module/carpet allowance; every offset is recorded. Flux is spread
   over the aperture's covered plan width, not relocated to a room center.
5. Solve a discrete potential equation with prescribed boundary fluxes. Across
   an internal face, outward flow is
   `Qij = depth × faceLength / centerDistance × (phi_i - phi_j)`.
   The sum of face flows balances the prescribed source/sink volume flow in
   each cell. `phi` is a potential in m²/s, **not the network pressure in Pa**.
   A Jacobi-preconditioned conjugate-gradient solve uses one potential gauge per
   connected region. Center velocities average the opposing face velocities;
   speed is `hypot(vx,vy)`.

There is no pressure-to-color interpolation pretending to resolve room speed.
Separate room fields share the network's exact signed opening flows. All other
boundaries carry no modeled flux **within this selected-network approximation**;
this is not evidence that omitted openings are physically sealed.

## Limits and unavailable cases

- At most **4,096 cells**, **256 coordinate lines per axis**, **1,000,000**
  region/wall tests and **4,096 CG iterations per connected component**.
- The conservation tolerance is relative to supplied nonzero boundary flow
  (`1e-8`); nonzero tiny flows are not thresholded into a decorative zero field.
  A zero-forcing component has the exact zero solution.
- Disconnected regions with unbalanced local inlet/outlet forcing, nonzero
  manual connections without verified aperture boundaries, unsupported wall
  geometry, ambiguous aperture mapping, numerical conditioning failures and
  exceeded budgets produce explicit findings. Nothing is silently coarsened,
  moved, clamped, connected through a wall or truncated.
- Existing pressure-solver and finite-JSON guardrails remain authoritative.
  Unbalanced/nonconverged networks do not acquire trusted velocity fields.

The estimate omits viscosity/no-slip boundary layers, turbulence, buoyancy,
vertical mixing, jet entrainment, furniture drag and single-sided exchange.
It cannot represent arbitrary free-standing interior partitions until those
walls are reflected in compatible air regions. The projection does not infer
shafts, slab penetrations or stack pressure from lift/stair labels.

## Presentation and verification

The main 2D plan shows physical walls/openings, numerical cells clipped to usable
areas, black direction vectors and a vertical **Velocity [m s⁻¹]** legend.
Blue → cyan → green → yellow → red uses the result's actual maximum, not the
reference's example 0–4 range. A known-zero field has a blue zero scale; an
unavailable field has no colored cells. Arrow thinning affects display density
only: complete cell values remain in paginated tables, JSON and CSV.

Tests cover the analytical `Q / (depth × width)` channel solution, reversal,
small nonzero forcing, conservation, reserved holes, disconnected domains,
wall/mapping errors, budgets, real projected opening allowances and worker
protocol provenance. Isolated-browser tests also verify the visible map,
clear/rerun, stale-data removal, mobile layout and actual reserved-service
clipping. These tests do not establish CFD validation against measured airflow.
