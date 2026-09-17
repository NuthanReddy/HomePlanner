# Physical facade projections and finish intent

The Design → Elevations facade editor authors **real rectangular building
obstacles**, not renderer decoration. A box can describe a rectangular canopy,
projection, parapet or cladding mass; it is not a complete assembly.

Every footprint coordinate, width, depth, physical height, base and beam
transmittance must be entered explicitly. Empty dimensions are invalid. Width
follows x and depth follows y, from the entered footprint corner. x/y are
**plate-local on the active floor**, in metres. `baseM` is **project-relative**,
not floor-relative and not a survey elevation; `baseM + heightM` is the top level.
The shared projection shifts the footprint into site coordinates while retaining
these vertical levels. Existing 3D, shadow, exposure and export paths consume the
same physical obstacle.

These are free-positioned boxes. Editing a wall does not move them. There is no
automatic wall attachment, tracking, material inference or optical finish model.
Finish is unverified user text; a blank finish or label means unknown. Explicit
transmittance remains the analysis input independently of finish intent.

## Storage and edits

Existing obstacle records remain valid without any new field or floor collection.
The optional metadata is strictly:

```json
{ "facade": { "version": 1, "finish": null } }
```

Only `type: "building"` permits this metadata. Both nested keys are required;
extra keys, unsupported versions, undefined values and a null/array metadata
container are invalid. Finish is null or nonempty text, at most 512 characters,
without control characters (the existing model text validator applies).

New IDs are `<floorId>:facade:<uuid>`. The editor only selects facade-tagged
records in the active floor's obstacle array. Save/delete use the existing
`set-obstacles` transaction with the complete array, retaining neighboring
buildings, trees, unknown record metadata and every other floor. Native
confirmation describes the current record and proposed save. Existing JSON,
IndexedDB project storage and Undo/Redo mechanisms apply without a separate store.

Floor duplication remaps the floor-prefixed ID. **The project-relative base is
copied verbatim**, so duplicated boxes can initially occupy the same level:
explicitly adjust their bases when that is your intent. This does not change
the global obstacle copy semantics.

Immutable fingerprints detect replacements even with unchanged IDs/revisions.
Unrelated edits retain pending fields. If the selected box changed or disappeared,
its draft is retained with a conflict and cannot overwrite the new source.
**Discard draft / reload fields** explicitly adopts the current saved values.
Project/floor switches park drafts under their original owner; returning restores
them without moving a box. `planner-drafts.js` holds input drafts only for this
session, not in project JSON or browser storage.

## Integration

Place `<section id="workspaceFacades"></section>` under Design → Elevations next
to the elevation view editor/preview. Load `planner-facade-ui.css`, and load
`planner-facade-ui.js` **after `planner-drafts.js`, `planner-model.js`, `planner-projection.js` and
`planner-bridge.js`**, once the `HomePlanner` bridge is available. It auto-mounts
on DOMContentLoaded, or immediately if the document is already ready.

Browser API: `HomePlannerFacadeUI.mount(document)` (idempotent per host);
`host.homePlannerFacades` is the mounted controller. Test/CommonJS API:
`createController(planner, runtime)` with runtime `crypto.randomUUID`.
Controller methods: `getState`, `sync`, `select(id)`, `setDraft(patch)`,
`save({confirmed:true})`, `deleteSelected({confirmed:true})`, `discardDraft()`, `subscribe`,
`dispose`. Programmatic mutation requires explicit confirmation; DOM actions
use native `confirm`. No renderer or analysis is called by this module.

Navigation links target `?workspace=report&section=drawings&discipline=views` and
`?workspace=design&section=layout`, with the workspace's `data-workspace` and
`data-section` attributes for in-place navigation that retains drafts. On Layout,
choose the existing **Open 3D** action. The adjacent view editor supplies the
preview; no second renderer is introduced.

On the first Report entry, the facade link carries the adjacent workbench's
selected saved view when available. An existing Report view choice is retained.
The link selects the views discipline but does not start rendering or exporting.

The Report link also declares `data-drawing-discipline="views"`. Report's
capture-phase delegated handler selects Elevations / sections before workspace
navigation, avoiding an unrelated architectural preview. It preserves the
Report's selected saved view and never auto-renders, runs analysis or loads PDF.
If that selected view was deleted, Report asks for an existing view rather than
silently falling back. Use explicit Refresh or Download after reviewing settings.
