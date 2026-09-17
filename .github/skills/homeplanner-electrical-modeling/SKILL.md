---
name: homeplanner-electrical-modeling
description: "Use for HomePlanner electrical point modelling, socket or switch placement, mounting-height datums, wall-face hosts, device envelopes, door-swing conflicts, wet-area review, and lift/stair reservation conflicts. Triggers include 'electrical layout', 'move a socket', 'switch height', 'light host', and 'electrical placement tests'. Ground changes in the shared scene and reversible commands; distinguish spatial intent from electrical sizing, installation guidance, or professional certification."
---

# Electrical point modelling

## When to use

Use for annotation, host resolution, ergonomic coordination, point schedules, or
regressions in Electrical. A drawn point describes requested device intent, not
an installed circuit. Keep modelled quantities separate from professional certification.

## Repository anchors

Inspect the current code contracts and relevant tests before changing them; do
not treat this skill as a replacement schema or an assurance that code is unchanged.

- `electrical-planner.js`: `validatePoint`, `resolveAnchor`, `reviewPoint`,
  `verticalBand`, `mapWallAnchor`, `geometryFingerprint`, `savePoint`,
  `suggestPoints`, and `acceptSuggestion`.
- `planner-model.js`: shared `wallPoint` and `doorGeometry`; actual wall,
  aperture, nominal-leaf and floor geometry.
- `planner-bridge.js`: `getProject`, `getScene`, selection, `execute`,
  `set-electrical`, floor slices, and shared Undo/Redo.
- [Electrical contract and limitations](../../../docs/electrical-planning.md).
- `tests\electrical-planner.test.cjs`: real existing point-layer selectors and
  contract-scene/controller fixtures; do not misdescribe these as browser certification.

## Required inputs

- Active floor identity and matching scene; finished-floor elevation; physical
  wall ID, oriented endpoints, thickness, height, solid sections and openings.
- Requested point type, purpose, served room, explicit host/face/offset or
  light surface coordinates; room `usableRegions` when supplied.
- Elevation above finished floor and its datum: plate centre, plate bottom,
  operable-part centre, or mounting point. Missing heights/dimensions remain `null`.
- Actual envelope width/height/projection depth, including plug projection;
  datum-to-envelope-bottom offset where required. A reference point is not a plate.
- Contextual reach interval and approach dimensions; real furniture/headboard
  dimensions and N/E/S/W head direction; hinge/swing and door vertical dimensions.
- Water-exposure context and measurement provenance. Unknown is not dry.
  `loadCategory` is qualitative, not an ampere/watt rating. Unavailable ratings
  remain `null` in the engineering handoff; do not invent rating fields in this schema.
- Before any future engineering sizing: current jurisdiction and adopted code
  edition/amendments, actual loads and supply characteristics, installation
  method, protective-device data, and appropriate professional review.
  Stop sizing with a missing-input list rather than assuming these inputs.

## Workflow

1. **Capture and classify.** Read the active project/scene without changing
   selection, floors or geometry. Record floor identity and the geometry
   fingerprint. Separate existing-record repair from a new placement proposal.
2. **Retain identity.** Preserve IDs, other floor arrays and unrecognised existing
   metadata. Missing/removed hosts remain reviewable drafts. Reversal or explicit
   unambiguous wall lineage may resolve an anchor read-only; proximity is not lineage.
3. **Resolve the physical face.** Use the shared wall point and the supplied half
   thickness in the selected normal direction. For local x-right/y-down axes,
   the left normal of tangent `(tx, ty)` is `(ty, -tx)`. Do not rotate this overlay
   by geographic heading or place a face-mounted device on a centreline.
4. **Separate nominal and clear measures.** Room rectangles, wall centrelines,
   aperture `widthM`, `nominalLeafWidthM`, and `requestedClearWidthM` describe
   different things. Requested clear width is not measured usable clearance.
   Obtain the latch/leaf endpoint from `doorGeometry`, not aperture width.
5. **Resolve the datum and support.** Absolute point z adds
   `scene.floorElevationM + elevationM` once. Compare finished-floor-relative
   device bands with aperture sill/height bands and exact `solidSections`.
   Check the whole plate width/band, not only its centre. Missing envelope,
   aperture or host data remains incomplete; reject new unsupported mounts
   instead of clamping offsets, elevations or dimensions.
6. **Respect usable surfaces.** Floor/ceiling anchors are light-only and require
   the mounting-point datum and explicitly supplied/confirmed surface height.
   When `usableRegions` exists, membership there is required: lift/stair
   reservations are not host surfaces even inside `room.rect`. Empty or malformed
   regions do not restore the nominal rectangle. Preserve conflicting existing
   points without silently rehosting, moving or deleting them.
7. **Review access and conflicts.** Run `reviewPoint` against actual furniture,
   headboard, device and approach footprints. Use the shared full door sweep,
   known hinge/swing and relevant vertical bands. A plan overlap with unknown
   heights is unresolved, not a verified clash or clearance. A height inside a
   chosen reach interval does not prove approach, knee space or continuous access.
8. **Apply evidence boundaries.** Read source applicability before using numerical
   thresholds. E1/E2 support datum, obstruction and maneuvering reasoning, not
   universal mounting presets. Wet rooms retain professional review even when
   marked dry; appliances/high-load intent retain circuit/protection review.
   No count, rating or safety conclusion follows from room area or a symbol.
9. **Propose, then explicitly save.** Suggestions use user-requested counts/gaps,
   immutable provenance and the existing stale-preview checks. Re-resolve current
   hosts and `usableRegions` before saving; a fingerprint alone is not proof of
   present support. Use `savePoint`/`acceptSuggestion` and the existing
   `execute({type: 'set-electrical', value: points})` pathway only after user
   action. Retain unrelated records and shared Undo/Redo; selection is not a write.

### Example: a light over a reserved strip

Synthetic supplied geometry: a 4 m × 4 m room has only
`usableRegions: [{x: 0, y: 0, w: 2, h: 4}]`. Its confirmed nominal ceiling is
2.8 m above finished floor. An existing ceiling light at `(3, 2)` with
`elevationM: 2.8` and datum `mounting-point` is inside the nominal room but not
its usable surface. Expect `reserved-room-area`, no supported marker, and an
unchanged saved anchor. List an explicit rehost decision; do not move it to
`(1, 2)` automatically or claim electrical safety from either position.

## Do not do

- Do not supply wire gauges, breaker/circuit ratings, grounding/wiring instructions,
  bathroom exclusion radii or claims of code compliance/electrical safety.
- Do not infer heights, current, thermal loads, illuminance, fixture support or
  safe installation from spatial diagrams, legacy preview furniture or source examples.
- Do not remove professional/incomplete findings or turn individual `clear`
  comparisons into an aggregate pass.
- Do not create independent editable geometry in a renderer or another store;
  do not automatically mutate a user's live plan.
- Do not fetch external data without user action. Never send private repository
  code, coordinates, project data or user records to web services.

## Validation

Run the independent stdlib reference (no project reads, writes or optional engines):

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-electrical-modeling\scripts\example.py --check
```

Run the smallest real existing `node --test` selector covering the change, from
the repository root:

```powershell
node --test .\tests\electrical-planner.test.cjs
```

Check null versus explicit zero, all datums, oriented wall reversal, orphan
preservation, nominal-leaf versus aperture endpoints, vertical aperture support,
door sweep/approach conflicts, reserved `usableRegions`, and wet-room findings.
Confirm metadata edits, selection, stale acceptance, Undo/Redo and JSON preserve
records. For new behavior, extend the existing focused fixtures rather than
creating a separate model, renderer-owned geometry or an assumed standards oracle.

## Output contract

Return the scoped point/floor IDs; host and datum; supplied versus unknown
measurements; supported reference/envelope status; finding codes; source and
assumption provenance; proposed user decisions; and actual test command/results.
Identify stale/unresolved drafts and missing engineering inputs explicitly.
State that placement coordination does not establish electrical or accessibility
certification. Report unavailable standards or uncertain local adoption, not authority.

## References

[Verified primary-source notes, E1–E3](references/sources.md), checked
**17 Sep 2026**. These are methodological context, not a numeric standards preset.

- [Power/unit and supplied-envelope calculations](references/calculations.md).
- [Optional Python APIs and prerequisites](references/python-tools.md).
- [Executable stdlib reference and computed SVG](scripts/example.py).
