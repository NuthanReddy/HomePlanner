# HomePlanner user guide

Open the readable, offline [User guide](../user-guide.html). Every workspace
also has a closed **How to use this section** disclosure just below its heading.
Its **Full user guide** link opens a separate tab so the editing tab and pending
inputs remain available. The full page has a contents list, all section steps,
and a plain-English glossary; it does not require a Markdown renderer, account,
network service, or application project.

## Start with the task you need

1. **Site → Plot & feasibility:** use measured/site-plan dimensions and the
   applicable planning scenario.
2. **Design → Layout:** arrange rooms on the intended active floor. Numeric
   Selection properties are available alongside direct manipulation.
3. **Save now:** wait for **Saved in this browser**, then use **Export JSON**
   for a separate backup and verify the downloaded file.
4. **Optional studies and discipline intent:** gather inputs only for the task
   you actually choose. A floor plan does not require pressure coefficients,
   workplane settings, pipe inverts or structural member sizes.
5. **Report → Drawings:** refresh, inspect all pages and assumptions, prepare
   the required files and print at Actual size.

Unknown is not zero; not run is not failed; stale results need an explicit
refresh. Homeowner/Expert are presentation modes, not alternative models or
automatic physical defaults. A geometric result is not professional approval.
The full guide explains workplanes, window optics, VLT versus SHGC, numerical
near-horizon cutoffs, airflow Cd, pressure forcing, clear volume, inverts,
datums, scenarios, revisions and snapshots.

## Content and integration contract

`planner-guide.js` is the single content source for both the in-app disclosure
and `user-guide.html`. Each exact route has a distinct task, 3–5 ordered steps,
required-input/source guidance, optional-input guidance, result limitations,
and repository source references. This overview deliberately does not duplicate
all section instructions.

Browser global / CommonJS API: `HomePlannerGuide` exposes immutable `guides`,
`introduction`, `glossary`, `getGuide(route)`, `anchorFor(route)`,
`plannerURL(route)`, `mount(document?, workspace?)`, and `mountAll(document?)`.
`getGuide` accepts an exact `destination/section` or route object and returns
`null` for unknown routes; it does not substitute generic instructions.

`mount` owns only its disclosure under `#workspaceGuide`. It reads
`HomePlannerWorkspace.getRoute()` on mount and `homeplanner:workspace-change`.
It never calls navigation, a project command, a study, storage or a service.
Repeat mounting returns the same controller. `dispose()` removes its listener
and owned nodes; remounting is supported. Same-route notifications preserve an
open disclosure; changing sections closes it. All disclosures start closed,
independent of presentation mode. Other workbench DOM and pending fields remain
untouched.

`mountAll` owns only its content under `#homePlannerUserGuide`, works without
loading the application, and is also idempotent/disposable. Local fragment links
lead to the rendered section/glossary IDs; planner links use supported
`index.html?workspace=…&section=…` routes. Only pinned local script/style assets
load. CSS uses the incumbent `--txt`, `--acc`, `--line`, `--panel` theme tokens,
native disclosures, visible keyboard focus and 44 px interactive targets.

Validation: `node --test tests\planner-guide.test.cjs tests\workspace-navigation.test.cjs`.
Route coverage is compared with the actual `HomePlannerWorkspace.destinations`
rather than a separately maintained count. Browser tests, when the existing
local Playwright installation is available, use a fresh isolated browser context,
not a user's project. Model and numerical contracts are unchanged.
