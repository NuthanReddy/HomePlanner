# Local projects and JSON backups

HomePlanner can keep projects in **this browser's IndexedDB**. There is no
account, server database, cloud sync, network request or repository write in
this feature. It does not upload project or weather data.

## Using the controls

Project name, **Save now** and the single save status are in the persistent
project bar. **Projects & backups** opens management/import/autosave controls;
**Report** exposes the existing project JSON export. All are the same live
persistence controller, not separate saves.

- **Project name / Rename** changes the current project's name through the
  shared planner command API. Project IDs, not names, identify saved copies.
- **Autosave in this browser** is initially **off**. Enabling it saves the
  current project and opts in to subsequent saves. Changes are debounced for
  600 ms; overlapping writes are serialized and pending revisions coalesced.
  Selection-only events do not create saves.
- **Save now** commits a browser copy without enabling autosave. Wait for
  **Saved in this browser** before closing the page. A request's `onsuccess`
  is not treated as a committed transaction.
- **Saved in this browser / Open** loads the selected ID, including its
  inactive floors, independent floor edits, electrical points, weather
  records, analysis configuration and provenance. The list distinguishes
  checking storage, a successfully loaded empty list (**No browser projects**),
  and **Browser projects unavailable** with a visible storage error.
- **New project** keeps existing saved projects. New and Open use an in-app
  confirmation when current work is not saved **or a workbench has pending input
  drafts**. If the planner or pending fields change while a restore is waiting,
  restoration stops rather than replacing those edits.
- **Delete local copy** always requires an in-app confirmation. It removes
  only that ID, not the working layout or downloaded files. Deleting the
  current ID first turns autosave off so this tab does not recreate it.
- **Export JSON** downloads the full versioned project. Filenames are
  sanitized for Windows; Blob URLs are revoked after the download request.
  The UI cannot prove that a browser actually saved a download: verify the
  resulting file. Export does not enable autosave or mark a database save.
- **Import JSON** validates the file before replacing anything. Import gives
  the document a new project ID and an `(imported)` name, retaining its
  revision, floors and other JSON fields. Existing saved IDs are never
  overwritten by an import. Invalid JSON, unsupported schema, rejected model
  validation, cancelled reads and file-read errors leave current work intact
  and display an error. The file input resets so the same file can be retried.

`planner-drafts.js` registers session-only input drafts, not another authored
project store. The save status separately identifies pending fields that are
**not included** in a committed browser copy or JSON export. New/Open/import
confirmations account for those fields even when the model itself is already
saved. Parked drafts keep their original project/floor/record identity and return
when that owner is revisited. Before-unload protection also includes parked
drafts. They are not durable backups: explicitly apply wanted inputs first.

The remembered project is automatically opened **only on initial startup and
only when autosave was previously enabled**. A startup ID/revision/content
guard, including pending form drafts, prevents delayed loading from overwriting edits made while IndexedDB
opens. In that case the remembered project remains selected for an explicit
Open, and autosave is paused. Its checked box reflects the previous opt-in:
choose Save now to keep and resume saving the current layout, Open to restore
the remembered copy, or untick autosave to persistently opt out. Retry never
initiates another automatic restoration.

## Durability and recovery

Browser storage is **not an independent backup**. Clearing site data, browser
eviction, private browsing, profile changes or changing scheme/host/port can
remove or hide saved data. `file://` IndexedDB support and file-origin
identity vary by browser; do not assume that moving an HTML file preserves
its browser database. Keep exported JSON files separately.

When storage is unavailable or a write fails, the planner remains usable in
memory and JSON import/export remain available. Errors display their code
(for example `SecurityError`, `QuotaExceededError`, `BlockedError`,
`AbortError`, `VersionChangedError` or `RevisionConflictError`) without
printing raw browser exception messages or credentials. No in-memory
substitute is passed off as a working database. Failed autosaves are paused;
use Save now or Retry after resolving the problem.

Turning autosave off takes effect in the current tab immediately and cancels
pending writes; an already-started transaction is allowed to settle. If the
preference cannot be saved, the UI warns that the old preference may resume on
reload. No asynchronous unload save is promised. A standard before-unload
warning is requested for unsaved/saving work, subject to browser restrictions.

Unreadable/newer records remain in the database and appear explicitly as
**Unreadable**, with an error code and no fabricated empty document. Open
and save reject these records instead of resetting them. Use the app version
that understands a newer record, or retain it for recovery; delete it only
if deliberately no longer needed. A newer database version likewise fails
open without deletion or downgrade. A blocked upgrade closes any connection
that arrives after the error; another tab's upgrade request closes this
tab's old connection.

Two tabs can still represent independent edits. Read/compare/write happens
in one readwrite transaction: an older revision cannot replace a newer
stored revision, and divergent documents at the same revision are rejected.
There is no collaborative merge. Keep one editing tab per project, or export
and import a backup as a separate ID. Another independently opted-in tab can
save its own current project after this tab deletes a copy.

## Browser integration

Numeric Room Planner inputs use `planner-room-inputs.js`, loaded before inline
room initialization. The bridge captures committed values even while the UI
shows blank/incomplete drafts. Apply/Enter uses one guarded
`update-room-controls` transaction; Discard and conflict review use the shared
draft registry. Pending room inputs remain outside project JSON and saved
browser copies until applied, but are included in pending-input/unload warnings.

The coordinator owns these additions to `index.html`:

```html
<link rel="stylesheet" href="planner-persistence.css">
<!-- Put this above #plannerProjectTools. -->
<div id="plannerPersistence"></div>
```

Load `planner-drafts.js` before the workbench modules. Load `planner-storage.js`,
then `planner-persistence.js`, **after**
`planner-model.js`, existing inline startup and `planner-bridge.js`.
`HomePlanner` must already be available. The persistence UI mounts only
`#plannerPersistence`; it does not own history/floor controls or listen to
canvas gestures. CSS is scoped under `.hp-storage` and uses the app's theme
variables.

Required coordinator methods: `getProject`, `subscribe`, `execute` with
`rename-project`, `replaceProject`, `newProject`, `exportProject` and
`importProject` (the latter may fall back to validated `replaceProject`).
Snapshots must be immutable JSON, with a new revision for every content edit,
including undo. `subscribe` events with type `selection` are ignored.
The shared model's `validateProject` and `parseProject` are used when present;
false/null/error validation results are failures, not truthy success.

Missing or incomplete draft support fails with `MissingDraftsError` before
attaching project/draft listeners or opening the database. This is not an
empty-draft fallback. Load `planner-drafts.js` before its consumers and reload.
A failed DOM mount releases its subscriptions, draft store, unload handler and
pending resources, restores the host's previous nodes and leaves the planner
usable. A second mount cannot replace an already mounted controller.

Planner observers are isolated individually, including asynchronous rejection.
A failing view does not undo an accepted edit, throw a false transaction failure
to its caller, or prevent later views receiving the event. The existing bridge
status displays `ObserverNotificationError`; `HomePlanner.getObserverErrors()`
returns up to 40 frozen, session-only diagnostic records with project, revision
and event identity. Persistence has the separate
`controller.getState().observerError` diagnostic (`PersistenceObserverError`).
These are view-notification errors, not evidence that a confirmed database
transaction failed. They are also logged without raw exception messages.

Restoration is never merged into the previous project. The bridge stages the
validated candidate, restores and recaptures the adapter under its transaction
guard, verifies floor geometry and compares the complete document before
publishing a replacement. A mismatch rejects with
`RestoredSnapshotChangedError` rather than adopting a reconstructed project.
The current project, selection, Undo/Redo history and browser records are kept.
Undo/Redo also verifies full-document recapture before recording its new revision.
An adapter must not silently drop unknown same-schema fields or nulls.

New project creation is intentionally different from importing a saved snapshot.
Only `newProject()` can initialize the private startup seed through the layout
adapter. It captures and validates the generated defaults/context, then verifies
an exact restore/recapture of that initialized candidate before publishing one
project event at revision zero. Generation or verification failure keeps the
previous project, selection and history. Imports, Open and public
`replaceProject()` cannot request this initialization path or bypass exact
snapshot preservation.

Schema-1 normalization is deliberately limited: the current top-level `legacy`,
wall/door/window/furniture edits, obstacles, electrical points and
`building.wallHeightM` overwrite their **active floor's compatibility mirrors**.
Those mirrors are not independent authored copies. Other floor records,
floor order, optional fields and metadata remain unchanged. A valid missing
project name is not filled in during raw import. Browser capture preserves
unowned legacy/control/context metadata and metadata on stable-ID records;
removed room/component keys are not revived. No newer schema is guessed or
migrated. The raw bridge `importProject(text)` retains the supplied project ID;
only the persistence import flow allocates a new ID.

Authored no-ops retain the current immutable snapshot, revision, timestamp,
selection and Undo/Redo stacks and do not emit another edit. Site/building
commands may carry an optional plain-JSON `environmentPatch`; inputs and that
provenance are validated and applied in the same transaction. The existing
`set-environment` command accepts one combined patch for inputs and result
records, so an explicit Evaluate need not create two history entries.

The bridge captures the dynamically generated road widths/units and split-axis
checkbox separately from ID-bearing controls. It rebuilds dependent plot-target
and regulatory-floor options before selecting their saved values. The split
slider retains its exact fraction instead of changing its step during rendering;
keyboard nudges still follow the chosen dimension unit. This prevents a reload
or floor switch from changing plot geometry through display rounding.

`HomePlannerPersistence.mount(host, planner, options?)` returns
`{controller, requestExportJSON, requestImportJSON, destroy}`. Browser scripts mount automatically once.
`host.homePlannerPersistence` refers to the controller; the module also
exposes `HomePlannerPersistence.instance`. `destroy()` unsubscribes and
releases pending downloads/connections. CommonJS exports permit dependency-
injected controller tests without a DOM or new framework.

The mounted controller and mount handle both expose `requestExportJSON()` and
`requestImportJSON()`. A model/2D toolbar should call these methods from its button
activation, not implement another file format. Export uses the existing complete
editable-project codec, download/URL lifecycle and honest requested-download
notice. Import opens the same file picker, validates before replacement, allocates
a new project ID and uses the same in-app confirmation. A confirmation requested
outside Projects & backups opens that menu so it is visible. These methods do
not enable autosave, truncate to the active floor or replace old saved IDs.

### Opening removal in saved projects

`delete-opening` uses the shared opening identity for both generated and custom
doors/windows. It retains source records and existing edit metadata and records
`suppressed: true` in the owning floor's `doorEdits` or `windowEdits` entry.
The matching model must implement that suppression; if the physical aperture
survives compilation, the bridge rejects and rolls back the deletion.
Undo restores the source aperture and its previous edits; Redo and JSON/browser
copies retain the suppression. Unrelated openings, rooms and furniture must
stay unchanged. Suppressed sources remain in the captured project even though
the legacy view's active door/window lists exclude them. No renderer-only
deletion or reused opening ID is involved.

Closing an opening is schematic design intent, not evidence of safe construction
or preserved escape/ventilation. Protected or unclassified hosts remain guarded.
`wall.removed` reports the absence of masonry: a canonical full-span,
full-height door/window may still occupy that host. Such surviving apertures
remain editable and deletable; suppression closes the aperture and restores
the corresponding schematic wall material. New aperture placement still
requires remaining wall material. A true partition-removal passage excludes
conflicting ordinary apertures from the canonical scene, so this exception
does not enable editing/deleting unresolved attachments through a stale ID.
Internal full-height passage/partition restoration retains its separate guarded
wall semantics; this does not introduce arbitrary wall creation or movement.

## Storage API and format

`HomePlannerStorage.open(indexedDBFactory?)` returns a promise of:

| Method | Result after the transaction completes |
| --- | --- |
| `list()` | Records sorted newest first; each readable record has a validated `document`. Unreadable entries have `unreadable: true`, `error: {code, message}` and **no document**. |
| `load(id)` | Validated record below, or `null` only when the ID is absent. Invalid records reject. |
| `save(project)` | Validated committed record. The input is cloned before any asynchronous work; failures reject. |
| `remove(id)` | Boolean indicating whether a record existed. Used by the UI only after explicit confirmation. |
| `getSetting(key)` | Cloned JSON value, or `undefined` only when absent. Corrupt setting envelopes reject. |
| `setSetting(key, value)` | Committed cloned JSON value. Existing unknown/corrupt setting formats are not overwritten. |
| `close()` | Closes the connection. Further operations reject. |

Static database name: **`HomePlanner.local-projects`**. IndexedDB version:
**1**. Object stores: **`projects`**, key path `id`; **`settings`**, key path
`key`. Version 1 creates these stores only for a new database. It does not
guess migrations, reset stores or silently downgrade data.

Project record:

```js
{
  recordVersion: 1,
  id: project.id,
  name: project.name || 'Untitled project',
  revision: project.revision,
  createdAt: '2026-09-08T10:00:00.000Z',
  updatedAt: '2026-09-08T10:00:00.000Z',
  document: { schemaVersion: 1, /* entire validated project */ }
}
```

Metadata and document are one atomic record. The envelope timestamps belong
to storage, not a fabricated weather/provenance timestamp. Re-saving identical
content at the same revision is idempotent; creation time is retained.

Setting records are `{recordVersion: 1, key, value}`. The UI uses only:

- `autosave-enabled`: boolean; absent means off.
- `last-project-id`: saved project ID string, or `null` after deletion;
  absent means no remembered project. Merely selecting a dropdown option
  does not replace this preference.

JSON data must be finite, plain objects/arrays without sparse arrays,
functions, accessors, circular references or prototype-related keys.
Schema version 1 is required. File imports are limited to 32 MiB, with
additional nesting/node limits and shared-model validation. Full JSON fields
are retained rather than rebuilt from an allowlist of geometry fields.

Pure/CommonJS helpers include `cloneJSON`, `validateProject`, `parseProject`,
`readRecord`, `createRecord`, `fingerprint` and `createSaveQueue`.
The queue offers `enqueue(project)`, `flush()`, `cancel(id?)`, `forget(id)`,
`close()` and `busy`. Coalesced callers resolve with the newest queued
revision for their ID; unrelated project IDs are not discarded. Errors
reject waiters. `flush()` rejects a failed batch until an explicit new batch.
`forget(id)` is allowed only after its writes settle, for an explicit
restoration that discards cancelled, never-written queued revisions.

## Validation

Run the existing Node built-in runner:

```powershell
node --test tests\planner-bridge.test.cjs tests\planner-core-integrity-r0.test.cjs tests\planner-new-project-r0.test.cjs tests\planner-storage.test.cjs
```

Tests cover JSON/envelope validation, immutable weather/floor snapshots,
same-revision conflicts, unknown schema, transaction settlement/abort/quota
errors with scripted request events, blocked/version changes, coalescing,
initial opt-in, startup/open races, remembered restoration, read-only failure
fallback, import preservation, opt-out and explicit deletion.
R0 regressions additionally use the real command controller and the browser
module branch for observer ordering/diagnostics, no-op identity, compound
provenance, damaged recapture rollback, active-mirror normalization and failed
initialization cleanup. Synthetic adapter/store cases are labelled; a record
round-trip alone does not prove a native browser transaction committed.
`tests\planner-new-project-r0.test.cjs` also exports `browserSmoke(page)` for an
isolated production page. It replaces an edited, multi-floor disposable project,
checks actual starter controls/context and fresh IDs, and verifies that the
initialized document succeeds through the unchanged exact JSON import path.
Scripted request events test error/settlement logic; they are **not** a
substitute for native IndexedDB.

Coordinator browser coverage should use a fresh profile/origin: opt-in,
edit multiple floors/weather, wait for Saved, reload and compare the complete
document; create/open two same-name IDs; decline/accept New and Delete;
exercise export/import and unreadable JSON; edit during a delayed initial
load; inject quota/security/abort failures and confirm no Saved claim;
check file-origin fallback and blocked upgrades with a second tab. Do not
clear an existing user's database to run these checks.
