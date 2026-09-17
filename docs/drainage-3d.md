# Optional drainage intent in 3D

The **Drainage intent** checkbox is off by default and independent of
**Plumbing intent** and **Structural intent**. Opening 3D without drainage
does not require its module. Merely mounting or toggling a closed preview does
not load Three.js or create a WebGL context. The existing local modules load
only when **Open 3D** is requested.

## Integration

Load the shared model/features/projection/bridge stack and `planner-services.js`,
then `planner-drainage.js`, before `planner-3d.js`. The optional dependency is
`HomePlannerDrainage.build(drawingScene, {systems: ['waste', 'rain']})`.
Tests/embedders may supply `mount(host, bridge, model, {drainageModel})`.
There is no new persistence or authoring API.

The checkbox is `[data-hp3d="drainage"]`. Missing dependencies, incompatible
registration and thrown coordination errors close any stale overlay, dispose
GPU resources, and show an explicit error. `[data-hp3d="drainage-off"]`
disables only drainage so reopening works without that module. Dependency
repair followed by Open 3D also recovers. Closing, context loss, failed rebuild,
destroy and cancelled pending load retain the original disposal/generation
guards. Closing clears displayed drainage schedule/findings.

Direct rendering accepts:

```js
HomePlanner3D.buildContent(THREE, drawing.scenes, project, model, {
  drainageIntent: true,
  drainage: HomePlannerDrainage.build(drawing),
  plumbingIntent: false,
  structuralIntent: false,
  activeOnly: false,
  cutaway: true
});
```

`content.drainage` exposes total/shown counts, routes/nodes, known `segments`,
unknown `gaps`, screen-space `points`, missing-geometry count, foreign-route/node
counts, exact `schedule`, foundation `findings`, and `objects`. No drainage
fixture or shaft/chamber/fitting solids are generated. Shared plumbing waste
objects appear in both domain `objects` arrays but are attached to the Three
group once. Deduplication is by `[floorId, kind, id]`, not label or raw UUID.
Dispose the content group once rather than separately disposing each domain.
Each domain retains its own counts and findings; enabling both produces a
single visible water/waste/rain union, not duplicate waste lines or points.

## Geometry and limitations

- The complete foundation builds before presentation filtering. Coordination
  can still identify other-floor or unselected-water relationships.
- All floors must share valid site-local plot registration and heading.
  Coordinates use the common actual plot frame, not legacy per-floor recentering.
  Elevations are the projected axis z, applied once. Inverts never modify axes.
- Routes render consecutive known XYZ pairs as `LineSegments`. Null spans
  break the line; later known spans remain drawable without bridging holes.
  Missing nodes/segments are counted, not placed at guessed origin/zero height.
- Nodes are screen-space points. Linewidth and point size are nonphysical.
  Nominal diameter is scheduled exactly and never creates a pipe mesh.
  Storm is teal; sanitary circuits retain plumbing's soil/waste/vent colors.
  Colors are not hydraulic results. No flow or direction solver is invoked.
- Active-floor mode retains owned or endpoint-touching routes in full,
  including foreign spans and endpoint nodes. Unrelated foreign networks are
  omitted, not established absent. Cutaway hides architectural caps, not intent.
- No terrain, chamber, shaft, safe access zone, pipe outside diameter, invert/
  centerline conversion, fall correction or discharge destination is inferred.
  Access radius and clearance remain exact supplied metadata, not physical or
  regulatory working envelopes. Existing architectural presentation slabs and
  context surfaces remain schematic, not supplied ground-level planes.
- Intent is not selectable, does not block architectural picking, and casts/
  receives no shadows. Toggling layers rebuilds and disposes geometry while
  retaining the camera. No project, drainage or service field is written.

## Collapsed, bounded details below the canvas

`[data-hp3d="drainage-details"]` is a closed-by-default details region outside
and below the viewport. `[data-hp3d="drainage-schedule"]` lists exact JSON-valued
metadata per floor/entity: nominal diameter, supplied invert/ground/finished
floor, claimed provenance and reference, discharge object, access radius,
via inverts, slope/provenance, clearance and gravity status. Derived
invert-below-ground and finished-floor-above-ground differences use the
foundation result without relabelling them cover depth. Numbers are not rounded
and nulls remain explicit; user text is inserted with `textContent`.

`[data-hp3d="intent-findings"]` separately collapses common model warnings and
enabled structural/plumbing/drainage findings, retaining source-domain labels,
codes and qualified entity references. Each details list is keyboard-focusable
and scrolls within a maximum 18rem height. The brief pre-canvas drainage status
contains counts and an explicit **engineering not assessed** warning, not a
long UUID schedule. Empty records or findings never imply a complete design.

This is conceptual intent and geometric review. Supplied surveyed/engineer
provenance, numerical agreement, destination labels and an empty issue list do
not verify capacity, cover, safe access, external connection, permissions,
hydraulics or compliance. See [drainage-coordination.md](drainage-coordination.md).

## Validation

```text
node --test tests\planner-drainage-3d.test.cjs tests\planner-services-3d.test.cjs tests\planner-structure-3d.test.cjs tests\planner-3d.test.cjs tests\planner-drawing-ui.test.cjs
```

Tests use real model/bridge/projection and Three geometry, uneven registered
floors and headings, true elevation and null gaps, rain-only selection, exact
metadata, immutable source snapshots, multi-layer deduplication, collapsed
schedule placement, lazy initialization, live rebuilds, camera retention,
dependency recovery, context loss and disposal.
