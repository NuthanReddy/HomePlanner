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
- Lifts and stairs can move inside the dwelling and reserve footprints within
  ordinary rooms. Their full wall-inclusive footprints are removed from host
  usable floor regions and cannot overlap another service reservation.
- Direct corridor or valid internal access is evaluated separately from free
  placement. Missing access is flagged rather than snapping the service back
  to a fixed location. Shafts, floor openings, landings and compliant escape
  routes still require professional design.
- New lift proposals prefer the side of a staircase's shared passage. Its
  full wall-inclusive footprint cannot block an existing stair entrance
  passage or the configured along-stair clearance guide. Move/resize rejection
  preserves the old plan and does not shift another room or passage to make
  space. Manual non-adjacent positions remain available where valid.

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
Rotation first tries the current centre. If blocked, it searches valid
same-room positions based on room/obstacle edges and door-sweep boundaries,
keeping the swapped dimensions and the requested head direction. It does not
rotate only in place or change another component to make room. No valid found
placement leaves the original item intact. Rotation/repositioning is one
Undoable edit.

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

- Drag a room/component to preview its destination, then release to commit.
  Objects may cross blocked intermediate positions; only the final position
  is committed. Invalid destinations or cancellation retain the old placement.
- Drag a room edge, cupboard edge, or kitchen-counter edge to resize.
- Use arrow keys for incremental movement.
- Use Shift+arrow on resizable furniture to resize.
- Press `R` on furniture to rotate 90 degrees.
- Press Delete/Backspace on deletable furniture or custom openings to remove.
- Use the red SVG control to delete and the blue control to rotate.

"Clear added components" removes custom furniture, doors, windows, and wall
openings while leaving the requested room program available for regeneration.
