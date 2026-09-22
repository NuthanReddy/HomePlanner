# Vastu direction preferences

## Purpose and status

This document preserves research for a potential **optional Vastu preference**
feature. It describes a culturally informed, explainable planning aid; it does
not define a rule engine currently implemented by HomePlanner.

Vastu is a living, interpreted tradition. Classical texts use named
*Vastu-purusha mandala* positions and building-specific functions rather than a
single universal modern room chart. Modern practitioners, regions, climates,
household practices, and source material can disagree. Therefore, any future
feature must select and display a named source profile and version rather than
claiming universal Vastu compliance.

This research is not scientific validation and must never be represented as
evidence of health, prosperity, safety, comfort, ventilation, daylight,
structural adequacy, energy performance, regulatory compliance, or construction
approval. It is independent of the statutory/technical requirements described
in [Regulatory basis](regulatory-basis.md), [Room Planner](room-planner.md),
and [Design guidance](design-guidance.md).

## Product boundary

An implementation should be an explicit opt-in cultural preference layer with
labels such as:

- **Vastu preferences (optional)**
- **Traditional Vastu preference (selected profile)**
- **Orientation basis: True north / Plan north / Unknown**
- **Traditional alignment: strong / partial / neutral / conflict / unknown**

It must state:

> This view compares the layout with the selected traditional preference
> profile. It does not establish legal compliance, safety, comfort, wellbeing,
> scientific performance, or construction approval.

Vastu must not override, conceal, or be blended into:

- Planning law, setbacks, land-use rules, or permission routes.
- Fire/life safety, sanitation, privacy, structural design, or utilities.
- Accessibility, circulation, ergonomic clearance, or door-swing conflicts.
- Daylight, ventilation, thermal, solar, flood, or other environmental studies.
- Site constraints such as roads, frontage, hazards, neighbouring buildings, or
  service access.

Existing manual room positions remain authoritative. A preference result can
annotate or rank suggestions, but must not silently move a saved layout.

## Orientation contract

The system must require and show its orientation basis:

1. **True north** — a supplied survey/site bearing and the preferred basis for
   a directional result.
2. **Plan/project north** — drawing-top orientation, which can differ from
   true north and is only an explicitly approximate alternative.
3. **Unknown** — no directional comparison is available; unknown must not be
   styled as a conflict or assigned a default direction.

Display a north arrow, the heading/rotation used by the calculation, and the
room direction measured from the current Room Planner geometry. A sheet may be
rotated for readability without changing the stored true-north transform. This
is consistent with the distinction between Project North and True North in
[Autodesk Revit documentation](https://help.autodesk.com/cloudhelp/2023/ENU/Revit-Model/files/GUID-ED5BC6E5-0B9D-477C-8F08-692A44E28646.htm).

Use geographic/cardinal coordinates, applying the site's transform exactly
once. Do not interpret screen up as north. Measure a room's centroid for this
coarse room-zone comparison. For a centroid near a 45-degree-sector boundary,
interpolate or report the two adjacent sectors and mark the result
**boundary-sensitive**, rather than abruptly switching the outcome.

## Baseline modern-practice profile

The following `modern-common-practice-v1` matrix consolidates recurring
recommendations in selected contemporary secondary sources. It is a
transparent default, not a classical-text reconstruction or a standardized
authority.

The runtime-oriented copy is
[`../configs/vastu-direction-preferences.json`](../configs/vastu-direction-preferences.json);
a documentation-local copy is also available as
[`vastu-direction-preferences.json`](vastu-direction-preferences.json). Both use
lowercase `snake_case` room keys and retain the profile ID, ordinal scale, and
limitations so the numbers are not detached from their cultural and technical
boundaries.

Weights are ordinal:

| Weight | Meaning |
| ---: | --- |
| `+2` | Strongly preferred in the selected profile |
| `+1` | Preferred or commonly accepted alternative |
| `0` | Neutral, weakly specified, or materially variable |
| `-1` | Generally discouraged in the selected profile |
| `-2` | Strongly discouraged in the selected profile |

They are not probabilities, health outcomes, quality percentages, or
engineering values.

| Space | N | NE | E | SE | S | SW | W | NW |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Entry / main door | +2 | +2 | +2 | -1 | -1 | -2 | 0 | +1 |
| Living room | +2 | +2 | +2 | 0 | -1 | -1 | 0 | +1 |
| Kitchen | -1 | -2 | +1 | +2 | 0 | -2 | 0 | +1 |
| Dining room | 0 | 0 | +1 | +1 | +1 | 0 | +2 | 0 |
| Master bedroom | -1 | -2 | -1 | -1 | +1 | +2 | +1 | 0 |
| Other adult bedroom | 0 | -1 | 0 | -1 | +1 | +1 | +1 | +1 |
| Children's bedroom | +1 | 0 | +1 | -1 | 0 | 0 | +1 | +2 |
| Guest bedroom | 0 | -1 | +1 | 0 | 0 | 0 | 0 | +2 |
| Pooja / prayer room | +1 | +2 | +1 | -2 | -1 | -2 | -1 | -1 |
| Study / home office | +2 | +2 | +2 | -1 | 0 | 0 | +1 | 0 |
| Bathroom / toilet | -1 | -2 | -1 | -1 | 0 | -2 | +2 | +2 |
| Stairs | -1 | -2 | -1 | +1 | +2 | +2 | +2 | +1 |
| Heavy / general storage | -1 | -2 | -1 | 0 | +1 | +2 | +1 | 0 |
| Utility / laundry | -1 | -2 | 0 | +2 | +1 | 0 | 0 | +1 |

### Reading the baseline

High-agreement anchors in modern guides are:

- Pooja/prayer in **NE**, with E/N as secondary options.
- Kitchen in **SE**, with **NW** a common fallback.
- Master bedroom in **SW**, sometimes S.
- Guest bedroom in **NW**.
- Toilet/WC in **W/NW**.
- Stairs and heavy/general storage in **S/W/SW**, and away from NE.

Lower-confidence or materially variable categories include living rooms,
children's rooms, dining, bathing rooms/WCs, and utility/laundry. A `0` weight
is intentional: it identifies unresolved variation instead of inventing
certainty.

## Room-specific research and modelling distinctions

| Space | Common modern guidance | Important variation or modelling distinction |
| --- | --- | --- |
| Main entry | N/E/NE are recurring preferences. | Classical guidance is often perimeter-*pada*-specific. Model facade side, exact door location on that side, and entering direction separately. |
| Living room | N/E/NE are common. | NW, W, and S appear in variants. There is no direct classical equivalent to the modern family living room. |
| Kitchen | SE is the strongest modern consensus; NW is a common fallback. | Distinguish room zone, stove, sink/water, and cook-facing direction. *Brihat Samhita* 53.118 supports SE, while *Manasara* 36.26 assigns N/NE/Parjanya for ordinary dwellings. |
| Dining | E/SE/S/W all occur in modern guidance. | *Manasara* 36.28 gives S/SW. Keep room zone separate from diner-facing direction. |
| Master bedroom | SW is the recurring preference, with S sometimes accepted. | It is primarily a modern category, not a securely matched classical room type. |
| Other adult bedroom | S/W/NW are common alternatives. | Keep room zone distinct from bed position and head direction. *Brihat Samhita* 53.124 advises against sleeping with head N or W. |
| Children's bedroom | W/NW is common; N/E/NE occur as variants. | Some modern sources instead suggest SW. Historic boys'/girls' compound quarters are not direct equivalents of a modern child's bedroom. |
| Guest bedroom | NW is the strongest recurring recommendation. | E and SE variants occur. Do not claim a secure classical NW guest-bedroom rule. |
| Pooja/prayer | NE is strongest, with E/N secondary. | Distinguish room zone, altar/image position, and worshipper-facing orientation. *Brihat Samhita* 53.118 places deities NE; *Manasara* has worship-function-specific variants. |
| Study/home office | NE/E/N are recurring modern choices. | User facing E/N is often advised. *Manasara* places its study pavilion differently, near S/SE, so expose the conflict. |
| Bathroom | NW/W is common in modern sources. | S and E/NE variants occur; a classical bathing room is not equivalent to a combined modern bath/WC. |
| Toilet/WC | W/NW is common. | S/W and SE variants occur. Keep bathroom zone, toilet zone, and seat axis distinct; north-south seat-axis advice is inconsistent. |
| Stairs | S/W/SW, avoiding NE/centre, are recurring modern suggestions. | Model footprint, ascent vector, and handedness separately. Modern sources vary on ascent direction; *Manasara* allows steps at corners/cardinal directions. |
| Storage | Heavy/general storage commonly favours S/W/SW. | Utensils, grain, pantry, treasury, and valuables have different traditional assignments; do not collapse them without a declared profile. |
| Utility/laundry | SE appears most often; NW is a fallback. | No verified explicit classical residential-laundry rule was identified; retain low confidence. |

## Scoring and presentation

Show an explainable per-room result before any aggregate:

- Selected profile and version.
- Room/function rule and its provenance.
- Orientation basis and measured room direction.
- Ordinal weight and alignment band.
- Whether the outcome is a common preference, documented alternative, classical
  textual conflict, boundary-sensitive result, or not evaluated.

Preferred alignment bands are **strong alignment**, **partial alignment**,
**neutral/no preference**, **conflict with selected profile**, and **not
evaluated**. Do not color missing orientation or absent geometry as red.

Avoid a single authoritative “Vastu score” or “Vastu-compliant” label. If an
aggregate is useful, call it a **weighted preference index**, normalize it as a
weighted mean over evaluated requested spaces, cap and display user importance
weights, and preserve per-room explanations. Never add raw room scores or
display pseudo-exact percentages. Practical constraint conflicts must remain
separate from the cultural preference index.

Profiles should be visible and editable rather than silently averaged:

- `modern-common-practice-v1` — the transparent baseline matrix above.
- One or more named classical profiles that preserve their text/translation,
  room/function mapping, and unresolved mapping assumptions.
- A user-created custom profile.
- No cultural preference.

If profiles disagree, display **profiles differ**. Do not resolve disagreement
by inventing a universal average. A future implementation may separately
configure children and guest rooms, bathroom and toilet rooms, and detailed
storage types.

## Recommended UX and wording

Use a compass matrix/heatmap with a legend plus an inputs-and-assumptions panel.
The panel should show the selected profile/source/region, profile version,
orientation source, north arrow, room geometry used, and any unknowns.

Useful user-facing wording:

> This optional score summarizes recurring recommendations in the selected
> Vastu profile. Traditions and practitioners differ. It is not scientific
> validation, a safety assessment, or evidence of legal/building-code
> compliance.

> Resolve statutory, safety, access, daylight/ventilation, and site constraints
> first. Vastu preferences are secondary and may conflict.

> Rules vary by tradition, region, practitioner, and household. Review the
> source profile before acting.

Do not infer a person's religion, region, or beliefs from their name, location,
or selected plot. Do not describe any direction as correct, safe, healthy,
prosperous, approved, or universally compliant. Never label the visualization
as measured airflow/daylight or as a performance model.

## Evidence and sources

### Classical/context sources

These primary or translated classical materials establish that source-specific
rules and conflicts exist. They should not be flattened into a purported
universal chart.

- P. K. Acharya, [*Architecture of Manasara* scan](https://archive.org/details/in.ernet.dli.2015.108320).
- [*Manasara*, chapter 36: residential buildings](https://www.wisdomlib.org/hinduism/book/manasara-english-translation/d/doc421084.html).
- [*Manasara*, chapter 7: mandala/pada positions](https://www.wisdomlib.org/hinduism/book/manasara-english-translation/d/doc421053.html).
- [*Brihat Samhita*, chapter 53: house building](https://www.wisdomlib.org/hinduism/book/brihat-samhita/d/doc229297.html).
- [IGNCA Vastu Shastra course/context and bibliography](https://ignca.gov.in/divisionss/academic-unit/short-term-certification-course/vastu-shastra/).
- [Jain University teaching material](https://jainuniversity.org/wp-content/uploads/2018/10/VASTU-AND-DIRECTIONS.pdf), useful cautiously because its bibliography and internal variants are limited.
- [Architecture-journal discussion and bibliography](https://worlduniversityofdesign.ac.in/JAARD/paper-5-vol-3-no-1/).

### Modern-practice sources

The baseline weights are drawn from recurring patterns in modern interpretive
guides. These are secondary sources, are not standardized technical
authorities, and must retain their variations in the UI:

- [Livspace: general home guidance](https://www.livspace.com/in/magazine/basic-vastu-home).
- [Livspace: kitchen guidance](https://www.livspace.com/in/magazine/vastu-tips-for-your-home-kitchen).
- [Livspace: bedroom guidance](https://www.livspace.com/in/magazine/vastu-tips-for-bedroom).
- [Livspace: bathroom guidance](https://www.livspace.com/in/magazine/vastu-bathroom-vastu).
- [Livspace: wardrobe/storage guidance](https://www.livspace.com/in/magazine/vastu-for-wardrobe-in-bedroom).
- [Architectural Digest India: living rooms](https://www.architecturaldigest.in/web-stories/7-vastu-tips-living-room/).
- [Architectural Digest India: kitchens](https://www.architecturaldigest.in/web-stories/make-kitchen-vastu-compliant/).
- [Architectural Digest India: bedrooms](https://www.architecturaldigest.in/web-stories/vastu-tips-serene-bedroom/).
- [Architectural Digest India: pooja rooms](https://www.architecturaldigest.in/web-stories/8-ways-to-design-a-serene-pooja-room/).
- [Housing.com: home design](https://housing.com/news/vastu-for-home-design/).
- [Housing.com: staircases](https://housing.com/news/staircase-vastu-for-east-facing-houses/).
- [Housing.com: kitchen variants](https://housing.com/news/ways-to-remove-vastu-dosh-from-kitchen/).
- [Housing.com: study guidance](https://housing.com/news/vastu-tips-for-students/).
- [Beautiful Homes: bathroom guidance](https://www.beautifulhomes.asianpaints.com/blogs/bathroom-vastu.html).
- [Houseyog: general home guidance](https://www.houseyog.com/blog/vastu-tips-for-home-essential-guide-for-new-house-construction-interior-design/).
- [Houseyog: staircase guidance](https://www.houseyog.com/blog/staircase-vastu-best-direction-rules-mistakes/).

### Cultural-variation and technical-boundary sources

- Ghom and George, [“Scientific Rationality in Vaastu Purusha Mandala: A Case
  Study of Desh and Konkan Architecture”](https://jomardpublishing.com/UploadFiles/Files/journals/NDI/V5N2/Ghom_George.pdf),
  discussing regional/climatic adaptation rather than an immutable room table.
- [“Redefining Vastu Shastra Principles With Reference To Contemporary
  Architectural Practices in India”](https://doi.org/10.47750/PNR.2022.13.S08.48).
- [BIS National Building Code context](https://www.bis.gov.in/product-services/national-building-code/).
- [National Building Code 2016 publication](https://www.services.bis.gov.in:8071/php/BIS_2.0/biscirculars/NCBOct2016.pdf).
- [DEPwD accessibility guidance](https://depwd.gov.in/en/guidelines/).
- [IS 7662 Part 1: physical building orientation](https://archive.org/details/gov.in.is.7662.1.1974/page/n13/mode/2up).

## Future implementation checklist

Before productizing this research:

1. Keep orientation, profile, version, source references, and per-space
   overrides as explicit saved inputs.
2. Bind results to the active room geometry, true-north/project-heading inputs,
   and project revision; reject stale results.
3. Preserve nullable orientation and unresolved room categories as unknown.
4. Use current Room Planner geometry, stable IDs, reversible commands, and one
   undoable gesture per deliberate layout change.
5. Keep the feature advisory-only: it may rank suggestions but cannot bypass
   statutory, safety, accessibility, environmental, structural, or site checks.
6. Add tests for true-north rotation, all sector boundaries, missing
   orientation, variant/profile changes, stale results, manually edited layouts,
   and non-mutation while reviewing a result.
