# Airflow sources and evidence boundaries

These are original summaries of primary technical material. Checked dates record
document review, not certification of HomePlanner or its current numerical code.

## 1. NIST — CONTAM

- URL: https://www.nist.gov/services-resources/software/contam
- Checked: 17 Sep 2026.
- Establishes: multizone airflow analysis concerns flow rates and relative zone
  pressures; ventilation distribution and contaminant transport are separate
  engineering questions requiring the appropriate model.
- Limits: NIST's descriptions and validation belong to CONTAM. Using related
  pressure-network ideas does not transfer its contaminant, smoke, exposure or
  ventilation-performance capabilities to another implementation.
- Application: label the selected-room network narrowly. Do not equate direct
  outdoor inflow with complete fresh-air delivery or predict occupant exposure.

## 2. EnergyPlus 25.1 — AirflowNetwork Model

- URL: https://bigladdersoftware.com/epx/docs/25-1/engineering-reference/airflownetwork-model.html
- Publisher/content: EnergyPlus Engineering Reference; public HTML mirror
  published by Big Ladder Software.
- Checked: 17 Sep 2026.
- Establishes: nodes represent pressure, links represent pressure-dependent flow,
  and nodal mass conservation controls convergence. Wind/stack forcing and opening
  elevations/densities are boundary/model inputs. Detailed large-opening models
  distinguish multiple flow directions across one opening.
- Limits: its iterative algorithm, mass-flow units and supported components differ
  from HomePlanner's constant-density, one-way volumetric-orifice contract.
  Its sensible/latent coupling is not implemented merely by using a flow network.
- Application: verify signs and dimensions; with one constant density,
  mass residual is density times volumetric residual. Record solver tolerances and
  failed convergence rather than assuming a plausible-looking arrow is balanced.

## 3. NASA/NPARC Alliance — Examining Spatial (Grid) Convergence

- URL: https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html
- Checked: 17 Sep 2026.
- Establishes: refinement studies compare the same physical problem on multiple
  numerical grids; observed error/order can differ from formal algorithm order.
  Extrapolation needs evidence that the solutions are in an appropriate
  asymptotic range, not just a finer-looking image.
- Limits: CFD verification guidance does not turn an inviscid depth-averaged
  potential field into a viscous/turbulent 3D solution. Small residuals only assess
  solution of the chosen discretized equations.
- Application: retain the analytical uniform-channel check, boundary-flux and
  per-cell conservation checks, and spacing sensitivity. Do not claim a universal
  error bound or measurement validation from one mesh.

## Repository-specific interpretation

The current `HomePlannerAirflowField.run` contract supplies an optional
finite-volume potential-flow estimate driven by the solved opening fluxes.
Its depth is declared clear volume divided by usable area. It does not resolve
receiver height, viscosity/no-slip layers, turbulence, buoyancy, vertical mixing,
jet entrainment, furniture drag, or single-sided exchange.

Use `docs\airflow-field.md`, `docs\airflow-visualizer.md`,
`docs\building-physics.md` and their named tests as local implementation evidence.
Re-read current source before changing the actively evolving visual/field APIs.
Independent physical measurements or a separately verified expert solver would
be required for stronger real-building claims; none is implied by these sources.
