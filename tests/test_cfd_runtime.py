"""Synthetic process/file fixtures only; these tests never run a CFD engine."""
import copy
import hashlib
import io
import json
import os
import shutil
import subprocess
import threading
import time
import unittest
import uuid
import zipfile
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import cfd_runtime as cfd
from cfd_results import ENGINE, PROFILE, CfdResultError


SYNTHETIC_SOURCE = {
    "projectId": "synthetic-project", "floorId": "synthetic-floor", "roomId": "synthetic-room",
    "revision": 7, "inputFingerprint": "synthetic-input-v1", "geometryFingerprint": "synthetic-geometry-v1",
}
SYNTHETIC_REQUEST = {
    "version": 1, "profile": PROFILE, "source": SYNTHETIC_SOURCE,
    "geometry": {"rect": {"x": 4, "y": 5, "w": 2, "h": 2}, "heightM": 2.8},
    "scenario": {"numerics": {
        "spacingM": 0.5, "solidCells": 2, "deltaTSeconds": 0.1, "endTimeSeconds": 1,
        "writeIntervalSeconds": 1, "maxCo": 0.5, "maxRuntimeSeconds": 10,
    }},
    "receiverHeightM": 1.1,
}


def synthetic_compiler(payload):
    """Explicit test compiler; not an OpenFOAM dictionary/compiler validation."""
    if type(payload) is not dict or set(payload) != set(SYNTHETIC_REQUEST):
        raise cfd.CfdError("Synthetic fixture expects an explicit flat compiler payload.")
    manifest = {
        "version": 1, "profile": PROFILE, "engine": copy.deepcopy(ENGINE),
        "caseHash": hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest(),
        "source": copy.deepcopy(payload["source"]), "geometry": copy.deepcopy(payload["geometry"]),
        "scenario": copy.deepcopy(payload["scenario"]), "coordinateSpace": "room-right-front-up",
        "receiverHeightM": payload["receiverHeightM"],
        "probeLocations": [{"x": 0.5, "y": 0.5, "z": 1.1}, {"x": 1.5, "y": 0.5, "z": 1.1}],
        "probeOutputDirectory": "postProcessing/air/probes/0",
        "mesh": {"cells": 64},
        "commands": [list(command) for command in cfd.COMMANDS],
        "limitations": ["Synthetic unit-test fixture, not solver or physics validation."],
        "runtimeVerification": "pending",
    }
    return {"manifest": manifest, "files": {
        "system/controlDict": "// Synthetic test text, never executed by a solver.\n",
        "system/blockMeshDict": "// Synthetic test text, not a validated mesh.\n",
    }}


def write_synthetic_probes(case_dir: Path, manifest: dict):
    """Write explicitly labelled ASCII fixtures, not manufactured production results."""
    directory = case_dir.joinpath(*manifest["probeOutputDirectory"].split("/"))
    directory.mkdir(parents=True, exist_ok=True)
    header = "".join(
        f"# Probe {index} ({point['x']} {point['y']} {point['z']})\n"
        for index, point in enumerate(manifest["probeLocations"])
    ) + "# Time 0 1\n"
    end = manifest["scenario"]["numerics"]["endTimeSeconds"]
    values = {
        "T": f"0 299 301\n{end} 300 302\n",
        "U": f"0 (0 0 0) (0 0 0)\n{end} (0.1 0 0.2) (0.2 -0.3 0.4)\n",
        "p": f"0 101325 101325\n{end} 101325 101326\n",
    }
    for name, rows in values.items():
        directory.joinpath(name).write_text(header + rows, encoding="ascii")
    return directory


class FixtureRuntime:
    """Injectable unit-test runtime; never used by application construction."""
    def __init__(self):
        self.available = True
        self.calls = []
        self.probes = 0
        self.cleanups = []
        self.started = threading.Event()
        self.release = threading.Event()
        self.block = False
        self.action = None
        self.outputs = {}
        self.exit_code = 0
        self.write_outputs = True
        self.after_outputs = None

    def execution(self):
        return {
            "available": self.available, "status": "ready" if self.available else "unavailable",
            "message": "Explicit synthetic runtime fixture; no solver is installed or executed.",
        }

    def identity(self):
        return hashlib.sha256(b"synthetic-runtime-test-only").hexdigest()

    def require_ready(self):
        if not self.available:
            raise cfd.CfdError("Synthetic runtime is unavailable.", "runtime_unavailable", 503)

    def probe(self):
        self.probes += 1
        return self.execution()

    def cleanup_job(self, directory, identity):
        self.cleanups.append((directory, identity))

    def run_stage(self, command, directory, *, timeout, cancel, on_output, monitor):
        self.calls.append(command)
        self.started.set()
        while self.block and not self.release.wait(0.005):
            if cancel.is_set():
                raise cfd._Cancelled()
            monitor()
        if cancel.is_set():
            raise cfd._Cancelled()
        if self.action:
            self.action(command, directory, cancel, on_output, monitor)
        if self.exit_code:
            return cfd.ProcessOutcome(self.exit_code, 0)
        manifest = json.loads(directory.joinpath("case", "manifest.json").read_text(encoding="utf-8"))
        end = manifest["scenario"]["numerics"]["endTimeSeconds"]
        if command[0] == "checkMesh":
            data = b"Mesh OK.\nEnd\n"
        elif command[0] == "chtMultiRegionFoam":
            data = (
                f"Time = {end}\ntime step continuity errors : sum local = 1e-08, global = -2e-09, cumulative = 3e-09\nEnd\n"
            ).encode("ascii")
        else:
            data = b"End\n"
        on_output(self.outputs.get(command, data))
        if command[0] == "chtMultiRegionFoam" and self.write_outputs:
            probes = write_synthetic_probes(directory.joinpath("case"), manifest)
            if self.after_outputs:
                self.after_outputs(probes)
        return cfd.ProcessOutcome(0, len(data))


class OwnedFixtureTest(unittest.TestCase):
    def setUp(self):
        self.fixture = Path("tests").joinpath(".cfd-fixture-" + uuid.uuid4().hex).absolute()
        self.fixture.mkdir()
        self.services = []
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        for service in reversed(self.services):
            service.shutdown()
        shutil.rmtree(self.fixture)

    def make_service(self, *, runtime=None, compiler=synthetic_compiler, limits=None, root=None, thread_factory=None):
        service = cfd.CfdService(
            runtime=runtime if runtime is not None else FixtureRuntime(), compiler=compiler,
            workspace_root=root if root is not None else self.fixture.joinpath("cache-" + uuid.uuid4().hex),
            limits=limits, thread_factory=thread_factory,
        )
        self.services.append(service)
        return service

    def finish(self, service, snapshot):
        service._worker.join(timeout=5)
        self.assertFalse(service._worker.is_alive(), "The synthetic worker did not finish within its test budget.")
        return service.get_job(snapshot["id"])


class ServiceTests(OwnedFixtureTest):
    def test_capabilities_preparation_and_package_are_lazy_and_source_preserving(self):
        runtime = FixtureRuntime()
        service = self.make_service(runtime=runtime)
        payload = copy.deepcopy(SYNTHETIC_REQUEST)
        before = copy.deepcopy(payload)
        with patch("subprocess.Popen", side_effect=AssertionError("No real process is allowed")):
            capability = service.capabilities()
            prepared = service.prepare(payload)
            package = service.package(payload)
        self.assertEqual(capability["runtimeVerification"], "pending")
        self.assertEqual(capability["limits"]["parallelJobs"], 1)
        self.assertEqual(prepared["status"], "prepared")
        self.assertEqual(prepared["manifest"]["source"], payload["source"])
        self.assertEqual(payload, before)
        self.assertFalse(service._root_override.exists())
        self.assertIsNone(service._worker)
        self.assertEqual(runtime.calls, [])
        self.assertEqual(runtime.probes, 0)
        with zipfile.ZipFile(io.BytesIO(package)) as archive:
            self.assertTrue({"manifest.json", "request.json", "system/controlDict"} <= set(archive.namelist()))
            self.assertEqual(json.loads(archive.read("manifest.json"))["source"], SYNTHETIC_SOURCE)
            self.assertEqual(json.loads(archive.read("request.json")), before)
            self.assertTrue(all(not name.startswith(("/", "\\")) and ".." not in name.split("/") for name in archive.namelist()))

    def test_runtime_is_required_before_compiling_or_allocating_a_job(self):
        runtime, compiler = FixtureRuntime(), Mock(side_effect=AssertionError("Must not compile"))
        runtime.available = False
        service = self.make_service(runtime=runtime, compiler=compiler)
        with self.assertRaises(cfd.CfdError) as error:
            service.submit(SYNTHETIC_REQUEST)
        self.assertEqual((error.exception.code, error.exception.status), ("runtime_unavailable", 503))
        compiler.assert_not_called()
        self.assertFalse(service._root_override.exists())
        self.assertEqual(runtime.calls, [])

    def test_large_canonical_json_fingerprints_remain_opaque_through_persistence_and_results(self):
        for key in ("inputFingerprint", "geometryFingerprint"):
            payload = copy.deepcopy(SYNTHETIC_REQUEST)
            canonical_text = json.dumps(
                {"fixture": "Opaque canonical JSON, not a browser hashing implementation.", "text": "x" * 200_000},
                sort_keys=True, separators=(",", ":"),
            )
            payload["source"][key] = canonical_text
            expected_source = copy.deepcopy(payload["source"])
            self.assertGreater(len(canonical_text), 98_304)
            self.assertLess(len(json.dumps(payload).encode("utf-8")), cfd.MAX_PAYLOAD_BYTES)
            service = self.make_service()
            with self.subTest(key=key):
                prepared = service.prepare(payload)
                self.assertEqual(prepared["manifest"]["source"], expected_source)
                initial = service.submit(payload)
                payload["source"]["revision"] += 1
                payload["source"]["inputFingerprint"] = '{"presentation":"changed after submission"}'
                completed = self.finish(service, initial)
                self.assertEqual(completed["status"], "completed", completed)
                self.assertEqual(completed["source"], expected_source)
                self.assertRegex(completed["caseHash"], r"^[a-f0-9]{64}$")
                self.assertEqual(service.get_result(completed["id"])["result"]["source"], expected_source)
                restarted = self.make_service(root=service._root_override)
                self.assertEqual(restarted.get_job(completed["id"])["source"], expected_source)
                self.assertEqual(restarted.get_result(completed["id"])["result"]["source"], expected_source)

    def test_manifest_paths_commands_and_explicit_numerics_fail_before_allocation(self):
        mutations = (
            lambda case: case["files"].update({"../outside": "bad"}),
            lambda case: case["files"].update({"system\\controlDict": "bad"}),
            lambda case: case["files"].update({"run.sh": "echo unexpected"}),
            lambda case: case["files"].update({"system/controlDict": '#codeStream { code "#{ anything }"; }'}),
            lambda case: case["manifest"].update(commands=[["bash", "-c", "unreviewed"]]),
            lambda case: case["manifest"]["scenario"]["numerics"].pop("maxRuntimeSeconds"),
            lambda case: case["manifest"]["scenario"]["numerics"].update(maxRuntimeSeconds=None),
            lambda case: case["manifest"]["scenario"]["numerics"].update(maxRuntimeSeconds=3601),
            lambda case: case["manifest"]["source"].pop("inputFingerprint"),
            lambda case: case["manifest"].update(probeOutputDirectory="../elsewhere"),
        )
        for mutation in mutations:
            def compiler(payload):
                case = synthetic_compiler(payload)
                mutation(case)
                return case
            service = self.make_service(compiler=compiler)
            with self.subTest(mutation=mutation):
                with self.assertRaises((cfd.CfdError, CfdResultError)):
                    service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
                self.assertFalse(service._root_override.exists())
                self.assertEqual(service.runtime.calls, [])

    def test_actual_fixture_files_and_mesh_logs_are_required_for_completion(self):
        service = self.make_service()
        initial = service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertEqual(initial["status"], "preparing")
        self.assertEqual(set(initial), cfd.SNAPSHOT_KEYS)
        completed = self.finish(service, initial)
        self.assertEqual(completed["status"], "completed", completed)
        self.assertTrue(completed["resultAvailable"])
        result = service.get_result(initial["id"])
        self.assertEqual(result["status"], "computed-unvalidated")
        self.assertEqual(result["result"]["source"], SYNTHETIC_SOURCE)
        self.assertEqual(result["result"]["caseHash"], completed["caseHash"])
        self.assertAlmostEqual(result["result"]["samples"][0]["temperatureC"], 26.85)
        self.assertEqual(result["result"]["samples"][0]["absolutePressurePa"], 101325)
        self.assertEqual(service.runtime.calls, list(cfd.COMMANDS))
        self.assertEqual(result["result"]["diagnostics"]["energyBalance"]["status"], "not-evaluated")
        self.assertNotIn("kg", result["result"]["diagnostics"]["normalizedContinuityErrors"].keys())
        job_dir = service._root_override.joinpath(initial["id"])
        self.assertTrue(job_dir.joinpath("case", "system", "controlDict").exists())
        self.assertTrue(job_dir.joinpath("engine.log").exists())
        state = json.loads(job_dir.joinpath("state.json").read_text(encoding="utf-8"))
        data = job_dir.joinpath("result.json").read_bytes()
        self.assertEqual(state["resultSha256"], hashlib.sha256(data).hexdigest())
        result["result"]["source"]["roomId"] = "caller-mutated"
        self.assertEqual(service.get_result(initial["id"])["result"]["source"], SYNTHETIC_SOURCE)

    def test_exit_zero_without_real_files_or_complete_logs_is_never_completed(self):
        for mode in ("missing-output", "missing-mesh-check", "fatal-log", "no-end", "partial-temperature", "wrong-time"):
            runtime = FixtureRuntime()
            if mode == "missing-output":
                runtime.write_outputs = False
            elif mode == "missing-mesh-check":
                runtime.outputs[cfd.COMMANDS[2]] = b"End\n"
            elif mode == "fatal-log":
                runtime.outputs[cfd.COMMANDS[-1]] = b"Time = 1\nFOAM FATAL IO ERROR\nEnd\n"
            elif mode == "no-end":
                runtime.outputs[cfd.COMMANDS[-1]] = b"Time = 1\n"
            elif mode == "partial-temperature":
                runtime.after_outputs = lambda path: path.joinpath("T").write_bytes(path.joinpath("T").read_bytes()[:-1])
            else:
                runtime.after_outputs = lambda path: path.joinpath("U").write_text(
                    path.joinpath("U").read_text(encoding="ascii").replace("\n1 (", "\n0.9 ("), encoding="ascii")
            service = self.make_service(runtime=runtime)
            with self.subTest(mode=mode), self.assertLogs(cfd.LOGGER, level="ERROR"):
                job = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
            self.assertEqual(job["status"], "failed", job)
            self.assertFalse(job["resultAvailable"])
            self.assertIsNotNone(job["diagnostic"])
            with self.assertRaises(cfd.CfdError) as error:
                service.get_result(job["id"])
            self.assertEqual(error.exception.status, 409)

    def test_nonzero_exit_timeout_output_and_disk_budgets_fail_without_success(self):
        for mode in ("exit", "timeout", "output", "disk", "file-count"):
            runtime, limits = FixtureRuntime(), cfd.Limits()
            payload = copy.deepcopy(SYNTHETIC_REQUEST)
            if mode == "exit":
                runtime.exit_code = 7
            elif mode == "timeout":
                runtime.block = True
                payload["scenario"]["numerics"]["maxRuntimeSeconds"] = 0.08
            elif mode == "output":
                limits = replace(limits, max_log_bytes=100)
                runtime.outputs[cfd.COMMANDS[0]] = b"x" * 101
            elif mode == "disk":
                limits = replace(limits, max_case_bytes=100)
            else:
                limits = replace(limits, max_case_files=12)

                def files(_command, directory, _cancel, _output, _monitor):
                    for index in range(20):
                        directory.joinpath("case", f"synthetic-{index}").write_bytes(b"x")
                runtime.action = files
            service = self.make_service(runtime=runtime, limits=limits)
            with self.subTest(mode=mode), self.assertLogs(cfd.LOGGER, level="ERROR"):
                job = self.finish(service, service.submit(payload))
            self.assertEqual(job["status"], "failed", job)
            self.assertFalse(job["resultAvailable"])
            self.assertEqual(job["diagnostic"]["code"], {
                "exit": "engine_failed", "timeout": "time_limit", "output": "output_limit",
                "disk": "disk_limit", "file-count": "disk_limit",
            }[mode])
            self.assertTrue(service._root_override.joinpath(job["id"], "state.json").exists())

    def test_one_job_no_queue_cancel_and_retry(self):
        runtime = FixtureRuntime()
        runtime.block = True
        service = self.make_service(runtime=runtime)
        first = service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertTrue(runtime.started.wait(2))
        with self.assertRaises(cfd.CfdError) as error:
            service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertEqual((error.exception.status, error.exception.code), (429, "queue_full"))
        cancelling = service.cancel(first["id"])
        self.assertEqual(cancelling["status"], "cancelling")
        cancelled = self.finish(service, first)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertFalse(cancelled["resultAvailable"])
        self.assertEqual(service.cancel(first["id"])["status"], "cancelled")
        runtime.block = False
        next_job = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        self.assertEqual(next_job["status"], "completed")
        self.assertNotEqual(next_job["id"], first["id"])

    def test_cancel_before_worker_starts_and_during_result_read(self):
        gate = threading.Event()

        def thread_factory(*, target, args, **kwargs):
            return threading.Thread(target=lambda: (gate.wait(2), target(*args)), **kwargs)

        service = self.make_service(thread_factory=thread_factory)
        initial = service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        service.cancel(initial["id"])
        gate.set()
        cancelled = self.finish(service, initial)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(service.runtime.calls, [])
        self.assertFalse(service._root_override.joinpath(initial["id"], "case").exists())

        service = self.make_service()
        entered, release = threading.Event(), threading.Event()
        actual_parse = cfd.parse_results

        def parse(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(2))
            return actual_parse(*args, **kwargs)

        with patch.object(cfd, "parse_results", side_effect=parse):
            initial = service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
            self.assertTrue(entered.wait(2))
            service.cancel(initial["id"])
            release.set()
            cancelled = self.finish(service, initial)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertFalse(cancelled["resultAvailable"])
        self.assertFalse(service._root_override.joinpath(initial["id"], "result.json").exists())

    def test_shutdown_stops_only_owned_work_and_is_idempotent(self):
        runtime = FixtureRuntime()
        runtime.block = True
        service = self.make_service(runtime=runtime)
        initial = service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertTrue(runtime.started.wait(2))
        service.shutdown()
        self.assertFalse(service._worker.is_alive())
        self.assertEqual(service.get_job(initial["id"])["status"], "interrupted")
        service.shutdown()
        with self.assertRaises(cfd.CfdError) as error:
            service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertEqual(error.exception.code, "service_closed")

    def test_restart_recovers_running_as_interrupted_even_if_a_result_file_exists(self):
        service = self.make_service()
        completed = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        directory = service._root_override.joinpath(completed["id"])
        state_path = directory.joinpath("state.json")
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["job"].update(status="running", resultAvailable=True)
        state["cleanupVerified"] = False
        state_path.write_text(json.dumps(state), encoding="utf-8")
        restarted = self.make_service(root=service._root_override)
        with patch("subprocess.Popen", side_effect=AssertionError("Recovery GET may not run processes")):
            snapshot = restarted.get_job(completed["id"])
        self.assertEqual(snapshot["status"], "interrupted")
        self.assertFalse(snapshot["resultAvailable"])
        self.assertEqual(snapshot["source"], SYNTHETIC_SOURCE)
        self.assertEqual(json.loads(state_path.read_text(encoding="utf-8"))["job"]["status"], "interrupted")
        self.assertEqual(restarted.runtime.calls, [])
        self.assertEqual(restarted.runtime.cleanups, [])
        with self.assertRaises(cfd.CfdError):
            restarted.get_result(completed["id"])
        next_job = self.finish(restarted, restarted.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        self.assertEqual(next_job["status"], "completed")
        self.assertEqual(len(restarted.runtime.cleanups), 1)
        self.assertTrue(directory.joinpath("result.json").exists())

    def test_completed_state_survives_restart_but_corrupted_result_does_not(self):
        service = self.make_service()
        job = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        restarted = self.make_service(root=service._root_override)
        self.assertEqual(restarted.get_result(job["id"])["result"]["source"], SYNTHETIC_SOURCE)
        result_file = service._root_override.joinpath(job["id"], "result.json")
        result_file.write_text('{"result":"not an engine output"}', encoding="utf-8")
        another = self.make_service(root=service._root_override)
        with self.assertLogs(cfd.LOGGER, level="ERROR"), self.assertRaises(cfd.CfdError) as error:
            another.get_job(job["id"])
        self.assertEqual(error.exception.code, "invalid_saved_job")
        self.assertTrue(result_file.exists())
        self.assertNotIn(str(self.fixture), str(error.exception))

    def test_workspace_lease_blocks_other_managers_without_interrupting_live_state(self):
        runtime = FixtureRuntime()
        runtime.block = True
        service = self.make_service(runtime=runtime)
        initial = service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertTrue(runtime.started.wait(2))
        another = self.make_service(root=service._root_override)
        self.assertIn(another.get_job(initial["id"])["status"], ("preparing", "running"))
        with self.assertRaises(cfd.CfdError) as error:
            another.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertEqual(error.exception.code, "queue_full")
        another.shutdown()
        self.assertFalse(service._jobs[initial["id"]].cancellation.is_set())
        service.cancel(initial["id"])
        self.assertEqual(self.finish(service, initial)["status"], "cancelled")

    def test_retention_budgets_do_not_delete_old_cases(self):
        service = self.make_service(limits=replace(cfd.Limits(), max_jobs=2))
        one = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        two = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        with self.assertRaises(cfd.CfdError) as error:
            service.submit(copy.deepcopy(SYNTHETIC_REQUEST))
        self.assertEqual((error.exception.status, error.exception.code), (429, "retention_limit"))
        for job in (one, two):
            self.assertTrue(service._root_override.joinpath(job["id"], "state.json").exists())

    def test_logs_have_bounded_sanitized_public_tail_but_retained_internal_detail(self):
        runtime = FixtureRuntime()
        prefix = b"private C:\\Users\\Somebody\\secret\\case\nfile /home/somebody/private/input\n"
        runtime.outputs[cfd.COMMANDS[0]] = prefix + (b"stage detail " + b"x" * 400 + b"\n") * 100 + b"End\n"
        service = self.make_service(runtime=runtime)
        job = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        self.assertEqual(job["status"], "completed", job)
        self.assertLessEqual(len(job["logTail"]), 60)
        self.assertTrue(all(len(line) <= 301 for line in job["logTail"]))
        self.assertNotIn("Somebody", json.dumps(job))
        self.assertNotIn("/home/somebody", json.dumps(job))
        raw = service._root_override.joinpath(job["id"], "engine.log").read_bytes()
        self.assertIn(prefix, raw)
        self.assertLessEqual(len(raw), service.limits.max_log_bytes)
        self.assertEqual(cfd._public_log_line("path C:\\Users\\Somebody\\x", 300), "path [local path]")

    def test_invalid_uuids_do_not_read_arbitrary_files(self):
        service = self.make_service()
        for value in ("../elsewhere", r"C:\private\state.json", "", "0" * 36, str(uuid.uuid1())):
            with self.subTest(value=value), self.assertRaises(cfd.CfdError) as error:
                service.get_job(value)
            self.assertEqual(error.exception.status, 404)
        self.assertFalse(service._root_override.exists())

    def test_failed_atomic_completion_never_exposes_in_memory_success(self):
        service = self.make_service()
        actual = cfd._atomic_write

        def fail_result(path, data):
            if path.name == "result.json":
                raise OSError(r"Synthetic write failure C:\private\full-disk")
            return actual(path, data)

        with patch.object(cfd, "_atomic_write", side_effect=fail_result), self.assertLogs(cfd.LOGGER, level="ERROR"):
            job = self.finish(service, service.submit(copy.deepcopy(SYNTHETIC_REQUEST)))
        self.assertEqual(job["status"], "failed")
        self.assertFalse(job["resultAvailable"])
        self.assertNotIn("private", json.dumps(job))
        saved = json.loads(service._root_override.joinpath(job["id"], "state.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["job"]["status"], "failed")


class FixturePipe:
    def __init__(self, process, chunks, hold):
        self.process, self.chunks, self.hold = process, list(chunks), hold
        self.closed = False

    def read(self, size):
        if self.chunks:
            data = self.chunks.pop(0)
            if len(data) > size:
                self.chunks.insert(0, data[size:])
            return data[:size]
        if self.hold:
            self.process.done.wait(5)
        if self.process.returncode is None:
            self.process.returncode = self.process.exit_code
            self.process.done.set()
        return b""

    def close(self):
        self.closed = True


class FixtureProcess:
    """Only in-memory pipe/exit events. pid is never passed to a real OS kill."""
    def __init__(self, chunks=(), *, hold=False, exit_code=0):
        self.pid = 222222
        self.returncode = None
        self.exit_code = exit_code
        self.done = threading.Event()
        self.stdout = FixturePipe(self, chunks, hold)
        self.terminations = []

    def poll(self):
        return self.returncode

    def wait(self, timeout):
        if not self.done.wait(timeout):
            raise subprocess.TimeoutExpired("synthetic-process", timeout)
        return self.returncode

    def terminate(self):
        self.terminations.append("TERM")
        self.returncode = -15
        self.done.set()

    def kill(self):
        self.terminations.append("KILL")
        self.returncode = -9
        self.done.set()


class ProcessRunnerTests(unittest.TestCase):
    def test_fixed_argument_process_boundary_has_no_shell_or_stdin_and_bounded_reads(self):
        process = FixtureProcess([b"first\n", b"second\n"], exit_code=4)
        popen = Mock(return_value=process)
        output = bytearray()
        result = cfd.ProcessRunner(popen=popen, platform="win32").run(
            ["fixed-tool", "an argument with spaces"], timeout=1, max_output=100, on_output=output.extend)
        self.assertEqual(result, cfd.ProcessOutcome(4, 13))
        self.assertEqual(output, b"first\nsecond\n")
        self.assertFalse(popen.call_args.kwargs["shell"])
        self.assertEqual(popen.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertFalse(process.terminations)
        self.assertTrue(process.stdout.closed)

    def test_output_cap_and_timeout_terminate_the_owned_process(self):
        for chunks, hold, budget, code in (([b"x" * 5000], True, 100, "output_limit"), ([], True, 100, "time_limit")):
            process, output, stops = FixtureProcess(chunks, hold=hold), bytearray(), []
            runner = cfd.ProcessRunner(popen=Mock(return_value=process), platform="win32")
            with self.subTest(code=code), self.assertRaises(cfd.CfdError) as error:
                runner.run(["fixed-tool"], timeout=0.06, max_output=budget, on_output=output.extend,
                           terminate=lambda owned, force: stops.append((owned, force)))
            self.assertEqual(error.exception.code, code)
            self.assertLessEqual(len(output), budget)
            self.assertTrue(process.terminations)
            self.assertIs(stops[0][0], process)

    def test_cancel_before_start_and_during_popen_start_race(self):
        cancellation, popen = threading.Event(), Mock()
        cancellation.set()
        runner = cfd.ProcessRunner(popen=popen, platform="win32")
        with self.assertRaises(cfd._Cancelled):
            runner.run(["fixed-tool"], timeout=1, max_output=100, on_output=lambda _: None, cancel=cancellation)
        popen.assert_not_called()

        cancellation.clear()
        entered, release = threading.Event(), threading.Event()
        process, errors, stops = FixtureProcess(hold=True), [], []

        def create(*_args, **_kwargs):
            entered.set()
            if not release.wait(2):
                raise RuntimeError("Synthetic start race timed out")
            return process

        def run():
            try:
                cfd.ProcessRunner(popen=create, platform="win32").run(
                    ["fixed-tool"], timeout=1, max_output=100, on_output=lambda _: None,
                    cancel=cancellation, terminate=lambda owned, force: stops.append((owned, force)))
            except Exception as exc:
                errors.append(exc)

        thread = threading.Thread(target=run)
        thread.start()
        self.assertTrue(entered.wait(1))
        cancellation.set()
        release.set()
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], cfd._Cancelled)
        self.assertTrue(stops)
        self.assertTrue(process.terminations)


class AdapterTests(OwnedFixtureTest):
    def configured(self, runner=None, **kwargs):
        config = cfd.RuntimeConfig.from_env({"HOMEPLANNER_CFD_ENABLED": "1"}, platform="win32")
        return cfd.LocalRuntime(config, runner=runner if runner is not None else Mock(), **kwargs)

    def test_env_opt_in_invalid_values_and_capabilities_never_probe(self):
        for environment in (
            {}, {"HOMEPLANNER_CFD_ENABLED": "true"},
            {"HOMEPLANNER_CFD_ENABLED": "1", "HOMEPLANNER_CFD_DISTRIBUTION": "Ubuntu; echo x"},
            {"HOMEPLANNER_CFD_ENABLED": "1", "HOMEPLANNER_CFD_DISTRIBUTION": "--all"},
            {"HOMEPLANNER_CFD_ENABLED": "1", "HOMEPLANNER_CFD_BASHRC": "/x/../etc/bashrc"},
            {"HOMEPLANNER_CFD_ENABLED": "1", "HOMEPLANNER_CFD_BASHRC": "/x/bashrc;anything"},
        ):
            runner = Mock()
            runtime = cfd.LocalRuntime(cfd.RuntimeConfig.from_env(environment), runner=runner)
            with self.subTest(environment=environment):
                self.assertFalse(runtime.execution()["available"])
                self.assertEqual(runtime.probe()["status"], "not-configured")
                runner.run.assert_not_called()
        runtime = self.configured()
        self.assertEqual(runtime.execution()["status"], "unavailable")
        runtime.runner.run.assert_not_called()

    def test_explicit_probe_exact_version_check_cache_and_expiration(self):
        moment = [100.0]
        runner = Mock()

        def run(argv, **options):
            self.assertIn("--distribution", argv)
            self.assertEqual(argv[argv.index("--distribution") + 1], "Ubuntu-24.04")
            self.assertIn("--noprofile", argv)
            self.assertIn("--norc", argv)
            script = argv[argv.index("-c") + 1]
            self.assertIn('== 2606 || "${WM_PROJECT_VERSION:-}" == v2606', script)
            self.assertIn("blockMesh splitMeshRegions checkMesh chtMultiRegionFoam", script)
            options["on_output"](b"HP_CFD_RUNTIME 2606\n")
            return cfd.ProcessOutcome(0, 20)

        runner.run.side_effect = run
        runtime = self.configured(runner, clock=lambda: moment[0])
        self.assertFalse(runtime.execution()["available"])
        self.assertTrue(runtime.probe()["available"])
        runtime.require_ready()
        runtime.execution()
        runner.run.assert_called_once()
        moment[0] += 301
        self.assertFalse(runtime.execution()["available"])
        runner.run.assert_called_once()

    def test_missing_runtime_wrong_version_and_probe_budgets_have_no_result_fallback(self):
        runner = Mock()
        runner.run.side_effect = FileNotFoundError(r"C:\private\missing-wsl.exe")
        runtime = self.configured(runner)
        with self.assertLogs(cfd.LOGGER, level="ERROR"):
            unavailable = runtime.probe()
        self.assertFalse(unavailable["available"])
        self.assertNotIn("private", json.dumps(unavailable))
        runner.run.side_effect = None
        runner.run.return_value = cfd.ProcessOutcome(41, 0)
        unavailable = runtime.probe()
        self.assertIn("exact", unavailable["message"])
        self.assertFalse(unavailable["available"])
        for code in ("time_limit", "output_limit"):
            runner.run.side_effect = cfd.CfdError("Synthetic bounded probe failure", code, 409)
            with self.assertLogs(cfd.LOGGER, level="ERROR"):
                self.assertFalse(runtime.probe()["available"])

    def test_wsl_owned_group_handshake_serial_limits_and_fixed_commands(self):
        directory = self.fixture.joinpath("job with spaces")
        directory.mkdir()
        seen = []
        runner = Mock()

        def run(argv, **options):
            seen.append(argv)
            if "/usr/bin/wslpath" in argv:
                options["on_output"](b"/mnt/c/synthetic/job with spaces\n")
                return cfd.ProcessOutcome(0, 37)
            if cfd._STOP_SCRIPT in argv:
                options["on_output"](b"HP_CFD_GROUP_STOPPED\n")
                return cfd.ProcessOutcome(0, 21)
            self.assertIn("/usr/bin/setsid", argv)
            self.assertIn("/usr/bin/timeout", argv)
            self.assertNotIn("--foreground", argv)
            script = argv[argv.index("-c") + 1]
            for fragment in ('ulimit -v "$memory_kib"', 'ulimit -f "$file_kib"', 'ulimit -t "$cpu_seconds"',
                             "OMP_NUM_THREADS=1", "exec /usr/bin/taskset", 'source "$bashrc"'):
                self.assertIn(fragment, script)
            tail = argv[argv.index("homeplanner-cfd") + 1:]
            token = tail[4]
            directory.joinpath(f"control-{token}.ready").write_bytes(f"{token} 12345 999\n".encode())
            options["on_output"](f"HP_CFD_GROUP {token} 12345 999\n".encode())
            self.assertTrue(directory.joinpath(f"control-{token}.permit").exists())
            options["on_output"](b"End\n")
            return cfd.ProcessOutcome(0, 80)

        runner.run.side_effect = run
        runtime = self.configured(runner)
        output = bytearray()
        result = runtime.run_stage(cfd.COMMANDS[0], directory, timeout=10, cancel=threading.Event(),
                                   on_output=output.extend, monitor=lambda: None)
        self.assertEqual(result.returncode, 0)
        stage_command = next(argv for argv in seen if cfd._STAGE_SCRIPT in argv)
        self.assertEqual(stage_command[-1], "blockMesh")
        self.assertIn(cfd._STOP_SCRIPT, seen[-1])
        self.assertIn(b"End", output)
        count = runner.run.call_count
        with self.assertRaises(cfd.CfdError):
            runtime.run_stage(("bash", "-c", "unreviewed"), directory, timeout=10,
                              cancel=threading.Event(), on_output=output.extend, monitor=lambda: None)
        self.assertEqual(runner.run.call_count, count)

    def test_wsl_client_failure_still_stops_only_its_recorded_linux_group(self):
        runtime = self.configured()
        runtime._stop_group = Mock()
        groups = []

        def run(argv, **options):
            if "/usr/bin/wslpath" in argv:
                options["on_output"](b"/mnt/c/synthetic/case\n")
                return cfd.ProcessOutcome(0, 22)
            arguments = argv[argv.index("homeplanner-cfd") + 1:]
            token = arguments[4]
            self.fixture.joinpath(f"control-{token}.ready").write_bytes(f"{token} 12345 999\n".encode())
            groups.append((token, "12345", "999"))
            options["on_output"](f"HP_CFD_GROUP {token} 12345 999\n".encode())
            return cfd.ProcessOutcome(7, 0)

        runtime.runner.run.side_effect = run
        with self.assertRaises(cfd.CfdError) as error:
            runtime.run_stage(cfd.COMMANDS[0], self.fixture, timeout=10, cancel=threading.Event(),
                              on_output=lambda _: None, monitor=lambda: None)
        self.assertEqual(error.exception.code, "engine_failed")
        runtime._stop_group.assert_called_once_with(groups[0])

    def test_cancel_start_gate_cannot_authorize_a_late_linux_child(self):
        runtime = self.configured()
        runtime._stop_group = Mock()
        controller = cfd._StageController(runtime, self.fixture, threading.Event())
        controller.stop(None)
        self.fixture.joinpath(controller.ready_name).write_bytes(f"{controller.token} 12345 999\n".encode())
        controller.feed(f"HP_CFD_GROUP {controller.token} 12345 999\n".encode())
        self.assertFalse(self.fixture.joinpath(controller.permit_name).exists())
        runtime._stop_group.assert_not_called()
        controller.stop(None)
        runtime._stop_group.assert_called_once_with((controller.token, "12345", "999"))

    def test_group_cleanup_uses_exact_token_pid_and_start_ticks_never_global_kills(self):
        runtime = self.configured()
        captured = []

        def run(argv, **options):
            captured.append(argv)
            options["on_output"](b"HP_CFD_GROUP_STOPPED\n")
            return cfd.ProcessOutcome(0, 21)

        runtime.runner.run.side_effect = run
        token = uuid.uuid4().hex
        runtime._stop_group((token, "12345", "999"))
        argv = captured[0]
        self.assertEqual(argv[-3:], ["12345", "999", token])
        script = argv[argv.index("-c") + 1]
        self.assertIn('"${fields[19]}" == "$ticks"', script)
        self.assertIn('"/proc/$group/cmdline"', script)
        self.assertIn('"-${group}"'.replace("${group}", "$group"), script)
        for forbidden in ("--shutdown", "--terminate", "pkill", "killall", "sudo", "--install"):
            self.assertNotIn(forbidden, " ".join(argv))

    def test_failed_wsl_cleanup_cannot_be_mistaken_for_a_stopped_linux_job(self):
        runtime = self.configured()
        for failure in (OSError(r"private C:\missing-wsl.exe"), cfd.CfdError("Synthetic timeout", "time_limit", 409)):
            runtime.runner.run.side_effect = failure
            with self.subTest(failure=type(failure).__name__), self.assertLogs(cfd.LOGGER, level="ERROR"), \
                    self.assertRaises(cfd.CfdError) as error:
                runtime._stop_group((uuid.uuid4().hex, "12345", "999"))
            self.assertEqual(error.exception.code, "cancellation_unconfirmed")
            self.assertNotIn("private", str(error.exception))

    def test_server_workspace_env_cannot_target_repository_relative_or_network_roots(self):
        for raw in ("relative-cache", str(cfd.REPOSITORY), str(cfd.REPOSITORY.joinpath("cache")), r"\\host\share\cfd"):
            with self.subTest(raw=raw), patch.dict(os.environ, {"HOMEPLANNER_CFD_WORKSPACE": raw}):
                with self.assertRaises(cfd.CfdError):
                    cfd._workspace_from_env()


if __name__ == "__main__":
    unittest.main()
