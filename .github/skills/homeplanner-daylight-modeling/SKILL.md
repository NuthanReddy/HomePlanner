---
name: homeplanner-daylight-modeling
description: "Use when implementing, debugging, reviewing, or explaining HomePlanner room light studies, daylight-access maps, workplane sensors, numeric overlays, opening optics, or light-worker results. Preserve the current geometric sky/path-access scope, sampling plane, unknown states and snapshot provenance; never relabel fractions or radiation as lux or annual daylight metrics."
---

# HomePlanner daylight modeling

## When to use

- Use for workplane configuration, light-access calculations, readable top-down
  numeric overlays, optical transmission, worker lifecycle or 3D light evidence.
- Example task: "Make the study map show the current bedroom's light values around
  its stair reservation." Reuse computed clipped sensor cells and their real units;
  do not paint a reference image's lux values onto the bedroom.

## Repository anchors

- `planner-bridge.js`: `HomePlanner.getProject`, `getDrawingScene`.
  `planner-projection.js`: `HomePlannerProjection.build`, `siteToWorld`.
- `planner-light.js`: `HomePlannerLight.CONFIG_SCHEMA`, `normalizeConfig`,
  `discover`, `createStudy`, `run`, `compare`.
- `building-physics.js`: `BuildingPhysics.createReceiverKernel`; its accumulator
  consumers share physical intersections, not an additional light/solar engine.
- `planner-light-runner.js`: `HomePlannerLightRunner.createRunner`;
  `planner-light-worker.js`: bounded local worker batches.
- `planner-light-display.js`: `HomePlannerLightDisplay.createView`,
  `createInventoryView`, `exportSVG`.
- `planner-light-ui.js`: `HomePlannerLightUI.createController`, `mount`,
  `prepareIntervals`; `planner-light-ui.css`: presentation only.
  `sun-model.js`: `HomeSun.resolveLocal`, `position`, `localCandidates`.
- Read [foundation](../../../docs/light-visualizer.md),
  [workbench](../../../docs/light-workbench.md), [display](../../../docs/light-display.md),
  [worker](../../../docs/light-worker.md), [3D](../../../docs/light-3d.md),
  [physics](../../../docs/building-physics.md), and
  [project geometry](../../../docs/project-model.md).

## Required inputs

- Immutable current DrawingScene and exact floor/room references; actual walls,
  aperture offsets/sills/heights, operation, slabs, facade casters and obstacles.
- Each workplane's explicit height in metres above its floor and numerical
  `spacingM`; sky enablement and quadrature controls. Never infer a ceiling/workplane
  height from a room label, furniture glyph or sampling default.
- Explicit `ideal-clear` or sourced `visible-transmission` optics; VLT is neither
  SHGC nor the solar irradiance module's transmission parameter.
- Four neighbor states and, for modeled sides, explicit referenced site-local
  boxes with dimensions, base/height and transmittance. Unknown is not clear.
  Roof absence needs an explicit sourced declaration, not missing slab data.
- Study period and chronological positive UTC intervals with exact midpoints;
  supplied unit ENU directions or degree angles. UI preparation additionally
  requires coordinates, IANA zone and repeated-time choices.
- Absolute illuminance would additionally need a photometric sky/source model,
  appropriate optical/reflection inputs and separate validation. These are not
  supplied by the current geometric metric; report that unsupported request.

## Workflow

1. **Inspect the current implementation.** Re-read exported APIs and result fields;
   do not assume that a UI labeled "Light" calculates lux. The implemented sky
   metric is `A = (1/pi) integral(T*cos(theta)*dOmega)` over the upper hemisphere,
   with theta measured from the workplane normal: normalized access, dimensionless.
2. **Use the actual active project.** Capture `getDrawingScene()` whether the Room
   Planner is unchanged or edited. It contains registered floors already projected
   into site-local coordinates. Distinguish buildable `floor`, net `plot` and
   physical `building`; do not substitute sample geometry or stale floor records.
3. **Sample the real plane.** Use `floorElevationM + heightM` once and the shared
   site/world transform once. Intersect grid cells with supplied `usableRegions`;
   full lift/stair reservation footprints are excluded from host-room net area.
   Keep each positive fragment's exact cell, midpoint, ID and `areaWeightM2`.
   Unsupported polygons or missing physical height extent remain diagnosed.
4. **Preserve optical meaning.** Use canonical openings and finite wall reveals;
   door operating fractions are spatially averaged transmission, not swing angles.
   Honor slab/neighbor unknowns. Reuse exact physical obstacle identities once;
   conflicting/ambiguous duplicate boxes need review, not double attenuation.
5. **Keep metric families separate.** Direct path weights are fractions;
   positive-path-presence and transmitted-equivalent sun totals are hours.
   A one-hour path with transmission 0.4 contributes 1 presence hour and 0.4
   equivalent hour. Neither quantity is energy, daylight factor or illuminance.
6. **Respect time and completeness.** Resolve local times with HomeSun, then
   sample exact UTC midpoints. Only committed masks supply interval values.
   Night can be known-zero direct access; sky access is time-independent.
   Near-horizon unresolved, unprocessed intervals, gaps and disabled sky are not
   zero. Preserve primary versus explicitly selected supplied-model-only values;
   partial subtotals never become full-period totals.
7. **Draw a truthful top-down numeric map.** Reuse display views, exact sensor
   cells and selected units. Keep walls/openings readable above the field,
   reservation holes uncolored, unknown cells hatched, and known zero distinct.
   Use a vertical numeric legend with the actual value range, readable labels and
   exact values in accessible titles/tables. No smooth invented room gradients,
   cell-to-cell paths, wall-crossing interpolation or lux copied from a reference.
8. **Run and publish safely.** Use the local dedicated runner; its optional guard
   is `discover().physicalFingerprint`, not the neighbor-augmented study key.
   Recheck current project, physical/config/sensor evidence and request generation
   on publication. Cancel stale work; Clear revokes numeric overlays/exports while
   preserving drafts and manual edits. Display-only floor/metric changes do not rerun.

## Do not do

- Do not derive lux (lm/m²) from geometric fractions or broadband W/m² with an
  arbitrary multiplier. Radiance's photometric conventions require its defined
  source model and cannot be grafted onto these fractions.
- Do not report daylight factor, UDI, sDA, ASE, glare, electric-light coverage or
  adequacy without their implemented physical definitions, schedules and validation.
- Do not treat finished computation as verified context or numerical convergence;
  do not fill unknown cells with modeled values without explicit labeling.
- Do not infer ceilings, connecting slabs, emitted light or coordinates from
  electrical symbols. A schematic light point has no implemented photometry.
- Preserve one shared project and offline local assets. No automatic network,
  geolocation, live-project mutations, remote solver or main-thread ray fallback.
  Any authorized physical edit belongs to existing HomePlanner commands.

## Validation

Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-daylight-modeling\scripts\example.py --check
```

Run applicable groups from the repository root:

```powershell
node --test tests\planner-light.test.cjs tests\planner-light-projection.test.cjs tests\planner-light-display.test.cjs
node --test tests\planner-light-runner.test.cjs tests\planner-light-ui.test.cjs tests\planner-light-3d.test.cjs
node --test tests\planner-reservations.test.cjs
```

Verify full sky = 1, full block = 0, half hemisphere = 0.5, and the independent
finite-reveal rectangular-aperture integral. Refine directional quadrature and
sensor spacing separately; shadow-edge aliasing need not converge monotonically.
Check unchanged/edited snapshots, reserved fragments, heading/elevation parity,
night/unknown/gapped masks, stale/cancelled workers and readable desktop/mobile
views in isolated fixtures. Screenshots and quadrature tests are not lux validation.

## Output contract

Identify the current snapshot/plane, sources and unmet inputs; name each metric
and unit precisely. Report primary/model-only status, coverage, refinement evidence,
fingerprints, tests and rendering checks. Explain unsupported requested metrics
and the professional daylighting review needed for stronger engineering claims.

## References

Use the verified [primary sources and method caveats](references/sources.md).

- [Geometric access equations and worked calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
