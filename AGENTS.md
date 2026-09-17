# HomePlanner agent guidance

## Use the matching specialist skill

For domain research, implementation or review, load the relevant repository
skill before choosing a method or changing code. Invoke the skill when the host
has registered it; otherwise read its `SKILL.md` and required references from
`.github\skills` directly. Do not silently fall back to generic engineering
advice because a newly added skill has not yet appeared in a session's tool list.
Load only the skills relevant to the task, not the entire catalogue.
When authoring a missing skill, bootstrap it from verified primary sources and
current repository contracts, then validate it before using it for domain edits.

| Task | Skill |
| --- | --- |
| Room layout, walls/openings, containment, snapping and geometry editing | `homeplanner-architecture` |
| Airflow, ventilation networks, velocity fields and airflow visualization | `homeplanner-airflow-modeling` |
| Indoor light, lux/daylight metrics and light-field visualization | `homeplanner-daylight-modeling` |
| Sun paths, civil time, shadows and direct-sun duration | `homeplanner-solar-shading` |
| Electrical points, mounting, envelopes and electrical modelling | `homeplanner-electrical-modeling` |
| Structural intent, coordination, members, loads or engineering extensions | `homeplanner-structural-engineering` |
| Clearances, reach, door sweeps, accessibility and interaction ergonomics | `homeplanner-ergonomics` |
| Thermal/material calculations, indoor conditions and moisture limitations | `homeplanner-thermal-modeling` |
| Water, waste, rain, plumbing/drainage topology and hydraulic extensions | `homeplanner-plumbing-drainage` |
| Plans, elevations/sections, sheets, dimensions and PDF/SVG/PNG/CAD exchange | `homeplanner-drawing-exports` |
| Plot/site rules, TDR, setbacks, location and property evidence | `homeplanner-site-regulations` |
| Shared models, IDs, commands, workers, persistence and imports/migrations | `homeplanner-project-integrity` |

Each skill is at `.github\skills\<skill-name>\SKILL.md`. Use project integrity
alongside the domain skill when shared geometry, schemas, history, saved data or
async results are affected. Use ergonomics alongside architecture/electrical
when human clearances or accessible interaction are involved.

Simple launch/navigation tasks and unrelated prose do not require loading a
modelling skill.

## Shared invariants

- The current project and active Room Planner geometry are authoritative.
  Studies must work on that geometry whether unchanged or edited, not a separate
  demonstration floor plan. Generation is not a reason to overwrite manual edits.
- Keep plot, buildable plate, building, clear room footprint and usable regions
  distinct. Transform local geometry to the site/world frame exactly once.
- Lift/stair `reserveFootprint` requests reserve wall-inclusive space inside
  ordinary rooms. Use `HomePlannerRegions`, `usableRegions` and net areas rather
  than double-counting the host and service footprints.
- Ordinary room movement validates a destination, not a clear travel path.
  Previews do not mutate the project; one completed gesture has one Undo entry.
- New/suggested room layouts prefer kitchens SE, bedrooms NW/NE and bathrooms
  S/W. These preferences must not silently rearrange a manual layout. Adding a
  room preserves existing room/furniture positions and dimensions and places
  only the new request; whole-plan regeneration is an explicit action.
- Use existing `HomePlanner` commands and immutable projections. Preserve stable
  IDs, inactive floors, unresolved references, nullable inputs and user drafts.
- Bind computed results to their inputs/revision/fingerprint. Reject stale
  completions; show prerequisite, failure, zero/night and unsupported states
  explicitly.
- A heatmap, model or report is not evidence of measured performance,
  validated CFD, calibrated daylight/temperature, engineered structural adequacy,
  electrical safety or legal approval. State the supported method and its limits.
- Do not invent missing dimensions, material values, loads, boundary conditions,
  weather, ratings or numerical success. Use sourced methods and relevant
  jurisdiction/edition before applying thresholds.
- Keep external lookups, geolocation, autosave and expensive analyses explicit.
  Test in disposable contexts; do not clear or modify a user's live browser
  project as a test fixture.

## Development and evidence

This is a local-first JavaScript browser application with optional Python
property-report services. There is no general application build/install step.
Use existing Node tests (`node --test`) and only the smallest relevant selectors
listed in the chosen skill. Use Windows backslash paths in local tool commands.
Add regression coverage for changed numerical, geometry, lifecycle and output
contracts. Follow existing error/status paths and update directly related docs.

For uncertain or high-stakes methods, research primary sources and distinguish
verified facts, assumptions, approximations and unsupported capabilities.
Preserve the dirty checkout; do not commit, push, reset or change branches unless
the user explicitly requests it.
