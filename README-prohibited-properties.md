# Telangana Prohibited Properties: API, UI and Downloader

This feature lives in **HomePlanner**, including the original scraper and
the complete exported lookup data. **Site · Plot Planner > Prohibited Properties** uses
Flask for live portal requests and local PDF processing. The other HomePlanner
workspaces remain usable without this backend.

## Run the web application

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Open `http://127.0.0.1:8000/?workspace=prohibited`. Stop a static HTTP server
on that port first, or set `$env:HOMEPLANNER_PORT = "8001"` before starting.
The server binds to loopback, not to the public network. Do not expose this
unauthenticated local utility directly to the internet.

Choose **Connect local lookup** to load the Flask location catalog. Opening this
section or its legacy URL alone makes no request; connection failures stay here
without blocking the plot calculator.
Choose **District > Mandal > Village**, plus an SRO for Hyderabad divisions.
Then choose Agriculture / Non-Agriculture and a category. **View properties**
reads cached Markdown first. Missing reports are fetched by a background worker;
the UI shows progress while the PDF is parsed.

The report view includes searchable, paginated tables, the rendered saved
document, its source date and extraction method, Markdown/CSV downloads,
and the original source PDF when available. Scans without recognizable table
structure remain readable documents; the application does not invent columns
or property records.

## Local Tesseract, not a GPU model

The chosen OCR engine is **Tesseract**, running on this computer. Native PDF
text/tables are used where present; scanned pages require Tesseract.
There is no Chandra, Unlimited-OCR, PyTorch, or remote AI service dependency.
Every PDF page is processed, with a bounded per-page OCR timeout rather than
an arbitrary document page limit.

Install Tesseract with `eng` and `tel` trained language data. Check availability:

```powershell
tesseract --version
tesseract --list-langs
```

If the executable is not on PATH, set its actual installed path before starting:

```powershell
$env:TESSERACT_CMD = "C:\path\to\Tesseract-OCR\tesseract.exe"
$env:TESSERACT_LANGUAGES = "eng+tel"
.\.venv\Scripts\python.exe app.py
```

The UI's **Check local OCR** button reports missing executables or language
data explicitly. Saved Markdown remains readable without an OCR installation.
English/Telugu recognition, row reconstruction and survey numbers still need
human verification against the source. An OCR row is not a certified land record.

## Repository Markdown cache

Example paths (codes stay strings so leading zeroes are preserved):

```text
prohibited-properties\parsed\
  15_1\16\1533009\AGRI\1.md
  15_1\16\1533009\AGRI\court.md
  16_1\00\1600001\sro-1607\NONAGRI\1.md
```

Each Markdown file includes the location names/codes, category, fetched and
saved timestamps, extraction method, page count, source URL and source PDF
SHA-256 in a JSON metadata comment. The body contains page-labelled content.
HTML tables within Markdown preserve merged cells.
Recognizable printed property-table labels are promoted to table headers.
The printed column-number guide immediately below a header is excluded from
property rows, search and CSV data. Unrecognized headers remain explicitly
generic rather than being guessed.
Merged title rows above a recognizable header are preserved as the table
caption rather than counted as properties.

**Markdown is the authoritative stored result**, not a transient HTML or JSON
cache. Each subsequent request reads it from disk and derives safe HTML and
table rows. Cached results are usable offline and after restarting the server.
Keep the metadata comment when editing a saved document.

- A normal request never re-fetches a report that already has valid saved Markdown.
- **Force refresh** / `"force_refresh": true` bypasses that cache explicitly.
- A complete parse is written atomically; a failed refresh does not replace the
  previous Markdown with a partial result or error page.
- Unpublished and unsupported reports have explicit cached notices, not
  fabricated empty lists that imply title clearance.
- There is no TTL, automatic reconciliation, scheduler or change detection.
- Markdown is not ignored by Git. Source PDFs in `_sources` and bulk CLI
  downloads are ignored to avoid committing large binary documents. Nothing
  is automatically committed or pushed.

One local worker processes reports sequentially. Identical in-flight searches
are coalesced; requests for other locations queue rather than sharing portal
session state. Job progress is in memory: after a server restart, repeat the
search to use completed Markdown and retry unfinished reports. Run one server
process per repository cache; a distributed worker/lock system is not provided.

## Flask API

All endpoints are same-origin under `/api/prohibited`. Errors use
`{"error":{"code":"...","message":"..."}}`; long searches return HTTP 202
with a `job_id`. Completed cache hits return HTTP 200 immediately.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/options` | Local districts, report types/categories and catalog counts |
| GET | `/mandals?dist_code=15_1` | Mandals in a district |
| GET | `/villages?dist_code=15_1&mand_code=16` | Villages in a mandal |
| GET | `/sros?dist_code=16_1&mand_code=00&vill_code=1600001` | SRO options and whether an SRO is required |
| GET | `/ocr-status` | Check local Tesseract prerequisites; no PDF is fetched |
| POST | `/search` | Read saved reports, or fetch/parse missing or explicitly refreshed reports |
| GET | `/jobs/<job_id>` | Job progress, completed reports and per-report errors |
| GET | `/report` | Render one already-saved report; never fetch remotely |
| GET | `/download` | Download saved Markdown, CSV or original PDF |

Example:

```powershell
$selection = @{
  dist_code = "15_1"
  mand_code = "16"
  vill_code = "1533009"
  sro_code = ""
  prohib_type = "AGRI"
  category = "all"
  force_refresh = $false
} | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8000/api/prohibited/search" `
  -ContentType "application/json" -Body $selection
```

Categories are `all`, `1`, `2`, `5`, `6`, `court`, `waqf`, and `endowment`.
The last two are notices because the public portal does not expose reports
for them; **no API form number is inferred**. `force_refresh` must be a JSON
boolean, not the string `"false"`.

`/report` and `/download` take the same location/type/category values as query
parameters, with one category (not `all`). `/download` also takes
`format=markdown`, `format=csv`, or `format=pdf`; `attachment=1` downloads
instead of opening the PDF. CSV escapes formula-like cells for spreadsheet
safety. PDF OCR output is not a substitute for the original report.

## Original bulk downloader

`telangana_prohibited_properties.py` extracts the portal's district, mandal,
village, SRO, property-type, and Section 22A category values. It can also
download every available PDF and save the separate **Court cases & Others**
report as HTML and CSV.

The 33 district codes are embedded as a fallback because the portal sometimes
returns an empty district dropdown. Mandals, villages, and SRO offices are
always obtained from the live dependent APIs.

## Install

```powershell
py -m pip install -r requirements.txt
```

## Export all API values

```powershell
py .\telangana_prohibited_properties.py metadata
```

The generated `prohibited-properties\metadata` directory contains:

- `districts.csv`
- `mandals.csv`
- `villages-and-sros.csv`
- `property-types.csv`
- `form-types.csv`
- `unavailable-form-types.csv`
- `all-values.json`

## Download all reports

```powershell
py .\telangana_prohibited_properties.py all
```

This is a large, long-running operation. The downloader is deliberately
sequential and waits 350 ms between requests. Existing valid PDFs and court
report files are skipped, so the same command can be run again to resume.
Every result is appended to `download-manifest.jsonl`.

Use filters while testing or fetching a subset:

```powershell
py .\telangana_prohibited_properties.py all `
  --district 15_1 `
  --mandal 16 `
  --village 1533009
```

Multiple filters may be repeated:

```powershell
py .\telangana_prohibited_properties.py download `
  --district 21_4 `
  --property-type AGRI `
  --form-type 1 `
  --form-type 2 `
  --no-include-court
```

## Confirmed API values

| Field | Values |
|---|---|
| `prohib_type` | `AGRI` (Agriculture), `NONAGRI` (Non-Agriculture) |
| `formtype=1` | Section 22A(1)(a) |
| `formtype=2` | Section 22A(1)(b) |
| `formtype=5` | Section 22A(1)(d) |
| `formtype=6` | Section 22A(1)(e) |

The portal displays Section 22A(1)(c) Waqf and Endowment buttons, but their
JavaScript submits blank location/type/form values. They are recorded using
the descriptive keys `waqf` and `endowment`, with an empty `formtype`, and are
not sent to the PDF API. The previously suggested numbers `3` and `4` have
not been verified and must not be treated as API mappings.

**Court cases & Others is not `formtype=7`.** It uses a separate POST endpoint:
`prohibitedPropertyDetails_New.htm`.

The PDF flow uses:

1. `POST checkPDFFile.htm` with query parameters, including `sroCode`.
2. `POST viewProhibitedDataPDF.htm` with form data, including `sro_code`.

The same `requests.Session` is retained throughout. Do not copy browser
`JSESSIONID`, analytics, or load-balancer cookies into the script; it obtains a
fresh session from the portal.
