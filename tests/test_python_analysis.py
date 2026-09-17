import copy
import builtins
import json
import math
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from unittest.mock import Mock, patch

from app import create_app
import python_analysis as analysis


DENSITY = {
    "temperatureC": 25.0, "rhPct": 60.0, "pressurePa": 101325.0,
    "source": {"kind": "weather-record", "label": "Synthetic normalized weather",
               "weatherId": "synthetic", "recordTimestamp": "2026-06-21T06:30:00Z", "durationSeconds": 3600},
}
SOLAR = {
    "latitude": 17.385, "longitude": 78.4867, "timeZone": "Asia/Kolkata",
    "date": "2026-06-21", "instantUTC": "2026-06-21T06:30:00Z",
    "altitudeM": 542.0, "pressurePa": 95000.0, "temperatureC": 30.0,
    "source": DENSITY["source"],
}


class AnalysisAPIGuards(unittest.TestCase):
    def setUp(self):
        self.service = Mock()
        self.app = create_app({"TESTING": True}, service=self.service)
        self.client = self.app.test_client()

    def test_optional_imports_are_lazy_and_startup_preserves_property_configuration(self):
        with patch.object(analysis.importlib, "import_module", side_effect=ImportError("private dependency path")):
            app = create_app({"TESTING": True}, service=self.service)
        self.assertEqual(app.config["MAX_CONTENT_LENGTH"], 16384)
        self.assertEqual(app.config["TRUSTED_HOSTS"], ["127.0.0.1", "localhost", "[::1]"])
        self.assertIs(app.extensions["prohibited_reports"], self.service)
        self.assertEqual(self.service.mock_calls, [])
        rules = {rule.rule for rule in app.url_map.iter_rules()}
        self.assertIn("/api/prohibited/search", rules)
        self.assertIn("/api/prohibited/report", rules)
        self.assertIn("/api/prohibited/download", rules)

    def test_same_origin_json_size_host_and_response_guards(self):
        with patch("app.calculate_density", return_value={"status": "test-only"}) as calculate:
            cross = self.client.post("/api/analysis/air-density", json=DENSITY, headers={"Origin": "https://example.com"})
            self.assertEqual(cross.status_code, 403)
            missing_origin = self.client.post("/api/analysis/air-density", json=DENSITY, headers={"Sec-Fetch-Site": "cross-site"})
            self.assertEqual(missing_origin.status_code, 403)
            self.assertEqual(self.client.post("/api/analysis/air-density", data="{}", content_type="text/plain").status_code, 415)
            self.assertEqual(self.client.post("/api/analysis/air-density", data="{", content_type="application/json").status_code, 400)
            large = self.client.post("/api/analysis/air-density", data='{"source":"' + "x" * 8200 + '"}', content_type="application/json")
            self.assertEqual(large.status_code, 413)
            self.assertEqual(self.client.post("/api/analysis/air-density", json=DENSITY, headers={"Host": "evil.example"}).status_code, 400)
            calculate.assert_not_called()
            response = self.client.post("/api/analysis/air-density", json=DENSITY, headers={"Origin": "http://localhost"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertEqual(self.service.mock_calls, [])
        for path in ("/python_analysis.py", "/requirements-analysis.txt", "/.venv/pyvenv.cfg"):
            self.assertEqual(self.client.get(path).status_code, 404)
        for path in ("/planner-python-analysis.js", "/planner-python-analysis.css"):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)

    def test_missing_dependencies_have_no_success_fallback_or_private_paths(self):
        analysis._dependencies.cache_clear()
        try:
            with patch.object(analysis.importlib, "import_module", side_effect=ImportError(r"C:\private\broken.py")):
                capabilities = self.client.get("/api/analysis/capabilities")
                self.assertEqual(capabilities.status_code, 200)
                self.assertEqual(capabilities.json["status"], "unavailable")
                self.assertFalse(capabilities.json["features"]["airDensity"]["available"])
                self.assertFalse(capabilities.json["features"]["solarPosition"]["available"])
                for route, data in (("air-density", DENSITY), ("solar-position", SOLAR)):
                    response = self.client.post(f"/api/analysis/{route}", json=data)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json["status"], "unavailable")
                    self.assertEqual(response.json["error"]["code"], "dependency_unavailable")
                    self.assertNotIn("output", response.json)
                    self.assertNotIn("private", response.get_data(as_text=True))
                    self.assertIn("requirements-analysis.txt", response.json["error"]["message"])
        finally:
            analysis._dependencies.cache_clear()

    def test_calculation_failure_does_not_leak_traceback(self):
        with patch("app.calculate_density", side_effect=RuntimeError(r"secret C:\private\broken.py")):
            with self.assertLogs(self.app.logger, level="ERROR"):
                response = self.client.post("/api/analysis/air-density", json=DENSITY)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json["error"]["code"], "calculation_failed")
        self.assertNotIn("private", response.get_data(as_text=True))
        self.assertNotIn("output", response.json)

    def test_invalid_inputs_rejected_before_optional_import(self):
        bad_density = [None, [], {"temperatureC": True, "rhPct": 50, "pressurePa": 101325},
                       {**DENSITY, "temperatureC": -101}, {**DENSITY, "rhPct": -1},
                       {**DENSITY, "rhPct": 101}, {**DENSITY, "pressurePa": 0},
                       {**DENSITY, "pressurePa": "101325"}, {**DENSITY, "temperatureC": math.nan},
                       {**DENSITY, "pressurePa": math.inf}, {**DENSITY, "filePath": "arbitrary.py"},
                       {**DENSITY, "source": {"kind": "manual", "label": "a" * 300}},
                       {**DENSITY, "source": {"kind": "weather-record", "recordTimestamp": "2026-02-30T00:00:00Z"}}]
        with patch.object(analysis, "_dependencies") as dependencies:
            for data in bad_density:
                with self.subTest(data=data):
                    response = self.client.post("/api/analysis/air-density", data=json.dumps(data), content_type="application/json")
                    self.assertEqual(response.status_code, 400)
                    self.assertNotIn("output", response.json)
            dependencies.assert_not_called()

    def test_deep_json_and_extreme_integer_are_structured_invalid_inputs(self):
        for text in ('{"temperatureC":' + "[" * 1500 + "0" + "]" * 1500 + "}",
                     json.dumps({**DENSITY, "temperatureC": 10 ** 1000})):
            response = self.client.post("/api/analysis/air-density", data=text, content_type="application/json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json["error"]["code"], "invalid_input")
            self.assertNotIn("output", response.json)
        response = self.client.post("/api/analysis/solar-position", json={**SOLAR, "instantUTC": "2026-06-21T12:00:00+05:90"})
        self.assertEqual(response.status_code, 400)

    def test_concurrent_calculations_have_a_bounded_queue_free_budget(self):
        arrived = threading.Barrier(3)
        release = threading.Event()

        def blocked(_):
            arrived.wait(timeout=5)
            if not release.wait(timeout=5):
                raise RuntimeError("Test release timed out")
            return {"status": "test-only"}

        def post():
            with self.app.test_client() as client:
                return client.post("/api/analysis/air-density", json=DENSITY).status_code

        with patch("app.calculate_density", side_effect=blocked):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first, second = pool.submit(post), pool.submit(post)
                try:
                    arrived.wait(timeout=5)
                    response = self.client.post("/api/analysis/air-density", json=DENSITY)
                    self.assertEqual(response.status_code, 429)
                    self.assertEqual(response.json["error"]["code"], "analysis_busy")
                finally:
                    release.set()
                self.assertEqual(first.result(timeout=5), 200)
                self.assertEqual(second.result(timeout=5), 200)

    def test_solar_naive_date_boundaries_and_reference_acknowledgement(self):
        bad_solar = [
            {**SOLAR, "instantUTC": "2026-06-21T12:00:00"},
            {**SOLAR, "date": "2026-02-30"},
            {**SOLAR, "date": "1800-06-21"},
            {**SOLAR, "latitude": 91}, {**SOLAR, "longitude": None},
            {**SOLAR, "altitudeM": 10000}, {**SOLAR, "pressurePa": -1},
            {**SOLAR, "sampleMinutes": 1}, {**SOLAR, "sampleMinutes": 15.5},
            {**SOLAR, "sampleMinutes": 1000000},
            {**SOLAR, "acknowledgeReferenceAtmosphere": "true"},
            {**SOLAR, "altitudeM": None}, {**SOLAR, "temperatureC": None},
            {**SOLAR, "pressurePa": None},
        ]
        with patch.object(analysis, "_dependencies") as dependencies:
            for data in bad_solar:
                with self.subTest(data=data):
                    response = self.client.post("/api/analysis/solar-position", json=data)
                    self.assertEqual(response.status_code, 400, response.json)
            dependencies.assert_not_called()


class InstalledCalculations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.psychro, _ = analysis._dependencies("psychrolib")
            cls.pvlib, cls.pandas, _ = analysis._dependencies("pvlib")
        except analysis.AnalysisError:
            raise unittest.SkipTest("Install requirements-analysis.txt for real optional-engine tests.") from None

    def setUp(self):
        self.service = Mock()
        self.client = create_app({"TESTING": True}, service=self.service).test_client()

    def test_density_executes_real_psychrolib_with_correct_units_and_preserves_input(self):
        before = copy.deepcopy(DENSITY)
        with patch.object(self.psychro, "GetHumRatioFromRelHum", wraps=self.psychro.GetHumRatioFromRelHum) as ratio:
            with patch.object(self.psychro, "GetMoistAirDensity", wraps=self.psychro.GetMoistAirDensity) as density:
                response = self.client.post("/api/analysis/air-density", json=DENSITY)
        self.assertEqual(response.status_code, 200, response.json)
        result = response.json
        ratio.assert_called_once_with(25.0, 0.60, 101325.0)
        density.assert_called_once_with(25.0, result["output"]["humidityRatioKgKgDryAir"], 101325.0)
        self.assertAlmostEqual(result["output"]["densityKgM3"], 1.17556, places=4)
        self.assertEqual(result["engine"]["version"], "2.5.0")
        self.assertEqual(result["inputs"]["source"], DENSITY["source"])
        self.assertEqual(DENSITY, before)
        self.assertEqual(self.service.mock_calls, [])

    def test_zero_rh_floor_saturation_and_cold_boundary(self):
        dry = analysis.calculate_density({**DENSITY, "rhPct": 0})["output"]
        humid = analysis.calculate_density({**DENSITY, "rhPct": 100})["output"]
        self.assertTrue(dry["humidityRatioFloorApplied"])
        self.assertEqual(dry["vapourPressurePa"], 0)
        self.assertEqual(dry["humidityRatioKgKgDryAir"], self.psychro.MIN_HUM_RATIO)
        self.assertAlmostEqual(dry["densityKgM3"], self.psychro.GetDryAirDensity(25, 101325), places=6)
        self.assertLess(humid["densityKgM3"], dry["densityKgM3"])
        cold = analysis.calculate_density({**DENSITY, "temperatureC": -100})["output"]
        self.assertTrue(math.isfinite(cold["densityKgM3"]))
        for temperature, pressure in ((100, 100000), (200, 120000)):
            response = self.client.post("/api/analysis/air-density", json={**DENSITY, "temperatureC": temperature,
                                                                         "rhPct": 100, "pressurePa": pressure})
            self.assertEqual(response.status_code, 400)
            self.assertIn("vapour", response.json["error"]["message"])

    def test_density_uses_absolute_station_pressure_not_city_or_latitude(self):
        low = analysis.calculate_density({**DENSITY, "pressurePa": 95000})["output"]["densityKgM3"]
        high = analysis.calculate_density(DENSITY)["output"]["densityKgM3"]
        self.assertLess(low, high)
        response = self.client.post("/api/analysis/air-density", json={"latitude": 17.385, "longitude": 78.4867})
        self.assertEqual(response.status_code, 400)

    def test_solar_executes_actual_pvlib_and_matches_selected_midday_and_night(self):
        before = copy.deepcopy(SOLAR)
        with patch.object(self.pvlib.solarposition, "get_solarposition", wraps=self.pvlib.solarposition.get_solarposition) as position:
            result = self.client.post("/api/analysis/solar-position", json=SOLAR).json
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(position.call_count, 1)
        args = position.call_args.kwargs
        self.assertEqual(args["method"], "nrel_numpy")
        self.assertIsNotNone(args["time"].tz)
        self.assertEqual(args["altitude"], 542)
        self.assertEqual(args["pressure"], 95000)
        self.assertEqual(args["temperature"], 30)
        self.assertIsNone(args["delta_t"])
        self.assertEqual(args["atmos_refract"], 0.5667)
        selected = result["output"]["selected"]
        self.assertGreater(selected["geometricElevationDeg"], 80)
        self.assertGreater(selected["apparentElevationDeg"], selected["geometricElevationDeg"])
        self.assertTrue(selected["aboveHorizon"])
        self.assertEqual(result["output"]["day"]["sampleCount"], 97)
        night = analysis.calculate_solar({**SOLAR, "instantUTC": "2026-06-20T18:30:00Z"})
        self.assertFalse(night["output"]["selected"]["aboveHorizon"])
        self.assertLess(night["output"]["selected"]["apparentElevationDeg"], 0)
        self.assertEqual(SOLAR, before)
        self.assertEqual(result["engine"]["version"], "0.15.2")
        self.assertEqual(self.service.mock_calls, [])

    def test_dst_real_civil_day_endpoints_and_clipped_steps(self):
        for day, instant, hours in (("2026-03-08", "2026-03-08T16:00:00Z", 23),
                                    ("2026-11-01", "2026-11-01T17:00:00Z", 25)):
            with self.subTest(day=day):
                result = analysis.calculate_solar({**SOLAR, "latitude": 40.7128, "longitude": -74.006,
                    "timeZone": "America/New_York", "date": day, "instantUTC": instant, "sampleMinutes": 7})
                output = result["output"]
                self.assertEqual(output["day"]["durationHours"], hours)
                self.assertLessEqual(len(output["path"]), analysis.MAX_PATH_SAMPLES)
                times = [datetime.fromisoformat(row["instantUTC"].replace("Z", "+00:00")) for row in output["path"]]
                self.assertEqual((times[-1] - times[0]).total_seconds(), hours * 3600)
                self.assertTrue(all(0 < (right - left).total_seconds() <= 7 * 60 for left, right in zip(times, times[1:])))
                self.assertLess((times[-1] - times[-2]).total_seconds(), 7 * 60)
        repeated = [analysis.calculate_solar({**SOLAR, "latitude": 40.7128, "longitude": -74.006,
                    "timeZone": "America/New_York", "date": "2026-11-01", "instantUTC": instant})["output"]["selected"]
                    for instant in ("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z")]
        self.assertEqual(repeated[0]["localTime"][11:16], repeated[1]["localTime"][11:16])
        self.assertNotEqual(repeated[0]["localTime"][-6:], repeated[1]["localTime"][-6:])

    def test_solar_references_are_opt_in_exact_and_keep_supplied_altitude(self):
        request = {**SOLAR, "temperatureC": None, "pressurePa": None, "acknowledgeReferenceAtmosphere": True}
        result = analysis.calculate_solar(request)
        self.assertEqual(result["inputs"]["altitudeM"], 542)
        self.assertEqual(result["inputs"]["pressurePa"], 101325)
        self.assertEqual(result["inputs"]["temperatureC"], 15)
        self.assertEqual(result["inputs"]["referenceFields"], ["pressurePa", "temperatureC"])
        self.assertTrue(any("not a measured" in note for note in result["assumptions"]))

    def test_solar_bad_zone_mismatched_instant_skipped_date_and_polar_night(self):
        for patch_data in ({"timeZone": "Not/AZone"}, {"timeZone": "../private"},
                           {"instantUTC": "2026-06-22T06:30:00Z"},
                           {"timeZone": "Pacific/Apia", "date": "2011-12-30", "instantUTC": "2011-12-30T12:00:00Z"}):
            with self.subTest(data=patch_data):
                response = self.client.post("/api/analysis/solar-position", json={**SOLAR, **patch_data})
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("output", response.json)
        polar = analysis.calculate_solar({**SOLAR, "latitude": 89, "longitude": 0, "timeZone": "UTC",
                                          "date": "2026-12-21", "instantUTC": "2026-12-21T12:00:00Z", "sampleMinutes": 5})
        self.assertEqual(len(polar["output"]["path"]), 289)
        self.assertTrue(all(row["apparentElevationDeg"] < 0 for row in polar["output"]["path"]))

    def test_calculations_do_not_write_files_or_request_network(self):
        original_open = builtins.open

        def read_only(file, mode="r", *args, **kwargs):
            if any(flag in mode for flag in ("w", "a", "x", "+")):
                raise AssertionError("A property calculation attempted a file write")
            return original_open(file, mode, *args, **kwargs)

        with patch("builtins.open", side_effect=read_only):
            with patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected network")) as network:
                self.assertEqual(analysis.calculate_density(DENSITY)["status"], "ok")
                self.assertEqual(analysis.calculate_solar(SOLAR)["status"], "ok")
                network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
