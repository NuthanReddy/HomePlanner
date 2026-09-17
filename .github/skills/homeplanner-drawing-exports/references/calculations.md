# Model dimensions to fixed-scale sheets

Checked **17 Sep 2026**. Read the [format sources](sources.md),
[current export contract](../../../../docs/drawing-export-formats.md) and
[architectural drawings](../../../../docs/architectural-drawings.md).
These equations describe units and geometric fit, not printer calibration,
complete CAD/BIM exchange or professional drawing approval.

## Symbols and units

| Symbol | Meaning | Unit / convention |
| --- | --- | --- |
| `L` | Actual model length | m, nonnegative |
| `N` | Scale denominator in 1:N | dimensionless, positive |
| `p` | Length on paper | mm |
| `q` | PDF default-user-space length | pt, 72 per inch |
| `d` | Explicit requested raster sampling density | pixels per inch |
| `W,H` | Physical paper width and height | mm |
| `mL,mR,mT,mB` | Reserved margins, including required drawing space | mm, nonnegative |
| `x,y` | Shared sheet point | paper mm, top-left origin, y down |

## Exact conversions

```text
paperMm = modelMetres * 1000 / N
modelMetres = paperMm * N / 1000
pdfPoints = paperMm * 72 / 25.4
idealPixels = paperMm * d / 25.4
```

The inch is exactly 25.4 mm. Do not apply `1/N` again in the PDF/PNG encoder:
the sheet coordinates have already been scaled. For an unrotated PDF page with
normal bottom-left origin and default `UserUnit=1`:

```text
xPDF = x * 72/25.4
yPDF = (H-y) * 72/25.4
```

Apply the equivalent path transform once. PDF crop/rotation/UserUnit metadata
need explicit handling; the simple expression is not a general PDF importer.

For SVG use physical width/height in mm and a matching `viewBox="0 0 W H"`.
SVG user coordinates then correspond to paper mm at the declared physical size.
A browser's zoom/Fit presentation does not change model scale.
Raster dimensions must ultimately be integers; a chosen rounding/cap policy is
additional to the ideal-pixel equation. The stdlib example reports the ideal
fractional count and does **not** pretend to reproduce the browser PNG encoder.

## Fixed scale is not fit-to-page

With available width `Wa=W-mL-mR` and height `Ha=H-mT-mB`, a rectangular model
extent fits geometrically only if:

```text
1000*Lwidth/N <= Wa       and       1000*Lheight/N <= Ha
```

This is necessary, not sufficient: dimensions, text, stroke extents, notes and
collision-free labels also need room. A diagnostic minimum denominator is

```text
Nfit = max(1000*Lwidth/Wa, 1000*Lheight/Ha)
```

`Nfit` is **not** permission to silently change scale, nor automatically an
allowed HomePlanner scale. The app supports explicit 1:50, 1:75 and 1:100 on its
supported A4/A3/A2 media. Ask for an explicit compatible paper/orientation/scale
change or report overflow. Note continuation pages solve note capacity, not
oversized model geometry.

Net-area labels are in m² and should come from canonical usable regions, not
paper rectangle area. If deriving a model area from paper for a check only,
`Amodel = Apaper*N²/10^6`. Printed linear dimensions do not measure a reserved
host's net area.

## Worked synthetic numbers

- A **10 m** line at **1:100** is **100 mm**, **283.464566929 pt**, or
  **1181.102362205 ideal pixels at 300 pixels/inch**.
- A 10 × 5 m rectangle is 100 × 50 mm; 5,000 mm² on paper corresponds to 50 m².
- A4 landscape is 297 × 210 mm; default PDF media dimensions are
  approximately **841.889763780 × 595.275590551 pt**.
- With 15 mm margins all round, usable paper is 267 × 180 mm.
  The 10 × 5 m example fits. A 30 × 5 m example at 1:100 does **not**:
  width 300 mm exceeds 267 mm; diagnostic `Nfit=112.359550562`.
- A point at sheet `(20,40)` mm on that page maps to PDF
  `(56.692913386,481.889763780)` pt.

The [stdlib example](../scripts/example.py) prints a physical-mm SVG with the
computed rectangle, a computed 1 m scale bar and labels. It creates no PDF/PNG
file and cannot verify fonts, download completion or printer settings.

## Domain and implementation boundary

Finite nonnegative lengths, positive scale/DPI and positive available sheet
dimensions are required. Zero length converts to zero; missing lengths and
nonfinite/overflow values are errors. Negative margins, margin sums consuming
the page or a zero denominator are invalid, never auto-fit fallbacks.

Current implementation is `HomePlannerDrawing.createSheets` and the pinned
local pdf-lib adapter in `HomePlannerDrawingExport`; it validates shared
paper-mm sheets, fonts, continuations and raster budgets. Python renderers are
optional reference tools, not replacement runtime exporters. Existing snapshot,
page-count and stale-publication guards still apply.

## Primary references and related research

- [W3C SVG coordinates](https://www.w3.org/TR/SVG11/coords.html): physical units,
  viewports and transformations.
- [Adobe-hosted ISO 32000-1 PDF 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf),
  §8.3.2.3: default PDF user-space units; not a claim of full ISO conformance.
- [W3C PNG](https://www.w3.org/TR/png-3/): raster dimensions and physical-pixel
  metadata are separate from vector geometry.
- [Existing toolchain research](../../../../docs/research/building-analysis-toolchain.md):
  SVG/PDF/PNG, optional visual meshes and IFC/engine semantics are separate products.
