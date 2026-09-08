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
- `[data-hp-editor-action="review-open-wall"]`, `"review-restore-wall"`,
  `"confirm"`, `"cancel-confirmation"`

All stylesheet selectors are scoped to `hp-editor` classes and use the
application's existing theme variables and system-font stack.

## Selection, numeric edits and focus

Room, furniture, door, window and wall selections use the bridge's stable
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

### Beds

The inspector displays the actual `headLocal` value and geographic bearing
derived from that value plus `scene.headingDeg`. It never infers a head from the
bed's aspect ratio, including square beds.

Selecting N/E/S/W submits `update-furniture` with the explicit `headLocal` and
`pinned: true`. The pin control shows manual/automatic-eligible state.
“Reorient head +90°” delegates to `rotate-furniture`; the bridge/model own
collision checks, packing and preservation of all four polarities.

### Doors and windows

Hinged-door controls use canonical opening start/end hinge endpoints and left/
right swing relative to the host wall direction. A small read-only sketch uses
`HomePlannerModel.doorGeometry`, not a second door geometry implementation.
Swing options identify the adjoining room when the shared model's open leaf
unambiguously lies inside that room. Otherwise canonical side labels remain.
Sliding doors retain their own semantics and never receive hinge controls.

Door width and operating open fraction are editable. The frozen `update-door`
command does **not** accept height or offset: those values are explicitly
read-only, rather than sending unsupported changes. When supplied by the model,
requested clear width and nominal leaf width appear as separate unverified/
schematic readouts. Schematic opening width is not certified clear passage.

Window width, sill, head, height and open fraction are editable. Head height is
above this floor and translates into `heightM = headM - current sillM`; no
undocumented `headM` command is sent. Changing the sill preserves opening height.
Head/height edits must fit the actual host wall.

Open fraction ranges from 0 (closed) to 1 (fully open). It is not the drawing
angle; a quarter-circle preview does not declare a door operationally open.
Glazing is not automatically an open airflow aperture.

### Internal walls

Full- and partial-span connections are explicitly **full-height** schematic
edits. Partial spans require deliberate offset and width values; blank fields
do not acquire generated defaults. Review shows the exact span and selected
wall ID before executing `open-wall` with `confirmConceptual: true`.
Restoration also requires in-app review before `restore-wall`.

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
