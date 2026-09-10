# HomePlanner

A local-first browser workbench for GHMC/HMDA plot comparisons, editable
multi-floor layouts, sun paths, environmental scenarios and electrical-point
planning.

| Workspace | Capabilities |
|---|---|
| Plot Optimizer | Setbacks, floor allowances, plot splitting and indicative costs. Regulatory sources stay on this page. |
| Room Planner | Independent floors, shared wall/opening geometry, click-to-inspect, door swings, removable internal partitions, bed-head preferences and optional stacked 3D. |
| Sun Path | Local SunCalc angles/events, daily and annual plots, daylight Min/Max markers, coordinate detection on request and CSV export. |
| Environment | Local weather import, opt-in historical-weather fetch, geometric shadows, layer comparisons, wind proposals and explicitly supplied reduced-model experiments. |
| Electrical | Per-floor points, wall/surface anchors, unknown-height states and ergonomic/professional-review guidance. |

## Run locally

Open [`index.html`](index.html) with the accompanying scripts, stylesheets and
`vendor` folder. There is no application build or dependency-install step.
The 2D tools, local data imports and numerical scenarios can operate offline.

The optional 3D ES modules need HTTP/HTTPS and WebGL2. For a full local preview
on Windows with Python installed:

```powershell
py -3 -m http.server --bind 127.0.0.1 8000
```

Open `http://127.0.0.1:8000/`. Double-click 2D remains available when 3D is
unavailable. Browser location detection may also require HTTPS or localhost.

## Keeping projects

Room Planner's **Local projects** controls provide opt-in IndexedDB autosave,
saved-project management and JSON backup/import. Floors, manual edits,
electrical points and environment data are retained together. Browser storage
is not a backup; keep exported JSON separately. File-origin storage varies by
browser, and changing the origin/profile can hide or remove local data.

Nothing detects location or fetches weather automatically. Device location is
requested only by its button; online weather requires a separate consent/action.
There is no cloud database, account or automatic project upload.

## Documentation

See the [documentation index](docs/README.md) for the regulatory basis, plot
geometry, room-planning model, design guidance, cost model, and known
limitations.

Development cases use Node's built-in runner: `node --test`.

## Important

HomePlanner is a feasibility and comparison tool, not a building permission,
sanctioned drawing, structural design, fire-safety assessment, accessibility
review, certification, or legal opinion. Confirm current rules and site
requirements with TG-bPASS, GHMC/HMDA, and qualified professionals.

Environmental results are uncalibrated scenarios for the supplied inputs.
The application does not provide CFD, measured microclimate/tree cooling,
automatic weather/airflow-to-thermal coupling, mutual-storey shadow analysis,
or calibrated whole-building temperature predictions. Multiple editable floors
do not establish structural safety or permission to add storeys.
