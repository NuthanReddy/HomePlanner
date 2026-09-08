# Optional 3D inspection

The **Open 3D** action in the room-output card mounts a local Three.js WebGL2
view. It is an inspection projection, not another planner or project store.
Nothing is imported, downloaded, rendered or allocated on the GPU by this
feature before that action. No models, textures, fonts, telemetry, geolocation
or other remote services are requested.

The normal 2D application remains available when 3D is closed, unsupported or
fails. Edits still go through the shared 2D inspector and project commands.

## Integration

Mount the feature on `#planner3d`, load `planner-3d.css`, and load the **classic**
`planner-3d.js` after `planner-model.js` and the initialized `planner-bridge.js`.
The existing `HomeSun` API is optional; without it the view uses labelled
neutral inspection lighting.

Before any feature module imports, include this small local import map:

```html
<script type="importmap">
{
  "imports": {
    "three": "./vendor/three/three.module.min.js"
  }
}
</script>
```

`planner-3d.js` dynamically imports the local runtime and `OrbitControls.js`
only on Open 3D. The unchanged upstream addon imports the bare specifier
`three`, which is why the map is required. The runtime imports its sibling
`three.core.min.js` using a relative path. All paths work under a static host
subdirectory; the map is relative to the HTML document and the dynamic imports
are relative to `planner-3d.js`. Do not put a production CDN or `@latest` URL
in the map.

The browser namespace is `HomePlanner3D`; its `instance` exposes `open()`,
`close()`, `resetView()`, `destroy()` and a read-only `isOpen` property.
Initialization is idempotent per host. `destroy()` also removes the persistent
Open/Close/control button handlers; ordinary close leaves those buttons usable.

### Static hosting and local files

The 3D ES modules require an HTTP/HTTPS origin, JavaScript MIME types, import-map
support and WebGL2. A local static server is sufficient; no backend or build
step is needed. For example, **if Python is installed**, from the project
directory:

```powershell
python -m http.server --bind 127.0.0.1 8000
```

Open `http://127.0.0.1:8000/` and stop that foreground server when finished.
Other existing static servers work as well.

Double-click `file://` **2D** remains supported. Clicking Open 3D there shows
an explanation and local-serving guidance rather than importing blocked
modules. Missing files/import maps, unavailable WebGL2, rendering exceptions
and graphics-context loss also produce local, visible errors. Context loss
releases the view instead of silently retrying or altering the project.

## Shared-model semantics

- `HomePlanner.getScenes()` supplies **all valid storeys**. Each is placed at
  its scene `floorElevationM`. `getScene()` identifies the active editing floor.
  The 3D code does not switch floors to collect scenes.
- **Active floor only** filters presentation, not the project. It is useful
  for inspecting a lower storey hidden by an upper slab.
- **Cutaway** hides roof/ceiling caps only. It does not lower or remove physical
  walls, change openings, move slabs or affect analytical inputs. Each displayed
  storey has a schematic cap at its wall height; no pitched roof or stair void
  is inferred.
- Room surfaces use `room.rect`. Furniture solids use `furniture.rect`; bed
  pillows follow all four `headLocal` polarities, including square footprints.
  A bed with unknown head direction is not assigned one by its aspect ratio.
- Physical walls come from `scene.walls`, **not one extrusion per room**.
  Shared wall IDs are emitted once per storey. When available, model
  `solidSections` (`startM`, `endM`, `sillM`, `heightM`) are the exact solid
  union, including vertically stacked apertures. For older scenes, plan
  `solidSegments` exclude aperture spans: the renderer restores the vertical
  support for those spans and subtracts all sill/head opening rectangles as
  a union. Both paths emit boundary quads, including actual jambs, sills and
  lintels. No independent infill box can refill another opening. No wall surface
  is painted over to imitate a hole; cells do not introduce internal dividing
  faces. Removed masonry and unsupported full-height gaps stay absent.
- Resolved canonical `scene.openings` retain their leaf/glazing even when a
  full-width, full-height aperture leaves `wall.removed === true`: that flag
  describes masonry, not opening infill. True partition-removal passages
  supersede conflicting door/window records into `unresolvedOpenings`.
  Those attachments remain reviewable in the model/2D tools, not as floating panes.
- Hinged leaves use the model's `doorGeometry()` pivot, nominal closed endpoint
  and full-swing endpoint. The actual `openFraction` interpolates that swing.
  The 90-degree diagram does not imply that a closed door is operating open.
- Windows and sliding doors show explicit glazing in genuinely cut walls.
  The model does not specify their sash/track construction, so their pane
  motion is not invented from `openFraction`. Selection reports that operating
  input separately. Transparent-looking glass is **not** a verified free
  airflow aperture or a transmission simulation.
- Click selection calls `HomePlanner.select({kind,id})`, with model IDs for
  room, wall, door, window and furniture. Clicking an inactive storey does
  not mutate the active floor; the local status explains that the floor must
  be chosen in 2D before editing. Roofs, slabs and context solids occlude
  picking instead of allowing clicks through them.
- Selection-only notifications update the selection outline, not geometry.
  Committed changes rebuild from fresh immutable bridge snapshots. The camera
  position and orbit target survive edits, undo, redo, floor filters and close/
  reopen. **Reset view** explicitly fits the current displayed geometry.

### Coordinates and context

Each scene is building-local: x right, y rear. Heading is the geographic
road/front bearing, clockwise from true north. The view converts **once**:

```text
dx = x - floor.w/2; dy = y - floor.h/2
east  = dx*cos(heading) - dy*sin(heading)
north = -(dx*sin(heading) + dy*cos(heading))
Three = (east, absolute elevation, -north)
```

Absolute wall `baseM` is not added to the storey elevation a second time.
The compass projects geographic north `(0,0,-1)` through the current camera,
so it follows orbiting without rotating the building twice.

Only supplied `building`/`tree` obstacles appear. Their x/y footprint, height
and absolute `baseM` come from the scene; buildings are boxes and trees are
low-detail ellipsoids. Coincident copies of the same context geometry across
storeys are drawn once. No neighbors, terrain, trunk dimensions, porosity or
optical transmission are inferred. Missing context is labelled **unknown**.

## Preview limitations and lifecycle

Wall height, storey height/elevation and roof thickness use project inputs,
which may themselves be assumed. Slab thickness is a labelled 0.14 m preview
assumption. Room finishes, furniture heights, door leaves, glazing and frames
are procedural approximations, not measured construction assemblies or
clearance checks. Independent storey layouts/headings are shown as supplied;
overlaps or absent connecting stairs are not repaired by this renderer.

When available, `HomeSun.calculate()` reads the saved project `site` and
`environment.sunSelection` to orient one directional light. Its ENU vector
is already geographic; heading is not applied again. Below-horizon sun is
disabled, with neutral fill retained for inspection. Missing or invalid
solar inputs give labelled neutral lighting.

These shadow maps and arbitrary lighting intensities are **not** sun-hours,
irradiance, energy, thermal, airflow, structural or regulatory metrics. Hiding
a roof cannot change physical or numerical inputs.

Rendering is requested on changes, resizing or orbit/pan/zoom events; damping
and auto-rotation are disabled. There is no permanent animation loop.
Hidden/zero-size views do not render. Pixel ratio is capped at 1.75 and the
single shadow map is bounded to 1024 × 1024.

Rebuilds dispose replaced geometries/materials and renderer draw-list references.
Close cancels pending frames, unsubscribes from bridge events, disconnects
observers and view listeners, disposes controls, materials, geometries, light
shadow targets and renderer resources, and releases that view's WebGL context.
Closing while imports are in flight cannot reopen the view afterward.
Downloaded JavaScript may remain in the browser's module cache; GPU objects do
not. The persistent buttons remain available to reopen.

## Dependency, provenance and license

Pinned dependency: **`three@0.185.1` (r185), MIT**.

Registry availability and the stable dist-tag were checked on 2026-09-08
against the environment's configured npm registry mirror; the package was
successfully retrieved using `npm pack three@0.185.1 --ignore-scripts`.
The direct npmjs registry connection was unavailable in this environment;
no GitHub tag was treated as proof of an available npm package.
No package lifecycle scripts, bundler, framework or dependency installation
were added to the application.

- Package: <https://www.npmjs.com/package/three/v/0.185.1>
- Upstream: <https://github.com/mrdoob/three.js>
- License retained verbatim: [`vendor/three/LICENSE`](../vendor/three/LICENSE)
- Tarball SHA-1: `63e9e241a17b101e211965121a017b4b4d8054ae`
- Tarball integrity:
  `sha512-5aojFCXKwnjBRZvUnt3WFfEcvUJgkN5LlijRFN95hMy8WVkG4I0QNcJE+OuWvuJ0bOdStrbfXn0pkd6/QyiAlg==`

Only these **unchanged upstream files** were extracted:

| Local file under `vendor/three/` | npm package path | SHA-256 |
|---|---|---|
| `three.module.min.js` | `build/three.module.min.js` | `86bcee248b64f44bcfc23c331ae74619061957d59cab040171dcb6fb5900beb6` |
| `three.core.min.js` | `build/three.core.min.js` | `05b2609338c76cd65daf74f3ac515bc9a5045e1b3b33edc07d8c9bd55250fa90` |
| `OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` | `faabb4e8dfd9235ee4a9fd7c9a3d75f90f1689dbd4944bd6fd32117dacec5f93` |
| `LICENSE` | `LICENSE` | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |

Copyright © 2010–2026 three.js authors. Keep the supplied MIT notice with
redistributed copies. The upstream minified module license headers are
preserved. No private reference assets, copied diagrams or downloaded fonts
are bundled.

Official documentation checked through Context7:
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html),
[OrbitControls](https://threejs.org/docs/pages/OrbitControls.html),
[render on demand](https://threejs.org/manual/en/rendering-on-demand.html),
[resource disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html).

## Validation surface

The classic script also exports its pure geometry helpers through CommonJS:
`toThree`, `wallGrid`, `wallSurfaceData`, `bedPillows`, `doorLeaf`, `resolveSun`,
`buildContent` and `disposeObject`. Geometry tests can import the locally
vendored Three.js runtime in Node without a GPU or permanent build tooling.

Focused implementation checks cover cardinal-heading parity with the shared
model, sill/lintel/void areas, overlapping apertures, removed masonry versus
surviving full-wall infill, four bed
head polarities, door handing/operating fractions, real Three.js raycasts
through window holes, stacking, namespaced selection, cap visibility,
immutable inputs and disposal events. Final application browser coverage
should additionally check lazy network requests, the import map, resizing,
camera retention, picking versus orbiting, theme changes, keyboard/touch,
close/reopen and visible file/WebGL/context-loss fallbacks.
