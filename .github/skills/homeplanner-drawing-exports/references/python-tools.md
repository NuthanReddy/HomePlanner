# Optional offline sheet/render checks

API documentation checked **17 Sep 2026**. No optional package was installed or
run. The [stdlib example](../scripts/example.py) generates its own labelled SVG
in JSON, without saving files. It checks the [unit equations](calculations.md);
it does not replace `HomePlannerDrawingExport` or its pinned local PDF runtime.

| Distribution → import | Useful scope | Prerequisite / limitation |
| --- | --- | --- |
| `svgwrite` → `svgwrite` | Construct and inspect a small independent physical-mm SVG | Serializer, not CAD semantics, pagination, topology or font embedding. Check project maintenance/version before adoption. |
| `CairoSVG` → `cairosvg` | Optional independent SVG-to-PDF/PNG comparison | Requires compatible Cairo/native dependencies, especially on Windows. Fonts and unsupported SVG features can differ from the browser. |
| `pypdf` → `pypdf` | Inspect an already supplied PDF's media boxes/pages | Parser, not a render/print fidelity guarantee or an architectural drawing generator. |

Official APIs:
[svgwrite Drawing](https://svgwrite.readthedocs.io/en/latest/classes/drawing.html),
[CairoSVG Python functions](https://cairosvg.org/documentation/),
[pypdf PdfReader](https://pypdf.readthedocs.io/en/stable/modules/PdfReader.html).
No blanket installation is needed; select one tool only for a concrete,
authorized comparison and record its version and native/font dependencies.

## Synthetic SVG, in memory

```python
import svgwrite

length_m, scale_denominator = 10.0, 100.0
paper_length_mm = length_m * 1000.0 / scale_denominator
drawing = svgwrite.Drawing(size=("297mm", "210mm"), viewBox="0 0 297 210")
drawing.add(drawing.line((20, 40), (20 + paper_length_mm, 40), stroke="black"))
drawing.add(drawing.text("10 m at 1:100", insert=(20, 35), font_size=4))
svg_text = drawing.tostring()
```

`tostring()` returns text; `save()`/`saveas()` write files and are deliberately
not called here. Explicit real-world SVG size is different from a preview zoom.

## Optional encoder comparison, not an app integration

```python
import cairosvg

def encode_reviewed_svg(svg_text):
    payload = svg_text.encode("utf-8")
    pdf_bytes = cairosvg.svg2pdf(bytestring=payload)
    png_bytes = cairosvg.svg2png(bytestring=payload, dpi=300)
    return pdf_bytes, png_bytes
```

Pass only a bounded, reviewed **self-contained** SVG: no external images, fonts,
links or stylesheets. These functions can otherwise resolve external resources.
Do not enable `unsafe`, supply a remote URL, or execute untrusted assets.
Without `write_to`, the return is bytes, not proof of a saved download.
Inspect output media boxes, decoded raster size, missing glyphs and coordinate
parity. DPI configuration does not prove embedded print metadata.

```python
from io import BytesIO
from pypdf import PdfReader

def page_sizes_points(pdf_bytes):
    reader = PdfReader(BytesIO(pdf_bytes))
    return [(float(page.mediabox.width), float(page.mediabox.height))
            for page in reader.pages]
```

Default PDF user units are points, but a general input may specify `/UserUnit`
or rotation/cropping; inspect those before asserting physical dimensions.
Existing browser SVG/PDF/PNG output remains authoritative for app regression.
IFC/DXF is dedicated exchange work, not a filename change or raster conversion;
see the [architecture tool guide](../../homeplanner-architecture/references/python-tools.md)
and [persisted toolchain review](../../../../docs/research/building-analysis-toolchain.md).
