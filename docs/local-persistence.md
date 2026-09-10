# Local projects and JSON backups

HomePlanner can keep projects in **this browser's IndexedDB**. There is no
account, server database, cloud sync, network request or repository write in
this feature. It does not upload project or weather data.

## Using the controls

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
  records, analysis configuration and provenance.
- **New project** keeps existing saved projects. New and Open use an in-app
  confirmation when current work is not saved. If the planner changes while
  a restore is waiting, restoration stops rather than replacing those edits.
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

The remembered project is automatically opened **only on initial startup and
only when autosave was previously enabled**. A startup ID/revision/content
guard prevents delayed loading from overwriting edits made while IndexedDB
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

The coordinator owns these additions to `index.html`:

```html
<link rel="stylesheet" href="planner-persistence.css">
<!-- Put this above #plannerProjectTools. -->
<div id="plannerPersistence"></div>
```

Load `planner-storage.js`, then `planner-persistence.js`, **after**
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

Restoration is never merged into a previous project. The bridge should retain
the saved document's content/revision on restore, including inactive-floor
slices and captured legacy context. If reconstruction changes content
without increasing the revision, the UI reports
`RestoredSnapshotChangedError`, keeps the saved copy intact and pauses
autosave rather than silently overwriting that revision.

The bridge captures the dynamically generated road widths/units and split-axis
checkbox separately from ID-bearing controls. It rebuilds dependent plot-target
and regulatory-floor options before selecting their saved values. The split
slider retains its exact fraction instead of changing its step during rendering;
keyboard nudges still follow the chosen dimension unit. This prevents a reload
or floor switch from changing plot geometry through display rounding.

`HomePlannerPersistence.mount(host, planner, options?)` returns
`{controller, destroy}`. Browser scripts mount automatically once.
`host.homePlannerPersistence` refers to the controller; the module also
exposes `HomePlannerPersistence.instance`. `destroy()` unsubscribes and
releases pending downloads/connections. CommonJS exports permit dependency-
injected controller tests without a DOM or new framework.

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
node --test tests\planner-storage.test.cjs
```

Tests cover JSON/envelope validation, immutable weather/floor snapshots,
same-revision conflicts, unknown schema, transaction settlement/abort/quota
errors with scripted request events, blocked/version changes, coalescing,
initial opt-in, startup/open races, remembered restoration, read-only failure
fallback, import preservation, opt-out and explicit deletion.
Scripted request events test error/settlement logic; they are **not** a
substitute for native IndexedDB.

Coordinator browser coverage should use a fresh profile/origin: opt-in,
edit multiple floors/weather, wait for Saved, reload and compare the complete
document; create/open two same-name IDs; decline/accept New and Delete;
exercise export/import and unreadable JSON; edit during a delayed initial
load; inject quota/security/abort failures and confirm no Saved claim;
check file-origin fallback and blocked upgrades with a second tab. Do not
clear an existing user's database to run these checks.
