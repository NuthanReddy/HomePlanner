"""Opt-in, bounded local execution for HomePlanner's generated CHT cases.

Construction/capabilities never probe, create directories or start workers.
Only the compiler may supply dictionaries; HTTP callers cannot supply commands,
paths, environments, process IDs or a prepared-case/result wrapper.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import logging
import math
import os
import queue
import re
import signal
import stat
import subprocess
import sys
import threading
import time
import traceback
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Callable

from cfd_results import (
    COORDINATE_SPACE, ENGINE, PROFILE, MAX_PROBES, CfdResultError, StageEvidence,
    parse_results, read_bounded_file, reject_link, safe_relative_path,
)


MAX_PAYLOAD_BYTES = 262_144
ENGINE_VERSION = "2606"
REPOSITORY = Path(__file__).resolve().parent
COMMANDS = (
    ("blockMesh",),
    ("splitMeshRegions", "-cellZones", "-overwrite"),
    ("checkMesh", "-region", "air", "-allTopology", "-allGeometry"),
    ("checkMesh", "-region", "solid", "-allTopology", "-allGeometry"),
    ("chtMultiRegionFoam",),
)
STAGES = ("blockMesh", "splitMeshRegions", "checkMesh-air", "checkMesh-solid", "chtMultiRegionFoam")
SOURCE_KEYS = {"projectId", "floorId", "roomId", "revision", "inputFingerprint", "geometryFingerprint"}
TERMINAL = {"cancelled", "failed", "completed", "interrupted"}
STATUSES = {"preparing", "running", "cancelling"} | TERMINAL
SNAPSHOT_KEYS = {
    "id", "status", "message", "caseHash", "source", "stage", "createdAt", "updatedAt",
    "logTail", "resultAvailable", "diagnostic",
}
LOGGER = logging.getLogger(__name__)


class CfdError(Exception):
    def __init__(self, message: str, code: str = "invalid_input", status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status

    def public(self) -> dict:
        return {"status": "error", "error": {"code": self.code, "message": str(self)}}


class _Cancelled(Exception):
    pass


@dataclass(frozen=True)
class Limits:
    max_wall_seconds: int = 1800
    memory_bytes: int = 2 * 1024 ** 3
    max_file_bytes: int = 64 * 1024 ** 2
    max_case_bytes: int = 256 * 1024 ** 2
    max_case_files: int = 4096
    max_stored_bytes: int = 1024 ** 3
    max_stored_files: int = 16_384
    max_jobs: int = 32
    max_generated_files: int = 128
    max_generated_bytes: int = 16 * 1024 ** 2
    max_log_bytes: int = 2 * 1024 ** 2
    max_log_line_bytes: int = 65_536
    log_tail_lines: int = 60
    log_tail_chars: int = 300
    max_json_bytes: int = 2 * 1024 ** 2
    max_result_bytes: int = 4 * 1024 ** 2
    max_probe_bytes: int = 8 * 1024 ** 2
    max_probe_rows: int = 20_000
    probe_seconds: float = 6
    probe_output_bytes: int = 32_768
    readiness_seconds: int = 300
    stop_seconds: float = 12

    def public(self) -> dict:
        return {
            "maxPayloadBytes": MAX_PAYLOAD_BYTES,
            "parallelJobs": 1, "queuedJobs": 0, "serialCores": 1,
            "maxRuntimeSeconds": self.max_wall_seconds,
            "maxAddressSpaceBytes": self.memory_bytes,
            "maxSingleFileBytes": self.max_file_bytes,
            "maxCaseBytes": self.max_case_bytes, "maxCaseFiles": self.max_case_files,
            "maxStoredBytes": self.max_stored_bytes, "maxRetainedJobs": self.max_jobs,
            "maxGeneratedFiles": self.max_generated_files,
            "maxGeneratedBytes": self.max_generated_bytes,
            "maxLogBytes": self.max_log_bytes, "logTailLines": self.log_tail_lines,
            "logTailLineCharacters": self.log_tail_chars,
            "maxProbeFileBytes": self.max_probe_bytes, "maxProbeSamples": self.max_probe_rows,
            "maxReceivers": MAX_PROBES,
            "runtimeProbeTimeoutSeconds": self.probe_seconds,
            "runtimeReadinessSeconds": self.readiness_seconds,
            "aggregateDiskEnforcement": "bounded periodic checks, not a filesystem quota",
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json_tree(value) -> None:
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > 40 or count > 150_000:
            raise ValueError("JSON structure budget exceeded")
        if type(item) is dict:
            if any(type(key) is not str for key in item):
                raise ValueError("JSON keys must be strings")
            pending.extend((entry, depth + 1) for entry in item.values())
        elif type(item) is list:
            pending.extend((entry, depth + 1) for entry in item)
        elif item is None or type(item) in (str, bool):
            continue
        elif type(item) in (int, float):
            if not math.isfinite(item):
                raise ValueError("Nonfinite JSON number")
        else:
            raise ValueError("Unsupported JSON value")


def decode_json(data: bytes, limit: int = MAX_PAYLOAD_BYTES):
    if len(data) > limit:
        raise CfdError("CFD JSON exceeds its byte budget.", "payload_too_large", 413)

    def pairs(entries):
        result = {}
        for key, value in entries:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def constant(_):
        raise ValueError("Nonfinite JSON constant")

    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
        _json_tree(value)
        return value
    except (ValueError, OverflowError, RecursionError, UnicodeError):
        raise CfdError("Supply finite, bounded JSON without duplicate keys or excessive nesting.") from None


def _json_bytes(value, limit: int) -> bytes:
    try:
        _json_tree(value)
        data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (ValueError, OverflowError, RecursionError, UnicodeError, TypeError):
        raise CfdError("Local CFD metadata is not valid bounded JSON.", "invalid_metadata", 500) from None
    if len(data) > limit:
        raise CfdError("Local CFD metadata exceeds its byte budget.", "metadata_limit", 409)
    return data


def _uuid(value) -> str:
    try:
        parsed = uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise CfdError("Local CFD job not found.", "job_not_found", 404) from None
    if parsed.version != 4 or str(parsed) != str(value):
        raise CfdError("Local CFD job not found.", "job_not_found", 404)
    return str(parsed)


def _positive_number(value, maximum: float, label: str) -> float:
    if type(value) not in (int, float):
        raise CfdError(f"{label} must be supplied as a positive finite number.")
    try:
        number = float(value)
    except (ValueError, OverflowError):
        number = math.nan
    if not math.isfinite(number) or not 0 < number <= maximum:
        raise CfdError(f"{label} exceeds the supported positive budget.")
    return number


@dataclass(frozen=True)
class RuntimeConfig:
    enabled: bool
    distribution: str = "Ubuntu-24.04"
    bashrc: str = "/usr/lib/openfoam/openfoam2606/etc/bashrc"
    platform: str = sys.platform
    error: str | None = None

    @classmethod
    def from_env(cls, environ=None, *, platform: str | None = None):
        env = os.environ if environ is None else environ
        flag = env.get("HOMEPLANNER_CFD_ENABLED", "")
        distribution = env.get("HOMEPLANNER_CFD_DISTRIBUTION", "Ubuntu-24.04")
        bashrc = env.get("HOMEPLANNER_CFD_BASHRC", "/usr/lib/openfoam/openfoam2606/etc/bashrc")
        error = None
        if flag not in ("", "0", "1"):
            error = "HOMEPLANNER_CFD_ENABLED must be 1 to opt in, or 0/unset to leave execution disabled."
        elif not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", distribution):
            error = "HOMEPLANNER_CFD_DISTRIBUTION must be a single valid local distribution name."
        elif (
            not re.fullmatch(r"/[A-Za-z0-9_./+-]{1,230}/bashrc", bashrc)
            or any(part in (".", "..", "") for part in bashrc.split("/")[1:])
        ):
            error = "HOMEPLANNER_CFD_BASHRC must be a safe absolute Linux path to the reviewed OpenFOAM bashrc."
        return cls(flag == "1" and error is None, distribution, bashrc, platform or sys.platform, error)

    def fingerprint(self) -> str:
        data = json.dumps([self.platform, self.distribution, self.bashrc, ENGINE_VERSION]).encode("utf-8")
        return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class ProcessOutcome:
    returncode: int
    output_bytes: int


class ProcessRunner:
    """Injectable Popen boundary with bounded binary reads and cancellation."""

    def __init__(self, *, popen=None, clock=None, platform: str | None = None):
        self._popen = subprocess.Popen if popen is None else popen
        self._clock = time.monotonic if clock is None else clock
        self._platform = sys.platform if platform is None else platform

    def _stop(self, process, terminate) -> None:
        cleanup_error = None
        for force in (False, True):
            try:
                if terminate is not None:
                    terminate(process, force)
                if self._platform == "win32":
                    (process.kill if force else process.terminate)()
                else:
                    try:
                        os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
                    except ProcessLookupError:
                        pass
            except Exception as exc:
                cleanup_error = exc
                LOGGER.exception("CFD process/group cleanup failed")
                try:
                    (process.kill if force else process.terminate)()
                except OSError:
                    pass
            try:
                process.wait(timeout=1.5)
                if cleanup_error is None:
                    return
            except subprocess.TimeoutExpired:
                continue
        if cleanup_error is not None or process.poll() is None:
            raise CfdError(
                "The owned process group could not be confirmed stopped. A bounded runtime watchdog remains in force.",
                "cancellation_unconfirmed", 500,
            ) from cleanup_error

    def run(
        self,
        argv: list[str],
        *,
        timeout: float,
        max_output: int,
        on_output: Callable[[bytes], None],
        cancel: threading.Event | None = None,
        terminate=None,
        monitor=None,
    ) -> ProcessOutcome:
        cancellation = cancel if cancel is not None else threading.Event()
        if cancellation.is_set():
            raise _Cancelled()
        if timeout <= 0:
            raise CfdError("The local CFD wall-time budget was exhausted.", "time_limit", 409)
        if not argv or not all(isinstance(arg, str) and "\0" not in arg for arg in argv):
            raise CfdError("The reviewed process argument contract is invalid.", "invalid_command", 500)
        env = os.environ.copy()
        for name in ("BASH_ENV", "ENV", "CDPATH"):
            env.pop(name, None)
        options = {
            "stdin": subprocess.DEVNULL, "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT, "shell": False, "bufsize": 0, "env": env,
        }
        if self._platform == "win32":
            options["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            options["start_new_session"] = True
        started = self._clock()
        process = self._popen(argv, **options)
        chunks: queue.Queue = queue.Queue(maxsize=8)
        stop_reader = threading.Event()

        def put(item):
            while not stop_reader.is_set():
                try:
                    chunks.put(item, timeout=0.05)
                    return
                except queue.Full:
                    pass

        def read():
            try:
                while not stop_reader.is_set():
                    data = process.stdout.read(4096)
                    if not data:
                        break
                    put(data)
            except Exception as exc:
                put(exc)
            finally:
                put(None)

        reader = threading.Thread(target=read, name="cfd-process-output", daemon=True)
        total, eof = 0, False
        try:
            reader.start()
            while not (eof and process.poll() is not None):
                if cancellation.is_set():
                    raise _Cancelled()
                if self._clock() - started >= timeout:
                    raise CfdError("The local CFD wall-time budget was exhausted.", "time_limit", 409)
                if monitor is not None:
                    monitor()
                try:
                    item = chunks.get(timeout=0.04)
                except queue.Empty:
                    continue
                if item is None:
                    eof = True
                elif isinstance(item, Exception):
                    raise CfdError("Local process output could not be read.", "process_io_failed", 500) from item
                else:
                    remaining = max(0, max_output - total)
                    if len(item) > remaining:
                        if remaining:
                            on_output(item[:remaining])
                        raise CfdError("The local CFD output budget was exhausted.", "output_limit", 409)
                    total += len(item)
                    on_output(item)
            if cancellation.is_set():
                raise _Cancelled()
            return ProcessOutcome(process.returncode, total)
        except BaseException:
            self._stop(process, terminate)
            raise
        finally:
            stop_reader.set()
            reader.join(timeout=1) if reader.ident is not None else None
            process.stdout.close()


# The only shell programs used by the adapter are these reviewed constants.
# GNU timeout owns a distinct session/group and survives a lost WSL client.
_PROBE_SCRIPT = r"""
set -eo pipefail
ulimit -c 0
ulimit -t 4
ulimit -v 524288
for tool in /usr/bin/setsid /usr/bin/timeout /usr/bin/taskset /bin/kill /bin/sleep; do
    [[ -x "$tool" ]] || exit 42
done
[[ -r "$1" ]] || exit 40
unset WM_PROJECT_VERSION
set +e
source "$1"
source_status=$?
set -e
[[ "$source_status" == 0 ]] || exit 40
[[ "${WM_PROJECT_VERSION:-}" == 2606 || "${WM_PROJECT_VERSION:-}" == v2606 ]] || exit 41
for tool in blockMesh splitMeshRegions checkMesh chtMultiRegionFoam; do
    binary=$(type -P "$tool") || exit 43
    [[ "$binary" == /* && -x "$binary" ]] || exit 43
done
printf '\nHP_CFD_RUNTIME 2606\n'
"""

_STAGE_SCRIPT = r"""
set -eo pipefail
bashrc=$1; case_dir=$2; ready=$3; permit=$4; token=$5
memory_kib=$6; file_kib=$7; cpu_seconds=$8
shift 8
ulimit -c 0
ulimit -v "$memory_kib"
ulimit -f "$file_kib"
ulimit -t "$cpu_seconds"
ulimit -n 128
group=$PPID
IFS= read -r entry < "/proc/$group/stat"
entry=${entry##*) }
read -ra fields <<< "$entry"
[[ "${fields[2]}" == "$group" && "${fields[3]}" == "$group" ]] || exit 45
printf '%s %s %s\n' "$token" "$group" "${fields[19]}" > "$ready"
printf 'HP_CFD_GROUP %s %s %s\n' "$token" "$group" "${fields[19]}"
allowed=no
for ((attempt=0; attempt<50; attempt++)); do
    if [[ -f "$permit" ]]; then
        IFS= read -r marker < "$permit"
        [[ "$marker" == "$token" ]] && allowed=yes && break
        exit 46
    fi
    /bin/sleep 0.1
done
[[ "$allowed" == yes ]] || exit 46
unset WM_PROJECT_VERSION
set +e
source "$bashrc"
source_status=$?
set -e
[[ "$source_status" == 0 ]] || exit 40
[[ "${WM_PROJECT_VERSION:-}" == 2606 || "${WM_PROJECT_VERSION:-}" == v2606 ]] || exit 41
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1
export FOAM_FILEHANDLER=uncollated
cpu=
while IFS=: read -r key value; do
    if [[ "$key" == Cpus_allowed_list ]]; then
        value=${value//[[:space:]]/}
        cpu=${value%%[-,]*}
        break
    fi
done < /proc/self/status
[[ "$cpu" =~ ^[0-9]+$ ]] || exit 47
binary=$(type -P "$1") || exit 43
[[ "$binary" == /* && -x "$binary" ]] || exit 43
shift
cd -- "$case_dir"
exec /usr/bin/taskset -c "$cpu" -- "$binary" "$@"
"""

_STOP_SCRIPT = r"""
set -eo pipefail
group=$1; ticks=$2; token=$3
[[ "$group" =~ ^[0-9]+$ && "$group" -gt 1 && "$ticks" =~ ^[0-9]+$ && "$token" =~ ^[a-f0-9]{32}$ ]] || exit 50
owned() {
    [[ -r "/proc/$group/stat" ]] || return 1
    local entry
    IFS= read -r entry < "/proc/$group/stat" || return 1
    entry=${entry##*) }
    local -a fields
    read -ra fields <<< "$entry"
    [[ "${fields[2]}" == "$group" && "${fields[3]}" == "$group" && "${fields[19]}" == "$ticks" ]] || return 1
    local arg found=no
    while IFS= read -r -d '' arg; do
        [[ "$arg" == "$token" ]] && found=yes
    done < "/proc/$group/cmdline"
    [[ "$found" == yes ]]
}
if owned; then
    /bin/kill -TERM -- "-$group" || true
    for ((attempt=0; attempt<10; attempt++)); do
        owned || break
        /bin/sleep 0.1
    done
    if owned; then
        /bin/kill -KILL -- "-$group" || true
        for ((attempt=0; attempt<10; attempt++)); do
            owned || break
            /bin/sleep 0.05
        done
    fi
fi
owned && exit 51
printf 'HP_CFD_GROUP_STOPPED\n'
"""


class LocalRuntime:
    def __init__(self, config: RuntimeConfig | None = None, *, runner=None, limits: Limits | None = None, clock=None):
        self.config = RuntimeConfig.from_env() if config is None else config
        self.limits = limits or Limits()
        self.runner = runner if runner is not None else ProcessRunner()
        self.clock = time.monotonic if clock is None else clock
        self._lock = threading.Lock()
        self._probe_slot = threading.Lock()
        self._checked = None
        self._execution = None

    def identity(self) -> str:
        return self.config.fingerprint()

    def execution(self) -> dict:
        with self._lock:
            if self.config.error:
                return {"available": False, "status": "not-configured", "message": self.config.error}
            if not self.config.enabled:
                return {
                    "available": False, "status": "not-configured",
                    "message": "Execution is off. Configure the local OpenCFD OpenFOAM v2606 runtime and explicitly set HOMEPLANNER_CFD_ENABLED=1. Case preparation still works.",
                }
            if self.config.platform not in ("win32", "linux"):
                return {"available": False, "status": "unavailable", "message": "This adapter supports Windows WSL2 or native Linux only."}
            if self._execution is None or (
                self._execution["available"] and self.clock() - self._checked > self.limits.readiness_seconds
            ):
                return {
                    "available": False, "status": "unavailable",
                    "message": "Use Check local runtime explicitly before Run. A runtime/version check is not CFD validation.",
                }
            return copy.deepcopy(self._execution)

    def require_ready(self) -> None:
        execution = self.execution()
        if not execution["available"]:
            raise CfdError(execution["message"], "runtime_unavailable", 503)

    def _command(self, args: list[str]) -> list[str]:
        clean = ["/usr/bin/env", "-u", "BASH_ENV", "-u", "ENV", "-u", "CDPATH", *args]
        if self.config.platform == "win32":
            windows = Path(os.environ.get("SystemRoot", r"C:\Windows"))
            return [str(windows.joinpath("System32", "wsl.exe")), "--distribution", self.config.distribution, "--exec", *clean]
        return clean

    def _tool(self, script: str, args: list[str], *, timeout: float, output_limit: int) -> tuple[ProcessOutcome, bytes]:
        output = bytearray()
        command = self._command([
            "/usr/bin/timeout", "--signal=TERM", "--kill-after=1s", f"{max(0.1, timeout - 1):.3f}s",
            "/bin/bash", "--noprofile", "--norc", "-c", script, "homeplanner-cfd", *args,
        ])
        outcome = self.runner.run(command, timeout=timeout, max_output=output_limit, on_output=output.extend)
        return outcome, bytes(output)

    def probe(self) -> dict:
        if self.config.error or not self.config.enabled or self.config.platform not in ("win32", "linux"):
            return self.execution()
        if not self._probe_slot.acquire(blocking=False):
            raise CfdError("An explicit runtime check is already running.", "runtime_busy", 429)
        try:
            try:
                outcome, output = self._tool(
                    _PROBE_SCRIPT, [self.config.bashrc],
                    timeout=self.limits.probe_seconds, output_limit=self.limits.probe_output_bytes,
                )
                messages = {
                    40: "The configured OpenFOAM bashrc is missing. Configure the local v2606 installation; no installer was run.",
                    41: "The configured runtime is not OpenCFD OpenFOAM v2606. An exact 2606/v2606 WM_PROJECT_VERSION is required.",
                    42: "Required local timeout, process-group or CPU-affinity utilities are unavailable.",
                    43: "The v2606 blockMesh, splitMeshRegions, checkMesh and chtMultiRegionFoam binaries must all be available.",
                }
                ready = outcome.returncode == 0 and output.splitlines().count(b"HP_CFD_RUNTIME 2606") == 1
                execution = {
                    "available": ready, "status": "ready" if ready else "unavailable",
                    "message": (
                        "The local v2606 environment and required commands were found. Case execution and physical validation remain unverified."
                        if ready else messages.get(outcome.returncode,
                            "The configured local runtime could not be checked. Verify WSL2, the named distribution and OpenCFD OpenFOAM v2606 manually; preparation/package remain available.")
                    ),
                    "checkedAt": _now(),
                }
            except (OSError, CfdError):
                LOGGER.exception("Explicit local CFD runtime check failed")
                execution = {
                    "available": False, "status": "unavailable", "checkedAt": _now(),
                    "message": "The local runtime is missing, unavailable, timed out or exceeded its check-output budget. Verify the local installation manually; no engine, installer or demonstration result was substituted.",
                }
            with self._lock:
                self._execution, self._checked = execution, self.clock()
            return copy.deepcopy(execution)
        finally:
            self._probe_slot.release()

    def _linux_path(self, directory: Path, *, cancel=None, timeout: float = 4) -> str:
        if self.config.platform == "linux":
            return str(directory)
        output = bytearray()
        command = self._command([
            "/usr/bin/timeout", "--signal=TERM", "--kill-after=1s", "3s",
            "/usr/bin/wslpath", "-a", "-u", str(directory),
        ])
        outcome = self.runner.run(command, timeout=min(4, timeout), max_output=4096, on_output=output.extend, cancel=cancel)
        try:
            value = bytes(output).decode("utf-8").strip()
        except UnicodeDecodeError:
            value = ""
        if (
            outcome.returncode != 0 or not value.startswith("/") or len(value) > 2048
            or any(char in value for char in ("\n", "\r", "\0"))
            or ".." in PurePosixPath(value).parts
        ):
            raise CfdError("The owned job directory could not be translated into the configured local distribution.", "workspace_translation_failed", 503)
        return value

    def _stop_group(self, group: tuple[str, str, str]) -> None:
        token, pid, ticks = group
        try:
            outcome, output = self._tool(_STOP_SCRIPT, [pid, ticks, token], timeout=4, output_limit=2048)
        except Exception as exc:
            LOGGER.exception("Owned Linux process-group stop could not be checked")
            raise CfdError("The owned Linux process group could not be confirmed stopped.", "cancellation_unconfirmed", 500) from exc
        if outcome.returncode != 0 or b"HP_CFD_GROUP_STOPPED" not in output.splitlines():
            raise CfdError("The owned Linux process group could not be confirmed stopped.", "cancellation_unconfirmed", 500)

    def cleanup_job(self, directory: Path, runtime_identity: str) -> None:
        controls = []
        with os.scandir(directory) as entries:
            for entry in entries:
                if re.fullmatch(r"control-[a-f0-9]{32}\.ready", entry.name):
                    controls.append(entry.name)
                    if len(controls) > len(COMMANDS):
                        raise CfdError("An interrupted job has excessive control records.", "invalid_saved_job", 409)
        if controls and runtime_identity != self.identity():
            raise CfdError(
                "An interrupted case needs its original server runtime configuration to confirm owned-process cleanup.",
                "interrupted_runtime_changed", 409,
            )
        for name in controls:
            self._stop_group(_read_group(directory, name, name[8:40]))

    def run_stage(
        self, command: tuple[str, ...], directory: Path, *,
        timeout: float, cancel: threading.Event, on_output, monitor,
    ) -> ProcessOutcome:
        if command not in COMMANDS:
            raise CfdError("Only the fixed reviewed serial commands may execute.", "invalid_command", 400)
        if cancel.is_set():
            raise _Cancelled()
        started = time.monotonic()
        linux = self._linux_path(directory, cancel=cancel, timeout=timeout)
        timeout -= time.monotonic() - started
        if cancel.is_set():
            raise _Cancelled()
        if timeout <= 0:
            raise CfdError("The job exhausted its wall-time budget during path translation.", "time_limit", 409)
        controller = _StageController(self, directory, cancel)
        argv = self._command([
            "/usr/bin/setsid", "--wait",
            "/usr/bin/timeout", "--signal=TERM", "--kill-after=2s", f"{timeout:.3f}s",
            "/bin/bash", "--noprofile", "--norc", "-c", _STAGE_SCRIPT, "homeplanner-cfd",
            self.config.bashrc, linux + "/case",
            linux + "/" + controller.ready_name, linux + "/" + controller.permit_name,
            controller.token, str(self.limits.memory_bytes // 1024), str(self.limits.max_file_bytes // 1024),
            str(max(1, math.ceil(timeout))),
            *command,
        ])

        def output(data):
            controller.feed(data)
            on_output(data)

        outcome = self.runner.run(
            argv, timeout=timeout + 0.1, max_output=self.limits.max_log_bytes,
            on_output=output, cancel=cancel, terminate=controller.stop, monitor=monitor,
        )
        # A WSL client can exit without its Linux child. Confirm/stop the exact
        # recorded group even when the outer process reports a normal exit.
        controller.stop(None)
        if outcome.returncode in (124, 137):
            raise CfdError("The runtime watchdog or resource limit stopped this stage.", "runtime_limit", 409)
        if outcome.returncode != 0:
            raise CfdError("A local CFD stage exited unsuccessfully. Review the retained local engine log.", "engine_failed", 409)
        if not controller.permitted:
            raise CfdError("The engine stage has no verified owned-process start.", "stage_start_failed", 500)
        return outcome


def _read_group(directory: Path, name: str, token: str) -> tuple[str, str, str]:
    data = read_bounded_file(directory, name, 160)
    match = re.fullmatch(rb"([a-f0-9]{32}) ([0-9]{1,10}) ([0-9]{1,20})\n", data)
    if not match:
        raise CfdError("An owned process control record is invalid.", "invalid_process_record", 409)
    values = tuple(part.decode("ascii") for part in match.groups())
    if values[0] != token or not 1 < int(values[1]) < 2 ** 31:
        raise CfdError("An owned process control record does not match this stage.", "invalid_process_record", 409)
    return values


class _StageController:
    def __init__(self, runtime: LocalRuntime, directory: Path, cancel: threading.Event):
        self.runtime, self.directory, self.cancel = runtime, directory, cancel
        self.token = uuid.uuid4().hex
        self.ready_name = f"control-{self.token}.ready"
        self.permit_name = f"control-{self.token}.permit"
        self.permitted = False
        self._stopping = False
        self._stopped = False
        self._group = None
        self._pending = b""
        self._lock = threading.Lock()

    def feed(self, data: bytes) -> None:
        if self.permitted or self._stopping:
            return
        self._pending += data
        if len(self._pending) > 4096:
            raise CfdError("The process-start handshake exceeded its output budget.", "stage_start_failed", 500)
        while b"\n" in self._pending:
            line, self._pending = self._pending.split(b"\n", 1)
            if not line.startswith(b"HP_CFD_GROUP "):
                continue
            with self._lock:
                self._group = _read_group(self.directory, self.ready_name, self.token)
                expected = ("HP_CFD_GROUP " + " ".join(self._group)).encode("ascii")
                if line != expected:
                    raise CfdError("The owned process-start handshake is inconsistent.", "stage_start_failed", 500)
                if not self._stopping and not self.cancel.is_set():
                    _write_new(self.directory.joinpath(self.permit_name), (self.token + "\n").encode("ascii"))
                    self.permitted = True

    def stop(self, _process, _force=False) -> None:
        with self._lock:
            if self._stopped:
                return
            self._stopping = True
            group = self._group
            if group is None and self.directory.joinpath(self.ready_name).exists():
                group = _read_group(self.directory, self.ready_name, self.token)
        if group is not None:
            self.runtime._stop_group(group)
            with self._lock:
                self._stopped = True
        # With no permit, a late WSL start can only wait at the bounded gate;
        # it cannot source the engine environment or execute a mesh/solver.


def _check_directory_chain(directory: Path) -> None:
    for path in reversed((directory, *directory.parents)):
        try:
            info = reject_link(path)
        except FileNotFoundError:
            continue
        if not stat.S_ISDIR(info.st_mode):
            raise CfdError("The local CFD workspace has a non-directory ancestor.", "unsafe_workspace", 503)


def _write_new(path: Path, data: bytes) -> None:
    _check_directory_chain(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _atomic_write(path: Path, data: bytes) -> None:
    _check_directory_chain(path.parent)
    if path.exists():
        info = reject_link(path)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise CfdError("A saved CFD file is not an owned regular file.", "unsafe_workspace", 409)
    pending = path.with_name(path.name + ".write-" + uuid.uuid4().hex)
    try:
        _write_new(pending, data)
        os.replace(pending, path)
        if os.name != "nt":
            descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if pending.exists():
            pending.unlink()


def _measure_tree(root: Path, max_entries: int, max_bytes: int) -> tuple[int, int]:
    entries_seen, size = 0, 0
    pending = [(root, 0)]
    while pending:
        directory, depth = pending.pop()
        if depth > 12:
            raise CfdError("Local CFD output exceeds its directory-depth budget.", "disk_limit", 409)
        if not stat.S_ISDIR(reject_link(directory).st_mode):
            raise CfdError("The local CFD workspace is not a regular directory.", "unsafe_workspace", 409)
        with os.scandir(directory) as entries:
            for entry in entries:
                entries_seen += 1
                if entries_seen > max_entries:
                    raise CfdError("Local CFD output exceeds its file-entry budget. Retained cases were not deleted.", "disk_limit", 409)
                path = Path(entry.path)
                info = reject_link(path)
                if stat.S_ISDIR(info.st_mode):
                    pending.append((path, depth + 1))
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    size += info.st_size
                    if size > max_bytes:
                        raise CfdError("Local CFD output exceeds its disk-byte budget. Retained cases were not deleted.", "disk_limit", 409)
                else:
                    raise CfdError("Nonregular or linked files are not accepted in a CFD workspace.", "unsafe_workspace", 409)
    return entries_seen, size


class _WorkspaceLease:
    def __init__(self, descriptor):
        self.descriptor = descriptor

    @classmethod
    def acquire(cls, root: Path, *, create: bool):
        path = root.joinpath(".runner.lock")
        _check_directory_chain(root)
        try:
            info = reject_link(path)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1:
                raise CfdError("The workspace ownership lock is invalid.", "unsafe_workspace", 409)
        except FileNotFoundError:
            if not create:
                return None
        flags = os.O_RDWR | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        if create:
            flags |= os.O_CREAT
        descriptor = os.open(path, flags, 0o600)
        try:
            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"1")
            os.lseek(descriptor, 0, os.SEEK_SET)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(descriptor)
            raise CfdError("A local CFD job already owns this workspace. There is no waiting queue.", "queue_full", 429) from exc
        return cls(descriptor)

    def close(self) -> None:
        if self.descriptor is not None:
            descriptor, self.descriptor = self.descriptor, None
            os.close(descriptor)


def _workspace_from_env() -> Path:
    raw = os.environ.get("HOMEPLANNER_CFD_WORKSPACE")
    if raw is None:
        if sys.platform == "win32":
            root = Path(os.environ.get("LOCALAPPDATA", str(Path.home().joinpath("AppData", "Local"))))
            directory = root.joinpath("HomePlanner", "cfd")
        else:
            root = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home().joinpath(".cache"))))
            directory = root.joinpath("homeplanner", "cfd")
    else:
        directory = Path(raw)
    if (
        not directory.is_absolute() or ".." in directory.parts
        or str(directory).startswith(("\\\\", "//"))
        or directory == REPOSITORY or directory.is_relative_to(REPOSITORY)
        or len(directory.parts) < 3
    ):
        raise CfdError(
            "HOMEPLANNER_CFD_WORKSPACE must name a dedicated absolute local cache directory outside the repository.",
            "workspace_not_configured", 503,
        )
    return directory


_GENERATED_FILES = {"manifest.json", "request.json", "README.txt", "README.md", "constant/regionProperties", "constant/g"}
for _region in ("", "air/", "solid/"):
    for _name in ("controlDict", "blockMeshDict", "fvSchemes", "fvSolution", "probes"):
        _GENERATED_FILES.add("system/" + _region + _name)
    for _name in ("thermophysicalProperties", "turbulenceProperties", "transportProperties", "radiationProperties",
                  "combustionProperties", "hRef", "g", "fvOptions"):
        _GENERATED_FILES.add("constant/" + _region + _name)
    for _time_dir in ("0", "0.orig"):
        for _name in ("T", "U", "p", "p_rgh", "alphat", "k", "epsilon", "omega", "nut", "rho", "betavSolid"):
            _GENERATED_FILES.add(_time_dir + "/" + _region + _name)
del _region, _name, _time_dir


def _validate_manifest(manifest, limits: Limits) -> None:
    if (
        type(manifest) is not dict or type(manifest.get("version")) is not int or manifest["version"] != 1
        or manifest.get("profile") != PROFILE or manifest.get("engine") != ENGINE
        or manifest.get("coordinateSpace") != COORDINATE_SPACE
        or manifest.get("commands") != [list(command) for command in COMMANDS]
        or not isinstance(manifest.get("caseHash"), str)
        or not re.fullmatch(r"[a-f0-9]{64}", manifest["caseHash"])
    ):
        raise CfdError("The compiler returned an unsupported case/engine/command contract.", "invalid_compiled_case", 500)
    source = manifest.get("source")
    if (
        type(source) is not dict or set(source) != SOURCE_KEYS
        or type(source.get("revision")) is not int or source["revision"] < 0
        or any(
            not isinstance(source[key], str) or not source[key]
            for key in SOURCE_KEYS - {"revision"}
        )
        or any(len(source[key]) > 512 for key in ("projectId", "floorId", "roomId"))
    ):
        raise CfdError("The compiled source identity is incomplete.", "invalid_compiled_case", 500)
    probes = manifest.get("probeLocations")
    if not isinstance(probes, list) or not 1 <= len(probes) <= MAX_PROBES:
        raise CfdError("The compiled receiver count is unsupported.", "invalid_compiled_case", 500)
    for point in probes:
        if type(point) is not dict or set(point) != {"x", "y", "z"}:
            raise CfdError("The compiled receiver positions are invalid.", "invalid_compiled_case", 500)
        for value in point.values():
            if type(value) not in (int, float) or not math.isfinite(value):
                raise CfdError("The compiled receiver positions must be finite.", "invalid_compiled_case", 500)
    if type(manifest.get("geometry")) is not dict or type(manifest.get("scenario")) is not dict:
        raise CfdError("The compiler must retain the actual geometry and explicit scenario.", "invalid_compiled_case", 500)
    numerics = manifest["scenario"].get("numerics")
    if type(numerics) is not dict:
        raise CfdError("The compiled numerical inputs are missing.", "invalid_compiled_case", 500)
    _positive_number(numerics.get("maxRuntimeSeconds"), limits.max_wall_seconds, "maxRuntimeSeconds")
    _positive_number(numerics.get("endTimeSeconds"), 10 ** 9, "endTimeSeconds")
    _positive_number(manifest.get("receiverHeightM"), 10 ** 4, "receiverHeightM")
    directory = safe_relative_path(manifest.get("probeOutputDirectory", "postProcessing/air/probes/0"))
    if directory.parts[0] != "postProcessing" or len(directory.parts) < 3:
        raise CfdError("The compiled probe-output path is invalid.", "invalid_compiled_case", 500)
    if not isinstance(manifest.get("limitations"), list) or any(not isinstance(item, str) for item in manifest["limitations"]):
        raise CfdError("The compiler must report its model limitations.", "invalid_compiled_case", 500)


def _compiled_case(payload, compiler, limits: Limits) -> dict:
    if type(payload) is not dict:
        raise CfdError("Supply the compiler's single-room JSON payload, without a case or job wrapper.")
    _json_bytes(payload, MAX_PAYLOAD_BYTES)
    if compiler is None:
        try:
            from cfd_case import CfdInputError, prepare_case
        except ImportError as exc:
            raise CfdError("The local case compiler is unavailable. No case or result was substituted.", "compiler_unavailable", 503) from exc
        try:
            prepared = prepare_case(payload)
        except CfdInputError as exc:
            raise CfdError(str(exc), exc.code, exc.status) from exc
    else:
        prepared = compiler(payload)
    if type(prepared) is not dict or set(prepared) != {"manifest", "files"}:
        raise CfdError("The case compiler returned an invalid package.", "invalid_compiled_case", 500)
    manifest = prepared["manifest"]
    _json_bytes(manifest, limits.max_json_bytes)
    _validate_manifest(manifest, limits)
    files = prepared["files"]
    if type(files) is not dict or not 1 <= len(files) <= limits.max_generated_files:
        raise CfdError("The compiled file count exceeds its budget.", "invalid_compiled_case", 500)
    files = files.copy()
    if "manifest.json" in files:
        if not isinstance(files["manifest.json"], str) or decode_json(files["manifest.json"].encode("utf-8"), limits.max_json_bytes) != manifest:
            raise CfdError("The compiled manifest file is inconsistent.", "invalid_compiled_case", 500)
    else:
        files["manifest.json"] = _json_bytes(manifest, limits.max_json_bytes).decode("utf-8")
    if "request.json" not in files:
        files["request.json"] = _json_bytes(payload, MAX_PAYLOAD_BYTES).decode("utf-8")
    if len(files) > limits.max_generated_files:
        raise CfdError("The complete case package exceeds its file budget.", "invalid_compiled_case", 500)
    total = 0
    for name, text in files.items():
        safe_relative_path(name)
        if name not in _GENERATED_FILES or not isinstance(text, str) or "\0" in text:
            raise CfdError("Only reviewed generated case filenames and UTF-8 text are accepted.", "invalid_compiled_case", 500)
        data = text.encode("utf-8")
        total += len(data)
        if len(data) > limits.max_file_bytes or total > limits.max_generated_bytes:
            raise CfdError("The generated case exceeds its byte budget.", "invalid_compiled_case", 500)
        if name not in ("manifest.json", "request.json", "README.md", "README.txt") and re.search(
            r"#\s*(?:codeStream|calc|eval)\b|\b(?:codedFixedValue|codedMixed|codedSource|systemCall)\b", text
        ):
            raise CfdError("Executable dictionary extensions are not supported.", "invalid_compiled_case", 500)
    return {"manifest": copy.deepcopy(manifest), "files": files}


def _public_log_line(text: str, limit: int) -> str:
    if text.startswith("HP_CFD_GROUP "):
        return "[Owned runtime process group registered]"
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text)
    text = re.sub(r"(?:[A-Za-z]:[\\/]|\\\\)[^\r\n\"'<>]*", "[local path]", text)
    text = re.sub(r"(?<![\w.])/(?:[^\s\"'<>]+)", "[local path]", text)
    return text[:max(0, limit - 1)] + "…" if len(text) > limit else text


@dataclass
class _Job:
    snapshot: dict
    manifest: dict
    directory: Path
    runtime_identity: str
    result_hash: str | None = None
    result: dict | None = None
    cleanup_verified: bool = False
    owned: bool = False
    shutdown_requested: bool = False
    cancellation: threading.Event = field(default_factory=threading.Event)


class _JobLog:
    def __init__(self, job: _Job, service):
        self.job, self.service = job, service
        path = job.directory.joinpath("engine.log")
        self.stream = os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600), "wb")
        self.count = 0
        self.pending = b""
        self.evidence = None

    def _line(self, raw: bytes) -> None:
        text = raw.decode("utf-8", errors="replace").rstrip("\r")
        with self.service._lock:
            tail = self.job.snapshot["logTail"]
            tail.append(_public_log_line(text, self.service.limits.log_tail_chars))
            del tail[:-self.service.limits.log_tail_lines]
            self.job.snapshot["updatedAt"] = _now()
        if self.evidence is not None:
            self.evidence.line(text)

    def feed(self, data: bytes) -> None:
        remaining = max(0, self.service.limits.max_log_bytes - self.count)
        self.stream.write(data[:remaining])
        self.stream.flush()
        self.count += min(len(data), remaining)
        if len(data) > remaining:
            raise CfdError("The retained engine log reached its byte budget.", "output_limit", 409)
        self.pending += data
        while b"\n" in self.pending:
            line, self.pending = self.pending.split(b"\n", 1)
            if len(line) > self.service.limits.max_log_line_bytes:
                raise CfdError("An engine log line exceeded its byte budget.", "output_limit", 409)
            self._line(line)
        if len(self.pending) > self.service.limits.max_log_line_bytes:
            raise CfdError("An engine log line exceeded its byte budget.", "output_limit", 409)

    def finish_stage(self) -> None:
        if self.pending:
            self._line(self.pending)
            self.pending = b""
        self.evidence = None

    def retain_exception(self) -> None:
        detail = ("\n[Local runtime exception; not solver output]\n" + traceback.format_exc()).encode("utf-8", errors="replace")
        remaining = max(0, self.service.limits.max_log_bytes - self.count)
        self.stream.write(detail[:remaining])
        self.stream.flush()
        self.count += min(len(detail), remaining)

    def close(self) -> None:
        if not self.stream.closed:
            try:
                self.stream.flush()
                os.fsync(self.stream.fileno())
            finally:
                self.stream.close()


class CfdService:
    def __init__(
        self, *, runtime=None, compiler=None, workspace_root: Path | None = None,
        limits: Limits | None = None, thread_factory=None,
    ):
        self.limits = limits or Limits()
        self.runtime = runtime if runtime is not None else LocalRuntime(limits=self.limits)
        self.compiler = compiler
        self._root_override = workspace_root
        self._thread_factory = threading.Thread if thread_factory is None else thread_factory
        self._lock = threading.RLock()
        self._slot = threading.BoundedSemaphore(1)
        self._prepare_slots = threading.BoundedSemaphore(2)
        self._jobs: dict[str, _Job] = {}
        self._worker = None
        self._active_id = None
        self._closed = False

    def capabilities(self) -> dict:
        return {
            "version": 1, "profile": PROFILE, "casePreparation": True,
            "execution": self.runtime.execution(), "runtimeVerification": "pending",
            "limits": self.limits.public(),
        }

    def probe(self) -> dict:
        with self._lock:
            if self._closed:
                raise CfdError("The local CFD service is shutting down.", "service_closed", 503)
            if self._active_id is not None:
                raise CfdError("A local CFD run is active; wait before checking the runtime again.", "runtime_busy", 429)
        self.runtime.probe()
        return self.capabilities()

    def _compile(self, payload) -> dict:
        if not self._prepare_slots.acquire(blocking=False):
            raise CfdError("Local case preparation is busy. No request was queued.", "preparation_busy", 429)
        try:
            return _compiled_case(payload, self.compiler, self.limits)
        finally:
            self._prepare_slots.release()

    def prepare(self, payload) -> dict:
        return {"status": "prepared", "manifest": self._compile(payload)["manifest"]}

    def package(self, payload) -> bytes:
        prepared = self._compile(payload)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, text in sorted(prepared["files"].items()):
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(info, text.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
        return stream.getvalue()

    def _root(self) -> Path:
        root = Path(self._root_override) if self._root_override is not None else _workspace_from_env()
        if not root.is_absolute() or ".." in root.parts or str(root).startswith(("\\\\", "//")):
            raise CfdError("The server-owned CFD workspace must be an absolute local directory.", "workspace_not_configured", 503)
        _check_directory_chain(root)
        return root

    def _persist(self, job: _Job) -> None:
        state = {
            "version": 1, "job": job.snapshot, "manifest": job.manifest,
            "runtimeIdentity": job.runtime_identity, "resultSha256": job.result_hash,
            "cleanupVerified": job.cleanup_verified,
        }
        _atomic_write(job.directory.joinpath("state.json"), _json_bytes(state, self.limits.max_json_bytes))

    def _transition(self, job: _Job, status: str, message: str, *, stage=None, diagnostic=None) -> None:
        with self._lock:
            candidate = copy.deepcopy(job.snapshot)
            candidate.update(status=status, message=message, updatedAt=_now(), diagnostic=diagnostic)
            candidate["resultAvailable"] = status == "completed" and job.result is not None
            if stage is not None:
                candidate["stage"] = stage
            before, job.snapshot = job.snapshot, candidate
            try:
                self._persist(job)
            except Exception:
                job.snapshot = before
                raise

    def _load(self, job_id: str, root: Path) -> _Job:
        directory = root.joinpath(job_id)
        if not directory.exists():
            raise CfdError("Local CFD job not found.", "job_not_found", 404)
        try:
            data = read_bounded_file(directory, "state.json", self.limits.max_json_bytes)
            state = decode_json(data, self.limits.max_json_bytes)
            if type(state) is not dict or set(state) != {"version", "job", "manifest", "runtimeIdentity", "resultSha256", "cleanupVerified"}:
                raise ValueError("State schema mismatch")
            snapshot, manifest = state["job"], state["manifest"]
            if (
                type(state["version"]) is not int or state["version"] != 1
                or type(snapshot) is not dict or set(snapshot) != SNAPSHOT_KEYS
                or snapshot["id"] != job_id or snapshot["status"] not in STATUSES
                or not isinstance(state["runtimeIdentity"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", state["runtimeIdentity"])
                or type(state["cleanupVerified"]) is not bool
                or not isinstance(snapshot["logTail"], list)
                or len(snapshot["logTail"]) > self.limits.log_tail_lines
                or any(not isinstance(line, str) or len(line) > self.limits.log_tail_chars + 1 for line in snapshot["logTail"])
            ):
                raise ValueError("State ownership/status mismatch")
            _validate_manifest(manifest, self.limits)
            if snapshot["caseHash"] != manifest["caseHash"] or snapshot["source"] != manifest["source"]:
                raise ValueError("State provenance mismatch")
            for key in ("message", "stage", "createdAt", "updatedAt"):
                if not isinstance(snapshot[key], str) or len(snapshot[key]) > 1000:
                    raise ValueError("State text mismatch")
            if snapshot["diagnostic"] is not None and (
                type(snapshot["diagnostic"]) is not dict or set(snapshot["diagnostic"]) != {"code", "message"}
                or any(not isinstance(value, str) or len(value) > 1000 for value in snapshot["diagnostic"].values())
            ):
                raise ValueError("State diagnostic mismatch")
            snapshot["logTail"] = [_public_log_line(line, self.limits.log_tail_chars) for line in snapshot["logTail"]]
            job = _Job(snapshot, manifest, directory, state["runtimeIdentity"], state["resultSha256"],
                       cleanup_verified=state["cleanupVerified"])
            job.snapshot["resultAvailable"] = False
            if snapshot["status"] == "completed":
                result_bytes = read_bounded_file(directory, "result.json", self.limits.max_result_bytes)
                if hashlib.sha256(result_bytes).hexdigest() != job.result_hash:
                    raise ValueError("Result integrity mismatch")
                result = decode_json(result_bytes, self.limits.max_result_bytes)
                if (
                    type(result) is not dict or result.get("version") != 1
                    or result.get("kind") != "CoupledCfdResult" or result.get("validationStatus") != "unvalidated"
                    or result.get("source") != manifest["source"] or result.get("caseHash") != manifest["caseHash"]
                    or result.get("engine") != ENGINE or result.get("coordinateSpace") != COORDINATE_SPACE
                    or not isinstance(result.get("samples"), list) or len(result["samples"]) != len(manifest["probeLocations"])
                ):
                    raise ValueError("Result provenance mismatch")
                job.result, job.snapshot["resultAvailable"] = result, True
            return job
        except (CfdError, CfdResultError, ValueError, KeyError, TypeError, OSError) as exc:
            LOGGER.exception("Saved CFD job %s could not be loaded", job_id)
            raise CfdError("Saved CFD state is invalid or incomplete. Its local files were retained, not replaced.", "invalid_saved_job", 409) from exc

    def _record(self, job_id) -> _Job:
        job_id = _uuid(job_id)
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None and (job.owned or job.snapshot["status"] in TERMINAL):
                return job
            root = self._root()
            job = self._load(job_id, root)
            if job.snapshot["status"] not in TERMINAL:
                lease = None
                try:
                    lease = _WorkspaceLease.acquire(root, create=False)
                except CfdError as exc:
                    if exc.code == "queue_full":
                        return job
                    raise
                try:
                    self._transition(job, "interrupted", "The owning server stopped before this job was durably completed.",
                                     diagnostic={"code": "process_interrupted", "message": "Partial case files/logs were retained; no computed result is available."})
                finally:
                    if lease:
                        lease.close()
            if len(self._jobs) < self.limits.max_jobs:
                self._jobs[job_id] = job
            return job

    def get_job(self, job_id) -> dict:
        with self._lock:
            return copy.deepcopy(self._record(job_id).snapshot)

    def get_result(self, job_id) -> dict:
        with self._lock:
            job = self._record(job_id)
            if job.snapshot["status"] != "completed" or job.result is None:
                raise CfdError("This job has no complete computed result. Review its status and diagnostic.", "result_not_ready", 409)
            return {"status": "computed-unvalidated", "result": copy.deepcopy(job.result)}

    def cancel(self, job_id) -> dict:
        with self._lock:
            job = self._record(job_id)
            if job.snapshot["status"] in TERMINAL:
                return copy.deepcopy(job.snapshot)
            if not job.owned:
                raise CfdError("This active job is owned by another local server. Cancel it through its owning server.", "job_owned_elsewhere", 409)
            job.cancellation.set()
            self._transition(job, "cancelling", "Cancellation requested for this job's owned processes only.")
            return copy.deepcopy(job.snapshot)

    def _retained_jobs(self, root: Path) -> list[_Job]:
        _measure_tree(root, self.limits.max_stored_files, self.limits.max_stored_bytes)
        retained = []
        with os.scandir(root) as entries:
            for entry in entries:
                if entry.name == ".runner.lock":
                    continue
                try:
                    job_id = _uuid(entry.name)
                except CfdError:
                    raise CfdError("The dedicated CFD cache contains an unknown entry. No retained files were deleted.", "unsafe_workspace", 409) from None
                retained.append(self._load(job_id, root))
                if len(retained) >= self.limits.max_jobs:
                    raise CfdError("The retained-case budget is full. Explicitly archive reviewed local cases before another run; nothing was deleted.", "retention_limit", 429)
        for job in retained:
            if job.snapshot["status"] not in TERMINAL:
                self._transition(job, "interrupted", "A previous server stopped before durable completion.",
                                 diagnostic={"code": "process_interrupted", "message": "Partial case files/logs were retained without a computed result."})
        return retained

    def submit(self, payload) -> dict:
        self.runtime.require_ready()
        if not self._slot.acquire(blocking=False):
            raise CfdError("One local CFD run is already active. There is no waiting queue.", "queue_full", 429)
        lease = None
        try:
            with self._lock:
                if self._closed:
                    raise CfdError("The local CFD service is shutting down.", "service_closed", 503)
            prepared = self._compile(payload)
            root = self._root()
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            _check_directory_chain(root)
            lease = _WorkspaceLease.acquire(root, create=True)
            retained = self._retained_jobs(root)
            job_id, stamp = str(uuid.uuid4()), _now()
            directory = root.joinpath(job_id)
            directory.mkdir(mode=0o700)
            manifest = prepared["manifest"]
            job = _Job({
                "id": job_id, "status": "preparing", "message": "Preparing the owned local case; no computed result exists.",
                "caseHash": manifest["caseHash"], "source": copy.deepcopy(manifest["source"]),
                "stage": "prepare", "createdAt": stamp, "updatedAt": stamp, "logTail": [],
                "resultAvailable": False, "diagnostic": None,
            }, manifest, directory, self.runtime.identity(), owned=True)
            with self._lock:
                if self._closed:
                    raise CfdError("The local CFD service is shutting down.", "service_closed", 503)
                self._persist(job)
                if len(self._jobs) >= self.limits.max_jobs:
                    for cached_id, cached in tuple(self._jobs.items()):
                        if not cached.owned:
                            self._jobs.pop(cached_id)
                            if len(self._jobs) < self.limits.max_jobs:
                                break
                self._jobs[job_id] = job
                self._active_id = job_id
                response = copy.deepcopy(job.snapshot)
                worker = self._thread_factory(
                    target=self._run, args=(job, prepared["files"], retained, lease),
                    name=f"cfd-job-{job_id[:8]}", daemon=True,
                )
                self._worker = worker
                try:
                    worker.start()
                except Exception:
                    self._active_id = None
                    job.owned = False
                    self._transition(job, "failed", "The local worker could not start.",
                                     diagnostic={"code": "worker_unavailable", "message": "No engine process was started."})
                    raise
            lease = None
            return response
        except Exception:
            if lease is not None:
                lease.close()
            self._slot.release()
            raise

    def _check_cancel(self, job: _Job, deadline: float) -> None:
        if job.cancellation.is_set():
            raise _Cancelled()
        if time.monotonic() >= deadline:
            raise CfdError("The job exhausted its total wall-time budget.", "time_limit", 409)

    def _run(self, job: _Job, files: dict, retained: list[_Job], lease: _WorkspaceLease) -> None:
        log = None
        deadline = time.monotonic() + job.manifest["scenario"]["numerics"]["maxRuntimeSeconds"]
        last_check = last_persist = 0.0

        def monitor(force=False):
            nonlocal last_check, last_persist
            self._check_cancel(job, deadline)
            instant = time.monotonic()
            if force or instant - last_check >= 0.25:
                _measure_tree(job.directory, self.limits.max_case_files, self.limits.max_case_bytes)
                _measure_tree(job.directory.parent, self.limits.max_stored_files, self.limits.max_stored_bytes)
                last_check = instant
            if instant - last_persist >= 1:
                with self._lock:
                    self._persist(job)
                last_persist = instant

        def retain_failure():
            if log is not None:
                try:
                    log.retain_exception()
                except Exception:
                    LOGGER.exception("CFD internal failure details could not be retained in the case log")

        try:
            self._check_cancel(job, deadline)
            log = _JobLog(job, self)
            for old in retained:
                self._check_cancel(job, deadline)
                if not old.cleanup_verified:
                    self.runtime.cleanup_job(old.directory, old.runtime_identity)
                    old.cleanup_verified = True
                    self._persist(old)
            case_dir = job.directory.joinpath("case")
            case_dir.mkdir(mode=0o700)
            for name, text in files.items():
                self._check_cancel(job, deadline)
                path = case_dir.joinpath(*safe_relative_path(name).parts)
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                _write_new(path, text.encode("utf-8"))
            monitor(force=True)
            evidence = {}
            for command, stage in zip(COMMANDS, STAGES):
                self._check_cancel(job, deadline)
                self._transition(job, "running", "Executing the fixed local serial stage.", stage=stage)
                evidence[stage] = StageEvidence()
                log.evidence = evidence[stage]
                outcome = self.runtime.run_stage(
                    command, job.directory, timeout=max(0.001, deadline - time.monotonic()),
                    cancel=job.cancellation, on_output=log.feed, monitor=monitor,
                )
                if not isinstance(outcome, ProcessOutcome) or outcome.returncode != 0:
                    raise CfdError("A local CFD stage exited unsuccessfully.", "engine_failed", 409)
                log.finish_stage()
                evidence[stage].require_complete(
                    mesh=stage.startswith("checkMesh-"),
                    end=job.manifest["scenario"]["numerics"]["endTimeSeconds"] if stage == "chtMultiRegionFoam" else None,
                )
                monitor(force=True)
            self._check_cancel(job, deadline)
            self._transition(job, "running", "Checking actual bounded probe output and execution evidence.", stage="parse-results")
            result = parse_results(
                case_dir, job.manifest, evidence,
                max_probe_bytes=self.limits.max_probe_bytes, max_rows=self.limits.max_probe_rows,
            )
            data = _json_bytes(result, self.limits.max_result_bytes)
            self._check_cancel(job, deadline)
            log.close()
            log = None
            with self._lock:
                self._check_cancel(job, deadline)
                _atomic_write(job.directory.joinpath("result.json"), data)
                monitor(force=True)
                self._check_cancel(job, deadline)
                job.result, job.result_hash = result, hashlib.sha256(data).hexdigest()
                job.cleanup_verified = True
                self._transition(job, "completed", "Actual local engine samples are available, unvalidated.", stage="complete")
        except _Cancelled:
            self._fail(job, "interrupted" if job.shutdown_requested else "cancelled",
                       "The owning server stopped this job." if job.shutdown_requested else "This job was cancelled; no computed result is published.",
                       "server_shutdown" if job.shutdown_requested else "cancelled")
        except CfdResultError as exc:
            retain_failure()
            LOGGER.exception("CFD job %s rejected output", job.snapshot["id"])
            self._fail(job, "failed", str(exc), exc.code)
        except CfdError as exc:
            retain_failure()
            LOGGER.exception("CFD job %s stopped", job.snapshot["id"])
            self._fail(job, "failed", str(exc), exc.code)
        except Exception:
            retain_failure()
            LOGGER.exception("CFD job %s failed internally", job.snapshot["id"])
            self._fail(job, "failed", "Local execution or persistence failed. Review the retained local log and server log.", "execution_failed")
        finally:
            if log is not None:
                try:
                    log.close()
                except OSError:
                    LOGGER.exception("CFD log could not be flushed")
            lease.close()
            with self._lock:
                job.owned = False
                self._active_id = None
                self._slot.release()

    def _fail(self, job: _Job, status: str, message: str, code: str) -> None:
        with self._lock:
            job.result, job.result_hash = None, None
            job.cleanup_verified = code not in {"cancellation_unconfirmed", "interrupted_runtime_changed"}
            try:
                self._transition(job, status, message, diagnostic={"code": code, "message": message})
            except Exception:
                LOGGER.exception("CFD failure state could not be persisted for %s", job.snapshot["id"])
                job.snapshot.update(
                    status="failed", resultAvailable=False, updatedAt=_now(),
                    message="The job failed and its final state could not be saved. Retained files were not removed.",
                    diagnostic={"code": "persistence_failed", "message": "Review the local storage and server log before retrying."},
                )

    def shutdown(self) -> None:
        with self._lock:
            self._closed = True
            job = self._jobs.get(self._active_id)
            worker = self._worker
            if job is not None and job.snapshot["status"] not in TERMINAL:
                job.shutdown_requested = True
                job.cancellation.set()
                try:
                    self._transition(job, "cancelling", "The local server is shutting down this owned job.")
                except Exception:
                    LOGGER.exception("CFD shutdown state could not be persisted")
        if worker is not None and worker is not threading.current_thread() and worker.ident is not None:
            worker.join(timeout=self.limits.stop_seconds)
            if worker.is_alive() and job is not None:
                self._fail(job, "interrupted", "Shutdown did not finish within its wait budget; the owned runtime watchdog remains active.", "cancellation_unconfirmed")
