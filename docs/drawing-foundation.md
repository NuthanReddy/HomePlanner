# Drawing foundation (feature version 1)

## Compatibility decision

Schema 1 remains the document envelope. New records are optional and carry their
own `version: 1`; no migration or defaults are written into old documents.
Recognized feature objects reject unknown fields and versions. Physical inputs
which have not been supplied are explicitly `null`, never inferred engineering
measurements. Existing legacy geometry assumptions remain labeled by its scene
diagnostics; this foundation does not upgrade them into verified measurements.

The project remains the only editable source. `floors[].authored` is stored only
on its owner floor (not in the legacy active-floor aliases). `documentation`
belongs to the project. Projections and snapshots are disposable, deeply frozen
copies; they are not saved back into the document.

## Physical coordinates

All geometry is in metres. The legacy scene `floor` is the buildable plate,
not the plot boundary. Legacy scene coordinates remain unchanged.
The new site projection uses the plot's upper-left corner as its common
horizontal origin, x right and y rear in the plot frame. It translates every
geometric representation, including room modules, wall endpoints and hosted
opening segments. Floor, plot and building remain separate rectangles.

ENU coordinates rotate this shared site frame by front bearing clockwise from
true north: east = x cos(h) - y sin(h), north = -x sin(h) - y cos(h).
All floors must describe the same plot extent and heading; mismatches or absent
plots are unresolved, not silently aligned. Numeric transform helpers support
numeric headings; project authoring still accepts only N/E/S/W.

`siteDatum: {version: 1, elevationM: number|null}` optionally supplies the
absolute elevation of vertical zero (no geodetic datum is implied).
Scene `floorElevationM` and wall `baseM` are relative to this vertical zero.
Floors stack from `building.floorElevationM` by preceding `heightM` values;
the existing explicit `legacy.context.floorElevationM` override is preserved.
Opening sill and wall-anchor height are relative to the host wall base.
Obstacle base is already relative to project zero, not to its owner floor.
Absolute elevation is null until the site datum is supplied.

Existing 3D and analysis consumers are not switched to this convention in Phase
1; their centered coordinate APIs remain unchanged. The new helper is the shared
contract for future consumers, with numerical parity/translation tests rather
than a claim that existing consumers have been migrated.

## Exact authored schema

All fields in the table below are required **when the enclosing optional feature exists**.
Structural records additionally support the four optional fields described below;
their absence remains meaningful and does not trigger saved-data backfilling.
Service records also support additive optional fields described below.
Empty collections are `[]`. Unknown listed physical quantities are `null`.
Additional fields are rejected throughout these features (existing schema-1
legacy/electrical/environment fields retain their original compatibility rules).
Numbers must be finite with magnitude at most 1e9. IDs/text are nonempty strings
without control characters, at most 16384 characters; reserved prototype names
are forbidden IDs. Collections contain at most 10000 records.

`floors[].authored` contains `version: 1` and these seven arrays:

| Array | Record fields beyond `id` |
| --- | --- |
| `annotations` | `text`, `anchor` |
| `dimensions` | `start`, `end` (anchors), `offsetM` (signed drawing offset) |
| `fixtures` | `kind`: basin/sink/toilet/shower/equipment; `anchor`; `widthM`, `depthM`, `heightM`: positive or null |
| `stairs` | `start`, `end` (anchors); `widthM`: positive or null; `riserCount`: positive integer or null |
| `structural` | `kind`: grid/column/beam/slab/footing; `anchors`: exactly two for beam/grid, one otherwise; `widthM`, `depthM`: positive or null; `material`: text or null (grid requires all three null) |
| `serviceNodes` | `system`: water/waste/rain; `kind`: fixture/junction/outlet/supply; `anchor`; `diameterMm`: positive or null; `invertM`: signed project-relative elevation or null |
| `serviceRoutes` | `system`: water/waste/rain; `from`, `to`: node references; `via`: anchor array; `diameterMm`: positive or null; `slope`: nonnegative fall/run ratio or null |

Optional service fields (still feature version 1):

- Both nodes and routes: `label`: text or null (same 16384-character bound);
  `circuit`: null or a system-consistent value. Water accepts `cold`/`hot`,
  waste accepts `soil`/`waste`/`vent`, rain accepts `storm`.
- Nodes only: `role`: null or a fitting purpose compatible with the required
  semantic base `kind`: fixture accepts `port`/`fixture`/`trap`/`floor-trap`/
  `gully-trap`/`roof-outlet`; junction accepts `junction`/`stack`/`valve`/`trap`/
  `cleanout`/`chamber`/`downpipe`; supply accepts `supply`; outlet accepts
  `outlet`/`outfall`. Other role/kind combinations are rejected.
- Phase 7 node fields: `groundM`, `finishedFloorM` are signed project-relative
  numbers or null; `accessRadiusM` is nonnegative or null. `levelSource` is null,
  `assumed`, `surveyed` or `engineer-provided`; `levelReference` is text or null.
  Sources/references are unverified author claims, not validation of elevations.
  `discharge` is optional **only on outlet-kind nodes**, and is null or exactly
  `{kind, reference}`. Kind is `sewer`, `surface-outfall`, `soakaway`, `septic`,
  `reuse` or `other`; reference is text or null. Absence never implies sewer.
- Phase 7 route fields: `viaInvertsM` is an optional array of finite signed
  numbers/nulls, exactly the same length and order as `via`. Explicit null in
  place of the whole array, holes and undefined elements are rejected. Absence
  means all via inverts are unknown **in derived output only**. `slopeSource`
  accepts the same nullable source enum as levels; `slopeReference` is text or
  null. `clearanceM` is nonnegative or null. These fields are accepted on service
  records without converting water, sanitary, vent and storm circuits.
- Absent or null label/circuit/role stays unresolved. Validation never writes
  defaults or backfills old records. Explicit `undefined`, unknown enum values,
  incompatible circuit/system values and unknown keys are rejected. All original
  fields remain required.
- Role does not describe fitting internals or alter a node's base kind. Unusual
  purpose/system combinations (for example a water trap or waste valve) produce
  service projection warnings rather than rejecting old semantic intent.
- Route direction is explicitly **from → to**, an authored proposal, not solved
  hydraulic flow. Invert remains an independent project-relative physical input;
  it never substitutes for or moves the resolved anchor.

`HomePlannerServices.build(drawingScene, {systems?})` provides the Phase 6
read-only connectivity, ordered 3D route lengths, riser proposals and partial
axis coordination foundation. It invents no fixture ports, diameters, levels or
engineering results. See [Plumbing networks](plumbing-networks.md) for its exact
output, limits and unresolved-input contract. Its standalone rain-deferred
message still applies to core-only consumers.

`HomePlannerDrainage.build(drawingScene, {systems?})` adds the Phase 7 **foundation
only**: selected waste/rain profiles from independently entered inverts and
horizontal route stations, actual plot bounds, explicit discharge/unknown-level
findings, and bounded full-service coordination candidates. Vent routes remain
network intent but are not gravity drains. Known endpoint falls do not complete
unknown intermediate profiles. Neither nominal diameter nor invert/ground
difference establishes cover thickness. See
[Drainage coordination](drainage-coordination.md) for the exact frozen contract,
geometry rules and limitations. UI, plan/profile sheets, 3D and the Phase 7 gate
remain separate deliverables; no loader or renderer is added by this foundation.

Optional structural fields (still feature version 1):

- `heightM`: positive number or null. Beam/grid require it absent or null.
- `label`: text or null, following the existing text limits.
- `sizeSource`: `unspecified`, `assumed`, `authored`, or `engineer-provided`.
- `reference`: text or null. This is an author-supplied provenance claim, not
  verification of an engineer, document, dimensions or structural adequacy.

Absent height/label/reference mean unknown; absent sizeSource means unspecified.
Explicitly present `undefined` is invalid, as are all remaining unknown fields.
The original required structural fields are unchanged. Old records remain exact
on validation, projection, duplication and JSON round-trip.

The Phase 4 read-only `HomePlannerStructure.build(drawingScene)` foundation
interprets beam anchors as **bottom-center endpoints**, width as horizontal
cross-axis width and depth as vertical thickness. Beams and grids must have
distinct horizontal, planar endpoints; unsupported slopes/degeneracy are
diagnosed rather than reinterpreted. Grids are reference segments without volume.
Column/slab/footing anchors are bottom centers, width/depth are site-axis
footprints, and explicit height is their vertical extent. Without height they
remain incomplete markers, never default-storey-height meshes. Slabs/footings are
rectangular-solid intent, not arbitrary footprints or reinforcement models.
See [Conceptual structure](conceptual-structure.md) for the output contract,
coordination findings, numerical tolerance and explicit workload limits.

Authored IDs must start with `<ownerFloorId>:authored:` followed by a nonempty
suffix, and be unique across all seven arrays on that floor. A node reference is
exactly `{floorId, entityId}`; it must resolve to a service node of the route's
system to have resolved route anchors. Cross-floor references are allowed.

An anchor is either `null` (unknown), or exactly one of:

```js
{kind: 'point', floorId, point: {x, y, z}}
{kind: 'wall', floorId, entityId, offsetM, heightM}
{kind: 'entity', floorId, entityKind, entityId}
```

Point x/y use that floor's **legacy plate-local** frame; z is height relative to
that floor's elevation. Wall offset is measured from the wall's current `start`
endpoint and height from its `baseM`; both are nonnegative and must remain in the
current wall bounds when resolving. `entityKind` is room/opening/furniture/
obstacle/fixture/stair/structural/serviceNode. Geometry entity IDs are the actual
scene IDs, not source IDs or labels. Entity anchors resolve to:

- Room/furniture rectangle centre at floor elevation (not a guessed furniture
  height); obstacle volume centre using its project-relative base.
- Opening aperture centre at wall base + sill + half opening height.
- Fixture/service-node authored anchor; stair midpoint; mean of structural intent
  anchors. This is a reference position, not generated discipline geometry.

Anchor values are never rewritten during resolution. Missing floors/entities,
removed walls, aperture voids, out-of-bounds wall offsets/heights, cyclic/deep host dependencies,
unknown positions and missing geometry remain repairable authored records.
They do not snap to another host. A resolved position does **not** imply that
dimensions, structural members or service systems have been engineered.
Null member sizes, fixture sizes, pipe diameters, inverts and slopes remain null.
Structural records are conceptual intent, not slab polygons or load-bearing designs;
the optional structural projection produces only explicitly sized simple geometry.
stairs do not generate treads; routes do not generate solved pipe geometry.

Host resolution caches each authored host at each of the 64 permitted dependency
depths per build. Shared/branching dependencies therefore evaluate at most 64
times per host, rather than expanding once per path. Failed-path summaries retain
cycle diagnostics without caller-dependent cache entries. Depth 64 remains
unresolved even if the same host has already resolved through a shallower path;
cycles reached before that boundary remain `cyclic-host` causes.

`project.documentation` is:

```js
{
  version: 1,
  views: [{id, name, kind, floorId, scaleDenominator, direction, cut}],
  sheets: [{id, number, title, paper, orientation, viewIds}]
}
```

View kind is plan/section/elevation. `scaleDenominator` is positive or null,
`direction` N/E/S/W or null. `cut` contains exactly two anchors for a section,
otherwise none. These are authored view intentions, not rendered cuts or
elevations. Paper is A4/A3/A2/A1/A0, orientation portrait/landscape.
View and sheet IDs share one unique namespace. Sheet view IDs are unique within
a sheet; dangling IDs remain present and are diagnosed, as are deleted view
floors/cut hosts. No PDF/SVG/PNG output or page placement is implemented here.

Coordinated packages add an optional `documentation.package` intention:
`{version:1,title,paper,orientation,scaleDenominator,units,pngDpi}`. This uses
A4/A3/A2, fixed 1:50/1:75/1:100, metric/imperial labels and 72/150 dpi. Existing
documents without it are unchanged; the shared `set-documentation` command
preserves views/sheets and participates in undo, redo and project JSON storage.
Generated pages and numerical results are not stored in this intention. See
[coordinated package contracts](coordinated-package.md).

## Editing and lifecycle APIs

`HomePlannerModel.emptyAuthored()` returns a fresh feature envelope.
`validateProject` and `parseProject` strictly validate features without mutation.
Use the existing bridge's `execute` for all editing:

```js
planner.execute({type: 'set-authored', value: authoredEnvelope}); // active floor
planner.execute({type: 'upsert-authored', collection: 'annotations', value: record});
planner.execute({type: 'delete-authored', collection: 'annotations', id});
planner.execute({type: 'set-documentation', value: documentationEnvelope});
planner.execute({type: 'set-site-datum', value: {version: 1, elevationM: null}});
```

The three `set-*` commands also accept `value: null` to remove their optional
feature. Upsert replaces one entire typed record, not a partial arbitrary patch.
Commands are synchronous and atomic, reject unsupported versions/non-JSON
values, increment revision once and participate in undo/redo. Deleted records
are removed from their own collection only; references in surviving records
remain unchanged for repair.

`add-floor` with `copyFromId` works for both active and inactive source floors.
It copies the feature envelope and remaps floor-scoped IDs and references targeting
the copied floor, including wall hosts, node endpoints and nested anchors. External
floor references are preserved. Project-level views/sheets remain attached to
their original floors; duplication does not implicitly duplicate sheets.
`delete-floor` removes that floor and its owned data only.

Legacy room, opening and furniture source IDs are opaque and preserved on copy,
including IDs containing the source floor's slash/colon namespace. Their compiled
scene references change only the outer floor namespace; encoded wall lineage
retains the unchanged source identity. Legacy room links distinguish source IDs
from compiled room references. Already scoped obstacle IDs follow the compiler's
colon-prefix rule; unscoped obstacle source IDs remain unchanged. Explicit
external-floor anchors and route endpoints are never remapped, even when that
floor's ID starts with the copied floor's namespace.

`select-floor` is navigation: it changes the compatibility active-floor aliases
and adapter view, but not floor data, revision, timestamp or history. Selection
and legacy zoom-only changes likewise do not create authored revisions.
Pending actual legacy edits are committed before a command as before.
Navigation failure restores project and selection. The legacy UI still reads
`getProject().activeFloorId`; this is not a second editable store.

JSON preserves optional feature records exactly, including nulls and broken
references. IndexedDB retains its existing record/database versions and validates
through the shared model. Its canonical comparison ignores navigation aliases
and legacy zoom only: a same-revision navigation-only save is idempotent and
returns the existing record (it does not promise to save the most recently viewed
floor). Actual conflicting authored edits still produce `RevisionConflictError`.
Existing old files are not migrated or rewritten by feature validation.

## Read-only projection and provenance APIs

Load classic scripts in this order: `planner-features.js`, `planner-model.js`,
`planner-projection.js`, `planner-bridge.js`; storage follows the model as before.
Each new pure module also supports `require` without a DOM or network.
`planner-structure.js` may be loaded as a separate classic script, or required
directly; call `HomePlannerStructure.build` with the projection's DrawingScene.
It is not wired into existing UI, 3D, drawing, workspace or saved outputs here.

`HomePlannerProjection` exposes:

- `localToSite({x,y,z}, legacyScene)` → site-local `{x,y,z}`; requires a plot.
  This low-level helper translates x/y only; caller supplies project-relative z.
- `siteToWorld({x,y,z}, headingDeg, datumElevationM = null)` →
  `{east,north,up,absoluteElevationM}`. Up stays project-relative; the last
  field is null without a datum.
- `projectScene(legacyScene)` → deeply frozen site-local geometry. No changes to
  source objects; floor/plot/building remain distinct. Rooms (rect **and** module),
  walls, valid openings (including wall-nested copies), furniture and obstacles
  are translated consistently. Rejected opening proposals retain their original
  evidence with `sourceCoordinateSpace: 'floor-local'`. Electrical records retain
  their authored anchor, elevation and other fields, with projection-only
  `resolvedPoint`, `coordinateSpace: 'site-local'`, `positionStatus`, and
  `positionDiagnostics` added. `HomePlannerElectrical.resolveAnchor(record,
  sourceFloorScene, Model)` validates the exact raw floor-local hosts before the
  source plot origin is subtracted from x/y once. Its project-relative z (including
  the floor elevation once) is preserved, including null. No guessed ceiling
  elevation or invented 3D point is added. Unsupported surface heights, missing
  hosts and invalid legacy records remain schedule-only with `resolvedPoint:null`;
  valid wall plan positions may retain unknown z. Legacy arbitrary `point` fields
  remain source evidence, not resolved coordinates. These derived fields belong
  to DrawingScene only; the project and its saved electrical records are unchanged.
  CommonJS loads the existing resolver lazily. In a browser, load
  `electrical-planner.js` before the first projection of electrical records; it may
  follow the projection script because lookup is dynamic. An unavailable resolver
  produces `electrical-resolver-unavailable` position diagnostics and no point.
  The light worker receives an already projected DrawingScene and needs no new
  import. The resolver currently exposes no browser global without a document,
  so a future worker that builds DrawingScene itself needs an explicit resolver
  export rather than assuming importing that script is sufficient.
- `build(project)` → deeply frozen `{version:1, kind:'DrawingScene', projectId,
  revision, inputFingerprint, siteDatum, scenes, authored, documentation,
  diagnostics}`. It compiles through the real model, not a second geometry
  implementation. Missing/invalid/unregistered floors are diagnosed and omitted
  from `scenes`, never replaced by fabricated geometry.
- `snapshot(project, {purpose, engineId, engineVersion, inputs = {}})` →
  deeply frozen `{version:1, purpose, provenance, inputs, drawing}`. Purpose is
  drawing/analysis/export; engine identity/version must be explicit nonempty
  strings. `inputs` is caller-supplied plain JSON configuration, **not validated
  engineering data**; each future engine must validate its own settings.

Bridge convenience APIs are `getDrawingScene()`, `createSnapshot(options)` and
`inputFingerprint(inputs = {})`. Snapshots are input captures, not successful
calculations or export results, and are not stored automatically.

Each projected authored entry is `{floorId, collection, record, anchorStatus,
anchors}`; dimensions additionally have `distanceM`. The record is an exact copy.
Each resolved anchor has `{status:'resolved', point, world}` in site coordinates.
Unresolved anchors have `{status:'unresolved', point:null, code, reference}` and
optionally `causeCode` for an unresolved dependency. Dimension distance is the
3D Euclidean distance between resolved anchors, not a field measurement; it is
null if either end is unresolved. Offset controls future drawing placement only.

Foundation diagnostics contain `{code, ownerId, reference}` with optional
`message` (invalid scene compilation) or `causeCode`. Codes:
`missing-geometry`, `invalid-geometry`, `missing-plot`,
`inconsistent-site-frame`, `unresolved-site-frame`, `unknown-anchor`,
`missing-floor`, `missing-host`, `removed-host`, `host-bounds`, `host-void`,
`cyclic-host`, `host-depth-limit`, `unresolved-host`,
`service-system-mismatch`, `unknown-input`, `missing-view`.
Existing scene diagnostics are retained separately in each scene. Consumers must
inspect diagnostics and reject incomplete/invalid inputs for their operation;
the presence of a snapshot alone is not a readiness certificate.

`Model.canonicalDocument(project)` returns a **comparison representation**, not
an importable project: it resolves the schema-1 active aliases onto the active
floor, fills legacy comparison defaults on other floors, drops top-level aliases
and per-floor legacy zoom. The active aliases retain their historical precedence
over conflicting old active-floor legacy fields; feature data has no aliases.
`Model.stableStringify(json)` produces deterministic sorted-key JSON.
`Model.inputFingerprint(project, inputs)` is a collision-free canonical JSON key,
not a short cryptographic hash. It excludes project ID/revision/update timestamp,
navigation/zoom, and known saved outputs `environment.results` and
`environment.sunlight.result`. It conservatively includes all other saved inputs,
including documentation and metadata; it is not a selective per-solver cache key.
Provenance stores `{projectId, revision, inputFingerprint, engineId, engineVersion}`.
Result writes still change revision/storage identity but do not invalidate this
input key. Any new output namespace must be explicitly classified before reuse
as part of this input contract. Revisions are provenance, not input fingerprints;
undo/redo creates a new revision but can return to an earlier input key.
