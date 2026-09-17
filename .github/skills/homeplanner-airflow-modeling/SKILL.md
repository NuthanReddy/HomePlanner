---
name: homeplanner-airflow-modeling
description: "Use when implementing, debugging, reviewing, or explaining HomePlanner airflow, pressure networks, ventilation scenarios, computed velocity heatmaps, or flow arrows. Trace the current Room Planner snapshot, operating openings, explicit boundary inputs, conservation diagnostics, and stale-worker guards; distinguish reduced-model estimates from validated CFD."
---

# HomePlanner airflow modeling

## When to use

- Use for airflow workbench inputs, pressure solves, optional plan fields,
  ventilation labels, numerical overlays, comparisons, or worker integration.
- Example task: "Show computed airflow around the lift reservation in the current
  living room." Inspect that room's actual usable regions and opening operation;
  expose missing forcing/volume inputs rather than substituting demonstration flow.

## Repository anchors

- `planner-bridge.js`: `HomePlanner.getProject`, `getDrawingScene`, `execute`.
  `planner-projection.js`: `HomePlannerProjection.build`, `siteToWorld`.
- `planner-airflow.js`: `HomePlannerAirflow.normalizeScenario`, `discover`, `run`,
  `compare`; `building-physics.js`: `BuildingPhysics.solveAirflow`.
- `planner-airflow-field.js`: `HomePlannerAirflowField.run`, `LIMITS`.
  Re-read its current input, cell, boundary-port, and diagnostics contract before
  editing; the evolving field API, not a reference image, owns computed values.
- `planner-airflow-runner.js`: `HomePlannerAirflowRunner.createRunner`;
  `planner-airflow-worker.js`: local worker transport.
- `planner-airflow-display.js`: `HomePlannerAirflowDisplay.createView`,
  `createInventoryView`; `planner-airflow-ui.js`: `HomePlannerAirflowUI.createController`,
  `mount`; `planner-airflow-ui.css`: presentation only.
- `environment-data.js`: `EnvironmentData.windRose`; `environment-ui.js`:
  `EnvironmentUI.buildAirflowTemplate`, `validatePressureInput`.
- Read [foundation](../../../docs/airflow-visualizer.md),
  [field](../../../docs/airflow-field.md), [display](../../../docs/airflow-display.md),
  [worker](../../../docs/airflow-worker.md), and [workbench](../../../docs/airflow-workbench.md).
  Also read [physics](../../../docs/building-physics.md),
  [environment](../../../docs/environment-analysis.md), and
  [project geometry](../../../docs/project-model.md).

## Required inputs

- Current project/revision and immutable DrawingScene; exact selected
  `{floorId, entityId}` references, actual walls/apertures, adjacency and operation.
- Explicit clear zone volumes in m³, constant density in kg/m³, enabled states,
  aerodynamic operating free areas in m², dimensionless `cd`, and signed imposed
  `pressurePa` for each active link. Preserve missing values and source notes.
- For wind-derived forcing proposals: speed, FROM bearing, measurement/reference
  height, exposure/height adjustment, facade pressure-coefficient source and
  applicability. A wind rose does not supply these or a pressure boundary.
- Declare requested receiver height and its datum if occupant-level results are
  requested. The current optional field is depth-averaged, not a height-resolved
  receiver plane; aperture midpoint/anchor z is not occupant sampling height.
- Explicit numerical field enablement and spacing; manual connections need
  actual supplied endpoint anchors, not inferred lift/stair connections.

## Workflow

1. **Capture current truth.** Use the active Room Planner project whether unchanged
   or manually edited; obtain `getDrawingScene()` once for the run. Never load a
   sample layout or read an inactive floor copy as the active plan.
2. **Keep geometry distinct.** `floor` is the buildable plate; `plot` is the net
   site boundary; `building` is the physical footprint. DrawingScene is already
   site-local: do not subtract plot origins, add elevations, or rotate twice.
   Consume supplied `usableRegions`/net area, excluding full reserved lift/stair
   footprints, not just their clear carpets. Do not rebuild a bounding-box domain.
3. **Discover and review.** Resolve current wall/opening hosts and exact endpoints.
   Unknown adjacency is not outside. Known compiled `openFraction` cannot be
   overridden by a scenario; a door swing or transparent window is not open air.
   Check `freeAreaM2 <= widthM * heightM * openFraction`; supplied operating free
   area is not multiplied by the fraction again. Keep inactive unknowns visible.
4. **Separate workflows.** The native selected-room workbench and Environment's
   older expert pressure draft are independent contracts. Legacy template volumes
   based on wall height are reviewable estimates, not verified clear volumes.
   Physical opening changes require explicit user action through existing
   `update-door`/`update-window` commands; never silently open or resize an aperture.
5. **Solve only declared forcing.** The network uses
   `Q = cd*A*sign(deltaP)*sqrt(2*abs(deltaP)/rho)`, with
   `deltaP = pFrom-pTo+pressurePa`. Positive Q runs from → to.
   Check every zone residual, reference/gauge, tolerance, iteration count and
   convergence status. Nonconverged/numerical-error output is diagnostic only.
6. **Respect field physics.** If requested, feed the balanced network to the
   current field API. Its uniform model depth is explicit volume / usable area,
   not measured ceiling height. Preserve actual aperture-flux mapping, disconnected
   components, no-flux boundaries, mesh budgets and conservation residuals.
   Potential in m²/s is not pressure in Pa. Unavailable rooms remain unavailable.
7. **Render quantities, not decoration.** Field colors and vectors come from
   computed `speedMps`/`velocityMps` cells, clipped to usable air regions; use the
   actual numerical legend range and readable walls/openings. Network opening
   arrows show solved sign only. `abs(Q)/A` is aperture-mean speed, not room speed.
   If field evidence is absent, do not paint a room-velocity heatmap.
8. **Publish current evidence only.** Use the dedicated runner; guard project,
   physical/scenario/input fingerprints and request generation again at completion.
   Revision equality alone is insufficient. Cancel/revoke on changes, Clear,
   supersession or disposal; retain drafts/manual edits and independent history.

## Do not do

- Do not infer Cp, stack pressure, leakage, density, Cd, usable volume, shafts or
  weather from compass orientation, a label, or a screenshot.
- Do not label a schematic arrow m/s. Supported velocity estimates still need
  their depth-averaged/aperture-mean qualifier, never "validated 3D CFD".
- Do not invent ACH: only a converged `directOutsideInflowACH` with explicit
  volume represents `3600*directOutsideInflowM3s/volumeM3`; it is not transfer-air
  freshness, mixing effectiveness, contaminant removal or ventilation compliance.
- Do not smooth through walls, convert failed solves to zero, hide residuals,
  truncate/coarsen silently, or promise single-sided/two-way exchange.
- No automatic network/geolocation, live-project mutations or remote solver.
  Preserve offline local assets and explicit Run; no main-thread solver fallback.

## Validation

Run the smallest applicable groups from the repository root; no install is needed:

```powershell
node --test tests\planner-airflow.test.cjs tests\planner-airflow-field.test.cjs tests\building-physics.test.cjs
node --test tests\planner-airflow-runner.test.cjs tests\planner-airflow-display.test.cjs tests\planner-airflow-ui.test.cjs
node --test tests\environment-data.test.cjs tests\planner-reservations.test.cjs
```

Check equal/series orifices, reversal, sealed/dead-end/disconnected cases and all
nodal residuals; for the field verify the analytical `Q/(depth*width)` channel,
mesh refinement, boundary conservation, reserved holes and unmappable ports.
Use isolated UI fixtures for unchanged/edited plans, cancellation, stale results,
unknown/zero/error displays, readable desktop/mobile legends and local workers.
Equation tests, VM workers and screenshots do not establish empirical CFD validity.

## Output contract

Report the active snapshot and references, input sources/unknowns, model and height
meaning, units, numerical status, residuals/tolerances, fingerprints, tests and
visible behavior. Separate network and field availability. State remaining
uncertainty and professional ventilation/engineering review needs before advice.

## References

Use the verified [primary sources and method caveats](references/sources.md).
