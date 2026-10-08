import tempfile
import unittest
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from backend.api import create_app
from backend.config import Settings
from backend.local import local_settings


class LocalPlatformTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.now = 1800000000
        self.settings = local_settings(Path(self.directory.name))

    def client(self, *, client_host="127.0.0.1", host="localhost"):
        app = create_app(self.settings, clock=lambda: self.now)
        config = Config("alembic.ini")
        with app.state.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        client = TestClient(app, base_url=f"http://{host}:8001", client=(client_host, 1234))
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        client.headers["origin"] = "http://localhost:5173"
        return client

    def login(self, client):
        response = client.post("/api/v1/auth/challenges", json={"phone": "+12025550123"})
        self.assertEqual(response.status_code, 202, response.text)
        challenge = response.json()
        self.assertNotIn("code", challenge)
        inbox = client.post("/api/v1/auth/local-inbox", json={"ticket": challenge["local_inbox_ticket"]})
        self.assertEqual(inbox.status_code, 200)
        self.assertEqual(inbox.json()["delivery"], "simulated-local-only")
        verified = client.post("/api/v1/auth/verify", json={
            "challenge_id": challenge["challenge_id"], "code": inbox.json()["code"],
        })
        self.assertEqual(verified.status_code, 200, verified.text)
        client.headers["x-csrf-token"] = verified.json()["csrf_token"]
        return challenge

    def test_local_identity_and_project_survive_restart(self):
        first = self.client()
        self.assertEqual(first.get("/api/v1/auth/delivery").json()["mode"], "local-inbox")
        self.login(first)
        project = first.post("/api/v1/projects", json={"name": "Local durable project"}).json()
        second_settings = local_settings(Path(self.directory.name))
        self.assertEqual(second_settings.auth_secret, self.settings.auth_secret)
        second = self.client()
        second.cookies.update(first.cookies)
        self.assertEqual(second.get("/api/v1/auth/session").status_code, 200)
        self.assertEqual(second.get(f"/api/v1/projects/{project['id']}").json(), project)

    def test_inbox_ticket_expiry_and_boundaries(self):
        client = self.client()
        challenge = self.login(client)
        self.assertEqual(client.post("/api/v1/auth/local-inbox", json={"ticket": "x" * 43}).status_code, 404)
        self.now += 301
        self.assertEqual(client.post("/api/v1/auth/local-inbox",
            json={"ticket": challenge["local_inbox_ticket"]}).status_code, 404)
        self.assertEqual(self.client(client_host="192.0.2.1").get("/api/v1/auth/delivery").status_code, 403)
        self.assertEqual(self.client(host="untrusted.example").get("/api/v1/auth/delivery").status_code, 403)
        self.assertEqual(client.post("/api/v1/auth/local-inbox", json={"ticket": "x" * 43},
            headers={"origin": "https://untrusted.example"}).status_code, 403)

    def test_inbox_configuration_cannot_enable_production_or_remote_origins(self):
        for changes in (
            {"environment": "production"},
            {"sms_enabled": True, "sms_endpoint": "https://example.com", "sms_sender": "+12025550123"},
            {"allowed_origins": ["http://192.0.2.1:5173"]},
        ):
            values = self.settings.model_dump()
            values.update(changes)
            with self.assertRaises(ValueError):
                Settings(_env_file=None, **values)


if __name__ == "__main__":
    unittest.main()
