# HomePlanner website organization plan

**Status:** navigation and shared-project mode structure approved. Phase 2 now
implements an incremental shell for current tools; see
[workspace navigation](workspace-navigation.md) for actual routes, adapters and
limitations. The later scoped drawing delivery adds conceptual architecture,
structure, elevations/sections, plumbing/drainage, airflow/light workbenches and
Report document packages. See [coordinated packages](coordinated-package.md).
Future AI generation, maps and engineering simulation below remain planned;
references below to missing drawing exports describe the historical baseline.
**Date:** 10 September 2026.
**Confirmed:** two modes, one for Homeowners and one for Experts. The user approved
one shared project with Overview, Site, Design, Analyze, Compare and Report
destinations, guided homeowner entry and direct expert controls.

**Phase 2 amendment:** the user-facing Analyze destination is named
**Environment**; Sun Path is a section within it, never a separate top tab.
**Prohibited Properties belongs inside Plot Planner (Site)**, preserving the
`?workspace=prohibited` entry. HomePlanner is already the product identity; the
older source-line observations below are historical, not the current baseline.

This plan complements [the building-performance roadmap](building-performance-roadmap.md).
It organizes that roadmap around user tasks rather than simulation libraries.
Product facts are recorded in [PRODUCT.md](../PRODUCT.md).

**17 September implementation review:** the
[current gap and delivery plan](building-performance-gap-review.md) supersedes
historical absent-feature statements below and makes startup, draft/history
preservation and 2D/3D action parity the immediate integration gate. Keep SVG
and Three.js over the shared project; Blender is optional external authoring/
rendering, not a replacement workspace or a prerequisite for ordinary users.
React/backend/hosted-storage adoption remains conditional on a concrete
delivery need; the approved task destinations and local-first behavior do not
depend on those choices.

## 1. What needs reorganizing

The source already contains useful tools, but their placement reflects separate
features rather than the complete house-design journey:

| Observed organization | Consequence | Proposed change |
|---|---|---|
| The main heading is GHMC / HMDA Plot Optimizer, followed by regulatory detail (`index.html:300-313`). | The entry experience emphasizes a regional calculator, not the wider HomePlanner product. | Use HomePlanner as the application identity; show jurisdiction and rule sources in site feasibility and contextual help. Retain the limitations notice. |
| Plot Optimizer, Room Planner, Sun Path, Environment and Electrical are equal top-level tabs (`index.html:316-322`). | Users must infer which tool comes next and how inputs relate. | Organize around a shared project and its site, design, analysis, comparisons and report. |
| Room Planner combines settings, an inspector, a component library, persistence, floor controls, the drawing, 3D and long checklists (`index.html:618-1030`). | Project management, editing and review compete for attention and vertical space. | Put project actions in a persistent header, keep the drawing central, make properties contextual, and move detailed review to a dedicated view. |
| Environment contains site, obstacles, weather, solar, construction comparisons, wind and reduced-model experiments (`environment-ui.js:294-427`). | Foundational site inputs are mixed with downstream analysis. | Move site/context/weather ownership to Site; expose discipline-specific settings in Analyze and outputs in Compare. |
| Electrical has its own active-floor diagram, list, fields and review (`electrical-planner.js:902-925`). | Floor and selection context can feel disconnected from room editing. | Make electrical a Design workspace with the same active floor and selection contracts, preserving its specialized tools. |

This is a source-based organization assessment, not a completed visual or
usability audit. Keep the existing light/dark themes, semantic colors and
system-font conventions while changing information hierarchy. A rebrand,
replacement palette and pixel-level compositions are outside this plan.

## 2. Two modes, one project

**Approved interaction thesis:** Homeowner mode guides decisions; Expert mode
exposes detailed controls over the same project. Do not build two disconnected
applications or convert the building model when the mode changes.

| Behavior | Homeowner mode | Expert mode |
|---|---|---|
| Entry | A brief, recent projects, and a clear next action | Recent projects, model readiness, and direct workspace access |
| Navigation | A guided sequence with plain-language labels | Direct access to the same stages and discipline workspaces |
| Inputs | Essential fields first; optional detail expanded on demand | Full geometry, physical assumptions, source and engine settings |
| AI | Clarify the brief, propose alternatives, explain tradeoffs | Structured briefs, constraints, candidate provenance and bounded studies |
| Results | Explain outcomes, assumptions and recommended decisions | Detailed metrics, units, diagnostics, source versions and artifacts |
| Editing | Common room, opening and furniture actions | Detailed object properties, schedules, constructions and analysis configuration as implemented |
| Safety | Visible missing inputs, failures and approval for costly operations | The same warnings and approvals, with expanded diagnostics |

Mode selection is a reversible display preference, not an authorization role,
paid tier or statement of engineering qualification. Neither mode hides
uncertainty or grants extra server permissions.

On first use, ask which mode to start in. Returning users resume their last
workspace; do not repeat onboarding. Switching modes retains the project,
revision, active floor, object selection, candidate and running jobs. If an
expert-only configuration is active, Homeowner mode shows a plain-language
summary and an "Expert settings applied" link; it never silently resets it.

## 3. Navigation and ownership

Keep global navigation small: **Projects**, the current **Project**, and
**Help / Settings**. Within a project, use six persistent task destinations.
Homeowner labels can be more conversational, but destinations share stable IDs.

| Destination | Homeowner label | Contents and ownership |
|---|---|---|
| Overview | My project | Brief summary, readiness, chosen design, save state and next action; not a wall of empty metrics |
| Site | My plot | Confirmed location, dimensions, boundaries, units, roads/frontage, bearing, setbacks, neighbors, weather source and site feasibility |
| Design | My home | Home requirements, generation, candidate selection, rooms/openings/furniture, floors, 2D/3D and electrical planning |
| Analyze | Check performance | Choose an analysis, review assumptions/readiness and resource estimate, approve and monitor runs |
| Compare | Compare designs | Candidate and run comparisons, changed assumptions, result provenance and actionable issues |
| Report | My report | Area schedules, selected drawings, findings, assumptions, citations and export/handoff |

Expert workspace subtabs under Design: **Layout**, **Envelope**, **Systems**,
**Electrical**. Envelope and Systems are added only as their capabilities ship.
Analyze groups disciplines as **Sun & shading**, **Energy**, **Daylight**,
**Comfort & moisture**, **Ventilation**, and **Solar PV** as available.
Do not expose EnergyPlus, Radiance or pvlib as primary navigation labels.

The sequence is guidance, not a lock-step wizard. Users may revisit any step;
only actions that require missing prerequisites are gated, with a link to the
specific missing field. Allow a clearly labeled concept without a confirmed
plot, but never label it site-feasible.

Use at most one local subnavigation row inside a destination. Contextual property
groups are sections, not another layer of navigation tabs. Future capabilities
belong in a release roadmap, not permanently disabled tabs throughout the app.

## 4. Entry and core journeys

### New project

1. Choose Homeowner or Expert mode, then describe the house or use a structured form.
2. Extract a reviewable brief: room counts, built-up area basis, floors, parking,
   budget and hard versus optional constraints. Ask only for missing essentials.
3. Confirm the site through address, coordinates or browser location, then a
   click-to-place map marker. Explain that device location may not be the plot.
4. Enter or trace boundaries; confirm measured dimensions, units, road edge and
   true-north bearing. Add neighboring buildings or explicitly mark them unknown.
5. Review buildable area and conflicts before generation. Offer conceptual
   continuation when appropriate, not silent relaxation of hard constraints.
6. Generate a small, bounded set of candidates; compare their area, room
   arrangement, unresolved issues and current evidence before adopting one.
7. Edit the chosen candidate, request deeper analysis when useful, and export a report.

For the 23 by 45 example, request units before calculating plot area. For the
separate 1800 sq ft example, preserve the confirmed total built-up-area basis.
If combined, explain any need for additional floors and unresolved permissions.

Address search, map positioning and weather retrieval remain separate actions.
Do not acquire location or download weather merely because a page opens.
Confirming a pin does not also confirm dimensions, orientation or adjacent heights.

### Returning project

Open the existing project at its last task, showing whether changes are saved
locally and which revision results describe. Expose "Continue design" or
"Review completed analysis" when appropriate. No compulsory new-project wizard.

### Expert inspection

Open an existing project directly at a room, surface, electrical point, weather
asset or run diagnostic. Inspect inputs, follow diagnostic links to affected
objects, create a new revision and compare it with the baseline.
Editing one revision must not alter previous results.

## 5. Editing workspace anatomy

Use a canvas-first workbench, not an indefinitely scrolling form.

```text
Project name | saved locally / unsaved | mode | project menu
Project navigation: Overview / Site / Design / Analyze / Compare / Report
Workspace tools: active floor | 2D / 3D | undo / redo | view tools
-----------------------------------------------------------------------
Objects / add tools |         drawing or 3D view        | Properties
                    |                                  | of selection
-----------------------------------------------------------------------
Issues / running jobs / selection details (expand when needed)
```

On a typical desktop, show the model with one object/tool pane and one
selection inspector. Keep the inspector empty state instructional rather than
displaying every possible property. Electrical mode replaces the relevant
tool palette instead of creating a separate project or unrelated floor picker.

The 2D/3D control changes the view of the same model. Preserve view state on
navigation and provide an explicit 2D fallback when WebGL is unavailable.
Do not mount the renderer, map or analysis workers anew on every panel change.

AI assistance is a contextual drawer with explicit proposals and actions, not a
permanent third sidebar or the only way to operate the app. Keep forms and direct
editing available. AI edits show a preview and require adoption; generation
must not overwrite the current design without a recoverable revision.

Provide one authoritative inspector, one active-floor control, one save status
and one source of site/weather settings. Contextual links may open these
controls from several places without creating separate copies of their values.

## 6. Move existing features without losing them

| Current feature | New home |
|---|---|
| Plot dimensions, roads, category and setbacks | Site > Plot and feasibility |
| Split comparison and optimal plot-shape studies | Site > Advanced feasibility; retain a standalone quick-calculator entry from Projects |
| Indicative construction costs and scaling charts | Site > Feasibility for plot studies; Report for selected-design estimates, clearly distinguished |
| Regulatory tables, official documents and permission guidance | Contextual source links and Help > Regulatory references, retaining scope/date/limitations |
| Room quantities, services and planning priorities | Design > Home requirements |
| Components, openings, furniture and manual edits | Design > Layout tools and selection inspector |
| Local projects, backups and import/export | Projects and persistent project menu; save visibility in every workspace |
| Floors, undo/redo and view controls | Persistent Design toolbar |
| Stacked 3D | Design > 3D view |
| Electrical diagrams, points and schedules | Design > Electrical; schedules also available to Report |
| Sun-path controls, charts and CSV | Analyze > Sun & shading, with site defaults and explicit exploratory overrides |
| Site, obstacles and weather currently in Environment | Site > Location, surroundings and weather |
| Construction comparisons, wind proposals and reduced models | Analyze by discipline; results linked from Compare |
| Placement, green-building and room-specific checklists | Contextual Issues panel, detailed Compare review, and Report |
| Vastu preferences | Design > Optional preferences; a separate advisory score, never merged with physics or legal constraints |

Advanced tools remain reachable without a new house-generation flow. Preserve
the distinction between a temporary sun-path exploration and changing the
project's authoritative site: require an explicit "Use for this project" action.

## 7. Trust, status and failure handling

Use consistent text states with icons, not color alone:
**Missing input**, **Assumed**, **Ready**, **Queued**, **Running**, **Failed**,
**Cancelled**, **Completed**, **Outdated**. Completion does not mean compliance.

Every result identifies its design revision, weather source and method:
**Heuristic screening**, **Reduced-model scenario**, or **Engine simulation**.
Do not display an uncomputed value as zero or a pending assessment as a pass.
When geometry/site/weather changes, retain old results with an Outdated label.

Place warnings near the action they affect. An Issues panel groups blockers,
warnings and advice, linking each finding to its field or selected object.
Show full logs on demand for experts; homeowners still get the failure reason
and a recovery action.

At the map allowance ceiling or when quota state is unavailable, show
"Map service unavailable; enter coordinates manually" with the actual reason.
Keep existing confirmed coordinates and local editing usable. Show detailed
per-SKU counters and reconciliation in an authorized operational settings
surface, not to everyone who switches to Expert mode. See the technical
roadmap for the shared 10,000/month guard and fail-closed accounting.

Weather fetch errors retain the last selected valid asset without silently
substituting it for a new location. Preview any offered fallback and its
limitations. For simulation runs, show prerequisites, resource estimate,
approval, progress and cancellation without obstructing continued editing.

## 8. Responsive and accessible behavior

- Desktop: persistent project navigation and canvas-first editing; collapse
  optional panes before shrinking the drawing into an unusable strip.
- Tablet: one side drawer at a time, a clear active floor, and touch-friendly
  drawing controls. Properties must not obscure the selected object indefinitely.
- Phone: prioritize brief/site entry, review, comparison and simple edits.
  Keep precise edits available through numeric forms and object lists; explain
  when a larger screen is recommended rather than disabling the whole product.
- Provide keyboard navigation, visible focus, labeled inputs, error summaries
  and an object-list alternative to canvas selection and drag operations.
- Provide numeric location/dimension/bearing entry alongside map interaction.
  Announce selection and asynchronous run status without reading every progress tick.
- Preserve units in field labels and results; distinguish feet/metres and
  built-up/carpet/plot area. Do not convert stored geometry by switching labels.
- Propose WCAG 2.2 AA as the implementation accessibility target; this is not
  an assertion that the current website meets it.

## 9. Incremental delivery plan

| Slice | Deliverable | Acceptance gate |
|---|---|---|
| UX0: inventory and navigation contract | Agree mode behavior, feature destinations and shared project/view state | Every existing feature has a destination; no accidental loss of quick tools or local data |
| UX1: shell and project continuity | Project header, persistent save state, reversible mode control and navigation around existing modules | Switch modes/workspaces without losing edits, floor selection, undo or active jobs; no forced React rewrite |
| UX2: guided brief and site | Homeowner journey, expert direct entry, confirmed location/bearing/context and readiness | Complete either example brief with explicit unknowns; manual paths work offline or when maps are blocked |
| UX3: focused design workspace | Consolidated toolbar/inspector, 2D/3D, electrical tools and candidate adoption | Core editing does not require scrolling past project management or reports; adoption is reversible |
| UX4: analysis and evidence | Discipline setup, job states, diagnostics, comparisons and report | Users distinguish estimates from simulations and identify stale/incomparable results |
| UX5: responsive and workflow review | Keyboard/touch layouts, realistic failure states, observed user walkthroughs | Homeowner and expert tasks succeed without facilitator navigation instructions |

Reorganize existing surfaces before adding every future engine. Adopt React
incrementally under the technical roadmap; a navigation change alone is not a
reason to replace the geometry/editor implementation.

Preserve existing DOM mounts and event contracts while adapting modules into
the shell. Do not duplicate an existing control with the same ID or initialize
the same module twice. Add lifecycle/visibility adapters and typed shared state
before relocating controls that depend on ancestry or fullscreen reparenting.
The current primary-tab handlers (`index.html:5612-5619`) and component-pane
fullscreen behavior (`index.html:4534-4541`) need explicit migration coverage.

Use stable task IDs and browser back/forward navigation. Keep project content
separate from per-user mode/panel/view preferences. Navigation never mutates
model geometry, triggers a simulation or consumes another map load by itself.

## 10. UX proof and open decisions

The shared-project/two-mode topology is approved. Before implementation,
evaluate a low-fidelity flow with both audiences before pixel-level design.

Representative acceptance tasks:

1. A homeowner can supply a 3BHK brief, confirm a plot and identify missing units,
   setbacks or neighbor heights without opening technical analysis controls.
2. Either audience can find and change plot orientation from Site without
   confusing a northeast-facing frontage with a corner plot having two roads.
3. Switching modes preserves a manual window edit, active floor and result revision.
4. An expert can trace a reported daylight/energy issue to its input and object.
5. Both audiences can find backups, recover from map/weather failure and see
   whether a project is saved locally; neither is forced to enable cloud storage.
6. A user can compare candidates without mistaking a heuristic score for
   simulated energy savings or a cultural preference for a safety requirement.
7. Keyboard-only users can select and edit an object and confirm a site without dragging.

Observe task completion, navigation errors and time spent searching for controls.
Set task-time targets after a baseline walkthrough instead of inventing
improvement percentages. No usability results are claimed by this document.

Open decisions: detailed visual compositions, preferred initial mode when the
chooser is skipped, report formats, future collaboration permissions and the
first expert disciplines to expose. None blocks reorganizing the current
capabilities around a shared project and two modes.
