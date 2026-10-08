"""Native site charts: real pvlib outputs and isolated, in-memory API ownership."""
from datetime import datetime, timezone
from functools import lru_cache
import math
from time import monotonic
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from backend.api import create_app
from backend.config import Settings
from backend.models import Base
from backend.solar import SolarInput, calculate_site_solar, check_budget, pole_shadow, resolve_clock
from backend.workspace import Site
import python_analysis


@lru_cache(maxsize=12)
def study(latitude=17.385, longitude=78.4867, zone="Asia/Kolkata", day="2026-06-21", clock="12:00", occurrence=None):
    return calculate_site_solar(
        Site(latitude=latitude, longitude=longitude, time_zone=zone),
        SolarInput(expected_version=0, date=day, local_time=clock, occurrence=occurrence,
                   acknowledge_reference=True, pole_height_m=.3048))


class SolarChartTests(unittest.TestCase):
    def test_real_reference_paths_hourly_monthly_annual_and_light_phases(self):
        result = study()
        charts = result["output"]["charts"]
        self.assertEqual(len(charts["references"]), 14)
        self.assertEqual([curve["time"] for curve in charts["hourly"]], [f"{hour:02}:00" for hour in range(24)])
        self.assertEqual(len(charts["annual"]["rows"]), 365)
        self.assertEqual(len(charts["monthly"]), 12)
        self.assertLessEqual(charts["sampleCount"], 14000)
        self.assertEqual(charts["referenceSampleMinutes"], 5)
        self.assertEqual([phase["thresholdDeg"] for phase in charts["summary"]["phases"]], [-6, -12, -18, 6])
        for reference in charts["references"]:
            self.assertEqual(len(reference["samples"]), 289)
            self.assertEqual(reference["samples"][0]["localTime"][:10], reference["date"])
            self.assertEqual((datetime.fromisoformat(reference["samples"][-1]["instantUTC"]) -
                              datetime.fromisoformat(reference["samples"][0]["instantUTC"])).total_seconds(), 86400)
        selected_row = next(row for row in charts["annual"]["rows"] if row["date"] == "2026-06-21")
        self.assertAlmostEqual(selected_row["position"]["apparentElevationDeg"], result["output"]["selected"]["apparentElevationDeg"], places=8)
        for month in charts["monthly"]:
            self.assertEqual([row["time"] for row in month["times"]], ["09:00", "12:00", "15:00"])
        summary = charts["summary"]
        sunrise = datetime.fromisoformat(summary["events"]["sunrise"]).astimezone(timezone.utc)
        sunset = datetime.fromisoformat(summary["events"]["sunset"]).astimezone(timezone.utc)
        self.assertAlmostEqual(summary["daylight"]["durationHours"], (sunset - sunrise).total_seconds() / 3600)
        self.assertTrue(12 < summary["daylight"]["durationHours"] < 14)
        import pandas as pd
        import pvlib
        for phase in summary["phases"]:
            for key in ("morning", "evening"):
                self.assertIsNotNone(phase[key])
                elevation = pvlib.solarposition.get_solarposition(
                    pd.DatetimeIndex([phase[key]]), 17.385, 78.4867, altitude=0,
                    pressure=101325, temperature=15, method="nrel_numpy", delta_t=None)["elevation"].iloc[0]
                self.assertAlmostEqual(elevation, phase["thresholdDeg"], delta=.001)
        self.assertEqual(charts["geometry"]["status"], "legacy-only")
        self.assertNotIn("scenes", result)
        self.assertEqual(result["inputs"]["poleHeightM"], .3048)

    def test_dst_real_civil_day_skipped_and_repeated_annual_clock(self):
        spring = study(40.7128, -74.006, "America/New_York", "2026-03-08", "03:30")
        self.assertEqual(spring["output"]["day"]["durationHours"], 23)
        autumn = study(40.7128, -74.006, "America/New_York", "2026-11-01", "01:30", "later")
        self.assertEqual(autumn["output"]["day"]["durationHours"], 25)
        clocks = spring["output"]["charts"]["hourly"]
        skipped = next(row for row in clocks[2]["rows"] if row["date"] == "2026-03-08")
        self.assertEqual(skipped["status"], "skipped local time")
        self.assertIsNone(skipped["position"])
        repeated = next(row for row in autumn["output"]["charts"]["annual"]["rows"] if row["date"] == "2026-11-01")
        self.assertEqual(repeated["status"], "later repeated time")
        self.assertTrue(repeated["position"]["localTime"].endswith("-05:00"))
        with self.assertRaisesRegex(HTTPException, "skipped"):
            resolve_clock("2026-03-08", "02:30", "America/New_York", None)
        with self.assertRaisesRegex(HTTPException, "occurs twice"):
            resolve_clock("2026-11-01", "01:30", "America/New_York", None)
        earlier = resolve_clock("2026-11-01", "01:30", "America/New_York", "earlier")
        later = resolve_clock("2026-11-01", "01:30", "America/New_York", "later")
        self.assertEqual((later - earlier).total_seconds(), 3600)

    def test_leap_year_and_quarter_hour_zone(self):
        result = study(27.7172, 85.324, "Asia/Kathmandu", "2024-02-29", "12:15")
        self.assertEqual(len(result["output"]["charts"]["annual"]["rows"]), 366)
        self.assertTrue(result["output"]["selected"]["localTime"].endswith("+05:45"))
        self.assertEqual(result["output"]["charts"]["annual"]["time"], "12:15")
        self.assertEqual(len(result["output"]["charts"]["hourly"]), 24)

    def test_polar_states_absent_crossings_and_southern_seasons(self):
        for day, status, duration in (("2026-06-21", "polar-day", None), ("2026-12-21", "polar-night", 0)):
            result = study(78.2232, 15.6469, "Arctic/Longyearbyen", day)
            charts = result["output"]["charts"]
            self.assertEqual(charts["summary"]["daylight"], {"status": status, "durationHours": duration})
            self.assertIsNone(charts["summary"]["events"]["sunrise"])
            self.assertIsNone(charts["summary"]["events"]["sunset"])
            if status == "polar-night":
                self.assertIsNone(charts["extrema"])
                self.assertEqual(charts["pole"]["selected"]["status"], "night")
                self.assertTrue(any(ref["samples"] and not any(p["aboveHorizon"] for p in ref["samples"]) for ref in charts["references"]))
        south = study(-33.8688, 151.2093, "Australia/Sydney")
        self.assertTrue(south["output"]["charts"]["summary"]["daylight"]["durationHours"] < 11)
        self.assertEqual({ref["kind"] for ref in south["output"]["charts"]["references"]},
                         {"monthly", "june-solstice", "december-solstice", "march-equinox", "september-equinox"})

    def test_pole_equations_unknown_low_sun_and_horizon(self):
        for angle, expected in ((30, 3.464101615), (45, 2), (60, 1.154700538), (90, 0)):
            point = {"apparentElevationDeg": angle, "azimuthDeg": 90}
            shadow = pole_shadow(point, 2, 1)
            self.assertAlmostEqual(shadow["lengthM"], expected, places=8)
            self.assertEqual(shadow["bearingDeg"], 270)
        for angle in (0, -10):
            self.assertEqual(pole_shadow({"apparentElevationDeg": angle, "azimuthDeg": 90}, 2, 1)["status"], "night")
        self.assertEqual(pole_shadow({"apparentElevationDeg": .5, "azimuthDeg": 90}, 2, 1)["status"], "low-sun")
        self.assertGreater(pole_shadow({"apparentElevationDeg": .5, "azimuthDeg": 90}, 2, 0)["lengthM"], 200)
        self.assertEqual(pole_shadow({"apparentElevationDeg": 45, "azimuthDeg": 90}, None, 1)["status"], "unknown-height")
        for value in (-1, 0, 1001, math.inf, math.nan):
            with self.assertRaises(ValidationError):
                SolarInput(expected_version=0, date="2026-06-21", local_time="12:00", pole_height_m=value)
        with self.assertRaisesRegex(HTTPException, "budget"):
            check_budget(monotonic() - 1)

    def test_missing_site_unknown_atmosphere_and_solver_failures_are_not_results(self):
        inputs = SolarInput(expected_version=0, date="2026-06-21", local_time="12:00", acknowledge_reference=True)
        with self.assertRaisesRegex(HTTPException, "latitude"):
            calculate_site_solar(Site(), inputs)
        with self.assertRaisesRegex(python_analysis.AnalysisError, "acknowledge"):
            calculate_site_solar(Site(latitude=17.385, longitude=78.4867, time_zone="Asia/Kolkata"),
                                 inputs.model_copy(update={"acknowledge_reference": False}))
        with patch("scipy.optimize.brentq", side_effect=RuntimeError("synthetic non-convergence")):
            with self.assertRaisesRegex(python_analysis.AnalysisError, "did not converge"):
                calculate_site_solar(Site(latitude=17.385, longitude=78.4867, time_zone="Asia/Kolkata"), inputs)


class SolarApiTests(unittest.TestCase):
    def setUp(self):
        self.codes = []
        class Sms:
            def send_code(inner, phone, code):
                self.codes.append(code)
            def close(inner):
                pass
        settings = Settings(environment="development", database_url="sqlite:///:memory:",
                            auth_secret="solar-test-only-" + "x" * 40,
                            allowed_origins=["http://localhost:5173"], sms_enabled=False)
        with patch("backend.api.create_engine", side_effect=lambda *args, **kwargs: create_engine(*args, **kwargs, poolclass=StaticPool)):
            self.app = create_app(settings, Sms(), lambda: 1800000000)
        Base.metadata.create_all(self.app.state.engine)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.client.headers["origin"] = "http://localhost:5173"
        challenge = self.client.post("/api/v1/auth/challenges", json={"phone": "+12025550123"}).json()
        verified = self.client.post("/api/v1/auth/verify", json={"challenge_id": challenge["challenge_id"], "code": self.codes[-1]})
        self.assertEqual(verified.status_code, 200, verified.text)
        self.client.headers["x-csrf-token"] = verified.json()["csrf_token"]
        project = self.client.post("/api/v1/projects", json={"name": "Disposable solar fixture"}).json()
        self.route = f"/api/v1/projects/{project['id']}/workspace"
        applied = self.client.post(self.route + "/commands", json={"expected_version": 0, "action": "site",
                                                                 "value": {"latitude": 17.385, "longitude": 78.4867}})
        self.assertEqual(applied.status_code, 200, applied.text)
        self.before = applied.json()
        self.inputs = {"expected_version": 1, "date": "2026-06-21", "local_time": "12:00",
                       "acknowledge_reference": True, "pole_height_m": .3048}

    def test_charts_explicit_site_request_no_writes_stale_and_failure(self):
        with patch("backend.api.calculate_site_solar", return_value=study()):
            response = self.client.post(self.route + "/solar", json=self.inputs)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["result"]["output"]["charts"]["references"]), 14)
        self.assertEqual(self.client.get(self.route).json(), self.before)
        self.assertEqual(self.client.post(self.route + "/solar", json={**self.inputs, "expected_version": 0}).status_code, 409)
        self.assertEqual(self.client.post(self.route + "/solar", json={**self.inputs, "latitude": 0}).status_code, 422)
        with patch("backend.api.calculate_site_solar", side_effect=HTTPException(503, "Synthetic budget failure")):
            self.assertEqual(self.client.post(self.route + "/solar", json=self.inputs).status_code, 503)
        self.assertEqual(self.client.get(self.route).json(), self.before)

    def test_completion_after_applied_site_change_is_discarded(self):
        def change_site(*args):
            self.client.post(self.route + "/commands", json={"expected_version": 1, "action": "site", "value": {"latitude": 18}})
            return study()
        with patch("backend.api.calculate_site_solar", side_effect=change_site):
            response = self.client.post(self.route + "/solar", json=self.inputs)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.get(self.route).json()["document"]["site"]["latitude"], 18)


if __name__ == "__main__":
    unittest.main()
