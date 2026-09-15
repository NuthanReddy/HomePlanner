"""Local native-PDF extraction and Tesseract OCR; no remote inference or downloads.

Verified with PyMuPDF 1.28.2, Tesseract 5.5.0 and pytesseract 0.3.13. The wrapper's
image_to_data API uses temporary files, so this adapter instead uses Tesseract's
documented stdin/stdout TSV interface. Each nonblank scanned page has one OCR
invocation, with a timeout and an isolated two-thread subprocess environment.

Native tables use find_tables(strategy="lines_strict"). Scanned tables require
enclosed ruling cells detected by OpenCV, not inferred text columns. Bounded
axis-specific snapping tolerates scanner distortion without losing detected cells.
Unresolved ruled pages get one small, measured deskew attempt with an expanded
canvas; existing grids and non-table pages keep their original processing path.
Detected ruling pixels at cell edges are suppressed before the single OCR pass.
Confirmed grids use sparse-word segmentation; other pages retain automatic
segmentation. Geometric fitting has a work budget and never invents missing cells.
Ambiguous grids or word placement remain explicitly unstructured page text.
No numeric conversion, spelling correction, property-row inference, or page cap
is applied. Empty cells mean no text was extracted, not verified absence of data.
The caller owns source metadata and atomic final persistence.
"""

from __future__ import annotations

import csv
import html
import importlib
import io
import math
import os
import re
import shutil
import statistics
import subprocess
import unicodedata
from bisect import bisect_right
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path


__all__ = ["TesseractOCR", "OCRError", "OCRPage"]

_LANGUAGES = re.compile(r"[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*")
_MAX_RENDER_PIXELS = 16_000_000
_DETECTION_SIDE = 2000
_MAX_GRID_CELLS = 10000
_MAX_SCAN_FITS = 64
_MAX_SCAN_FIT_CELLS = 250000
_MAX_CONTOURS = 20000
_TSV_FIELDS = (
    "level", "page_num", "block_num", "par_num", "line_num", "word_num",
    "left", "top", "width", "height", "conf", "text",
)
_REVIEW_NOTICE = (
    "Text and cell placement are not independently verified. Check survey numbers, "
    "extents and empty cells against the source PDF. An empty cell means no text "
    "was extracted there, not that the source cell is confirmed blank."
)


class OCRError(RuntimeError):
    """An actionable local OCR, dependency, PDF, or extraction failure."""


@dataclass(frozen=True)
class OCRPage:
    number: int
    markdown: str
    method: str = ""


@dataclass(frozen=True)
class _Word:
    box: tuple[float, float, float, float]
    text: str
    line: tuple[int, ...]
    confidence: float | None = None


@dataclass
class _Cell:
    row: int
    column: int
    rowspan: int
    colspan: int
    box: tuple[float, float, float, float]
    text: str


@dataclass
class _Grid:
    xs: list[float]
    ys: list[float]
    cells: list[_Cell]
    owners: list[list[int]]

    @property
    def box(self) -> tuple[float, float, float, float]:
        return (
            min(cell.box[0] for cell in self.cells), min(cell.box[1] for cell in self.cells),
            max(cell.box[2] for cell in self.cells), max(cell.box[3] for cell in self.cells),
        )


def _pdf_errors(pdf) -> tuple[type[Exception], ...]:
    return OSError, ValueError, RuntimeError, OverflowError, MemoryError, pdf.mupdf.FzErrorBase


def _area(box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _intersection(first, second) -> float:
    return _area((
        max(first[0], second[0]), max(first[1], second[1]),
        min(first[2], second[2]), min(first[3], second[3]),
    ))


def _positions(values, tolerance: float) -> list[float]:
    groups: list[list[float]] = []
    for value in sorted(values):
        if not groups or value - groups[-1][0] > tolerance + 1e-9:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [statistics.mean(group) for group in groups]


def _edge_index(edges: list[float], value: float) -> int:
    right = bisect_right(edges, value)
    if right == 0:
        return 0
    if right == len(edges):
        return right - 1
    return right - 1 if value - edges[right - 1] <= edges[right] - value else right


def _grid_from_boxes(
    entries,
    tolerance: float | tuple[float, float],
    *,
    preserve_boxes: bool = False,
) -> _Grid | None:
    """Accept only cells that tile a complete grid, including explicit merged cells."""
    if not entries:
        return None
    if any(
        len(box) != 4 or not all(math.isfinite(value) for value in box) or _area(box) <= 0
        for box, _ in entries
    ):
        return None
    x_tolerance, y_tolerance = tolerance if isinstance(tolerance, tuple) else (tolerance, tolerance)
    xs = _positions([value for box, _ in entries for value in (box[0], box[2])], x_tolerance)
    ys = _positions([value for box, _ in entries for value in (box[1], box[3])], y_tolerance)
    rows, columns = len(ys) - 1, len(xs) - 1
    if rows < 2 or columns < 2 or rows * columns > _MAX_GRID_CELLS:
        return None

    owners = [[-1] * columns for _ in range(rows)]
    cells: list[_Cell] = []
    by_position: dict[tuple[int, int, int, int], int] = {}
    for box, text in entries:
        left = _edge_index(xs, box[0])
        right = _edge_index(xs, box[2])
        top = _edge_index(ys, box[1])
        bottom = _edge_index(ys, box[3])
        if right <= left or bottom <= top:
            return None
        position = top, left, bottom, right
        if position in by_position:
            previous = cells[by_position[position]]
            if previous.text and text and previous.text != text:
                return None
            previous.text = previous.text or text
            continue
        index = len(cells)
        cell_box = box if preserve_boxes else (xs[left], ys[top], xs[right], ys[bottom])
        cell = _Cell(top, left, bottom - top, right - left, cell_box, text)
        for row in range(top, bottom):
            for column in range(left, right):
                if owners[row][column] != -1:
                    return None
                owners[row][column] = index
        by_position[position] = index
        cells.append(cell)
    if any(owner == -1 for row in owners for owner in row):
        return None
    return _Grid(xs, ys, cells, owners)


def _word_lines(words: list[_Word]) -> list[tuple[float, float, str]]:
    lines: dict[tuple[int, ...], list[_Word]] = {}
    for word in words:
        lines.setdefault(word.line, []).append(word)
    result = []
    for line in lines.values():
        ordered = sorted(line, key=lambda word: word.box[0])
        result.append((
            min(word.box[1] for word in line),
            min(word.box[0] for word in line),
            " ".join(word.text for word in ordered),
        ))
    return sorted(result)


def _assign_words(grid: _Grid, words: list[_Word], fill_cells: bool) -> set[int] | None:
    assigned: set[int] = set()
    cell_words: dict[int, list[_Word]] = {}
    x0, y0, x1, y1 = grid.box
    band_height = max(
        1.0,
        statistics.median(cell.box[3] - cell.box[1] for cell in grid.cells),
        (y1 - y0) / 256,
    )
    bands: dict[int, list[int]] = {}
    for owner, cell in enumerate(grid.cells):
        first = math.floor((cell.box[1] - y0) / band_height)
        last = math.floor((cell.box[3] - y0) / band_height)
        for band in range(first, last + 1):
            bands.setdefault(band, []).append(owner)
    for index, word in enumerate(words):
        center_x = (word.box[0] + word.box[2]) / 2
        center_y = (word.box[1] + word.box[3]) / 2
        if not (x0 <= center_x < x1 and y0 <= center_y < y1):
            continue
        nearby = bands.get(math.floor((center_y - y0) / band_height), [])
        containing = [
            owner for owner in nearby
            if grid.cells[owner].box[0] <= center_x < grid.cells[owner].box[2]
            and grid.cells[owner].box[1] <= center_y < grid.cells[owner].box[3]
        ]
        # A skewed grid's enclosing rectangle also contains areas outside its
        # physical cells. Keep those words as prose, not guessed cell contents.
        if not containing:
            continue
        matches = [
            owner for owner in containing
            if _intersection(word.box, grid.cells[owner].box) >= 0.85 * _area(word.box)
        ]
        if len(matches) != 1:
            return None
        owner = matches[0]
        assigned.add(index)
        cell_words.setdefault(owner, []).append(word)
    if fill_cells:
        for index, cell in enumerate(grid.cells):
            cell.text = "\n".join(line[2] for line in _word_lines(cell_words.get(index, [])))
    return assigned


def _table_html(grid: _Grid) -> str:
    rows = []
    for row in range(len(grid.ys) - 1):
        cells = []
        for cell in sorted((cell for cell in grid.cells if cell.row == row), key=lambda cell: cell.column):
            attributes = ""
            if cell.rowspan > 1:
                attributes += f' rowspan="{cell.rowspan}"'
            if cell.colspan > 1:
                attributes += f' colspan="{cell.colspan}"'
            value = html.escape(cell.text).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
            cells.append(f"<td{attributes}>{value}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return "<table><tbody>\n" + "\n".join(rows) + "\n</tbody></table>"


def _page_markdown(
    number: int,
    method: str,
    words: list[_Word],
    candidates: list[_Grid],
    *,
    rulings_suppressed: bool = False,
    alignment_degrees: float | None = None,
) -> str:
    overlapping = {
        index
        for index, grid in enumerate(candidates)
        if any(
            other != index and _intersection(grid.box, candidate.box) > 1
            for other, candidate in enumerate(candidates)
        )
    }
    grids = []
    assigned: set[int] = set()
    for index, grid in enumerate(candidates):
        if index in overlapping:
            continue
        indexes = _assign_words(grid, words, fill_cells=method == "tesseract")
        if indexes is None or not indexes:
            continue
        grids.append(grid)
        assigned.update(indexes)

    source = "native PDF text (no OCR)" if method == "native" else "local Tesseract OCR"
    parts = [f"> Page {number} extraction: {source}.", f"> Confidence: {_REVIEW_NOTICE}"]
    if method == "tesseract":
        confidences = [word.confidence for word in words if word.confidence is not None]
        low = sum(score < 60 for score in confidences)
        parts.append(
            f"> Tesseract word confidence: mean {statistics.mean(confidences):.1f}/100; "
            f"{low} of {len(confidences)} words below 60/100. These scores are not verification."
        )
        if alignment_degrees is not None:
            parts.append(
                f"> Page alignment: {alignment_degrees:.2f} degrees from a measured table ruling; "
                "the full page was retained."
            )
        if rulings_suppressed:
            parts.append(
                "> Preprocessing: detected ruling-line pixels at cell edges were suppressed "
                "before OCR. Recognized text was not corrected or filled in."
            )
    if not grids:
        parts.append(
            "> No structured table was recognized. The following is extracted page text, "
            "not inferred property rows."
        )
    else:
        parts.append(
            "> Only geometrically detected grids are structured. Text outside them remains "
            "unstructured; no missing values or column labels have been invented."
        )

    events = [
        (top, left, "text", text)
        for top, left, text in _word_lines([word for index, word in enumerate(words) if index not in assigned])
    ]
    events.extend((grid.box[1], grid.box[0], "table", grid) for grid in grids)
    text_lines: list[str] = []
    table_number = 0
    for _, _, kind, value in sorted(events, key=lambda item: (item[0], item[1])):
        if kind == "text":
            text_lines.append(value)
            continue
        if text_lines:
            parts.append("<pre>" + html.escape("\n".join(text_lines)) + "</pre>")
            text_lines = []
        table_number += 1
        parts.append(f"### Detected grid {table_number}\n\n{_table_html(value)}")
    if text_lines:
        parts.append("<pre>" + html.escape("\n".join(text_lines)) + "</pre>")
    return "\n\n".join(parts)


def _native_words(page) -> list[_Word]:
    result = []
    for entry in page.get_text("words", sort=True):
        if len(entry) < 8 or not isinstance(entry[4], str):
            raise OCRError("PyMuPDF returned invalid native word data.")
        box = tuple(float(value) for value in entry[:4])
        if not all(math.isfinite(value) for value in box) or _area(box) <= 0:
            raise OCRError("PyMuPDF returned invalid native word coordinates.")
        text = entry[4].strip()
        if text:
            result.append(_Word(box, text, (int(entry[5]), int(entry[6]))))
    return result


def _native_grids(page) -> list[_Grid]:
    grids = []
    finder = page.find_tables(strategy="lines_strict")
    for table in finder.tables:
        data = table.extract()
        rows = table.rows
        if not isinstance(data, list) or len(data) != len(rows):
            raise OCRError("PyMuPDF returned invalid native table rows.")
        entries = []
        for row, values in zip(rows, data):
            if not isinstance(values, list) or len(values) != len(row.cells):
                raise OCRError("PyMuPDF returned invalid native table cells.")
            for box, text in zip(row.cells, values):
                if text is not None and not isinstance(text, str):
                    raise OCRError("PyMuPDF returned non-text native table values.")
                if box is not None:
                    entries.append((tuple(float(value) for value in box), text or ""))
        grid = _grid_from_boxes(entries, tolerance=0.75)
        if grid is not None:
            grids.append(grid)
    return grids


def _ruling_mask(gray, cv, *, preserve_thin_lines: bool = False):
    height, width = gray.shape
    scale = min(1.0, _DETECTION_SIDE / max(width, height))
    small = gray if scale == 1 else cv.resize(
        gray, (round(width * scale), round(height * scale)), interpolation=cv.INTER_AREA,
    )
    if min(small.shape) < 32:
        return None, scale
    mask = cv.adaptiveThreshold(
        small, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 31, 15,
    )
    horizontal_input = mask
    vertical_input = mask
    if preserve_thin_lines:
        # Permit a one-pixel staircase after rotation, then intersect with real
        # foreground ink so this tolerance cannot draw new ruling pixels.
        horizontal_input = cv.dilate(mask, cv.getStructuringElement(cv.MORPH_RECT, (1, 3)))
        vertical_input = cv.dilate(mask, cv.getStructuringElement(cv.MORPH_RECT, (3, 1)))
    horizontal = cv.morphologyEx(
        horizontal_input, cv.MORPH_OPEN,
        cv.getStructuringElement(cv.MORPH_RECT, (max(12, small.shape[1] // 40), 1)),
    )
    vertical = cv.morphologyEx(
        vertical_input, cv.MORPH_OPEN,
        cv.getStructuringElement(cv.MORPH_RECT, (1, max(12, small.shape[0] // 40))),
    )
    lines = cv.bitwise_or(horizontal, vertical)
    return (cv.bitwise_and(lines, mask) if preserve_thin_lines else lines), scale


def _scan_axis_options(entries, axis: int, scale: float):
    values = [value for box, _ in entries for value in (box[axis], box[axis + 2])]
    seen = set()
    options = []
    for tolerance in range(3, 37):
        positions = _positions(values, tolerance / scale)
        if len(positions) < 3:
            continue
        intervals = tuple(
            (_edge_index(positions, box[axis]), _edge_index(positions, box[axis + 2]))
            for box, _ in entries
        )
        if any(end <= start for start, end in intervals) or intervals in seen:
            continue
        seen.add(intervals)
        options.append((len(positions) - 1, tolerance))
    return options


def _fit_scan_grid(entries, scale: float) -> _Grid | None:
    if len(entries) < 3 or len(entries) > _MAX_GRID_CELLS:
        return None
    candidates = sorted(
        (
            (columns * rows, x, y)
            for columns, x in _scan_axis_options(entries, 0, scale)
            for rows, y in _scan_axis_options(entries, 1, scale)
            if len(entries) <= columns * rows <= _MAX_GRID_CELLS
        ),
        key=lambda item: (item[0], item[1] + item[2]),
    )
    best = None
    best_slots = None
    best_shapes: set[tuple[int, int]] = set()
    fit_budget = min(_MAX_SCAN_FITS, max(1, _MAX_SCAN_FIT_CELLS // len(entries)))
    for attempt, (candidate_slots, x_tolerance, y_tolerance) in enumerate(candidates):
        if best_slots is not None and candidate_slots > best_slots:
            break
        if attempt >= fit_budget:
            return None
        grid = _grid_from_boxes(
            entries, (x_tolerance / scale, y_tolerance / scale), preserve_boxes=True,
        )
        if grid is None or len(grid.cells) != len(entries):
            continue
        shape = len(grid.ys) - 1, len(grid.xs) - 1
        slots = shape[0] * shape[1]
        if best_slots is None or slots < best_slots:
            best, best_slots, best_shapes = grid, slots, {shape}
        elif slots == best_slots:
            best_shapes.add(shape)
        # Fewer slots than physical cells are impossible. This avoids artificial
        # row bands caused by slightly different measurements of the same ruling.
        if slots == len(grid.cells):
            return grid
    return best if len(best_shapes) == 1 else None


def _ruling_contours(gray, cv, *, preserve_thin_lines: bool = False):
    lines, scale = _ruling_mask(gray, cv, preserve_thin_lines=preserve_thin_lines)
    if lines is None:
        return (), None, scale
    lines = cv.morphologyEx(lines, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_RECT, (5, 5)))
    contours, hierarchy = cv.findContours(lines, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE)
    if hierarchy is None or len(contours) > _MAX_CONTOURS:
        return (), None, scale
    return contours, hierarchy, scale


def _scan_grids(gray, cv, *, preserve_thin_lines: bool = False) -> list[_Grid]:
    contours, hierarchy, scale = _ruling_contours(gray, cv, preserve_thin_lines=preserve_thin_lines)
    if hierarchy is None:
        return []
    groups: dict[int, list] = {}
    for index, contour in enumerate(contours):
        parent = int(hierarchy[0][index][3])
        if parent < 0:
            continue
        x, y, cell_width, cell_height = cv.boundingRect(contour)
        if cell_width < 8 or cell_height < 8:
            continue
        if preserve_thin_lines:
            rectangle = cv.minAreaRect(contour)
            rectangle_area = rectangle[1][0] * rectangle[1][1]
            rectangular = rectangle_area > 0 and cv.contourArea(contour) >= 0.8 * rectangle_area
        else:
            rectangular = cv.contourArea(contour) >= 0.85 * (cell_width - 1) * (cell_height - 1)
        if not rectangular:
            continue
        box = (x / scale, y / scale, (x + cell_width - 1) / scale, (y + cell_height - 1) / scale)
        groups.setdefault(parent, []).append((box, ""))
    grids = []
    for entries in groups.values():
        if len(entries) > _MAX_GRID_CELLS:
            continue
        grid = _fit_scan_grid(entries, scale)
        if grid is not None:
            grids.append(grid)
    return grids


def _deskew_ruled_page(gray, cv):
    contours, hierarchy, scale = _ruling_contours(gray, cv)
    if hierarchy is None:
        return None
    children: dict[int, int] = {}
    for relation in hierarchy[0]:
        parent = int(relation[3])
        if parent >= 0:
            children[parent] = children.get(parent, 0) + 1
    eligible = [
        parent for parent, count in children.items()
        if count >= 3 and cv.contourArea(contours[parent]) >= 0.05 * gray.size * scale * scale
    ]
    if not eligible:
        return None
    contour = contours[max(eligible, key=lambda parent: cv.contourArea(contours[parent]))]
    polygon = cv.approxPolyDP(contour, 0.01 * cv.arcLength(contour, True), True).reshape(-1, 2)
    width = cv.boundingRect(contour)[2]
    edges = []
    for index, first in enumerate(polygon):
        second = polygon[(index + 1) % len(polygon)]
        dx, dy = (float(second[axis] - first[axis]) for axis in (0, 1))
        if dx < 0:
            dx, dy = -dx, -dy
        if dx < 0.7 * width:
            continue
        angle = math.degrees(math.atan2(dy, dx))
        if abs(angle) <= 5:
            edges.append(((float(first[1]) + float(second[1])) / 2, angle))
    if not edges:
        return None
    angle = min(edges)[1]
    if abs(angle) < 0.15:
        return None
    height, width = gray.shape
    matrix = cv.getRotationMatrix2D((width / 2, height / 2), angle, 1)
    cosine, sine = abs(matrix[0, 0]), abs(matrix[0, 1])
    target_width = math.ceil(width * cosine + height * sine) + 4
    target_height = math.ceil(height * cosine + width * sine) + 4
    if target_width * target_height > _MAX_RENDER_PIXELS:
        return None
    matrix[0, 2] += (target_width - width) / 2
    matrix[1, 2] += (target_height - height) / 2
    aligned = cv.warpAffine(
        gray, matrix, (target_width, target_height),
        flags=cv.INTER_CUBIC, borderMode=cv.BORDER_CONSTANT, borderValue=255,
    )
    return aligned, angle


def _suppress_grid_rulings(
    gray, grids: list[_Grid], cv, np, *, preserve_thin_lines: bool = False,
):
    if not grids:
        return gray, False
    lines, scale = _ruling_mask(gray, cv, preserve_thin_lines=preserve_thin_lines)
    if lines is None:
        return gray, False
    boundaries = np.zeros_like(lines)
    for grid in grids:
        for cell in grid.cells:
            x0, y0, x1, y1 = (round(value * scale) for value in cell.box)
            cv.rectangle(boundaries, (x0, y0), (x1, y1), 255, thickness=7)
    erase = cv.bitwise_and(lines, boundaries)
    if not np.any(erase):
        return gray, False
    erase = cv.resize(erase, (gray.shape[1], gray.shape[0]), interpolation=cv.INTER_NEAREST)
    erase = cv.dilate(erase, cv.getStructuringElement(cv.MORPH_RECT, (3, 3)))
    cleaned = gray.copy()
    cleaned[erase > 0] = 255
    return cleaned, True


def _tsv_words(output: bytes, width: int, height: int) -> list[_Word]:
    try:
        text = output.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise OCRError("Tesseract returned invalid UTF-8 word data.") from None
    reader = csv.DictReader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE)
    if reader.fieldnames is None or not set(_TSV_FIELDS).issubset(reader.fieldnames):
        raise OCRError("Tesseract returned missing or malformed TSV word data.")
    words = []
    try:
        for row in reader:
            level = int(row["level"])
            if not 1 <= level <= 5 or None in row:
                raise ValueError
            if level != 5:
                continue
            value = row["text"]
            if not isinstance(value, str):
                raise ValueError
            value = value.strip()
            if not value:
                continue
            left, top, word_width, word_height = (int(row[name]) for name in ("left", "top", "width", "height"))
            confidence = float(row["conf"])
            line = tuple(int(row[name]) for name in ("block_num", "par_num", "line_num"))
            if (
                int(row["page_num"]) != 1
                or left < 0 or top < 0 or word_width <= 0 or word_height <= 0
                or left + word_width > width + 1 or top + word_height > height + 1
                or not math.isfinite(confidence) or not 0 <= confidence <= 100
                or any(number < 0 for number in line)
            ):
                raise ValueError
            words.append(_Word((left, top, left + word_width, top + word_height), value, line, confidence))
    except (TypeError, ValueError, KeyError, csv.Error):
        raise OCRError("Tesseract returned invalid word boxes, confidence scores, or TSV records.") from None
    return words


class TesseractOCR:
    """Extract every page locally; prefer valid native text over OCR of scans."""

    name = "Local PDF extraction + Tesseract"

    def __init__(
        self,
        languages: str = "eng+tel",
        dpi: int = 300,
        timeout: float = 120,
        command: str | Path | None = None,
    ) -> None:
        if not isinstance(languages, str) or not _LANGUAGES.fullmatch(languages):
            raise OCRError("Configure Tesseract languages as traineddata names joined by '+', for example eng+tel.")
        if isinstance(dpi, bool) or not isinstance(dpi, int) or dpi <= 0:
            raise OCRError("Configure OCR DPI as a positive integer (normally 300).")
        try:
            seconds = float(timeout)
        except (TypeError, ValueError, OverflowError):
            raise OCRError("Configure a finite, positive Tesseract timeout in seconds.") from None
        if isinstance(timeout, bool) or not math.isfinite(seconds) or seconds <= 0:
            raise OCRError("Configure a finite, positive Tesseract timeout in seconds.")
        if command is not None and (
            not isinstance(command, (str, Path))
            or not str(command).strip()
            or any(ord(character) < 32 for character in str(command))
        ):
            raise OCRError("Configure the Tesseract executable path, not a shell command.")
        self.languages = languages
        self.dpi = dpi
        self.timeout = seconds
        self._configured_command = command
        self._command: str | None = None
        self._ready = False

    @property
    def model(self) -> str:
        return f"Tesseract ({self.languages})"

    def _resolve_command(self) -> str:
        if self._configured_command is not None:
            candidate = str(self._configured_command)
            resolved = shutil.which(candidate)
            if resolved:
                return resolved
            if Path(candidate).is_file():
                return str(Path(candidate).resolve())
            raise OCRError("The configured Tesseract executable was not found. Correct its command path.")
        locations = []
        if os.environ.get("LOCALAPPDATA"):
            locations.append(Path(os.environ["LOCALAPPDATA"]) / "Programs" / "Tesseract-OCR" / "tesseract.exe")
        if os.environ.get("ProgramFiles"):
            locations.append(Path(os.environ["ProgramFiles"]) / "Tesseract-OCR" / "tesseract.exe")
        for location in locations:
            if location.is_file():
                return str(location)
        resolved = shutil.which("tesseract")
        if resolved:
            return resolved
        raise OCRError(
            "Local Tesseract OCR is not installed or was not found. Install it with "
            "eng and tel traineddata, or configure its executable command path."
        )

    def _run(self, arguments: list[str], *, image: bytes | None = None, timeout: float | None = None) -> bytes:
        environment = os.environ.copy()
        environment.update(OMP_THREAD_LIMIT="2", OMP_NUM_THREADS="2")
        options = {
            "capture_output": True,
            "env": environment,
            "timeout": self.timeout if timeout is None else timeout,
            "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
        }
        if image is None:
            options["stdin"] = subprocess.DEVNULL
        else:
            options["input"] = image
        try:
            result = subprocess.run([self._command, *arguments], **options)
        except subprocess.TimeoutExpired:
            raise OCRError(
                "Local Tesseract timed out. Increase the configured timeout or lower DPI; "
                "no partial output was accepted."
            ) from None
        except OSError:
            raise OCRError(
                "Cannot launch local Tesseract. Check its executable path and execution permissions."
            ) from None
        if result.returncode != 0:
            raise OCRError(
                f"Local Tesseract failed (exit {result.returncode}). Check traineddata "
                "languages, executable configuration, free RAM, and the source page."
            )
        return result.stdout

    def check_health(self) -> None:
        """Verify the local binary and requested languages without processing a PDF."""
        self._ready = False
        self._command = self._resolve_command()
        try:
            version = self._run(["--version"], timeout=min(10.0, self.timeout)).decode("utf-8")
            match = re.search(r"tesseract\s+v?(\d+)\.(\d+)", version, re.IGNORECASE)
            if match is None or int(match.group(1)) < 4:
                raise OCRError("Tesseract 4 or newer with LSTM/TSV support is required; check the configured executable.")
            available = self._run(["--list-langs"], timeout=min(10.0, self.timeout)).decode("utf-8")
        except UnicodeDecodeError:
            raise OCRError("The configured Tesseract binary returned invalid version or language information.") from None
        installed = {line.strip() for line in available.splitlines() if re.fullmatch(r"[A-Za-z0-9_]+", line.strip())}
        missing = set(self.languages.split("+")) - installed
        if missing:
            raise OCRError(
                f"Tesseract language data is missing: {', '.join(sorted(missing))}. "
                "Install the requested traineddata in its tessdata directory or correct TESSDATA_PREFIX."
            )
        self._ready = True

    def _native_page(self, page, number: int) -> OCRPage | None:
        words = _native_words(page)
        if not words or any(
            character == "\ufffd" or unicodedata.category(character) in ("Cc", "Co")
            for word in words for character in word.text
        ):
            return None
        # A text header must not hide a scanned body or an unreliable OCR text layer.
        image_area = sum(_area(info["bbox"]) for info in page.get_image_info())
        if image_area > 0.1 * page.rect.get_area():
            return None
        return OCRPage(number, _page_markdown(number, "native", words, _native_grids(page)), "native")

    def _scanned_page(self, page, number: int, pdf) -> OCRPage:
        try:
            cv = importlib.import_module("cv2")
            np = importlib.import_module("numpy")
        except (ImportError, OSError):
            raise OCRError(
                "Scanned-page extraction requires numpy and opencv-python-headless "
                "in the application's Python environment."
            ) from None
        cv.setNumThreads(2)
        cv.ocl.setUseOpenCL(False)
        expected_width = math.ceil(page.rect.width * self.dpi / 72)
        expected_height = math.ceil(page.rect.height * self.dpi / 72)
        if expected_width * expected_height > _MAX_RENDER_PIXELS:
            raise OCRError(
                "This page exceeds the bounded raster memory budget at the configured DPI. "
                "Lower DPI and retry the whole report; no pages were silently omitted."
            )
        try:
            pixmap = page.get_pixmap(dpi=self.dpi, colorspace=pdf.csRGB, alpha=False)
            rgb = np.frombuffer(pixmap.samples_mv, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
            if int(rgb.min()) == 255:
                return OCRPage(
                    number,
                    f"> Page {number} extraction: blank-page raster check (no OCR).\n\n"
                    "Blank page: the rendered page is entirely white; no ink was detected. "
                    "No property rows or values were inferred.",
                    "blank",
                )
            gray = cv.cvtColor(rgb, cv.COLOR_RGB2GRAY)
            del rgb, pixmap
            grids = _scan_grids(gray, cv)
            alignment_degrees = None
            if not grids:
                deskewed = _deskew_ruled_page(gray, cv)
                if deskewed is not None:
                    aligned, angle = deskewed
                    aligned_grids = _scan_grids(aligned, cv, preserve_thin_lines=True)
                    if aligned_grids:
                        gray, grids, alignment_degrees = aligned, aligned_grids, angle
                    del aligned, deskewed
            gray, rulings_suppressed = _suppress_grid_rulings(
                gray, grids, cv, np, preserve_thin_lines=alignment_degrees is not None,
            )
            success, encoded = cv.imencode(".png", gray)
            if not success:
                raise OCRError("Cannot encode the rendered PDF page for local Tesseract.")
            height, width = gray.shape
            image = encoded.tobytes()
            del gray, encoded
        except (cv.error, *_pdf_errors(pdf)):
            raise OCRError(
                "Cannot render or analyze this PDF page. Check the PDF, OCR dependencies, "
                "DPI setting, and available RAM."
            ) from None
        if not self._ready:
            self.check_health()
        segmentation = "11" if grids else "3"
        output = self._run(
            ["stdin", "stdout", "-l", self.languages, "--oem", "1", "--psm", segmentation,
             "--dpi", str(self.dpi), "-c", "tessedit_create_tsv=1"],
            image=image,
        )
        del image
        words = _tsv_words(output, width, height)
        if not words:
            raise OCRError(
                "Tesseract recognized no text although this page contains ink. "
                "Review the source page, languages and DPI; it was not labeled blank."
            )
        return OCRPage(
            number,
            _page_markdown(
                number, "tesseract", words, grids, rulings_suppressed=rulings_suppressed,
                alignment_degrees=alignment_degrees,
            ),
            "tesseract",
        )

    def parse_pdf(
        self,
        pdf_path: Path,
        progress: Callable[[int, int], None] | None = None,
    ) -> list[OCRPage]:
        """Return every page in order, or raise rather than return a partial report."""
        try:
            pdf = importlib.import_module("pymupdf")
        except (ImportError, OSError):
            raise OCRError("PDF extraction requires PyMuPDF in the application's Python environment.") from None
        try:
            document = pdf.open(pdf_path)
        except _pdf_errors(pdf):
            raise OCRError("Cannot open the PDF report. Check that it exists and is a readable, valid PDF.") from None
        with document:
            try:
                is_pdf = document.is_pdf
                encrypted = (
                    document.needs_pass or document.is_encrypted
                    or bool((document.metadata or {}).get("encryption"))
                )
                total = document.page_count
            except _pdf_errors(pdf):
                raise OCRError("Cannot inspect the PDF. Re-download a valid PDF report.") from None
            if not is_pdf:
                raise OCRError("The report is not a PDF. Download the original PDF report.")
            if encrypted:
                raise OCRError("The PDF is encrypted or password-protected. Supply an unencrypted PDF report.")
            if total == 0:
                raise OCRError("The PDF has no pages. Re-download the original report.")
            pages = []
            for index in range(total):
                number = index + 1
                try:
                    page = document.load_page(index)
                    result = self._native_page(page, number)
                    if result is None:
                        result = self._scanned_page(page, number, pdf)
                except OCRError as error:
                    raise OCRError(f"Page {number} of {total}: {error}") from None
                except _pdf_errors(pdf):
                    raise OCRError(
                        f"Page {number} of {total}: PDF text/table extraction failed. "
                        "Check the source PDF and the installed PyMuPDF version."
                    ) from None
                pages.append(result)
                if progress is not None:
                    progress(number, total)
            return pages

    def close(self) -> None:
        """No persistent OCR model or subprocess is retained."""
        return None
