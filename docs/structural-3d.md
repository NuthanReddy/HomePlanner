# Structural intent in 3D (Phase 4)

**Structural engineering is not assessed.** This optional view provides geometry
coordination, not safety, capacity, compliance, construction readiness, or shadow
analysis. A qualified engineer must determine structural adequacy.

Open 3D, then enable **Structural intent** in its toolbar. The checkbox defaults
to **off**; ordinary 3D still uses the legacy storey scenes and schematic preview
dimensions without requesting projection or structural coordination. No library
or GPU context loads until Open 3D. Close releases view/GPU resources; settings
are local presentation state, not project edits.

When enabled, the view calls `HomePlanner.getDrawingScene()` and
`HomePlannerStructure.build(drawing)`. It requires exactly every project floor
registered in the same site frame, even with **Active floor only** enabled.
Missing geometry, missing/incompatible plots, unavailable modules, or failed
coordination explicitly close 3D and leave 2D available; it never overlays a
partial site model onto centered legacy floors.
While closed, **Turn off structural intent** remains available to recover the
ordinary 3D preview without first repairing site registration.

Both architectural geometry and structural intent use `drawing.scenes`.
`toThree` centers site-local coordinates using the common plot width/depth and
rotates by the site heading; legacy floor-local callers retain their original
floor-width/depth centering. Unequal floor sizes, offsets, setbacks and elevations
therefore agree with the pure projection and structural drawing/PDF conventions.
The displayed ground surround also uses that common plot.

## What appears

- Box geometry uses the supplied x/y minima, bottom z, width, depth and height.
  Columns, slabs and footings are rectangular authored intent only.
- Beam endpoints are bottom centers: length comes from endpoints, width is
  perpendicular in plan, and depth extends vertically upward. No preview sizing,
  overhang or inferred connections are added.
- Grids are nonphysical, unshadowed line primitives, not narrow solid beams.
- Null geometry produces **no volume or guessed location**. The summary counts
  these as missing-geometry markers, explicitly count-only. Unknown heights and
  unresolved hosts remain unknown.
- Amber means assumed, blue authored, purple engineer-provided, gray unspecified.
  These are provenance claims, **none verified**, including engineer-provided
  dimensions and references.

The visible summary reports displayed/total records, solids, grids, missing
geometry and the aggregate number of coordination findings across all floors
(including the unconditional engineering caveat). Full findings and edits are in
**Design → Structure (2D)**, not the architectural selection inspector.
Structural objects are excluded from picking, so they do not block existing
architectural selection or send unsupported structural references to the bridge.
They neither cast nor receive shadows; architectural lighting remains illustrative.

Active floor only filters structural intent by owner floor alongside base
geometry. Cutaway toggles only presentation roof/ceiling caps, never authored
slabs. Structural rebuilds retain the camera and dispose replaced resources.
WebGL2 failures and closing during asynchronous module loading retain the
existing safe 2D fallback.

## Renderer integration and verification

`buildContent(THREE, scenes, project, model, options)` accepts optional
`structuralIntent: true` and `structure: HomePlannerStructure.build(drawing)`.
Pass the matching `drawing.scenes`, never legacy scenes. Opt-in returns an
additional `structural` object containing `total`, `shown`, `solids`, `grids`,
`missing`, `objects` and the complete model `findings`. With the flag absent or
false, no structural geometry or additional return field is produced.
`mount` resolves the browser's `HomePlannerStructure`; its optional
`structureModel` injection supports the same `build` API for testing.

Run `node --test tests\planner-3d.test.cjs tests\planner-structure-3d.test.cjs`.
The suite uses vendored real Three geometry and the real model/projection/bridge,
plus a minimal DOM/event harness with renderer stubs for lifecycle checks.
It covers rotated beam endpoints, box dimensions, unequal-floor registration,
null geometry, grid/shadow/picking behavior, default-off compatibility,
rebuild/disposal/camera retention, registration failures and asynchronous closure.
