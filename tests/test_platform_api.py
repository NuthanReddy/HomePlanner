import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from backend.api import create_app
from backend.config import Settings
from backend.models import Base, Challenge, LoginSession, ProjectRevision
from backend.sms import AzureSmsSender, SmsUnavailable


class RecordingSms:
    def __init__(self):
        self.messages = []
        self.fail = False

    def send_code(self, phone, code):
        if self.fail:
            raise SmsUnavailable("Synthetic failure")
        self.messages.append((phone, code))

    def close(self):
        pass


class PlatformApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.now = 1800000000
        self.sender = RecordingSms()
        self.settings = Settings(
            environment="development",
            database_url=f"sqlite:///{Path(self.directory.name) / 'platform.db'}",
            auth_secret="test-only-independent-secret-" + "x" * 32,
            allowed_origins=["http://localhost:5173"],
            sms_enabled=False,
        )
        self.app = create_app(self.settings, self.sender, lambda: self.now)
        config = Config("alembic.ini")
        with self.app.state.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.client.headers["origin"] = "http://localhost:5173"
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.client.__exit__, None, None, None)

    def login(self, phone="+12025550123", client=None):
        client = client or self.client
        client.headers["origin"] = "http://localhost:5173"
        issued = client.post("/api/v1/auth/challenges", json={"phone": phone})
        self.assertEqual(issued.status_code, 202, issued.text)
        self.assertNotIn("code", issued.json())
        verified = client.post("/api/v1/auth/verify", json={
            "challenge_id": issued.json()["challenge_id"], "code": self.sender.messages[-1][1]
        })
        self.assertEqual(verified.status_code, 200, verified.text)
        client.headers["x-csrf-token"] = verified.json()["csrf_token"]
        return issued, verified

    def test_migration_matches_models_and_readiness(self):
        self.assertEqual(self.client.get("/api/v1/health/ready").status_code, 200)
        tables = inspect(self.app.state.engine)
        for table in Base.metadata.sorted_tables:
            actual = {column["name"] for column in tables.get_columns(table.name)}
            self.assertEqual(actual, set(table.columns.keys()))

    def test_auth_required_and_origin_guard(self):
        self.assertEqual(self.client.get("/api/v1/projects").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/challenges", json={"phone": "+12025550123"},
            headers={"origin": "https://untrusted.example"}).status_code, 403)
        self.assertEqual(self.sender.messages, [])

    def test_phone_validation_and_errors_do_not_echo_input(self):
        response = self.client.post("/api/v1/auth/challenges", json={"phone": "private-invalid-input"})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("private-invalid-input", response.text)
        self.assertNotIn('"input"', response.text)

    def test_sms_failure_invalidates_code(self):
        self.sender.fail = True
        self.assertEqual(self.client.post("/api/v1/auth/challenges",
            json={"phone": "+12025550123"}).status_code, 503)
        with Session(self.app.state.engine) as session:
            self.assertEqual(session.scalar(select(Challenge)).status, "failed")

    def test_otp_replay_logout_and_hashed_credentials(self):
        issued, verified = self.login()
        self.assertIn("HttpOnly", verified.headers["set-cookie"])
        self.assertIn("SameSite=strict", verified.headers["set-cookie"])
        with Session(self.app.state.engine) as session:
            challenge = session.scalar(select(Challenge))
            login = session.scalar(select(LoginSession))
            self.assertNotEqual(challenge.code_digest, self.sender.messages[-1][1])
            self.assertNotEqual(login.token_digest, self.client.cookies.get("homeplanner"))
        replay = self.client.post("/api/v1/auth/verify", json={
            "challenge_id": issued.json()["challenge_id"], "code": self.sender.messages[-1][1]
        })
        self.assertEqual(replay.status_code, 400)
        self.assertEqual(self.client.post("/api/v1/auth/logout", json={}).status_code, 204)
        self.assertEqual(self.client.get("/api/v1/projects").status_code, 401)

    def test_expired_challenge_and_session(self):
        issued = self.client.post("/api/v1/auth/challenges", json={"phone": "+12025550123"})
        self.now += 301
        response = self.client.post("/api/v1/auth/verify", json={
            "challenge_id": issued.json()["challenge_id"], "code": self.sender.messages[-1][1]
        })
        self.assertEqual(response.status_code, 400)
        self.login()
        self.now += self.settings.session_ttl_seconds + 1
        self.assertEqual(self.client.get("/api/v1/auth/session").status_code, 401)

    def test_attempt_budget_and_resend_supersedes_old_challenge(self):
        issued = self.client.post("/api/v1/auth/challenges", json={"phone": "+12025550123"})
        code = self.sender.messages[-1][1]
        wrong = "111111" if code != "111111" else "222222"
        for _ in range(5):
            self.assertEqual(self.client.post("/api/v1/auth/verify", json={
                "challenge_id": issued.json()["challenge_id"], "code": wrong
            }).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/auth/verify", json={
            "challenge_id": issued.json()["challenge_id"], "code": code
        }).status_code, 400)
        self.now += 61
        self.login()
        self.assertEqual(self.client.post("/api/v1/auth/verify", json={
            "challenge_id": issued.json()["challenge_id"], "code": code
        }).status_code, 400)

    def test_resend_and_hourly_limit_survive_new_clients(self):
        self.client.post("/api/v1/auth/challenges", json={"phone": "+12025550123"})
        other = TestClient(self.app)
        other.headers["origin"] = "http://localhost:5173"
        self.assertEqual(other.post("/api/v1/auth/challenges",
            json={"phone": "+12025550123"}).status_code, 429)
        for _ in range(4):
            self.now += 61
            self.assertEqual(self.client.post("/api/v1/auth/challenges",
                json={"phone": "+12025550123"}).status_code, 202)
        self.now += 61
        self.assertEqual(self.client.post("/api/v1/auth/challenges",
            json={"phone": "+12025550123"}).status_code, 429)

    def test_csrf_stable_across_reload_and_project_conflicts(self):
        self.login()
        csrf = self.client.headers["x-csrf-token"]
        for _ in range(2):
            self.assertEqual(self.client.get("/api/v1/auth/session").json()["csrf_token"], csrf)
        blocked = self.client.post("/api/v1/projects", json={}, headers={"x-csrf-token": ""})
        self.assertEqual(blocked.status_code, 403)
        created = self.client.post("/api/v1/projects", json={"name": "Original"})
        self.assertEqual(created.status_code, 201, created.text)
        project = created.json()
        changed = self.client.patch(f"/api/v1/projects/{project['id']}",
            json={"name": "Edited", "expected_version": 0})
        self.assertEqual(changed.status_code, 200, changed.text)
        stale = self.client.patch(f"/api/v1/projects/{project['id']}",
            json={"name": "Stale overwrite", "expected_version": 0})
        self.assertEqual(stale.status_code, 409)
        actual = self.client.get(f"/api/v1/projects/{project['id']}").json()
        self.assertEqual(actual["name"], "Edited")
        self.assertEqual(actual["id"], project["id"])
        self.assertEqual(actual["version"], 1)
        with Session(self.app.state.engine) as session:
            history = session.scalars(select(ProjectRevision).order_by(ProjectRevision.version)).all()
            self.assertEqual([entry.metadata_snapshot["name"] for entry in history], ["Original", "Edited"])

    def test_cross_account_access_is_not_found(self):
        self.login()
        created = self.client.post("/api/v1/projects", json={}).json()
        other = TestClient(self.app)
        self.login("+12025550124", other)
        self.assertEqual(other.get("/api/v1/projects").json()["items"], [])
        for suffix in ("", "/jobs"):
            self.assertEqual(other.get(f"/api/v1/projects/{created['id']}{suffix}").status_code, 404)
        self.assertEqual(other.patch(f"/api/v1/projects/{created['id']}",
            json={"name": "Unauthorized", "expected_version": 0}).status_code, 404)

    def test_large_body_and_unavailable_capabilities(self):
        self.login()
        self.assertEqual(self.client.post("/api/v1/projects", json={"name": "x" * 17000}).status_code, 413)
        capabilities = self.client.get("/api/v1/capabilities").json()
        self.assertFalse(capabilities["simulations"])
        self.assertFalse(capabilities["alternate_plans"])
        identifier = self.client.post("/api/v1/projects", json={}).json()["id"]
        jobs = self.client.get(f"/api/v1/projects/{identifier}/jobs").json()
        self.assertEqual(jobs["availability"], "unavailable")
        self.assertEqual(jobs["items"], [])

    def test_provider_rejection_is_not_success(self):
        sender = AzureSmsSender(self.settings)
        sender.client = Mock()
        sender.client.send.return_value = [SimpleNamespace(successful=False)]
        with self.assertRaises(SmsUnavailable):
            sender.send_code("+12025550123", "123456")

    def test_production_configuration_fails_closed(self):
        with self.assertRaises(ValueError):
            Settings(database_url="sqlite:///not-production.db", auth_secret="x" * 64)
        with self.assertRaises(ValueError):
            Settings(environment="development", database_url="sqlite:///unused.db",
                auth_secret="short")

    def test_local_inbox_unavailable_in_normal_runtime(self):
        self.assertEqual(self.client.get("/api/v1/auth/delivery").json()["mode"], "sms")
        self.assertEqual(self.client.post("/api/v1/auth/local-inbox", json={"ticket": "x" * 43}).status_code, 404)

    def test_real_python_utility_engines_and_owner_guard(self):
        self.assertEqual(self.client.post(
            "/api/v1/projects/00000000-0000-0000-0000-000000000000/analysis/air-density",
            json={"inputs": {}}).status_code, 401)
        self.login()
        project = self.client.post("/api/v1/projects", json={}).json()
        route = f"/api/v1/projects/{project['id']}/analysis"
        density = self.client.post(route + "/air-density", json={"inputs": {
            "temperatureC": 25, "rhPct": 60, "pressurePa": 101325,
        }})
        self.assertEqual(density.status_code, 200, density.text)
        self.assertEqual(density.json()["scope"], "supplied-input-utility-not-plan-study")
        result = density.json()["result"]
        self.assertEqual(result["engine"]["name"], "PsychroLib")
        humidity_ratio = result["output"]["humidityRatioKgKgDryAir"]
        expected_density = 101325 * (1 + humidity_ratio) / (
            287.042 * (25 + 273.15) * (1 + 1.607858 * humidity_ratio)
        )
        self.assertAlmostEqual(result["output"]["densityKgM3"], expected_density, places=8)
        solar = self.client.post(route + "/solar-position", json={"inputs": {
            "latitude": 17.385, "longitude": 78.4867, "timeZone": "Asia/Kolkata",
            "date": "2026-06-21", "instantUTC": "2026-06-21T06:30:00Z",
            "altitudeM": 542, "pressurePa": 95000, "temperatureC": 30,
        }})
        self.assertEqual(solar.status_code, 200, solar.text)
        self.assertEqual(solar.json()["result"]["engine"]["name"], "pvlib")
        self.assertGreater(solar.json()["result"]["output"]["selected"]["apparentElevationDeg"], 70)
        other = TestClient(self.app)
        self.login("+12025550124", other)
        self.assertEqual(other.post(route + "/air-density", json={"inputs": {}}).status_code, 404)
        self.assertEqual(self.client.post(route + "/light", json={"inputs": {}}).status_code, 422)

    def test_python_prerequisites_missing_values_and_failures_are_explicit(self):
        self.login()
        identifier = self.client.post("/api/v1/projects", json={}).json()["id"]
        route = f"/api/v1/projects/{identifier}/analysis/air-density"
        self.assertEqual(self.client.post(route, json={"inputs": {}}).status_code, 400)
        import python_analysis
        python_analysis._dependencies.cache_clear()
        try:
            with patch.object(python_analysis.importlib, "import_module", side_effect=ImportError("private path")):
                response = self.client.post(route, json={"inputs": {
                    "temperatureC": 25, "rhPct": 60, "pressurePa": 101325,
                }})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private path", response.text)
        finally:
            python_analysis._dependencies.cache_clear()


if __name__ == "__main__":
    unittest.main()
