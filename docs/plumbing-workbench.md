# Design → Plumbing

The plumbing workbench authors **water/waste intent**, not plumbing engineering.
Project engineering status is always **NOT ASSESSED**, even when no local finding
is present. Hydraulic sizing, pressure/head, capacity, drainage compliance,
approved penetrations, fitting internals, shafts and construction details are
not assessed. Rain authoring and geometric invert profiles are available in the
separate [Drainage workbench](drainage-workbench.md), not this plumbing analysis.
See [the network contract](plumbing-networks.md) for precise scope and findings.

## Author, then save

Choose **Fixtures**, **Nodes / explicit fixture ports**, or **Directed routes**.
Select a saved current-floor record to edit, or start a new record. Inputs are
pending drafts; **Save** is separate from coordination/preview. Switching record
type or selected record asks before discarding an unsaved draft. Floor/project
navigation parks drafts under their original project/floor/collection/record;
returning restores them without rehosting. Workspace navigation, model selection
and unrelated project edits retain pending fields. A changed/deleted selected
record retains the input draft with an explicit conflict instead of overwriting
the new source. **Discard draft / reload fields** adopts the current saved record
after confirmation. Fingerprint changes still invalidate derived results,
including same-ID/same-revision replacements. Pending input drafts are session-only,
not part of project JSON or browser Save until explicitly applied.

- **Fixtures:** basin, sink, toilet, shower or equipment. Supply point x/y/z
  explicitly. Width/depth/height are positive metres or blank (unknown).
  A fixture creates **no automatic ports**.
- **Nodes:** water or waste; kind fixture, junction, supply or outlet.
  Labels, circuit and role are explicit optional metadata. Allowed roles:
  fixture → port/fixture/trap/floor-trap/gully-trap/roof-outlet;
  junction → junction/stack/valve/trap/cleanout/chamber/downpipe;
  supply → supply; outlet → outlet/outfall. Unknown role is allowed. Water circuits
  are cold/hot; waste circuits are soil/waste/vent; blank circuit is unknown.
  Incompatible kind/role or system/circuit edits fail atomically, not silently
  convert. Unusual but schema-valid purposes remain authored warnings.
- A node may explicitly reference an **existing fixture on any floor** using
  the grouped fixture selector. This creates an entity anchor at that fixture's
  supplied reference point, not a designed socket/offset. Alternatively supply
  explicit point x/y/z on the current owner floor.
- Node diameter is positive millimetres or unknown. Invert is an independently
  supplied level in metres or unknown, not a substitute for anchor z. No
  centerline/invert relationship is inferred.
- **Routes:** select existing from/to nodes grouped by floor. Internal selection
  values use exact `(floorId, entityId)` pairs, never ID-prefix matching.
  External endpoints are floor-annotated in schedules. From → to is explicit
  proposed direction, not verified flow. Diameter is positive millimetres;
  slope is nonnegative fall/run (e.g. `0.02`), or blank/unknown. Supplied slope
  is not enforced against coordinates.
- Optional route waypoints use **one `x,y,z` triple per line**, not JSON.
  All three numeric components are required on each supplied line. Blank means
  no vias for a new route or an explicit waypoint replacement.

### Coordinate and preservation rules

New/replacement point coordinates are metres in the selected **owner floor's
PLATE-LOCAL x/y frame**; z is relative to that floor's elevation. These are
not the shared projection's site-local x/y and project-relative z.
Changing owner floors never copies a draft into a different coordinate frame.

Existing point, wall, entity, cross-floor and null/unresolved anchors remain
unchanged on metadata edits. Check **Explicitly replace existing anchor** before
replacing one. Existing route via anchors likewise survive unless **Explicitly
replace existing waypoints** is checked. A blank replacement textarea explicitly
clears vias; an unchecked textarea never flattens existing hosts.

Drainage metadata on existing records survives plumbing edits too. When present,
its repair controls are exposed rather than stripping fields: independently
supplied ground/finished-floor levels, claimed provenance, access/clearance,
outlet discharge and ordered via invert levels. Existing absent fields stay
absent unless edited. Replacing waypoints that already have `viaInvertsM`
requires an explicitly repaired invert list, or checking **Explicitly keep
existing ordered via invert levels** with the same count. Clearing waypoints
requires explicitly clearing their invert list. Outlet-kind changes require
clearing kind/reference and explicitly removing discharge metadata: even null
discharge is invalid on non-outlet kinds. No edit silently drops metadata.

Missing or wrong-pair references appear as unavailable and remain retained until
explicitly repaired. The UI never silently selects the first dropdown option.
Deleting a node or fixture does not delete routes/ports that reference it:
surviving references stay dangling and repairable. Existing rain intent remains
in the raw schedule and can receive compatible metadata repairs, but the UI does
not create new rain systems or include rain in water/waste analysis.

Each save/delete uses only the bridge's `upsert-authored` / `delete-authored`
command for the selected collection. Other records, other floors and
`documentation` are preserved. Existing absent optional metadata remains absent
unless changed. New IDs use `<owner-floor>:authored:<uuid>`. Normal Undo/Redo,
floor duplication and project JSON import/export remain the persistence/history
mechanism; there is no UI-side store.

## Coordination, schedules and preview

**Refresh plumbing coordination & preview** captures one immutable drawing scene,
then builds core coordination and the current-floor sheet set from that scene.
Nothing automatically runs on mount, save, workspace navigation or changing
preview controls. Select plan/riser, water/waste/both, paper, orientation, fixed
scale and drawing units before explicitly refreshing.

The system filter applies only to analysis and sheets, never to authored data.
The current-floor tables always retain **all raw fixtures/nodes/routes**, including
unselected systems, with computed issues/lengths when available. Raw fields,
identifiers, hosts and projected details live in expandable details, not giant
UUID rows. Tables have keyboard-focusable horizontal scrolling regions for
phones. Project/global findings are included beside current-floor findings.
“Not refreshed / not selected” is not a successful assessment.

Preview page selection uses cached sheets without rebuilding. **Fit to width**
and **Full view (intrinsic size)** change screen zoom only, not pipe geometry,
sheet millimetres or print scale. Fixed-scale fit failures require an explicit
paper/orientation/scale choice. Images use Blob URLs in image-only SVG contexts;
replacements, invalidation and disposal revoke their URLs. The 100-page and
20 MiB SVG limits fail visibly rather than truncate.

Use the Layout / 3D link to inspect the shared layout, then enable plumbing intent
explicitly. That link does not enable the 3D layer. The Report / Drawings link
selects **plumbing** before workspace routing and does not start analysis.
PDF/SVG/PNG use [the existing Report pipeline](drawing-report.md), not a second
export implementation. Print at **100% / Actual size**.

## Integration hooks

Load `planner-drafts.js`, the existing feature/model/bridge/projection foundation, `planner-services.js`,
`planner-drawing.js` and `planner-services-drawing.js`, then
`planner-services-ui.js`; include `planner-services-ui.css`.
The workspace host is `#workspacePlumbing` for `design/plumbing`.
The classic script auto-mounts on DOMContentLoaded and exports
`HomePlannerServicesUI`; CommonJS exports the same public API:

```js
const controller = HomePlannerServicesUI.createController(HomePlanner, window);
controller.select('serviceNodes', savedId); // or select('fixtures') for a new draft
controller.setDraft({ label: 'Basin cold port' });
controller.save(); // null on failure; getState().error explains; atomic bridge command
controller.deleteSelected({ confirmed: true });
controller.setPreviewSettings({
  view: 'riser', plumbingSystem: 'both', paper: 'A2',
  orientation: 'portrait', scaleDenominator: 75, units: 'metric'
});
controller.refresh(); // explicit one-scene capture
controller.setPreviewSettings({ pageIndex: 1 }); // cached preview only
controller.subscribe(state => { /* update consumer */ });
controller.dispose();
```

The same controller and native form renderer support
`createController(bridge, runtime, {domain: 'drainage'})` and
`mount(document, {domain: 'drainage'})`. The thin `planner-drainage-ui.js` entry
point supplies that explicit configuration; plumbing remains the default.
Hosts, element IDs, drafts, system defaults, results and settings are isolated.
Both hosts share `planner-services-ui.css`; no second persistence mechanism or
copied form implementation is introduced.

`mount(document?)` is idempotent and stores its controller at
`host.homePlannerServices`. `getState()` exposes collection, selectedId, detached
draft/selectedRecord, dirty/error/message, raw schedule grouped by collection,
floor-grouped fixture/node options, findings, preview/settings and permanent
`engineeringStatus: 'not-assessed'`. `sync()` detects bridge changes without
requiring subscriptions. DOM selectors use `hp-service-`.

Renderer calls are strictly:

```js
HomePlannerServicesDrawing.createSheets(scene, {
  floorId, floorName, view: 'plan', paper: 'A3', orientation: 'landscape',
  scaleDenominator: 100, units: 'metric', systems: ['water', 'waste']
});
```

Every version-1 sheet uses the common validator; serialization uses the services
serializer if available, otherwise common `toSVG`. No architectural `layers`
option is passed. Report maps session-only `serviceView` and `plumbingSystem` to
the same `view` / `systems` contract.

## Verification

`node --test tests\planner-services-ui.test.cjs tests\planner-drawing-ui.test.cjs`
covers real bridge CRUD, cross-floor fixture/node routes, exact pairs,
duplication, dangling references, metadata/optional-field preservation,
Undo/Redo/JSON, strict numeric/role/circuit validation, filter isolation, one-scene
refresh, fixed print dimensions, fingerprint invalidation, cached pages, shared
Report options, PNG DPI, pending multi-page cancellation and pre-route links.
