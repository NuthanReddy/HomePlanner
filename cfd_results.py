"""Bounded, strict readers for the local single-room CHT profile.

These readers establish output completeness, not CFD validation. In particular,
OpenFOAM's reported normalized continuity errors are not mass-flow residuals.
"""
from __future__ import annotations

import copy
import math
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


PROFILE = "single-room-cht-v1"
ENGINE = {"id": "OpenCFD-OpenFOAM", "version": "2606", "solver": "chtMultiRegionFoam"}
COORDINATE_SPACE = "room-right-front-up"
MAX_PROBES = 512
MAX_PROBE_BYTES = 8 * 1024 * 1024
MAX_PROBE_LINE_BYTES = 512 * 1024
MAX_TIME_SAMPLES = 20_000
LOCATION_ABS_TOLERANCE_M = 1e-6
TIME_ABS_TOLERANCE_SECONDS = 1e-7
NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
_NUMBER = re.compile(rf"{NUMBER}\Z")
_LOCATION = re.compile(rf"#\s*Probe\s+(\d+)\s+\(\s*({NUMBER})\s+({NUMBER})\s+({NUMBER})\s*\)\s*\Z")
_FATAL = re.compile(
    r"FOAM\s+FATAL(?:\s+IO)?\s+ERROR|FOAM\s+exiting|floating.point.exception|"
    r"segmentation.fault|MPI_ABORT|std::bad_alloc|out.of.memory|"
    r"failed\s+\d+\s+mesh\s+checks|mesh\s+failed|"
    r"\b(?:nan|[+-]?inf(?:inity)?)\b",
    re.IGNORECASE,
)
_CONTINUITY = re.compile(
    rf"time step continuity errors\s*:\s*sum local\s*=\s*({NUMBER})"
    rf"\s*,\s*global\s*=\s*({NUMBER})\s*,\s*cumulative\s*=\s*({NUMBER})",
    re.IGNORECASE,
)


class CfdResultError(Exception):
    def __init__(self, message: str, code: str = "invalid_result"):
        super().__init__(message)
        self.code = code


def _finite(value, message: str) -> float:
    if type(value) not in (int, float):
        raise CfdResultError(message)
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise CfdResultError(message) from None
    if not math.isfinite(result):
        raise CfdResultError(message)
    return result


def _number(text: str) -> float:
    if len(text) > 64 or not _NUMBER.fullmatch(text):
        raise CfdResultError("A probe or diagnostic contains an invalid numeric value.")
    return _finite(float(text), "A probe or diagnostic contains a nonfinite value.")


def safe_relative_path(value: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or len(value) > 240:
        raise CfdResultError("An output path is not a supported generated relative path.")
    parts = value.split("/")
    if (
        len(parts) > 8
        or any(part in ("", ".", "..") or not re.fullmatch(r"[A-Za-z0-9_.+-]+", part) for part in parts)
        or any(part.endswith((".", " ")) for part in parts)
        or PurePosixPath(value).is_absolute()
    ):
        raise CfdResultError("An output path is not a supported generated relative path.")
    return PurePosixPath(value)


def reject_link(path: Path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise CfdResultError("Linked or redirected local CFD files are not accepted.", "unsafe_workspace")
    return info


def read_bounded_file(root: Path, relative: str, limit: int) -> bytes:
    path = root
    try:
        if not stat.S_ISDIR(reject_link(root).st_mode):
            raise CfdResultError("The local CFD output directory is unavailable.")
        for part in safe_relative_path(relative).parts:
            path = path.joinpath(part)
            info = reject_link(path)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise CfdResultError("A local CFD file exceeds its byte budget or is not a regular owned file.")
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(path, flags), "rb") as stream:
            opened = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise CfdResultError("A local CFD file changed while it was being opened.")
            data = stream.read(limit + 1)
            if len(data) > limit:
                raise CfdResultError("A local CFD file exceeds its byte budget.")
            return data
    except (FileNotFoundError, NotADirectoryError):
        raise CfdResultError("Required local CFD output is missing or incomplete.") from None
    except OSError as exc:
        raise CfdResultError("Required local CFD output could not be read.") from exc


def reaches_end(value: float, end: float) -> bool:
    return math.isclose(value, end, rel_tol=1e-9, abs_tol=TIME_ABS_TOLERANCE_SECONDS)


@dataclass
class StageEvidence:
    ended: bool = False
    mesh_ok: bool = False
    last_time: float | None = None
    continuity: dict | None = None

    def line(self, text: str) -> None:
        if _FATAL.search(text):
            raise CfdResultError("The engine log contains a fatal, nonfinite or failed-mesh diagnostic.", "engine_diagnostic")
        if text.strip() == "End":
            self.ended = True
        if re.fullmatch(r"\s*Mesh OK\.\s*", text):
            self.mesh_ok = True
        if re.match(r"^\s*Time\s*=", text):
            match = re.fullmatch(rf"\s*Time\s*=\s*({NUMBER})\s*", text)
            if not match:
                raise CfdResultError("The solver reported an invalid elapsed time.", "engine_diagnostic")
            value = _number(match.group(1))
            if value < 0 or (self.last_time is not None and value < self.last_time):
                raise CfdResultError("The solver reported a reversed elapsed time.", "engine_diagnostic")
            self.last_time = value
        if "time step continuity errors" in text.lower():
            match = _CONTINUITY.search(text)
            if not match:
                raise CfdResultError("The solver reported an unreadable continuity diagnostic.", "engine_diagnostic")
            values = [_number(item) for item in match.groups()]
            self.continuity = dict(
                status="reported-not-validated",
                normalization="OpenFOAM solver-reported normalized errors; not kg/s residuals.",
                sumLocal=values[0],
                globalError=values[1],
                cumulative=values[2],
                timeSeconds=self.last_time,
            )

    def require_complete(self, *, mesh: bool = False, end: float | None = None) -> None:
        if not self.ended or (mesh and not self.mesh_ok):
            raise CfdResultError("The engine did not report complete, successful mesh/stage checks.", "incomplete_engine_log")
        if end is not None and (self.last_time is None or not reaches_end(self.last_time, end)):
            raise CfdResultError("The solver log did not reach the requested end time.", "incomplete_engine_log")


def result_diagnostics(evidence: dict[str, StageEvidence], end: float) -> dict:
    for stage in ("blockMesh", "splitMeshRegions", "checkMesh-air", "checkMesh-solid", "chtMultiRegionFoam"):
        if not isinstance(evidence.get(stage), StageEvidence):
            raise CfdResultError("Required execution evidence is missing.", "incomplete_engine_log")
        evidence[stage].require_complete(
            mesh=stage.startswith("checkMesh-"),
            end=end if stage == "chtMultiRegionFoam" else None,
        )
    solver = evidence["chtMultiRegionFoam"]
    return {
        "meshChecks": {
            region: {"status": "passed", "method": "checkMesh -allTopology -allGeometry", "source": "process-log"}
            for region in ("air", "solid")
        },
        "solverTermination": {
            "status": "completed",
            "requestedEndTimeSeconds": end,
            "reportedEndTimeSeconds": solver.last_time,
        },
        "normalizedContinuityErrors": copy.deepcopy(solver.continuity) if solver.continuity else {
            "status": "not-reported",
            "message": "No supported normalized continuity diagnostic was found; no mass residual was invented.",
        },
        "energyBalance": {
            "status": "not-evaluated",
            "message": "An integrated fluid/solid boundary and storage energy ledger is not implemented.",
        },
        "meshConvergence": {"status": "not-evaluated", "message": "No spatial refinement study has been performed."},
        "timeStepConvergence": {"status": "not-evaluated", "message": "No temporal refinement study has been performed."},
    }


def _probe_field(data: bytes, expected: list[dict], *, vector: bool, max_rows: int) -> tuple[list[float], list]:
    if not data or not data.endswith(b"\n"):
        raise CfdResultError("Probe output is empty or has a truncated final line.")
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        raise CfdResultError("Only bounded ASCII OpenFOAM probe output is supported.") from None
    if re.search(r"[^\x09\x0a\x0d\x20-\x7e]", text):
        raise CfdResultError("Probe output contains unsupported control bytes.")
    locations = []
    time_header = False
    times: list[float] = []
    last: list = []
    for line in text.splitlines():
        if len(line) > MAX_PROBE_LINE_BYTES:
            raise CfdResultError("A probe row exceeds its line budget.")
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            if times:
                raise CfdResultError("Repeated or appended probe headers are not accepted.")
            location = _LOCATION.fullmatch(line)
            if location:
                index = int(location.group(1))
                if time_header or index != len(locations) or index >= len(expected):
                    raise CfdResultError("Probe header indices do not match the prepared receiver count.")
                point = dict(zip(("x", "y", "z"), (_number(value) for value in location.groups()[1:])))
                for key in ("x", "y", "z"):
                    if not math.isclose(point[key], expected[index][key], rel_tol=1e-9, abs_tol=LOCATION_ABS_TOLERANCE_M):
                        raise CfdResultError("Probe header positions do not match the prepared receivers.")
                locations.append(point)
            elif re.match(r"#\s*Time(?:\s|$)", line):
                if time_header or len(locations) != len(expected):
                    raise CfdResultError("Probe output is missing its expected location headers.")
                indices = re.sub(r"^#\s*Time\s*", "", line).split()
                if indices != [str(index) for index in range(len(expected))]:
                    raise CfdResultError("Probe time columns do not match the prepared receiver count.")
                time_header = True
            else:
                raise CfdResultError("An unsupported probe header was found.")
            continue
        if not time_header or len(locations) != len(expected):
            raise CfdResultError("Probe output has no complete location/time header.")
        tokens = re.findall(r"\(|\)|[^\s()]+", line)
        count = 5 if vector else 1
        if len(tokens) != 1 + count * len(expected):
            raise CfdResultError("Probe output has missing or extra field components.")
        instant = _number(tokens[0])
        if instant < 0 or (times and instant <= times[-1]) or len(times) >= max_rows:
            raise CfdResultError("Probe sample times are reversed, repeated or exceed the row budget.")
        times.append(instant)
        if vector:
            last = []
            for offset in range(1, len(tokens), 5):
                if tokens[offset] != "(" or tokens[offset + 4] != ")":
                    raise CfdResultError("Velocity probes must contain exactly three parenthesized components.")
                last.append(tuple(_number(value) for value in tokens[offset + 1:offset + 4]))
        else:
            last = [_number(value) for value in tokens[1:]]
    if not times:
        raise CfdResultError("Probe output contains no computed samples.")
    return times, last


def parse_results(
    case_dir: Path,
    manifest: dict,
    evidence: dict[str, StageEvidence],
    *,
    max_probe_bytes: int = MAX_PROBE_BYTES,
    max_rows: int = MAX_TIME_SAMPLES,
) -> dict:
    if (
        not isinstance(manifest, dict)
        or manifest.get("version") != 1
        or manifest.get("profile") != PROFILE
        or manifest.get("engine") != ENGINE
        or manifest.get("coordinateSpace") != COORDINATE_SPACE
    ):
        raise CfdResultError("The prepared output profile or engine is unsupported.")
    expected = manifest.get("probeLocations")
    if not isinstance(expected, list) or not 1 <= len(expected) <= MAX_PROBES:
        raise CfdResultError("The prepared receiver count is missing or exceeds the supported budget.")
    for point in expected:
        if not isinstance(point, dict) or set(point) != {"x", "y", "z"}:
            raise CfdResultError("A prepared receiver position is invalid.")
        for value in point.values():
            _finite(value, "A prepared receiver position is nonfinite.")
    try:
        end = _finite(manifest["scenario"]["numerics"]["endTimeSeconds"], "The requested end time is invalid.")
        height = _finite(manifest["receiverHeightM"], "The receiver height is invalid.")
    except (KeyError, TypeError):
        raise CfdResultError("The requested time or receiver height is missing.") from None
    if end <= 0 or height <= 0:
        raise CfdResultError("The requested time and receiver height must be positive.")
    diagnostics = result_diagnostics(evidence, end)
    directory = manifest.get("probeOutputDirectory", "postProcessing/air/probes/0")
    relative = safe_relative_path(directory)
    if relative.parts[0] != "postProcessing" or len(relative.parts) < 3:
        raise CfdResultError("The prepared probe output directory is unsupported.")
    fields = {}
    sample_times = None
    for name in ("T", "U", "p"):
        data = read_bounded_file(case_dir, f"{directory}/{name}", max_probe_bytes)
        times, values = _probe_field(data, expected, vector=name == "U", max_rows=max_rows)
        if sample_times is not None and (
            len(times) != len(sample_times)
            or any(not reaches_end(a, b) for a, b in zip(times, sample_times))
        ):
            raise CfdResultError("Temperature, velocity and pressure sample times do not match.")
        sample_times = times
        fields[name] = values
    if not reaches_end(sample_times[-1], end):
        raise CfdResultError("The last probe samples do not reach the requested end time.")
    samples = []
    for index, position in enumerate(expected):
        temperature, pressure = fields["T"][index], fields["p"][index]
        velocity = fields["U"][index]
        speed = math.hypot(*velocity)
        if temperature <= 0 or pressure <= 0 or not math.isfinite(speed):
            raise CfdResultError("Probe temperatures, absolute pressures or velocity magnitudes are outside their domains.")
        samples.append({
            "positionM": copy.deepcopy(position),
            "temperatureC": temperature - 273.15,
            "velocityMps": dict(zip(("x", "y", "z"), velocity)),
            "speedMps": speed,
            "absolutePressurePa": pressure,
        })
    return {
        "version": 1,
        "kind": "CoupledCfdResult",
        "caseHash": manifest["caseHash"],
        "source": copy.deepcopy(manifest["source"]),
        "engine": copy.deepcopy(ENGINE),
        "coordinateSpace": COORDINATE_SPACE,
        "timeSeconds": sample_times[-1],
        "receiverHeightM": height,
        "samples": samples,
        "diagnostics": diagnostics,
        "limitations": copy.deepcopy(manifest.get("limitations", [])) + [
            "Computed OpenFOAM samples are unvalidated, not measured indoor conditions.",
            "Passing mesh checks and reaching the end time do not establish numerical convergence or empirical validity.",
            "Integrated energy balance and mesh/time-step refinement have not been evaluated.",
            "Pressure samples are absolute p in Pa, not gauge driving pressure or p_rgh.",
        ],
        "validationStatus": "unvalidated",
    }
