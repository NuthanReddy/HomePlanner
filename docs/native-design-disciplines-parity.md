# Native Design disciplines: scope and parity

`src/platform/DesignDisciplineTabs.tsx` mounts the actual incumbent workbenches.
It does not create an iframe, hidden index application, alternative geometry store,
engineering solver, plot form or environment form.

## Parent wiring

```tsx
<DesignDisciplineTabs
  planner={designPlanner}
  activeTab={tab}
  onNavigate={setTab}
/>
```

`planner` is the exact `PlannerApi | null` supplied by NativeDesign's
`onPlannerChange`. `activeTab` accepts `structure`, `elevations`, `plumbing`,
`drainage`, `electrical`, `review`; other values hide this component.
Keep this component mounted when changing tabs/destinations; hide its surrounding
destination instead of conditional recreation. This retains incumbent drafts,
subscriptions and source controls. Replacing the planner disposes owned mounts.

All mounts read the same `getProject`, active-floor `getScene` and captured
`getDrawingScene`. Site coordinates, plot/buildable registration, Environment
obstacles and existing physical settings come through that authority; they are
not duplicated here. Parent owns applying native Site inputs and durable account
persistence. Rendering is not saving; pending forms are not authored JSON.

The scoped document resolves IDs/events only inside its owned workbench and
supplies its injected authority through `defaultView.HomePlanner`. The real
`window.HomePlanner` is never changed. Electrical already accepts the planner
explicitly. Incumbent commands, anchor preservation, shared Undo and draft parking
remain unchanged.

## Required classic asset allowlist

Keep the existing Design foundation assets, then add exactly:

```text
planner-structure.js
planner-services.js
planner-drainage.js
planner-drawing.js
planner-structure-drawing.js
planner-services-drawing.js
planner-drainage-drawing.js
planner-elevation.js
planner-drawing-export.js
planner-structure-ui.js
planner-structure-ui.css
planner-services-ui.js
planner-services-ui.css
planner-drainage-ui.js
planner-elevation-ui.js
planner-elevation-ui.css
planner-facade-ui.js
planner-facade-ui.css
electrical-planner.js
electrical-planner.css
planner-drawing-ui.js
planner-drawing-ui.css
vendor/pdf/pdf-lib-1.17.1.min.js
```

No additional dependency/package or drainage stylesheet is required.
`loadDisciplineRuntime` loads local assets sequentially after the Design foundation.
It does not open 3D, fetch weather, generate a plan or run coordination.
Missing assets have an explicit retryable error rather than a blank success.

## Inventory against workspace-navigation.md

| Tab | Incumbent inventory retained | Gaps / boundaries |
|---|---|---|
| Structure | Exact `HomePlannerStructureUI.mount`: grid/column/beam/slab/footing drafts; hosted-anchor replacement; save/delete; schedule and technical details; explicit coordination; paper/fixed scale/continuations; image URL lifecycle | Conceptual geometry only, engineering NOT ASSESSED. Shared optional structural 3D stays in Layout and explicit. |
| Elevations | `HomePlannerElevationUI.mount`: saved elevations/finite sections; owner/scale; cardinal front/rear/left/right views; exact saved-view IDs; drafts; preview/pages. `HomePlannerFacadeUI.mount`: physical box CRUD, optical input and preservation | No invented assemblies/details. Native source exports are below the authoring surface. |
| Plumbing | `HomePlannerServicesUI.mount`: fixture/node/route editing; exact cross-floor pairs; absent/null fields; anchor/waypoint preservation; schedule/findings; water/waste filters; explicit plan/riser previews | No hydraulic sizing, pressure or flow. |
| Drainage | `HomePlannerDrainageUI.mount`: same services editor with drainage configuration; sanitary/storm/vent intent; independent levels and via inverts; discharge unknowns; explicit plan/profile; geometric findings | Capacity, permitted discharge, cover and construction unassessed. Blank preview placeholder is compact rather than an empty tall frame. |
| Electrical | Exact `HomePlannerElectrical.mount`: diagram/list/form/point review/suggestions/schedule; shared active floor and Undo/Redo; surface/wall hosts and height datums; explicit save/accept; text-safe fields and native keyboard selection | No new electrical sheet exporter exists. Incumbent schedule is retained; no fake PDF/CAD circuit drawing added. |
| Review | Verbatim incumbent science/green/Vastu scoring and fix strategies extracted into the active Design runtime; complete row details/manual steps; explicit single-row fix, Fix all feasible, guarded Undo last fix; additional current shared-model diagnostics | Heuristic scores are not measured/validated performance or approval. Unsafe historical snapshot overwrite is replaced with shared Undo guarded against later independent edits; see below. |

Structure/Elevations/Plumbing/Drainage share one compact, collapsed source
**Drawings & export** disclosure using actual `HomePlannerDrawingUI.mount`.
The discipline selector is source-owned/hidden, not a new Report destination.
Saved view, paper, orientation, fixed scale, scope, continuation pages,
SVG/PDF/PNG encoders, staging/cancellation and fingerprint invalidation are
unchanged. Links to legacy Report are intercepted to open this source disclosure;
no route-triggered export or automatic coordination is introduced.

## Validation

- `npx tsx --test tests\platform-design-disciplines.test.ts`: owned-subtree
  ID/event scope, injected authority, native DOM method binding, no global
  authority replacement and bounded asset inventory.
- `node --test tests\planner-structure-ui.test.cjs tests\planner-elevation-ui.test.cjs tests\planner-facade-ui.test.cjs tests\planner-services-ui.test.cjs tests\planner-drainage-ui.test.cjs tests\electrical-planner.test.cjs tests\planner-drawing-ui.test.cjs tests\planner-drawing-export.test.cjs`: 239 tests passed.
- `tests\native-design-disciplines-browser.js` is an isolated Playwright
  component integration probe. It obtains an incumbent project fixture in a new
  disposable browser context, then mounts the native component using that exact
  authoritative bridge. No account login/live project modification is needed.
  It exercises actual Save/preview/navigation/Undo controls, exports, small
  viewport and teardown. See the current execution result before claiming
  rendered parity; a mounted shell alone is not sufficient.
- `node --test tests\native-review.test.cjs tests\planner-design-runtime.test.cjs tests\planner-room-inputs.test.cjs tests\room-movement.test.cjs`: 46 tests passed, including verbatim score/strategy extraction.
- `tests\native-review-browser.js`: unmocked disposable browser verification of
  identical classic/native science (11 rows), green (11), Vastu (8) scores after
  authored window suppression; successful Fix all in exactly one revision;
  exact authored restoration with Undo; successful individual row fix in one
  revision; rejection of Undo last fix after a later rename; protection of
  pending room-count drafts; 390 px viewport; registry disposal; zero exceptions.

Rendered isolated probe passed: actual structural Save and A2
preview, staged SVG output, encoded PDF bytes and browser-decoded PNG output,
saved north elevation preview, confirmed physical
facade Save, plumbing fixture Save and preview, drainage preview, ceiling-point
Add and shared Undo, Structure/Plumbing draft retention, 390 px viewport with no
document overflow, no global planner assignment, zero browser exceptions, and
teardown. The default fixture explicitly required A2 after the incumbent A3 fit
failure; no automatic scale reduction was applied. Assets for this development
initial probe were served byte-for-byte from the checkout by a bounded loopback helper
and routed to `/classic/` in the disposable context because the parent-owned
allowlist was still pending. This verifies rendered component behavior, **not**
completed production asset delivery or account-workspace integration. The helper
was stopped after testing. After the parent installed the allowlist, the full
committed discipline probe passed **without interception**, including SVG/PDF/PNG,
all five authoring workbenches, Review scorecards, draft retention, shared Undo,
390 px viewport and teardown. This remains component-level evidence; the parent
owns account persistence/end-to-end project integration.

## Review authority and safe fixes

No additional Review asset is required. The existing generated
`planner-design-runtime.js` now exposes `getReview(planner)` through a private
WeakMap keyed by the actual controller. `ReviewWorkbench.tsx` reads that exact
owner; an unknown/disposed controller returns no scorecard. The extraction
contains 170 unchanged incumbent declarations, including the original score
functions, window/exposure/preference strategies and improvement predicate.
No alternative daylight/airflow method or numeric standards were introduced.

The native runtime applies existing canonical opening edits before scoring,
including suppressed openings. A review-only cache invalidation drops old
rendering-source opening arrays when an incumbent fix rebuilds openings on the
same plan object; otherwise moved custom windows can conflict with stale arrays.
This changes lifecycle, not geometry calculations or stable IDs.

Single and aggregate fixes run in the shared bridge's existing legacy-gesture
transaction. They never capture unfinished numeric input drafts: pending room
inputs block the action. Unimproved attempts restore the exact prior geometry
and settings without a revision. Successful attempts retain one shared revision,
with the incumbent score predicate—not a claim of physical performance.
The original side-light strategy writes its result through the existing
committed-number boundary before regeneration, rather than consuming field text.

**Deliberate safety difference:** the historical Undo last fix restored old
settings/layouts even after unrelated edits. Native Undo last fix calls shared
project Undo only when the exact post-fix document is still current; later edits
disable it and explain how to use ordered shared Undo. It does not overwrite
later Site, discipline, floor or project changes. The UI preserves each original
scorecard's distinctions and leaves optional cultural scoring off unless already
enabled in Layout. Old `roomGuidance` markup has no population implementation in
the incumbent; no empty replacement panel is added.

Real assistive-technology, physical engineering certification and all possible
project/input combinations remain outside these software tests.
