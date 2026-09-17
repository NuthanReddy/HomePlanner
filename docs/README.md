# HomePlanner documentation

This folder documents the assumptions and behavior of
`../index.html`, a browser tool for comparing
setbacks, floor limits, plot efficiency, indicative costs, and schematic room
layouts in the GHMC/HMDA context.

## Document map

- [Current implementation review and gap plan](building-performance-gap-review.md):
  verified delivery/integration gaps, Three.js-first architecture, optional
  Blender/Python-engine boundaries and dependency-ordered acceptance gates.
- [Building-performance roadmap](building-performance-roadmap.md):
  the existing design-generation goal and longer-term analysis requirements,
  with current-review amendments distinguished from the historical baseline.
- [Workspace navigation](workspace-navigation.md): six task destinations,
  grouped Sun Path/property tools, shared project controls and deep-link contracts.
- [Drawing foundation](drawing-foundation.md): authored records, coordinate frames
  and immutable drawing projections.
- [Report drawings](drawing-report.md): architectural/structural previews and
  PDF/SVG/PNG controls; [export formats](drawing-export-formats.md) covers physical
  scale, local PDF loading and font limits.
- [Architectural sheets](architectural-drawings.md): plan geometry, technical
  symbols, annotation placement and layer behavior.
- [Structure workbench](structure-workbench.md): editing structural intent,
  [coordination semantics](conceptual-structure.md),
  [structural sheets](structural-sheets.md) and [3D layer](structural-3d.md).
- [Saved view workbench](view-workbench.md): geographic elevation and finite
  section authoring, [physical renderer](elevations-sections.md) and
  [facade projections](facade-projections.md) shared by drawing/3D/shadow paths.
- [Plumbing workbench](plumbing-workbench.md): fixture/port/route authoring,
  [network semantics](plumbing-networks.md), [plans and risers](plumbing-sheets.md)
  and the independent [3D plumbing layer](plumbing-3d.md).
- [Drainage workbench](drainage-workbench.md): sanitary/storm intent and explicit
  levels/discharge, [geometric coordination](drainage-coordination.md),
  [plan/profile sheets](drainage-sheets.md) and [3D inspection](drainage-3d.md).
- [Regulatory basis](regulatory-basis.md): rules, road-width effects, TDR,
  compounding, balconies, and permission routes.
- [Plot geometry](plot-geometry.md): footprint equations, percentage loss,
  optimal aspect ratio, corner plots, and plot splitting.
- [Room planner](room-planner.md): geometry pipeline, packing model, editable
  state, walls, corridors, and services.
- [Shared project model](project-model.md): physical walls/openings, identities,
  floor namespaces, geometry assumptions and JSON validation.
- [Editor workspace](editor-workspace.md): selection, dimensions, door/bed
  controls, independent floors and history.
- [Local persistence](local-persistence.md): IndexedDB, autosave, project
  management, JSON backups and recovery.
- [3D inspection](three-dimensional.md): stacked storeys, local Three.js,
  real aperture geometry, selection and serving requirements.
- [Circulation and components](circulation-and-components.md): access graph,
  doors, windows, furniture, and open-plan connections.
- [Design guidance](design-guidance.md): daylight, ventilation, IGBC/LEED
  comparisons, Vastu separation, checklist fixes, and rollback.
- [Cost model](cost-model.md): included cost layers, equations, and confidence.
- [Sun path](sun-path.md): local SunCalc integration, timezone handling,
  daily/annual plots, CSV export, and analysis boundaries.
- [Sun path research and gap plan](research/sunpath.md): supplied Simulations4All
  reference, live-tool observations, scientific caveats, and phased missing-feature
  plan (not implemented capabilities).
- [Building-performance research references](research/building-performance.md):
  nine additional Simulations4All references covering HVAC, daylight, ventilation,
  humidity, exhaust and energy assessment, with dedicated article and live-tool
  research notes.
- [Building analysis toolchain](research/building-analysis-toolchain.md):
  supplied OpenStudio, EnergyPlus and Ladybug Tools setup guide, learning path,
  sun/ventilation/lighting coverage, and moisture/mold limitations.
- [Environment workspace](environment-analysis.md): weather, shadows, materials,
  wind proposals, explicit numerical experiments and expert exports.
- [Airflow workbench](airflow-workbench.md): explicit room/opening scenarios,
  [numerical meanings](airflow-visualizer.md), [cancellable local workers](airflow-worker.md)
  and [opening-linked arrows with table alternatives](airflow-display.md).
- [Building physics](building-physics.md): supported equations, units, assumptions
  and numerical limits.
- [Room light workbench](light-workbench.md): explicit sunlight and sky-access
  scenarios, [numerical meanings](light-visualizer.md),
  [worker execution](light-worker.md), [plan evidence](light-display.md) and
  [optional 3D inspection](light-3d.md). Not lux or lighting adequacy.
- [Coordinated document package](coordinated-package.md) and
  [package workbench](package-workbench.md): ordered sheets, unavailable sections,
  current analysis evidence, saved intentions and revision manifests.
- [Electrical planning](electrical-planning.md): physical point anchors,
  nullable measurements and ergonomic review.
- [Validation and limitations](validation-and-limitations.md): tested behavior,
  known constraints, and professional-review boundaries.

## Critical boundary

The calculator is a feasibility and comparison tool. It is not a building
permission, sanctioned drawing, structural design, fire-safety assessment,
accessibility review, rating-system certification, or legal opinion. Confirm
the current rules, site restrictions, and application route through TG-bPASS,
GHMC/HMDA, and qualified professionals before buying land or building.
