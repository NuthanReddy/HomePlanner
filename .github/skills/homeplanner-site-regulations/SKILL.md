---
name: homeplanner-site-regulations
description: "Research and implement HomePlanner site, plot and regulatory scenarios with correct units, road/frontage orientation, setbacks, height/floor limits, TDR, source provenance and property-report boundaries. Use for Plot Planner, GHMC/HMDA/Telangana rule changes, site geometry, approval labels, prohibited-property lookup, flood/site evidence or legal-scenario comparisons."
---

# Site and regulatory planning

## When to use

Use for site measurements, Plot Planner logic, rule-source updates, compliance
wording or property evidence. Pair with `homeplanner-architecture` for geometry
and `homeplanner-project-integrity` for shared state or import/persistence changes.

## Repository anchors

- `index.html`: `compute`, `fillHeights`, `envelopeFor`, `roomPlateFor`,
  `scenarioSettings`, rule tables and explicit source links.
- `planner-model.js`, `planner-projection.js`: plot/building/plate separation,
  scenario metadata and site transforms.
- `planner-location.js`: opt-in device location.
- `app.py`, `prohibited-properties.js`, `prohibited_properties`: explicitly
  connected property lookup, parsing/OCR and local report caching.
- Read [regulatory basis](../../../docs/regulatory-basis.md),
  [plot geometry](../../../docs/plot-geometry.md), and
  [property reports](../../../README-prohibited-properties.md).

## Required inputs

Identify jurisdiction and applicable rule/edition/date; supplied versus surveyed
dimensions; units; gross and net boundary; road edges and widths; elected
frontage; building use/category; height, floor spacing and stilt assumptions;
TDR conditions; and whether a custom setback scenario is active.

For property evidence identify the exact report/source/date and query scope.
Unknown boundary, elevation, ownership or prohibition status must remain unknown.

## Workflow

1. Trace the actual rule and geometric branches before changing a number.
2. Verify the authoritative publication and amendments. Use archived OCR as a
   search aid, then check the original document for decisive numbers/conditions.
   Record conflicts, missing amendments and inaccessible official sources.
3. Convert units explicitly. Keep area, length, frontage/depth, cardinal
   direction and local/site coordinates separate.
4. Evaluate combined constraints: plot band, elected frontage/road conditions,
   height band, setbacks, open-space deductions, parking and qualifying TDR.
   A single area threshold is not a permission decision.
5. Preserve required setbacks separately from applied what-if values.
   Non-compliant geometry must remain flagged in downstream scenes/drawings.
6. Keep a selected G+n count separate from the regulatory ceiling and from the
   number of actual editable storeys. Do not fabricate missing floors.
7. Keep property/report provenance attached to parsed results. A failed fetch,
   unreadable scan or empty parse is not evidence that a property is clear.
8. Use existing coordinator/state and explicit external-data actions. Do not
   geolocate, query reports, overwrite caches or change authoritative site
   coordinates as a side effect of navigating or exploring an analysis.
9. Verify boundary cases and update related source notes and UI qualifications.

Example: when changing a TDR note, distinguish the repository's 750-2,000 sq m
18-21 m band from the separate above-2,000 sq m extra-floor provision. Recheck
current amendments before applying either; never shorten the first range to
750-1,000 merely to match remembered wording.

## Do not do

- Do not present a scenario, parsed report, map pin or generated drawing as a
  sanctioned plan, survey, title opinion or professional/legal certification.
- Do not silently waive road widening, parking, fire, land-use or open-space
  requirements when a custom setback override is enabled.
- Do not infer that an unentered neighbouring building or unknown flood/site
  condition is absent.
- Do not conflate TDR entitlement, discretionary compounding and regularisation.
- Do not replace the current edited Room Planner geometry with a generic plot
  template when a study or report requests the active plan.
- Do not expose stored project/property data to external services without the
  user's scoped action.

## Calculation and Python references

Before changing numerical site logic, read the
[equations and worked calculations](references/calculations.md). They separate
exact unit conversions, rectangular geometry and the implemented rule branches
from legal eligibility. In particular, a rounded metre road band is not an exact
conversion of its feet label.

Use [Python calculation and rendering tools](references/python-tools.md) for
offline reference work. The [standalone example](scripts/example.py) uses only
the standard library, preserves unknown/invalid inputs as errors and emits
synthetic results plus labelled SVG; it is not a second permission engine.

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-site-regulations\scripts\example.py --check
```

## Validation

For plot/rule changes:

```powershell
node --test tests\plot-planner.test.cjs tests\planner-model.test.cjs
```

For property UI or API changes, add the relevant existing selectors:

```powershell
node --test tests\prohibited-properties.test.cjs
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_property*.py"
```

Test thresholds on both sides, unit equivalence, every frontage, widening
deductions, custom/required differences, failed report parsing, preserved caches
and unchanged project data after cancelled requests.

## Output contract

Separate supplied inputs, interpreted rule/scenario, source evidence,
qualifications and unknowns. State which limit changed and its downstream
geometric effects. Do not say "approved", "safe to build" or "clear title" based
only on this tool.

## References

Read [source hierarchy and current evidence](references/sources.md) for legal
updates. The local implemented rules are evidence of code behavior, not proof
that every current applicable amendment has been incorporated.
