# AI-assisted floor-plan generation implementation plan

## Purpose

HomePlanner should use a hybrid generation and validation architecture rather
than train a model to emit final plans directly. Language models may help
translate customer requests into reviewed structured inputs, but deterministic
geometry, rules and constraint checks remain authoritative.

HomePlanner already provides much of the required foundation:

- Deterministic rectangular room packing and scoring.
- Stable room and floor identities.
- Reservation-aware lift and staircase placement.
- Circulation and adjacency checks.
- Regulatory plot and setback scenarios.
- Shared project commands, Undo/Redo and local persistence.
- Fixed-scale SVG, PDF and PNG drawing output.

The implementation should extract and extend these contracts instead of
introducing a second editable planning model.

## Initial product scope

| Supported initially | Explicitly deferred |
| --- | --- |
| Rectangular plot and buildable plate | Irregular or surveyed plot polygons |
| One residential floor per generation campaign | Coordinated multi-floor generation |
| Orthogonal rectangular rooms | Curved or nonrectangular rooms |
| Existing room, balcony, lift and stair types | New architectural entity types |
| Existing Hyderabad rule scenarios | Universal or certified code compliance |
| Structured brief form that works offline | LLM required for basic operation |
| Three to eight diverse valid candidates | All possible plans |
| Existing SVG, PDF and PNG output | DXF or IFC interoperability |
| Geometric circulation screening | Certified accessibility, fire or structural design |

## Target workflow

```text
Schema-driven requirement fields
        |
        v
Validated LayoutInputsV1
        |
        v
Reviewed and normalized DesignBriefV1
        |
        v
Current plot and buildable-envelope capture
        |
        v
Bounded candidate enumeration
        |
        v
Independent hard-constraint validation
        |
        v
Metrics and soft-objective evaluation
        |
        v
Deduplication and diversity selection
        |
        v
Ranked candidate comparison
        |
        v
Explicit candidate adoption
        |
        v
Existing Room Planner commands, persistence and exports
```

`configs/inputs.schema.json` is the authoritative user-input contract. The
language model, when enabled, may propose values for that contract, but the
same schema-driven fields and review step remain mandatory. Candidate
coordinates must come from the deterministic generator or a constraint solver
and must pass the same independent validator.

## Algorithmic classification

Floor-plan generation is primarily a **constraint-satisfaction and
combinatorial-optimization problem**, not a classic dynamic-programming
problem.

| Problem part | Algorithmic pattern |
| --- | --- |
| Place rooms without overlap | Two-dimensional rectangle packing |
| Meet setbacks, dimensions and adjacency rules | Constraint Satisfaction Problem (CSP) |
| Select the best valid arrangement | Multi-objective optimization |
| Explore alternative placements | Backtracking, branch-and-bound or beam search |
| Generate diverse alternatives | Pareto optimization or bounded metaheuristics |
| Validate a completed plan | Rules engine and computational geometry |
| Translate customer language | Reviewed schema extraction with an LLM |
| Rank valid candidates | Scoring and ranking pipeline |

### Why dynamic programming is not the primary method

Dynamic programming is most effective when a problem has repeated
subproblems, a compact state representation and optimal substructure.

A general floor-plan state would need to encode:

- Room coordinates and dimensions.
- Room orientation.
- Occupied and remaining free regions.
- Adjacency relationships.
- Wall-inclusive lift and stair reservations.
- Openings and access relationships.
- Circulation state.
- Plot, setback and building-envelope constraints.

The state space grows quickly, and small coordinate changes commonly create a
different state. Memoization therefore provides limited benefit for the complete
problem.

Dynamic programming may still be useful for bounded subproblems:

- Dividing a known total area among rooms.
- Assigning room groups to floors.
- Selecting room dimensions from a small discrete catalogue.
- Solving simplified strip or grid-packing cases.
- Optimizing a fixed sequence of partitions.

It should not be treated as the architecture for the complete plan generator.

### Recommended algorithm structure

```text
DesignBriefV1
      |
      v
Constraint model
      |
      v
Bounded search and candidate generation
      |
      v
Independent hard validator
      |
      v
Metric calculation
      |
      v
Pareto ranking and diversity filtering
```

The current HomePlanner generator is closest to a **deterministic greedy
rectangle-packing heuristic with lexicographic scoring and local improvement**.
It should remain the first generation strategy after extraction.

A future exact or deeper search implementation can use:

- **Backtracking with constraint propagation** to reject impossible partial
  layouts early.
- **Branch-and-bound** to stop exploring branches that cannot improve the
  current valid candidates.
- **CP-SAT** through OR-Tools for discrete room-position and relationship
  constraints.
- **Beam search** when a bounded number of promising partial layouts should be
  retained at each placement step.
- **Metaheuristics** such as genetic search or simulated annealing only after a
  deterministic validator exists and reproducible seeds and budgets are
  recorded.

Every strategy must produce the same `CandidateV1` contract and pass the same
independent validator. Solver success is not permission to bypass geometric,
regulatory or project-integrity checks.

### Applicable software design patterns

| Pattern | Use in HomePlanner |
| --- | --- |
| Strategy | Select the existing heuristic packer, backtracking, beam search or future CP-SAT generator behind one candidate interface |
| Specification | Implement composable hard constraints with explicit pass, fail, unknown and not-applicable results |
| Pipeline | Run generation, validation, metric calculation, deduplication and ranking as distinct stages |
| Command | Adopt a candidate through the existing project coordinator with rollback and Undo behavior |
| Adapter | Convert current Room Planner controls/manual layouts to and from candidate contracts without creating a second editable geometry model |
| Worker/job | Execute bounded, cancellable generation campaigns without blocking the editor |
| Repository/sidecar | Store reviewed briefs and generation provenance separately from editable schema-1 project geometry |

## Versioned data contracts

All contracts must be plain, bounded, JSON-safe values. Missing information
stays `null` or appears in `unknowns`; it must not become zero or an attractive
default without explicit review.

### Schema-driven requirement capture

HomePlanner must collect generation requirements through different input
controls derived from:

```text
configs/inputs.schema.json
```

Users should not be required to author JSON. A raw JSON or JSONC editor can
remain an advanced import/export path, but the normal workflow is a generated
form.

The form renderer maps JSON Schema constructs to controls:

| JSON Schema construct | User control |
| --- | --- |
| `type: "string"` | Text field |
| `type: "number"` or `type: "integer"` | Numeric field with schema bounds |
| `type: "boolean"` | Checkbox or explicit yes/no control |
| `enum` | Select, radio group or segmented control |
| `oneOf` | Mode selector followed by the selected branch's fields |
| Object properties | Fieldset with a heading and description |
| Array of strings | Repeatable text fields or multi-select where values are known |
| Array of objects | Add/remove requirement cards |
| `$ref` | Reused field group resolved from `$defs` |
| `required` | Required indicator and submit-time validation |
| `minimum`, `maximum`, `exclusiveMinimum` | Numeric validation and accessible error text |
| `minItems`, `minProperties`, `minLength` | Collection or text validation |

The schema's `title` and `description` values supply labels and supporting
text. When presentation details cannot be inferred safely, additive `x-ui`
annotations may specify control type, ordering, grouping or help text. These
annotations must not weaken JSON Schema validation or carry geometry logic.

Implemented Phase 0 modules:

```text
planner-input-schema.js
planner-requirements-ui.js
planner-layout-generator.js
```

Responsibilities:

- `planner-input-schema.js` loads a pinned local schema, resolves local `$ref`
  values, rejects unsupported schema constructs, validates submitted data and
  produces the immutable normalized `DesignBriefV1`.
- `planner-requirements-ui.js` renders accessible controls, owns temporary form
  drafts and displays field-specific validation errors.
- `planner-layout-generator.js` owns deterministic request ordering and packing
  strategy while receiving the existing geometry, scoring, circulation and
  reservation functions as explicit dependencies.

The schema and rendered form are configuration inputs, not editable project
geometry. Opening the form, typing or changing a mode does not alter the active
HomePlanner project.

#### Required field groups

The current schema defines these top-level sections:

| Section | Example controls |
| --- | --- |
| Request identity | Project name, style and request metadata |
| Programme | Numeric count field for each supported room type |
| Requirements | Repeatable room/feature cards with constraints and preferences |
| Assumptions | Repeatable reviewed assumption text |
| Unknowns | Repeatable unresolved-input text |

Plot dimensions, road/facing selection, regulatory scenario, setbacks, floor
count and selected buildable plate are owned by Plot Planner. The AI
requirements form shows a read-only source summary and link back to Plot
Planner; it must not render duplicate controls or accept imported replacements
for those fields.

Each `requirements[]` item is a repeatable card containing:

- Type, stable ID and display name.
- Hard area, dimension, direction and adjacency constraints.
- Soft direction, adjacency, privacy, rotation and daylight preferences.

Hard constraints and preferences must remain separate in both the UI and
normalized brief. Moving a field between those groups changes generation
semantics and requires an explicit schema version change.

#### Form lifecycle

1. Load the pinned local schema and verify its expected `$id` and supported
   version.
2. Create a detached draft with no project mutation.
3. Render controls in deterministic schema order.
4. Validate individual fields while retaining incomplete text as a draft.
5. On **Review requirements**, validate the complete document and capture the
   current versioned Plot Planner snapshot.
6. Display a human-readable summary of hard constraints, preferences,
   assumptions and unknowns.
7. On explicit confirmation, normalize units and create `DesignBriefV1`.
8. Capture the schema version, reviewed-input fingerprint and Plot Planner
   fingerprint in the generation context.
9. Start candidate generation only from the confirmed immutable snapshot.

Changes after confirmation create a new brief revision. They do not mutate a
running campaign or relabel its results.

#### Unit normalization

The requirements schema captures room values in feet and square feet. Plot
Planner already supplies plot, setback and buildable-plate geometry in SI. The
normalization adapter converts only requirement-owned values:

```text
metres = feet * 0.3048
squareMetres = squareFeet * 0.09290304
```

The reviewed source values and Plot Planner snapshot remain available for
display and provenance. Generator, geometry and validation modules consume
normalized SI values rather than parsing unit-bearing strings.

#### Schema compatibility requirements

- `additionalProperties: false` means unsupported fields must be rejected,
  not ignored.
- New programme or requirement fields must be added to the schema before the
  form or generator accepts them.
- A schema update must include matching example-input and validator tests.
- `configs/inputs.json` is a JSONC authoring/example document; the browser form
  emits strict JSON. A consumer of the JSONC file must use an explicit bounded
  JSONC parser rather than `JSON.parse`.
- Schema validation checks data shape. Domain validation still checks
  relationships such as minimum not exceeding maximum, requirement counts
  matching the programme, unique IDs and supported room semantics.
- User and request metadata must not be copied into reusable fixtures,
  analytics or external model requests without a scoped need and explicit
  consent.

### `LayoutInputsV1`

`LayoutInputsV1` is the exact strict-JSON document accepted by
`configs/inputs.schema.json`. It is the reviewed user-input record and retains
the original room feet and square-feet values. It does not repeat Plot Planner
inputs.

It is not passed directly to the room packer. The design-brief adapter validates
cross-field rules, normalizes units and produces `DesignBriefV1`.

### `DesignBriefV1`

`DesignBriefV1` is an internal normalized projection of a confirmed
`LayoutInputsV1` plus the current versioned Plot Planner snapshot, not a second
user-authored form contract. It retains source field paths and both
fingerprints so validation and ranking explanations can identify their owner.

```js
{
  version: 1,
  source: {
    schemaId: "https://homeplanner.local/schema/inputs.schema.json",
    schemaVersion: 1,
    inputFingerprint: "<canonical LayoutInputsV1 plus Plot Planner snapshot>",
    plotPlannerFingerprint: "<canonical Plot Planner snapshot>",
    reviewedAt: 1789802207991
  },

  plot: {
    widthM: 13.716,
    depthM: 18.288,
    facing: "SW",
    frontEdge: "S",
    setbacks: {
      type: "rules",
      valuesM: { N: 1.5, E: 1.0, S: 3.0, W: 1.0 }
    },
    selectedPlate: {
      id: "whole",
      widthM: 11.716,
      depthM: 13.788,
      areaM2: 161.55,
      floorIndex: 1
    }
  },

  programme: {
    living: 1,
    bedrooms: 2,
    kitchens: 1,
    bathrooms: 2,
    lifts: 0,
    staircases: 0
  },

  buildup: {
    type: "plot-planner",
    targetM2: 161.55,
    toleranceM2: null,
    sourcePlateId: "whole"
  },

  bedroomAreaRanges: [
    {
      id: "bedroom-1",
      name: "Room 1 (Master)",
      minArea: {
        value: 161,
        unit: "ft2",
        valueM2: 14.95738944
      },
      maxArea: {
        value: 215,
        unit: "ft2",
        valueM2: 19.9741536
      }
    },
    {
      id: "bedroom-2",
      name: "Room 2",
      minArea: {
        value: 108,
        unit: "ft2",
        valueM2: 10.03352832
      },
      maxArea: {
        value: 161,
        unit: "ft2",
        valueM2: 14.95738944
      }
    }
  ],

  kitchenDetails: {
    size: "standard",
    type: "open"
  },

  dimensions: {
    bedroom: {
      minWidthM: null,
      minDepthM: null,
      maxWidthM: null,
      maxDepthM: null
    }
  },

  hardRequirements: {
    parkingSpaces: 1,
    requiredAdjacencies: [],
    prohibitedAdjacencies: [],
    stepFreeRequired: null
  },

  preferences: {
    kitchenDirection: "SE",
    bedroomDirections: ["NW", "NE"],
    privacyWeight: 0.5,
    daylightProxyWeight: 0.5,
    vastuEnabled: false
  },

  assumptions: [
    "The 45 ft x 60 ft dimensions describe the maximum building envelope.",
    "The 1,295 ft2 value is the total built-up-area target, not the envelope area.",
    "\"Standard\" kitchen size requires a versioned dimensional policy before geometry generation."
  ],

  unknowns: [
    "Built-up-area tolerance",
    "Bathroom count and access relationships",
    "Minimum kitchen area and dimensions",
    "Whether the open kitchen requires direct adjacency to living or dining"
  ]
}
```

The `45 ft x 60 ft` envelope is 2,700 square feet, while the requested
built-up target is 1,295 square feet. They remain separate constraints: the
envelope limits placement and the area policy controls generated floor area.

`buildingEnvelope.facing` accepts `N`, `NE`, `E`, `SE`, `S`, `SW`, `W` or
`NW`. HomePlanner's current authored project orientation remains cardinal, so
non-cardinal bearings beyond these eight values are a later capability.

`kitchenDetails.size: "standard"` is not directly geometric. A versioned
policy must map it to explicit minimum and preferred dimensions before
generation. The original label should remain in the brief for traceability.

### `GenerationContextV1`

The generation context captures:

- Project ID and revision.
- Active floor ID.
- Committed Room Planner settings.
- Plot, buildable floor plate, building envelope and room core.
- Applied and required setbacks.
- Frontage and true-north orientation.
- Wall thicknesses.
- Current regulatory scenario and qualifications.
- Input fingerprint.
- Generator and validation contract versions.

Room input drafts are not generation inputs until Apply or Enter commits them.

### `CandidateV1`

Each candidate contains:

- Stable candidate ID.
- Generation seed and strategy version.
- Owning context fingerprint.
- Stable room source IDs.
- Clear room rectangles and wall-centreline modules.
- Service reservation footprints.
- Proposed openings and access relationships.
- Unmet requests.
- Generation trace and bounded-search statistics.

Candidate geometry is a detached proposal. It is not editable project state
until explicitly adopted through the shared project coordinator.

### `ValidationReportV1`

Each finding has:

- Stable code.
- Status: `pass`, `fail`, `unknown` or `not-applicable`.
- Severity.
- Floor and entity references.
- Supplied input or source basis.
- Measured value and target where applicable.
- Explanation and reversible remedy.

Legal, accessibility, structural and fire-safety findings must retain their
applicability and evidence limits.

### `CandidateMetricsV1`

Initial candidate metrics include:

- Gross, usable, service-reserved and unassigned areas.
- Exterior exposure.
- Circulation depth and inaccessible-room count.
- Adjacency and privacy measures.
- Direction-preference measures.
- Plumbing-distance proxy.
- Available versus unknown scoring criteria.

### `RankingPolicyV1`

The ranking policy stores:

- Policy version.
- Objective weights.
- Normalization method.
- Missing-value policy.
- Pareto or diversity settings.
- Tie-breaking rules.

A changed ranking policy must not rewrite candidate geometry.

### `CampaignResultV1`

The campaign result records:

- Generation context identity.
- Attempt, candidate and elapsed-time budgets.
- Seeds.
- Valid and rejected candidate summaries.
- Cancellation or completion state.
- Failure explanations.
- Generator, validator and ranking versions.

## Delivery phases

### Phase 0: extract the existing planning kernel

Establish the schema-driven requirement boundary and move reusable generation
logic out of `index.html` without changing existing Room Planner behavior.

Implement the input path first:

- Load and validate `configs/inputs.schema.json`.
- Render the supported controls.
- Validate a complete `LayoutInputsV1`.
- Normalize it into a detached `DesignBriefV1`.
- Keep drafts and review state outside the project command history.

Extract in Phase 0:

- `roomOrder`
- `roomPackAttempt`
- `roomPackProgram`

Keep `makeRoomRequests`, rectangle/free-space helpers, adjacency and direction
scoring, circulation analysis and reservation-aware area calculations as
explicit injected dependencies for this compatibility extraction. Moving those
owners belongs with the independent candidate/validator boundary in Phase 1;
duplicating or rewriting them during Phase 0 would risk changing current Room
Planner geometry.

`index.html` remains the browser adapter and UI owner. DOM values, global wall
constants, checkboxes and input drafts must become explicit arguments to the
pure modules.

### Phase 0 completion

Phase 0 is implemented with these verified boundaries:

- `configs/inputs.schema.json` is the authoritative form contract.
- The browser renders schema-derived fields, including objects, arrays, enums,
  numeric bounds, local references and `oneOf` mode branches.
- Draft edits, review, discard and confirmation remain detached from project
  revision/history; scalar typing preserves the open disclosure, focus and
  native text editing.
- Valid inputs normalize feet and square feet to SI once and produce a frozen
  `DesignBriefV1` with canonical input provenance.
- Invalid schema/domain input reports explicit field paths and cannot be
  normalized or confirmed.
- Plot, road, regulatory, setback, floor and selected buildable-plate inputs are
  captured from Plot Planner and are not repeated in the AI form or JSONC
  requirement document.
- The deterministic order and packing strategy is supplied by
  `planner-layout-generator.js`; `index.html` delegates to it through explicit
  existing geometry/scoring dependencies.
- The JSONC example contains only AI-owned request, programme, room range and
  preference fields; bedroom area ranges and open standard kitchen details
  remain explicit.

Candidate enumeration, independent candidate validation, ranking and adoption
remain later phases and do not run when a brief is confirmed.

Release gate: existing Room Planner fixtures produce the same rooms, scores,
identities and unmet requests before and after extraction. A valid schema-driven
form submission produces the expected normalized brief, while invalid or
incomplete input starts no campaign.

### Phase 1: build the independent validator

Create:

```js
HomePlannerLayoutValidation.validate(brief, context, candidate)
```

Hard checks include:

- Exact required room counts.
- Reviewed room dimension and area ranges.
- Ordinary-room non-overlap.
- Service-reservation non-overlap.
- Full wall-inclusive lift and stair containment.
- Buildable-envelope and setback containment.
- Required living/hall and kitchen presence for BHK briefs.
- Prohibited pooja and bathroom adjacency.
- Ensuite ownership and common-bathroom access.
- Resolved internal access graph.
- Declared area target or maximum.
- Matching project, floor and input fingerprint.
- Regulatory results represented as pass, fail, unknown or not applicable.

Soft preferences must never compensate for a failed hard requirement.

Accessibility, stair construction, structural adequacy, fire egress and
planning permission remain qualified findings unless the necessary applicable
rules and physical evidence have been supplied.

### Phase 2: produce a bounded candidate pool

Replace the current four-attempt, single-winner behavior with controlled
enumeration.

Vary:

- Room ordering.
- Preferred versus minimum dimensions.
- Allowed room rotation.
- Placement corner and alignment.
- Service placement order.
- Directional preference strength.
- Adjacency strategy.
- Leftover-space expansion decisions.
- Deterministic seed.

Run the campaign in:

```text
planner-layout-worker.js
```

Every campaign has:

- Candidate-count limit.
- Attempt limit.
- Elapsed-time limit.
- Deterministic seed.
- Cancellation.
- Project, revision and fingerprint guard.
- Explicit "none found within search budget" outcome.

A failed bounded search is not proof that the brief is mathematically
infeasible.

The initial product target is at least three genuinely distinct valid
candidates when the supported search finds them. Duplicate candidates must not
be used to fill the UI.

### Phase 3: add deduplication, metrics and ranking

Create:

```text
planner-layout-metrics.js
planner-layout-ranking.js
```

Deduplicate with canonical geometry:

- Sort rooms by stable source ID.
- Normalize numeric precision only for comparison.
- Include room rectangles, reservation footprints and important adjacency
  edges.
- Do not use display labels or array positions as identity.

Selection occurs in two stages:

1. Remove invalid and geometrically duplicate candidates.
2. Select diverse Pareto or epsilon-dominant candidates.

Initial objectives:

| Objective | Treatment |
| --- | --- |
| Required-room and geometry validity | Hard constraint |
| Usable room area | Maximize |
| Unassigned or flex area | Minimize within a declared policy |
| Inaccessible rooms | Required rooms fail |
| Circulation depth | Minimize |
| Exterior exposure | Maximize as a geometric proxy |
| Privacy | Maximize through declared adjacency and distance measures |
| Plumbing proximity | Minimize as a routing proxy only |
| Direction preferences | Soft, visible score |
| Vastu | Optional and independently labelled |
| Construction cost | Deferred until a candidate-area cost policy is defined |

Missing inputs are unscored. They must not receive an artificial zero or
neutral measurement.

### Phase 4: candidate comparison UI

Add an isolated vanilla-JavaScript requirements and candidate workbench first:

```text
planner-requirements-ui.js
planner-candidate-ui.js
planner-candidate-preview.js
```

The requirements pane is rendered from `configs/inputs.schema.json`. It
provides **Review requirements**, **Confirm and generate**, **Discard changes**
and import/export actions. Draft changes do not edit the project or invalidate
an existing accepted layout until a new brief is confirmed.

Each candidate card shows:

- Plan preview.
- Hard-validation status.
- Room and area schedule.
- Unmet and unknown requirements.
- Raw objective metrics.
- Ranking explanation.
- Assumptions and regulatory qualifications.
- Candidate seed and generator version.
- "Conceptual - plot fit unverified" when site evidence is incomplete.

Candidate previews are detached projections. Selecting, sorting or previewing
one does not edit the project or add Undo entries.

### Phase 5: atomic candidate adoption

Add:

```text
planner-candidate-adoption.js
```

The adoption adapter:

1. Rechecks project ID, revision, floor ID and fingerprint.
2. Revalidates the candidate against the current context.
3. Converts the candidate into committed Room Planner controls and a manual
   layout snapshot.
4. Preserves room and source IDs.
5. Compiles through `HomePlannerModel.buildScene`.
6. Verifies capture, restore and render reproduce the candidate.
7. Rejects the entire adoption if unrelated geometry, floors or references
   change.
8. Keeps the original project recoverable.

Recommended actions:

- **Open as new project**: default.
- **Replace current floor**: explicit confirmation and one Undoable bridge
  transaction.
- **Cancel**: no authored change.

The accepted project stores ordinary HomePlanner geometry. Candidate provenance
remains a read-only sidecar linked to the accepted project revision and
fingerprint.

### Phase 6: persistence and output

Use a separate versioned candidate and brief store instead of placing complete
candidate campaigns inside schema-1 project JSON.

Persist:

- Reviewed brief.
- Generation context identity.
- Ranking policy.
- Seeds and budgets.
- Candidate summaries.
- Accepted candidate ID.
- Original validation and ranking report.

A design package can contain:

```text
project.json
design-brief.json
generation-manifest.json
candidate-summary.json
```

Continue using:

- `HomePlannerDrawing` for plans.
- `HomePlannerDrawingExport` for SVG, PDF and PNG.
- `HomePlannerPackage` for coordinated reports.

DXF and IFC require separate entity, unit, host and interoperability contracts
and are not part of this release.

### Phase 7: optional natural-language extraction

After the structured workflow is stable, add an opt-in intent gateway to the
existing Flask service:

```text
POST /api/design/parse-brief
```

Requirements:

- Same-origin and payload-size guards.
- Server-held model credentials.
- No automatic project upload.
- Explicit consent before transmitting brief text.
- Strict structured-output validation.
- Output proposed as `LayoutInputsV1` values validated by
  `configs/inputs.schema.json`.
- Evidence spans mapping values to source text.
- Unknown and conflicting values retained.
- Mandatory user review before generation.
- Structured form remains available without an LLM.

The language model fills the same schema-driven form; it does not bypass or
replace it. It must not return trusted coordinates, executable solver code or
authoritative regulatory values.

### Phase 8: CP-SAT feasibility spike

Introduce OR-Tools only after representative fixtures demonstrate concrete
limitations in the bounded packer.

Compare:

- Valid-plan discovery rate.
- Runtime under fixed budgets.
- Diversity.
- Explainability of failures.
- Representation of wall thickness, reservations and circulation.
- Candidate-adoption fidelity.

Use the optional local Python service for CP-SAT. Keep the browser heuristic as
a fallback and pass every solver result through the same validator.

Do not add Gurobi or CPLEX until their licensing and deployment requirements
are justified.

## Test strategy

| Test layer | Required coverage |
| --- | --- |
| Input schema | Local `$ref` resolution, field rendering, conditional branches, additional-property rejection and cross-field validation |
| Pure geometry | Boundary contact, overlap, containment, reservation unions and empty usable regions |
| Brief validation | Unknowns, units, contradictory constraints and count preservation |
| Generator | Deterministic seeds, attempt budgets, cancellation and unmet requests |
| Validator | Every hard rule independently fails the correct candidate with an explanation |
| Ranking | Missing metrics, ties, changed weights, Pareto diversity and duplicate removal |
| Adoption | Stable IDs, exact geometry, rollback, inactive floors and stale fingerprints |
| Persistence | Old-project round trips, sidecar versioning, quota failure and recovery |
| UI | Preview does not mutate, stale campaigns disappear, keyboard operation and cancellation |
| Export | Accepted layout appears unchanged in SVG, PDF, PNG and package schedules |

Proposed tests:

```text
tests/planner-input-schema.test.cjs
tests/planner-requirements-ui.test.cjs
tests/planner-design-brief.test.cjs
tests/planner-layout-generator.test.cjs
tests/planner-layout-validation.test.cjs
tests/planner-layout-ranking.test.cjs
tests/planner-candidate-adoption.test.cjs
tests/planner-candidate-ui.test.cjs
```

These extend the existing Room Planner, bridge, model, reservation, persistence
and drawing selectors.

## Release gates

1. **G0 - Reviewed inputs:** schema-driven fields produce a validated,
   immutable and normalized brief without mutating the project.
2. **G1 - Deterministic validator:** existing layouts can be assessed without
   mutation.
3. **G2 - Candidate generation:** a bounded worker returns distinct valid
   candidates with reproducible seeds.
4. **G3 - Explainable comparison:** every ranking value has a definition and
   missing-value policy.
5. **G4 - Safe adoption:** selected geometry survives project compilation,
   Undo and export exactly.
6. **G5 - Optional AI:** natural-language parsing cannot bypass review or
   validation.
7. **G6 - Solver expansion:** CP-SAT demonstrates measurable value on
   versioned fixtures.

## First implementation milestone

The first milestone is to deliver the schema-driven requirement form and
normalization adapter, then extract the existing packer and independent
validator. This establishes a reviewed input boundary for candidate
enumeration, ranking, optional language-model extraction, CP-SAT and future
feedback-based learning without weakening HomePlanner's current project,
identity, Undo, persistence and export contracts.
