from __future__ import annotations

import csv
import io
import re
from typing import Any

import bleach
from bs4 import BeautifulSoup, Tag
from markdown_it import MarkdownIt


class DocumentError(RuntimeError):
    pass


ALLOWED_TAGS = {
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em",
    "b", "i", "u", "s", "sup", "sub", "blockquote", "ul", "ol", "li",
    "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "caption", "a", "dl", "dt", "dd",
}


def sanitized_html(markdown: str) -> str:
    renderer = MarkdownIt("commonmark", {"html": True}).enable("table")
    soup = BeautifulSoup(renderer.render(markdown), "html.parser")
    for tag in soup.find_all(["script", "style", "iframe", "object", "embed", "form", "input"]):
        tag.decompose()
    return bleach.clean(
        str(soup),
        tags=ALLOWED_TAGS,
        attributes={"a": ["href", "title"], "td": ["colspan", "rowspan"], "th": ["colspan", "rowspan"]},
        protocols={"http", "https"},
        strip=True,
    )


def _span(cell: Tag, name: str) -> int:
    try:
        value = int(str(cell.get(name, "1")))
    except ValueError as exc:
        raise DocumentError(f"Invalid table {name}; review the source document.") from exc
    if not 1 <= value <= 1000:
        raise DocumentError(f"Unsupported table {name}; review the source document.")
    return value


def _cell_text(cell: Tag) -> str:
    return re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()


def _property_header(cells: list[Tag]) -> bool:
    labels = [re.sub(r"[^a-z0-9]+", " ", _cell_text(cell).casefold()).strip() for cell in cells]
    patterns = (
        r"^(?:s[li1]?|sr|serial)\s*(?:no|number)\b",
        r"\bdistrict\b",
        r"\bmandal\b",
        r"\bvillage\b",
        r"\b(?:survey|sy no|sv no|sub division)\b",
        r"\bplot no\b",
        r"\bhouse no\b",
        r"\b(?:owner|assignee|allottee|allotee)\b",
        r"\b(?:extent|area)\b",
        r"\b(?:act under|prohibited|prohibition)\b",
        r"\b(?:sro|sub registrar)\b",
        r"\b(?:local body|municipality|panchayat)\b",
        r"\b(?:ward|block)\s*(?:no|number)\b",
        r"\b(?:remarks|reason|classification)\b",
        r"\b(?:notification|order|memo|letter)\s*(?:no|number|date)\b",
    )
    matched_fields = {
        index for index, pattern in enumerate(patterns)
        if any(re.search(pattern, label) for label in labels)
    }
    matched_cells = sum(any(re.search(pattern, label) for pattern in patterns) for label in labels)
    return len(matched_fields) >= 3 and matched_cells >= 3


def _column_number_guide(cells: list[Tag], width: int) -> bool:
    if width < 6 or len(cells) != width or any(_span(cell, "colspan") != 1 for cell in cells):
        return False
    values = [_cell_text(cell).strip(" |") for cell in cells]
    populated = [(index + 1, value) for index, value in enumerate(values) if value]
    return len(populated) >= max(4, width // 2) and all(
        value.isascii() and value.isdigit() and int(value) == column
        for column, value in populated
    )


def normalize_table_headers(table: Tag) -> bool:
    """Promote recognizable printed labels, never a numeric property-data row."""
    rows = [
        row for row in table.find_all("tr")
        if row.find_parent("table") is table and row.find_all(["th", "td"], recursive=False)
    ]
    if not rows:
        return False
    first = rows[0].find_all(["th", "td"], recursive=False)
    placeholder = all(
        cell.name == "th" and re.fullmatch(r"Column\s+\d+", _cell_text(cell), flags=re.I)
        for cell in first
    )
    candidate_index = 1 if placeholder else 0
    width = max(
        sum(_span(cell, "colspan") for cell in row.find_all(["th", "td"], recursive=False))
        for row in rows
    )
    title_rows = []
    while candidate_index < len(rows):
        title_cells = rows[candidate_index].find_all(["th", "td"], recursive=False)
        if (
            width < 3 or len(title_cells) != 1
            or title_cells[0].name != "td" or rows[candidate_index].find_parent("thead") is not None
            or _span(title_cells[0], "colspan") != width
            or _span(title_cells[0], "rowspan") != 1
        ):
            break
        title_rows.append(rows[candidate_index])
        candidate_index += 1
    if candidate_index >= len(rows):
        return False
    candidate = rows[candidate_index]
    cells = candidate.find_all(["th", "td"], recursive=False)
    has_header = candidate.find_parent("thead") is not None or all(cell.name == "th" for cell in cells)
    changed = False
    inferred_header: Tag | None = None
    if not has_header and not _property_header(cells):
        return False
    if title_rows:
        caption = table.find("caption", recursive=False)
        if caption is None:
            caption = BeautifulSoup("", "html.parser").new_tag("caption")
            table.insert(0, caption)
        for title_row in title_rows:
            paragraph = BeautifulSoup("", "html.parser").new_tag("p")
            title_cell = title_row.find(["th", "td"], recursive=False)
            for child in list(title_cell.contents):
                paragraph.append(child.extract())
            caption.append(paragraph)
            title_row.decompose()
        changed = True
    if not has_header:
        if placeholder:
            old_parent = rows[0].parent
            rows[0].decompose()
            if old_parent.name == "thead" and not old_parent.find("tr"):
                old_parent.decompose()
        for cell in cells:
            cell.name = "th"
        inferred_header = BeautifulSoup("", "html.parser").new_tag("thead")
        inferred_header.append(candidate.extract())
        caption = table.find("caption", recursive=False)
        if caption is not None:
            caption.insert_after(inferred_header)
        else:
            table.insert(0, inferred_header)
        changed = True
    next_index = candidate_index + 1
    label_cells = list(cells)
    while next_index < len(rows):
        next_row = rows[next_index]
        next_cells = next_row.find_all(["th", "td"], recursive=False)
        explicit = next_row.find_parent("thead") is not None or all(cell.name == "th" for cell in next_cells)
        if not explicit and not (inferred_header is not None and _property_header(next_cells)):
            break
        if inferred_header is not None:
            for cell in next_cells:
                cell.name = "th"
            inferred_header.append(next_row.extract())
        label_cells.extend(next_cells)
        next_index += 1
    # A numbered guide is meaningful only immediately after an identified header,
    # and must match the physical column positions (including OCR-missed blanks).
    width = sum(_span(cell, "colspan") for cell in cells)
    if _property_header(label_cells) and next_index < len(rows):
        guide = rows[next_index]
        if _column_number_guide(guide.find_all(["th", "td"], recursive=False), width):
            guide.decompose()
            changed = True
    return changed


def normalize_markdown_tables(markdown: str) -> str:
    """Retain page text while making HTML grids in persisted Markdown semantic."""
    lines = markdown.splitlines(keepends=True)
    tokens = MarkdownIt("commonmark", {"html": True}).parse(markdown)
    for token in reversed(tokens):
        if token.type != "html_block" or token.map is None or "<table" not in token.content.lower():
            continue
        block = BeautifulSoup(token.content, "html.parser")
        changed = False
        for table in block.find_all("table"):
            if table.find_parent("table") is None:
                changed = normalize_table_headers(table) or changed
        if changed:
            start, end = token.map
            lines[start:end] = [str(block) + "\n"]
    return "".join(lines)


def extract_table(table: Tag) -> dict[str, Any]:
    """Expand merged cells without guessing column meanings or property values."""
    normalize_table_headers(table)
    source_rows = [row for row in table.find_all("tr") if row.find_parent("table") is table]
    grid: dict[tuple[int, int], str] = {}
    header_rows = 0
    seen_data = False
    width = 0
    for row_index, row in enumerate(source_rows):
        cells = row.find_all(["th", "td"], recursive=False)
        is_header = row.find_parent("thead") is not None or (
            cells and all(cell.name == "th" for cell in cells)
        )
        if is_header and not seen_data:
            header_rows += 1
        else:
            seen_data = True
        column = 0
        for cell in cells:
            while (row_index, column) in grid:
                column += 1
            text = _cell_text(cell)
            rowspan, colspan = _span(cell, "rowspan"), _span(cell, "colspan")
            for dr in range(rowspan):
                for dc in range(colspan):
                    key = (row_index + dr, column + dc)
                    if key in grid:
                        raise DocumentError("Overlapping table cells; review the source document.")
                    grid[key] = text
            column += colspan
            width = max(width, column)
    if not source_rows or not width:
        return {"columns": [], "rows": []}
    if any(row >= len(source_rows) for row, _ in grid):
        raise DocumentError("Table row spans exceed the source rows.")
    columns = []
    for col in range(width):
        headings = []
        for row in range(header_rows):
            text = grid.get((row, col), "")
            if text and text not in headings:
                headings.append(text)
        columns.append(" / ".join(headings) or f"Column {col + 1}")
    rows = [
        [grid.get((row, col), "") for col in range(width)]
        for row in range(header_rows, len(source_rows))
    ]
    rows = [row for row in rows if any(row)]
    caption = table.find("caption", recursive=False)
    return {"columns": columns, "rows": rows, "caption": _cell_text(caption) if caption else ""}


def render_document(markdown: str) -> dict[str, Any]:
    html = sanitized_html(markdown)
    soup = BeautifulSoup(html, "html.parser")
    tables = []
    page: int | None = None
    for element in soup.find_all(["h2", "table"]):
        if element.name == "h2":
            match = re.fullmatch(r"Page (\d+)", element.get_text(strip=True))
            if match:
                page = int(match.group(1))
        elif element.find_parent("table") is None:
            data = extract_table(element)
            if data["columns"]:
                tables.append({"number": len(tables) + 1, "page": page, **data})
    return {
        "html": str(soup),
        "tables": tables,
        "row_count": sum(len(table["rows"]) for table in tables),
    }


def court_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="report")
    if table is None:
        raise DocumentError(
            "The portal did not return the Court cases & Others report table. "
            "No result has been cached; try again when the portal is available."
        )
    data = extract_table(table)
    if not data["columns"]:
        raise DocumentError("The court report table has no identifiable columns.")
    if len(data["rows"]) == 1:
        distinct = {cell.casefold().strip(" .") for cell in data["rows"][0] if cell}
        if distinct and all(
            re.fullmatch(r"no (?:records?|data)(?: (?:found|available))?", value)
            for value in distinct
        ):
            return "The portal returned no rows in the Court cases & Others report.\n"

    def cell(value: str) -> str:
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "&#124;")

    lines = [
        "| " + " | ".join(cell(value) for value in data["columns"]) + " |",
        "| " + " | ".join("---" for _ in data["columns"]) + " |",
    ]
    lines.extend("| " + " | ".join(cell(value) for value in row) + " |" for row in data["rows"])
    return "\n".join(lines) + "\n"


def csv_export(tables: list[dict[str, Any]]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    for table in tables:
        writer.writerow(["Table", table["number"], "PDF page", table["page"] or ""])
        for row in [table["columns"], *table["rows"]]:
            writer.writerow([
                "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value
                for value in row
            ])
        writer.writerow([])
    return "\ufeff" + stream.getvalue()
