# Validation status and limitations

## Verified application behavior

- Embedded JavaScript parses successfully.
- Static HTML IDs are unique.
- The initial Room Planner state contains no rooms or services.
- Room-library drag/drop and click-to-add create user-requested rooms.
- Configurable wall thickness changes the actual room core.
- Custom windows and other manual openings survive re-rendering in the current
  session.
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
- Daylight, glare, thermal, airflow, or energy simulation.
- Automated code compliance beyond the explicitly modelled rules.

Room plans are schematic and require an architect and engineers before use.

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

- Planner layouts are memory-only and clear on page reload.
- Theme preference persists through `localStorage`.
- Undo restores the complete snapshot before the most recent successful
  checklist fix, including room controls and all manual layouts.
- Because undo is snapshot-based, unrelated edits made after that fix are also
  reverted.

