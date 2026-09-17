# Workspace navigation

Phase 2 incrementally groups the existing tools around one shared project.
The identity, **Save now**, save state and **Projects & backups** menu remain
available in every destination. Browser storage remains optional and local;
JSON is the backup format. Navigation does not save, edit, geolocate, fetch
weather, connect the property backend or run an analysis.
The header shows the current project name; rename controls remain in
Projects & backups so they do not consume permanent drawing space. The menu
also contains the explanation of Homeowner/Expert presentation modes.

## Routes and ownership

Canonical URLs use `?workspace=<destination>&section=<section>`.

| Destination | Implemented sections (stable route IDs) |
|---|---|
| Overview | `summary`: current scene, floor/room counts and missing site/weather inputs |
| Site · Plot Planner | `plot`: dimensions, cardinal road-facing bearing and feasibility; `context`: location, surroundings, preview dimensions and weather; `prohibited`: Telangana lookup; `references`: regulatory sources |
| Design | `layout`: 2D editor and explicit optional 3D; `structure`: conceptual structural editing and coordination; `elevations`: saved views and physical facade boxes; `plumbing`: fixtures, water/waste networks, plans and risers; `drainage`: sanitary/storm intent, supplied levels, geometric review and profiles; `electrical`: point planning; `review`: placement issues and design guidance |
| Environment | `sun`: Sun Path, whole-house direct sunlight and CSV; `solar`: geometric shadow/irradiance studies; `airflow`: explicit room/opening pressure scenarios with signed arrows, tables and local evidence, plus separately collapsed wind/window proposals; `light`: workplane direct sunlight and normalized sky access, scenarios, evidence and optional 3D, with older guidance collapsed separately; `models`: expert pressure/thermal experiments |
| Compare | `plot`: existing scaling/shape comparisons; `envelope`: sourced layer and glazing comparisons |
| Report | `drawings` (default): architectural, structural, views, plumbing and drainage PDF/SVG/PNG with continuation pages; `package`: coordinated document set, saved intentions, findings, current evidence and revision manifest; `schedules`: current room schedule; `electrical`: active-floor point schedule; `exports`: analytical exports and project JSON |

The default is `design/layout`. A returning browser resumes its last destination
unless the URL explicitly specifies one. Unknown destinations fall back to Design;
unknown sections fall back to the destination's first implemented section.
Presentation preferences use `homeplanner.workspace.route.v1` and
`homeplanner.workspace.mode.v1` in localStorage. Denied storage does not block use.
Browser Back/Forward restores route and in-session document scroll positions.
Routes do not encode or change the project, active floor or selection.

Compatibility entries:

- `?workspace=optimizer` → `site/plot`
- `?workspace=rooms` → `design/layout`
- `?workspace=sun` → `environment/sun`
- `?workspace=electrical` → `design/electrical`
- `?workspace=prohibited` → `site/prohibited` (preserved)
- `?workspace=analyze` → `environment/solar`

Existing `#env-…-section` links resolve to the appropriate new owner, including
Site's context/weather, Compare's envelope and Report's exports. Other URL query
parameters are retained. Sun Path and Prohibited Properties are **not** top-level
destinations. Quick links in the project menu need no generated house.

## State and lifecycle

`planner-workspace.js` loads after the incumbent modules, waits for their existing
DOMContentLoaded mounts, and moves live DOM nodes once rather than cloning them.
`mount()` is idempotent. All original IDs and model/editor subscriptions remain.
Site and analysis alternate inside the **same** `environmentWorkspace` ancestor:
the `.env-context` forms remain mounted with their delegated handlers and drafts,
but are visible only in Site. This is a visibility/ownership adapter, not a second
environment instance or duplicate site editor. Envelope and analytical exports
use the same approach. Electrical schedules remain inside their source root.

One shared active editable-floor selector is used across destinations.
The separate **regulatory floor** and **planned allowed floor count** retain their
different meanings in their original forms. Shared project Undo/Redo stays in the
toolbar; specialized **Undo last fix** remains the checklist operation.
The generic selection inspector is used for layout/3D; Electrical replaces its
visible editing surface with the incumbent point editor for the same project.

The palette and inspector dock into existing 2D fullscreen, then return to the
original live grid. Navigation exits fullscreen. Leaving layout closes/disposes
3D through its existing controller, retaining its camera; explicitly reopening
3D restores that camera. Navigation never opens/imports the GPU renderer.
The original 2D fallback remains usable when 3D is unavailable.
The drawing is first in reading order. Tools and selection properties use native
`details` panes: both start open on desktop, closed on narrow screens; below
80rem, opening one closes the other. Toolbar buttons open the corresponding pane
without recreating its controls or discarding numeric drafts.

Homeowner/Expert is a reversible display preference: Expert initially expands
the existing planning preferences. It is not onboarding, a separate model,
a permission, or a professional credential. Neither mode removes safety notices.

### Explicit solar exploration

Sun Path coordinates/date/time are exploratory drafts. Editing them or running
local sun calculations no longer silently changes the project's site.
**Use project defaults** copies the authoritative project into the exploration.
**Use for this project** validates and explicitly applies location and solar time
through the existing `update-solar-inputs` command; project Undo can reverse it.
Site verification remains evidence-dependent and is not implied by application.
Unrelated edits, selection and navigation do not overwrite the exploration.

### Explicit property connection

Site > Prohibited Properties mounts offline without network activity.
**Connect local lookup** deliberately loads the local Flask location catalog.
Connection errors stay local and retryable; ordinary plot planning does not
require Flask or Tesseract. Report fetching/OCR still uses its separate explicit
actions. Results do not certify title or property status.

## Integration API and hooks

Browser API: `HomePlannerWorkspace.navigate('site/context')` or
`navigate({destination: 'site', section: 'context'})`;
`getRoute()` returns the current pair. `navigate` accepts `replace: true` for
replacing history; internal restoration uses `history: false`.
`document` receives `homeplanner:workspace-change` with the route as `detail`.
This is a presentation event, **not** an author revision event.
Pure `destinations`, `normalizeRoute`, `routeURL`, and `viewFor` are CommonJS
exports for tests. `document.body.homePlannerWorkspace.setMode(mode)` changes
the presentation without touching project state.

Styles remain in `planner-workspace.css`, using the existing theme tokens:
`--bg`, `--panel`, `--panel2`, `--line`, `--txt`, `--dim`, `--acc`.

- `.hp-workspace`: body; `data-workspace`, `data-workspace-section`, `data-hp-mode`
- `.hp-project-bar`: identity/save/actions, `.hp-project-menu`: persistent details
- `.hp-project-nav`: six destinations; `.hp-workspace-subnav`: one local route row
- `.hp-workspace-tools`: shared floor/history host;
  `.hp-workspace-tool-row`: compact live selector/history controls
- `.hp-design-layout`: desktop grid containing `.hp-design-palette`,
  `.hp-design-canvas`, `.hp-design-inspector`
- `.hp-workspace-panel`, `.hp-workspace-status`: task content and status
- `.hp-workspace-single-column`: environment context/analysis layout adapter
- Standard `[hidden]` determines inactive content, including `.app-page`.

## Verification and boundaries

Run `node --test .\tests\workspace-navigation.test.cjs .\tests\plot-planner.test.cjs`
or `node --test` for the full Node suite.
`tests/workspace-browser-smoke.js` exports an async browser smoke function;
load it in an **isolated disposable browser context** after the app and call
`runHomePlannerWorkspaceSmoke()`. It checks all routes, unchanged authored
fingerprints/revisions, live mounts, drafts, Back/Forward, no route-triggered
requests and pseudo-fullscreen restoration. It changes only presentation and
unsaved exploratory form drafts; use a fresh context, not a user's live project.

Report provides conceptual drawing-sheet PDF/SVG/PNG, not engineered documents.
Structural schedules continue across pages rather than dropping records.
Light is the current
heuristic checklist, not calibrated illumination. There is no arbitrary surveyed
bearing input, map provider or engineered drawing.
Responsive visual layout, real WebGL, real fullscreen, assistive technology and
backend/OCR journeys require the integrated phase review.
