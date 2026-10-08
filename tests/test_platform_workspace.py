import json
from datetime import datetime, timezone
import math
import subprocess
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi.testclient import TestClient
from alembic import command as migrations
from alembic.config import Config
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import ProjectRevision, WorkspaceRevision
from backend.api import create_app
from backend.site import feasibility, cost_estimate, BANDS
from backend.workspace import Site, Costs, time_zone_labels
from backend.solar import resolve_clock
from fastapi import HTTPException
import python_analysis
import test_platform_api as platform_tests


class WorkspaceTests(unittest.TestCase):
    setUp = platform_tests.PlatformApiTests.setUp
    login = platform_tests.PlatformApiTests.login

    def project(self):
        self.login()
        project = self.client.post("/api/v1/projects", json={"name": "Synthetic native fixture"}).json()
        self.path = f"/api/v1/projects/{project['id']}/workspace"
        return project

    def command(self, version, action, value=None):
        return self.client.post(self.path + "/commands", json={
            "expected_version": version, "action": action, "value": value})

    def test_unknown_initial_state_partial_save_history_and_conflict(self):
        project = self.project()
        initial = self.client.get(self.path).json()
        self.assertIsNone(initial["document"]["site"]["width"])
        self.assertIsNone(initial["document"]["site"]["latitude"])
        self.assertEqual(initial["document"]["site"]["time_zone"], "Asia/Kolkata")
        self.assertEqual(initial["document"]["site"]["weather_source"], "location")
        self.assertEqual(self.client.get(self.path + "/evaluation").json()["feasibility"]["status"], "prerequisites")
        first = self.command(0, "site", {"width": 12, "depth": 18}).json()
        self.assertEqual(first["version"], 1)
        second = self.command(1, "costs", {"land_inr_m2": 0}).json()
        self.assertEqual(second["document"]["site"], first["document"]["site"])
        self.assertEqual(self.command(1, "site", {"width": 15}).status_code, 409)
        self.assertEqual(self.command(2, "site", {"width": -1}).status_code, 422)
        self.assertEqual(self.client.get(self.path).json(), second)
        undo = self.command(2, "undo").json()
        self.assertEqual(undo["document"], first["document"])
        self.assertEqual(undo["version"], 3)
        self.assertTrue(undo["can_redo"])
        redo = self.command(3, "redo").json()
        self.assertEqual(redo["document"], second["document"])
        self.assertEqual(redo["version"], 4)
        self.command(4, "undo")
        branch = self.command(5, "site", {"depth": 20}).json()
        self.assertFalse(branch["can_redo"])
        self.assertEqual(self.command(6, "redo").status_code, 409)
        self.assertEqual(self.command(6, "site", {"depth": 20}).json()["version"], 6)
        with Session(self.app.state.engine) as session:
            metadata = session.scalars(select(ProjectRevision).where(ProjectRevision.project_id == project["id"])).all()
            self.assertEqual(len(metadata), 1)
            self.assertEqual(metadata[0].metadata_snapshot, {"name": "Synthetic native fixture"})
            self.assertEqual(len(session.scalars(select(WorkspaceRevision)).all()), 3)
        reopened = TestClient(self.app)
        reopened.cookies.update(self.client.cookies)
        self.assertEqual(reopened.get(self.path).json()["document"], branch["document"])
        reopened.close()

    def test_obstacle_identity_outside_plot_unknowns_and_atomic_rejection(self):
        self.project()
        obstacle = {"id": "across-road", "kind": "tree", "name": "Synthetic canopy", "x": -25,
                    "y": -15, "width_m": 5, "depth_m": 4}
        first = self.command(0, "site", {"obstacles": [obstacle], "time_zone": "Asia/Kolkata"}).json()
        self.assertEqual(first["document"]["site"]["obstacles"][0]["x"], -25)
        self.assertIsNone(first["document"]["site"]["obstacles"][0]["height_m"])
        for invalid in [
            {"obstacles": [obstacle, obstacle]}, {"time_zone": "Invalid/Timezone"},
            {"rooms": []}, {"width": True}, {"floors": 2.5}, {"roads": {"N": 9}},
            {"obstacles": [{**obstacle, "transmission": 1.1}]},
        ]:
            self.assertEqual(self.command(1, "site", invalid).status_code, 422, invalid)
        self.assertEqual(self.client.get(self.path).json(), first)
        self.assertEqual(self.command(1, "undo").json()["document"]["site"]["obstacles"], [])
        self.assertEqual(self.command(2, "redo").json()["document"]["site"]["obstacles"][0]["id"], "across-road")

    def test_location_resolves_zone_atomically_and_history_retains_it(self):
        self.project()
        first = self.command(0, "site", {"latitude": 17.385, "longitude": 78.4867}).json()
        self.assertEqual(first["document"]["site"]["time_zone"], "Asia/Kolkata")
        second = self.command(1, "site", {"latitude": 40.7128, "longitude": -74.006}).json()
        self.assertEqual(second["document"]["site"]["time_zone"], "America/New_York")
        self.assertEqual(second["version"], 2)
        self.assertEqual(self.command(2, "undo").json()["document"], first["document"])
        self.assertEqual(self.command(3, "redo").json()["document"], second["document"])
        self.assertEqual(self.command(4, "site", {"latitude": 91}).status_code, 422)
        with patch("backend.workspace.timezone_boundaries") as boundaries:
            boundaries.return_value.timezone_at.return_value = None
            self.assertEqual(self.command(4, "site", {"latitude": 10}).status_code, 422)
        self.assertEqual(self.client.get(self.path).json()["document"], second["document"])
        cleared = self.command(4, "site", {"longitude": None}).json()
        self.assertIsNone(cleared["document"]["site"]["time_zone"])
        # An unrelated edit/read must not recalculate a saved historic/manual zone.
        manual = self.command(5, "site", {"time_zone": "Europe/London"}).json()
        untouched = self.command(6, "site", {"width": 12}).json()
        self.assertEqual(untouched["document"]["site"]["time_zone"], manual["document"]["site"]["time_zone"])

    def test_resize_and_move_preserve_obstacle_identity_and_undo(self):
        self.project()
        obstacle = {"id": "tree-fixture", "kind": "tree", "name": "Canopy",
                    "x": -20, "y": -15, "width_m": 4, "depth_m": 5}
        original = self.command(0, "site", {"obstacles": [obstacle]}).json()
        changed = {**original["document"]["site"]["obstacles"][0], "x": -25, "width_m": 8, "depth_m": 9}
        saved = self.command(1, "site", {"obstacles": [changed]}).json()
        self.assertEqual(saved["document"]["site"]["obstacles"], [changed])
        self.assertEqual(self.command(2, "undo").json()["document"], original["document"])
        self.assertEqual(self.command(3, "redo").json()["document"], saved["document"])
        self.assertEqual(self.command(4, "site", {"obstacles": [{**changed, "width_m": 0}]}).status_code, 422)
        self.assertEqual(self.client.get(self.path).json()["document"], saved["document"])

    def test_site_solar_real_pvlib_saved_location_no_writes_and_dst(self):
        self.project()
        inputs = {"expected_version": 0, "date": "2026-06-21", "local_time": "12:00",
                  "acknowledge_reference": True, "sample_minutes": 15}
        self.assertEqual(self.client.post(self.path + "/solar", json=inputs).status_code, 422)
        before = self.command(0, "site", {"latitude": 17.385, "longitude": 78.4867}).json()
        inputs["expected_version"] = 1
        response = self.client.post(self.path + "/solar", json=inputs)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["scope"], "site-solar-position-not-shading")
        self.assertEqual(data["result"]["engine"]["name"], "pvlib")
        self.assertEqual(data["result"]["inputs"]["timeZone"], "Asia/Kolkata")
        self.assertEqual(data["result"]["inputs"]["latitude"], 17.385)
        self.assertEqual(data["result"]["output"]["day"]["sampleCount"], 97)
        self.assertTrue(data["result"]["output"]["selected"]["aboveHorizon"])
        self.assertEqual(self.client.get(self.path).json(), before)
        self.assertEqual(self.client.post(self.path + "/solar", json={**inputs, "latitude": 0}).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/solar", json={**inputs, "acknowledge_reference": False}).status_code, 400)
        self.assertEqual(self.client.post(self.path + "/solar", json={**inputs, "expected_version": 0}).status_code, 409)
        self.assertEqual(self.client.post(self.path + "/solar", json={**inputs, "expected_version": True}).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/solar", headers={"x-csrf-token":"invalid"}, json=inputs).status_code, 403)
        with patch("backend.api.calculate_site_solar", side_effect=python_analysis.AnalysisError("pvlib unavailable", status=503)):
            self.assertEqual(self.client.post(self.path + "/solar", json=inputs).status_code, 503)
        self.command(1, "site", {"latitude": 40.7128, "longitude": -74.006})
        for day, duration in (("2026-03-08", 23), ("2026-11-01", 25)):
            result = self.client.post(self.path + "/solar", json={**inputs, "expected_version": 2, "date": day}).json()["result"]
            self.assertEqual(result["output"]["day"]["durationHours"], duration)
        other = TestClient(self.app)
        self.login("+12025550124", other)
        self.assertEqual(other.post(self.path + "/solar", json={**inputs, "expected_version": 2}).status_code, 404)
        other.close()

    def test_solar_rejects_completion_after_workspace_changes(self):
        self.project()
        self.command(0, "site", {"latitude": 17, "longitude": 78})
        def changed_site(*args):
            self.command(1, "site", {"latitude": 18})
            return {"status": "ok"}
        with patch("backend.api.calculate_site_solar", side_effect=changed_site):
            response = self.client.post(self.path + "/solar", json={
                "expected_version": 1, "date": "2026-06-21", "local_time": "12:00", "acknowledge_reference": True})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.get(self.path).json()["document"]["site"]["latitude"], 18)

    def test_owner_csrf_options_and_weather_explicit_saved_inputs(self):
        self.project()
        options = self.client.get("/api/v1/site/options").json()
        self.assertIn("Asia/Kolkata", options["time_zones"])
        self.assertTrue(options["sources"])
        self.command(0, "site", {"latitude": 12, "longitude": 77})
        with patch("backend.api.python_analysis.calculate_current_weather_density") as weather:
            weather.return_value = {"weather": {"kind": "current-model"}}
            self.client.get(self.path)
            self.client.get(self.path + "/evaluation")
            weather.assert_not_called()
            response = self.client.post(self.path + "/weather", json={"inputs": {
                "expected_version": 1, "acknowledgeOpenMeteo": True}})
            self.assertEqual(response.status_code, 200)
            weather.assert_called_once_with({"latitude": 12, "longitude": 77, "acknowledgeOpenMeteo": True})
            stale = self.client.post(self.path + "/weather", json={"inputs": {
                "expected_version": 0, "acknowledgeOpenMeteo": True}})
            self.assertEqual(stale.status_code, 409)
            self.assertEqual(weather.call_count, 1)
        other = TestClient(self.app)
        self.login("+12025550124", other)
        self.assertEqual(other.get(self.path).status_code, 404)
        self.assertEqual(other.get(self.path + "/evaluation").status_code, 404)
        self.assertEqual(other.post(self.path + "/commands", json={
            "expected_version": 1, "action": "undo"}).status_code, 404)
        other.close()
        self.assertEqual(self.client.post(self.path + "/commands", headers={"x-csrf-token": "invalid"},
            json={"expected_version": 1, "action": "undo"}).status_code, 403)

    def test_existing_metadata_migration_and_history_survive_new_application(self):
        project = self.project()
        config = Config("alembic.ini")
        with self.app.state.engine.begin() as connection:
            config.attributes["connection"] = connection
            migrations.downgrade(config, "0001_platform")
            migrations.upgrade(config, "head")
        self.assertEqual(self.client.get(f"/api/v1/projects/{project['id']}").json(), project)
        self.command(0, "site", {"width": 12})
        self.command(1, "site", {"depth": 18})
        restarted_app = create_app(self.settings, self.sender, lambda: self.now)
        with TestClient(restarted_app) as restarted:
            restarted.cookies.update(self.client.cookies)
            restarted.headers.update(self.client.headers)
            self.assertEqual(restarted.get(self.path).json()["version"], 2)
            undo = restarted.post(self.path + "/commands", json={"expected_version": 2, "action": "undo"}).json()
            self.assertIsNone(undo["document"]["site"]["depth"])
            self.assertEqual(undo["document"]["site"]["width"], 12)

    def test_concurrent_initial_commands_accept_only_one(self):
        self.project()
        def send(width):
            client = TestClient(self.app)
            try:
                client.cookies.update(self.client.cookies)
                client.headers.update(self.client.headers)
                return client.post(self.path + "/commands", json={
                    "expected_version": 0, "action": "site", "value": {"width": width}}).status_code
            finally:
                client.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(send, (12, 14)))
        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(self.client.get(self.path).json()["version"], 1)


class SiteCalculationTests(unittest.TestCase):
    def test_civil_clock_resolution_gaps_repeated_times_and_quarter_hour_zone(self):
        with self.assertRaisesRegex(HTTPException, "skipped"):
            resolve_clock("2026-03-08", "02:30", "America/New_York", None)
        with self.assertRaisesRegex(HTTPException, "occurs twice"):
            resolve_clock("2026-11-01", "01:30", "America/New_York", None)
        earlier = resolve_clock("2026-11-01", "01:30", "America/New_York", "earlier")
        later = resolve_clock("2026-11-01", "01:30", "America/New_York", "later")
        self.assertEqual((later-earlier).total_seconds(), 3600)
        self.assertEqual(resolve_clock("2026-06-21", "12:00", "Asia/Kathmandu", None).isoformat(), "2026-06-21T06:15:00+00:00")
        with self.assertRaisesRegex(HTTPException, "real civil date"):
            resolve_clock("2026-02-30", "12:00", "Asia/Kolkata", None)

    def test_iana_labels_offsets_dst_and_explicit_unknown_preservation(self):
        winter = time_zone_labels(datetime(2026, 1, 1, tzinfo=timezone.utc))
        summer = time_zone_labels(datetime(2026, 7, 1, tzinfo=timezone.utc))
        self.assertEqual(winter["Asia/Kolkata"], "Asia/Kolkata (UTC+5:30)")
        self.assertEqual(winter["Asia/Kathmandu"], "Asia/Kathmandu (UTC+5:45)")
        self.assertEqual(winter["America/New_York"], "America/New_York (UTC-5:00)")
        self.assertEqual(summer["America/New_York"], "America/New_York (UTC-4:00)")
        self.assertEqual(winter["UTC"], "UTC (UTC+0:00)")
        self.assertIsNone(Site(time_zone=None).time_zone)
        self.assertEqual(Site(time_zone="Europe/London").time_zone, "Europe/London")
    def site(self, **changes):
        return Site.model_validate({"width": 12, "depth": 18, "height_m": 10,
            "floor_height_m": 3, "roads": {"N": 12, "E": None, "S": None, "W": None}, **changes})

    def test_independent_envelope_and_explicit_cost_subtotal(self):
        result = feasibility(self.site())
        self.assertEqual(result["gross_area_m2"], 216)
        self.assertEqual(result["envelope"], {"x": 1.5, "y": 2, "width": 9, "depth": 14.5})
        self.assertEqual(result["usable_m2"], 130.5)
        self.assertEqual(result["built_up_m2"], 391.5)
        self.assertEqual(cost_estimate(self.site(), Costs())["status"], "prerequisites")
        costs = cost_estimate(self.site(), Costs(land_inr_m2=100, construction_inr_m2=1000,
            land_sro_inr_m2=80, registration_percent=5, gst_percent=0))
        self.assertEqual(costs["subtotal_inr"], 21600 + 864 + 391500)
        self.assertIn("not an all-in", costs["messages"][0])

    def test_units_missing_invalid_and_height_prerequisites(self):
        metres = feasibility(self.site())
        feet = feasibility(self.site(width=12/.3048, depth=18/.3048, units="ft"))
        for field in ("net_area_m2", "usable_m2", "coverage_percent", "built_up_m2"):
            self.assertAlmostEqual(metres[field], feet[field])
        self.assertEqual(feasibility(self.site(height_m=12))["status"], "prerequisites")
        self.assertEqual(feasibility(self.site(floors=4))["status"], "prerequisites")
        self.assertEqual(feasibility(self.site(depth=1, roads=dict(N=1, E=None, S=None, W=None)))["status"], "infeasible")
        for field, value in (("width", float("nan")), ("height_m", 56), ("floor_height_m", 0)):
            with self.assertRaises(ValidationError):
                self.site(**{field: value})

    def test_incumbent_parity_all_bands_edges_and_road_thresholds(self):
        cases = []
        for area in [49, 50, 50.01, 100, 100.01, 200, 200.01, 300, 300.01, 400,
                     400.01, 500, 500.01, 750, 750.01, 1000, 1000.01, 1500,
                     1500.01, 2500, 2500.01, 3000]:
            for face in ("N", "E", "S", "W", "NE", "NW", "SE", "SW"):
                for road in (6, 8.999, 9, 11.999, 12, 12.001, 18, 18.001, 24, 30, 30.001):
                    rows = next(rows for upper, rows in BANDS if area <= upper)
                    for height, _, _ in rows:
                        site = self.site(width=math.sqrt(area), depth=math.sqrt(area), facing=face,
                            height_m=height, roads={edge: road if edge in face else None for edge in "NESW"})
                        if feasibility(site)["status"] == "computed":
                            cases.append(site)
        completed = subprocess.run(["node", r"tests\native-site-reference.cjs"],
            input=json.dumps([site.model_dump() for site in cases]), text=True,
            capture_output=True, check=True)
        references = json.loads(completed.stdout)
        self.assertGreater(len(references), 2000)
        for site, reference in zip(cases, references):
            result = feasibility(site)
            for key, expected in reference.items():
                if isinstance(expected, dict):
                    self.assertEqual(result[key], expected, (site, key))
                else:
                    self.assertAlmostEqual(result[key], expected, places=7, msg=str((site, key)))


if __name__ == "__main__":
    unittest.main()
