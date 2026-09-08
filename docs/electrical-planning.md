# Electrical point planning

This is an **annotation, device-intent schedule and ergonomic review layer**.
It is not an electrical installation designer, an accessibility certificate, a
lighting calculation, or a substitute for a qualified electrical professional.
There is no overall green/compliant state.

The panel is local. It does not fetch anything, install dependencies, use an
icon/font service, start autosave, or upload a plan. Public sources below are
links and original summaries; no source-book pages, scans or tables are bundled.

## Using the panel

1. Open Electrical and choose the active floor. This uses the same floor selector
   command as the other workspaces, not the regulatory floor allowance.
2. Choose **New point**, name the point, describe the device/purpose, and select
   Socket, Switch/control, Light, Appliance intent or Data/communication.
3. Choose the room served and an actual wall. Read its oriented start/end,
   thickness and length. Select the physical face and enter the along-wall offset
   in metres. A label alone cannot establish a physical host.
4. Enter elevation **above this floor's finished floor** and its reference datum.
   Blank stays unknown, not zero. Plate centre, plate bottom and operable-part
   centre are different measurements.
5. Lights may instead use a room ceiling or floor mounting point with local
   x/y coordinates. Its height must agree with the supplied surface. The optional
   height-fill buttons explicitly record a user assumption in the notes; no
   surface height is filled merely by changing the anchor selector.
6. Optionally enter the plate/plug envelope, contextual reach interval, approach
   dimensions, related furniture measurements and water-exposure context.
   Blank dimensions are never treated as measured zeros.
7. Save. Select points through the diagram, named list or schedule to edit,
   review or delete them. Selection does not write a project revision. SVG point
   buttons support Enter/Space; the list is an equivalent ordinary-button route.
8. Shared Undo/Redo reverses point creation, acceptance, editing and deletion.
   The floor slices, project JSON and the separately controlled IndexedDB
   persistence feature retain the records. This panel is not a second store.

The non-colour legend distinguishes S/socket, W/switch, L/light, A/appliance and
D/data. `?` means review is needed; `!` means a conflict/warning needs review.
**Unsupported drafts are listed but have no floating point marker.**
The schedule lists counts actually requested, not quantities derived from area.

## Record schema

One record is one requested point. All planar distances are metres in the shared
building-local frame; elevations are metres, positive upward.

```js
{
  version: 1,
  id: "floor-id:electrical:unique-suffix",
  floorId: "floor-id",
  roomId: "floor-id:room-id", // null if not assigned
  type: "socket",           // socket | switch | light | appliance | data
  label: "Bedside phone charger",
  purpose: "Phone charger",
  loadCategory: "low",      // unknown | low | ordinary | high; NOT a rating
  anchor: {
    kind: "wall",
    wallId: "floor-id:wall-id",
    face: "right",          // left | right, looking along oriented start -> end
    offsetM: 1.4,
    basis: {
      start: { x: 0, y: 0 },
      end: { x: 6, y: 0 }
    }
  },
  elevationM: null,
  elevationReference: "plate-centre",
  // plate-centre | plate-bottom | operable-part-centre | mounting-point
  envelope: {
    widthM: null, heightM: null, depthM: null, referenceOffsetM: null
  },
  inputs: {
    wetArea: "unknown",     // unknown | dry (explicit assumption) | wet
    reachMinM: null, reachMaxM: null,
    approachWidthM: null, approachDepthM: null,
    furnitureId: null,
    furnitureBaseM: null, furnitureHeightM: null,
    headboardBaseM: null, headboardHeightM: null, headboardDepthM: null,
    note: ""
  },
  origin: { kind: "manual" }
}
```

A light surface anchor is `{kind:"ceiling"|"floor", x, y}`, with no invented
`wallId`; its elevation datum is `mounting-point`. A floor mounting point
explicitly entered as zero is different from an unset height. A ceiling mount
uses the supplied nominal ceiling elevation only after the user confirms/enters
it. Pendant drop, sloping ceilings, slab voids and fixture support are not
modelled by a room rectangle.

`envelope.widthM` is along the wall; `depthM` includes projection from the face,
such as an inserted plug. For plate centre the vertical band extends half the
height each way. For plate bottom it extends upward. For operable-part and
mounting-point datums, `referenceOffsetM` is the distance of the datum above the
envelope bottom; if it is not known, the full vertical band is unknown.

Related furniture `baseM`/`furnitureBaseM` and headboard bases in this feature are
relative to the finished floor, not absolute world z. Their heights extend above
those bases. Headboard depth is a strip **inside the bed footprint at its actual
N/E/S/W head end**. This is an explicitly supplied rectangular approximation, not
a reconstruction of a manufacturer's headboard or cabinetry. Scene furniture
normally has no height: absent inputs remain unassessed. Optional scene
extensions `furniture.{baseM,heightM,headboard:{baseM,heightM,depthM}}` follow the
same convention; the base scene contract does not require those extensions.

Unrecognised extra metadata on an existing record is preserved by editing.
Derived findings and marker positions are not written into the point. Suggested
records additionally retain:

```js
origin: {
  kind: "suggestion",
  context: "bedside", // bedside | door-latch | passage | desk
  targetId: "floor-id:furniture-or-opening-id",
  geometryFingerprint: "exact JSON signature of the relevant supplied scene",
  sourceIds: ["mohua-2021", "product-heuristic"],
  reason: "Original explanation of the geometric candidate",
  assumptions: ["User-chosen positioning gap, missing functional inputs, ..."],
  manuallyEdited: true // added only after an explicit field save
}
```

The fingerprint is immutable provenance/staleness metadata, not a second editable
geometry model. It excludes electrical records and project revision, so accepting
one proposal does not itself invalidate other proposals from the same geometry.
It includes floor datum, physical walls/openings and actual furniture head state.
Copies to a different floor intentionally require renewed suggestion review.

## Physical anchors and honest failure states

- `HomePlannerModel.wallPoint(wall, offsetM)` supplies the shared centreline
  coordinate. This module adds half the supplied wall thickness in the selected
  normal direction, rather than placing a wall device on the centreline.
- In the x-right/y-down local plan, the left normal of unit tangent `(tx, ty)` is
  `(ty, -tx)`; the right normal is its negative. Neither is geographic north.
  No geographic-heading rotation is applied to this local overlay.
- Absolute device z is `scene.floorElevationM + elevationM` exactly once. The
  wall's `baseM` is absolute z; vertical apertures use finished-floor-relative
  `sillM` and `heightM`.
- Stable wall IDs carry anchors with wall motion. An opposite collinear
  orientation remaps offset to `currentLength - storedOffset` and reverses the
  face. Resolution is read-only; it never writes on selection.
- Shortening a wall, exceeding a wall's height, or extending a known plate beyond
  an endpoint retains an invalid existing anchor as a draft. New invalid mounts
  are rejected. No numeric offset/elevation is silently clamped.
- Deleted/full-open hosts, and unsupported partial-wall offsets, have no valid
  marker. Metadata can still be edited on an existing draft without changing its
  mount; rehosting requires an explicit supported host selection.
- Missing wall thickness or usable solid-wall geometry prevents a face marker.
  Missing elevation or plate dimensions on a known solid wall column may show a
  **reference point needing review**, never a claim that the whole device fits.
- A window's plan projection does not by itself prohibit a point below it.
  The device/reference vertical band is compared with the actual sill/aperture
  band. Known below/above-aperture wall material supplements the plan's solid
  segments. An intersecting band is unsupported; missing aperture/height data
  is unresolved, not clear. Contact at a band boundary is conservatively reviewed.
- When a wall supplies `solidSections:[{startM,endM,sillM,heightM}]`, those exact
  along-wall/vertical solid rectangles additionally govern support. Their union
  must cover the whole supplied device band/width, including infill between
  stacked windows. `sillM` uses the same finished-floor-relative datum as
  apertures. Missing sections are not invented from another opening.
  Malformed exact geometry is unresolved. An unset-height reference can be
  located only where a full-height solid column is established. Original scenes
  without this additive field retain the solid-segment/aperture-band fallback.
- Existing electrical arrays and missing older optional fields are preserved.
  Malformed imported records remain visible drafts. This editor never silently
  repairs IDs, adopts a neighbouring wall or overwrites another floor's array.

Optional explicit split/merge lineage is supported as a scene extension:

```js
scene.wallLineage = [{
  sourceWallId, targetWallId,
  sourceStartM, sourceEndM, targetStartM, targetEndM
}];
```

The source interval must increase; a decreasing target interval also reverses
the face. The mapping must identify exactly one surviving target. A split
boundary with multiple matches, or a split without lineage, remains a draft.
The base scene contract does **not** promise this extension. Until a model owner
supplies it, missing wall IDs are not recovered by approximate geometry matching.
Arbitrary geometry similarity is not reliable host identity.

## What the checks do and do not establish

Findings distinguish geometry comparisons, ergonomic warnings, incomplete inputs
and professional electrical review. There is deliberately no aggregate pass.
“Clear” is scoped only to a named supplied-geometry comparison.

| Check | Required evidence and limitation |
| --- | --- |
| Reference height | Actual elevation, operable-part datum and user-entered contextual reach interval. Plate-centre/bottom heights do not automatically become operable-part heights. No India numeric preset is bundled. |
| Approach | User-entered width/depth extends outward from the actual chosen face. Furniture-footprint intersections are identified. Absence of such an intersection does not prove a walking route, knee clearance, usable operation or reach over a counter. |
| Furniture/counter | Known footprint, actual base/height and full plate/plug envelope. Plan-only overlap with unknown heights is not claimed to be a verified vertical obstruction or clearance. |
| Headboard | Actual head polarity, headboard depth/base/height, and device width/depth/vertical band. A missing headboard profile is explicitly incomplete; a bed rectangle is not the whole headboard. |
| Door swing | Shared `doorGeometry` plus known hinge/swing. The geometric sweep is checked against device/approach footprints; point obstruction also needs door/device vertical bands. Door operating fraction is not used to invent a latch or erase a possible swing. Incomplete geometry stays unknown. |
| Window | Along-wall overlap **and** vertical aperture/device bands. Missing bands are never turned into a below-window pass. |
| Wet area | Bathroom/toilet/wet-room contexts always require professional review, even if a user marks them dry. Unknown water exposure is not assumed dry. Actual fixtures, zones, protection and local rules are not supplied. |
| High-load/appliance | Qualitative device intent prompts circuit/protection/isolation and service-access review, never a current rating, breaker size, wire size, RCD design or assumed dedicated circuit. |
| Lighting | A symbol does not establish lux, glare, uniformity, fixture support or illuminance adequacy. |

No medical diagnoses are collected. Functional preferences and contextual
measurements are sufficient. There are no inferred appliance watts, heat gains,
circuits, phase allocations, wiring routes or installation approvals.

## Suggestions

Suggestions are explainable geometric candidates, labelled **product
heuristics**, not national standards. The user supplies the device purpose,
point count and a positioning gap/spacing in metres. The count does not come from
floor area. A preview never edits the project.

- Bedside candidates use the actual N/E/S/W head end, including square beds.
  Candidate distance is displayed, not represented as proven functional reach.
- Door controls use an actual hinged door and `doorGeometry`'s closed-leaf/latch
  endpoint, not an aperture-width substitute when a nominal leaf width differs.
  Unknown hinge/swing or missing closed-leaf geometry prevents a latch suggestion.
- Permanent passages have no latch. Candidates use an actual surviving nearby
  wall face; a removed partition is not quietly reused.
- Desk/counter candidates reference the selected furniture footprint and remain
  subject to real plug envelopes, heights, depth, approach and service review.
- Automatic bathroom/wet-room proposals are disabled; manual annotations still
  carry professional-review warnings.

Candidates are individually accepted or rejected, with alternative surface
information where available. An unsupported requested placement produces an
unmet-need message, not clamping or automatic extra points. A changed scene
prevents acceptance of stale previews. Accepted points remain physically
wall-mounted when furniture moves, but their original suggestion is flagged
stale. Shared Undo reverses each individual acceptance.

## Public primary sources and limits

Research review date: **8 September 2026**. Publication, legal commencement,
edition and access/review date are different metadata. The following registry
provides context, not a complete legal-applicability finding for a particular
private dwelling or site. It does not reproduce protected source tables.

| ID / primary source | Context and limitation |
| --- | --- |
| `mohua-2021` — [MoHUA, Harmonised Guidelines and Standards for Universal Accessibility in India 2021, official NIUA PDF](https://niua.in/intranet/sites/default/files/2080.pdf) | Section 4.15, printed pp. 246–247, addresses controls, operation, obstruction and usable approach. Section 6.1 and the kitchen/bedroom discussion around printed pp. 296–297 support considering furniture and unobstructed connections. The reviewed text contains differently contextualised 350-mm and 400-mm corner statements; this software does not flatten them into a universal setback. |
| [PIB notification history, 2023](https://pib.gov.in/PressReleaseIframePage.aspx?PRID=1932296) | Context for notification under the RPwD Rules. Notification history alone does not establish all current private-dwelling or local-site obligations. |
| [CEA, Measures relating to Safety and Electric Supply Regulations, 2023](https://cea.nic.in/wp-content/uploads/regulations_cpt/2023/06/pdf_100_183_English-1.pdf) | Regulations 14, 31, 43 and 44 provide relevant standards/competent-work/protection context. Point placement alone cannot demonstrate earthing, protection or compliance. |
| [CEA official safety-regulations listing](https://cea.nic.in/regulations-category/measures-relating-to-safety-and-electric-supply/?lang=en) and [published 2026 amendment](https://cea.nic.in/wp-content/uploads/regulations_cpt/2026/04/_____________2026.pdf) | The reviewed amendment states commencement on **1 April 2027**. It is not represented as already effective on the September 2026 research date. Confirm current commencement and amendments before professional design. |
| [CPWD, General Specifications for Electrical Works, Part I Internal, 2013](https://cpwd.gov.in/WriteReadData/Publication/Internal2013.pdf) | Engineering-specification conventions include contextual box-bottom measurements and older standards references. They are not a universal current socket-height preset. |
| [BIS, Electrical Safety Handbook, 2022](https://www.bis.gov.in/wp-content/uploads/2022/08/Handbook-_Electrical-safety-_Final.pdf) | A non-comprehensive educational handbook referring to NEC/IS 732:2019; it does not replace the applicable full standard or professional verification. |
| [BIS National Building Code overview](https://www.bis.gov.in/standards/national-building-code/?lang=en) and [authorised standards access](https://www.bis.gov.in/know-your-standard/?lang=en) | Model-code/adoption context and access to current standards/amendments. Full IS 732 bathroom-zone requirements and site-specific adoption were not established in the research. |
| [U.S. Access Board, Operable Parts](https://www.access-board.gov/ada/guides/chapter-3-operable-parts/) | Supplementary reach/obstruction reasoning only. It is not an Indian legal profile or a source for imported bathroom exclusion radii. |
| `product-heuristic` — this module's original candidate algorithm | User-defined count/gap plus the current scene's geometry. No claim of code-prescribed location, reach, circuit assignment or safety approval. |

Telangana/GHMC/HMDA applicability, full current electrical rules, actual fixtures,
manufacturer envelopes and a qualified installation review are outside the
supplied evidence. Check them for the actual project. Public availability is not
permission to redistribute copyrighted manuals or standard tables.

## Parent integration and tests

The coordinator loads `electrical-planner.css` and, after the shared model and
`HomePlanner` startup, `electrical-planner.js`. The script automatically mounts
`#electricalWorkspace`; explicit mounting is also available:

```js
const workspace = HomePlannerElectrical.mount(
  document.getElementById('electricalWorkspace'),
  HomePlanner,
  HomePlannerModel
);
// workspace.render(); workspace.destroy();
```

Required coordinator API: `getProject`, `getScene`, `getSelection`, `subscribe`,
`select`, `execute`, and existing shared history methods. Point writes use only
`execute({type:"set-electrical", value:[...]})`. Floor navigation uses
`execute({type:"select-floor", id})`. Floor selectors/JSON/IndexedDB must preserve
the complete electrical records, null heights and nested anchor IDs. No
additional database or `localStorage` key is introduced.

The generic shared inspector may refer to the selected electrical ID; this panel
owns its fields and reviews. Parent geometry edits must preserve orphan records,
not filter them out of `project.electrical`. `getScene()` must describe the same
floor as `project.activeFloorId`, including its actual floor elevation.

Pure helpers are available through both `HomePlannerElectrical` and CommonJS:

- `validatePoint(point, floorId?)` returns structural/input error strings.
- `wallPoint(wall, offsetM, model?)` and `wallFrame(wall, face)` supply the common
  local anchor frame without silent range correction.
- `verticalBand(point)` and `verticalOverlap(a, b)` return explicit unknowns.
- `solidSectionsCover(sections, startM, endM, band)` tests coverage of the whole
  supplied mount rectangle by exact wall material, returning an explicit unknown
  for missing/invalid geometry or height.
- `mapWallAnchor(anchor, scene)` is read-only reversal/explicit-lineage mapping.
- `resolveAnchor(point, scene, model?)` returns `drawable`, `position`, `checks`
  and mapping information; a drawable reference point is not a clearance pass.
- `reviewPoint(point, scene, model?)`, `headboardRect`,
  `sectorContains` and `sectorTouchesPolygon` provide scoped geometric reviews.
- `geometryFingerprint`, `suggestPoints` and `acceptSuggestion` implement stale,
  reversible proposals; only acceptance writes to the supplied coordinator.
- `savePoint`, `deletePoint`, `readPointForm` and the render helpers are testable
  without installing a framework.

Run the existing Node built-in runner:

```powershell
node --test .\tests\electrical-planner.test.cjs
```

Tests use a contract scene/controller stub, not edits to the model owner's
implementation. They cover null heights, datums, invalid offsets, vertical
window bands, actual wall faces, floor elevations, four head polarities, missing
and measured obstruction data, door geometry, permanent portals, orphan
preservation, explicit split/reversal mapping, count-driven/stale suggestions,
shared selection/history, escaping and floor-slice/JSON round trips.
