# Sources: project integrity

Checked 17 September 2026. These are original applicability summaries.

## IndexedDB transactions and version changes

https://w3c.github.io/IndexedDB/

The W3C specification distinguishes database requests, transactions,
transaction completion/abort, connections and version-change coordination.
Its examples explicitly report committed writes in `transaction.oncomplete`.
Use this to verify lifecycle behavior, not as evidence that a browser database
is an independent backup or that a successful request cannot later be aborted.
The living third-edition document is not a claim that every browser implements
every optional feature identically.

## Storage identity, quotas and persistence

https://storage.spec.whatwg.org/

The WHATWG Storage Standard explains storage keys, buckets, quotas, usage
estimates and persistent storage. Origin/profile changes and eviction policies
matter to a local-first product. Persistence permission is not guaranteed, and
user-controlled deletion/backups remain separate concerns.
Do not silently request permissions or use persistence as a substitute for
portable project export.

## Agent skill loading

https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills

GitHub documents repository-scoped `.github/skills` packages, required metadata,
selective skill activation, explicit `/skill-name` requests and `/skills reload`.
This establishes packaging/loading, not that an unrefreshed session has already
registered a newly written package. This package grants no tool preapprovals.

## Local evidence to inspect

- `docs\project-model.md`: authoritative source, coordinate frames and identities.
- `docs\local-persistence.md`: opt-in saving, transaction completion, conflicts
  and recovery.
- `docs\drawing-foundation.md`: versioned optional records and unresolved hosts.
- `tests\planner-storage.test.cjs`: the application's actual persistence cases.

Read source applicability again when changing semantics; do not copy a generic
upstream example over the repository's stronger revision or recovery safeguards.
