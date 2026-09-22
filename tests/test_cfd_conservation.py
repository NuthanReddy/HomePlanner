"""Manufactured integral files test accounting, not a CFD solver or a building."""
import copy
import unittest
from unittest.mock import patch

import cfd_case
import cfd_conservation as conservation
import cfd_results
from tests.test_cfd_case import request, sealed_request
from tests.test_cfd_runtime import OwnedFixtureTest


def prepared_case(*, sealed=False, end=3):
    payload = sealed_request() if sealed else request()
    for row in payload["scenario"]["openings"]:
        if row["mode"] == "inlet":
            row.update(mode="outlet", speedMps=None, gaugePressurePa=0)
    payload["scenario"]["numerics"].update(deltaTSeconds=1, endTimeSeconds=end, writeIntervalSeconds=1)
    return cfd_case.prepare_case(payload)


def table(descriptor, rows):
    lines = ["# Synthetic integral-accounting fixture, not engine output"]
    if descriptor["weight"]:
        lines.append("# Weight field : " + descriptor["weight"])
    lines.append("# Time " + " ".join(f'{descriptor["operation"]}({field})' for field in descriptor["fields"]))
    for time, values in rows:
        tokens = [format(time, ".17g")]
        for value in values:
            tokens.append("(" + " ".join(format(v, ".17g") for v in value) + ")" if isinstance(value, tuple)
                          else format(value, ".17g"))
        lines.append(" ".join(tokens))
    return ("\n".join(lines) + "\n").encode("ascii")


def manufactured_tables(manifest, *, initial=False):
    contract = manifest["conservation"]
    end = int(contract["endTimeSeconds"])
    times = list(range(0 if initial else 1, end + 1))
    open_ports = bool(contract["patchGroups"]["airOpen"])
    closed = bool(contract["patchGroups"]["airClosed"])
    external = (2 if open_ports else 0) + (3 if closed else 0)
    adv, pdot, gravity_work = (6, 4, 5) if open_ports else (0, 0, 0)
    growth = external + 7 + pdot + gravity_work - adv
    rho = contract["solidDensityKgM3"]
    rows = {}
    for name, descriptor in contract["series"].items():
        values = []
        for time in times:
            data = {
                "cfdAirExtensive": [10 - (.2 * time if open_ports else 0), 500 + pdot * time, pdot],
                "cfdAirEnergy": [100 + (growth - 1) * time, 1 + time,
                                 (0, 0, -gravity_work / 9.80665)],
                "cfdSolidEnergy": [(50 - 5 * time) / rho],
                "cfdMassFlux": [.2 if open_ports else 0],
                "cfdAdvectiveFlux": [8, -2] if open_ports else [0, 0],
                "cfdAirInterfaceHeat": [7],
                "cfdSolidInterfaceHeat": [-7],
                "cfdSolidExternalHeat": [2],
                "cfdAirClosedHeat": [3],
                "cfdAirOpenGradient": [(2 / contract["airConductivityWmK"], 0, 0)],
            }[name]
            values.append([time, data])
        rows[name] = values
    return rows


def encoded_tables(manifest, rows):
    return {descriptor["path"]: table(descriptor, rows[name])
            for name, descriptor in manifest["conservation"]["series"].items()}


def read(manifest, rows):
    data = encoded_tables(manifest, rows)
    return conservation.read_conservation(manifest, lambda name, _: data[name])


class IntegralAccountingTests(unittest.TestCase):
    def setUp(self):
        self.manifest = prepared_case()["manifest"]
        self.rows = manufactured_tables(self.manifest)

    def test_mass_pressure_work_gravity_kinetic_and_open_patch_conduction_balance(self):
        output = read(self.manifest, self.rows)
        self.assertEqual(output["conservation"]["status"], "computed-unvalidated")
        self.assertEqual(output["conservation"]["coverage"], {
            "startSeconds": 1, "endSeconds": 3, "intervals": 2,
            "includesInitialState": False, "integration": "right-endpoint, every fixed Euler step",
        })
        mass, energy = output["massBalance"], output["energyBalance"]
        self.assertAlmostEqual(mass["storedChangeKg"], -.4)
        self.assertAlmostEqual(mass["netOutflowKg"], .4)
        self.assertAlmostEqual(mass["maxAbsStepResidualKg"], 0)
        self.assertAlmostEqual(energy["fluid"]["netAdvectiveOutflowJ"], 12)
        self.assertAlmostEqual(energy["fluid"]["pressureWorkInputJ"], 8)
        self.assertAlmostEqual(energy["fluid"]["gravityWorkInputJ"], 10)
        self.assertAlmostEqual(energy["fluid"]["externalHeatInputJ"], 10)
        self.assertAlmostEqual(energy["fluid"]["interfaceHeatInputJ"], 14)
        self.assertAlmostEqual(energy["solid"]["externalHeatInputJ"], 4)
        self.assertAlmostEqual(energy["solid"]["interfaceHeatInputJ"], -14)
        for region in ("fluid", "solid", "combinedExternal"):
            self.assertAlmostEqual(energy[region]["residualJ"], 0)
            self.assertAlmostEqual(energy[region]["maxAbsStepResidualJ"], 0)
        self.assertAlmostEqual(energy["interface"]["maxAbsMismatchW"], 0)
        self.assertNotIn("passed", str(output))

    def test_actual_initial_rows_are_used_but_no_analytic_initial_state_is_fabricated(self):
        rows = manufactured_tables(self.manifest, initial=True)
        output = read(self.manifest, rows)
        self.assertEqual(output["conservation"]["coverage"]["startSeconds"], 0)
        self.assertTrue(output["conservation"]["coverage"]["includesInitialState"])
        self.assertAlmostEqual(output["massBalance"]["netOutflowKg"], .6)
        one = prepared_case(end=1)["manifest"]
        output = read(one, manufactured_tables(one))
        self.assertEqual(output["massBalance"]["status"], "insufficient-history")
        self.assertNotIn("residualKg", output["massBalance"])
        self.assertEqual(output["energyBalance"]["status"], "insufficient-history")

    def test_local_energy_errors_do_not_disappear_when_the_combined_residual_cancels(self):
        self.rows["cfdAirEnergy"][-1][1][0] += 4
        rho = self.manifest["conservation"]["solidDensityKgM3"]
        self.rows["cfdSolidEnergy"][-1][1][0] -= 4 / rho
        energy = read(self.manifest, self.rows)["energyBalance"]
        self.assertAlmostEqual(energy["combinedExternal"]["residualJ"], 0)
        self.assertAlmostEqual(energy["fluid"]["maxAbsStepResidualJ"], 4)
        self.assertAlmostEqual(energy["solid"]["maxAbsStepResidualJ"], 4)

    def test_interface_power_is_independent_evidence_not_assumed_equal_and_opposite(self):
        for row in self.rows["cfdSolidInterfaceHeat"]:
            row[1][0] = -6
        energy = read(self.manifest, self.rows)["energyBalance"]
        self.assertAlmostEqual(energy["interface"]["signedMismatchJ"], 2)
        self.assertAlmostEqual(energy["interface"]["maxAbsMismatchW"], 1)
        self.assertAlmostEqual(energy["solid"]["residualJ"], -2)
        self.assertAlmostEqual(energy["combinedExternal"]["residualJ"], 0)
        self.assertAlmostEqual(energy["combinedExternal"]["regionalResidualSumJ"], -2)

    def test_mass_residual_and_rate_retain_the_sign_and_worst_interval(self):
        self.rows["cfdAirExtensive"][-1][1][0] += .5
        output = read(self.manifest, self.rows)["massBalance"]
        self.assertAlmostEqual(output["residualKg"], .5)
        self.assertAlmostEqual(output["maxAbsStepResidualKgS"], .5)
        self.assertEqual(output["worstInterval"]["startSeconds"], 2)
        self.assertAlmostEqual(output["worstInterval"]["residualKg"], .5)

    def test_constant_enthalpy_reference_shift_does_not_force_positive_energy(self):
        for row in self.rows["cfdSolidEnergy"]:
            row[1][0] -= 100000
        output = read(self.manifest, self.rows)
        self.assertAlmostEqual(output["energyBalance"]["solid"]["storedChangeJ"], -10, places=5)
        self.assertAlmostEqual(output["energyBalance"]["solid"]["residualJ"], 0, places=5)

    def test_declared_absence_of_apertures_has_zero_external_air_flux_not_missing_input(self):
        manifest = prepared_case(sealed=True)["manifest"]
        self.assertNotIn("cfdAirOpenGradient", manifest["conservation"]["series"])
        self.assertNotIn("cfdAirClosedHeat", manifest["conservation"]["series"])
        output = read(manifest, manufactured_tables(manifest))
        self.assertEqual(output["energyBalance"]["fluid"]["externalHeatInputJ"], 0)
        self.assertAlmostEqual(output["energyBalance"]["combinedExternal"]["residualJ"], 0)

    def test_old_cases_report_unavailable_and_unknown_or_modified_contracts_are_rejected(self):
        old = copy.deepcopy(self.manifest); del old["conservation"]
        reader = lambda *_: self.fail("Older cases must not search for substitute diagnostic files")
        output = conservation.read_conservation(old, reader)
        self.assertEqual(output["energyBalance"]["status"], "not-evaluated")
        for edit in (
            lambda m: m.update(conservation=None),
            lambda m: m["conservation"].update(version=2),
            lambda m: m["conservation"].update(version=True),
            lambda m: m["conservation"].update(airConductivityWmK=100),
            lambda m: m["conservation"]["series"]["cfdMassFlux"].update(path="../other"),
            lambda m: m["conservation"]["series"].pop("cfdMassFlux"),
        ):
            bad = copy.deepcopy(self.manifest); edit(bad)
            with self.subTest(edit=edit), self.assertRaises(conservation.ConservationError):
                conservation.read_conservation(bad, reader)

    def test_missing_truncated_nonfinite_wrong_weight_or_wrong_sign_operation_files_fail(self):
        encoded = encoded_tables(self.manifest, self.rows)
        name = self.manifest["conservation"]["series"]["cfdAdvectiveFlux"]["path"]
        original = encoded[name]
        for data in (original[:-1], original.replace(b"weightedSum(h)", b"absWeightedSum(h)"),
                     original.replace(b"# Weight field : phi\n", b""),
                     original.replace(b": phi", b": rho"),
                     original.replace(b"1 8 -2", b"1 nan -2"),
                     original.replace(b"1 8 -2", b"1 1e999 -2"),
                     original.replace(b"1 8 -2", b"1 8"),
                     original + b"\x00\n", original + b"# Time weightedSum(h) weightedSum(K)\n"):
            modified = {**encoded, name: data}
            with self.subTest(data=data[-80:]), self.assertRaises(conservation.ConservationError):
                conservation.read_conservation(self.manifest, lambda path, _: modified[path])

    def test_every_timestep_and_every_file_must_have_matching_real_rows(self):
        for edit in (
            lambda rows: rows["cfdMassFlux"].pop(1),
            lambda rows: rows["cfdMassFlux"][1].__setitem__(0, 1),
            lambda rows: rows["cfdMassFlux"][0].__setitem__(0, -1),
            lambda rows: rows["cfdMassFlux"][-1].__setitem__(0, 4),
            lambda rows: rows["cfdMassFlux"].insert(0, [0, [.2]]),
        ):
            altered = copy.deepcopy(self.rows); edit(altered)
            with self.subTest(edit=edit), self.assertRaises(conservation.ConservationError):
                read(self.manifest, altered)

    def test_required_vector_components_and_positive_extensives_are_checked(self):
        for name, index, value in (
            ("cfdAirExtensive", 0, 0), ("cfdAirExtensive", 1, -1),
            ("cfdAirEnergy", 1, -1), ("cfdAirOpenGradient", 0, (1, 1, 0)),
            ("cfdAirEnergy", 2, (0, 0)),
        ):
            rows = copy.deepcopy(self.rows); rows[name][0][1][index] = value
            if name == "cfdAirOpenGradient":
                rows[name][1][1][index] = value
            with self.subTest(name=name, index=index), self.assertRaises(conservation.ConservationError):
                read(self.manifest, rows)

    def test_arithmetic_and_aggregate_file_budgets_fail_explicitly(self):
        rows = copy.deepcopy(self.rows)
        rows["cfdAirEnergy"][1][1][2] = (0, 0, 1e308)
        with self.assertRaises(conservation.ConservationError):
            read(self.manifest, rows)
        with patch.object(conservation, "MAX_TOTAL_BYTES", 50), self.assertRaises(conservation.ConservationError):
            read(self.manifest, self.rows)

    def test_compiler_uses_real_builtins_and_separates_open_patch_diffusion_from_wall_heat(self):
        prepared = prepared_case()
        body = prepared["files"]["system/controlDict"]
        contract = prepared["manifest"]["conservation"]
        self.assertIn("type grad;", body)
        self.assertIn("operation weightedSum;", body)
        self.assertIn("weightField phi;", body)
        self.assertNotIn("absWeightedSum", body)
        self.assertIn("fields (rho p dpdt);", body)
        self.assertIn("fields (h K U);", body)
        self.assertIn("writePrecision 16;", body)
        self.assertIn("writeToFile false;", body)
        self.assertLess(body.index("cfdWallHeatAir"), body.index("cfdAirInterfaceHeat"))
        self.assertLess(body.index("cfdOpenTemperatureGradient"), body.index("cfdAirOpenGradient"))
        self.assertTrue(all(item["path"].startswith(f'postProcessing/{item["region"]}/')
                            for item in contract["series"].values()))
        self.assertEqual(prepared["manifest"]["runtimeVerification"], "pending")


class CompleteResultIntegrationTests(OwnedFixtureTest):
    def test_new_case_requires_integral_files_before_result_publication(self):
        manifest = prepared_case()["manifest"]
        case = self.fixture.joinpath("case")
        evidence = {}
        for stage in ("blockMesh", "splitMeshRegions", "checkMesh-air", "checkMesh-solid", "chtMultiRegionFoam"):
            item = cfd_results.StageEvidence()
            if stage.startswith("checkMesh"):
                item.line("Mesh OK.")
            if stage == "chtMultiRegionFoam":
                item.line("Time = 3")
            item.line("End"); evidence[stage] = item
        probes = case.joinpath(*manifest["probeOutputDirectory"].split("/"))
        probes.mkdir(parents=True)
        for field in ("T", "U", "p"):
            header = [f'# Probe {i} ({point["x"]} {point["y"]} {point["z"]})' for i, point in enumerate(manifest["probeLocations"])]
            header.append("# Time " + " ".join(str(i) for i in range(len(manifest["probeLocations"]))))
            value = "(0 0 0)" if field == "U" else "300" if field == "T" else "101325"
            probes.joinpath(field).write_text("\n".join(header) + "\n3 " + " ".join(value for _ in manifest["probeLocations"]) + "\n", encoding="ascii")
        with self.assertRaises(cfd_results.CfdResultError):
            cfd_results.parse_results(case, manifest, evidence)
        for name, data in encoded_tables(manifest, manufactured_tables(manifest)).items():
            target = case.joinpath(*name.split("/")); target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        output = cfd_results.parse_results(case, manifest, evidence)
        self.assertEqual(output["diagnostics"]["conservation"]["status"], "computed-unvalidated")
        self.assertEqual(output["validationStatus"], "unvalidated")
        self.assertAlmostEqual(output["diagnostics"]["energyBalance"]["combinedExternal"]["residualJ"], 0)
        self.assertEqual(output["source"], manifest["source"])


if __name__ == "__main__":
    unittest.main()
