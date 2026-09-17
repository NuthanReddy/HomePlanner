---
name: homeplanner-project-integrity
description: "Preserve HomePlanner project data, stable identities, geometry frames, transactions, Undo/Redo, worker freshness and local persistence. Use for shared model or bridge changes, imports/exports, floor duplication, schema evolution, stale study results, save failures, and any domain change that affects multiple consumers."
---

# Project and data integrity

## When to use

Use this as the companion skill for changes to shared state, persistence,
geometry contracts, workers or cross-domain dependencies. It is not needed just
to open the web app or change unrelated prose.

## Repository anchors

- `planner-model.js`: `validateProject`, `parseProject`, `buildScene`,
  `canonicalDocument`, `inputFingerprint`.
- `planner-features.js`: optional, versioned authored records.
- `planner-bridge.js`: `createController`, `execute`, floor ownership and history.
- `planner-projection.js`: site-coordinate projections and immutable snapshots.
- `planner-regions.js`: wall-inclusive service reservations and usable regions.
- `planner-storage.js`, `planner-persistence.js`: opt-in browser persistence.
- Read [project model](../../../docs/project-model.md),
  [drawing foundation](../../../docs/drawing-foundation.md), and
  [local persistence](../../../docs/local-persistence.md) for the touched surface.

## Required inputs

Identify the project/floor IDs, current revision and content fingerprint, source
document/feature versions, affected entities and dependants, caller coordinate
frame, and the expected behavior on failure. For migrations, obtain representative
old documents and an explicit preservation/rollback policy.

## Workflow

1. Read the current command and data contracts; do not infer them from an old
   screenshot or a renderer's local objects.
2. Capture a detached before-state. Preserve unknown values, independent floor
   records, custom metadata, stable IDs and unresolved references.
3. Make authored edits through the existing coordinator. One completed gesture
   or compound operation produces one revision/history entry; previews,
   selection and navigation are not authored changes.
   Numeric room controls use `HomePlannerRoomInputs`: read committed values
   through its readers, not raw `input.value`. Apply/Enter commits the owned
   pending batch; capture, JSON, navigation and unrelated edits must not absorb
   unfinished room-setting text.
4. Validate a candidate before replacing state. A failed command restores the
   exact prior authored geometry and references, not a regenerated approximation.
5. Keep `floor` (buildable plate), `plot` (property boundary), `building` and
   room clear/usable regions distinct. Transform to the site frame once.
6. Treat `usableRegions` as the usable surface when present. Lift/stair
   reservations are not additional usable area beneath the host room.
7. Tag async requests/results with the input identity/fingerprint. Discard stale
   results after geometry, source settings, floor or project changes. Do not
   invalidate a valid study solely because an unrelated presentation view changed.
8. Keep in-memory edit success separate from browser-save success. Complete
   IndexedDB transactions before reporting saved state; retain a recoverable
   draft after quota, blocked-upgrade or revision-conflict failures.
9. Validate and stage imports before replacement. Preserve original recovery
   material; do not silently rewrite newer schemas, discard unknown fields or
   auto-merge independently edited projects.
10. Verify the affected domain's consumers using its specialist skill.

Example: after a wall split, preserve opening/annotation lineage or show a
repairable unresolved host. Do not attach records to the nearest remaining wall.

## Do not do

- Do not store editable geometry in SVG/Three.js objects as a second authority.
- Do not reset invalid documents to empty projects or turn missing input into
  zero/default success.
- Do not reuse a deleted room's ID for a new room.
- Do not equate request success, a Blob URL or a download request with a durable
  database/file save.
- Do not overwrite a user's live browser project during testing. Use an isolated
  context and controlled fixture.
- Do not auto-fetch weather, detect location, enable autosave or run expensive
  studies merely because a route or selection changed.

## Calculation and Python references

Read [the integrity equations and worked cases](references/calculations.md)
before changing tolerances, revision guards, input fingerprints or derived
dependencies. Numeric closeness, identity, current-result validity and durable
save completion are different predicates.

[Python tools and examples](references/python-tools.md) document offline
reference work without creating a second project authority. The
[standalone script](scripts/example.py) checks numeric tolerances, stable IDs,
ordered JSON, stale-result keys and a synthetic dependency graph. Its SHA-256
example is deliberately **not** the application's fingerprint implementation
or an RFC 8785 implementation.

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-project-integrity\scripts\example.py --check
```

## Validation

Choose the smallest relevant selectors, for example:

```powershell
node --test tests\planner-model.test.cjs tests\planner-bridge.test.cjs tests\planner-storage.test.cjs
```

For projection/identity changes also run
`tests\planner-phase1-regressions.test.cjs`; for reservation changes use
`tests\planner-regions.test.cjs` and `tests\planner-reservations.test.cjs`.
Cover old/new round trips, Undo/Redo, active/inactive floors, failed transactions,
same-revision divergent content, nullable fields and stale async completion.

## Output contract

Report the authored source changed, derived consumers affected, data/identity
preservation behavior, failure/recovery path and any unsupported migration.
Never describe an in-memory result as durably saved without evidence.

## References

Read [sources and applicability](references/sources.md) when changing storage
semantics, concurrency or recovery. Current repository contracts take precedence
over generic examples; upstream documentation is not proof of our implementation.
