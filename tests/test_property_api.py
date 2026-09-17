import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock

import pymupdf

from app import create_app
from prohibited_properties.catalog import Catalog, InputError
from prohibited_properties.documents import DocumentError, court_markdown, render_document
from prohibited_properties.ocr import OCRError, OCRPage
from prohibited_properties.service import ReportService
from prohibited_properties.store import PREFIX, SUFFIX, ReportStore
from telangana_prohibited_properties import Location, TelanganaPortal


RR = Location("15_1", "RANGAREDDY", "16", "MAHESHWARAM", "1533009", "PENDYAL")
HYD = Location("16_1", "HYDERABAD", "00", "HYDERABAD", "1600001", "HYDERABAD DIVISION", "1607", "HYDERABAD (R.O)")
PARAMS = {
    "dist_code": "15_1", "mand_code": "16", "vill_code": "1533009",
    "sro_code": "", "prohib_type": "AGRI", "category": "1",
}
TABLE = "| Survey number | Extent |\n| --- | --- |\n| 001/2 | 0.25 |\n| 003 | 0 |\n"
COURT = """<html><script>alert(1)</script><table id="report"><thead>
<tr><th rowspan="2">Survey No.</th><th colspan="2">Document</th></tr>
<tr><th>Number</th><th>Year</th></tr></thead><tbody>
<tr><td>001/2</td><td>0007</td><td>2026</td></tr></tbody></table></html>"""


def fixture_catalog(path):
    path.write_text(json.dumps({
        "districts": [
            {"district_code": "15_1", "district_name": "RANGAREDDY"},
            {"district_code": "16_1", "district_name": "HYDERABAD"},
        ],
        "mandals": [
            {"district_code": "15_1", "mandal_code": "16", "mandal_name": "MAHESHWARAM"},
            {"district_code": "16_1", "mandal_code": "00", "mandal_name": "HYDERABAD"},
        ],
        "locations": [RR.__dict__, HYD.__dict__],
    }), encoding="utf-8")
    return Catalog(path)


class FakePortal:
    def __init__(self):
        self.calls = []
        self.available = True
        document = pymupdf.open()
        for _ in range(2):
            document.new_page().insert_text((30, 30), "Synthetic test PDF")
        self.pdf = document.tobytes()
        document.close()

    def start(self):
        self.calls.append("start")

    def close(self):
        self.calls.append("close")

    def pdf_exists(self, *args):
        self.calls.append("exists")
        return self.available

    def download_pdf(self, *args):
        self.calls.append("pdf")
        return self.pdf

    def download_court_cases(self, *args):
        self.calls.append("court")
        return COURT


class FakeOCR:
    name = "Synthetic test OCR"

    def __init__(self):
        self.calls = []
        self.error = None
        self.incomplete = False

    def close(self):
        self.calls.append("close")

    def check_health(self):
        self.calls.append("health")
        if self.error:
            raise OCRError(self.error)

    def parse_pdf(self, path, progress=None):
        self.calls.append("parse")
        if progress:
            progress(1, 2)
            progress(2, 2)
        return [OCRPage(1, TABLE)] if self.incomplete else [OCRPage(1, TABLE), OCRPage(2, TABLE)]


class PropertyAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.catalog = fixture_catalog(self.root.joinpath("metadata.json"))
        self.store = ReportStore(self.root.joinpath("parsed"))
        self.portal = FakePortal()
        self.ocr = FakeOCR()
        self.service = ReportService(self.catalog, self.store, lambda: self.portal, lambda: self.ocr)
        self.app = create_app({"TESTING": True}, service=self.service)
        self.client = self.app.test_client()

    def tearDown(self):
        self.service.shutdown()
        self.temp.cleanup()

    def search(self, params=None):
        response = self.client.post("/api/prohibited/search", json=params or PARAMS)
        if response.status_code == 202:
            job_id = response.json["job_id"]
            self.service.futures[job_id].result(timeout=15)
            return self.client.get(f"/api/prohibited/jobs/{job_id}")
        return response

    def test_cascading_options_keep_zero_codes_and_validate_parent(self):
        options = self.client.get("/api/prohibited/options").json
        self.assertEqual(options["counts"]["districts"], 2)
        self.assertEqual(options["ocr"]["backend"], "local")
        self.assertEqual(
            self.client.get("/api/prohibited/mandals?dist_code=16_1").json["options"],
            [{"code": "00", "name": "HYDERABAD"}],
        )
        self.assertEqual(
            self.client.get("/api/prohibited/villages?dist_code=16_1&mand_code=16").status_code, 400
        )
        sros = self.client.get("/api/prohibited/sros?dist_code=16_1&mand_code=00&vill_code=1600001").json
        self.assertTrue(sros["required"])
        self.assertEqual(sros["options"][0]["code"], "1607")
        self.assertEqual(self.portal.calls, [])

    def test_hyderabad_requires_sro_and_ordinary_village_rejects_sro(self):
        params = {**PARAMS, "dist_code": "16_1", "mand_code": "00", "vill_code": "1600001"}
        self.assertEqual(self.client.post("/api/prohibited/search", json=params).status_code, 400)
        self.assertEqual(self.client.post("/api/prohibited/search", json={**PARAMS, "sro_code": "1607"}).status_code, 400)
        self.assertEqual(self.search({**params, "sro_code": "1607"}).json["state"], "completed")
        self.assertTrue(self.root.joinpath("parsed", "16_1", "00", "1600001", "sro-1607", "AGRI", "1.md").is_file())

    def test_first_fetch_persists_markdown_and_all_pdf_pages(self):
        result = self.search().json
        self.assertEqual(result["state"], "completed")
        report = result["reports"][0]
        self.assertFalse(report["cached"])
        self.assertEqual(report["page_count"], 2)
        self.assertEqual(report["row_count"], 4)
        self.assertEqual(report["tables"][0]["rows"][0], ["001/2", "0.25"])
        path = self.root.joinpath("parsed", "15_1", "16", "1533009", "AGRI", "1.md")
        self.assertTrue(path.is_file())
        self.assertIn("## Page 2", path.read_text())
        self.assertIn(PREFIX, path.read_text())
        self.assertIn("parse", self.ocr.calls)

    def test_repeat_uses_actual_markdown_even_after_service_restart(self):
        self.search()
        selected = self.catalog.select(PARAMS)
        path = self.store.path(selected, "1")
        path.write_text(path.read_text().replace("001/2", "009/7"), encoding="utf-8")
        self.portal.calls.clear()
        self.ocr.calls.clear()
        second = ReportService(self.catalog, ReportStore(self.store.root), lambda: self.portal, lambda: self.ocr)
        try:
            client = create_app({"TESTING": True}, service=second).test_client()
            response = client.post("/api/prohibited/search", json=PARAMS)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["served_from"], "cache")
            self.assertTrue(response.json["reports"][0]["cached"])
            self.assertEqual(response.json["reports"][0]["tables"][0]["rows"][0][0], "009/7")
            self.assertEqual(self.portal.calls, [])
            self.assertEqual(self.ocr.calls, [])
        finally:
            second.shutdown()

    def test_only_boolean_force_refresh_bypasses_cache(self):
        self.search()
        self.portal.calls.clear()
        self.ocr.calls.clear()
        self.assertEqual(self.search({**PARAMS, "force_refresh": False}).json["served_from"], "cache")
        self.assertEqual(self.ocr.calls, [])
        result = self.search({**PARAMS, "force_refresh": True}).json
        self.assertEqual(result["state"], "completed")
        self.assertIn("parse", self.ocr.calls)
        for value in ["true", 1, None, []]:
            with self.subTest(value=value):
                response = self.client.post("/api/prohibited/search", json={**PARAMS, "force_refresh": value})
                self.assertEqual(response.status_code, 400)

    def test_refresh_failure_keeps_previous_markdown_and_marks_error(self):
        self.search()
        path = self.store.path(self.catalog.select(PARAMS), "1")
        before = path.read_bytes()
        self.ocr.error = "Tesseract unavailable for test"
        result = self.search({**PARAMS, "force_refresh": True}).json
        self.assertEqual(result["state"], "failed")
        self.assertTrue(result["errors"])
        self.assertTrue(result["reports"][0]["cached"])
        self.assertIn("refresh_error", result["reports"][0])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.search().json["served_from"], "cache")

    def test_incomplete_document_never_gets_marked_as_complete(self):
        self.ocr.incomplete = True
        result = self.search().json
        self.assertEqual(result["state"], "failed")
        self.assertIsNone(self.store.read(self.catalog.select(PARAMS), "1"))

    def test_availability_and_not_provided_not_equated_with_clear_title(self):
        self.portal.available = False
        report = self.search().json["reports"][0]
        self.assertEqual(report["status"], "not_published")
        self.assertIn("does not mean", report["markdown"])
        self.assertEqual(self.ocr.calls, [])
        self.portal.calls.clear()
        unsupported = self.search({**PARAMS, "category": "waqf"}).json["reports"][0]
        self.assertEqual(unsupported["status"], "not_provided")
        self.assertEqual(self.portal.calls, [])
        self.assertNotIn("formtype=3", unsupported["markdown"])

    def test_court_report_flattens_real_merged_headers_without_ocr(self):
        result = self.search({**PARAMS, "category": "court"}).json
        self.assertEqual(result["state"], "completed")
        table = result["reports"][0]["tables"][0]
        self.assertEqual(table["columns"], ["Survey No.", "Document / Number", "Document / Year"])
        self.assertEqual(table["rows"], [["001/2", "0007", "2026"]])
        self.assertEqual(self.ocr.calls, [])

    def test_empty_court_notice_and_missing_table_are_distinct(self):
        empty = '<table id="report"><tr><th>Survey</th></tr><tr><td>No Records Found</td></tr></table>'
        self.assertIn("no rows", court_markdown(empty))
        with self.assertRaises(DocumentError):
            court_markdown("<html><h1>Service temporarily unavailable</h1></html>")

    def test_all_categories_complete_and_repeat_without_remote_requests(self):
        first = self.search({**PARAMS, "category": "all"}).json
        self.assertEqual(first["state"], "completed")
        self.assertEqual(len(first["reports"]), 7)
        self.portal.calls.clear()
        self.ocr.calls.clear()
        self.assertEqual(self.search({**PARAMS, "category": "all"}).json["served_from"], "cache")
        self.assertEqual(self.portal.calls, [])
        self.assertEqual(self.ocr.calls, [])

    def test_saved_document_downloads_and_repository_static_allowlist(self):
        self.search()
        with closing(self.client.get("/api/prohibited/download", query_string={**PARAMS, "format": "markdown"})) as response:
            self.assertTrue(response.headers["Content-Disposition"].startswith("attachment"))
            self.assertIn(PREFIX.encode(), response.data)
        with closing(self.client.get("/api/prohibited/download", query_string={**PARAMS, "format": "pdf"})) as pdf:
            self.assertTrue(pdf.data.startswith(b"%PDF"))
            self.assertEqual(pdf.mimetype, "application/pdf")
        for asset in ["/", "/user-guide.html", "/planner-guide.js", "/planner-guide.css", "/prohibited-properties.js"]:
            with closing(self.client.get(asset)) as response:
                self.assertEqual(response.status_code, 200)
        for path in ["/app.py", "/.git/config", "/.env", "/requirements.txt", "/../Website/requirements.txt"]:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_error_payloads_origins_and_bad_input(self):
        for params in [
            {**PARAMS, "vill_code": "../outside"},
            {**PARAMS, "category": "7"},
            {**PARAMS, "prohib_type": "agri"},
            {**PARAMS, "dist_code": None},
        ]:
            self.assertEqual(self.client.post("/api/prohibited/search", json=params).status_code, 400)
        self.assertEqual(self.client.post("/api/prohibited/search", json=[]).status_code, 400)
        denied = self.client.post("/api/prohibited/search", json=PARAMS, headers={"Origin": "https://unrelated.example"})
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(self.client.get("/api/prohibited/jobs/missing").status_code, 404)
        self.assertEqual(self.client.get("/api/prohibited/report", query_string=PARAMS).status_code, 404)
        self.assertEqual(self.portal.calls, [])

    def test_invalid_cache_is_explicit_and_not_automatically_refetched(self):
        selected = self.catalog.select(PARAMS)
        path = self.store.path(selected, "1")
        path.parent.mkdir(parents=True)
        path.write_text("Not a complete saved report", encoding="utf-8")
        response = self.client.post("/api/prohibited/search", json=PARAMS)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["error"]["code"], "invalid_saved_report")
        self.assertEqual(self.portal.calls, [])
        self.assertEqual(self.search({**PARAMS, "force_refresh": True}).json["state"], "completed")

    def test_markdown_rendering_strips_active_content_and_csv_formulas(self):
        selected = self.catalog.select(PARAMS)
        self.store.save(
            selected, "1",
            '<script>BAD_SCRIPT</script><img src="https://tracker.invalid/pixel">'
            '<table><tr><th>Name</th></tr><tr><td onclick="alert(1)">=CMD()</td></tr></table>'
            '<a href="javascript:alert(1)">unsafe</a>',
            status="ready", engine="Synthetic test",
        )
        result = self.search().json["reports"][0]
        for unsafe in ["BAD_SCRIPT", "onclick", "<img", "javascript:"]:
            self.assertNotIn(unsafe, result["html"])
        csv = self.client.get("/api/prohibited/download", query_string={**PARAMS, "format": "csv"}).get_data(as_text=True)
        self.assertIn("'=CMD()", csv)

    def test_source_metadata_cannot_redirect_download_outside_cache(self):
        self.search()
        path = self.store.path(self.catalog.select(PARAMS), "1")
        content = path.read_text()
        raw, body = content[len(PREFIX):].split(SUFFIX, 1)
        metadata = json.loads(raw)
        metadata["source_pdf"] = "../../outside.pdf"
        path.write_text(PREFIX + json.dumps(metadata) + SUFFIX + body, encoding="utf-8")
        self.assertEqual(
            self.client.get("/api/prohibited/download", query_string={**PARAMS, "format": "pdf"}).status_code, 409
        )

    def test_missing_catalog_does_not_break_existing_planning_ui(self):
        app = create_app({"TESTING": True, "METADATA_FILE": self.root.joinpath("missing.json")})
        client = app.test_client()
        with closing(client.get("/")) as response:
            self.assertEqual(response.status_code, 200)
        response = client.get("/api/prohibited/options")
        self.assertEqual(response.status_code, 503)
        self.assertIn("metadata", response.json["error"]["message"])

    def test_portal_unknown_availability_response_is_an_error(self):
        portal = TelanganaPortal(1, 0, 0)
        try:
            portal._json = Mock(return_value={"error": "session expired"})
            with self.assertRaisesRegex(RuntimeError, "unrecognized"):
                portal.pdf_exists(RR, "AGRI", "1")
            portal._json.return_value = {}
            self.assertFalse(portal.pdf_exists(RR, "AGRI", "1"))
        finally:
            portal.close()


if __name__ == "__main__":
    unittest.main()
