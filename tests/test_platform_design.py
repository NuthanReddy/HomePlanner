import copy
import json
import subprocess
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import DesignRevision
import test_platform_api as platform_tests


class DesignStorageTests(unittest.TestCase):
    setUp = platform_tests.PlatformApiTests.setUp
    login = platform_tests.PlatformApiTests.login

    def prepare(self):
        self.login()
        self.project = self.client.post("/api/v1/projects", json={}).json()["id"]
        self.path = f"/api/v1/projects/{self.project}/design"
        result = subprocess.run(["node", "-e",
            "console.log(JSON.stringify(require('./planner-model.js').createProject()))"],
            capture_output=True, text=True, check=True)
        self.document = json.loads(result.stdout)

    def save(self, version, document):
        return self.client.post(self.path, json={"expected_version": version, "document": document})

    def test_lossless_reopen_conflict_and_independent_site_history(self):
        self.prepare()
        self.assertEqual(self.client.get(self.path).json()["document"], None)
        self.document["unknownFutureMetadata"] = {"nullable": None, "records": [0, False]}
        saved = self.save(0, self.document)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["document"], self.document)
        self.assertEqual(self.save(1, self.document).json()["version"], 1)
        edited = copy.deepcopy(self.document)
        edited["name"] = "Edited"
        self.assertEqual(self.save(0, edited).status_code, 409)
        self.assertEqual(self.save(1, edited).json()["version"], 2)
        with TestClient(self.app) as reopened:
            reopened.cookies.update(self.client.cookies)
            self.assertEqual(reopened.get(self.path).json()["document"], edited)
        with Session(self.app.state.engine) as session:
            versions = session.scalars(select(DesignRevision).where(
                DesignRevision.project_id == self.project).order_by(DesignRevision.version)).all()
            self.assertEqual([item.document for item in versions], [self.document, edited])
        workspace = f"/api/v1/projects/{self.project}/workspace"
        self.client.post(workspace + "/commands", json={"expected_version": 0, "action": "site", "value": {"width": 10}})
        self.client.post(workspace + "/commands", json={"expected_version": 1, "action": "undo", "value": None})
        self.assertEqual(self.client.get(self.path).json()["document"], edited)

    def test_validation_owner_and_csrf_preserve_previous_snapshot(self):
        self.prepare()
        saved = self.save(0, self.document).json()
        for patch in [{"schemaVersion": 2}, {"revision": True}, {"activeFloorId": "missing"},
                      {"floors": []}, {"site": None}]:
            self.assertEqual(self.save(1, {**self.document, **patch}).status_code, 422, patch)
        self.assertEqual(self.client.get(self.path).json(), saved)
        self.assertEqual(self.client.post(self.path, json={"expected_version": 1, "document": self.document},
            headers={"x-csrf-token": "invalid"}).status_code, 403)
        with TestClient(self.app) as another:
            self.login("+12025550124", another)
            self.assertEqual(another.get(self.path).status_code, 404)
            self.assertEqual(another.post(self.path, json={"expected_version": 1, "document": self.document}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
