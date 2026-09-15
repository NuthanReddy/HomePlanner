# HomePlanner

A local-first browser workbench for GHMC/HMDA plot comparisons, editable
multi-floor layouts, sun paths, environmental scenarios and electrical-point
planning.

| Workspace | Capabilities |
|---|---|
| Plot Planner | Setbacks, selectable G+n floor counts, explicit non-compliant setback scenarios, plot splitting and indicative costs. Regulatory sources stay on this page. |
| Room Planner | Independent floors, shared wall/opening geometry, click-to-inspect, door swings, removable internal partitions, bed-head preferences and optional stacked 3D. |
| Sun Path | Local SunCalc angles, daylight/twilight/golden-hour summary, monthly and seasonal paths, same-clock-time curves, 1 ft pole-shadow length, neighbour-blocked roof/exterior-wall sunlight hours, coordinate detection on request and CSV export. |
| Environment | Local weather import, opt-in historical-weather fetch, geometric shadows, layer comparisons, wind proposals and explicitly supplied reduced-model experiments. |
| Electrical | Per-floor points, wall/surface anchors, unknown-height states and ergonomic/professional-review guidance. |
| Prohibited Properties | Telangana location dropdowns, source reports, local Tesseract OCR, searchable tables and a Markdown cache. Requires the local Flask server. |

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

### Prohibited-property reports

To enable the **Prohibited Properties** workspace, run the Flask application
instead of the static HTTP server:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Open `http://127.0.0.1:8000/?workspace=prohibited`. The existing planning
workspaces are served from the same origin and retain their browser storage.
Tesseract must be installed with English and Telugu language data; the
application does not need a GPU or a cloud OCR account.

Reports are saved under `prohibited-properties\parsed` as district / mandal /
village / optional SRO / property type / category Markdown files. Subsequent
requests render those files, including after restarts, without calling the
portal or OCR. **Force refresh** explicitly fetches and parses again. Failed
refreshes leave the previous Markdown intact. There is no scheduled refresh
or change-detection process.

See [the prohibited-property guide](README-prohibited-properties.md) for the
API, Tesseract setup, cache layout, downloader and limitations.

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
The property API, Markdown cache and OCR cases run with
`.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_property*.py"`.

## Important

HomePlanner is a feasibility and comparison tool, not a building permission,
sanctioned drawing, structural design, fire-safety assessment, accessibility
review, certification, or legal opinion. Confirm current rules and site
requirements with TG-bPASS, GHMC/HMDA, and qualified professionals.

Environmental results are uncalibrated scenarios for the supplied inputs.
The application does not provide CFD, measured microclimate/tree cooling,
automatic weather/airflow-to-thermal coupling or calibrated whole-building
temperature predictions. Environment's original shadow snapshots evaluate one
scene at a time; Sun Path's explicit whole-house sunlight study includes the
modeled storeys together. Multiple editable floors do not establish structural
safety or permission to add storeys.
