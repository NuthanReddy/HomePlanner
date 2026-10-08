import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from backend.api import create_app
from backend.config import Settings
from backend.materials import Materials, PRESETS, calculate_materials
from backend.models import Workspace
from backend.workspace import NativeDocument
import test_platform_api as platform_tests


def fixture():
    return {"layers": [
        {"id": "layer-a", "label": "Synthetic A", "source": "Analytical fixture, not a product",
         "thicknessM": .1, "conductivityW_MK": .5, "densityKgM3": 800., "specificHeatJ_KgK": 1000.},
        {"id": "layer-b", "label": "Synthetic B", "source": "Analytical fixture, not a product",
         "thicknessM": .05, "conductivityW_MK": .04, "densityKgM3": 30., "specificHeatJ_KgK": 1400.}],
        "films": {"inside": .13, "outside": .04, "source": "Explicit synthetic fixed boundaries"},
        "comparisonThicknessM": .2,
        "glazing": {"uValueW_M2K": 1.5, "shgc": 0., "vlt": .7, "source": "Synthetic hypothetical glazing"}}


class MaterialCalculationTests(unittest.TestCase):
    def test_worked_identity_and_no_mutation(self):
        inputs = Materials.model_validate(fixture())
        before = inputs.model_dump()
        result = calculate_materials(inputs)
        output = result["selected"]["output"]
        self.assertAlmostEqual(output["resistanceM2K_W"], 1.62)
        self.assertAlmostEqual(output["uValueW_M2K"], 1/1.62)
        self.assertAlmostEqual(output["arealHeatCapacityJ_M2K"], 82100)
        self.assertEqual(inputs.model_dump(), before)
        self.assertEqual(result["glazing"]["status"], "supplied")
        self.assertEqual(result["glazing"]["inputs"]["shgc"], 0)
        self.assertEqual(result["comparisons"][2]["status"], "prerequisites")
        self.assertIsNone(result["comparisons"][2]["output"])
        self.assertEqual(result["units"]["uValueW_M2K"], "W/(m²·K)")

    def test_legacy_method_parity_and_preset_evidence(self):
        fixtures = []
        for thickness in (.001, .1, .8, 2.):
            for conductivity in (.001, .04, .5, 10.):
                data = fixture()
                data["layers"][0]["thicknessM"] = thickness
                data["layers"][0]["conductivityW_MK"] = conductivity
                fixtures.append(data)
        legacy = [{"layers": [{k: v for k, v in l.items() if k not in {"id", "condition"}}
                              for l in f["layers"]],
                   "films": {k: v for k, v in f["films"].items() if k != "source"}} for f in fixtures]
        process = subprocess.run(["node", r"tests\materials-reference.cjs"], input=json.dumps(legacy),
                                 text=True, capture_output=True, check=True)
        for data, expected in zip(fixtures, json.loads(process.stdout)):
            actual = calculate_materials(Materials.model_validate(data))["selected"]["output"]
            for key, value in actual.items():
                self.assertAlmostEqual(value, expected[key], places=9)
        originals = json.loads(subprocess.run(["node", r"tests\materials-reference.cjs", "presets"], text=True,
                                             capture_output=True, check=True).stdout)
        for preset, original in zip(PRESETS, originals):
            for key in ("id", "thicknessM", "conductivityW_MK", "densityKgM3", "specificHeatJ_KgK", "url"):
                self.assertEqual(preset[key], original[key])

    def test_unknowns_zero_films_and_missing_sources(self):
        empty = calculate_materials(Materials())
        self.assertEqual(empty["selected"]["status"], "prerequisites")
        self.assertIsNone(empty["selected"]["output"])
        self.assertTrue(all(c["output"] is None for c in empty["comparisons"]))
        for group, field in (("layers", "densityKgM3"), ("layers", "specificHeatJ_KgK"),
                             ("films", "inside"), ("films", "outside")):
            data = fixture()
            target = data["layers"][0] if group == "layers" else data[group]
            target[field] = None
            self.assertIsNone(calculate_materials(Materials.model_validate(data))["selected"]["output"])
        data = fixture()
        data["films"].update(inside=0., outside=0.)
        self.assertAlmostEqual(calculate_materials(Materials.model_validate(data))["selected"]["output"]["resistanceM2K_W"], 1.45)
        data["films"]["source"] = " "
        self.assertIsNone(calculate_materials(Materials.model_validate(data))["selected"]["output"])
        data = fixture()
        data["layers"][0]["source"] = " "
        self.assertEqual(calculate_materials(Materials.model_validate(data))["selected"]["status"], "prerequisites")

    def test_validation_and_numerical_range_failures(self):
        for value in (0., -1., True, "0.1", float("nan"), float("inf")):
            data = fixture()
            data["layers"][0]["thicknessM"] = value
            with self.assertRaises(ValidationError):
                Materials.model_validate(data)
        data = fixture()
        data["layers"][1]["id"] = "layer-a"
        with self.assertRaises(ValidationError):
            Materials.model_validate(data)
        for values in ({"thicknessM": 1e-300, "conductivityW_MK": 1e300},
                       {"densityKgM3": 1e300, "specificHeatJ_KgK": 1e300}):
            data = fixture()
            data["layers"][0].update(values)
            with self.assertRaises(HTTPException):
                calculate_materials(Materials.model_validate(data))
        data = fixture()
        data["glazing"]["vlt"] = 1.1
        with self.assertRaises(ValidationError):
            Materials.model_validate(data)


class MaterialApiTests(unittest.TestCase):
    login = platform_tests.PlatformApiTests.login

    def setUp(self):
        self.directory = Path("tests") / (".materials-fixture-" + uuid4().hex)
        self.directory.mkdir()
        self.addCleanup(shutil.rmtree, self.directory)
        self.now = 1800000000
        self.sender = platform_tests.RecordingSms()
        self.settings = Settings(environment="development",
            database_url="sqlite:///" + str((self.directory / "platform.db").resolve()),
            auth_secret="test-only-independent-secret-" + "x" * 32,
            allowed_origins=["http://localhost:5173"], sms_enabled=False)
        self.app = create_app(self.settings, self.sender, lambda: self.now)
        config = Config("alembic.ini")
        with self.app.state.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.login()
        project = self.client.post("/api/v1/projects", json={"name": "Materials isolated fixture"}).json()
        self.path = f"/api/v1/projects/{project['id']}/workspace"
        self.project_id = project["id"]

    def edit(self, version, action, value=None):
        return self.client.post(self.path + "/commands", json={
            "expected_version": version, "action": action, "value": value})

    def test_additive_old_document_history_durability_and_noop(self):
        self.edit(0, "site", {"width": 17.})
        # Simulate the older document shape, without rewriting it on read.
        with Session(self.app.state.engine) as session:
            row = session.get(Workspace, self.project_id)
            old = dict(row.document)
            old.pop("materials", None)
            row.document = old
            session.commit()
        before = self.client.get(self.path).json()
        self.assertEqual(before["document"]["materials"], Materials().model_dump())
        with Session(self.app.state.engine) as session:
            self.assertNotIn("materials", session.get(Workspace, self.project_id).document)
        response = self.edit(1, "materials", fixture())
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        for key in before["document"]:
            if key != "materials":
                self.assertEqual(saved["document"][key], before["document"][key])
        self.assertEqual(saved["document"]["materials"]["layers"][0]["id"], "layer-a")
        self.assertEqual(self.edit(2, "materials", fixture()).json()["version"], 2)
        self.assertEqual(self.edit(1, "materials", {}).status_code, 409)
        self.assertEqual(self.edit(2, "materials", {"films": {"inside": -1}}).status_code, 422)
        self.assertEqual(self.client.get(self.path).json(), saved)
        undo = self.edit(2, "undo").json()
        self.assertEqual(undo["document"], before["document"])
        self.assertEqual(self.edit(3, "redo").json()["document"], saved["document"])
        self.edit(4, "costs", {"land_inr_m2": 0.})
        reopened = create_app(self.settings, self.sender, lambda: self.now)
        with TestClient(reopened) as client:
            client.cookies.update(self.client.cookies)
            self.assertEqual(client.get(self.path).json()["document"]["materials"], saved["document"]["materials"])
        self.assertEqual(NativeDocument.model_validate(before["document"]).materials, Materials())
        partial = self.edit(5, "materials", {"glazing": {"shgc": .2}}).json()
        expected = dict(saved["document"]["materials"]["glazing"])
        expected["shgc"] = .2
        self.assertEqual(partial["document"]["materials"]["glazing"], expected)
        self.assertEqual(partial["document"]["materials"]["films"], saved["document"]["materials"]["films"])

    def test_evaluation_owner_csrf_version_unknowns_and_read_only(self):
        before = self.client.get(self.path).json()
        result = self.client.post(self.path + "/materials", json={"expected_version": 0})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["result"]["selected"]["status"], "prerequisites")
        self.assertEqual(self.client.get(self.path).json(), before)
        self.assertEqual(len(self.client.get(self.path + "/materials-options").json()["presets"]), 3)
        self.edit(0, "materials", fixture())
        result = self.client.post(self.path + "/materials", json={"expected_version": 1}).json()
        self.assertEqual(result["scope"], "assembly-descriptors-not-zone-simulation")
        self.assertEqual(result["result"]["selected"]["status"], "computed")
        self.assertEqual(result["version"], 1)
        self.assertEqual(self.client.post(self.path + "/materials", json={"expected_version": 0}).status_code, 409)
        self.assertEqual(self.client.post(self.path + "/materials", json={"expected_version": True}).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/materials", json={"expected_version": 1, "layers": []}).status_code, 422)
        self.assertEqual(self.client.post(self.path + "/materials", json={"expected_version": 1},
                                         headers={"x-csrf-token": "invalid"}).status_code, 403)
        other = TestClient(self.app)
        self.login("+12025550124", other)
        self.assertEqual(other.post(self.path + "/materials", json={"expected_version": 1}).status_code, 404)
        self.assertEqual(other.get(self.path + "/materials-options").status_code, 404)
        other.close()
        before = self.client.get(self.path).json()
        def changed(_materials):
            self.edit(1, "costs", {"construction_inr_m2": 2.})
            return {}
        with patch("backend.api.calculate_materials", side_effect=changed):
            self.assertEqual(self.client.post(self.path + "/materials", json={"expected_version": 1}).status_code, 409)
        self.assertEqual(self.client.get(self.path).json()["document"]["materials"], before["document"]["materials"])


if __name__ == "__main__":
    unittest.main()
