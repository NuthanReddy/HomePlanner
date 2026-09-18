"""Local API guards with explicit test-only compiler/process/file fixtures."""
import copy
import io
import json
import sys
import unittest
import uuid
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app import create_app
import cfd_runtime as cfd
from tests.test_cfd_runtime import (
    FixtureRuntime, OwnedFixtureTest, SYNTHETIC_REQUEST, SYNTHETIC_SOURCE, synthetic_compiler,
)


class CfdAPITests(OwnedFixtureTest):
    def setUp(self):
        super().setUp()
        self.runtime = FixtureRuntime()
        self.service = self.make_service(runtime=self.runtime)
        self.properties = Mock()
        self.app = create_app({"TESTING": True, "CFD_SERVICE": self.service}, service=self.properties)
        self.client = self.app.test_client()
        no_processes = patch("subprocess.Popen", side_effect=AssertionError("API fixtures must not run any real process"))
        no_processes.start()
        self.addCleanup(no_processes.stop)

    def test_application_creation_and_capabilities_are_cheap_and_extensions_are_lazy(self):
        with patch("app.CfdService", wraps=cfd.CfdService) as constructor, patch("atexit.register") as atexit:
            app = create_app({"TESTING": True}, service=self.properties)
            self.assertIsNone(app.extensions["coupled_cfd"])
            constructor.assert_not_called()
            self.assertEqual(app.config["MAX_CONTENT_LENGTH"], 16384)
            self.assertEqual(app.config["TRUSTED_HOSTS"], ["127.0.0.1", "localhost", "[::1]"])
            with patch.dict("os.environ", {"HOMEPLANNER_CFD_ENABLED": "0"}):
                response = app.test_client().get("/api/cfd/capabilities")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json["execution"]["status"], "not-configured")
            self.assertTrue(response.json["casePreparation"])
            self.assertEqual(response.json["runtimeVerification"], "pending")
            self.assertEqual(response.json["version"], 1)
            self.assertEqual(response.json["profile"], cfd.PROFILE)
            self.assertIsNone(app.extensions["coupled_cfd"]._worker)
            atexit.assert_not_called()
            app.extensions["coupled_cfd"].shutdown()
        self.assertIs(self.app.extensions["coupled_cfd"], self.service)
        self.assertIs(self.app.extensions["prohibited_reports"], self.properties)
        self.assertEqual(self.properties.mock_calls, [])
        self.assertFalse(self.service._root_override.exists())

    def test_cross_origin_cross_site_and_untrusted_hosts_fail_before_effects(self):
        job_id = str(uuid.uuid4())
        routes = (
            ("get", "/api/cfd/capabilities", None),
            ("post", "/api/cfd/runtime", {}),
            ("post", "/api/cfd/prepare", SYNTHETIC_REQUEST),
            ("post", "/api/cfd/package", SYNTHETIC_REQUEST),
            ("post", "/api/cfd/jobs", SYNTHETIC_REQUEST),
            ("get", f"/api/cfd/jobs/{job_id}", None),
            ("post", f"/api/cfd/jobs/{job_id}/cancel", {}),
            ("get", f"/api/cfd/jobs/{job_id}/result", None),
        )
        for method, path, data in routes:
            for headers in ({"Origin": "https://evil.example"}, {"Sec-Fetch-Site": "cross-site"},
                            {"Origin": "null"}, {"Host": "evil.example"}):
                with self.subTest(path=path, headers=headers):
                    response = getattr(self.client, method)(path, json=data, headers=headers)
                    self.assertEqual(response.status_code, 400 if "Host" in headers else 403)
                    self.assertEqual(response.json["status"], "error")
        self.assertEqual(self.runtime.calls, [])
        self.assertEqual(self.runtime.probes, 0)
        self.assertFalse(self.service._root_override.exists())
        self.assertEqual(self.properties.mock_calls, [])

    def test_json_only_empty_control_objects_duplicate_keys_nonfinite_and_depth_guards(self):
        for path in ("/api/cfd/prepare", "/api/cfd/package", "/api/cfd/jobs", "/api/cfd/runtime",
                     f"/api/cfd/jobs/{uuid.uuid4()}/cancel"):
            for body, mime, status in (
                ("{}", "text/plain", 415), ("{", "application/json", 400),
                ("[]", "application/json", 400), ("null", "application/json", 400),
                ('{"x":1,"x":2}', "application/json", 400),
                ('{"x":NaN}', "application/json", 400),
                ('{"x":Infinity}', "application/json", 400),
                ('{"x":' + "[" * 1500 + "0" + "]" * 1500 + "}", "application/json", 400),
                ('{"x":' + "9" * 5000 + "}", "application/json", 400),
            ):
                with self.subTest(path=path, body=body[:20]):
                    response = self.client.post(path, data=body, content_type=mime)
                    self.assertEqual(response.status_code, status, response.json)
                    self.assertEqual(response.json["status"], "error")
        for path in ("/api/cfd/runtime", f"/api/cfd/jobs/{uuid.uuid4()}/cancel"):
            response = self.client.post(path, json={"force": True})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.runtime.calls, [])
        self.assertEqual(self.runtime.probes, 0)
        self.assertFalse(self.service._root_override.exists())

    def test_cfd_payload_budget_is_isolated_from_analysis_and_general_limits(self):
        payload = copy.deepcopy(SYNTHETIC_REQUEST)
        payload["geometry"]["fixtureNote"] = "x" * 20_000
        response = self.client.post("/api/cfd/prepare", json=payload)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json["status"], "prepared")
        for path in ("/api/cfd/prepare", "/api/cfd/package", "/api/cfd/jobs", "/api/cfd/runtime",
                     f"/api/cfd/jobs/{uuid.uuid4()}/cancel"):
            response = self.client.post(path, data=b"x" * (cfd.MAX_PAYLOAD_BYTES + 1), content_type="application/json")
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.json["error"]["code"], "payload_too_large")
        self.assertEqual(self.client.post("/api/analysis/air-density", data=b" " * 8200, content_type="application/json").status_code, 413)
        self.assertEqual(self.client.post("/api/prohibited/search", data=b" " * 16_385, content_type="application/json").status_code, 413)
        self.assertEqual(self.app.config["MAX_CONTENT_LENGTH"], 16384)
        self.assertEqual(self.runtime.calls, [])

    def test_fingerprint_json_text_uses_the_whole_request_budget_not_an_id_length_limit(self):
        for key in ("inputFingerprint", "geometryFingerprint"):
            payload = copy.deepcopy(SYNTHETIC_REQUEST)
            payload["source"][key] = json.dumps({"canonical": "fixture", "text": "x" * 200_000}, separators=(",", ":"))
            with self.subTest(key=key):
                response = self.client.post("/api/cfd/prepare", json=payload)
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.json["manifest"]["source"], payload["source"])
                package = self.client.post("/api/cfd/package", json=payload)
                self.assertEqual(package.status_code, 200)
                with zipfile.ZipFile(io.BytesIO(package.data)) as archive:
                    self.assertEqual(json.loads(archive.read("manifest.json"))["source"], payload["source"])
        oversized = copy.deepcopy(SYNTHETIC_REQUEST)
        for key in ("inputFingerprint", "geometryFingerprint"):
            oversized["source"][key] = json.dumps({"text": "x" * 200_000}, separators=(",", ":"))
        response = self.client.post("/api/cfd/prepare", json=oversized)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json["error"]["code"], "payload_too_large")
        self.assertFalse(self.service._root_override.exists())
        self.assertEqual(self.runtime.calls, [])

    def test_offline_preparation_and_package_never_create_jobs_or_computed_fields(self):
        self.runtime.available = False
        prepared = self.client.post("/api/cfd/prepare", json=SYNTHETIC_REQUEST, headers={"Origin": "http://localhost"})
        self.assertEqual(prepared.status_code, 200, prepared.json)
        self.assertEqual(prepared.json["manifest"]["source"], SYNTHETIC_SOURCE)
        self.assertNotIn("result", prepared.json)
        self.assertNotIn("samples", prepared.json)
        package = self.client.post("/api/cfd/package", json=SYNTHETIC_REQUEST)
        self.assertEqual(package.status_code, 200)
        self.assertEqual(package.mimetype, "application/zip")
        self.assertEqual(package.headers["Content-Disposition"], 'attachment; filename="homeplanner-cfd-single-room-cht-v1.zip"')
        with zipfile.ZipFile(io.BytesIO(package.data)) as archive:
            self.assertEqual(json.loads(archive.read("manifest.json"))["source"], SYNTHETIC_SOURCE)
        for response in (prepared, package):
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertFalse(self.service._root_override.exists())
        self.assertEqual(self.runtime.calls, [])

    def test_explicit_probe_unavailable_200_but_run_unavailable_503_and_no_queue(self):
        self.runtime.available = False
        response = self.client.get("/api/cfd/capabilities")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["execution"]["available"])
        self.assertEqual(self.runtime.probes, 0)
        probe = self.client.post("/api/cfd/runtime", json={})
        self.assertEqual(probe.status_code, 200)
        self.assertFalse(probe.json["execution"]["available"])
        self.assertEqual(self.runtime.probes, 1)
        with self.assertLogs(self.app.logger, level="ERROR"):
            response = self.client.post("/api/cfd/jobs", json=SYNTHETIC_REQUEST)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json["error"]["code"], "runtime_unavailable")
        self.assertNotIn("job", response.json)
        self.assertFalse(self.service._root_override.exists())
        self.assertEqual(self.runtime.calls, [])

    def test_job_lifecycle_queue_cancel_and_results_are_server_derived(self):
        self.runtime.block = True
        response = self.client.post("/api/cfd/jobs", json=SYNTHETIC_REQUEST)
        self.assertEqual(response.status_code, 202, response.json)
        job = response.json["job"]
        self.assertEqual(set(job), cfd.SNAPSHOT_KEYS)
        self.assertEqual(job["source"], SYNTHETIC_SOURCE)
        self.assertEqual(uuid.UUID(job["id"]).version, 4)
        self.assertTrue(self.runtime.started.wait(2))
        result = self.client.get(f"/api/cfd/jobs/{job['id']}/result")
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json["error"]["code"], "result_not_ready")
        self.assertEqual(self.client.post("/api/cfd/jobs", json=SYNTHETIC_REQUEST).status_code, 429)
        cancel = self.client.post(f"/api/cfd/jobs/{job['id']}/cancel", json={})
        self.assertEqual(cancel.status_code, 200)
        self.assertEqual(cancel.json["job"]["status"], "cancelling")
        self.finish(self.service, job)
        final = self.client.get(f"/api/cfd/jobs/{job['id']}")
        self.assertEqual(final.json["job"]["status"], "cancelled")
        self.assertFalse(final.json["job"]["resultAvailable"])
        self.assertEqual(self.client.get(f"/api/cfd/jobs/{job['id']}/result").status_code, 409)
        self.assertEqual(self.client.post(f"/api/cfd/jobs/{job['id']}/cancel", json={}).json["job"]["status"], "cancelled")

    def test_only_complete_ascii_fixture_and_engine_evidence_produces_computed_unvalidated(self):
        response = self.client.post("/api/cfd/jobs", json=SYNTHETIC_REQUEST)
        self.assertEqual(response.status_code, 202)
        job = self.finish(self.service, response.json["job"])
        self.assertEqual(job["status"], "completed", job)
        response = self.client.get(f"/api/cfd/jobs/{job['id']}/result")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "computed-unvalidated")
        result = response.json["result"]
        self.assertEqual(result["validationStatus"], "unvalidated")
        self.assertEqual(result["source"], SYNTHETIC_SOURCE)
        self.assertEqual(result["engine"]["version"], "2606")
        self.assertAlmostEqual(result["samples"][0]["temperatureC"], 26.85)
        self.assertEqual(result["diagnostics"]["energyBalance"]["status"], "not-evaluated")

    def test_failed_run_is_failed_and_result_endpoint_is_not_a_success_wrapper(self):
        self.runtime.outputs[cfd.COMMANDS[2]] = b"Failed 1 mesh checks.\nEnd\n"
        with self.assertLogs(cfd.LOGGER, level="ERROR"):
            response = self.client.post("/api/cfd/jobs", json=SYNTHETIC_REQUEST)
            job = self.finish(self.service, response.json["job"])
        self.assertEqual(job["status"], "failed")
        response = self.client.get(f"/api/cfd/jobs/{job['id']}/result")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json["status"], "error")
        self.assertNotIn("result", response.json)
        self.assertNotIn("samples", response.json)

    def test_unknown_jobs_and_new_source_files_are_not_served(self):
        for suffix in ("", "/result"):
            response = self.client.get(f"/api/cfd/jobs/{uuid.uuid4()}{suffix}")
            self.assertEqual(response.status_code, 404)
        for path in ("/cfd_runtime.py", "/cfd_results.py", "/cfd_case.py",
                     "/tests/test_cfd_api.py", "/.runner.lock", "/state.json"):
            self.assertEqual(self.client.get(path).status_code, 404)
        self.assertFalse(self.service._root_override.exists())

    def test_unknown_wrapper_script_or_path_inputs_are_not_process_arguments(self):
        for addition in (
            {"payload": SYNTHETIC_REQUEST}, {"commands": [["bash", "-c", "anything"]]},
            {"executable": r"C:\private\binary.exe"}, {"caseDirectory": "../private"},
            {"resultAvailable": True}, {"files": {"run.sh": "raw script"}}, {"result": {"samples": []}},
        ):
            response = self.client.post("/api/cfd/jobs", json={**SYNTHETIC_REQUEST, **addition})
            self.assertEqual(response.status_code, 400, response.json)
        self.assertEqual(self.runtime.calls, [])
        self.assertFalse(self.service._root_override.exists())

    def test_unexpected_errors_log_details_but_public_500_is_sanitized(self):
        for exception in (
            RuntimeError(r"private C:\Users\secret\failure"),
            cfd.CfdError(r"private C:\Users\secret\failure", "internal_failure", 500),
        ):
            with patch.object(self.service, "prepare", side_effect=exception), \
                    self.assertLogs(self.app.logger, level="ERROR") as logs:
                response = self.client.post("/api/cfd/prepare", json=SYNTHETIC_REQUEST)
            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.json["error"]["code"], "cfd_failed")
            self.assertNotIn("private", response.get_data(as_text=True))
            self.assertNotIn("secret", response.get_data(as_text=True))
            self.assertTrue(any("private" in entry for entry in logs.output))

    def test_compiler_input_error_is_preserved_without_converting_to_success(self):
        class ExplicitCompilerError(Exception):
            def __init__(self, message, code="invalid_input", status=400):
                super().__init__(message)
                self.code, self.status = code, status

        compiler = Mock(side_effect=ExplicitCompilerError("Fixture input is incomplete.", "missing_boundary", 400))
        service = self.make_service(compiler=None)
        app = create_app({"TESTING": True, "CFD_SERVICE": service}, service=Mock())
        with patch.dict(sys.modules, {"cfd_case": SimpleNamespace(CfdInputError=ExplicitCompilerError, prepare_case=compiler)}):
            response = app.test_client().post("/api/cfd/prepare", json=SYNTHETIC_REQUEST)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json, {"status": "error", "error": {
            "code": "missing_boundary", "message": "Fixture input is incomplete.",
        }})
        self.assertFalse(service._root_override.exists())

    def test_real_compiler_preparation_and_zip_integrate_without_runtime_or_filesystem_effects(self):
        payload = json.loads(Path(__file__).parent.joinpath("fixtures", "cfd-request.json").read_text(encoding="utf-8"))
        payload["source"]["inputFingerprint"] = "caller-current-input:" + "a" * 8192
        payload["source"]["geometryFingerprint"] = "caller-current-geometry:" + "b" * 8192
        before = copy.deepcopy(payload)
        runtime = cfd.LocalRuntime(cfd.RuntimeConfig.from_env({"HOMEPLANNER_CFD_ENABLED": "0"}))
        service = self.make_service(runtime=runtime, compiler=None)
        app = create_app({"TESTING": True, "CFD_SERVICE": service}, service=Mock())
        client = app.test_client()
        prepared = client.post("/api/cfd/prepare", json=payload)
        self.assertEqual(prepared.status_code, 200, prepared.json)
        self.assertEqual(prepared.json["manifest"]["source"], payload["source"])
        self.assertEqual(prepared.json["manifest"]["runtimeVerification"], "pending")
        package = client.post("/api/cfd/package", json=payload)
        self.assertEqual(package.status_code, 200, package.get_data(as_text=True) if package.is_json else package.status)
        with zipfile.ZipFile(io.BytesIO(package.data)) as archive:
            self.assertIn("constant/air/hRef", archive.namelist())
            self.assertIn("constant/air/combustionProperties", archive.namelist())
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest, prepared.json["manifest"])
            self.assertEqual(json.loads(archive.read("request.json")), payload)
        self.assertFalse(service._root_override.exists())
        self.assertIsNone(service._worker)
        self.assertEqual(payload, before)


if __name__ == "__main__":
    unittest.main()
