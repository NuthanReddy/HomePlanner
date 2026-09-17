# Architectural drawing export adapters

`planner-drawing-export.js` consumes the renderer's **version-1 sheet**, not
editor DOM, screenshots, legacy globals, or another geometry model. The shared
contract and validation are owned by `planner-drawing.js`: `validateSheet`,
`createSheet`, and `toSVG`. All lengths and coordinates in a sheet are paper
millimetres, with origin at the top left and positive Y down.

## Load order and API

Load these local scripts after the application's normal prerequisites:

```html
<script src="planner-model.js"></script>
<script src="planner-drawing.js"></script>
<script src="planner-drawing-export.js"></script>
```

`HomePlannerDrawingExport` exposes only:

```js
const pdf = await HomePlannerDrawingExport.pdfBytes(sheets); // Uint8Array
const png = await HomePlannerDrawingExport.pngBlob(sheet, {
  pixelsPerMm: 4,
  maxPixels: 16000000
}); // image/png Blob
```

CommonJS: `require('./planner-drawing-export.js')` returns the same API. PDF
works in Node; PNG requires a browser. The renderer and PDF library are resolved
when an export is requested, so defining the adapter before either dependency
does not fail at script load. The first explicit PDF export loads the pinned
`vendor/pdf/pdf-lib-1.17.1.min.js` relative to the adapter script, locally and
without a CDN. Concurrent requests share that load. Load errors, missing APIs
and a 30-second timeout are reported, and a subsequent export retries a failed
load. Opening Report, previewing, SVG and PNG do not load the PDF library.
PNG does not require the PDF library. The adapter
does not initiate downloads; callers create/download their own Blob and revoke
any download URL they create.

Each export invokes the renderer's validation and copies consumed sheet data
before its first asynchronous operation. Inputs are not mutated, including
frozen sheets. This also prevents edits during an export from changing its
already-captured geometry/text. Validation exceptions propagate; no success-like
fallback or blank export is returned for invalid content.

## PDF: vector, multipage, physical scale

- One PDF page per sheet, in array order. All sheets must have the same
  `metadata.projectId` and `metadata.revision`; otherwise export fails with
  instructions to regenerate from one snapshot. Different floor IDs, paper
  formats and orientations are allowed. The adapter does not re-read live state.
- Exact media boxes use **72 / 25.4 points per millimetre**. Existing paper
  coordinates already embody the selected drawing scale; the adapter does not
  apply `scaleDenominator` again. Print at **100% / actual size**, not fit-to-page.
- Paths remain PDF move, line, cubic Bézier and close-path operators, with
  nonzero fill, round joins/caps matching the SVG renderer, and true millimetre
  stroke widths. Zero-width SVG strokes remain invisible rather than becoming
  PDF device hairlines. There is no raster page image.
- Text remains font-backed PDF text, not outlines or pixels. Clockwise rotation
  is converted into PDF's upward-Y coordinate system. Start/middle/end alignment
  offsets follow the rotated baseline, using actual unkerned glyph advances
  matching the PDF `Tj` text operation.
- pdf-lib owns serialization, compressed content streams, font resources,
  cross-reference offsets and escaping/hex encoding. A custom PDF writer is not
  used. The locally pinned runtime and third-party notices are recorded in
  [`vendor/pdf/PROVENANCE.md`](../vendor/pdf/PROVENANCE.md).

### Fonts and supported scripts

PDF uses the PDF standard **Helvetica regular, WinAnsi** font. PDF readers
provide this standard font; no external font file is fetched. Supported text
includes ordinary Latin letters, supported Western-European accented letters,
the euro sign, degree sign, typographic quotes, dashes and other WinAnsi glyphs.
Character support is checked against pdf-lib's font character set **before
pages are drawn**, not guessed from a broad Unicode range.

Unsupported characters cause an actionable error identifying the page and
Unicode code point. Examples include Telugu, Arabic, CJK, emoji, combining marks,
and control characters not accepted by the renderer/font. Nothing is silently
stripped, transliterated, substituted or converted to a screenshot. Use **SVG or
PNG** for those labels, or explicitly edit them. Future Unicode PDF support
requires a licensed embedded font plus shaping/bidi design; it is not claimed
here. Browser SVG/PNG use the renderer's `sans-serif` and installed font fallback,
so font metrics and available scripts can differ by machine. The adapters do not
download fonts and cannot guarantee the local browser has a font for every script.

## PNG: bounded browser rasterization

The adapter obtains SVG only from `HomePlannerDrawing.toSVG`, loads it through
an `image/svg+xml` Blob URL, and paints onto an opaque white canvas. It exports
an `image/png` Blob only after successful decode and encoding. Blob URLs are
revoked and canvas backing storage is released on success or failure. Image
decode and PNG encoding each have a 30-second timeout. Image-load, allocation,
draw, security and encoding failures are reported to the caller.

`pixelsPerMm` must be a finite numeric value **greater than 0 and at most 1200**
(default **4**, about 102 DPI). `maxPixels` must be an integer from **1 through
16,000,000** (default **16,000,000**). Strings, null options, NaN, infinity,
fractions for `maxPixels`, and out-of-range values are rejected before allocating
an image URL or canvas.

Raster resolution is reduced as necessary to satisfy both **8192 pixels per
side** and the requested total-pixel budget. Dimensions are rounded down, with
a one-pixel minimum; extreme tiny budgets/aspect ratios can change the rounded
aspect ratio. A default A4 portrait image is **840 × 1188**. A 16-million-pixel
RGBA canvas alone is approximately 64 MB, excluding browser decode/encode
buffers. Browsers may have lower practical memory limits and can still reject
an allocation; reduce `maxPixels` if that occurs.

PNG dimensions are pixel dimensions, **not a guarantee of print DPI metadata**.
Use the vector PDF for exact physical-scale printing. No canvas, image or PDF
data is uploaded; all processing works offline once the local scripts and
browser fonts are available. Browser CSP must allow local scripts and `blob:`
images for PNG.

## Resource guards and tests

The renderer's limits and validation always apply first. Additional adapter
guards bound an export to **100 pages, 100,000 primitives, 500,000 path commands,
and 1,000,000 text code units across all pages**. PDF media cannot exceed
5080 mm / 14,400 points on either side; currently supported renderer papers are
much smaller. PNG also rejects generated SVG strings over 16,000,000 code units.
These are fail-fast resource budgets, not an exact peak-heap guarantee.

Run:

```powershell
node --test tests\planner-drawing-export.test.cjs
```

Tests load the emitted bytes as a real PDF, inspect page media boxes,
cross-reference location, decompressed vector/text operators, round path styling,
and rotation/alignment matrices. They cover multipage project/revision rejection,
font encoding errors, resource limits, frozen-input purity and edits during an
await. Browser API doubles exercise raster size limits, URL cleanup and failure
paths without requiring a browser dependency. A separate integration test uses
the actual renderer when present; it explicitly skips as integration-pending if
the renderer is absent.
