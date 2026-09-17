# HomePlanner specialist skills

These are repository-scoped [Agent Skills](https://agentskills.io/specification),
not installed engineering solvers or professional credentials. They guide
research, implementation and review using the actual HomePlanner model, its
input contracts and source-backed validation.

## Catalogue

| Skill | Use for |
| --- | --- |
| [homeplanner-architecture](homeplanner-architecture/SKILL.md) | Room/site geometry, wall/opening editing, movement, reservations and layout workflows |
| [homeplanner-airflow-modeling](homeplanner-airflow-modeling/SKILL.md) | Ventilation networks, wind/pressure inputs, velocity fields and airflow visuals |
| [homeplanner-daylight-modeling](homeplanner-daylight-modeling/SKILL.md) | Indoor light fields, daylight metrics, sampling and light visualization |
| [homeplanner-solar-shading](homeplanner-solar-shading/SKILL.md) | Solar angles/time, seasonal paths, shadows and direct-sun duration |
| [homeplanner-electrical-modeling](homeplanner-electrical-modeling/SKILL.md) | Electrical points, anchors, elevations, envelopes and modelling boundaries |
| [homeplanner-structural-engineering](homeplanner-structural-engineering/SKILL.md) | Structural intent/coordination and evidence requirements for engineering extensions |
| [homeplanner-ergonomics](homeplanner-ergonomics/SKILL.md) | Clearances, reach, circulation, physical accessibility and usable editor interactions |
| [homeplanner-thermal-modeling](homeplanner-thermal-modeling/SKILL.md) | Thermal/material models, energy balance, initial conditions and moisture limits |
| [homeplanner-plumbing-drainage](homeplanner-plumbing-drainage/SKILL.md) | Water, waste/rain networks, hydraulic inputs and coordination |
| [homeplanner-drawing-exports](homeplanner-drawing-exports/SKILL.md) | Plans, sections/elevations, dimensions, sheets and truthful export formats |
| [homeplanner-site-regulations](homeplanner-site-regulations/SKILL.md) | Plot rules, setbacks, TDR, source verification and property evidence |
| [homeplanner-project-integrity](homeplanner-project-integrity/SKILL.md) | Shared state, IDs, transforms, Undo, persistence, migrations and stale results |

## How they are used

The root [agent guidance](../../AGENTS.md) routes domain work to the matching
skill. Copilot can select skills from their descriptions; users can also request
one explicitly, for example:

```text
Use /homeplanner-airflow-modeling to fix airflow visualization for the current plan.
Use /homeplanner-architecture and /homeplanner-ergonomics to improve room editing.
Use /homeplanner-structural-engineering to review this structural modelling change.
```

Use project integrity alongside any specialist when changing shared geometry,
schemas, identity, history or async results. Do not load every package for every
task. Read a skill's `references/sources.md` when its method, numerical threshold
or standards applicability matters.

## Equations, Python tools and executable references

Each package separates the short operational skill from its technical detail:

| File | Purpose |
| --- | --- |
| `references/calculations.md` | Equations, symbols/units, assumptions, valid domains, worked calculations and explicit limits |
| `references/python-tools.md` | Suitable calculation/rendering modules, verified documentation, optional API examples and engine prerequisites |
| `scripts/example.py` | Deterministic standard-library reference calculations, numerical/error checks and labelled SVG output |

Examples are **reference fixtures**, not installed solvers, a Python backend or
new app features. They never read the user's live project, fetch weather, run
external engines or write files in their normal / `--check` invocation.
Optional library snippets and engine workflows are documented separately;
review compatibility, license and input requirements before choosing one.
Do not install every listed module or treat a Python package as proof its
external simulation engine is present.

For numerical work, load the calculation reference before choosing an equation.
Carry explicit units, coordinate/angle conventions, finite-input guards and
unknown/zero states into any implementation. A worked reference, a converged
solver or a polished render is not itself calibration, compliance or engineering
approval. Not every documented equation is implemented in HomePlanner.

## Existing research is the starting point

Use the [persisted building-performance catalogue](../../docs/research/building-performance.md),
its dedicated Simulations4All observations, and the
[OpenStudio / EnergyPlus / Ladybug toolchain notes](../../docs/research/building-analysis-toolchain.md)
before repeating product research. They distinguish article claims, observed
controls and educational-model limitations. Verify decisive equations and
coefficients against the linked primary sources, not the appearance of a
calculator.

The toolchain notes preserve supplied conversation context; the private shared
chat itself has not been independently verified. Rhino/Grasshopper is a
commercial visual-workflow option, not a prerequisite for every underlying
Python library. EnergyPlus, Radiance and other external solvers need compatible
engines and explicit model inputs; a package name alone is not an integration.

These packages do not preapprove shell commands, external requests or changes
to a live project. They do not convert a geometric display into validated CFD,
calibrated lux/temperature, an engineered structure or legal approval.

## Discovery and reload

GitHub documents project skills under `.github/skills`. In Copilot CLI, newly
created skills can be registered with `/skills reload`; `/skills info <name>`
checks discovery. A new session also discovers project skills. Client support
and existing-session refresh differ: writing files alone does not prove a
particular running session has injected their contents.

When a host has not registered a new package, agents can still read its
`SKILL.md` and references directly as required by the repository guidance.

## Maintenance

- Keep `SKILL.md` concise; put source detail, calculations and module guidance
  in the corresponding `references` files.
- Keep names identical to their directory names, with valid YAML frontmatter.
- Check source applicability, not only whether a link responds.
- Recheck exported APIs and test selectors after related code changes.
- Label inaccessible, archived, version-specific or non-local-code sources.
- Never copy restricted/paywalled standards into a package or invent a license.
- Validate packages offline with:

```powershell
node --test tests\skills.test.cjs
.\.venv\Scripts\python.exe -I -B tests\validate_skill_examples.py
```

The existing repository virtual environment is used above; a working
Python 3.10+ interpreter can be substituted. No package installation is needed
for these checks. The shared validator executes every example twice in a
temporary empty working folder, validates the JSON identity/check counts,
finite numbers, deterministic example results and any labelled SVG, and rejects
optional-library or network/process imports in the reference scripts.

To run one reference:

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-site-regulations\scripts\example.py --check
```

`examples.svg` in the JSON is a self-contained render of that calculation.
Saving it is an explicit separate action; the examples do not save projects
or claim a durable browser download.

Format and loading sources:
[Agent Skills specification](https://agentskills.io/specification) and
[GitHub Copilot CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills).
