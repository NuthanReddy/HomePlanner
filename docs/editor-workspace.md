# Selection inspector and independent floors

`planner-editor.js` is a plain JavaScript feature module. It initializes as soon
as its mounting elements and `window.HomePlanner` are available. It does not
replace the plan renderer, register plan drag handlers, maintain editable copies
of scene geometry, or introduce a framework, network request or storage service.

## Integration

The coordinator must include `planner-editor.css` and load the scripts in this
order, after the existing application startup:

1. `planner-model.js`
2. `planner-bridge.js`
3. `planner-editor.js`

Provide these existing mounting elements:

| Selector | Purpose |
| --- | --- |
| `#plannerInspector` | Inspector inside the **same** `.component-pane` that moves into normal, native-fullscreen or pseudo-fullscreen views. |
| `#plannerProjectTools` | Floor selector, independent-floor actions and edit history above the plan. |
| `#plannerPersistence` | Not used by this module; persistence controls belong to their separate feature. |

Missing bridge methods produce a visible initialization error instead of an
apparently functional but disconnected inspector. `HomePlanner.subscribe` is
registered once, with an explicit initial render. The optional
`window.HomePlannerEditorInstance.render()` refreshes the interface;
`.destroy()` removes the subscription and document history-key listener.

The inspector includes its own compact Undo/Redo buttons so those actions remain
available when only the component pane is moved into fullscreen. The module does
not move or clone that pane.

The 2D canvas toolbar's `#roomUndo` / `#roomRedo` use the same
`HomePlanner.undo/redo/canUndo/canRedo` contract. The 3D toolbar must expose
equivalent visible shared-history controls; it must not introduce a private
3D history or require opening the property inspector just to reverse a move.
Standalone inspector controls remain the fallback, while the consolidated
workspace may hide duplicate inspector buttons outside fullscreen.

Useful integration/test selectors:

- `#hp-editor-selected-kind`, `#hp-editor-selected-id`
- `#hp-editor-object-select`
- `#hp-editor-floor-select`, `#hp-editor-floor-name`, `#hp-editor-floor-height`
- `#hp-editor-floor-allowance`
- `[data-hp-editor-field="x"]`, `"y"`, `"w"`, `"h"`, `"headLocal"`, `"pinned"`,
  `"hinge"`, `"swing"`, `"widthM"`, `"sillM"`, `"headM"`, `"heightM"`,
  `"openFraction"` within the corresponding inspector
- `[data-hp-editor-action="undo"]` / `"redo"` in either mount
- `[data-hp-editor-action="add-floor"]`, `"duplicate-floor"`, `"delete-floor"`
- `[data-hp-editor-action="delete-room"]` in the selected-room inspector
- `[data-hp-editor-action="delete-balcony"]` in the selected-balcony inspector
- `[data-hp-editor-action="delete-wall"]`, `"review-trim-wall"` for internal partitions
- `[data-hp-editor-action="configure-door"]` / `"configure-window"`, then
  `"add-door"` / `"add-window"` for wall-hosted apertures
- `#hp-editor-wall-span`: `full`, `partial`, `to-end`;
  `#hp-editor-retainedStartM`, `#hp-editor-retainedEndM`
- `[data-hp-editor-readout="remaining-wall-span"]`
- `#hp-editor-new-opening-offsetM`, `-widthM`, `-heightM`, `-sillM`,
  `-headM`, `-openFraction`, `-hinge`, `-swing` for staged placement
- `[data-hp-editor-action="review-open-wall"]`, `"review-restore-wall"`,
  `"confirm"`, `"cancel-confirmation"`

All stylesheet selectors are scoped to `hp-editor` classes and use the
application's existing theme variables and system-font stack.

## Selection, numeric edits and focus

Room, balcony, furniture, door, window and wall selections use the bridge's stable
`{kind, id}` reference. The object chooser is a click/keyboard alternative for
small or overlapping plan elements. Electrical selections are identified but
direct users to the separate Electrical workspace.

Selections from a stacked 3D view may belong to a non-active storey. A read-only
`getScenes()` lookup identifies that storey without switching floors or editing
its geometry. The inspector retains the shared selection ID, names its floor
and offers a button that focuses the ordinary active-floor selector. Choosing a
floor remains an explicit user action.

An empty inspector explains how to click a room, component or wall. Invalid
geometry, deleted IDs and unresolved opening hosts have explicit states. A
missing host disables opening edits without hiding the retained attachment.
The inspector displays matching scene diagnostics even when an unresolved
opening is excluded from active scene apertures but retained in the project.

- Room/furniture X, Y, width and depth are building-local **metres**.
- Enter, change or blur commits a modified field, once. Typing alone does not
  execute geometry commands. Escape discards a field draft.
- Empty, incomplete, non-finite, unit-bearing and out-of-range numbers are
  rejected before command execution. There is no implicit zero or clamping.
- Edits merge only the committed coordinate into the **latest** scene rectangle;
  unrelated coordinates changed by another control are not overwritten.
- Rejected bridge commands display their message locally and retain the draft.
- Same-selection scene events retain input DOM nodes, focus, caret and drafts.
  On an actual selection/type change or deletion, any focus inside removed
  property controls moves to the persistent inspector heading. Inspecting an
  object never automatically focuses a text field.
- Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y use bridge history only outside
  inputs, selects, textareas and editable content. Native text undo, arrow keys,
  Delete and composing input are not hijacked.

Controls use native buttons, labels, fieldsets and number inputs, visible focus
rings, local error feedback and live status messages. Confirmation panels are
in-app groups, not browser dialogs. Their Cancel button or Escape cancels the
pending action. No document-wide arrow/Delete or SVG pointer handlers are added.

## Components and physical partitions

### Rooms

**Delete room** opens a confirmation naming the selected room. Confirmation
issues one `delete-room` command with `confirmRemoval: true`; it decrements that
room type's quantity, removes its room-owned furniture/openings, and clears the
selection. Surviving room identities and saved positions remain unchanged.
Undo/Redo restores the complete edit, and other floors are unaffected.

Source IDs are not reused after a deletion. The optional per-floor
`legacy.roomIdentities` record retains active IDs and the next suffix so deleting
Bedroom 2 does not relabel Bedroom 3 or attach old records to a new bedroom.
Independent electrical, authored structure and annotation references remain
repairable, not automatically deleted/rehosted. An adjoining bathroom is not
silently deleted or reassigned; lost access remains an explicit layout issue.
Project JSON and local saves retain the same identity state.

Direct room/component/wall/opening commands verify that all unrelated room
IDs, clear rectangles and wall-centreline modules remain unchanged after the
adapter renders. A room move may change only its selected room footprint;
deleting a room may remove only that room. Unexpected regeneration/repacking
is rejected and the transaction rolls back rather than accepting a new layout.
Reserved staircase/lift moves may legitimately update host `usableRegions`,
net areas and physical wall cutouts without moving the host's editable
rectangle; those derived changes are not mistaken for a room re-layout.

Undo/Redo verifies the recorded room, balcony, furniture and aperture geometry
after restoration. A renderer that substitutes a newly packed suggestion
cannot silently replace the saved history snapshot; the current project,
selection and history entry remain available after a failed restore.
Re-entrant Undo/Redo from a command's render notification is rejected.

Room-sector preferences are suggestion-only: kitchen SE, bedrooms NE/NW and
bathrooms South/West do not add hard snapping or travel-path checks to manual
moves. Room position preferences are separate from a bed's actual head
polarity, which still supports all four stored directions.

### Beds

The inspector displays the actual `headLocal` value and geographic bearing
derived from that value plus `scene.headingDeg`. It never infers a head from the
bed's aspect ratio, including square beds.

Selecting N/E/S/W submits `update-furniture` with the explicit `headLocal` and
`pinned: true`. The pin control shows manual/automatic-eligible state.
“Reorient head +90°” delegates to `rotate-furniture`; the bridge/model own
collision checks, packing and preservation of all four polarities.

### Balconies

The object chooser and the legacy plan's `selectSource('balcony', sourceId)`
resolve the same floor-namespaced `scene.balconies` entity as a 3D
`select({kind:'balcony',id})` pick. **Delete balcony** names the selected
balcony in an in-app confirmation, then executes
`{type:'delete-balcony',id,confirmRemoval:true}`. The bridge updates its
programme quantity and saved layout, preserving the surviving identities and
positions. Undo/Redo, JSON import and floor duplication retain the same IDs.
New empty floors have no balcony identities or balconies.

Index adapter integration uses `roomStableIds('balcony', count)` during
`deriveRoomGeometry`, including stable labels from the ID suffix. Replacing
an array element's pixels or regenerating `balcony-${index+1}` after deletion
does not satisfy this contract. The transaction rolls back if surviving
balconies cannot retain their IDs and rectangles.

### Doors and windows

Hinged-door controls use canonical opening start/end hinge endpoints and left/
right swing relative to the host wall direction. A small read-only sketch uses
`HomePlannerModel.doorGeometry`, not a second door geometry implementation.
Swing options identify the adjoining room when the shared model's open leaf
unambiguously lies inside that room. Otherwise canonical side labels remain.
Sliding doors retain their own semantics and never receive hinge controls.

Door width, wall offset, opening height and operating open fraction are editable
through `update-door`. When supplied by the model,
requested clear width and nominal leaf width appear as separate unverified/
schematic readouts. Schematic opening width is not certified clear passage.

Window offset, width, sill, head, height and open fraction are editable. Head height is
above this floor and translates into `heightM = headM - current sillM`; no
undocumented `headM` command is sent. Changing the sill preserves opening height.
Head/height edits must fit the actual host wall.

Open fraction ranges from 0 (closed) to 1 (fully open). It is not the drawing
angle; a quarter-circle preview does not declare a door operationally open.
Glazing is not automatically an open airflow aperture.

Selecting a wall in **either 2D or 3D** exposes **Add door…** and **Add
window…**. Those buttons reveal a staged metre-based form, not a pixels-only
placement mode. Dimensions are required; a door requires explicit hinge/swing
choices. Window head minus sill becomes the actual aperture height. Add is one
canonical command/Undo entry, and selects the new opening after verifying its
physical host interval. End, height and collision failures retain the draft
and the existing project; the command does not clear generated windows or
unrelated custom openings/furniture.

`roomApplySavedOpenings` must keep wall-hosted saved records outside its
legacy fraction/clamping and generated-window replacement branches, retain
them in `plan.customOpenings`, and call
`HomePlanner.prepareHostedOpenings(g,plan,cfg)` before `preparePartitions`
and `applyOpeningEdits`. That bridge helper projects only valid apertures
into the existing legacy door/window lists for downstream consumers; missing
hosts stay saved and diagnosed. The shared scene remains authoritative for
material and visual cutouts.

### Internal walls

**Delete internal wall…** is a direct selected-wall action, available from both
view selections. It reviews and submits the existing full-height `open-wall`
semantics; it is not structural demolition or arbitrary topology authoring.

The compact connection control offers **Full retained span**, **Partial ·
enter width**, and **To wall end · exact remaining span**. Partial spans
require deliberate offset/width values; blank fields do not acquire generated
defaults. To-end requires only offset and stores `toEnd:true`, recomputing the
remaining width when the effective host changes. The remaining-span readout
shows both available width and an intentionally retained fragment. A 3.7255 m
wall with 1 m offset therefore offers an exact 2.7255 m to-end opening; typing
2.7 m deliberately keeps 25.5 mm.

**Adjust retained wall ends within the original span** provides numeric
start/end trim controls in an optional disclosure. Offsets stay relative to
the original wall start; neither the wall origin nor adjoining rooms move.
Out-of-original-span and reversed ends are rejected. End cuts are physical
full-height passages, so they cannot leave a 2D/3D ghost pier. Openings and
independent attachments in removed material stay saved/unresolved for review,
not silently moved or deleted.

Review shows the exact span and selected wall ID before executing
`open-wall` or `trim-wall` with `confirmConceptual:true`. Restoration also
requires review and `confirmConceptual:true`; it removes the complete wall
override, including trims, restoring valid original opening sources.

Exterior, protected and unclassified walls cannot be opened here. Unknown
structural status is prominently unverified, **never evidence of safe
demolition**. Both confirmation paths require professional review of structural,
fire, acoustic, service and attachment implications. An internal connection is
not automatically an outdoor inlet. Functional room labels remain.

A project revision or active-floor change invalidates an outstanding
confirmation. Geometry and attachment preservation/restoration remain atomic
bridge responsibilities; this module does not erase SVG strokes to simulate
wall removal.

## Independent floors

The tools operate only on `project.floors` and `activeFloorId`, never the opaque
legacy regulatory controls:

- Select: `select-floor`.
- Add empty layout: `add-floor`, without copying an existing floor.
- Duplicate: `add-floor` with the exact active `copyFromId`.
- Rename / storey height: `update-floor` with one validated property.
- Remove: explicit in-app confirmation followed by `delete-floor`. The last
  floor is protected both by the UI and bridge.

Displayed elevation is building base elevation plus the heights of preceding
ordered storeys. Changing storey height does not change room ceiling height.
All heights/elevations remain assumed preview inputs, not surveyed data or
structural design.

### Regulatory allowance context

The shared model supplies additive read-only `scene.regulatory` metadata:

```text
{
  allowedFloors: number | null,
  basis: string,
  source: 'legacy-optimizer',
  plateId: string | null,
  selectedHeightM: number | null,
  floorToFloorM: number | null,
  stiltParking: boolean | null
}
```

The editor reads `allowedFloors` and `basis`. Its primary label explicitly says
**optimizer floor allowance estimate**, displays the actual editable count and,
when exceeded, the number of excess schematic floors. Study layouts remain
editable; being within the numeric allowance is explicitly not construction
approval.

The model's basis identifies the legacy optimizer's selected plate, height,
road-cap and TDR inputs. Its habitable-floor estimate excludes stilt parking and
is not independently validated planning permission. The editor displays that
basis rather than presenting an unqualified legal or structural conclusion.

When there is no valid scene or the metadata is absent, the tools explicitly
state that the allowance is unavailable. They do not read `project.legacy`, infer
a cap from existing floor count, or scrape another control's text. The exported
pure `floorAllowanceNotice(count, {allowedFloors, basis})` handles exceeding,
within-allowance and unavailable cases without implying safe/approved floors.

## Validation

Run the existing Node built-in runner:

```powershell
node --check .\planner-editor.js
node --test .\tests\planner-editor.test.cjs
```

The helper tests cover strict number parsing, immutable rect updates, exact
selection identities, all bed polarities across cardinal headings, door/slider
commands, window head translation, wall protection and span validation, ordered
floor elevations, last-floor protection and text-safe keyboard shortcuts.

The direct-action slice adds:

```powershell
node --test tests\planner-direct-actions.test.cjs tests\planner-editor.test.cjs tests\planner-bridge.test.cjs tests\planner-model.test.cjs
```

`tests\planner-direct-actions-browser.cjs` runs a local fixture server and a
fresh browser context, never the user's shared page/storage. It exercises
real staircase pointer dragging with a non-mutating preview, one completed
gesture, visible canvas Undo/Redo and unchanged sibling room footprints;
real SVG wall selection, exact-to-end material, retained ends, door creation,
production 3D canvas raycast selection followed by window creation, physical
wall deletion, balcony Undo/Redo/import and inactive-floor read-only UI. Supply
the existing isolated Playwright installation via
`HOMEPLANNER_PLAYWRIGHT_MODULE`. The optional
`HOMEPLANNER_TEST_INDEX_INTEGRATION=1` stages missing parent-owned index hunks
**only in the served test response** and explicitly reports
`stagedIndexIntegration:true`; such a run does not prove those hunks are
installed in the working `index.html`.
`indexStaging` lists each staged integration, including an optional missing
`planner-drafts.js` load before persistence/workbench consumers. That
cross-page dependency must be installed by its owner before an unstaged
application run can pass.

### Rotation adapter integration

`rotate-furniture` remains the single bridge command for both views and one
Undo entry. The legacy rotation helper should test the pivot-centred rotated
candidate first, then seek the nearest valid destination in the same room
when blocked. Build candidate X/Y coordinates from the room bounds, the
clamped pivot position, and the edges of other furniture plus
`roomFurnitureClearances` (including full service reservations and door
sweeps). For each blocker, the useful contact coordinates are its near edge
minus the rotated size and its far edge. Combine and deduplicate in-bounds
coordinates, order by squared distance to the pivot candidate with stable
X/Y tie-breakers, and validate through `roomEditableError` (or
`roomFurnitureCandidateValid` against a plan excluding only the rotating
item). Include current placement/wall candidates as appropriate for the
existing door-sector screening. Never validate the travel path.

Do not mutate or commit while searching. Commit the first accepted
destination once, retaining source ID, room, pin state and actual bed
head progression. If the bounded search finds no valid destination, report
that limitation and retain the entire old layout; do not promise an
exhaustive packing/accessibility solver or silently move other furniture.

`tests\planner-editor.test.cjs` also exports the optional self-contained
`browserSmoke(page, repositoryDirectory)` runner for the existing Playwright
environment. It creates and closes its own browser page, uses a contract-shaped
in-memory bridge fixture, and adds no npm dependency or test server. It checks
actual initialization, focus/draft preservation, single commits, displayed
errors, component controls, safety confirmations, floor operations, history
shortcuts, invalid/deleted/unresolved selection, pane moves and a narrow viewport.

Full packing, 64-way door geometry, physical attachment reconciliation and real
native-fullscreen integration remain in coordinator/model integration tests;
the editor smoke fixture does not claim to validate those implementations.
