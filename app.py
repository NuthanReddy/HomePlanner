from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_file, send_from_directory
from werkzeug.exceptions import HTTPException

from prohibited_properties.catalog import Catalog, CatalogError, InputError
from prohibited_properties.documents import DocumentError, csv_export
from prohibited_properties.ocr import OCRError, TesseractOCR
from prohibited_properties.service import QueueFullError, ReportService
from prohibited_properties.store import CacheError, ReportStore
from telangana_prohibited_properties import TelanganaPortal
from python_analysis import (
    AnalysisError, MAX_PAYLOAD_BYTES, calculate_density, calculate_solar, capabilities,
    calculate_current_weather_density,
)


ROOT = Path(__file__).resolve().parent


def create_app(config: dict | None = None, service: ReportService | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.from_mapping(
        MAX_CONTENT_LENGTH=16_384,
        TRUSTED_HOSTS=["127.0.0.1", "localhost", "[::1]"],
        METADATA_FILE=ROOT.joinpath("prohibited-properties", "metadata", "all-values.json"),
        REPORT_CACHE=ROOT.joinpath("prohibited-properties", "parsed"),
        OCR_LANGUAGES=os.environ.get("TESSERACT_LANGUAGES", "eng+tel"),
        OCR_COMMAND=os.environ.get("TESSERACT_CMD"),
        OCR_TIMEOUT=120,
        OCR_DPI=300,
    )
    if config:
        app.config.update(config)
    catalog_error: str | None = None

    def make_ocr() -> TesseractOCR:
        return TesseractOCR(
            languages=app.config["OCR_LANGUAGES"],
            command=app.config["OCR_COMMAND"],
            timeout=app.config["OCR_TIMEOUT"],
            dpi=app.config["OCR_DPI"],
        )

    if service is None:
        try:
            service = ReportService(
                Catalog(Path(app.config["METADATA_FILE"])),
                ReportStore(Path(app.config["REPORT_CACHE"])),
                lambda: TelanganaPortal(timeout=60, delay=0.35, retries=2),
                make_ocr,
            )
        except CatalogError as exc:
            app.logger.error("%s", exc)
            catalog_error = str(exc)
    app.extensions["prohibited_reports"] = service
    analysis_slots = threading.BoundedSemaphore(2)

    def reports() -> ReportService:
        if service is None:
            raise CatalogError(catalog_error or "Location catalog unavailable.")
        return service

    def saved_report():
        selected = reports().catalog.select(request.args)
        if selected.category == "all":
            raise InputError("Choose one report category for this operation.")
        saved = reports().store.read(selected, selected.category)
        if saved is None:
            abort(404, "This report has not been saved yet. Fetch the selection first.")
        return saved

    @app.before_request
    def same_origin_writes():
        if request.method == "POST" and request.path.startswith("/api/"):
            origin = request.headers.get("Origin")
            if origin and origin != request.host_url.rstrip("/"):
                abort(403, "Only same-origin API requests are accepted.")
        if request.path.startswith("/api/analysis/") and request.method == "POST":
            request.max_content_length = min(app.config["MAX_CONTENT_LENGTH"] or MAX_PAYLOAD_BYTES, MAX_PAYLOAD_BYTES)
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                abort(403, "Only same-origin API requests are accepted.")

    @app.after_request
    def response_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(InputError)
    def input_error(exc):
        app.logger.warning("Invalid prohibited-property input: %s", exc)
        return jsonify(error={"code": "invalid_selection", "message": str(exc)}), 400

    @app.errorhandler(CacheError)
    @app.errorhandler(DocumentError)
    def cache_error(exc):
        app.logger.error("Saved report cannot be rendered: %s", exc)
        return jsonify(error={"code": "invalid_saved_report", "message": str(exc)}), 409

    @app.errorhandler(CatalogError)
    def metadata_error(exc):
        return jsonify(error={"code": "metadata_unavailable", "message": str(exc)}), 503

    @app.errorhandler(QueueFullError)
    def queue_error(exc):
        return jsonify(error={"code": "queue_full", "message": str(exc)}), 429

    @app.errorhandler(HTTPException)
    def http_error(exc):
        if request.path.startswith("/api/"):
            return jsonify(error={"code": exc.name, "message": exc.description}), exc.code
        return exc

    @app.get("/")
    def index():
        return send_file(ROOT.joinpath("index.html"))

    @app.get("/user-guide.html")
    def user_guide():
        return send_file(ROOT.joinpath("user-guide.html"))

    @app.get("/prohibited-properties")
    def prohibited_workspace():
        return redirect("/?workspace=prohibited")

    @app.get("/api/analysis/capabilities")
    def analysis_capabilities():
        return jsonify(capabilities())

    def run_analysis(calculation):
        try:
            data = request.get_json()
        except RecursionError:
            return jsonify(error={"code": "invalid_input", "message": "Calculation JSON is nested too deeply."}), 400
        if not analysis_slots.acquire(blocking=False):
            return jsonify(error={"code": "analysis_busy", "message": "Local calculations are busy. Try again shortly."}), 429
        try:
            return jsonify(calculation(data))
        except AnalysisError as exc:
            return jsonify(exc.public()), exc.status
        except Exception:
            app.logger.exception("Local analysis failed")
            return jsonify(status="error", error={
                "code": "calculation_failed",
                "message": "Local calculation failed. Review the supplied inputs and the local service log, then retry.",
            }), 500
        finally:
            analysis_slots.release()

    @app.post("/api/analysis/air-density")
    def analysis_density():
        return run_analysis(calculate_density)

    @app.post("/api/analysis/current-weather-density")
    def analysis_current_weather_density():
        return run_analysis(calculate_current_weather_density)

    @app.post("/api/analysis/solar-position")
    def analysis_solar():
        return run_analysis(calculate_solar)

    @app.get("/api/prohibited/options")
    def options():
        return jsonify({
            **reports().catalog.public(),
            "cache_policy": "Saved Markdown is reused indefinitely unless force_refresh is true.",
            "ocr": {"name": "Tesseract", "backend": "local", "languages": app.config["OCR_LANGUAGES"]},
        })

    @app.get("/api/prohibited/mandals")
    def mandals():
        catalog = reports().catalog
        dist = catalog.district(request.args)
        return jsonify(options=catalog.options(catalog.mandals.get(dist, {})))

    @app.get("/api/prohibited/villages")
    def villages():
        catalog = reports().catalog
        pair = catalog.mandal(request.args)
        return jsonify(options=catalog.options(catalog.villages.get(pair, {})))

    @app.get("/api/prohibited/sros")
    def sros():
        catalog = reports().catalog
        triple = catalog.village(request.args)
        values = catalog.sros.get(triple, {})
        return jsonify(options=catalog.options(values), required=bool(values))

    @app.get("/api/prohibited/ocr-status")
    def ocr_status():
        try:
            ocr = reports().ocr_factory()
            try:
                ocr.check_health()
            finally:
                ocr.close()
        except OCRError as exc:
            return jsonify(
                ready=False,
                name="Tesseract",
                message=str(exc),
                cached_reports_available=True,
            ), 503
        return jsonify(ready=True, name="Tesseract", message="Local Tesseract and the requested languages are available.")

    @app.post("/api/prohibited/search")
    def search():
        data = request.get_json()
        if not isinstance(data, dict):
            raise InputError("Supply a JSON object containing the selected location.")
        selected = reports().catalog.select(data)
        result, status = reports().search(selected)
        return jsonify(result), status

    @app.get("/api/prohibited/jobs/<job_id>")
    def job(job_id: str):
        result = reports().get_job(job_id)
        if result is None:
            abort(404, "Job not found. Search again; saved Markdown is retained across restarts.")
        return jsonify(result)

    @app.get("/api/prohibited/report")
    def report():
        return jsonify(saved_report().public(reports().store.root, cached=True))

    @app.get("/api/prohibited/download")
    def download():
        saved = saved_report()
        file_format = request.args.get("format", "markdown")
        location = saved.metadata["location"]
        filename = f"{location['village_code']}-{saved.metadata['prohib_type']}-{saved.metadata['category']}"
        if file_format == "markdown":
            return send_file(saved.path, mimetype="text/markdown", as_attachment=True, download_name=f"{filename}.md")
        if file_format == "pdf":
            path = reports().store.pdf_path(saved)
            if path is None:
                abort(404, "No source PDF is stored for this report.")
            return send_file(
                path,
                mimetype="application/pdf",
                as_attachment=request.args.get("attachment") == "1",
                download_name=f"{filename}.pdf",
            )
        if file_format == "csv":
            public = saved.public(reports().store.root, cached=True)
            response = app.response_class(csv_export(public["tables"]), mimetype="text/csv")
            response.headers["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
            return response
        raise InputError("format must be markdown, pdf or csv.")

    @app.get("/<path:asset>")
    def static_asset(asset: str):
        # Do not expose the repository root, Python sources, credentials or raw cache files.
        candidate = ROOT.joinpath(asset).resolve()
        top_level_asset = (
            candidate.parent == ROOT
            and candidate.suffix in {".js", ".css"}
            and candidate.is_file()
        )
        vendor_asset = (
            candidate.is_relative_to(ROOT.joinpath("vendor").resolve())
            and candidate.suffix in {".js", ".css", ".png", ".svg", ".woff", ".woff2", ".json"}
            and candidate.is_file()
        )
        if not (top_level_asset or vendor_asset):
            abort(404)
        return send_from_directory(ROOT, asset)

    return app


if __name__ == "__main__":
    from waitress import serve

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    port = int(os.environ.get("HOMEPLANNER_PORT", "8000"))
    application = create_app()
    logging.info("HomePlanner: http://127.0.0.1:%s/?workspace=prohibited", port)
    try:
        serve(application, host="127.0.0.1", port=port, threads=4)
    finally:
        report_service = application.extensions.get("prohibited_reports")
        if report_service is not None:
            report_service.shutdown()
