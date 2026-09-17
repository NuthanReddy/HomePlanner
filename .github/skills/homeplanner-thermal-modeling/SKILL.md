---
name: homeplanner-thermal-modeling
description: "Use when implementing, debugging, reviewing, or explaining HomePlanner material assemblies, U/R values, heat capacity, glazing properties, sensible RC scenarios, thermal inputs or energy ledgers. Require explicit units, boundary data, initial conditions and timestep evidence; distinguish hypothetical model temperatures from actual indoor temperature, moisture, comfort or mold predictions."
---

# HomePlanner thermal modeling

## When to use

- Use for material comparisons, thermal-input workflows, lumped RC solver changes,
  temperature labels, weather alignment, conservation checks or expert handoff.
- Example task: "Compare two wall assemblies and show how the current bedroom
  temperature changes." Calculate supported assembly properties first; identify
  missing zone/boundary inputs before proposing a hypothetical RC experiment.

## Repository anchors

- `building-physics.js`: `BuildingPhysics.assemblyProperties`, `simulateThermal`,
  `surfaceExposure`, `solveAirflow`. The latter two are separate APIs, not automatic
  solar/airflow-to-thermal coupling.
- `environment-ui.js`: `EnvironmentUI.buildThermalTemplate`,
  `validateThermalInput`, `MATERIAL_PRESETS`, `mount`.
- `environment-data.js`: `EnvironmentData.parseEPW`, `parseWeatherJSON`,
  `fromOpenMeteo`, `UNITS`; normalized records retain source/time/unit evidence.
- `planner-bridge.js`: `HomePlanner.getProject`, `getScene`, `getScenes`, `execute`.
  `planner-model.js`: `HomePlannerModel.buildScene`, `inputFingerprint`.
  `planner-regions.js`: `HomePlannerRegions.area`, `reservationBounds`.
- Read [physics](../../../docs/building-physics.md),
  [environment](../../../docs/environment-analysis.md),
  [project geometry](../../../docs/project-model.md), and
  [limitations](../../../docs/validation-and-limitations.md).
  Re-read current APIs rather than assuming materials imply an indoor model.

## Required inputs

- Current active project/scene, exact zone-to-room mapping, geometry signature,
  physical-input sources and explicit experimental acknowledgement.
- Every assembly layer: `thicknessM`, `conductivityW_MK`, `densityKgM3`,
  `specificHeatJ_KgK`, plus material/source/condition. Films are inside/outside
  m²·K/W; if legacy default films are used, disclose that assumption and warning.
- Glazing: independently sourced whole-window U in W/(m²·K), SHGC and visible
  transmittance (VLT), not interchangeable material or optical values.
- Every RC zone: unique `id`, positive `capacityJ_K`, explicit `initialC`,
  nonnegative `outsideConductanceW_K`. Interzone links need exact endpoints and
  nonnegative `conductanceW_K`.
- Every step: positive `durationSeconds`, `outdoorC`, and signed `gainsW` for every
  zone, including explicit zero. Optional UTC `timestamp` values are interval
  starts, contiguous and present on all steps or none.
- Any real-building interpretation additionally requires defensible envelope
  areas/constructions, boundary/weather history, operation/internal gains,
  ventilation/HVAC and relevant radiation/moisture processes. Missing data or
  unimplemented coupling must be listed, not encoded as invented defaults.

## Workflow

1. **Establish scope.** Distinguish assembly descriptors from hypothetical sensible
   RC state temperatures and from an actual-site prediction. The current solver
   has one lumped sensible state per zone, not a detailed wall/air/HVAC model.
2. **Use the current active plan.** Read `getProject()`/`getScene()` whether the
   Room Planner is unchanged or edited. Use exact room identities, not an old
   template or sample. Keep buildable `floor`, net `plot` and physical `building`
   distinct; respect each API's coordinate/elevation frame.
   Supplied `usableRegions` and net areas exclude full reserved lift/stair
   footprints from host rooms; clear service carpet alone is not the reservation.
3. **Audit units and properties.** For homogeneous layers:
   `R = Rinside + sum(d/k) + Routside`, `U = 1/R`,
   `Careal = sum(rho*c*d)`. Units are m²·K/W, W/(m²·K), J/(m²·K).
   Convert sourced kJ/(kg·K) to J/(kg·K) explicitly. Conductivity is not U;
   areal capacity is not effective zone `capacityJ_K`.
4. **Preserve limitations.** Review moisture/temperature conditions and product
   applicability. Equal U does not imply equal dynamic lag or peak temperature.
   Layer order does not create additional states in this descriptor API.
   SHGC concerns solar heat gain; VLT concerns visible transmission.
   Incident W/m² is not absorbed heat or automatic zone gains.
5. **Prepare an honest draft.** `buildThermalTemplate` leaves missing capacity,
   conductance, temperatures and gains null. Validate against current scene;
   require sources/operation notes and acknowledgement before Evaluate.
   Changed geometry requires renewed review. Preserve unapplied form edits and
   existing manual layouts; unevaluated drafts remain explicitly unevaluated.
6. **Specify the experiment completely.** Record initial state and piecewise
   constant forcing for each interval. The equation is
   `C*dT/dt = Hout*(Tout-T) + sum(Hij*(Tj-T)) + gains`.
   Negative gains mean declared heat extraction, not a simulated thermostat/HVAC.
   Do not infer capacity from room volume, wall density or material name.
7. **Handle time deliberately.** Backward Euler is implicit and first-order;
   stable large timesteps can still be inaccurate. Compare refined timesteps with
   the same physical forcing. Initial values occur at elapsed zero; there is no
   automatic warmup. A warmed state needs a documented schedule/convergence check.
   Weather records use interval-end timestamps; thermal optional timestamps use
   interval starts. Do not shift them interchangeably, invent gap data, or apply
   IANA DST to EPW's fixed local-standard-time offset.
8. **Check the energy ledger.** Inspect `energyBalances`, stored/outdoor/gain
   energies in J and equal/opposite interzone transfers computed at interval-end
   temperatures. Check `energyResidualJ`, `maxZoneEnergyResidualJ` and per-zone
   residuals: signed global cancellation can hide local errors. Preserve
   conditioning/range failures and unresolved-energy warnings as diagnostic output.
9. **Keep ownership and provenance.** Save only through existing HomePlanner
   commands after explicit user action; keep scenario notes, sources, revision,
   geometry/input fingerprints, initial conditions and outputs together.
   Invalidate stale evidence after physical/input changes. Any worker or future
   asynchronous integration must reject stale generations before publication.

## Do not do

- Do not turn a material choice, U-value, compass score or shaded fraction into
  actual indoor °C, guaranteed savings, HVAC sizing or comfort compliance.
- Do not claim humidity, condensation, mold or health outcomes from the current
  sensible-only solver. A parsed RH value is not implemented moisture transport,
  latent heat, surface moisture storage or a biological growth model.
- Do not silently add solar/SHGC gains, air heat capacity, infiltration cooling,
  occupant schedules, HVAC control, longwave balance, thermal bridges or warmup.
  Mark unsupported coupled physics and unmet data explicitly.
- Do not merge zones when a partition disappears without reviewed scenario intent,
  hide local energy errors, or confuse conservation with calibrated accuracy.
- Preserve one shared project, manual edits and offline workflows. No automatic
  network/geolocation, remote solver, new default measurements or live mutations.

## Validation

Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-thermal-modeling\scripts\example.py --check
```

Run applicable tests from the repository root:

```powershell
node --test tests\building-physics.test.cjs tests\environment-data.test.cjs
node --test tests\environment-ui-state.test.cjs tests\planner-reservations.test.cjs
```

Verify layer R/U/capacity identities, explicit film/unit/missing-property handling,
adiabatic invariance, `Q*dt/C` heating, single-zone RC closed form versus continuous
decay under refinement, two-zone equal/opposite exchange and the actual per-step
ledger. Check timestamp continuity, lost tiny increments and conditioning failures.
Use isolated fixtures for current/edited room mappings, incomplete drafts and
input-state preservation. Existing UI-state tests are not whole-building validation.

## Output contract

Return supported assembly/RC results separately, with units, input sources,
initial conditions, schedule, snapshot fingerprints and ledger/refinement evidence.
List missing inputs and unsupported physics before any design recommendation.
Label temperatures hypothetical and uncalibrated; report tests and professional
building-physics review needs, never implied EnergyPlus/BESTEST certification.

## References

Use the verified [primary sources and method caveats](references/sources.md).

- [Assembly, RC and supplied psychrometric equations](references/calculations.md).
- [Optional Python APIs and engine prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
