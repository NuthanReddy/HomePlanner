# Room Planner architecture

## Purpose

The Room Planner turns the currently selected whole-plot or split-plot
buildable envelope into a deterministic, editable schematic. Fresh browser/new
projects start with one bedroom, one kitchen and two bathrooms. Suggestions
prefer a northwest bedroom (northeast is also accepted), southeast kitchen,
south first bathroom and west second bathroom, using geographic directions
after the plot's frontage rotation. Existing saved/manual layouts are not
replaced by these defaults; **Add empty floor** remains explicitly empty.

## Geometry pipeline

### Reusable incumbent 2D surface

`planner-layout-runtime.js` extracts the existing `roomSvgPlan`,
`roomStairGlyph` and `initRoomEditing` implementations. `index.html` now uses
this same module; there is no replacement layout model, iframe, hidden legacy
application, backend geometry service or automatic storage access.

The browser API is `HomePlannerLayoutRuntime.mount(svg, adapter,
{editing:true})` (also available through CommonJS). It returns
`{render(context = adapter.getContext()), getView(), destroy()}`. Mounting does
not generate a plan, render automatically, subscribe to changes or save.
`render` consumes the existing `{plate,g,plan,cfg}` context in metres. The host
owns generation/recalculation and refresh subscription; the Site adapter must
provide the actual selected plate, not a demonstration or simplified rectangle.
Call `destroy()` before removing/reusing the SVG: it cancels a pending gesture,
removes all SVG/control/document listeners and animation frames, and clears the
published coordinate view. Duplicate mounts on the same SVG are rejected.

The explicit adapter inventory is exported as `requiredCallbacks` and
`requiredHelpers`. The incumbent adapter is `roomLayoutRuntimeAdapter()` in
`index.html`; it does not initialize the rest of the page.

| Dependency | Contract |
| --- | --- |
| SVG host | Actual SVG in its owning browser document, `viewBox="0 0 800 560"`; preserve the existing plan CSS, SVG theme variables, focus and touch-action styling. React must not reconcile its generated children. |
| `getElement(id)` | Resolve the host's real controls, not global duplicate IDs. Editing requires `roomEditHint` and `roomReset`; `showPlanDims` is optional. |
| `getContext`, `getLastResult` | Current incumbent context and last Site result; dynamic readers, not captured copies of editable geometry. |
| `getPlanner`, `getModel` | Existing raw shared bridge and `HomePlannerModel`. The renderer uses `sceneForRender`, `renderLayer`, `getSelection`; gestures use shared commands, selection/source selection, and `beginLegacyGesture`/`endLegacyGesture`. These extended legacy methods are not all exposed by the typed `PlannerApi` facade. |
| `setView(view)` | Publish the surface's `point`, `toLocal`, `box`, `scale`, or `null` on failure/teardown to the existing pointer/palette owner; no project mutation. |
| `getInternalWallM` | Read the currently committed wall thickness dynamically. |
| `resetLayout(context)` | Existing no-bridge reset fallback; with a bridge, Reset executes `reset-floor-layout` instead. |
| Helpers | Existing escape/format, stair/edge, usable-area, furniture, pointer, destination validation, commit/delete/rotate, manual-snapshot and `renderRoomPlanner` callbacks. They retain their incumbent command/history ownership. |
| Constants | Existing `FT`, `M2SF`, `ROOM_EPS`, `ROOM_COLORS`, `DIRNAME`. |

For renderer-only reuse, `{editing:false}` requires only `rendererCallbacks`
and `rendererHelpers` plus the constants. It installs no gesture handlers and
needs no reset/hint controls; it is not an editable native workspace.

This module is a verified **surface extraction**, not by itself complete React integration.
The room library, component palette, viewport zoom/fullscreen/toolbars,
committed control/draft registry, Site-to-plate adapter, geometry generator and
`renderRoomPlanner` orchestration still live in their current owners. A native
host must supply/extract those real dependencies before claiming full Layout
parity; the typed provider alone does not supply the extended rendering/gesture
bridge. The existing Three.js mount shares the same model.

### Bounded native Design integration

`src/platform/NativeDesign.tsx` mounts this **actual incumbent surface**, the
existing `planner-editor.js` inspector/floor controls, and `planner-3d.js`;
it does not replace the renderer with a rectangle editor or load another full
application. Its `cache: {document: schema-1 document | null}` is an explicit
working-copy boundary, with optional `onDocumentChange(document)` for the host.
Keep the native component mounted across workspace navigation (hide its panel)
to retain the same command controller, Undo history and scoped inspector drafts.
Unmount destroys its SVG listeners, inspector subscription and Three.js GPU
resources. The cached document retains committed geometry, not Undo history.

Open a complete Room Planner JSON explicitly. A candidate is validated and
mounted in a detached probe before replacing the working copy; invalid files
and edits made during file reading retain current work. This does not read,
import or overwrite existing browser storage. Account Site/Costs/Materials
retain their separate ownership. Export downloads committed schema-1 JSON,
including independent floors and stable IDs; drafts are not included, and a
download request is not proof of a durable file save.

`planner-design-runtime.js` is reproducibly extracted from the incumbent
helpers and bridge edit/hosted-opening/render hooks by
`node scripts\extract-design-runtime.cjs`; `--check` verifies source parity.
It uses the existing `HomePlannerBridge.createController` factory rather than
another geometry authority. Its supported path is captured-layout editing:
room/furniture movement and resizing, wall/opening inspection and commands,
the incumbent numeric inspector, floor selection and optional real Three.js.
The expanded native host additionally reuses `roomPlannerConfig`,
`deriveRoomGeometry`, the incumbent packing/manual-layout pipeline, committed
`HomePlannerRoomInputs`, actual room/library/component controls and original
room/balcony deletion adapters. `planner-design-controls.js` is extracted
verbatim from the incumbent settings/palette markup; there is no independently
invented programme or replacement generator. Programme drafts retain their
owner; Apply/Enter is one accepted transaction. Library adds preserve existing
rooms and furniture using `roomPreserveProgrammeChange`. Reset is explicitly
whole-layout regeneration.

The native props `record`, `evaluation`, `blocked` consume **applied**, matching
account Site/evaluation records, never a raw Site draft. When no Design exists,
**Create layout from applied Site** creates the actual incumbent starter using
the elected front, full/net plot, required/applied setbacks, whole/split plates,
floor/balcony scenario and existing defaults. The shared schema-1 model requires
location/time zone: when absent, generation asks for applied Site location
rather than substituting Hyderabad or geolocating. Account scenario floors do
not fabricate independent editable storeys. The account wrapper's explicit
**Save Design** persists the canonical snapshot separately from Site history;
JSON remains a backup. No autosave or automatic browser-project import occurs.

Later Site changes require **Review / apply Site changes**. The reversible
`link-native-site` bridge command retains current room rectangles, source IDs,
balconies and inactive floor slices; a changed frontage or incompatible envelope
fails without changing the document. Imported legacy plans remain unlinked
until this explicit action. `project.nativeSiteSource` and active-floor
`legacy.nativeSiteSource` preserve version-1 source provenance: account project,
workspace version, source fingerprint, supplied Site snapshot, gross/net/envelope
geometry, incumbent-result adapter, per-plate registrations and selected plate.
`environment.nativeSiteEnvironment` retains its Site surroundings snapshot and
registration for study adapters. Registration expresses the exact gross-NW
origin in the selected net-plot-local frame, including cardinal rotation,
road widening and split offset, with metre `baseOffsetM:0` relative to the shared
abstract modelling datum (not a surveyed elevation). Known generated origins
do not require users to enter duplicate coordinates. Missing obstacle heights,
bases and transmissions remain unknown; presence of a source record is not
proof of a complete surroundings survey.

The classic-asset Vite middleware serves these scripts without import-analysis
rewriting. Vite otherwise injects an ESM `injectQuery` import into the classic
Three.js script despite its `@vite-ignore` runtime imports. Production builds
copy the same classic scripts/styles and pinned vendor modules to `classic/`.
Script `data-homeplanner-manual` loading exposes bridge/editor/3D factories
without their incumbent page bootstrap. `tests\planner-design-runtime.test.cjs`
checks this isolation and extraction; the disposable-context probe
`tests\native-design-browser.js` additionally checks explicit JSON opening,
real pointer preview/Escape/release, exact Undo/Redo, inspector drafts, invalid
imports, a rendered Three.js canvas and teardown.
`tests\native-design-site-browser.js` checks exact starter-generation parity,
programme drafts/one-commit Apply, service adds without rearrangement, selected
room deletion through the incumbent confirmation dialog, compatible Site
application/Undo, exact inactive-floor preservation, incompatible Site rollback
and restoration after native teardown/remount. Native programme teardown releases
its original input bindings so another account/editor mount can use the same
document without stale input identities or duplicate listeners. Both probes use
unmodified local classic asset delivery in disposable browser contexts.
Node source-adapter checks
also cover stale ownership, all cardinal widening registrations and retained
custom versus required setbacks, plus split source origins and fingerprints.

The parent persistence wrapper passes `savedDocumentText?: string|null` to
`NativeDesign` after successful load/save (`JSON.stringify(saved.document)` or
`null`). Unload/import checks compare the current committed export against that
baseline, independently retaining the shared inspector/programme pending-draft
warning. A delayed Save response cannot clear later edits. The native import
preflight rejects model-valid drawing-only contexts without complete editor
inputs on every floor before touching the current controller/cache.

The native toolbar provides bounded zoom/fit and real browser fullscreen.
Zoom changes only the SVG viewBox; the original `getScreenCTM()` pointer mapping
retains destination validation. The isolated JSON browser probe exercises real
resize preview, Escape, release and exact Undo while zoomed/fullscreen.
`tests\native-design-split-browser.js` compares A and B against the incumbent
split packer and verifies selected-plate provenance; typed tests separately
verify account Site split origin translation.

### Geometry derivation

1. Read the selected floor plate from Plot Planner, retaining any explicitly
   enabled custom/non-compliant setback scenario.
2. Convert configurable front, side, and rear external corridors to metres.
3. Build a rectangular dwelling shell beside the configured corridors.
4. Subtract configurable external-wall thickness to obtain the room core.
5. Place lift/stair footprints inside the core; they may reserve space inside
   ordinary rooms rather than occupy a fixed external service strip.
6. Pack the ordinary rooms and subtract service reservations from their usable
   floor regions, including the service-wall footprints.
7. Derive flex/passages, circulation openings, windows, furniture, and
   checklists.

Default wall inputs are 10 in external and 5 in internal, with guarded ranges
of 4-18 in and 2.5-12 in. Wall changes alter real geometry, not only labels.

## Room requests

Supported requests are living/dining, bedrooms, kitchens, bathrooms, pooja
rooms, balconies, lifts, and dog-legged staircases. Other than the starter's one
bedroom, one kitchen and two bathrooms, quantities start at zero. The sidebar
exposes fixed dimensions or min/max width and depth ranges,
depending on the room type.

The full room tile supports drag/drop onto the plan. Clicking the tile adds one
item; the separate right-hand arrow is the only expand/collapse target for its
quantity and dimension controls. Both actions are keyboard buttons, and editing
expanded fields never adds a room. A drop first tries the indicated point, then
searches nearby valid generated positions.

Furniture/opening tiles support full-tile dragging or click-to-select followed
by a click on a compatible room/wall in the plan. The chosen tile indicates its
pressed state. Escape, project changes and workspace navigation cancel pending
placement; input-field Escape keeps its ordinary field behavior.

## Packing and editing

Room quantities and numeric programme/default-size fields are unapplied drafts
while typing, including blank or incomplete values. **Apply** or Enter validates
the pending batch and records one project edit; leaving a field does not apply
it. **Discard** keeps the saved values. Drafts retain their project/floor owner,
and changed saved values require explicit review. JSON export and browser Save
contain committed values, not unfinished text.

Use `HomePlannerRoomInputs.readCommitted/readNumber/readCount` for committed
numeric settings and `writeCommitted` for deliberate legacy actions. Direct
`input.value` is the displayed draft, not the project's accepted programme.
Quantity/default-size edits within an unchanged floor envelope preserve existing
room/furniture placement. Wall/corridor changes still change the available
physical envelope and need layout review.

The automatic planner uses deterministic rectangle packing with scoring for:

- Fit and non-overlap between ordinary rooms and between service reservations.
  A lift or staircase may reserve space within an ordinary room.
- Requested room ranges.
- Exterior exposure when passive design is enabled.
- Adjacency and bathroom assignment.
- Reachable internal circulation.
- Vastu preferences only when explicitly enabled.

Rooms can be moved and resized from all four edges. Manual snapshots are restored
directly without rerunning the whole room generator first. Adding a room keeps
the existing room/furniture dimensions and positions and searches space only for
the new request; if it cannot fit, it remains explicitly unplaced. **Reset to
suggested layout** is the explicit whole-layout regeneration action.
Already-visible furniture is snapshotted before moving a room or service. A
newly freed space does not silently spawn previously missing starter furniture,
and a new room does not reset existing component dimensions. Conflicting saved
items remain visible for relocation rather than being replaced by catalogue
defaults.
Restoration also preserves omitted pin/head-direction metadata; a retained
item needing relocation is not silently pinned or assigned a confirmed head
direction.

A drag shows a temporary
footprint and validates its **destination**, not a collision-free travel path.
A kitchen can therefore jump past a bedroom into a free destination. Intermediate
red previews do not alter geometry; releasing in a valid location commits once.
An invalid release or Escape keeps the previous placement.
Undo and Redo are directly available in the drawing toolbar, including fullscreen.
The same toolbar exposes **Edit**, **Add door**, **Add window**, **Wall ends**
and **Delete** for the selected eligible object. These call the shared
inspector requests also used by 3D; they do not create a second edit/history
path. Deletion opens the existing confirmation, and wall-end controls operate
within the original supported partition span. Wall-hosted window actions
support eligible internal or exterior hosts; the older room-edge palette
retains its exterior-only placement behavior. Unavailable actions explain the
required selection rather than altering another object.

**Import JSON** and **Export JSON** reuse Projects & backups for the complete
project, including inactive floors and dimensions. Import retains the existing
validation/confirmation flow; this is not a separate lossy layout-only format.

Lifts and staircases use the same free X/Y movement and resize controls inside the
dwelling, including their complete physical wall footprint. There is no forced
corner or corridor-end snap. Service footprints may overlap ordinary rooms, but
not another lift/stair footprint. The original host rectangle remains editable;
its usable area and drawing fill exclude the reserved region. A fully reserved
room remains visible in the schedule with zero usable area and a warning.

New/suggested staircase blocks put their long side parallel to the road/frontage
(the local X direction). Existing manual orientations are not forcibly changed.
New staircase requests use an **open staircase** profile: the plan draws
schematic flights, tread marks, a landing and an UP direction, not an automatic
room door or generated masonry enclosure. The symbol is not a measured riser/
tread schedule. Older saved enclosures are retained until explicitly changed
in the stair properties; changing the enclosure preserves the footprint and
other rooms. Authored door sources are retained for review if their host is
removed, rather than silently deleted.

The staircase palette supplies an **Along-stair passage width** in feet, default
3 ft as an explicit design assumption, not a certified minimum. Selecting a
stair shows an unfilled advisory side guide and a bounded clearance at its
entry end. The side guide is not another room, does not deduct area and does
not exclude furniture or lock a whole circulation flex-space. A crossing room
boundary still needs review; no partition is silently removed to form a corridor.
A width of zero disables the requested guides.

New lift proposals prefer a position beside the staircase's shared access
passage, with a passage-facing edge, rather than occupying the path in front of
the stairs. Stairs are proposed before lifts when both are added together.
Adding a lift to an existing plan keeps the stair, other rooms and their
dimensions fixed. The full lift footprint must stay clear of the bounded
stair landing approach during placement, movement and resizing, not an entire
generic surrounding passage/flex rectangle. A blocked destination is rejected without
shifting the passage or changing the saved geometry. Adjacency is a proposal
preference, not a fixed corridor snap; users can still choose another valid
interior position. This does not verify a lift landing, door clear width or
an engineered escape route.

Saved corridor-based service positions which do not fit the current dwelling
are not displayed as valid. The preview uses an interior suggestion where it
fits or leaves the service unplaced, and reports the change. The previous
manual-layout record remains available until the user edits or resets it.
Saved furniture covered by a new reservation is retained for relocation rather
than silently deleted; new placement cannot occupy reserved space.

Balconies retain their facade/projection rules. Ordinary rooms still cannot
overlap one another or create the prohibited pooja-bathroom adjacency.

Circulation failures caused by a multi-step manual edit are reported instead
of always blocking the first intermediate move. This lets the user rearrange
several rooms and then repair access.

## State model

The [shared project](project-model.md) now owns independent floor slices and
effective physical walls/openings. The existing room generator remains an
adapter: each floor retains its controls, road widths/units, split direction,
manual-layout map and captured geometry. Floor elevation comes from the ordered
storey heights, not the regulatory balcony-rule selector.

The [editor](editor-workspace.md) adds selection, explicit bed-head polarity,
door hinge/swing controls and conceptual open partitions. Automatic bed placement
prefers geographic South, West, East, then North; manual/pinned choices are not
silently replaced. Both the plan's rotation handle and keyboard R use the same
project command as the inspector.

Projects can be exported/imported as JSON or retained through opt-in
[IndexedDB persistence](local-persistence.md). With persistence off, edits remain
memory-only unless explicitly exported. Local storage is not an independent
backup.

The light/dark theme is persisted separately in browser
`localStorage` under `ghmc-hmda-theme`.

## Balcony and service rules

- Non-high-rise balconies remain inside the statutory envelope.
- An eligible high-rise floor at least 6 m above ground may use the modelled
  Rule 7(a)(xiv) projection, capped at 2 m and the available setback.
- Lifts and staircases reserve dwelling-core space rather than external corridor
  space. The host room's net area excludes the full service footprint; service
  clear area is counted separately, not twice.
- Service access may use a corridor or a valid internal connection. Missing
  access remains an explicit issue, without forcing a service to another corner.
- These rectangular reservations are not engineered shafts, treads, landings,
  floor openings or headroom/escape certification.

## Viewport

The SVG plan supports 50-300 percent zoom, Fit, Ctrl+wheel zoom, scrolling,
keyboard zoom, and fullscreen with a maximized fallback. Fullscreen keeps the
same live Rooms & Services / Components pane docked on the right. Geometry
remains in a fixed viewBox; screen coordinates are transformed back to plan
coordinates for accurate dragging at every zoom level.
Touch gestures beginning on the drawing are reserved for object editing so the
browser does not cancel a room drag to scroll the page. Use the surrounding page,
viewport scrollbars and zoom controls for navigation.

Clicks and focus are distinct from dragging; a drag threshold avoids moving an
object during inspection. Escape/pointer cancellation discards an unfinished
gesture. The inspector stays in the same right-hand pane in fullscreen.
The optional [3D view](three-dimensional.md) reads the same floor scenes and
does not own another editable layout.
