from __future__ import annotations

import copy
import logging
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import closing
from typing import Any, Callable

import pymupdf

from telangana_prohibited_properties import TelanganaPortal

from .catalog import CATEGORIES, Catalog, Selection
from .documents import court_markdown
from .ocr import TesseractOCR
from .store import CacheError, ReportStore, SavedReport, now_iso


LOG = logging.getLogger(__name__)
TERMINAL_STATES = {"completed", "partial", "failed"}


class QueueFullError(RuntimeError):
    pass


class ReportService:
    def __init__(
        self,
        catalog: Catalog,
        store: ReportStore,
        portal_factory: Callable[[], TelanganaPortal],
        ocr_factory: Callable[[], TesseractOCR],
    ) -> None:
        self.catalog = catalog
        self.store = store
        self.portal_factory = portal_factory
        self.ocr_factory = ocr_factory
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="prohibited-ocr")
        self.lock = threading.RLock()
        self.jobs: dict[str, dict[str, Any]] = {}
        self.futures: dict[str, Future[None]] = {}
        self.active: dict[tuple[str, ...], str] = {}

    def search(self, selection: Selection) -> tuple[dict[str, Any], int]:
        if not selection.force_refresh:
            reports = [self.store.read(selection, category) for category in selection.categories]
            if all(report is not None for report in reports):
                return {
                    **selection.public(),
                    "state": "completed",
                    "served_from": "cache",
                    "reports": [
                        report.public(self.store.root, cached=True)
                        for report in reports if report is not None
                    ],
                    "errors": [],
                    "message": "Rendered saved Markdown. No portal or OCR request was made.",
                }, 200
        with self.lock:
            if selection.key in self.active:
                job_id = self.active[selection.key]
                return copy.deepcopy(self.jobs[job_id]), 202
            if len(self.active) >= 16:
                raise QueueFullError("The local OCR queue is full. Wait for a report to finish before trying again.")
            finished = [key for key, job in self.jobs.items() if job["state"] in TERMINAL_STATES]
            for key in finished[:-48]:
                self.jobs.pop(key)
                self.futures.pop(key, None)
            job_id = uuid.uuid4().hex
            self.jobs[job_id] = {
                **selection.public(),
                "job_id": job_id,
                "state": "queued",
                "served_from": "refresh" if selection.force_refresh else "fetch",
                "created_at": now_iso(),
                "reports": [],
                "errors": [],
                "progress": {
                    "reports_done": 0,
                    "reports_total": len(selection.categories),
                    "pages_done": 0,
                    "pages_total": 0,
                },
                "message": "Queued for the local report worker.",
            }
            self.active[selection.key] = job_id
            self.futures[job_id] = self.executor.submit(self._run, job_id, selection)
            return copy.deepcopy(self.jobs[job_id]), 202

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
            return copy.deepcopy(job) if job is not None else None

    def _update(self, job_id: str, **values: Any) -> None:
        with self.lock:
            self.jobs[job_id].update(values)

    def _run(self, job_id: str, selection: Selection) -> None:
        reports: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        total = len(selection.categories)
        self._update(job_id, state="running", message="Reading saved reports.")
        try:
            for index, category in enumerate(selection.categories):
                label = str(CATEGORIES[category]["label"])
                progress = {
                    "reports_done": index,
                    "reports_total": total,
                    "pages_done": 0,
                    "pages_total": 0,
                }
                self._update(job_id, message=f"Loading {label}.", progress=progress)
                try:
                    saved = None if selection.force_refresh else self.store.read(selection, category)
                    cached = saved is not None
                    if saved is None:
                        def on_page(done: int, pages: int) -> None:
                            self._update(
                                job_id,
                                message=f"{label}: parsed page {done} of {pages} locally.",
                                progress={**progress, "pages_done": done, "pages_total": pages},
                            )
                        saved = self._fetch(selection, category, on_page)
                    reports.append(saved.public(self.store.root, cached=cached))
                except Exception as exc:
                    # This is the worker boundary: preserve good files and expose a failed report,
                    # rather than marking partial OCR output as a successful cache entry.
                    LOG.exception("Report processing failed: %s / %s", selection.key[:5], category)
                    error = {"category": category, "label": label, "message": str(exc)}
                    errors.append(error)
                    previous: SavedReport | None = None
                    if selection.force_refresh:
                        try:
                            previous = self.store.read(selection, category)
                        except CacheError:
                            LOG.warning("The previous report cache is not readable.")
                    if previous is not None:
                        reports.append({
                            **previous.public(self.store.root, cached=True),
                            "refresh_error": str(exc),
                        })
                    else:
                        reports.append({
                            "category": category,
                            "label": label,
                            "status": "error",
                            "error": str(exc),
                            "cached": False,
                            "has_pdf": False,
                            "tables": [],
                            "row_count": 0,
                        })
                self._update(
                    job_id,
                    reports=copy.deepcopy(reports),
                    errors=copy.deepcopy(errors),
                    progress={
                        "reports_done": index + 1,
                        "reports_total": total,
                        "pages_done": 0,
                        "pages_total": 0,
                    },
                )
            state = "completed" if not errors else ("failed" if len(errors) == total else "partial")
            self._update(
                job_id,
                state=state,
                finished_at=now_iso(),
                message=(
                    "Reports are saved as Markdown. Future lookups will use these files."
                    if not errors else
                    "Some reports could not be refreshed. Existing saved copies were not replaced."
                ),
            )
        except Exception as exc:
            LOG.exception("Unexpected report worker failure.")
            self._update(
                job_id, state="failed", message=f"Report worker failed: {exc}", finished_at=now_iso()
            )
        finally:
            with self.lock:
                self.active.pop(selection.key, None)

    def _fetch(
        self, selection: Selection, category: str, progress: Callable[[int, int], None]
    ) -> SavedReport:
        kind = CATEGORIES[category]["kind"]
        if kind == "unavailable":
            return self.store.save(
                selection,
                category,
                "The public portal does not expose this category's report. "
                "For Section 22A(1)(c), contact the CEO, Waqf or Commissioner, Endowment, "
                "as appropriate. No PDF form number is assumed.",
                status="not_provided",
                engine="portal category notice",
            )
        with closing(self.portal_factory()) as portal:
            portal.start()
            if kind == "html":
                html = portal.download_court_cases(selection.location, selection.property_type)
                return self.store.save(
                    selection,
                    category,
                    court_markdown(html),
                    status="ready",
                    engine="portal HTML table (OCR not required)",
                )
            if not portal.pdf_exists(selection.location, selection.property_type, category):
                return self.store.save(
                    selection,
                    category,
                    "The portal did not publish an available PDF for this selection at fetch time. "
                    "The information may be under verification. Use Force refresh to check again.",
                    status="not_published",
                    engine="portal availability check",
                )
            with closing(self.ocr_factory()) as ocr:
                ocr.check_health()
                pdf = portal.download_pdf(selection.location, selection.property_type, category)
                fetched_at = now_iso()
                source, digest = self.store.source_pdf(selection, pdf)
                pages = ocr.parse_pdf(source, progress=progress)
                with pymupdf.open(source) as document:
                    expected_pages = len(document)
                if not pages or [page.number for page in pages] != list(range(1, expected_pages + 1)):
                    raise RuntimeError("OCR did not return a complete, ordered document.")
                body = "\n\n".join(f"## Page {page.number}\n\n{page.markdown}" for page in pages)
                return self.store.save(
                    selection,
                    category,
                    body,
                    status="ready",
                    engine=ocr.name,
                    page_count=len(pages),
                    source_sha256=digest,
                    fetched_at=fetched_at,
                )

    def shutdown(self) -> None:
        self.executor.shutdown(wait=True)
