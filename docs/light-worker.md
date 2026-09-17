# Room light dedicated worker

`planner-light-runner.js` exports the same frozen `HomePlannerLightRunner` global
and CommonJS API. Browser load order: `planner-regions.js`, `planner-features.js`, `planner-model.js`,
`planner-projection.js`, `building-physics.js`, `planner-light.js`, then
`planner-light-runner.js`. This is a transport for the exact accumulator contract
in [light-visualizer.md](light-visualizer.md), not another light solver.

```js
const runner = HomePlannerLightRunner.createRunner(window);
const result = await runner.run({
  scene: bridge.getDrawingScene(),
  config,
  expectedPhysicalFingerprint: inventory.physicalFingerprint // optional
}, progress => {
  // Small detached frozen HomePlannerLight.progress() snapshot, not a result.
  updateProgress(progress);
});
runner.cancel();  // abort any pending promise, terminate its worker
runner.dispose(); // cancel and permanently reject future runs
```

Construction is lazy: only explicit `run(args, onProgress?)` creates a dedicated
**classic** worker. Every run owns a new worker. A new run aborts its predecessor.
There is no automatic run, persistent pool, main-thread ray fallback, partial
success publication, user-supplied worker URL, remote import, or UI mutation.
The main thread checks detached finite inputs and uses only `normalizeConfig`
and `discover` for input/provenance validation; it never creates an accumulator,
compiles a kernel, or traces rays.
It verifies each clipped sensor against the submitted grid/usable-region
intersection, including fragment identity, midpoint and exact area weight.
Nonblocked workplanes must cover the complete supplied usable area; an old
worker cannot silently sample a reserved bounding-box region or omit fragments.

The fixed same-origin HTTP(S) `planner-light-worker.js` path resolves beside the
runner's captured classic script URL (document base/page URL in injected
runtimes). The worker imports, in order, the six dependencies listed above,
including model/features required by the shared projection browser dependency
chain. Serve these local assets with compatible `worker-src` and `script-src`
CSP. `file:`, unavailable Worker support, script/import errors, clone errors,
invalid messages, and a **120,000 ms absolute timeout** reject instead of
silently returning invented results. This timeout includes startup/imports and
all batches; progress does not reset it.

## Batches and protocol

Protocol version 1 sends `{version:1,type:"run",token,scene,config,
expectedPhysicalFingerprint?}` once. Tokens are positive safe integers. The
worker accepts one request only; subsequent requests are ignored, including
while batches are pending. The runner ignores responses with older/foreign
positive tokens and ignores every late event after settlement.

The worker creates `HomePlannerLight.createStudy` inside its own global scope,
posts initial progress, then calls `step(4096)` per `setTimeout(...,0)` task.
There are at most 4096 receiver operations per batch, including night and
unresolved entries that trace no rays. Preparation and one batch are
synchronous, but hard termination does not depend on receiving a cancel message.
Progress is exactly:

```js
{
  processedRays, totalRays, completedIntervals, totalIntervals,
  completedSkySensors, totalSensors,
  computationalComplete, cancelled, finalized, blocked
}
```

`processedRays` is **not** an operation count or universal percentage: night and
near-horizon entries can make progress without increasing it. No full study is
copied per batch/ray. Initial and batch snapshots are sent in
`{version,type:"progress",token,progress}` envelopes. Once blocked or
computationally complete, the worker calls `finalize()` once and sends
`{version,type:"result",token,result}`. Exceptions use
`{version,type:"error",token,error:{name,message}}`.

Only terminal `RoomLightStudy` results resolve: `blocked`, `complete`, or
`incomplete`. There is no fabricated “converged” state: this deterministic
quadrature does not establish convergence. Unknown context/coverage stays
incomplete even after all operations finish. A blocked stale guard compares
against **scenePhysicalFingerprint**, never the neighbor-augmented physical key.
Cancellation/disposal/supersession rejects with `AbortError`, not a successful
partial record. Callback exceptions reject with the thrown error and clean up;
progress callbacks must be synchronous (returned promises are not awaited).
All terminal paths remove handlers, clear the timeout, and terminate the worker.

## Bounds and provenance

Scene, config, and result snapshots each enforce the core's finite JSON ceiling:
500,000 nodes, 64 levels, and **16,000,000 characters** (keys and values).
Dense arrays and plain data properties only; cycles, accessors, symbols,
nonfinite numbers, hidden properties, and non-JSON values are rejected.
The optional full canonical guard has its own 16,000,000-character ceiling,
not the 16,384-character error-message limit. No truncation or short hash is
substituted. The request's scene/config/guard are separately bounded fields;
there can consequently be three such bounded inputs in one envelope.

Repeated canonical keys inside results count toward the same aggregate
16-million-character result budget, not independent per-key budgets. The core
reserves output bounds before tracing; transport does not widen those bounds.
Large but finite inputs can still be rejected by core sensor/ray/mask/output
budgets. Returned results are detached and recursively frozen. Validation
cross-checks inventory against the submitted scene, full scene and augmented
physical keys, configuration, sensor/input keys, project/revision/source,
guard findings, terminal flags, numerical dimensions, and monotone progress.
This is accidental/protocol-corruption detection, not a cryptographic attestation
of an untrusted worker's numerical calculations.

Run `node --test tests\planner-light-runner.test.cjs` for real browser-global VM
imports, shared-scene and analytic kernel parity, task/batch yields, cancellation,
supersession, malformed traffic, long guards, finite bounds, and failure cleanup.
