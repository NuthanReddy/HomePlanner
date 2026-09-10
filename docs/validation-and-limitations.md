# Validation status and limitations

## Verified application behavior

- Embedded JavaScript parses successfully.
- Static HTML IDs are unique.
- A fresh project contains no rooms or services; an opted-in browser project
  can restore its saved programme.
- Room-library drag/drop and click-to-add create user-requested rooms.
- Configurable wall thickness changes the actual room core.
- Custom windows and other manual openings survive re-rendering in the current
  project. Shared add-window recommendations preserve the existing windows.
- Open-plan living/kitchen connections create and restore grouped openings.
- Checklist fixes are re-scored, failed fixes roll back, and successful fixes
  can be undone.
- Desktop and mobile layouts keep the room library, collapsed dimensions,
  planner viewport, and checklist tables within their containers.
- Dark and light themes use the same semantic tokens for page, chart, site-plan,
  and room-plan surfaces; the selected theme is stored in browser
  `localStorage`.

## Deterministic planner limitations

The floor planner is a rectangle-packing and adjacency heuristic. It does not
perform:

- Structural grids, beams, columns, shear walls, foundations, or seismic
  design.
- Stair rise/run, headroom, landing, refuge, or fire-escape calculations.
- Lift pit, machine-room, shaft, or accessibility compliance.
- Plumbing stacks, drainage slopes, ducts, shafts, or MEP routing.
- Door swing conflict analysis at construction-detail accuracy.
- Parking-bay, ramp, turning-radius, fire-tender, or egress-width design.
- Acoustic/privacy analysis.
- Validated whole-building daylight, glare, energy, structural or CFD simulation.
- Automated code compliance beyond the explicitly modelled rules.

Room plans are schematic and require an architect and engineers before use.

## Supported analytical experiments

The Environment workspace supplies geometric solar/shadow sampling, explicit
layer resistance/capacity calculations, steady one-way pressure-network
experiments and a lumped sensible-heat RC solver. Inputs and omitted physics are
stated; they are not actual-site temperature or comfort predictions.

There is no automatic weather/airflow/solar-to-thermal coupling, calibrated
warmup, moisture/HVAC model, detailed microclimate/tree cooling, or mutual-storey
shading. All-floor exposure runs evaluate the floor scenes separately and say so.
Reference fixtures and conservation do not substitute for physical/site
calibration or professional review.

## Regulatory limitations

The tool cannot determine title, master-plan land use, approved-layout status,
Annexure-I area status, special Banjara/Jubilee Hills controls, heritage or
religious buffers, lake/FTL/nala buffers, airport funnel restrictions, local
road-widening proposals, fire NOCs, or current authority interpretations.

G.O.Ms.No.95 is represented as published in the source set used by the
application. Other scanned amendments may alter a cell or procedure. Confirm
the current gazetted rules and TG-bPASS result.

## Cost limitations

The cost result is only as current as the entered land, SRO, construction, tax,
and fee rates. Betterment is based on an older public schedule. The model does
not determine BRS/LRS eligibility and does not include the market price of TDR.

## Persistence and rollback

- With autosave off, working changes remain memory-only unless explicitly saved
  or exported. Opt-in IndexedDB and JSON backups retain whole projects, including
  independent floor state and environment/electrical records.
- Theme preference persists through `localStorage`.
- General project Undo/Redo restores bounded project snapshots, including
  multi-entity changes and floor state. View selection is not an edit.
- The older checklist-specific undo restores the complete snapshot before its
  most recent successful
  checklist fix, including room controls and all manual layouts.
- Because undo is snapshot-based, unrelated edits made after that fix are also
  reverted.
- Malformed/newer projects and browser-storage failures produce explicit
  recovery states. Imported labels are rendered as text, including blocked-move
  feedback. Unsupported hosts stay reviewable instead of being guessed.
