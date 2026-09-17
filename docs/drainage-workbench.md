# Design → Drainage

Drainage is an extension of the existing services workbench: the same bridge,
controller, native fields, anchor handling, schedules and preview lifecycle,
with an explicit drainage domain. Its first viewport is the drawing workspace,
not a long metadata form. The incumbent light, restrained workbench styling,
native keyboard controls and responsive scroll regions are retained.

**Engineering is always NOT ASSESSED.** These are authored waste/soil/vent and
rain/storm networks, supplied levels and geometric review. No flow capacity,
rainfall, infiltration, sewage capacity, permission, code compliance, safe
cover, fitting internals, external connection or construction detail is inferred.
See [the stable drainage foundation](drainage-coordination.md).

## Integration contract

Load the existing feature/model/bridge/projection foundation, then:

1. `planner-services.js`
2. `planner-drainage.js`
3. `planner-drawing.js`
4. `planner-drainage-drawing.js` (required for preview, not draft authoring)
5. `planner-services-ui.js`
6. `planner-drainage-ui.js`

Keep the existing plumbing drawing script in its current load sequence.
Include **`planner-services-ui.css`** for both hosts; there is no additional
drainage CSS dependency. The wrapper is a small domain adapter, not a copied UI.

The workspace coordinator owns route **`design/drainage`** and host
**`#workspaceDrainage`**. The classic entry point exposes
**`HomePlannerDrainageUI`** and auto-mounts on DOMContentLoaded (or immediately
when the DOM is ready). `mount(document?)` is idempotent, returning the controller
stored at **`host.homePlannerDrainage`**. If the host is created later, call mount
explicitly. Normal plumbing continues using `#workspacePlumbing`,
`HomePlannerServicesUI`, and `host.homePlannerServices`.

Drainage control IDs start **`hp-drainage-`**:
`hp-drainage-collection`, `hp-drainage-selectedId`, `hp-drainage-kind`,
`hp-drainage-role`, `hp-drainage-groundM`, `hp-drainage-finishedFloorM`,
`hp-drainage-invertM`, `hp-drainage-viaInvertsM`, `hp-drainage-keepViaInverts`,
`hp-drainage-replaceWaypoints`, `hp-drainage-dischargeKind`,
`hp-drainage-removeDischarge`, `hp-drainage-refresh`, `hp-drainage-zoom`,
and `hp-drainage-preview-{view,drainageSystem,paper,orientation,scaleDenominator,units,pageIndex}`.
Shared visual classes remain `hp-service-*`; drainage also adds `hp-drainage`
to its host. Both hosts may be mounted simultaneously without ID collisions.

```js
const controller = HomePlannerDrainageUI.createController(HomePlanner, window);
controller.select('serviceNodes');
controller.setDraft({
  system: 'rain', kind: 'fixture', role: 'roof-outlet', circuit: 'storm'
});
// Supply explicit anchor coordinates or an existing fixture reference before Save.
controller.save(); // null on error; getState().error explains the atomic failure
controller.setPreviewSettings({
  view: 'profile', drainageSystem: 'both', paper: 'A3',
  orientation: 'landscape', scaleDenominator: 100, units: 'metric'
});
controller.refresh(); // explicit; no refresh on mount, save, routing or filter edit
controller.setPreviewSettings({ pageIndex: 1 }); // cached sheets only
controller.subscribe(state => { /* update consumer */ });
controller.dispose();
```

The underlying shared APIs also accept the explicit third/second configuration:
`HomePlannerServicesUI.createController(bridge, runtime, {domain: 'drainage'})`
and `HomePlannerServicesUI.mount(document, {domain: 'drainage'})`.
Do not create both a mounted and a separate headless controller for one UI.
Both classic scripts and CommonJS are supported.

**Report / Drawings** links have `data-workspace="report"`,
`data-section="drawings"` and **`data-drawing-discipline="drainage"`**.
The Report coordinator must consume discipline before workspace routing.
The UI does not register a competing Report exporter or link handler.
**Layout / 3D** links only navigate; they never enable any intent layer.
No top-level navigation, workspace registration, Report or 3D code is changed
by this UI delivery.

## Authoring and preservation

Waste is the controlled initial system; its circuit remains unknown until
explicitly chosen. Waste circuits are soil/waste/vent. Rain has storm.
Existing water records remain visible and can receive compatible repairs;
drainage cannot create new water records. Analysis filters do not change
authoring defaults, pending drafts or raw schedules. Fixtures still create no
automatic ports.

Base kinds are explicit and role options are constrained to their compatible
kind: **fixture** → floor-trap/gully-trap/roof-outlet, **junction** →
chamber/downpipe, **outlet** → outfall, alongside existing compatible roles.
Changing system/kind does not silently replace an incompatible circuit/role.
The retained invalid selection stays visible until repaired.

Points and replacement via coordinates are **owner-floor PLATE-LOCAL x/y** and
**floor-relative z**. Separately supplied invert, ground and finished-floor
levels are **signed project-relative metres**, even on an upper floor.
No floor elevation is added to those level fields and no anchor z becomes
invert. Level/slope source is null, assumed, surveyed or engineer-provided,
with an optional unverified reference. Access radius and route clearance are
nonnegative supplied review distances, not engineered defaults.

Blank new scalar fields mean null. Untouched absent saved fields remain absent;
editing a formerly absent scalar to blank explicitly records null. Existing
records are deep-copied before an upsert, preserving untouched optional data.
Numeric fields accept decimal/exponent numbers, not hexadecimal, expressions,
NaN, infinity, objects or undefined. Values retain model bounds.

Discharge exists only on outlet-kind nodes: null/unknown or explicit
`{kind, reference}`. Available kinds: sewer, surface-outfall, soakaway, septic,
reuse and other. Unknown never means sewer. Clearing the kind while retaining
a reference is a field error. Changing to a non-outlet while retaining even
`discharge: null` is a field error: clear both fields and check **Explicitly
remove discharge metadata**, or keep the outlet base kind.

Node/fixture anchors retain existing point/entity/wall/cross-floor/null hosts.
Only **Explicitly replace existing anchor** authorizes new geometry. Fixture
and endpoint dropdown values use exact JSON `[floorId, entityId]` pairs.
Missing or wrong-pair references are retained as unavailable, not replaced by
the first option. Directed routes keep from/to independently; repairs affect
only explicitly changed endpoints.

Waypoints use one `x,y,z` triple per line. Existing anchors, including null or
unresolved hosts, survive unless **Explicitly replace existing waypoints** is
checked. **Ordered via invert levels** accepts exactly one number or `?`
(unknown/null) per existing or replacement via, in order. Empty internal lines,
wrong counts and invalid numbers fail atomically. There is no interpolation.

Replacing coordinates when saved `viaInvertsM` exists requires one of:

- Explicitly edit the invert list to align with the replacement points, or
- Explicitly check **Keep existing ordered via invert levels**; counts must match.

Merely checking waypoint replacement never silently reapplies old levels to
new geometry, and never silently drops them. To clear vias, explicitly clear
both the waypoint and invert textareas. Via-only level edits do not change
hosted/null waypoint anchors. Older absent `viaInvertsM` remains absent unless
explicitly edited; new drainage routes require an aligned invert list.
The plumbing editor applies these same preservation rules.

All writes use existing `upsert-authored` / `delete-authored` bridge commands.
Undo/Redo, floor copy/remapping and JSON import/export remain authoritative.
There is no secondary network store. Deletion leaves dangling references
repairable. Floor/project/content changes invalidate results and safely reload
drafts using actual fingerprints, including same-ID/revision replacement.
Selection and workspace navigation without content changes retain drafts.

## Refresh and review

Refresh captures exactly one immutable DrawingScene, checks its identity and
fingerprint, calls `HomePlannerDrainage.build(scene, {systems})`, then passes
the same scene to:

```js
HomePlannerDrainageDrawing.createSheets(scene, {
  floorId, floorName, view: 'plan', // or 'profile'
  systems: ['waste', 'rain'], // selected subset, never water
  paper: 'A3', orientation: 'landscape',
  scaleDenominator: 100, units: 'metric'
});
```

There is no architectural `layers` option. Common `validateSheet` validates
every returned page; serialization uses renderer `toSVG` or common `toSVG`.
Missing renderer leaves successful coordination available with a visible
preview error. Empty/invalid/over-100 page sets, serialization failures and
over-20 MiB UTF-8 SVG previews fail visibly, never truncate. Fixed-scale fit
errors require an explicit paper/orientation/scale repair.

The initially closed **View & print settings** disclosure groups view, systems,
page, zoom and print controls. Its live summary shows the chosen view, systems,
paper and scale. Refresh and the engineering warning remain outside it; context,
links and detailed help follow the drawing. The shared toolbar retains the active
floor. Keyboard disclosure toggles do not rebuild or invalidate the preview.

Preview paging uses cached sheets; Fit to width / Full view only changes screen
zoom, not sheet millimetres or print scale. SVGs are image-context Blob URLs,
revoked on replacement, invalidation, image failure and disposal. Print at
100% / Actual size. Paper, orientation, physical scale and units are grouped
under **Print settings**, whose collapsed summary always shows their values.

The findings table includes **all selected drainage findings**, including
other-floor and project scopes, severity and the complete message. Qualified
`entityRefs` have floor-labelled selection buttons when the bridge supports
selection; nodes/routes/fixtures open their authoring record, while supported
walls/structural references select the shared model. Unsaved work requires a
discard confirmation before finding-driven selection. Unknown references
remain inspectable in collapsed raw-ID details; the UI never guesses a floor
from a bare ID. Schedules keep all raw records regardless of analysis filters.

## Verification

```text
node --test tests\planner-drainage-ui.test.cjs tests\planner-services-ui.test.cjs tests\planner-drawing-ui.test.cjs
```

Coverage includes both domain defaults and mounted hosts, strict metadata and
ordered-level repairs, unknown hosts, compatible role/base-kind combinations,
independent upper-floor levels, exact endpoint pairs, preserved optional
metadata, bridge history/JSON, analysis filter isolation, draft preservation,
same-identity fingerprint invalidation, same-scene renderer options, bounded
pages, missing/invalid renderer output, screen-only zoom and Blob URL cleanup.
Native DOM contract tests use a small DOM harness. An isolated read-only
browser mount was also checked at 1440px and 390px: no horizontal document
overflow, all controls labelled, drawing before form, and a successful
two-page refresh. The coordinating workspace/Report/3D end-to-end journey
remains a separate integration check, not claimed by these tests.
