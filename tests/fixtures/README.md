# Phase 0 drawing acceptance inputs

`drawing-fixtures.cjs` exports `fixtureIds`, `createFixture(id)`,
`controllerFor(project)` and `buildScenes(project)` **test helpers**, not production
APIs. Each call returns fresh deterministic data. Run:

```powershell
node --test .\tests\drawing-fixtures.test.cjs
```

Each fixture contains a schema-1 `project`, optional test-only request metadata,
`annotationInputs`, and `limitations`. Persist only `project` with the existing
model/bridge. The active legacy context and supplemental floor records are
synchronized; inactive floors have separate stored contexts and edits.
`Model.createProject()` supplies the schema, with a fixed fixture project ID.
The bridge uses an in-memory capture/restore adapter without a DOM or optimizer;
it projects the authored synthetic contexts with the **real** `Model.buildScene`.
No helper supplies mock walls or scene geometry.

| Fixture | Purpose |
| --- | --- |
| `furnished-single` | Original four-room technical sample, six furniture objects, four hosted doors and four windows, explicit bed polarity and opening edits |
| `multiple-floors` | Different four-room/two-room layouts, repeated source identity with distinct floor namespaces, different wall/storey heights and isolated furniture/electrical edits |
| `setback-plot` | Asymmetric setbacks, east-facing site transform, neighboring mass, plot distinct from floor and building envelope, unverified regulatory metadata |
| `sparse-unknown` | Unprogrammed enclosure, absent plot/environment inputs, inferred wall thickness and unknown structural roles |
| `missing-context` | Valid blank project, no scene until geometry is supplied |
| `invalid-attachments` | Removed and missing wall hosts, orphan edits, missing furniture parent, unresolved and non-orthogonal opening geometry |
| `dense-annotations` | 24 rooms/desks/electrical intents, 20 doors, six windows, 96 test-only label/dimension inputs including long Unicode labels and coincident anchors |
| `non-cardinal-request` | Explicitly unsupported 32.5-degree authoring request alongside a valid cardinal baseline |

## Existing conventions and limits

These are original synthetic arrangements, not a tracing or reproduction of
uploaded artwork. They reuse conventions tested in `planner-model.test.cjs`:
metres; local x right/y down; floor origin `(0,0)`; a separate inset building
envelope; room module interfaces with 0.05 m half-internal-wall allowances;
preserved clear-carpet rectangles; real hosted aperture resolution; semantic,
floor-scoped identifiers. World ENU uses the **floor centre**, not the plot centre,
and the cardinal road/front heading. Building base plus ordered storey heights
sets physical elevation, not regulatory `plate.floorElevation`.

The model accepts only `N/E/S/W` front directions. Numeric heading support in
coordinate math alone does not establish arbitrary-bearing authoring. The
non-cardinal fixture does not inject a new project bearing field or silently
claim that the requested angle is rendered.

Schema 1 requires finite latitude/longitude and an IANA time zone. Default
coordinates here are assumed, not surveyed; unavailable optional inputs remain
absent/empty, not confirmed zero. Missing wall thickness deliberately exercises
the model's existing inference warning. All wall structural roles remain unknown.

`annotationInputs` is an external acceptance workload derived from actual room
carpets, **not** saved production annotations. Coincident anchors are deliberate.
There are no sheet primitives, PDF/SVG/PNG exporters, overlap resolution, structural
design, stairs/slabs, plumbing/drainage networks, engineering results, CFD or
lighting simulations in these fixtures. Furnishings and electrical intent do
not certify layout accessibility, service routes or installation readiness.
Diagnostic assertions establish retained uncertainty/invalid references, not
construction readiness. These tests do not replace browser or visual acceptance.
