# Airflow worker execution

`planner-airflow-runner.js` exposes the same frozen API as a classic browser
global (`HomePlannerAirflowRunner`) and CommonJS
(`require('./planner-airflow-runner.js')`). It does not require the foundation on
the main thread and never runs a solver there.

```js
const runner = HomePlannerAirflowRunner.createRunner(globalThis);
try {
  const result = await runner.run({
    scene: planner.getDrawingScene(),
    scenario: scenarioDraft,
    expectedPhysicalFingerprint: inventory.physicalFingerprint
  });
  // Before publishing, the UI must still verify this run is current.
} catch (error) {
  if (error.name !== 'AbortError') showError(error.message);
}
runner.cancel(); // Immediate termination; pending promise rejects with AbortError.
runner.dispose(); // Also cancels; this instance cannot run again.
```

The optional `expectedPhysicalFingerprint` must be omitted when unavailable, not
passed as `undefined` or `null`. The complete strict input/result contract is in
[airflow-visualizer.md](airflow-visualizer.md). Missing physical inputs resolve to
an honest **blocked** result. **Nonconverged** and **numerical-error** numerical
outcomes also resolve unchanged; transport/schema failures reject. Neither
cancellation nor the fixed 120-second timeout can produce a successful result.

## Hosting and load order

Load `planner-airflow-runner.js` before the UI that creates a runner. If the UI
also uses discovery/normalization, load `planner-regions.js`, `building-physics.js`,
`planner-airflow-field.js`, then `planner-airflow.js`, before that UI.
Worker execution independently imports those four assets, in that order,
next to `planner-airflow-worker.js`.
Creating a runner does not create a worker or fetch any assets. Every explicit
`run()` creates one local **classic dedicated Worker**; a subsequent run cancels
the prior one even when scenario IDs match.

Serve the application, worker and all four dependencies over same-origin HTTP(S).
Localhost and offline operation with already available local assets are supported;
`file:` pages and browsers without Worker support receive actionable errors.
There is no main-thread fallback, CDN dependency, weather fetch, pressure inference,
or outgoing analysis request. Hosting CSP must permit the local worker and its
four local script imports. Offline operation still needs those assets available.

An explicitly requested `scenario.planField` is transported with the same
immutable snapshot. The runner verifies the optional field's engine/method,
units, input fingerprint, zone/floor references and numerical cell bounds.
An unrequested field or relabeled units cannot be attached to the result.

The runner captures its classic script URL at evaluation, before `currentScript`
disappears. Otherwise it resolves relative to `document.baseURI` or
`location.href`. Query strings on the page/script do not become a directory.
For tests/custom layouts,
`createRunner(runtime, {workerURL: 'workers/planner-airflow-worker.js'})` accepts
only a same-origin HTTP(S) URL; blob/data/file/remote URLs and URL credentials
are rejected. Keep the fixed dependencies beside the chosen worker entry.
The injected runtime supplies `Worker`, timers, and page location/base URI.

## Protocol, ownership and validation

Requests are exactly `{version: 1, type: 'run', token, scene, scenario,
expectedPhysicalFingerprint?}`. Tokens are positive, runner-module-wide sequence
numbers unrelated to scenario IDs. The worker accepts one request and only
imports fixed local filenames; it cannot evaluate or import request-supplied
code. The pure foundation enforces scene/scenario schemas and budgets.

Responses are `{version: 1, type: 'result', token, result}` or
`{version: 1, type: 'error', token, error: {name, message}}`. Errors preserve their
name and a bounded message; no stack or arbitrary error object crosses the wire.
Foreign tokens, versions, malformed responses, load errors, deserialization
errors and synchronous posting/clone errors reject. Every settlement removes
listeners and timers and terminates the owned worker. Late callbacks from an
already settled worker cannot publish or disrupt a newer run.

The runner snapshots finite JSON inputs before posting, preserving omission/null
semantics and preventing later edits from changing a pending request. Each input
has a 500,000-node, 16,000,000-character, depth-64 traversal ceiling. Cloned results
are checked and recursively frozen with an iterative bounded traversal
(2,000,000 nodes, 128,000,000 characters, depth 64); an oversized response rejects
rather than being truncated.

Validation checks result shape, status, engine/solver versions, project/revision,
source-input fingerprint, exact submitted scenario, inventory/provenance physical
fingerprint consistency and derived input fingerprint. It preserves the
foundation's blocked result on an expected-physical-fingerprint mismatch.
It does **not** rediscover physical geometry or solve again on the main thread.
The UI remains responsible for comparing the returned snapshot against its
**current** project, physical/scenario fingerprints and revision before publishing;
a valid snapshot is not proof that later edits have not occurred.

## Verification

Run `node --test tests\planner-airflow-runner.test.cjs`.
Tests use deterministic fake Workers/timers for lifecycle and transport failures,
plus the actual classic worker source in a VM importing the real local foundation
and building-physics scripts. They cover frozen real results, strict errors,
blocked/nonconverged/numerical-error outcomes, cancellation, supersession, disposal,
timeouts, stale messages, malformed replies, and script URL resolution.
A real hosted-browser Worker smoke test is a separate integration gate; VM tests
do not assert browser CSP or offline-cache behavior.
