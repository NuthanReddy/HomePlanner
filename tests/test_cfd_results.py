"""Strict ASCII fixture checks, explicitly not an OpenFOAM validation suite."""
import copy
import math
import os
import unittest

import cfd_results as results
from tests.test_cfd_runtime import OwnedFixtureTest, SYNTHETIC_REQUEST, synthetic_compiler, write_synthetic_probes


def synthetic_evidence(*, continuity=True):
    evidence = {}
    for stage in ("blockMesh", "splitMeshRegions", "checkMesh-air", "checkMesh-solid", "chtMultiRegionFoam"):
        record = results.StageEvidence()
        if stage.startswith("checkMesh-"):
            record.line("Mesh OK.")
        if stage == "chtMultiRegionFoam":
            record.line("Time = 1")
            if continuity:
                record.line("time step continuity errors : sum local = 1e-08, global = -2e-09, cumulative = 3e-09")
        record.line("End")
        evidence[stage] = record
    return evidence


class ProbeFixtureTests(OwnedFixtureTest):
    def setUp(self):
        super().setUp()
        self.case = self.fixture.joinpath("case")
        self.manifest = synthetic_compiler(copy.deepcopy(SYNTHETIC_REQUEST))["manifest"]
        self.probes = write_synthetic_probes(self.case, self.manifest)
        self.evidence = synthetic_evidence()

    def parse(self, **kwargs):
        return results.parse_results(self.case, self.manifest, self.evidence, **kwargs)

    def replace_text(self, name, old, new):
        path = self.probes.joinpath(name)
        path.write_text(path.read_text(encoding="ascii").replace(old, new), encoding="ascii")

    def test_three_fields_keep_exact_coordinates_source_time_and_units(self):
        before = copy.deepcopy(self.manifest)
        result = self.parse()
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["kind"], "CoupledCfdResult")
        self.assertEqual(result["source"], self.manifest["source"])
        self.assertEqual(result["caseHash"], self.manifest["caseHash"])
        self.assertEqual(result["coordinateSpace"], "room-right-front-up")
        self.assertEqual(result["timeSeconds"], 1)
        self.assertEqual(result["receiverHeightM"], 1.1)
        self.assertEqual(result["samples"][1]["positionM"], self.manifest["probeLocations"][1])
        self.assertAlmostEqual(result["samples"][0]["temperatureC"], 300 - 273.15)
        self.assertEqual(result["samples"][1]["velocityMps"], {"x": 0.2, "y": -0.3, "z": 0.4})
        self.assertAlmostEqual(result["samples"][1]["speedMps"], math.sqrt(0.29))
        self.assertEqual(result["samples"][1]["absolutePressurePa"], 101326)
        self.assertEqual(result["validationStatus"], "unvalidated")
        self.assertEqual(self.manifest, before)
        result["source"]["roomId"] = "changed-output-copy"
        self.assertEqual(self.manifest, before)

    def test_missing_diagnostics_remain_missing_not_zero_or_conserved(self):
        self.evidence = synthetic_evidence(continuity=False)
        diagnostics = self.parse()["diagnostics"]
        self.assertEqual(diagnostics["normalizedContinuityErrors"]["status"], "not-reported")
        self.assertNotIn("sumLocal", diagnostics["normalizedContinuityErrors"])
        for kind in ("energyBalance", "meshConvergence", "timeStepConvergence"):
            self.assertEqual(diagnostics[kind]["status"], "not-evaluated")
        self.assertNotIn("energyResidualJ", diagnostics)
        self.assertNotIn("massResidualKgS", diagnostics)
        for region in ("air", "solid"):
            self.assertEqual(diagnostics["meshChecks"][region]["status"], "passed")

    def test_reported_continuity_is_not_relabelled_as_kg_per_second(self):
        diagnostics = self.parse()["diagnostics"]["normalizedContinuityErrors"]
        self.assertEqual(diagnostics["status"], "reported-not-validated")
        self.assertEqual(diagnostics["sumLocal"], 1e-8)
        self.assertEqual(diagnostics["globalError"], -2e-9)
        self.assertEqual(diagnostics["cumulative"], 3e-9)
        self.assertEqual(diagnostics["timeSeconds"], 1)
        self.assertIn("not kg/s", diagnostics["normalization"])

    def test_explicit_probe_directory_and_fixed_fallback_do_not_search_for_other_results(self):
        self.manifest["probeOutputDirectory"] = "postProcessing/alternate/0"
        with self.assertRaises(results.CfdResultError):
            self.parse()
        write_synthetic_probes(self.case, self.manifest)
        self.assertEqual(len(self.parse()["samples"]), 2)
        del self.manifest["probeOutputDirectory"]
        self.assertEqual(len(self.parse()["samples"]), 2)

    def test_missing_file_truncated_ascii_missing_components_nan_and_domains_are_rejected(self):
        mutations = [
            ("T", lambda path: path.unlink()),
            ("T", lambda path: path.write_bytes(path.read_bytes()[:-1])),
            ("T", lambda path: path.write_bytes(path.read_bytes() + b"\xff\n")),
            ("T", lambda path: path.write_bytes(path.read_bytes() + b"\x00\n")),
            ("T", lambda path: path.write_text(path.read_text(encoding="ascii").replace("1 300 302", "1 300"), encoding="ascii")),
            ("T", lambda path: path.write_text(path.read_text(encoding="ascii").replace("1 300 302", "1 nan 302"), encoding="ascii")),
            ("T", lambda path: path.write_text(path.read_text(encoding="ascii").replace("1 300 302", "1 1e999 302"), encoding="ascii")),
            ("T", lambda path: path.write_text(path.read_text(encoding="ascii").replace("1 300 302", "1 0 302"), encoding="ascii")),
            ("U", lambda path: path.write_text(path.read_text(encoding="ascii").replace("(0.1 0 0.2)", "(0.1 0)"), encoding="ascii")),
            ("U", lambda path: path.write_text(path.read_text(encoding="ascii").replace("(0.1 0 0.2)", "0.1 0 0.2"), encoding="ascii")),
            ("U", lambda path: path.write_text(path.read_text(encoding="ascii").replace("(0.1 0 0.2)", "(1.7e308 1.7e308 1.7e308)"), encoding="ascii")),
            ("p", lambda path: path.write_text(path.read_text(encoding="ascii").replace("1 101325 101326", "1 -1 101326"), encoding="ascii")),
        ]
        for name, mutation in mutations:
            write_synthetic_probes(self.case, self.manifest)
            mutation(self.probes.joinpath(name))
            with self.subTest(name=name, mutation=mutation), self.assertRaises(results.CfdResultError):
                self.parse()

    def test_header_count_indices_and_coordinates_are_required_for_every_field(self):
        changes = (
            ("# Probe 1 (1.5 0.5 1.1)\n", ""),
            ("# Probe 1 (1.5 0.5 1.1)", "# Probe 0 (1.5 0.5 1.1)"),
            ("# Probe 1 (1.5 0.5 1.1)", "# Probe 2 (1.5 0.5 1.1)"),
            ("# Probe 1 (1.5 0.5 1.1)", "# Probe 1 (1.5 -0.5 1.1)"),
            ("# Probe 0 (0.5 0.5 1.1)", "# Probe 0 (0.5001 0.5 1.1)"),
            ("# Time 0 1", "# Time 1 0"),
            ("# Time 0 1", "# Time 0 1 2"),
            ("# Time 0 1\n", ""),
            ("# Time 0 1", "# Unsupported format"),
        )
        for name in ("T", "U", "p"):
            for old, new in changes:
                write_synthetic_probes(self.case, self.manifest)
                self.replace_text(name, old, new)
                with self.subTest(field=name, new=new), self.assertRaises(results.CfdResultError):
                    self.parse()

    def test_all_sample_times_must_match_be_monotonic_and_reach_requested_end(self):
        for old, new in (
            ("\n1 (", "\n0.9 ("), ("\n1 (", "\n1.1 ("), ("\n1 (", "\n0 ("),
            ("\n0 (0 0 0) (0 0 0)\n", "\n"), ("\n0 (0 0 0) (0 0 0)\n", "\n-1 (0 0 0) (0 0 0)\n"),
        ):
            write_synthetic_probes(self.case, self.manifest)
            self.replace_text("U", old, new)
            with self.subTest(new=new), self.assertRaises(results.CfdResultError):
                self.parse()
        write_synthetic_probes(self.case, self.manifest)
        self.probes.joinpath("T").write_bytes(self.probes.joinpath("T").read_bytes() + b"# Time 0 1\n1 300 302\n")
        with self.assertRaises(results.CfdResultError):
            self.parse()

    def test_small_representation_tolerance_is_not_mesh_or_time_convergence(self):
        self.replace_text("T", "(0.5 0.5 1.1)", "(0.50000001 0.5 1.1)")
        self.replace_text("T", "\n1 300", "\n0.99999999 300")
        result = self.parse()
        self.assertEqual(result["samples"][0]["positionM"], self.manifest["probeLocations"][0])
        self.assertEqual(result["diagnostics"]["timeStepConvergence"]["status"], "not-evaluated")

    def test_file_byte_row_budgets_and_path_traversal_are_rejected(self):
        with self.assertRaises(results.CfdResultError):
            self.parse(max_probe_bytes=10)
        with self.assertRaises(results.CfdResultError):
            self.parse(max_rows=1)
        for path in ("../other", "/absolute/path", "postProcessing/../private", "postProcessing\\air\\probes\\0",
                     "postProcessing/air//0", "postProcessing/air/probes/0."):
            with self.subTest(path=path):
                self.manifest["probeOutputDirectory"] = path
                with self.assertRaises(results.CfdResultError):
                    self.parse()

    def test_hardlinked_probe_is_not_read_as_an_owned_file(self):
        source = self.fixture.joinpath("unrelated-private.txt")
        source.write_bytes(b"not a CFD file")
        target = self.probes.joinpath("T")
        target.unlink()
        try:
            os.link(source, target)
        except OSError as exc:
            self.skipTest(f"This fixture filesystem cannot create a hard link: {type(exc).__name__}")
        with self.assertRaises(results.CfdResultError):
            self.parse()
        self.assertEqual(source.read_bytes(), b"not a CFD file")

    def test_exit_evidence_must_be_real_log_records_not_client_booleans(self):
        self.evidence["checkMesh-air"] = True
        with self.assertRaises(results.CfdResultError):
            self.parse()
        self.evidence = synthetic_evidence()
        self.evidence["chtMultiRegionFoam"].last_time = 0.8
        with self.assertRaises(results.CfdResultError):
            self.parse()


class DiagnosticFixtureTests(unittest.TestCase):
    def test_fatal_and_nonfinite_solver_or_mesh_diagnostics_are_rejected(self):
        for line in (
            "--> FOAM FATAL ERROR:", "--> FOAM FATAL IO ERROR:", "FOAM exiting",
            "Floating point exception", "Segmentation fault", "MPI_ABORT invoked",
            "Failed 1 mesh checks.", "Initial residual = nan", "Time = inf",
            "time step continuity errors : sum local = 1e999, global = 0, cumulative = 0",
            "time step continuity errors : sum local = ?",
        ):
            with self.subTest(line=line), self.assertRaises(results.CfdResultError):
                results.StageEvidence().line(line)

    def test_an_end_marker_alone_never_establishes_mesh_or_solver_completeness(self):
        record = results.StageEvidence()
        record.line("End")
        with self.assertRaises(results.CfdResultError):
            record.require_complete(mesh=True)
        with self.assertRaises(results.CfdResultError):
            record.require_complete(end=1)
        record.line("Time = 1")
        with self.assertRaises(results.CfdResultError):
            record.line("Time = 0.9")


if __name__ == "__main__":
    unittest.main()
