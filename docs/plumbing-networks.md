# Plumbing networks — Phase 6 foundation

This deliverable is **authored service intent**, not plumbing engineering.
It adds no UI, renderer, persistence store, hydraulic solver or construction
detail. The editable source remains `floors[].authored` in schema-1 project JSON.
Shared projection remains the only anchor resolver.

## Load and call

Load `planner-features.js`, `planner-model.js`, `planner-projection.js`, then
`planner-services.js` as classic scripts. The last module also independently
supports `require('./planner-services.js')` and has no DOM/network dependencies.
Its only export is the frozen object `{build}`:

```js
const result = HomePlannerServices.build(drawingScene);
const plumbing = HomePlannerServices.build(drawingScene, {
  systems: ['water', 'waste']
});
```

Input must be a version-1 `DrawingScene` produced by
`HomePlannerProjection.build(project)` (or the bridge's `getDrawingScene()`).
It is not a substitute document parser/validator for arbitrary objects.
Validate/import projects with the real model first. Options accept only
`systems`, a unique array drawn from `water`, `waste`, `rain`; omit it to retain
all three, or pass `[]` for no networks. Explicit undefined is rejected.
Selection affects nodes/routes and connectivity, not the fixture list.
No circuit is inferred from a system or from connected neighbors.

## Exact output

`build` returns a detached, deeply frozen plain-JSON object:

```js
{
  version: 1, projectId, revision, inputFingerprint,
  nodes: [{
    id, floorId, system, kind,
    role: null /* or supplied role */, label: null /* or supplied text */,
    circuit: null /* or supplied circuit */,
    anchor: null /* or {x,y,z} */,
    diameterMm: null /* or supplied number */,
    invertM: null /* or supplied number */, issues: [/* code strings */]
  }],
  routes: [{
    id, floorId, system, label: null /* or text */, circuit: null /* or circuit */,
    from: {floorId, entityId}, to: {floorId, entityId},
    via: [/* {x,y,z} or null */],
    points: [/* from point, ...via points, to point; each may be null */],
    diameterMm: null /* or supplied number */,
    slope: null /* or supplied nonnegative fall/run ratio */,
    lengthM: null /* or geometric metres */, isRiser: false /* or true */,
    issues: [/* code strings */]
  }],
  fixtures: [{
    id, floorId, kind, anchor: null /* or {x,y,z} */,
    widthM: null /* or supplied number */,
    depthM: null /* or supplied number */,
    heightM: null /* or supplied number */, issues: [/* code strings */]
  }],
  findings: [{
    code, severity: 'warning' /* or 'info' for network-cycle */,
    floorId: null /* or finding owner floor */,
    entityIds: [/* owner id first, then related ids, or global related ids */],
    message
  }],
  engineeringStatus: 'not-assessed'
}
```

Arrays preserve authored traversal order. Issue arrays deduplicate codes per
entity; findings can repeat a code for distinct anchors/segments. Global findings
have null floorId; a related structural/wall ID may belong to another floor.
References use exact `(floorId, entityId)` pair identity, not prefix matching.
Optional absence becomes null only in this disposable output, never saved data.
Required inputs, endpoint references and physical unknowns are retained.

Project identity, revision and inputFingerprint are copied from the drawing.
They establish provenance, not freshness by themselves. Compare **projectId and
inputFingerprint**, together with the selected systems option, against current
inputs before reusing results. The fingerprint is the model's collision-free
canonical JSON key, not a hash or a per-system key. Selection is not appended to
that key; callers must retain their own options. Same-revision replacement can
change the fingerprint. Undo/redo may restore an earlier fingerprint with a new
revision. A previously built result never updates itself.

## Saved fields and compatibility

Every existing required version-1 field remains required. Old records validate
and JSON-round-trip byte-equivalently with no backfill. The additions are:

| Scope | Optional field | Accepted values |
| --- | --- | --- |
| Nodes and routes | `label` | null or existing nonempty text, at most 16384 characters, no control characters |
| Nodes and routes | `circuit` | water: null/cold/hot; waste: null/soil/waste/vent; rain: null/storm |
| Nodes | `role` | null, or compatible purpose in the table below |

| Required node `kind` | Allowed non-null `role` |
| --- | --- |
| fixture | port, fixture, trap |
| junction | junction, stack, valve, trap, cleanout |
| supply | supply |
| outlet | outlet |

Enum typos, wrong-system circuits, wrong-base roles, explicit undefined and
unknown keys are validation errors. Null/absent additions remain unknown.
Roles describe fitting purpose only: a stack role does not create a vertical
pipe, and a valve/trap does not contain engineered internals. Water traps,
water cleanouts, vent traps/cleanouts, non-water valves, non-water supplies and
water outlets are `unusual-service-purpose` warnings. They remain repairable
authored intent; this is not a regulatory rule.

An explicit fixture port normally uses kind fixture, role port and an entity
anchor `{kind:'entity', entityKind:'fixture', floorId, entityId}`. The anchor is
the fixture's supplied resolved reference location; no offset, socket, nozzle or
fabricated connection point is generated. Fixture dimensions can remain null.
`equipment` stays unclassified: pumps, tanks and roof vent terminal designs are
unsupported, not guessed from a label. Vent circuits are supported as intent,
but the outlet kind does not establish a roof vent design.

All additions already travel through bridge upsert/set-authored, duplication,
JSON export/import and undo/redo. Duplication remaps only references explicitly
targeting the copied floor; external-floor references and label text are retained.

## Geometry and length rules

- Coordinates are metres in the projection's common site frame: x right,
  y rear, z project-relative. Floor elevations and explicit overrides are already
  applied by projection. Owner floor is record ownership, not a second elevation.
- Use the shared projected `anchors` in their existing endpoint/via order,
  respecting each anchor status and aggregate `anchorStatus`. Wrong-system or
  missing endpoint nodes become null, even if projection supplied a point.
- Route `lengthM` is the sum of 3D Euclidean distances through **all** consecutive
  points. It is null if any point or aggregate resolution is unknown. Never
  connect across null gaps or display a partial sum as a complete length.
  Unknown diameter/circuit does not erase measurable geometry; findings still
  prevent interpreting it as an engineered route.
- Lengths exclude fitting allowances, bends, sockets, joint details and purchase
  waste. They are neither plan-only distances nor measured pipe quantities.
- From → to is explicit proposed direction. No flow magnitude, demand, head,
  pressure, pressure loss, supply hot-water sizing, drainage capacity or slope
  compliance is computed. Supplied slope is preserved but never enforced on z.
- `isRiser` is true for any cross-floor endpoint pair, **or** any known segment
  with nonzero vertical extent and coincident plan positions within tolerance.
  It labels riser intent, not exclusively straight vertical geometry. A diagonal
  cross-floor proposal can therefore be true. False does not prove no future
  riser is needed when points are unknown.
- Cross-floor segments connect supplied points directly, not a designed shaft,
  landing, access provision or intermediate-floor penetration. Equal endpoint
  z on different floors is an explicit level-conflict warning.
- Invert is an independent supplied bottom-level input. Never replace anchor z
  with invert or assume anchor z = invert + diameter/2. An invert higher than
  its anchor/axis by tolerance produces `invert-anchor-conflict`; other offsets
  are not a validated centerline/invert relationship.
- Geometry tolerance is 1e-7 m. Coincident/sub-tolerance segments are flagged,
  not removed. Accumulation precision loss or nonfinite total leaves length
  unresolved. Existing geometry assumptions remain assumptions, not surveyed
  coordinates. Numerical precision is not physical accuracy.
- Unknown diameter permits a line/marker representation only. Even known
  diameters have no wall thickness, clearance or fitting geometry supplied here.

## Connectivity and findings

Graph traversal is iterative over weak (undirected) authored components;
direction is retained separately by from/to. Edges require existing same-system
nodes and no directly contradictory known circuits among the route and both
ends. Unknown circuits never become cold/soil defaults. A path through unknown
nodes that indirectly joins conflicting known circuits produces
`mixed-circuit-component`. No rewiring or automatic system conversion occurs.

An unresolved geometry edge can still represent authored topology, but carries
its anchor/incomplete-route findings. A topology connection is not a physically
verified connection. Each individual water component must explicitly contain a
supply-kind node to avoid `missing-supply`; waste/rain components need an
outlet-kind node to avoid `missing-outlet`. These presence checks do not assert
directed reachability, external capacity or valid terminal design. No component
can borrow another component's endpoint. Unknown nodes receive no invented root.
Cycles (including parallel connections/self-loops) are informational: a water
loop may be intended; it is not blanket-invalid or hydraulically solved.

Local finding codes:

- Input/location: `unknown-circuit`, `unknown-diameter`, `unknown-invert`,
  `unknown-level`, `unknown-fixture-size`, `unknown-slope`,
  `invert-anchor-conflict`, `unresolved-anchor`; original shared projection
  anchor codes/causes such as `missing-floor`, `missing-host`, `removed-host`,
  `host-bounds`, `host-void`, `unresolved-host`, `cyclic-host`, `host-depth-limit`,
  `missing-geometry`, `unresolved-site-frame`, `unknown-anchor` are forwarded.
- References/topology: `dangling-node`, `unresolved-endpoint-floor`,
  `service-system-mismatch`, `circuit-mismatch`, `unknown-endpoint-circuit`,
  `mixed-circuit-component`, `missing-supply`, `missing-outlet`,
  `disconnected-node`, `disconnected-fixture-port`, `network-cycle`.
- Purpose/hosts: `missing-fixture-host`, `unhosted-fixture-port`,
  `fixture-without-service-port`, `unusual-service-purpose`,
  `supply-direction-conflict`, `outlet-direction-conflict`.
- Geometry: `incomplete-route`, `zero-length-segment`,
  `geometry-precision-limit`, `inter-floor-proposal`,
  `inter-floor-level-conflict`, `coordination-geometry-unknown`,
  `possible-penetration-conflict`.
- Scope: `engineering-not-assessed`, `unsupported-equipment`,
  `coordination-incomplete`, `rain-coordination-deferred`.

The first three scope codes are always present globally. Rain entries carry the
rain-deferred finding. No findings or status should be presented as a successful
engineering/coordination assessment. Fixture-without-port means none within
**selected systems**, not that an unselected system has no authored connection.

## Partial axis coordination

The foundation intersects known route segments with projected wall solid
sections (respecting their existing apertures), bottom-centered structural
column/slab/footing boxes, and horizontal bottom-center beam intent using
width/depth. It checks all represented floors, including intermediate solids.
Wall/member crossings and touches are possible penetration conflicts, not
automatically designed holes. Grids have no volume.

Unknown structural heights/sizes, unresolved anchors and unsupported beam
geometry produce explicit unknown-coordination findings. No service-specific
penetration schema exists yet; architectural apertures are not a service
penetration approval. Axis-only checks do not include pipe radius, thermal
movement, insulation, access clearances, wall strength, unrepresented slabs,
terrain, soil, shafts or other pipe clashes. Absence of a hit is never a pass.
Scene wall defaults and conceptual structural sizes are not upgraded to verified
construction. Exhaustive multidisciplinary coordination is Phase 7 work.

## Workload bounds

Build rejects excessive work with a descriptive RangeError rather than silently
truncating results. Limits apply before selected-system filtering:

- 70000 total authored entries and 1000 projected scenes.
- 10000 each of service nodes, routes and fixtures.
- 100000 route segments (sum of `via.length + 1`).
- 20000 walls, 30000 wall sections / coordination solids.
- 1000000 attempted axis/solid comparisons.

Node/reference lookup uses pair-keyed maps; component traversal is nonrecursive
O(nodes + routes), not repeated route-to-node scans. Shared projection owns its
separate bounded host cache. Coordination has an explicit candidate budget and
can reject dense inputs below the entity limits; partition deliberately rather
than omitting findings. Deep-freezing is iterative. There are no persistent
caches that can accidentally reuse a replacement project's stale positions.

## Verification and delivery boundary

`node --test tests\planner-services.test.cjs tests\planner-foundation.test.cjs tests\planner-phase1-regressions.test.cjs`
covers actual projection/model/bridge integration, preserved version-1 data,
circuits and roles, independent floors, fixture anchors, cross-floor lengths,
null gaps, wrong systems, dangling/cyclic hosts, components/loops, coordination,
limits, browser-global parity, immutable provenance, replacement staleness,
duplication, undo/redo and JSON preservation.

Phase 6 UI authors water/waste intent in separate work. Foundation completion
does not pass the Phase 6 user-facing gate. Rain coordination, drainage fall
profiles and level-resolution engineering remain deferred to Phase 7 after
the parent coordinator's integration and review.
