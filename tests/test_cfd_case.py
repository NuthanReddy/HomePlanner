"""Synthetic compiler checks, not numerical validation of an OpenFOAM run."""

import copy
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path, PurePosixPath
import random
import re
import shutil
import socket
import subprocess
import time
import unittest
from unittest.mock import patch
import uuid
from zipfile import ZipFile

import cfd_case as cfd


FIXTURE = Path(__file__).parent / "fixtures" / "cfd-request.json"


def request():
    with FIXTURE.open(encoding="utf-8") as stream:
        return json.load(stream)


def closed_request():
    payload = request()
    for opening in payload["geometry"]["openings"]:
        opening["openFraction"] = 0
    for condition in payload["scenario"]["openings"]:
        condition.update(mode="closed", speedMps=None, gaugePressurePa=None)
    return payload


def sealed_request():
    payload = closed_request()
    payload["geometry"]["openings"] = []
    payload["scenario"]["openings"] = []
    return payload


def fractional_request():
    payload = request()
    geometry = payload["geometry"]
    geometry["rect"] = {"x": 5.1599999999999, "y": 2.7299999999999995,
                        "w": 3.6000000000000005, "h": 2.8499999999999996}
    geometry["sourceRoomRect"] = {"x": 5.21, "y": 2.78, "w": 3.5, "h": 2.75}
    geometry["heightM"] = 2.7432000000000003
    for wall, thickness in zip(
        geometry["walls"], (0.1999999999999, 0.14999999999996, 0.250000000000001, 0.19999999999999995),
    ):
        wall["thicknessM"] = thickness
    geometry["openings"][0].update(
        offsetM=0.4999999999999999, widthM=0.9000000000000004,
        sillM=0.8999999999999001, heightM=1.2,
    )
    geometry["openings"][1].update(
        offsetM=1.4000000000001003, widthM=0.8999999999999,
        sillM=0, heightM=2.1000000000001,
    )
    geometry["openings"][2].update(
        offsetM=0.6000000000001, widthM=0.75,
        sillM=0.8999999999999999, heightM=1.2000000000000004,
    )
    payload["scenario"]["floorThicknessM"] = 0.19999999999999996
    payload["scenario"]["ceilingThicknessM"] = 0.1999999999999
    return payload


def at(document, path):
    for key in path:
        document = document[key]
    return document


def walk(value, path=()):
    yield path, value
    if type(value) is dict:
        for key, child in value.items():
            yield from walk(child, (*path, key))
    elif type(value) is list:
        for index, child in enumerate(value):
            yield from walk(child, (*path, index))


def replace(document, path, value):
    at(document, path[:-1])[path[-1]] = value


def list_section(text, name):
    start = re.search(r"\b" + re.escape(name) + r"\s*\(", text).end()
    level = 1
    for end in range(start, len(text)):
        if text[end] == "(":
            level += 1
        elif text[end] == ")":
            level -= 1
            if level == 0:
                return text[start:end]
    raise AssertionError(f"Unbalanced list: {name}")


def mesh_data(prepared):
    text = prepared["files"]["system/blockMeshDict"]
    vertices = [
        tuple(float(value) for value in match.split())
        for match in re.findall(r"\(([^()]*)\)", list_section(text, "vertices"))
    ]
    blocks = [
        {
            "vertices": tuple(map(int, vertex_ids.split())),
            "region": region, "counts": tuple(map(int, counts.split())),
        }
        for vertex_ids, region, counts in re.findall(
            r"hex\s*\(([\d\s]+)\)\s*(air|solid)\s*\(([\d\s]+)\)\s*simpleGrading\s*\(1 1 1\)",
            list_section(text, "blocks"),
        )
    ]
    patches = {}
    for name, kind, faces in re.findall(
        r"(\w+)\s*\{\s*type\s+(\w+);\s*faces\s*\((.*?)\);\s*\}",
        list_section(text, "boundary"), re.S,
    ):
        patches[name] = {
            "kind": kind,
            "faces": [tuple(map(int, face.split())) for face in re.findall(r"\(([\d\s]+)\)", faces)],
        }
    return vertices, blocks, patches


def subtract(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def centre(points):
    return tuple(sum(p[axis] for p in points) / len(points) for axis in range(3))


def face_normal(vertices, face):
    first, second, third = (vertices[index] for index in face[:3])
    return cross(subtract(second, first), subtract(third, first))


def face_area(vertices, face):
    normal = face_normal(vertices, face)
    return math.sqrt(dot(normal, normal))


def patch_body(field, name):
    match = re.search(r"\b" + re.escape(name) + r"\s*\{([^{}]*)\}", field, re.S)
    if match is None:
        raise AssertionError(f"Missing patch {name}")
    return match.group(1)


def uniform_scalar(text, name="value"):
    return float(re.search(r"\b" + re.escape(name) + r"\s+uniform\s+([-\d.e+]+)\s*;", text).group(1))


def uniform_vector(text):
    return tuple(map(float, re.search(r"\bvalue\s+uniform\s*\(([^()]*)\)", text).group(1).split()))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


class InputContractTests(unittest.TestCase):
    def assert_invalid(self, payload, *, code=None, message=None):
        before = copy.deepcopy(payload)
        with patch.object(cfd, "_mesh", side_effect=AssertionError("Invalid requests must not allocate a mesh")):
            with patch.object(cfd, "_files", side_effect=AssertionError("Invalid requests must not render case files")):
                with self.assertRaises(cfd.CfdInputError) as caught:
                    cfd.prepare_case(payload)
        error = caught.exception
        self.assertEqual(error.public()["status"], "error")
        self.assertEqual(error.public()["error"]["message"], error.message)
        self.assertIn(error.status, (400, 413))
        if code:
            self.assertEqual(error.code, code)
        if message:
            self.assertIn(message, error.message)
        # NaN cannot be compared structurally, but its spelling remains stable.
        self.assertEqual(repr(payload), repr(before))
        return error

    def test_public_error_api_and_fixed_profile(self):
        error = cfd.CfdInputError("test", "test_code", 422)
        self.assertEqual((error.message, error.code, error.status), ("test", "test_code", 422))
        self.assertEqual(str(error), "test")
        self.assertEqual(error.public(), {"status": "error", "error": {"code": "test_code", "message": "test"}})
        self.assertEqual(cfd.CfdInputError("x").status, 400)
        self.assertEqual(cfd.CfdInputError("x").code, "invalid_input")
        self.assertEqual((cfd.PROFILE, cfd.ENGINE_VERSION, cfd.MAX_PAYLOAD_BYTES), ("single-room-cht-v1", "2606", 262144))

    def test_non_object_payloads_versions_and_profiles(self):
        for invalid in (None, [], True, 1, "{}", b"{}", {"version": 1}):
            with self.subTest(invalid=invalid):
                self.assert_invalid(invalid)
        for key, value in (("version", 2), ("version", 1.0), ("version", True),
                           ("profile", "OpenFOAM-13"), ("profile", "chtMultiRegionFoam")):
            payload = request()
            payload[key] = value
            self.assert_invalid(payload)

    def test_every_required_field_including_nullable_inputs_is_required(self):
        original = request()
        for path, value in walk(original):
            if type(value) is not dict:
                continue
            for key in value:
                with self.subTest(path=path, field=key):
                    payload = copy.deepcopy(original)
                    del at(payload, path)[key]
                    self.assert_invalid(payload)

    def test_unknown_fields_at_every_object_level_are_rejected(self):
        original = request()
        for path, value in walk(original):
            if type(value) is dict:
                with self.subTest(path=path):
                    payload = copy.deepcopy(original)
                    at(payload, path)["solverPath"] = '#include "/untrusted/dictionary"'
                    self.assert_invalid(payload, message="Unknown fields")
        payload = request()
        payload["scenario"][17] = "not a string key"
        self.assert_invalid(payload)

    def test_every_numeric_leaf_rejects_nonfinite_boolean_string_and_null(self):
        original = request()
        numeric_paths = [path for path, value in walk(original) if type(value) in (int, float)]
        for path in numeric_paths:
            for value in (True, False, math.nan, math.inf, -math.inf, "1", None, 10 ** 400):
                with self.subTest(path=path, value=value):
                    payload = copy.deepcopy(original)
                    replace(payload, path, value)
                    self.assert_invalid(payload)

    def test_null_is_only_allowed_for_nonapplicable_opening_speed_and_gauge(self):
        original = request()
        for path, value in walk(original):
            if not path or value is None:
                continue
            with self.subTest(path=path):
                payload = copy.deepcopy(original)
                replace(payload, path, None)
                self.assert_invalid(payload)

    def test_acknowledgements_are_explicit_booleans(self):
        for name in ("acknowledgeGeometry", "acknowledgeEmptyRoom", "acknowledgeModel"):
            for value in (False, 1, "true", None):
                with self.subTest(name=name, value=value):
                    payload = request()
                    payload["scenario"][name] = value
                    self.assert_invalid(payload)

    def test_source_string_revision_and_unicode_bounds(self):
        for path, value in (
            (("source", "revision"), -1),
            (("source", "revision"), 9007199254740992),
            (("source", "projectId"), ""),
            (("source", "roomId"), " "),
            (("source", "floorId"), "x" * 16385),
            (("source", "inputFingerprint"), ""),
            (("source", "geometryFingerprint"), " "),
            (("source", "projectId"), "\ud800"),
            (("source", "roomId"), "😀" * 4097),
            (("scenario", "sourceNote"), ""),
            (("scenario", "sourceNote"), "x" * 4097),
        ):
            with self.subTest(path=path):
                payload = request()
                replace(payload, path, value)
                self.assert_invalid(payload)

    def test_encoded_payload_byte_budget_is_enforced(self):
        payload = request()
        payload["source"]["inputFingerprint"] = "x" * 98304
        payload["source"]["geometryFingerprint"] = "y" * 98304
        payload["scenario"]["sourceNote"] = "z" * 4096
        for wall in payload["geometry"]["walls"]:
            wall["sourceIds"].extend(
                f"{wall['side']}-{index:02d}-" + "x" * 251 for index in range(63)
            )
        self.assert_invalid(payload, code="payload_too_large")

    def test_fingerprints_share_only_the_whole_encoded_payload_budget(self):
        for name in ("inputFingerprint", "geometryFingerprint"):
            for text in ("x" * (cfd.MAX_PAYLOAD_BYTES + 1), "😀" * 70000, '"' * 150000):
                with self.subTest(name=name, encoding=text[:1]):
                    payload = request()
                    payload["source"][name] = text
                    error = self.assert_invalid(payload, code="payload_too_large")
                    self.assertEqual(error.status, 413)
        payload = request()
        payload["source"]["inputFingerprint"] = "x" * 132000
        payload["source"]["geometryFingerprint"] = "y" * 132000
        self.assert_invalid(payload, code="payload_too_large")

    def test_bounded_collections_and_duplicate_walls(self):
        for name, value in (
            ("walls", []), ("walls", request()["geometry"]["walls"][:3]),
            ("walls", request()["geometry"]["walls"] * 2),
            ("openings", request()["geometry"]["openings"] * 11),
        ):
            payload = request()
            payload["geometry"][name] = value
            self.assert_invalid(payload)
        for replacement in ([], ["x"] * 65, ["same", "same"]):
            payload = request()
            payload["geometry"]["walls"][0]["sourceIds"] = replacement
            self.assert_invalid(payload)
        payload = request()
        payload["geometry"]["walls"][1]["side"] = "N"
        self.assert_invalid(payload)
        payload = request()
        payload["geometry"]["walls"][1]["sourceIds"].append("synthetic-wall-N")
        self.assert_invalid(payload)

    def test_duplicate_unresolved_or_missing_opening_conditions(self):
        payload = request()
        payload["geometry"]["openings"][1]["id"] = payload["geometry"]["openings"][0]["id"]
        self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["openings"][1]["id"] = payload["scenario"]["openings"][0]["id"]
        self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["openings"][0]["id"] = "missing"
        self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["openings"].pop()
        self.assert_invalid(payload)
        payload = request()
        payload["geometry"]["openings"][0]["wallId"] = "missing"
        self.assert_invalid(payload)
        payload = request()
        payload["geometry"]["openings"][0]["wallId"] = "synthetic-wall-S"
        self.assert_invalid(payload)

    def test_geometry_bounds_and_invalid_enums(self):
        invalids = (
            (("geometry", "coordinateSpace"), "world"),
            (("geometry", "rect", "w"), 0),
            (("geometry", "rect", "h"), 31),
            (("geometry", "sourceRoomRect", "w"), -1),
            (("geometry", "heightM"), 0),
            (("geometry", "walls", 0, "thicknessM"), 0),
            (("geometry", "walls", 0, "side"), "NE"),
            (("geometry", "openings", 0, "side"), "n"),
            (("geometry", "openings", 0, "offsetM"), -0.1),
            (("geometry", "openings", 0, "offsetM"), 2.75),
            (("geometry", "openings", 0, "widthM"), 0),
            (("geometry", "openings", 0, "sillM"), 2),
            (("geometry", "openings", 0, "heightM"), 0),
            (("geometry", "openings", 0, "adjacent"), "assume-outside"),
            (("scenario", "floorThicknessM"), 0),
            (("scenario", "ceilingThicknessM"), 0),
        )
        for path, value in invalids:
            with self.subTest(path=path, value=value):
                payload = request()
                replace(payload, path, value)
                self.assert_invalid(payload)

    def test_overlapping_apertures_are_rejected_and_disjoint_vertical_ones_work(self):
        payload = request()
        opening = copy.deepcopy(payload["geometry"]["openings"][0])
        opening.update(id="other", offsetM=0.75)
        condition = copy.deepcopy(payload["scenario"]["openings"][0])
        condition["id"] = "other"
        payload["geometry"]["openings"].append(opening)
        payload["scenario"]["openings"].append(condition)
        self.assert_invalid(payload, message="overlap")
        opening.update(offsetM=0.5, sillM=1.75, heightM=0.5)
        prepared = cfd.prepare_case(payload)
        self.assertEqual(len(prepared["manifest"]["openings"]), 4)

    def test_touching_or_under_resolved_apertures_are_explicitly_rejected(self):
        payload = request()
        opening = copy.deepcopy(payload["geometry"]["openings"][0])
        opening.update(id="touching", offsetM=1.0)
        condition = copy.deepcopy(payload["scenario"]["openings"][0])
        condition["id"] = "touching"
        payload["geometry"]["openings"].append(opening)
        payload["scenario"]["openings"].append(condition)
        self.assert_invalid(payload, code="unsupported_feature", message="separation")
        payload = request()
        payload["geometry"]["openings"][1]["offsetM"] = 0.5001
        self.assert_invalid(payload, code="unsupported_feature", message="feature planes")

    def test_operating_geometry_cannot_be_overridden(self):
        for index, fraction in ((0, 0.5), (0, 0), (2, 1)):
            payload = request()
            payload["geometry"]["openings"][index]["openFraction"] = fraction
            self.assert_invalid(payload)
        for mode in ("ventilation", "", "outlet"):
            payload = request()
            payload["scenario"]["openings"][2]["mode"] = mode
            self.assert_invalid(payload)

    def test_inlet_requires_outlet_but_sealed_and_outlet_only_cases_are_allowed(self):
        payload = request()
        payload["geometry"]["openings"][1]["openFraction"] = 0
        payload["scenario"]["openings"][1].update(mode="closed", speedMps=None, gaugePressurePa=None)
        self.assert_invalid(payload, message="requires at least one")
        for payload in (sealed_request(), closed_request()):
            prepared = cfd.prepare_case(payload)
            self.assertGreater(prepared["manifest"]["mesh"]["airCells"], 0)
            self.assertNotIn("type prghPressure;", prepared["files"]["0/air/p_rgh"])
        payload = closed_request()
        payload["geometry"]["openings"][1]["openFraction"] = 1
        payload["scenario"]["openings"][1].update(mode="outlet", gaugePressurePa=0)
        self.assertIn("type prghPressure;", cfd.prepare_case(payload)["files"]["0/air/p_rgh"])

    def test_mode_specific_temperature_speed_pressure_and_null_semantics(self):
        for index, name, value in (
            (0, "speedMps", 0), (0, "speedMps", -1), (0, "speedMps", None),
            (0, "gaugePressurePa", 0), (1, "speedMps", 0),
            (1, "gaugePressurePa", None), (1, "gaugePressurePa", -101325),
            (1, "gaugePressurePa", -101326), (1, "gaugePressurePa", 1e-20), (2, "speedMps", 0),
            (2, "gaugePressurePa", 0), (2, "temperatureC", None),
        ):
            with self.subTest(index=index, name=name, value=value):
                payload = request()
                payload["scenario"]["openings"][index][name] = value
                self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["openings"][1]["gaugePressurePa"] = -2.5
        manifest = cfd.prepare_case(payload)["manifest"]
        self.assertEqual(manifest["openings"][1]["staticPressurePa"], 101322.5)

    def test_unknown_adjacency_still_requires_resolved_hosts_and_explicit_boundaries(self):
        original = request()
        for opening in original["geometry"]["openings"]:
            opening["adjacent"] = "unknown"
        for index in (0, 1):
            for wall_id in (None, "", "unresolved-physical-host"):
                with self.subTest(index=index, wall_id=wall_id):
                    payload = copy.deepcopy(original)
                    payload["geometry"]["openings"][index]["wallId"] = wall_id
                    self.assert_invalid(payload)
        for index, field in ((0, "temperatureC"), (0, "speedMps"),
                             (1, "temperatureC"), (1, "gaugePressurePa")):
            with self.subTest(index=index, field=field):
                payload = copy.deepcopy(original)
                payload["scenario"]["openings"][index][field] = None
                self.assert_invalid(payload)

    def test_physical_inputs_are_finite_positive_and_thermodynamically_consistent(self):
        for path, value in (
            (("scenario", "air", "pressurePa"), 0),
            (("scenario", "air", "initialC"), -273.15),
            (("scenario", "air", "molarMassGmol"), 0),
            (("scenario", "air", "cpJkgK"), 100),
            (("scenario", "air", "muPaS"), 0),
            (("scenario", "air", "prandtl"), 0),
            (("scenario", "solid", "densityKgM3"), 0),
            (("scenario", "solid", "cpJkgK"), 0),
            (("scenario", "solid", "conductivityWmK"), 0),
        ):
            payload = request()
            replace(payload, path, value)
            self.assert_invalid(payload)

    def test_ideal_gas_cp_must_strictly_exceed_the_specific_gas_constant(self):
        for molar_mass in (2.016, 28.97, 44):
            specific_r = cfd.GAS_CONSTANT_J_KMOL_K / molar_mass
            for cp in (8314.462618 / molar_mass, math.nextafter(specific_r, -math.inf), specific_r):
                with self.subTest(molar_mass=molar_mass, cp=cp):
                    payload = request()
                    payload["scenario"]["air"].update(molarMassGmol=molar_mass, cpJkgK=cp)
                    self.assert_invalid(payload, message="positive Cv")
            payload = request()
            payload["scenario"]["air"].update(molarMassGmol=molar_mass, cpJkgK=specific_r + 1e-7)
            prepared = cfd.prepare_case(payload)
            self.assertEqual(prepared["manifest"]["scenario"]["air"], payload["scenario"]["air"])

    def test_time_step_integrality_and_runtime_bounds(self):
        for field, value in (
            ("deltaTSeconds", 0), ("deltaTSeconds", 0.03),
            ("endTimeSeconds", 0), ("endTimeSeconds", 0.55),
            ("writeIntervalSeconds", 0), ("writeIntervalSeconds", 0.15),
            ("writeIntervalSeconds", 1), ("maxCo", 0),
            ("maxRuntimeSeconds", 0), ("maxRuntimeSeconds", 1801),
        ):
            with self.subTest(field=field, value=value):
                payload = request()
                payload["scenario"]["numerics"][field] = value
                self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["numerics"].update(deltaTSeconds=0.1, endTimeSeconds=0.6, writeIntervalSeconds=0.2)
        manifest = cfd.prepare_case(payload)["manifest"]
        self.assertEqual((manifest["numerics"]["steps"], manifest["numerics"]["writeEverySteps"]), (6, 2))

    def test_probe_bounds_counts_and_height_datum(self):
        for field, value in (
            ("heightM", 0), ("heightM", 2.5), ("heightM", 0.001),
            ("rows", 0), ("columns", 0), ("columns", 2.0),
        ):
            payload = request()
            payload["scenario"]["sampling"][field] = value
            self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["sampling"].update(rows=23, columns=23)
        self.assert_invalid(payload, code="budget_exceeded", message="Slice probes")
        payload["scenario"]["sampling"].update(rows=16, columns=32)
        self.assertEqual(len(cfd.prepare_case(payload)["manifest"]["probeLocations"]), 512)

    def test_mesh_layer_cell_and_step_budgets_precede_allocation(self):
        for field, value in (("solidCells", 1), ("solidCells", 17), ("solidCells", 2.0),
                             ("spacingM", 0), ("spacingM", 0.019)):
            payload = request()
            payload["scenario"]["numerics"][field] = value
            self.assert_invalid(payload)
        payload = request()
        payload["scenario"]["numerics"]["spacingM"] = 0.02
        self.assert_invalid(payload, code="budget_exceeded", message="Mesh cells")
        payload = request()
        payload["scenario"]["numerics"].update(deltaTSeconds=0.00001, endTimeSeconds=1)
        self.assert_invalid(payload, code="budget_exceeded", message="Timesteps")
        payload = request()
        payload["scenario"]["numerics"].update(spacingM=0.125, deltaTSeconds=0.001, endTimeSeconds=10, writeIntervalSeconds=1)
        self.assert_invalid(payload, code="budget_exceeded", message="Cell-timesteps")

    def test_output_probe_sample_and_courant_budgets(self):
        payload = request()
        payload["scenario"]["numerics"].update(deltaTSeconds=0.001, endTimeSeconds=1, writeIntervalSeconds=0.001)
        self.assert_invalid(payload, code="budget_exceeded", message="Field writes")
        payload = request()
        payload["scenario"]["numerics"].update(spacingM=0.1, deltaTSeconds=0.001, endTimeSeconds=0.1, writeIntervalSeconds=0.001)
        self.assert_invalid(payload, code="budget_exceeded", message="Cell-writes")
        payload = request()
        payload["scenario"]["sampling"].update(rows=16, columns=32)
        payload["scenario"]["numerics"].update(deltaTSeconds=0.001, endTimeSeconds=0.2, writeIntervalSeconds=0.001)
        self.assert_invalid(payload, code="budget_exceeded", message="Probe-time")
        payload = request()
        payload["scenario"]["openings"][0]["speedMps"] = 2
        self.assert_invalid(payload, code="budget_exceeded", message="maxCo")

    def test_structured_block_budget_rejects_fragmented_geometry(self):
        payload = sealed_request()
        payload["geometry"]["rect"].update(w=5, h=5)
        payload["geometry"]["heightM"] = 4
        payload["scenario"]["numerics"]["spacingM"] = 2
        for index in range(32):
            side = "N" if index < 16 else "E"
            identity = f"fragment-{index}"
            payload["geometry"]["openings"].append({
                "id": identity, "wallId": f"synthetic-wall-{side}", "side": side,
                "offsetM": 0.1 + (index % 16) * 0.2, "widthM": 0.05,
                "sillM": 0.1 + index * 0.08, "heightM": 0.04, "openFraction": 0,
                "kind": "synthetic-slot", "adjacent": "unknown",
            })
            payload["scenario"]["openings"].append({
                "id": identity, "mode": "closed", "temperatureC": 25,
                "speedMps": None, "gaugePressurePa": None,
            })
        self.assert_invalid(payload, code="budget_exceeded", message="Structured grid blocks")


class CompilerOutputTests(unittest.TestCase):
    def test_manifest_is_detached_exact_and_explicitly_unverified(self):
        payload = request()
        before = copy.deepcopy(payload)
        prepared = cfd.prepare_case(payload)
        manifest = prepared["manifest"]
        self.assertEqual(payload, before)
        self.assertEqual(set(prepared), {"manifest", "files"})
        for name in ("source", "geometry", "scenario"):
            self.assertEqual(manifest[name], payload[name])
            self.assertIsNot(manifest[name], payload[name])
        self.assertEqual(manifest["runtimeVerification"], "pending")
        self.assertEqual(manifest["engine"], {"id": "OpenCFD-OpenFOAM", "version": "2606", "solver": "chtMultiRegionFoam"})
        self.assertNotIn("results", manifest)
        self.assertNotIn("status", manifest)
        self.assertTrue(manifest["limitations"])
        self.assertEqual(manifest["source"]["inputFingerprint"], before["source"]["inputFingerprint"])
        self.assertIsNone(manifest["scenario"]["openings"][0]["gaugePressurePa"])
        self.assertIsNone(manifest["scenario"]["openings"][1]["speedMps"])
        self.assertEqual(manifest["geometry"]["openings"][2]["adjacent"], "unknown")
        manifest["geometry"]["walls"][0]["sourceIds"].append("detached")
        manifest["scenario"]["openings"][0]["temperatureC"] = 100
        self.assertEqual(payload, before)

    def test_server_hash_is_canonical_stable_and_not_a_browser_fingerprint(self):
        payload = request()
        payload["source"]["inputFingerprint"] = "a" * 64
        first = cfd.prepare_case(payload)
        expected = hashlib.sha256(canonical(payload)).hexdigest()
        self.assertEqual(first["manifest"]["caseHash"], expected)
        self.assertNotEqual(expected, payload["source"]["inputFingerprint"])

        def reverse_keys(value):
            if type(value) is dict:
                return {key: reverse_keys(child) for key, child in reversed(list(value.items()))}
            if type(value) is list:
                return [reverse_keys(child) for child in value]
            return value

        second = cfd.prepare_case(reverse_keys(payload))
        self.assertEqual(second, first)
        payload["scenario"]["boundaries"]["N"] += 1
        third = cfd.prepare_case(payload)
        self.assertNotEqual(third["manifest"]["caseHash"], expected)
        self.assertEqual(third["manifest"]["source"]["inputFingerprint"], "a" * 64)

    def test_large_canonical_fingerprint_text_is_opaque_and_not_id_limited(self):
        baseline = cfd.prepare_case(request())
        for names, length in (
            (("inputFingerprint",), 240000),
            (("geometryFingerprint",), 240000),
            (("inputFingerprint", "geometryFingerprint"), 110000),
        ):
            with self.subTest(names=names):
                payload = request()
                for name in names:
                    payload["source"][name] = json.dumps(
                        {"label": "synthetic canonical browser text", "data": "x" * length},
                        sort_keys=True, separators=(",", ":"),
                    )
                    self.assertGreater(len(payload["source"][name]), 98304)
                self.assertLess(len(canonical(payload)), cfd.MAX_PAYLOAD_BYTES)
                prepared = cfd.prepare_case(payload)
                self.assertEqual(prepared["manifest"]["source"], payload["source"])
                self.assertEqual(prepared["files"], baseline["files"])
                self.assertEqual(
                    prepared["manifest"]["caseHash"], hashlib.sha256(canonical(payload)).hexdigest(),
                )
                for name in names:
                    self.assertIs(type(prepared["manifest"]["source"][name]), str)
                    self.assertNotEqual(prepared["manifest"]["caseHash"], payload["source"][name])

    def test_provenance_only_revision_and_document_changes_leave_physical_case_unchanged(self):
        payload = request()
        first = cfd.prepare_case(payload)
        payload["source"]["revision"] += 1
        payload["source"]["inputFingerprint"] = '{"presentation":"changed","otherRoom":"changed"}'
        second = cfd.prepare_case(payload)
        self.assertEqual(first["files"], second["files"])
        self.assertEqual(first["manifest"]["mesh"], second["manifest"]["mesh"])
        self.assertEqual(first["manifest"]["probeLocations"], second["manifest"]["probeLocations"])
        self.assertEqual(second["manifest"]["source"], payload["source"])
        self.assertNotEqual(first["manifest"]["caseHash"], second["manifest"]["caseHash"])
        self.assertEqual(second["manifest"]["runtimeVerification"], "pending")

    def test_long_model_lineage_ids_remain_opaque_without_changing_case_geometry(self):
        payload = request()
        before = cfd.prepare_case(payload)
        payload["source"]["roomId"] = "ground:" + "room-lineage-" * 100
        mapping = {}
        for wall in payload["geometry"]["walls"]:
            wall["sourceIds"] = [
                mapping.setdefault(identity, identity + ":lineage:" + "x" * 900)
                for identity in wall["sourceIds"]
            ]
        for opening in payload["geometry"]["openings"]:
            opening["wallId"] = mapping[opening["wallId"]]
        prepared = cfd.prepare_case(payload)
        self.assertEqual(prepared["manifest"]["source"], payload["source"])
        self.assertEqual(prepared["manifest"]["geometry"], payload["geometry"])
        self.assertEqual(prepared["files"], before["files"])
        self.assertNotEqual(prepared["manifest"]["caseHash"], before["manifest"]["caseHash"])

    def test_hash_captures_geometry_even_if_client_fingerprints_are_reused(self):
        payload = request()
        first = cfd.prepare_case(payload)["manifest"]["caseHash"]
        payload["geometry"]["rect"]["x"] += 0.01
        second = cfd.prepare_case(payload)["manifest"]["caseHash"]
        self.assertNotEqual(first, second)

    def test_source_identifiers_and_notes_cannot_enter_dictionaries_or_paths(self):
        payload = request()
        injection = 'opaque-";\n#include "/not-a-path"\n#codeStream { code #{ ignored #}; } ../../ 🏠'
        for name in ("projectId", "floorId", "roomId", "inputFingerprint", "geometryFingerprint"):
            payload["source"][name] = injection + name
        payload["scenario"]["sourceNote"] = injection
        wall_ids = {}
        for wall in payload["geometry"]["walls"]:
            wall_ids[wall["side"]] = injection + wall["side"]
            wall["sourceIds"] = [wall_ids[wall["side"]]]
        for index, opening in enumerate(payload["geometry"]["openings"]):
            identity = injection + str(index)
            opening.update(id=identity, wallId=wall_ids[opening["side"]], kind="opaque-label")
            payload["scenario"]["openings"][index]["id"] = identity
        prepared = cfd.prepare_case(payload)
        dictionaries = "\n".join(prepared["files"].values())
        self.assertNotIn("opaque-", dictionaries)
        self.assertNotIn("#include", dictionaries)
        self.assertNotIn("#codeStream", dictionaries)
        self.assertNotIn("systemCall", dictionaries)
        self.assertEqual(prepared["manifest"]["source"], payload["source"])
        self.assertEqual(prepared["manifest"]["geometry"], payload["geometry"])
        self.assertEqual(prepared["manifest"]["scenario"], payload["scenario"])
        for path in prepared["files"]:
            self.assertNotIn("opaque", path)
            self.assertNotIn("\\", path)
            self.assertFalse(PurePosixPath(path).is_absolute())
            self.assertNotIn("..", PurePosixPath(path).parts)

    def test_prepare_and_zip_perform_no_filesystem_network_or_process_operations(self):
        payload = request()
        with patch("builtins.open", side_effect=AssertionError("filesystem")), \
             patch("io.open", side_effect=AssertionError("filesystem")), \
             patch.object(os, "open", side_effect=AssertionError("filesystem")), \
             patch.object(os, "mkdir", side_effect=AssertionError("directory")), \
             patch.object(subprocess, "Popen", side_effect=AssertionError("process")), \
             patch.object(socket, "socket", side_effect=AssertionError("network")):
            prepared = cfd.prepare_case(payload)
            data = cfd.case_zip(prepared)
        self.assertGreater(len(data), 100)
        self.assertTrue(all(type(text) is str for text in prepared["files"].values()))
        self.assertEqual(set(prepared["files"]), cfd._CASE_PATHS)

    def test_zip_is_reproducible_safe_and_preserves_exact_manifest(self):
        prepared = cfd.prepare_case(request())
        first, second = cfd.case_zip(prepared), cfd.case_zip(prepared)
        self.assertEqual(first, second)
        with ZipFile(BytesIO(first)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {"manifest.json", *prepared["files"]})
            self.assertEqual(json.loads(archive.read("manifest.json")), prepared["manifest"])
            for item in archive.infolist():
                self.assertEqual(item.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual((item.external_attr >> 16) & 0o777, 0o644)
                self.assertNotIn("..", PurePosixPath(item.filename).parts)
                self.assertNotIn("\\", item.filename)
                self.assertFalse(PurePosixPath(item.filename).is_absolute())
            for path, text in prepared["files"].items():
                self.assertEqual(archive.read(path).decode("utf-8"), text)

    def test_zip_cannot_be_used_to_override_generated_files_or_commands(self):
        for mutate in (
            lambda p: p["files"].update({"../../outside": "x"}),
            lambda p: p["files"].update({"system/controlDict": "arbitrary dictionary"}),
            lambda p: p["manifest"]["commands"].append(["unapproved-command"]),
            lambda p: p["manifest"].update(runtimeVerification="passed"),
            lambda p: p["files"].pop("0/solid/p"),
        ):
            prepared = cfd.prepare_case(request())
            mutate(prepared)
            with self.assertRaises(cfd.CfdInputError):
                cfd.case_zip(prepared)

    def test_fixed_commands_require_both_region_mesh_checks_before_solver(self):
        self.assertEqual(cfd.prepare_case(request())["manifest"]["commands"], [
            ["blockMesh"],
            ["splitMeshRegions", "-cellZones", "-overwrite"],
            ["checkMesh", "-region", "air", "-allTopology", "-allGeometry"],
            ["checkMesh", "-region", "solid", "-allTopology", "-allGeometry"],
            ["chtMultiRegionFoam"],
        ])

    def test_temperature_units_thermo_and_pressure_are_not_guessed(self):
        payload = request()
        prepared = cfd.prepare_case(payload)
        files = prepared["files"]
        self.assertEqual(uniform_scalar(files["0/air/T"], "internalField"), 298.15)
        self.assertEqual(uniform_scalar(files["0/solid/T"], "internalField"), 296.15)
        self.assertEqual(uniform_scalar(files["0/air/p"], "internalField"), 101325)
        self.assertEqual(uniform_scalar(files["0/solid/p"], "internalField"), 101325)
        self.assertIn("equationOfState perfectGas;", files["constant/air/thermophysicalProperties"])
        self.assertIn("thermo hConst;", files["constant/air/thermophysicalProperties"])
        self.assertIn("transport const;", files["constant/air/thermophysicalProperties"])
        for name, value in (("molWeight", 28.97), ("Cp", 1006), ("mu", 0.0000185), ("Pr", 0.71)):
            found = float(re.search(r"\b" + name + r"\s+([-\d.e+]+);", files["constant/air/thermophysicalProperties"]).group(1))
            self.assertEqual(found, value)
        solid = files["constant/solid/thermophysicalProperties"]
        for name, value in (("rho", 1800), ("Cp", 840), ("kappa", 0.8)):
            self.assertEqual(float(re.search(r"\b" + name + r"\s+([-\d.e+]+);", solid).group(1)), value)
        self.assertIn("equationOfState rhoConst;", solid)
        self.assertIn("transport constIso;", solid)
        self.assertIn("inert specie bookkeeping", prepared["manifest"]["model"]["solidSpecieMolWeight"]["meaning"])
        self.assertIn("simulationType laminar;", files["constant/air/turbulenceProperties"])
        self.assertIn("radiationModel none;", files["constant/air/radiationProperties"])
        self.assertIn("radiationModel none;", files["constant/solid/radiationProperties"])
        self.assertEqual(uniform_scalar(files["0/solid/betavSolid"], "internalField"), 1)
        self.assertIn("combustionModel none;", files["constant/air/combustionProperties"])
        self.assertNotIn("0/air/k", files)
        self.assertNotIn("0/air/epsilon", files)

    def test_both_sides_of_cht_interface_are_coupled_with_no_slip(self):
        files = cfd.prepare_case(request())["files"]
        for region, other, method in (("air", "solid", "fluidThermo"), ("solid", "air", "solidThermo")):
            body = patch_body(files[f"0/{region}/T"], f"{region}_to_{other}")
            self.assertIn("compressible::turbulentTemperatureCoupledBaffleMixed", body)
            self.assertIn(f"kappaMethod {method};", body)
            self.assertIn("Tnbr T;", body)
        self.assertEqual(uniform_vector(patch_body(files["0/air/U"], "air_to_solid")), (0, 0, 0))
        self.assertIn("type fixedFluxPressure;", patch_body(files["0/air/p_rgh"], "air_to_solid"))

    def test_outlet_uses_absolute_static_pressure_and_hydrostatic_prgh(self):
        payload = request()
        payload["scenario"]["openings"][1]["gaugePressurePa"] = 3.5
        files = cfd.prepare_case(payload)["files"]
        body = patch_body(files["0/air/p_rgh"], "opening_001")
        self.assertIn("type prghPressure;", body)
        self.assertIn("rho rho;", body)
        self.assertEqual(uniform_scalar(body, "p"), 101328.5)
        self.assertNotEqual(uniform_scalar(body, "p"), 3.5)
        self.assertIn("value 0;", files["constant/air/hRef"])
        self.assertIn("pRefValue 101325;", files["system/air/fvSolution"])
        self.assertIn("type calculated;", patch_body(files["0/air/p"], "opening_001"))
        temperature = patch_body(files["0/air/T"], "opening_001")
        self.assertIn("type inletOutlet;", temperature)
        self.assertEqual(uniform_scalar(temperature, "inletValue"), 299.15)
        self.assertIn("type pressureInletOutletVelocity;", patch_body(files["0/air/U"], "opening_001"))

    def test_closed_inner_face_and_solid_reveal_temperatures_are_distinct(self):
        prepared = cfd.prepare_case(request())
        files = prepared["files"]
        self.assertEqual(uniform_scalar(patch_body(files["0/air/T"], "closed_002")), 297.15)
        self.assertEqual(uniform_scalar(patch_body(files["0/solid/T"], "reveal_002")), 293.15)
        self.assertEqual(uniform_scalar(patch_body(files["0/solid/T"], "outer_E")), 293.15)
        self.assertNotIn("closed_002", files["0/solid/T"])
        self.assertNotIn("reveal_002", files["0/air/T"])
        self.assertEqual(prepared["manifest"]["openings"][2]["boundaryLocation"], "inner-wall-face")

    def test_unknown_adjacency_is_an_explicit_truncated_boundary_not_outdoor_or_ach(self):
        payload = request()
        known = cfd.prepare_case(payload)
        for opening in payload["geometry"]["openings"]:
            opening["adjacent"] = "unknown"
        unknown = cfd.prepare_case(payload)
        self.assertEqual(unknown["files"], known["files"])
        self.assertEqual(unknown["manifest"]["geometry"], payload["geometry"])
        self.assertEqual(unknown["manifest"]["scenario"], payload["scenario"])
        self.assertTrue(all(opening["adjacent"] == "unknown" for opening in unknown["manifest"]["openings"]))
        self.assertEqual(unknown["manifest"]["openings"][0]["mode"], "inlet")
        self.assertEqual(unknown["manifest"]["openings"][1]["mode"], "outlet")
        self.assertIn("type fixedValue;", patch_body(unknown["files"]["0/air/U"], "opening_000"))
        self.assertIn("type prghPressure;", patch_body(unknown["files"]["0/air/p_rgh"], "opening_001"))
        self.assertTrue(any(
            "explicit truncated prescribed boundary" in limitation
            and "Unknown adjacency never supplies outdoor-air or ACH evidence" in limitation
            for limitation in unknown["manifest"]["limitations"]
        ))
        self.assertFalse(any(
            type(key) is str and ("ach" in key.lower() or "outsideinflow" in key.lower())
            for path, _ in walk(unknown["manifest"]) for key in path[-1:]
        ))

    def test_fixed_timestep_courant_abort_and_ascii_probe_contract(self):
        prepared = cfd.prepare_case(request())
        text = prepared["files"]["system/controlDict"]
        self.assertIn("adjustTimeStep no;", text)
        self.assertIn("errors strict;", text)
        self.assertIn("satisfiedAction abort;", text)
        self.assertIn('fields ("max(Co)");', text)
        self.assertIn("functionObject courantExtrema;", text)
        self.assertLess(text.index("    courant\n"), text.index("    courantExtrema\n"))
        self.assertLess(text.index("    courantExtrema\n"), text.index("    courantLimit\n"))
        self.assertIn("writeFormat ascii;", text)
        self.assertIn("fields (U T p);", text)
        self.assertIn("interpolationScheme cell;", text)
        self.assertIn("includeOutOfBounds true;", text)
        self.assertIn("sampleOnExecute false;", text)
        self.assertEqual(set(re.findall(r'libs\s+\("([^"]+)"\)', text)),
                         {"libsampling.so", "libfieldFunctionObjects.so", "libutilityFunctionObjects.so"})
        self.assertEqual(prepared["manifest"]["probeOutputDirectory"], "postProcessing/probes/air/0")
        self.assertEqual(prepared["manifest"]["numerics"]["maxRuntimeSeconds"], 120)

    def test_probe_locations_are_full_room_row_major_centres_at_the_requested_height(self):
        prepared = cfd.prepare_case(request())
        probes = prepared["manifest"]["probeLocations"]
        self.assertEqual(len(probes), 24)
        self.assertEqual(probes[0], {"x": 0.25, "y": 1.75, "z": 1.1})
        self.assertEqual(probes[5], {"x": 2.75, "y": 1.75, "z": 1.1})
        self.assertEqual(probes[-1], {"x": 2.75, "y": 0.25, "z": 1.1})
        for probe in probes:
            self.assertTrue(0 < probe["x"] < 3 and 0 < probe["y"] < 2 and 0 < probe["z"] < 2.5)
        declared = [
            tuple(map(float, text.split()))
            for text in re.findall(r"\(([^()]*)\)", list_section(prepared["files"]["system/controlDict"], "probeLocations"))
        ]
        self.assertEqual(declared, [(p["x"], p["y"], p["z"]) for p in probes])


class GeometryAndTopologyTests(unittest.TestCase):
    def assert_topology(self, prepared):
        vertices, blocks, patches = mesh_data(prepared)
        self.assertTrue(vertices and blocks and patches)
        manifest_mesh = prepared["manifest"]["mesh"]
        self.assertEqual((len(vertices), len(blocks)), (manifest_mesh["vertices"], manifest_mesh["blocks"]))
        self.assertEqual(len(vertices), len(set(vertices)))
        incidence = {}
        volumes = {"air": [], "solid": []}
        cell_counts = {"air": 0, "solid": 0}
        # An independent face ordering, not imported from the compiler.
        faces = ((0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4),
                 (3, 7, 6, 2), (0, 3, 2, 1), (4, 5, 6, 7))
        for owner, block in enumerate(blocks):
            ids, region, counts = block["vertices"], block["region"], block["counts"]
            points = [vertices[index] for index in ids]
            determinant = dot(subtract(points[1], points[0]),
                              cross(subtract(points[3], points[0]), subtract(points[4], points[0])))
            self.assertGreater(determinant, 0)
            volumes[region].append(determinant)
            cell_counts[region] += math.prod(counts)
            self.assertTrue(all(type(count) is int and count >= 1 for count in counts))
            for index, face in enumerate(faces):
                face = tuple(ids[corner] for corner in face)
                normal = face_normal(vertices, face)
                self.assertGreater(dot(normal, subtract(centre([vertices[v] for v in face]), centre(points))), 0)
                normal_axis = index // 2
                tangential_counts = tuple(counts[axis] for axis in range(3) if axis != normal_axis)
                incidence.setdefault(tuple(sorted(face)), []).append((owner, face, tangential_counts))
        boundary = {}
        for name, patch_data in patches.items():
            self.assertTrue(patch_data["faces"])
            fine_faces = 0
            for face in patch_data["faces"]:
                key = tuple(sorted(face))
                self.assertNotIn(key, boundary, "No boundary face may be assigned twice.")
                self.assertEqual(len(incidence[key]), 1)
                self.assertEqual(face, incidence[key][0][1])
                fine_faces += math.prod(incidence[key][0][2])
                boundary[key] = name
            manifest_patch = next(p for p in manifest_mesh["boundaryPatches"] if p["name"] == name)
            self.assertEqual(fine_faces, manifest_patch["faces"])
        region_neighbors = {index: set() for index in range(len(blocks))}
        interface_faces = 0
        for key, owners in incidence.items():
            self.assertIn(len(owners), (1, 2))
            if len(owners) == 1:
                self.assertIn(key, boundary, "All exposed faces must have a named patch.")
                continue
            self.assertNotIn(key, boundary, "Internal faces must not be boundary patches.")
            a, b = owners
            reversed_a = tuple(reversed(a[1]))
            self.assertTrue(any(b[1] == reversed_a[shift:] + reversed_a[:shift] for shift in range(4)))
            self.assertEqual(a[2], b[2], "Shared faces must have identical tangential cell divisions.")
            if blocks[a[0]]["region"] == blocks[b[0]]["region"]:
                region_neighbors[a[0]].add(b[0])
                region_neighbors[b[0]].add(a[0])
            else:
                interface_faces += math.prod(a[2])
        for region in ("air", "solid"):
            members = {i for i, block in enumerate(blocks) if block["region"] == region}
            visited = set()
            pending = [min(members)]
            while pending:
                index = pending.pop()
                if index not in visited:
                    visited.add(index)
                    pending.extend(region_neighbors[index] - visited)
            self.assertEqual(visited, members, "Each cell zone must be a connected region.")
            self.assertEqual(cell_counts[region], manifest_mesh[f"{region}Cells"])
            self.assertAlmostEqual(math.fsum(volumes[region]), manifest_mesh["volumesM3"][region], places=11)
        self.assertEqual(sum(cell_counts.values()), manifest_mesh["cells"])
        self.assertEqual(interface_faces, manifest_mesh["interface"]["facesPerSide"])
        self.assertGreater(interface_faces, 0)
        return vertices, blocks, patches

    def test_mesh_face_incidence_orientation_conformity_and_regions(self):
        self.assert_topology(cfd.prepare_case(request()))

    def test_fractional_room_and_wall_dimensions_are_not_rounded_or_replaced_by_carpet(self):
        payload = fractional_request()
        before = copy.deepcopy(payload)
        prepared = cfd.prepare_case(payload)
        vertices, _, _ = self.assert_topology(prepared)
        self.assertEqual(payload, before)
        self.assertEqual(prepared["manifest"]["geometry"], payload["geometry"])
        for axis, dimension in enumerate((
            payload["geometry"]["rect"]["w"], payload["geometry"]["rect"]["h"], payload["geometry"]["heightM"],
        )):
            self.assertIn(dimension, {point[axis] for point in vertices})
        layers = prepared["manifest"]["mesh"]["layers"]
        for wall in payload["geometry"]["walls"]:
            self.assertEqual(layers[wall["side"]]["thicknessM"], wall["thicknessM"])
        self.assertNotEqual(layers["N"]["thicknessM"], 0.2)
        self.assertEqual(
            prepared["manifest"]["mesh"]["volumesM3"]["roomAir"],
            payload["geometry"]["rect"]["w"] * payload["geometry"]["rect"]["h"] * payload["geometry"]["heightM"],
        )

    def test_roundoff_alignment_pins_enclosure_planes_and_rejects_real_slivers(self):
        payload = fractional_request()
        payload["geometry"]["openings"][2]["offsetM"] = 1e-13
        payload["geometry"]["openings"][0]["widthM"] = (
            payload["geometry"]["rect"]["w"] - payload["geometry"]["openings"][0]["offsetM"] + 5e-13
        )
        prepared = cfd.prepare_case(payload)
        vertices, _, _ = self.assert_topology(prepared)
        self.assertIn(payload["geometry"]["rect"]["h"], {point[1] for point in vertices})
        self.assertIn(payload["geometry"]["rect"]["w"], {point[0] for point in vertices})
        self.assertEqual(prepared["manifest"]["geometry"], payload["geometry"])
        self.assertGreater(prepared["manifest"]["mesh"]["maximumFeatureAlignmentM"], 0)
        self.assertLessEqual(
            prepared["manifest"]["mesh"]["maximumFeatureAlignmentM"],
            prepared["manifest"]["mesh"]["geometryAlignmentToleranceM"],
        )
        payload = request()
        payload["geometry"]["openings"][1]["offsetM"] = 0.5 + 1e-7
        with self.assertRaises(cfd.CfdInputError) as caught:
            cfd.prepare_case(payload)
        self.assertEqual(caught.exception.code, "unsupported_feature")

    def test_profile_minimum_room_dimension_keeps_a_roundoff_fractional_value(self):
        payload = sealed_request()
        payload["geometry"]["rect"]["w"] = 0.1999999999999
        payload["geometry"]["sourceRoomRect"]["w"] = 0.1999999999999
        prepared = cfd.prepare_case(payload)
        vertices, _, _ = self.assert_topology(prepared)
        self.assertIn(0.1999999999999, {point[0] for point in vertices})
        self.assertEqual(prepared["manifest"]["geometry"], payload["geometry"])

    def test_site_coordinate_precision_alignment_reports_meshed_area_and_volume(self):
        payload = fractional_request()
        payload["geometry"]["rect"]["x"] = 999999.125
        first, second = payload["geometry"]["openings"][:2]
        second["offsetM"] = first["offsetM"] + first["widthM"] + 2e-9
        prepared = cfd.prepare_case(payload)
        vertices, _, patches = self.assert_topology(prepared)
        mesh = prepared["manifest"]["mesh"]
        self.assertGreater(mesh["maximumFeatureAlignmentM"], 1e-9)
        self.assertLessEqual(mesh["maximumFeatureAlignmentM"], mesh["geometryAlignmentToleranceM"])
        self.assertEqual(prepared["manifest"]["geometry"], payload["geometry"])
        for opening in prepared["manifest"]["openings"]:
            area = sum(face_area(vertices, face) for face in patches[opening["patch"]]["faces"])
            self.assertAlmostEqual(area, opening["meshedAreaM2"], places=12)
        self.assertAlmostEqual(
            mesh["volumesM3"]["air"] + mesh["volumesM3"]["solid"] + mesh["volumesM3"]["excludedClosedSleeves"],
            mesh["volumesM3"]["outerBox"], places=11,
        )

    def test_all_closed_and_no_opening_meshes_are_connected_and_complete(self):
        for payload in (closed_request(), sealed_request()):
            with self.subTest(openings=len(payload["geometry"]["openings"])):
                prepared = cfd.prepare_case(payload)
                self.assert_topology(prepared)
                self.assertEqual(prepared["manifest"]["mesh"]["volumesM3"]["air"], 15)
                self.assertEqual(prepared["manifest"]["mesh"]["volumesM3"]["openSleeveAir"], 0)

    def test_corner_partition_actual_opening_area_and_volume_bookkeeping(self):
        payload = request()
        prepared = cfd.prepare_case(payload)
        vertices, _, patches = self.assert_topology(prepared)
        mesh = prepared["manifest"]["mesh"]
        self.assertAlmostEqual(mesh["volumesM3"]["outerBox"], 3.35 * 2.45 * 2.9)
        self.assertAlmostEqual(mesh["volumesM3"]["openSleeveAir"], 0.5 * 1 * 0.2 + 0.75 * 2 * 0.25)
        self.assertAlmostEqual(mesh["volumesM3"]["excludedClosedSleeves"], 0.5 * 0.5 * 0.15)
        self.assertAlmostEqual(sum(mesh["solidVolumeByEnvelopePartM3"].values()), mesh["volumesM3"]["solid"])
        self.assertAlmostEqual(mesh["volumesM3"]["air"] + mesh["volumesM3"]["solid"] +
                               mesh["volumesM3"]["excludedClosedSleeves"], mesh["volumesM3"]["outerBox"])
        for opening in prepared["manifest"]["openings"]:
            area = sum(face_area(vertices, face) for face in patches[opening["patch"]]["faces"])
            source = next(o for o in payload["geometry"]["openings"] if o["id"] == opening["id"])
            self.assertAlmostEqual(area, source["widthM"] * source["heightM"])
            self.assertEqual(opening["geometricAreaM2"], source["widthM"] * source["heightM"])
            self.assertEqual(opening["operatingAreaM2"], source["widthM"] * source["heightM"] * source["openFraction"])
        reveal_area = sum(face_area(vertices, face) for face in patches["reveal_002"]["faces"])
        self.assertAlmostEqual(reveal_area, 2 * (0.5 + 0.5) * 0.15)

    def test_opening_sleeves_extend_through_actual_thickness_not_zero_depth_ports(self):
        prepared = cfd.prepare_case(request())
        vertices, blocks, patches = mesh_data(prepared)
        for face in patches["opening_000"]["faces"]:
            self.assertTrue(all(math.isclose(vertices[index][1], 2.2) for index in face))
        for face in patches["opening_001"]["faces"]:
            self.assertTrue(all(math.isclose(vertices[index][1], -0.25) for index in face))
        for face in patches["closed_002"]["faces"]:
            self.assertTrue(all(math.isclose(vertices[index][0], 3) for index in face))
        for block in blocks:
            midpoint = centre([vertices[index] for index in block["vertices"]])
            in_closed_sleeve = 3 < midpoint[0] < 3.15 and 1 < midpoint[1] < 1.5 and 1 < midpoint[2] < 1.5
            self.assertFalse(in_closed_sleeve, "Closed sleeves must have neither invented air nor solid.")

    def test_layer_counts_and_actual_spacings_are_explicit_without_coarsening(self):
        payload = request()
        prepared = cfd.prepare_case(payload)
        mesh = prepared["manifest"]["mesh"]
        self.assertEqual(mesh["selectedSpacingM"], 0.25)
        for side, thickness in (("N", 0.2), ("E", 0.15), ("S", 0.25), ("W", 0.2),
                                ("floor", 0.2), ("ceiling", 0.2)):
            layer = mesh["layers"][side]
            self.assertEqual(layer["cells"], 2)
            self.assertAlmostEqual(layer["actualSpacingM"], thickness / 2)
        for axis in mesh["axes"].values():
            self.assertEqual(len(axis["breakpointsM"]) - 1, len(axis["cellsPerInterval"]))
            for count, spacing, left, right in zip(
                axis["cellsPerInterval"], axis["spacingPerIntervalM"],
                axis["breakpointsM"], axis["breakpointsM"][1:],
            ):
                self.assertLessEqual(spacing, 0.25 + 1e-12)
                self.assertAlmostEqual(count * spacing, right - left)
        payload["scenario"]["numerics"]["solidCells"] = 4
        refined = cfd.prepare_case(payload)
        self.assertTrue(all(layer["cells"] >= 4 for layer in refined["manifest"]["mesh"]["layers"].values()))
        self.assertGreater(refined["manifest"]["mesh"]["cells"], mesh["cells"])
        self.assert_topology(refined)

    def test_zero_sill_full_height_full_width_and_corner_meeting_apertures(self):
        payload = sealed_request()
        payload["scenario"]["numerics"]["spacingM"] = 0.5
        for index, side in enumerate(("N", "E", "S", "W")):
            payload["geometry"]["openings"].append({
                "id": f"whole-{side}", "wallId": f"synthetic-wall-{side}", "side": side,
                "offsetM": 0, "widthM": 3 if side in ("N", "S") else 2,
                "sillM": 0, "heightM": 2.5, "openFraction": 0,
                "kind": "synthetic-full-face", "adjacent": "unknown",
            })
            payload["scenario"]["openings"].append({
                "id": f"whole-{side}", "mode": "closed", "temperatureC": 20 + index,
                "speedMps": None, "gaugePressurePa": None,
            })
        self.assert_topology(cfd.prepare_case(payload))
        payload["geometry"]["openings"][0]["openFraction"] = 1
        payload["geometry"]["openings"][2]["openFraction"] = 1
        payload["scenario"]["openings"][0].update(mode="inlet", speedMps=0.05)
        payload["scenario"]["openings"][2].update(mode="outlet", gaugePressurePa=0)
        self.assert_topology(cfd.prepare_case(payload))

    def test_fully_removed_nominal_wall_face_has_no_negative_roundoff_volume(self):
        payload = sealed_request()
        payload["geometry"]["rect"]["w"] = 3.5
        payload["geometry"]["heightM"] = 2.4
        payload["geometry"]["walls"][0]["thicknessM"] = 0.1
        payload["geometry"]["openings"] = [{
            "id": "full-face", "wallId": "synthetic-wall-N", "side": "N",
            "offsetM": 0, "widthM": 3.5, "sillM": 0, "heightM": 2.4,
            "openFraction": 0, "kind": "synthetic-full-face", "adjacent": "unknown",
        }]
        payload["scenario"]["openings"] = [{
            "id": "full-face", "mode": "closed", "temperatureC": 25,
            "speedMps": None, "gaugePressurePa": None,
        }]
        prepared = cfd.prepare_case(payload)
        self.assertEqual(prepared["manifest"]["mesh"]["solidVolumeByEnvelopePartM3"]["N"], 0)
        self.assertTrue(all(value >= 0 for value in prepared["manifest"]["mesh"]["solidVolumeByEnvelopePartM3"].values()))
        self.assert_topology(prepared)

    def test_varied_synthetic_boxes_apertures_and_shells_preserve_topology(self):
        rng = random.Random(0xCFD2606)
        for sample in range(16):
            with self.subTest(sample=sample):
                payload = sealed_request()
                width, depth = rng.randint(4, 12) / 4, rng.randint(4, 12) / 4
                height = rng.randint(6, 14) / 4
                payload["geometry"]["rect"].update(w=width, h=depth)
                payload["geometry"]["heightM"] = height
                payload["scenario"]["sampling"]["heightM"] = height / 2
                payload["scenario"]["numerics"].update(deltaTSeconds=0.025, endTimeSeconds=0.1, writeIntervalSeconds=0.05)
                payload["scenario"]["floorThicknessM"] = rng.choice((0.125, 0.25, 0.375))
                payload["scenario"]["ceilingThicknessM"] = rng.choice((0.125, 0.25, 0.375))
                for wall in payload["geometry"]["walls"]:
                    wall["thicknessM"] = rng.choice((0.125, 0.25, 0.375))
                    side = wall["side"]
                    length_cells = int((width if side in ("N", "S") else depth) * 4)
                    start = rng.randrange(length_cells)
                    end = rng.randint(start + 1, length_cells)
                    sill = rng.randrange(int(height * 4))
                    top = rng.randint(sill + 1, int(height * 4))
                    mode = "inlet" if side == "N" else "outlet" if side == "S" else rng.choice(("closed", "outlet"))
                    identity = f"varied-{side}"
                    payload["geometry"]["openings"].append({
                        "id": identity, "wallId": f"synthetic-wall-{side}", "side": side,
                        "offsetM": start / 4, "widthM": (end - start) / 4,
                        "sillM": sill / 4, "heightM": (top - sill) / 4,
                        "openFraction": 0 if mode == "closed" else 1,
                        "kind": "synthetic-aperture", "adjacent": "unknown",
                    })
                    payload["scenario"]["openings"].append({
                        "id": identity, "mode": mode, "temperatureC": 25,
                        "speedMps": 0.02 if mode == "inlet" else None,
                        "gaugePressurePa": 0 if mode == "outlet" else None,
                    })
                self.assert_topology(cfd.prepare_case(payload))

    def test_all_side_offset_mappings_and_inlet_normals(self):
        opposite = {"N": "S", "S": "N", "E": "W", "W": "E"}
        velocities = {"N": (0, -0.08, 0), "S": (0, 0.08, 0), "E": (-0.08, 0, 0), "W": (0.08, 0, 0)}
        for side in ("N", "E", "S", "W"):
            with self.subTest(side=side):
                payload = request()
                payload["geometry"]["openings"] = payload["geometry"]["openings"][:2]
                payload["scenario"]["openings"] = payload["scenario"]["openings"][:2]
                payload["geometry"]["openings"][0].update(side=side, wallId=f"synthetic-wall-{side}")
                payload["geometry"]["openings"][1].update(
                    side=opposite[side], wallId=f"synthetic-wall-{opposite[side]}",
                    offsetM=0.5, widthM=0.5,
                )
                prepared = cfd.prepare_case(payload)
                self.assert_topology(prepared)
                self.assertEqual(uniform_vector(patch_body(prepared["files"]["0/air/U"], "opening_000")), velocities[side])
                bounds = prepared["manifest"]["openings"][0]["sleeveBoundsM"]
                if side in ("N", "S"):
                    self.assertEqual((bounds["min"]["x"], bounds["max"]["x"]), (0.5, 1))
                else:
                    self.assertEqual((bounds["min"]["y"], bounds["max"]["y"]), (1, 1.5))

    def test_site_origin_heading_up_and_gravity_are_applied_exactly_once(self):
        for heading in (0, 30, 90, 180, 270, -90, 360):
            with self.subTest(heading=heading):
                payload = request()
                payload["geometry"]["headingDeg"] = heading
                manifest = cfd.prepare_case(payload)["manifest"]
                mapping = manifest["coordinateMapping"]
                self.assertEqual(mapping["originSiteM"], {"x": 1.25, "y": 4.5, "z": 3.25})
                rotation = mapping["engineToENUMatrix"]
                self.assertAlmostEqual(dot(rotation[0], cross(rotation[1], rotation[2])), 1)
                probe = manifest["probeLocations"][0]
                vector = (probe["x"], probe["y"], probe["z"])
                translation = mapping["engineToENUTranslationM"]
                actual = [dot(row, vector) + translation[name] for row, name in zip(rotation, ("east", "north", "up"))]
                angle = math.radians(heading)
                site_x, site_y = 1.25 + probe["x"], 4.5 - probe["y"]
                expected = (
                    site_x * math.cos(angle) - site_y * math.sin(angle),
                    -site_x * math.sin(angle) - site_y * math.cos(angle),
                    3.25 + probe["z"],
                )
                for a, b in zip(actual, expected):
                    self.assertAlmostEqual(a, b)
                self.assertEqual(manifest["gravityMps2"], {"x": 0, "y": 0, "z": -9.80665})
                self.assertEqual(manifest["receiverHeightM"], 1.1)

    def test_source_room_rect_and_site_transforms_do_not_replace_the_inner_enclosure(self):
        payload = request()
        first = cfd.prepare_case(payload)
        payload["geometry"]["sourceRoomRect"].update(x=20, y=30, w=10, h=10)
        payload["geometry"]["rect"].update(x=200, y=300)
        payload["geometry"].update(headingDeg=90, floorElevationM=40)
        second = cfd.prepare_case(payload)
        self.assertEqual(first["files"], second["files"])
        self.assertEqual(second["manifest"]["mesh"]["volumesM3"]["roomAir"], 15)
        self.assertEqual(second["manifest"]["geometry"]["sourceRoomRect"], payload["geometry"]["sourceRoomRect"])
        self.assertEqual(second["manifest"]["coordinateMapping"]["originSiteM"], {"x": 200, "y": 302, "z": 40})
        self.assertNotEqual(first["manifest"]["caseHash"], second["manifest"]["caseHash"])


@unittest.skipUnless(
    os.environ.get("HOMEPLANNER_CFD_SMOKE") == "1",
    "Missing OpenCFD OpenFOAM v2606 runtime: real-engine smoke is opt-in and was not run.",
)
class ActualEngineSmokeTests(unittest.TestCase):
    def test_local_v2606_meshing_regions_solver_and_finite_probes(self):
        tools = ("foamVersion", "blockMesh", "splitMeshRegions", "checkMesh", "chtMultiRegionFoam")
        missing = [tool for tool in tools if shutil.which(tool) is None]
        if missing:
            self.skipTest("Missing OpenCFD OpenFOAM v2606 runtime tools: " + ", ".join(missing))
        version = subprocess.run(["foamVersion"], check=True, capture_output=True, text=True, timeout=10)
        self.assertRegex(version.stdout.strip(), r"(?:^|\b)(?:OpenFOAM-)?v?2606(?:\b|$)")
        # This opt-in test writes only its own new, disposable synthetic fixture
        # directory below the repository, never a user's case or a system temp dir.
        directory = Path("tests") / "fixtures" / ("cfd-smoke-" + uuid.uuid4().hex)
        directory.mkdir()
        try:
            for name, payload in (("open", request()), ("closed", closed_request())):
                payload["scenario"]["numerics"].update(endTimeSeconds=0.1, writeIntervalSeconds=0.05)
                prepared = cfd.prepare_case(payload)
                case = directory / name
                case.mkdir()
                for relative, text in prepared["files"].items():
                    target = case.joinpath(*PurePosixPath(relative).parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(text, encoding="utf-8")
                deadline = time.monotonic() + payload["scenario"]["numerics"]["maxRuntimeSeconds"]
                for command in prepared["manifest"]["commands"]:
                    remaining = deadline - time.monotonic()
                    self.assertGreater(remaining, 0, "Whole command-sequence wall-clock budget exhausted.")
                    result = subprocess.run(command, cwd=case, check=True, capture_output=True, text=True, timeout=remaining)
                    if command[0] == "checkMesh":
                        self.assertIn("Mesh OK", result.stdout)
                output = case.joinpath(*PurePosixPath(prepared["manifest"]["probeOutputDirectory"]).parts)
                for field in ("U", "T", "p"):
                    lines = [line for line in (output / field).read_text(encoding="utf-8").splitlines()
                             if line.strip() and not line.lstrip().startswith("#")]
                    self.assertTrue(lines, field)
                    values = [float(token) for token in lines[-1].replace("(", " ").replace(")", " ").split()]
                    count = len(prepared["manifest"]["probeLocations"])
                    self.assertEqual(len(values), 1 + count * (3 if field == "U" else 1))
                    self.assertTrue(all(math.isfinite(value) for value in values))
                    self.assertAlmostEqual(values[0], 0.1)
        finally:
            shutil.rmtree(directory)


if __name__ == "__main__":
    unittest.main()
