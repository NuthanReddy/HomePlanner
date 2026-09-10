# Room Planner architecture

## Purpose

The Room Planner turns the currently selected whole-plot or split-plot
buildable envelope into a deterministic, editable schematic. It begins empty;
the user adds only the rooms and services required.

## Geometry pipeline

1. Read the selected legal floor plate from the Plot Optimizer.
2. Convert configurable front, side, and rear external corridors to metres.
3. Widen the side-corridor band when needed to contain requested lifts and
   stairs.
4. Overlay lift and stair blocks at the ends of that corridor band rather than
   reserving a separate service bay.
5. Build a rectangular dwelling shell beside the corridor.
6. Subtract configurable external-wall thickness to obtain the room core.
7. Pack requested rooms and reserve internal-wall modules.
8. Derive flex/passages, circulation openings, windows, furniture, and
   checklists.

Default wall inputs are 10 in external and 5 in internal, with guarded ranges
of 4-18 in and 2.5-12 in. Wall changes alter real geometry, not only labels.

## Room requests

Supported requests are living/dining, bedrooms, kitchens, bathrooms, pooja
rooms, balconies, lifts, and dog-legged staircases. Each quantity starts at
zero. The sidebar exposes fixed dimensions or min/max width and depth ranges,
depending on the room type.

Room-library grips support drag/drop onto the plan. Clicking a grip is the
touch/keyboard fallback and adds one item. A drop first tries the indicated
point, then searches nearby valid generated positions.

## Packing and editing

The automatic planner uses deterministic rectangle packing with scoring for:

- Fit and non-overlap.
- Requested room ranges.
- Exterior exposure when passive design is enabled.
- Adjacency and bathroom assignment.
- Reachable internal circulation.
- Vastu preferences only when explicitly enabled.

Rooms can be moved and resized from all four edges. Balconies move along the
facade. Lifts and stairs remain over the side-corridor band; stair movement is
end-snapped. Manual edits enforce boundaries, room/component collisions, wall
modules, pooja-bathroom separation, and relevant service constraints.

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
- Lift and staircase doors open only to the remaining external corridor.
- Lift and stair areas overlap the corridor metric and are counted once.
- The displayed corridor-band width is not a claim that the full width remains
  unobstructed beside a service block.

## Viewport

The SVG plan supports 50-300 percent zoom, Fit, Ctrl+wheel zoom, scrolling,
keyboard zoom, and fullscreen with a maximized fallback. Fullscreen keeps the
same live Rooms & Services / Components pane docked on the right. Geometry
remains in a fixed viewBox; screen coordinates are transformed back to plan
coordinates for accurate dragging at every zoom level.

Clicks and focus are distinct from dragging; a drag threshold avoids moving an
object during inspection. Escape/pointer cancellation discards an unfinished
gesture. The inspector stays in the same right-hand pane in fullscreen.
The optional [3D view](three-dimensional.md) reads the same floor scenes and
does not own another editable layout.
