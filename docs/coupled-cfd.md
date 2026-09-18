# Single-room coupled thermal / CFD

**Delivery scope:** case preparation and the local execution integration for
OpenCFD OpenFOAM **v2606**, using `chtMultiRegionFoam`. Actual solver execution
and numerical validation are pending the separately approved runtime setup.
Preparing a ZIP, passing adapter tests or parsing synthetic output is not a
completed CFD simulation.

Open **Environment > Thermal / CFD** (`?workspace=environment&section=cfd`).
The current active-floor Room Planner geometry is the source. This is separate
from the existing pressure network, depth-averaged potential-flow field and
sensible RC tools; none is silently used as a CFD fallback.

## Work without virtualization

Run the existing local Flask application:

```powershell
.\.venv\Scripts\python.exe -B app.py
```

Open `http://127.0.0.1:8000/`. No additional Python package is needed for CFD
case preparation. Static/file-only use can inspect the enclosure and edit
scenario drafts but cannot call the Python compiler or runner.

1. Choose a room on the current active floor. Resolve any geometry blockers.
2. Supply the physical inputs and their sources. Blank values are unknown.
3. Review the geometry, empty-room assumption and experimental model profile.
4. **Prepare case** checks and compiles the inputs without starting an engine.
   **Download OpenFOAM case** requests the generated ZIP and manifest.
5. **Save inputs to project** is a separate, reversible authored action. It
   includes incomplete nullable inputs in project JSON; it does not run or
   durably save a solver result.

The case and engine controls are usable independently: runtime unavailability
does not prevent preparation. Opening the section makes no API request, starts
no engine, and changes no physical opening.

## Geometry and coordinates

`planner-cfd.js` consumes one shared `DrawingScene`, with exact project/floor/room
IDs. It collects the selected room's current perimeter wall hosts, inner faces,
thicknesses and surviving apertures. Compiled inner wall faces can differ from
the logical clear-carpet rectangle; both are retained in the manifest and the
difference is displayed. This is not a new room-packing or wall-authoring model.

The first profile requires a rectangular unobstructed enclosure with level,
equal-height walls and one thickness on each side. It explicitly rejects
missing hosts, wall gaps, stepped faces, unsupported reservations and
intersecting modeled obstacles. In particular, `usableRegions: []` is not a
request to fill the room's bounding rectangle. Stair/lift plan symbols do not
establish CFD shafts or slab penetrations.

Opening width, sill, height and operating fraction come from the current scene.
Only fractions **0** and **1** are supported. The workbench's **Set fully open**
and **Set closed** buttons deliberately use existing opening commands and Undo;
choosing an inlet condition does not itself open a window.

Other modeled rooms are outside this single-room domain. Their connections
terminate at explicit user-supplied boundary conditions. An unmapped neighbour
stays `unknown`, not `outside`; a hypothetical boundary at that aperture does
not establish outdoor-air delivery or ACH. Source openings with unresolved
physical geometry remain blockers.

Registered geometry is already site-local and is not translated from the plot
twice. The right-handed engine frame is:

```text
X = right from the inner room's minimum site x
Y = front, opposite increasing site y
Z = up from the room floor
origin = (rect.x, rect.y + rect.h, floorElevationM)
gravity = (0, 0, -9.80665) m/s2
```

For heading `h` clockwise from geographic north and an engine point `(X,Y,Z)`:

```text
siteX = origin.x + X
siteY = origin.y - Y
east  = siteX*cos(h) - siteY*sin(h)
north = -siteX*sin(h) - siteY*cos(h)
up    = origin.z + Z
```

The project-relative vertical datum is retained; no absolute surveyed elevation
is invented. The UI rotates wall letters to the known geographic frontage.
Wire-format `N/E/S/W` remain plan axes, with heading recorded separately.

## Explicit physical profile

| Component | Supported meaning |
| --- | --- |
| Air | Transient 3D compressible, laminar ideal-gas flow with sensible energy; explicit molar mass, constant specific heat, dynamic viscosity and Prandtl number |
| Opaque shell | One homogeneous isotropic solid region, explicit conductivity, density, specific heat and initial temperature; wall thicknesses from current hosts, floor/ceiling thicknesses supplied separately |
| Fluid/solid interfaces | Conjugate temperature/heat-transfer coupling, not an invented indoor convection coefficient |
| Solid exterior faces | Independently supplied constant prescribed temperature on each wall/floor/ceiling face; these are not automatically outdoor weather |
| Open aperture inlet | Prescribed inward normal velocity and temperature |
| Open aperture outlet | Prescribed static pressure and backflow temperature; pressure reference and signed gauge offset are distinct |
| Closed door/window | Prescribed temperature on the room-side aperture surface; no inferred glass/door thickness, layer conduction, SHGC or optical model |
| Initial state | Supplied uniform air and solid temperatures and absolute air pressure; zero initial velocity is the declared profile initial condition |
| Receiver | A supplied height strictly inside the room, with explicit sample rows/columns; not a depth average |

The solver family resolves mass, momentum and energy. For the constant solid:

```text
rho_s * cp_s * dT_s/dt = div(k_s * grad(T_s))
```

At an ideal coupled fluid/solid interface, temperature is continuous and the
two outward conductive heat fluxes are equal and opposite. The generated case
uses OpenFOAM's coupled-temperature boundary; it does not claim a thermal
contact resistance or radiation model.

Absolute reference pressure is in Pa. Celsius inputs are converted to kelvin
once for the engine; gas molar mass in g/mol is numerically equal to kg/kmol,
the OpenFOAM thermodynamic input unit. Neither weather absolute pressure nor
the pressure-network's forcing value is silently reused as CFD gauge pressure.

The numerical settings are reviewable initial choices, not measured physical
inputs or proof of accuracy. Mesh/time/sample/resource limits reject excessive
cases rather than silently coarsening them. A short numerical run is not a
steady-state room-temperature prediction or a replacement for warmup.

Not included: turbulence closure, radiation, layered glazing/walls, furniture
drag, detailed door leaves, external wind domains, multiple rooms/storeys,
HVAC controls, latent heat, moisture transport, comfort, mold or annual energy.
Laminar output must not be presented as a validated turbulent room-flow model.

## Ownership, input persistence and stale results

Raw numeric text is a project/floor/room-owned draft in `HomePlannerDrafts`.
Typing, navigation, case preparation and running do not mutate the project.
**Save inputs** uses one existing `set-environment` command, preserving all
unrelated environment and layout data:

```text
environment.coupledCfd = {
  version: 1,
  scenarios: [{ floorId, roomId, geometryFingerprint, scenario }]
}
```

Saved inputs participate in project JSON and Undo/Redo. Unknown values remain
null; unresolved old opening inputs are retained, visibly excluded from a
current case rather than rebound to another opening. Concurrent saved changes
require explicitly keeping the draft or reloading saved inputs.

Each request includes the original source revision and opaque application
input/geometry fingerprints. The server also computes its own SHA-256 case
hash; this is not interchangeable with HomePlanner's canonical-text fingerprint.
Freshness uses the selected physical geometry, scenario and exact owner plus
request generation. Renaming a project does not invalidate otherwise identical
physics; a same-revision physical replacement does.

Editing inputs, changing rooms/projects, clearing or disposing immediately
removes old results. Known jobs receive cancellation requests. A job whose
creation response arrives late is cancelled by its returned job ID rather than
aborting the request and losing its identity.

## Local engine and API

OpenFOAM is an external prerequisite, not a pip dependency. The selected
distribution is **OpenCFD v2606**, not the separately numbered OpenFOAM
Foundation releases. On Windows the execution route is the approved WSL2 +
Ubuntu installation, after hardware virtualization and any required restart.
The application never enables Windows features, changes firmware, installs an
engine, asks for passwords or modifies global WSL settings.

After installing and verifying the matching engine, opt in when starting the
server; settings belong to the server environment, never a browser payload:

```powershell
$env:HOMEPLANNER_CFD_ENABLED = '1'
$env:HOMEPLANNER_CFD_DISTRIBUTION = 'Ubuntu-24.04'
$env:HOMEPLANNER_CFD_BASHRC = '/usr/lib/openfoam/openfoam2606/etc/bashrc'
.\.venv\Scripts\python.exe -B app.py
```

The final path is a **Linux path inside WSL**, not a Windows filesystem path.
It is a configuration example to verify against the actual installation.
**Check local engine** explicitly checks the configured release and tools.
No installation or long computation occurs at page load.

| Endpoint | Action |
| --- | --- |
| `GET /api/cfd/capabilities` | Cheap preparation/runtime status; does not launch a process |
| `POST /api/cfd/runtime` with `{}` | Explicit bounded runtime probe |
| `POST /api/cfd/prepare` | Validate and compile the captured payload; return its manifest, not a result |
| `POST /api/cfd/package` | Return the generated case ZIP; no solver |
| `POST /api/cfd/jobs` | Explicit managed run of the same captured payload |
| `GET /api/cfd/jobs/<id>` | Lifecycle, stage and bounded log tail |
| `POST /api/cfd/jobs/<id>/cancel` with `{}` | Request cancellation of this job only |
| `GET /api/cfd/jobs/<id>/result` | Completed parsed output only; not an incomplete-result fallback |

CFD request bodies have their own 256 KiB limit; existing property and small
Python-calculation limits are unchanged. Same-origin, trusted-host and
cross-site guards apply. Executables, shell code, arbitrary filesystem paths
and arbitrary OpenFOAM dictionaries are not browser inputs.

Heavy mesh/solve work is managed outside request handlers, with a single
bounded local run rather than an unbounded queue. Cases, logs and state stay
in a server-owned per-job cache outside the repository. They may contain
private project information and are not public assets. Cancelling targets that
job, never the whole WSL distribution or unrelated processes. Interrupted or
failed jobs do not become completed after a restart.

## Results and remaining verification

The result view consumes actual bounded ASCII engine samples for temperature,
velocity and absolute pressure at the requested height. It checks ownership,
case hash, sample count, location, time and finite values before publishing.
The plot shows **discrete samples**, with actual-value colour ranges and
horizontal velocity projections, plus a numeric table and JSON export.
There is no coloured placeholder field when the engine is unavailable.

Completed output remains **computed-unvalidated**. Engine exit code zero,
small algebraic residuals and attractive graphics are not empirical accuracy.
Unavailable energy-balance, conservation or mesh/time-refinement evidence must
remain unavailable, not zero or a passing badge.

The outstanding runtime gate is to execute independent cavity/conduction/flow
cases, verify mesh/interface/pressure conventions and mass/energy balances,
then compare refined meshes and time steps for the same physical problem.
Only after that evidence exists can a profile-specific verification claim be
made. Full-building performance and professional engineering validation remain
separate work.

Relevant regression commands:

```powershell
node --test tests\planner-cfd.test.cjs tests\planner-cfd-ui.test.cjs tests\workspace-navigation.test.cjs
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p "test_cfd*.py"
```

Production browser cases use disposable contexts and supplied synthetic
physical inputs on the actual current default Room Planner geometry. They do
not replace the user's live browser project or constitute CFD verification.

## Primary references

- [OpenCFD v2606 `chtMultiRegionFoam`](https://doc.openfoam.com/2606/tools/processing/solvers/rtm/heat-transfer/chtMultiRegionFoam):
  transient compressible fluid and solid regions.
- [Coupled-temperature boundary](https://doc.openfoam.com/2606/tools/processing/boundary-conditions/rtm/derived/thermal/turbulentTemperatureCoupledBaffleMixed):
  supported neighbour-temperature and material-conductivity coupling.
- [NASA spatial convergence guidance](https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html):
  grid-refinement evidence is distinct from empirical validation.
- [Microsoft WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install):
  Windows prerequisites and explicit installation/restart steps.
