---
name: homeplanner-ergonomics
description: "Use for HomePlanner requests such as 'check furniture clearance', 'review circulation or reach', 'check a door swing', 'review lift or stair access', 'make drag controls accessible', or 'fix keyboard focus'. Covers evidence-scoped physical placement and interaction accessibility without claiming clinical or code certification. Route layout/topology changes to homeplanner-architecture and printed clearance findings to homeplanner-drawing-exports only as needed."
---

# Ergonomics and accessible interaction

## When to use
- Screen furniture use, approach space, reach, door operation, circulation and service access using supplied physical inputs.
- Review Room Planner pointer, keyboard, focus, disclosure and numeric-edit workflows.
- Use `homeplanner-architecture` only when the remedy changes layout/geometry contracts, and `homeplanner-drawing-exports` when the finding must appear on a sheet. Route device-specific electrical or other discipline design to its matching installed specialist, not every package.

## Repository anchors
| Owner | Actual entry points and limits |
| --- | --- |
| `index.html` | `roomFurnitureClearances`, `roomOpeningClearance`, `roomFurnitureCandidateValid`, `roomEditableError`, `roomCirculationAnalysis`, `roomReservationHostOpenings`: placement/access screening, not an accessibility solver. |
| `index.html` interaction | `roomDecorateLibraryItems`, `initRoomLibrary`, `initComponentPalette`, `initRoomEditing`, `roomPointerLocal`, `roomMoveCandidate`: tile add/disclosure separation, click placement and destination previews. |
| `planner-model.js` / `HomePlannerModel` | `buildScene`, `doorGeometry(opening, wall)`, `wallPoint`; canonical opening metadata, real hosts and schematic hinge/swing geometry. |
| `planner-regions.js` / `HomePlannerRegions` | `intersection`, `subtractRectangle`, `area`, `reservationBounds`; usable-floor and wall-inclusive reservation comparisons without a duplicate geometry engine. |
| `planner-editor.js` / `HomePlannerEditor` | `init`, `numberValue`, `selectionEntity`, `selectionFloor`, `rectCommand`, `openingCommand`, `isTextEntry`, `historyShortcut`; validated numeric edits, stable selection and text-safe history. |
| `planner-bridge.js` | `createController` (CommonJS); browser `HomePlanner.getProject/getScene/getDrawingScene`, `execute`, `select`, `subscribe`, `undo/redo`. Do not create a parallel interaction state model. |
| `planner-workspace.js` | `HomePlannerWorkspace.mount/navigate/getRoute/dockInspector`; one live palette/inspector through responsive layout and fullscreen, not cloned controls. |

Read [circulation/components](../../../docs/circulation-and-components.md), [Room Planner](../../../docs/room-planner.md), [editor](../../../docs/editor-workspace.md), [project model](../../../docs/project-model.md) and, for device reach, [electrical placement checks](../../../docs/electrical-planning.md).

## Required inputs
- Current project/revision, active floor and exact room/component/opening IDs; requested activity and whether this is physical review, UI review or both.
- Applicable country/local authority, occupancy/use, new work versus alteration, governing document and edition. Confirm applicability before applying a regulatory threshold.
- Supplied functional dimensions: furniture footprints and opening/use envelopes, approach direction, intended clear route/turning space, relevant heights, reach interval and obstacles. Request functional needs, not diagnoses or identity.
- Door type, actual host, hinge/swing, nominal leaf, frame/stops/hardware and any measured clear opening. Unknown evidence remains unknown.
- Stair/lift access intent and supplied landing, level, headroom, cabin/shaft and opening information. A rectangular reservation does not supply these details.
- For interaction changes: affected control, keyboard/pointer/touch paths, current focus/draft behaviour, relevant viewport/fullscreen state and expected cancellation/Undo.

## Workflow
1. **Define the claim before measuring.** Separate an application heuristic, user-requested clearance and applicable legal requirement. Record each threshold's source/edition and measurement convention. Without an applicable basis or supplied dimensions, report an unknown and the needed evidence; do not silently apply a universal minimum.
2. **Read the active authored plan through its shared scene.** Use `getScene()` or the captured `getDrawingScene()` with explicit floor selection, not a stock room or optimizer plate. Preserve IDs and original authored state throughout review.
3. **Measure actual usable regions.** Use `room.usableRegions ?? [room.rect]`; an empty array stays empty. Exclude full wall-inclusive lift/stair reservations, not only their clear carpets. A broad-phase rectangle can locate candidate conflicts but cannot prove usable connected space.
   - Ordinary-room overlaps and service/service footprint overlaps remain invalid. Service/ordinary-host overlap is deliberate reservation semantics.
   - Assess approach, turning, circulation bottlenecks and furniture operating envelopes separately. A connected room-access graph does not prove traversable width, turning clearance, reach or step-free access.
   - An editor move may jump past obstacles into a valid destination; a person's circulation route cannot. Do not confuse drag travel validation with physical access review.
4. **Evaluate door use honestly.** Reuse `HomePlannerModel.doorGeometry` relative to the oriented host wall. Hinge endpoints and left/right swing are not screen-direction guesses.
   - `requestedClearWidthM` is a target; `widthM` is the schematic aperture; `nominalLeafWidthM` supplies the nominal leaf/glyph radius. `clearWidthVerified:false` must not become a pass.
   - A nominal leaf width or quarter-circle glyph is not measured clear passage. Frame, stops, hardware, opening angle and approach affect the review. Never subtract a universal frame allowance.
   - The 90° glyph is independent of `openFraction`; sliding doors have no hinged sweep. Check sweep and relevant vertical bands using supplied geometry; rectangle-only clearance helpers are conservative screening, not exact swept-volume certification.
5. **Review use and reach.** Test the supplied functional approach and operable-part location, not a device plate's centre/bottom by substitution. Unknown heights, knee/toe space, cupboard travel, transfer space or counter obstruction prevent a verified conclusion.
   - Keep stairs/lifts freely placed inside the dwelling with their complete reservation. Review access and landing intent separately; do not force a corner or corridor anchor.
   - Missing landings, shaft/cabin clearances, rise/run, headroom, handrails, floor penetrations and escape provisions remain design questions. Do not invent treads or certify a service from a bounding box.
6. **Provide equivalent interaction paths.** Preserve the room tile's add action and full-tile drag; only the separate right arrow expands/collapses settings. Editing expanded fields must not add a room. Maintain native buttons, accessible names, `aria-expanded/controls`, selected-component `aria-pressed` and visible focus.
   - Keep component click-to-select then click-on-compatible-host placement alongside drag. Keyboard support alone is not the single-pointer, no-drag alternative required by WCAG 2.5.7.
   - Use the existing object chooser, numeric inspector and scoped keyboard controls. Preserve caret/drafts on same-selection updates; move focus to the persistent inspector heading when controls disappear.
   - Commit numeric changes once on the existing commit path; typing is not a geometry transaction. Invalid input is not zero or silent clamping. Escape cancels the draft/gesture without destroying other edits.
   - Do not install document-wide Delete/Backspace. Gate new shortcuts with `isTextEntry`, composition/default-prevented checks and intended focus scope. Text fields, editable ancestors and native text Undo retain their keys.
7. **Propose the smallest reversible remedy.** Show the conflict, evidence and alternatives before changing the project. Accepted edits use existing bridge commands and shared destination checks; preserve unresolved hosts, user positions and saved floors. Re-score the same scoped finding rather than claiming an aggregate accessibility pass.

## Do not do
- Do not equate ADA with Indian requirements or assume a cited overseas threshold applies to a private dwelling. Recheck jurisdiction, occupancy and edition, including exceptions and measurement conditions.
- Do not reproduce copyrighted standards/tables; cite and briefly summarize applicability. Public explanatory guidance is not a substitute for the governing document.
- Do not provide clinical recommendations, diagnose users, or claim certified accessibility from placement screening.
- Never store personal health, disability or identity data in memory, skills, committed fixtures or reusable examples. Keep voluntarily supplied functional measurements task-scoped; tests use synthetic data. Do not send project/user data to external research tools.
- Do not hide unknowns with bounding-box passes, infer clear opening from nominal leaf size, erase service reservations or hijack text-field Delete/Backspace.

## Validation
Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-ergonomics\scripts\example.py --check
```

Select the smallest affected boundary from the repository root:
- Numeric controls, text-safe history and tile semantics: `node --test tests\planner-editor.test.cjs tests\room-palette.test.cjs`
- Physical openings and reservation deductions: `node --test tests\planner-model.test.cjs tests\planner-reservations.test.cjs`
- Destination movement/service access: `node --test tests\room-movement.test.cjs`

For UI changes, additionally exercise the existing `browserSmoke` helpers in `tests\room-palette.test.cjs` and `tests\planner-editor.test.cjs` with isolated browser state; Node does not automatically run them. Verify click/drag alternatives, keyboard focus, narrow-screen/fullscreen controls, zoom mapping, Escape, and one-step Undo. Type and delete inside a focused text/numeric field and confirm no room/component is removed. Real assistive-technology review is separate from Node/DOM checks.

## Output contract
Provide a concise findings table: entity/floor, intended activity, supplied measurement, target with jurisdiction/edition or user basis, geometric result versus unknown, limitation, and reversible remedy. Report physical screening and interaction test results separately. List missing evidence and any professional review needed; never issue an overall accessibility/medical certification.

## Example
For a synthetic user-specified **0.90 m clear-passage target**, a door has a 0.90 m nominal leaf but no frame/hardware measurement and `clearWidthVerified:false`. Report **clear opening unknown**, not compliant or noncompliant from leaf width alone.
Use `doorGeometry` to screen its handed sweep against a cupboard and the host's remaining usable regions after a lift reservation. Flag missing approach/turning evidence separately. Offer a numeric, Undoable cupboard move as well as dragging; do not move the lift to a corridor or prevent text-field Delete.

## References
- [Verified W3C/WAI and government guidance, with applicability limits](references/sources.md).
- [Supplied clearance equations and worked calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
- [Design guidance](../../../docs/design-guidance.md), [workspace navigation](../../../docs/workspace-navigation.md), [validation limitations](../../../docs/validation-and-limitations.md).
