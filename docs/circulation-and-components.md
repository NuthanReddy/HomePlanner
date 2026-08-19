# Circulation, openings, and components

## Internal access model

The planner creates an access graph after room placement:

- Living/dining receives the dwelling entrance.
- Ordinary rooms connect to living/dining or a reachable internal
  passage/flex space.
- The perimeter corridor is entry-only for the dwelling; it is not used as a
  fake detour to make internal rooms appear connected.
- Bathroom 1 is the common bathroom and must open to reachable internal
  passage/flex space.
- Later bathrooms are assigned one per bedroom as ensuites.
- A bedroom receives at most one ensuite.
- Requests above one common bathroom plus one per bedroom remain unplaced and
  are reported.
- Lifts and stairs overlay the side-corridor band and open to its remaining
  side/front/rear circulation, never through the home. Their occupied area is
  deducted from corridor/service totals once; compliant unobstructed widths
  still require professional design.

Shared-wall openings use the actual overlap segment. Small gaps up to one
internal-wall thickness may be bridged when packing has left a wall module
between otherwise adjacent spaces.

## Furniture components

| Component | Allowed rooms | Editing |
|---|---|---|
| Bed | Bedroom | Move, rotate, delete |
| Cupboard | Bedroom, living | Move, resize, rotate, delete |
| Sofa | Living | Move, rotate, delete |
| Dining table | Living, kitchen | Move, rotate, delete |
| Study table | Bedroom, living | Move, rotate, delete |
| Chair | Living, bedroom, kitchen | Move, rotate, delete |
| Kitchen counter | Kitchen | Move, resize, rotate, delete |

New-item dimensions are read when the item is added. Changing a component
default does not resize furniture already on the plan.

## Doors and windows

Door and window components are dragged to a room wall and snapped to the
nearest valid segment.

- Custom doors require a valid internal or access relationship.
- Custom windows are restricted to exterior room walls.
- Window width/height and door width come from the active component controls.
- A custom window replaces generated windows for that room so manual or
  checklist-driven exposure decisions remain authoritative.
- Custom openings survive re-rendering in the current in-memory layout.
- Each custom opening has an SVG delete control.

Window targets use effective openable area:

| Window type | Operability |
|---|---:|
| Casement | 90% |
| Two-pane sliding | 50% |
| Three-pane sliding | 67% |

Gross glazing area and effective openable area are reported separately.

## Open-plan connection

The **Open-plan connection** component represents a deliberate wall opening,
not a door leaf.

Valid direct use:

- Remove the shared partition between living/dining and kitchen.
- Open a room partition onto a usable internal passage/flex space.

If living and kitchen face the same internal passage instead of sharing a wall,
the planner creates a grouped pair of passage-facing openings so the three
spaces read as one open-plan zone. Deleting either member restores the complete
group. Exterior walls cannot be removed.

## Keyboard and pointer controls

- Drag a room/component to move it.
- Drag a room edge, cupboard edge, or kitchen-counter edge to resize.
- Use arrow keys for incremental movement.
- Use Shift+arrow on resizable furniture to resize.
- Press `R` on furniture to rotate 90 degrees.
- Press Delete/Backspace on deletable furniture or custom openings to remove.
- Use the red SVG control to delete and the blue control to rotate.

"Clear added components" removes custom furniture, doors, windows, and wall
openings while leaving the requested room program available for regeneration.
