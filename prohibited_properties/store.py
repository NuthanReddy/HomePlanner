from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from telangana_prohibited_properties import BASE_URL

from .catalog import CATEGORIES, Selection
from .documents import normalize_markdown_tables, render_document


PREFIX = "<!-- homeplanner-prohibited-report:v1\n"
SUFFIX = "\n-->\n"
STATUSES = {"ready", "not_published", "not_provided"}
DISCLAIMER = (
    "This is a saved copy of public portal information, not a title clearance or legal opinion. "
    "OCR can misread survey numbers, names and extents. Verify against the original report "
    "and the registration authority. An unpublished report does not mean a property is unrestricted."
)


class CacheError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


@dataclass(frozen=True)
class SavedReport:
    path: Path
    metadata: dict[str, Any]
    markdown: str

    def public(self, root: Path, cached: bool) -> dict[str, Any]:
        pdf_name = self.metadata.get("source_pdf")
        pdf_exists = bool(pdf_name and self.path.parent.joinpath("_sources", pdf_name).is_file())
        return {
            **self.metadata,
            "cached": cached,
            "cache_path": str(self.path.relative_to(root)),
            "markdown": self.markdown,
            "has_pdf": pdf_exists,
            **render_document(self.markdown),
        }


class ReportStore:
    """Markdown is the authoritative cache; derived HTML/rows are rebuilt on reads."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def directory(self, selection: Selection) -> Path:
        loc = selection.location
        components = [loc.district_code, loc.mandal_code, loc.village_code]
        if loc.sro_code:
            components.append(f"sro-{loc.sro_code}")
        components.append(selection.property_type)
        if any(not re.fullmatch(r"[A-Za-z0-9_-]+", component) for component in components):
            raise CacheError("Unsafe location code in metadata.")
        path = self.root.joinpath(*components).resolve()
        if not path.is_relative_to(self.root):
            raise CacheError("Report directory escapes the configured cache.")
        return path

    def path(self, selection: Selection, category: str) -> Path:
        if category not in CATEGORIES:
            raise CacheError("Unknown report category.")
        path = self.directory(selection).joinpath(f"{category}.md").resolve()
        if not path.is_relative_to(self.root):
            raise CacheError("Report path escapes the configured cache.")
        return path

    def read(self, selection: Selection, category: str) -> SavedReport | None:
        path = self.path(selection, category)
        if not path.exists():
            return None
        try:
            content = path.read_text(encoding="utf-8")
            if not content.startswith(PREFIX):
                raise ValueError("Missing report metadata.")
            raw, body = content[len(PREFIX):].split(SUFFIX, 1)
            metadata = json.loads(raw)
            if (
                metadata.get("schema_version") != 1
                or metadata.get("status") not in STATUSES
                or metadata.get("location") != asdict(selection.location)
                or metadata.get("prohib_type") != selection.property_type
                or metadata.get("category") != category
                or not isinstance(metadata.get("fetched_at"), str)
                or not body.strip()
            ):
                raise ValueError("The cache does not match the selected report.")
            pdf_name = metadata.get("source_pdf")
            if pdf_name is not None and (
                not isinstance(pdf_name, str) or not re.fullmatch(r"[a-f0-9]{64}\.pdf", pdf_name)
            ):
                raise ValueError("Invalid source PDF reference.")
            return SavedReport(path, metadata, body.lstrip("\n"))
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            raise CacheError(
                f"The saved {CATEGORIES[category]['label']} Markdown is invalid. "
                "Review the file or explicitly use Force refresh to replace it."
            ) from exc

    def source_pdf(self, selection: Selection, pdf: bytes) -> tuple[Path, str]:
        digest = hashlib.sha256(pdf).hexdigest()
        path = self.directory(selection).joinpath("_sources", f"{digest}.pdf").resolve()
        if not path.is_relative_to(self.root):
            raise CacheError("Source PDF path escapes the configured cache.")
        if not path.exists():
            atomic_write(path, pdf)
        return path, digest

    def save(
        self,
        selection: Selection,
        category: str,
        body: str,
        *,
        status: str,
        engine: str,
        page_count: int = 0,
        source_sha256: str | None = None,
        fetched_at: str | None = None,
    ) -> SavedReport:
        if status not in STATUSES or not body.strip():
            raise CacheError("Incomplete reports cannot be cached.")
        body = normalize_markdown_tables(body)
        loc = selection.location
        title = f"{loc.village_name} - {selection.property_type} - {CATEGORIES[category]['label']}"
        metadata = {
            "schema_version": 1,
            "location": asdict(loc),
            "prohib_type": selection.property_type,
            "category": category,
            "label": CATEGORIES[category]["label"],
            "status": status,
            "engine": engine,
            "page_count": page_count,
            "fetched_at": fetched_at or now_iso(),
            "saved_at": now_iso(),
            "source_url": f"{BASE_URL}/prohibitionPublicList.htm",
            "source_sha256": source_sha256,
            "source_pdf": f"{source_sha256}.pdf" if source_sha256 else None,
        }
        markdown = (
            f"# {title}\n\n"
            f"{loc.district_name} / {loc.mandal_name} / {loc.village_name}"
            + (f" / {loc.sro_name}" if loc.sro_code else "")
            + f"\n\n> {DISCLAIMER}\n\n{body.strip()}\n"
        )
        render_document(markdown)
        header = json.dumps(metadata, ensure_ascii=False, indent=2).replace("-->", "--\\u003e")
        content = PREFIX + header + SUFFIX + "\n" + markdown
        path = self.path(selection, category)
        atomic_write(path, content.encode("utf-8"))
        return SavedReport(path, metadata, markdown)

    def pdf_path(self, report: SavedReport) -> Path | None:
        name = report.metadata.get("source_pdf")
        if not name:
            return None
        path = report.path.parent.joinpath("_sources", name).resolve()
        if not path.is_relative_to(self.root):
            raise CacheError("Saved PDF path escapes the configured cache.")
        return path if path.is_file() else None
