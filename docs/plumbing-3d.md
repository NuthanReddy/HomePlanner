# Optional plumbing intent in 3D

**Plumbing engineering is not assessed.** This is authored water/waste intent,
not a designed or verified network. Plumbing intent is an unchecked, independent
checkbox in Open 3D. Structural intent need not be enabled. Neither graphics
modules nor a GPU context are loaded before Open 3D; modules are the existing
vendored Three.js, not an external engineering engine.

The dimension/identifier schedule is in a keyboard-accessible disclosure **below**
the canvas, closed initially. It retains every displayed record and scrolls within
a bounded region when expanded. Counts, scope and engineering caveats remain
visible above the canvas; opening the schedule does not move the canvas.

## Registration and integration

With either intent checkbox enabled, the viewer obtains one
`HomePlanner.getDrawingScene()` snapshot, validates exactly all registered floors
in one common site frame, and uses that snapshot's **exact `scenes` for all
architectural base geometry and overlays**. This includes unequal plates,
setbacks, site plot origins and headings. Active-floor filtering happens after
registration validation. No per-floor recentering or fallback to unregistered
geometry is allowed.

Plumbing uses `HomePlannerServices.build(drawingScene, {systems: ['water', 'waste']})`.
Rain is outside this layer. Coordination may examine authored structural records,
but this does not display them: only the separate Structural intent checkbox
enables structural meshes. Turning both checkboxes off restores the unchanged
legacy `getScenes()` preview.

`buildContent(THREE, drawingScene.scenes, project, model, {
plumbingIntent: true, services: HomePlannerServices.build(drawingScene,
{systems: ['water', 'waste']}) })` accepts services alongside existing structural
settings. `mount(..., {servicesModel})` allows injecting the same build API for
tests; browser integration uses the already-loaded `HomePlannerServices` global.
Missing modules, invalid registration or service-build failures close and dispose
the preview with an explicit 2D fallback. A visible **Turn off plumbing intent**
recovery button permits reopening without the failed optional layer.

## Representation contract

* **Every route is a centerline**, including routes with supplied diameters.
  `THREE.LineSegments` draws only consecutive pairs of finite ordered
  `route.points`. A null/unknown point breaks both adjacent segments; known points
  on opposite sides never connect. Supplied project-relative z is used unchanged,
  never restacked, inferred from floor elevation, or replaced by invert level.
* Linewidth is a nonphysical screen-space presentation width, not a pipe diameter.
  The dimension schedule records every included route/node's exact `diameterMm`
  or “unknown”; no rounding, outer/nominal interpretation, cylinder, hollow wall,
  fitting or elbow is invented. This deliberately chooses the same honest
  centerline convention for known and unknown diameters.
* Proposed circuits use cold blue, hot red, soil brown, waste amber, vent purple
  and unknown gray. These are not velocity, hydraulics, verified flow direction
  or adequacy colors. Unknown circuit/role stays unknown.
* Located nodes are constant-screen-size `THREE.Points`, not physical devices.
  No default valve, trap, port, fitting size or level is inferred.
* Fixtures with a known anchor and explicit positive width, depth **and** height
  get a translucent site-axis-aligned extent box. The anchor is its bottom center;
  heading rotates the box with the site. There are no toilet/basin internals or
  inferred connection ports. Missing dimensions/anchors produce **no 3D volume
  or guessed position**, only a missing-geometry count; inspect/edit in 2D.
  The schedule shows exact supplied fixture dimensions in metres or “unknown”.
* Plumbing objects are unshadowed and excluded from architectural picking and
  selection. Nodes/lines cannot block an architectural click. Cutaway affects
  presentation roof caps only, not plumbing.

## Active-floor scope and findings

Active floor only includes routes owned by the active floor **or with either
endpoint referencing it**. Their entire known ordered spans remain visible,
including foreign floors, without clipping or inventing intermediate landings.
All endpoint nodes of included routes are retained, plus nodes owned by the
active floor. Fixtures are active-floor only; foreign fixture volumes are not
implied by showing foreign endpoint points. Unrelated routes and nodes are omitted,
not absent. This is not a geometric slice: a route merely crossing the floor in
space without an owner/endpoint reference does not qualify.

The status explicitly reports foreign-spanning route and foreign endpoint counts.
Findings remain the **full service result across all floors**, not a subset pass.
Connectivity/axis coordination is partial: sizing, pressure, demand, hydraulics,
fall, capacity, clearance, floor penetrations, code compliance and engineering
adequacy are not assessed. Gaps and unresolved extents remain unknown.

## Results and lifecycle

When enabled, `buildContent` returns `plumbing` with numeric `total`, `shown`,
`routes`, `nodes`, `fixtures`, `segments`, `gaps`, `points`, `solids`, `missing`,
`foreignRoutes`, `foreignNodes`, plus `objects`, `schedule` and original `findings`.
`gaps` counts adjacent pairs with at least one unknown point. `missing` counts
included routes with no drawable pair, unlocated nodes, and fixtures without
complete extents/anchors; partial routes can have both drawn segments and gaps.
`solids` means explicit fixture boxes only. `total` excludes rain nodes/routes.
All service fixture records are included unless active-floor filtering excludes
them; displaying a fixture never implies service connectivity.

Live project edits and intent/active-floor toggles rebuild the shared snapshot
without moving the camera. Replaced and closed content disposes geometries and
materials; close also releases renderer/context, controls and subscriptions.

Validation: `node --test tests\planner-services-3d.test.cjs
tests\planner-structure-3d.test.cjs tests\planner-3d.test.cjs`.
Tests use real vendored Three.js geometry, all eight compass headings plus an
oblique heading, unequal floor registrations, gaps, exact dimensions, default-off
legacy parity, independent/both layers, failure recovery and repeated disposal.
