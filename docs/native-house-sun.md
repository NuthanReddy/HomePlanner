# Actual Design house sunlight in native Solar

`HouseSunStudy` restores actual **whole-house direct sunlight hours**, rather
than showing a legacy-only placeholder. The parent supplies the exact mounted
`PlannerApi` from `NativeDesign.onPlannerChange`; no controller, layout or
envelope is created inside Solar. A schema-1 project must be explicitly opened
in Design, and every modeled floor must compile.

## Geometry and source ownership

The imported Design working copy is authoritative for net plot bounds, building
placement, heading, modeled storeys, elevations, walls/openings, roofs and
obstacles. The adapter calls incumbent `HomeSunExposure.prepareScenes(project,
planner.getScenes())` **once on raw scenes**, then passes those detached scenes
directly to `BuildingPhysics.createSunlightStudy`. The plot-origin translation
is never applied to already-projected drawing scenes. Missing plot, unknown
heights, invalid geometry, uncompiled floors and ambiguous stacked frames fail;
there is no native Site-envelope replacement or permitted-floor repetition.

House location and obstruction sources now default to **the saved account
Site / Site → Environment**, including actual authored buildings and trees.
The imported Design geometry remains independent. An explicit alternative
permits using the imported project location and legacy obstacle/neighbour-screen
workflow instead; these modes are never combined to double-count obstructions.
The selected Solar civil date is explicit. A reviewed-input checkbox identifies
imported default heights/location as scenario assumptions, not measured evidence.

In the optional legacy alternative, all four frontage-relative neighbours begin unknown unless the imported
project has saved neighbour records. Those records are copied to local study
drafts without overwriting the original. Users must explicitly declare each
side clear or supply positive block height and nonnegative **net plot boundary**
gap in metres, including intervening roads. Blocks reuse the incumbent
conservative full-side opaque-screen contract, not invented neighbour widths.

### Saved Site Environment registration

`SurroundingsCanvas` stores objects in metres from **gross Site NW**, x east and
y south, regardless of plot display units. Negative coordinates and objects
across roads are allowed. Solar never treats this gross origin as the imported
Design net-plot origin by default. The user supplies the gross NW position in
**prepared Design net-plot-local x/y**, plus a vertical datum offset, then
acknowledges the mapping and authored-only coverage. Blank registration stays
unknown. All Design net-plot corners must lie within registered gross Site
extents; mismatched dimensions/orientation/origin fail without resizing geometry
or applying an invented road-widening shift.

Designs generated from applied native Site retain `nativeSiteSource` with
account identity, Site/feasibility fingerprint and calculated gross-NW/vertical
registration including road widening/cardinal rotation. When that source's
account and exact saved Site fingerprint match, House Solar uses the stored
registration directly and does not ask for manual origins. Unlinked imports
still require explicit registration. A linked generated design with stale Site
content must use the reversible **Design → Review/apply Site** workflow;
Solar never silently keeps the old alignment. Applied revision changes remain
result-invalidating even when source physical content matches.
Floor-owned native Site sources must also match the shared registration and
fingerprint. An individually linked split plate is usable in its supplied
frame; mixed floor registrations from different split origins are refused,
not overlaid as though they shared a common net-plot origin. This remains a
schematic common datum, not surveyed elevation/site evidence.

After `prepareScenes` translates actual Design geometry once, object corners
are mapped exactly once with the existing heading inverse:
`localDx = east*cos(heading) + south*sin(heading)`,
`localDy = -east*sin(heading) + south*cos(heading)`.
Only cardinal headings currently preserve the incumbent axis-aligned prism
contract exactly. Noncardinal mapping fails rather than creating oversized
bounding-box shade. Across-road/negative objects remain ray casters outside the
plot, not clipped away. Objects use their supplied height/base/transmission;
any null blocks calculation instead of becoming zero or opaque. Feet display
converts **gross plot dimensions** only; saved object coordinates/dimensions
are already metres and are not converted again.

Saved Site objects replace imported Design obstacles in the **derived study**
to avoid accidental duplication; neither authored source is changed. No extra
full-side neighbour screens are added in this default mode. Repeated objects
across actual storeys carry one explicit shared source identity so existing
kernel deduplication applies transmission once. Tree geometry is its supplied
rectangular canopy bounding prism and constant transmission, not a crown mesh,
species/growth or seasonal foliage model. Empty authored surroundings mean no
modeled objects, **not surveyed clear space**; that limitation must be explicitly
acknowledged. Applied Site revision and full source object/dimension inputs
participate in result freshness; saved changes reset review/registration
acknowledgements and discard previous hours.

## Existing numerical engine, explicit interim ownership

The study deliberately reuses **client-side HomeSun / SunCalc 2.0.1 and the
existing BuildingPhysics geometry kernel**, rather than speculatively porting
ray/receiving-surface semantics to Python. The independent site charts remain
Python pvlib SPA calculations. This interim distinction is shown in results;
the two ephemerides are not silently presented as identical.

`HomeSun.dailyIntervals` supplies exact clipped **5-minute UTC midpoint
intervals**, retaining real 23/25-hour civil dates. `createSunlightStudy` uses
8-axis area-weighted surface samples and its incumbent **1° low-sun cutoff**.
It accounts for all actual supplied storeys and casters, removes higher-covered
roof receivers, excludes apertures from opaque wall faces and weights supplied
partial transmission once per explicit obstacle identity.

The section displays:

- exposed roof/terrace and geographic-bearing wall groups per actual floor;
- area, area/transmission-weighted direct-beam-equivalent hours and point range;
- unobstructed orientation opportunity and hours lost to shade;
- first/last transmitted-sun interval bounds, with shaded-gap caveat;
- above-horizon duration, separate near-horizon exclusion and sampling counts;
- cumulative direct-sun curves and a **result-only time slider** using the
  captured accumulator results, without a rerun or fabricated instant shadows.

Daily sun hours are geometric potential, not measured sunshine, weather energy,
PV yield or indoor lux. The slider shows cumulative hours through a sampled
interval end, not binary instantaneous sunshine between arbitrary times.

## Freshness, limits and persistence

The incumbent `inputKey` includes project identity, geometry/site/date/neighbours
and floor inventory; the adapter adds active-floor identity. Result freshness is
rechecked before/after each cooperative yield and before attachment. Actual
geometry edits, imports, floor changes, source/date/neighbour changes, account
revision changes and unmount/cancellation discard stale completions. Display
clock changes do not rerun or invalidate a whole-day study. Changing only
selection with unchanged geometry retains a current result.

Limits are 100 explicit saved Site objects, 12 actual floors, 500 walls, 50000 receiver points, at most 313
five-minute intervals and a **30-second cooperative budget**. Kernel operations
are bounded, but an individual synchronous ray batch cannot be preempted.
Work yields every four intervals. Limit/failure cases attach no result and
never simplify geometry to make the study appear successful.

The explicit classic-asset allowlist adds only bundled SunCalc, `sun-model.js`,
`sun-exposure.js` and `building-physics.js` to dev/production delivery.
Calculation never writes the actual Design project, account workspace, saved
legacy result, Undo history, neighbour records or browser storage. Results and
new study drafts are session-only. Account geometry persistence remains a
separate Design migration capability; export the actual working copy explicitly.

## Shared-weather irradiance snapshots

After an explicit actual-house hours run, **Calculate shared-weather irradiance
snapshot** reuses the same prepared Design scenes and registered Site obstacles.
It reads the full normalized `project.environment.weather` installed through
the existing shared weather command; no extra uploader or plot model is created.
Select a source record index: its end timestamp and preceding duration are shown.
The calculation uses that interval's exact UTC midpoint and mean DNI/DHI/GHI
in **W/m²**, not raw EPW Wh/m². Missing values/quality flags, invalid timing/units,
or absent weather fail rather than becoming zero. Source years (including TMY)
are never remapped to the daily-hours date. UTC intervals remain unambiguous
across DST; source/station and local midpoint provenance are displayed.

Saved `environment.solar.groundAlbedo` takes precedence. If unknown, calculation
requires either that shared assumption or deliberate acknowledgement of the
displayed hypothetical **0.2 reference**; no default silently replaces unknown.
This acknowledgement is a session-only study assumption, not a measured value
or authored project mutation. Shared `environment.glazing.shgc` is used only
when known for exterior window receivers: `incident W/m² × area m² × SHGC`
gives **W**, not energy, VLT, indoor lux or temperature. Unknown SHGC leaves
gain unevaluated. Materials assembly values do not manufacture solar radiation.

The incumbent `BuildingPhysics.surfaceExposure` supplies area, beam sunlit
fraction and beam / isotropic-sky-diffuse / ground-reflected / total incident
W/m² for each exterior receiver, including authored obstacle/ground receivers
where the engine supplies them. Receiver rows are not summed into house energy.
Unlike daily hours, this legacy snapshot contract evaluates floors **independently**:
other-storey mutual shade is not coupled. Full-side neighbour screens are
refused instead of silently ignored; use registered Site objects. Diffuse and
ground terms assume unobstructed hemispheres, independently of beam shade;
urban sky occlusion, shaded ground and multiple reflections remain unsupported.

Explicit snapshots yield between floors with a cooperative 30-second budget
and bounds of 12 floors, 500 walls/openings and 100 obstacles per floor.
Geometry, Site, interval, weather, glazing/albedo edits and unmount invalidate
results or discard completion. These calculations never modify authored data,
Undo or persistence. Radiation is not inferred from sun hours/clear skies.
This restores the legacy weather-driven single-interval capability, **not**
integrated daily/annual energy or native house monthly 36-snapshot comparisons.
Full Solar parity is not claimed.

## Validation

```powershell
npx tsc -p tsconfig.app.json --noEmit
npx tsx --tsconfig tsconfig.app.json --test tests\platform-house-sun.test.tsx
node --test tests\building-physics.test.cjs tests\sun-exposure.test.cjs tests\sun-exposure-ui.test.cjs tests\planner-design-runtime.test.cjs
```

`tests\native-house-sun-browser.js` runs in a new disposable Playwright context
on port 5174. It exports an actual legacy controller fixture into memory, opens
that JSON through actual `NativeDesign`, and supplies its real mounted planner
to the house section. No user browser state or live account data is edited.
The probe verifies unknown-neighbour refusal, actual roof/wall results,
reduced roof hours under a supplied screen, result-only slider, unchanged
project bytes and stale invalidation after date/floor changes.
It also applies normalized weather through the real shared command and exercises
the actual surfaceExposure UI: **28 receiver rows**, exact original 2001 TMY
UTC midpoint, radiation-missing refusal, Materials-change invalidation and
unchanged project bytes after explicit analysis, with zero browser errors.

The successful fixture reported five actual surface groups, 12.000 roof hours
with clear sides versus 7.208 h under an explicit 30 m front screen at a 0 m
boundary gap. Those are **disposable scenario outputs**, not the user's house
or measured field validation. The saved Site Environment case independently
reported **12.000 h without authored objects → 7.404 h** with an explicitly
registered across-road 30 m building prism, including negative y footprint
coverage. Applied object revision changes discarded earlier results and left
the Design project bytes unchanged; the disposable browser recorded no errors.
Tests also cover DST, polar night, actual stacked
floors, missing inputs, cancellation, ownership and area-weighted kernel reuse.
The 14 native tests additionally verify exact irradiance kernel equality,
component sums/units, missing masks, night zeros, explicit albedo/unknown SHGC,
DST source intervals, weather/Materials stale yields and registered across-road
beam reduction while retaining the incumbent diffuse-method limitation.
