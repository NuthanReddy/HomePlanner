"""Pure, bounded compiler for an unverified OpenCFD OpenFOAM v2606 CHT case.

The wire request is not an OpenFOAM dictionary. Only generated identifiers and
validated numbers enter dictionaries. No filesystem, engine, or network access
is performed here. A caller must enforce the manifest's wall-clock budget.

Configuration contracts were checked against the OpenCFD OpenFOAM-v2606 tag:
chtMultiRegionFoam/multiRegionHeater, splitMeshRegions, prghPressure, and Probes.
This is not evidence that the generated case has passed an OpenFOAM execution.
"""

from copy import deepcopy
from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import math
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


PROFILE = "single-room-cht-v1"
ENGINE_VERSION = "2606"
MAX_PAYLOAD_BYTES = 262144

MAX_CELLS = 100000
MAX_BLOCKS = 12000
MAX_OPENINGS = 32
MAX_PROBES = 512
MAX_STEPS = 10000
MAX_CELL_STEPS = 100000000
MAX_WRITES = 200
MAX_CELL_WRITES = 2000000
MAX_PROBE_SAMPLES = 100000
MAX_RUNTIME_SECONDS = 1800
MIN_FEATURE_M = 0.005
GEOMETRY_ABS_TOLERANCE_M = 1e-9
MAX_CASE_BYTES = 16777216
GRAVITY_MPS2 = 9.80665
GAS_CONSTANT_J_KMOL_K = 8314.46261815324

_SIDES = ("N", "E", "S", "W")
_ENVELOPE = (*_SIDES, "floor", "ceiling")
_COMMANDS = (
    ("blockMesh",),
    ("splitMeshRegions", "-cellZones", "-overwrite"),
    ("checkMesh", "-region", "air", "-allTopology", "-allGeometry"),
    ("checkMesh", "-region", "solid", "-allTopology", "-allGeometry"),
    ("chtMultiRegionFoam",),
)
_CASE_PATHS = frozenset((
    "system/blockMeshDict", "system/controlDict",
    "system/fvSchemes", "system/fvSolution",
    "system/air/fvSchemes", "system/air/fvSolution",
    "system/solid/fvSchemes", "system/solid/fvSolution",
    "constant/regionProperties", "constant/g", "constant/air/hRef",
    "constant/air/thermophysicalProperties", "constant/air/turbulenceProperties",
    "constant/air/combustionProperties", "constant/air/radiationProperties",
    "constant/solid/thermophysicalProperties", "constant/solid/radiationProperties",
    "0/air/U", "0/air/T", "0/air/p", "0/air/p_rgh",
    "0/solid/T", "0/solid/p", "0/solid/betavSolid",
))
_JSON = json.JSONEncoder(
    ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"),
)
_UPSTREAM = (
    "https://gitlab.com/openfoam/core/openfoam/-/raw/OpenFOAM-v2606/"
)


class CfdInputError(ValueError):
    def __init__(self, message, code="invalid_input", status=400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status

    def public(self):
        return {
            "status": "error",
            "error": {"code": self.code, "message": self.message},
        }


def _object(value, names, path):
    if type(value) is not dict:
        raise CfdInputError(f"{path} must be an object.")
    required = set(names.split())
    if len(value) > len(required):
        raise CfdInputError(f"{path} must match the fixed schema. Unknown fields are not supported.")
    if any(type(key) is not str for key in value):
        raise CfdInputError(f"{path} must have string keys.")
    if set(value) != required:
        missing = ", ".join(sorted(required - value.keys()))
        detail = f" Missing: {missing}." if missing else ""
        if value.keys() - required:
            detail += " Unknown fields are not supported."
        raise CfdInputError(f"{path} must match the fixed schema.{detail}")
    return value


def _list(value, path, maximum, minimum=0):
    if type(value) is not list or not minimum <= len(value) <= maximum:
        raise CfdInputError(
            f"{path} must be an array with {minimum}..{maximum} entries."
        )
    return value


def _utf8_length(value):
    total = 0
    for char in value:
        point = ord(char)
        if 0xD800 <= point <= 0xDFFF:
            raise CfdInputError("Strings must contain valid Unicode scalar values.")
        total += 1 if point < 128 else 2 if point < 2048 else 3 if point < 65536 else 4
    return total


def _string(value, path, maximum=256):
    if type(value) is not str or not 0 < len(value) <= maximum or not value.strip():
        raise CfdInputError(f"{path} must be a nonempty bounded string.")
    if _utf8_length(value) > maximum:
        raise CfdInputError(f"{path} exceeds its UTF-8 byte limit.")
    return value


def _payload_budget(size):
    if size > MAX_PAYLOAD_BYTES:
        raise CfdInputError(
            f"CFD request exceeds {MAX_PAYLOAD_BYTES} UTF-8 bytes.",
            "payload_too_large", 413,
        )


def _opaque_fingerprint(value, path):
    """Preserve canonical browser text, subject only to the whole-payload limit."""
    if type(value) is not str or not value:
        raise CfdInputError(f"{path} must be a nonempty opaque string.")
    _payload_budget(len(value))
    if not value.strip():
        raise CfdInputError(f"{path} must be a nonempty opaque string.")
    _payload_budget(_utf8_length(value))
    return value


def _number(value, path, minimum, maximum):
    if type(value) not in (int, float):
        raise CfdInputError(f"{path} must be a finite number, not a boolean or null.")
    if type(value) is float and not math.isfinite(value):
        raise CfdInputError(f"{path} must be finite.")
    if not minimum <= value <= maximum:
        raise CfdInputError(f"{path} must be in [{minimum}, {maximum}].")
    return value


def _integer(value, path, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise CfdInputError(f"{path} must be an integer in [{minimum}, {maximum}].")
    return value


def _enum(value, values, path):
    if type(value) is not str or value not in values:
        raise CfdInputError(f"{path} has an unsupported value.")
    return value


def _temperature(value, path):
    return _number(value, path, -100, 300)


def _roundoff(*values):
    return 32 * math.ulp(max(1.0, *(abs(value) for value in values)))


def _geometry_tolerance(geometry):
    rect = geometry["rect"]
    return max(
        GEOMETRY_ABS_TOLERANCE_M,
        _roundoff(
            rect["x"], rect["y"], rect["x"] + rect["w"], rect["y"] + rect["h"],
            geometry["floorElevationM"], geometry["floorElevationM"] + geometry["heightM"],
        ),
    )


def _end(start, length, limit, path, tolerance):
    value = start + length
    if value > limit and value - limit > tolerance:
        raise CfdInputError(f"{path} extends beyond the room.")
    return value


def _rect(value, path, dimension_limit):
    _object(value, "x y w h", path)
    for name in ("x", "y"):
        _number(value[name], f"{path}.{name}", -1000000, 1000000)
    for name in ("w", "h"):
        _number(
            value[name], f"{path}.{name}",
            0.2 - GEOMETRY_ABS_TOLERANCE_M, dimension_limit + GEOMETRY_ABS_TOLERANCE_M,
        )


def _validate_request(payload):
    _object(payload, "version profile source geometry scenario", "request")
    _integer(payload["version"], "version", 1, 1)
    _enum(payload["profile"], (PROFILE,), "profile")
    source = _object(
        payload["source"],
        "projectId floorId roomId revision inputFingerprint geometryFingerprint",
        "source",
    )
    for name in ("projectId", "floorId", "roomId"):
        _string(source[name], f"source.{name}", 16384)
    for name in ("inputFingerprint", "geometryFingerprint"):
        _opaque_fingerprint(source[name], f"source.{name}")
    _integer(source["revision"], "source.revision", 0, 9007199254740991)

    geometry = _object(
        payload["geometry"],
        "coordinateSpace rect sourceRoomRect floorElevationM headingDeg heightM walls openings",
        "geometry",
    )
    _enum(geometry["coordinateSpace"], ("site-local",), "geometry.coordinateSpace")
    _rect(geometry["rect"], "geometry.rect", 30)
    _rect(geometry["sourceRoomRect"], "geometry.sourceRoomRect", 100)
    _number(geometry["floorElevationM"], "geometry.floorElevationM", -1000, 10000)
    _number(geometry["headingDeg"], "geometry.headingDeg", -360, 360)
    height = _number(geometry["heightM"], "geometry.heightM", 0.5, 10)
    geometry_tolerance = _geometry_tolerance(geometry)
    walls = {}
    wall_ids = set()
    for i, wall in enumerate(_list(geometry["walls"], "geometry.walls", 4, 4)):
        path = f"geometry.walls[{i}]"
        _object(wall, "side thicknessM sourceIds", path)
        side = _enum(wall["side"], _SIDES, f"{path}.side")
        if side in walls:
            raise CfdInputError("Each of N, E, S, W must have exactly one wall.")
        _number(wall["thicknessM"], f"{path}.thicknessM", 0.02, 1)
        for identity in _list(wall["sourceIds"], f"{path}.sourceIds", 64, 1):
            _string(identity, f"{path}.sourceIds entry", 16384)
            if identity in wall_ids:
                raise CfdInputError("Wall sourceIds must be unique, including across sides.")
            wall_ids.add(identity)
        walls[side] = wall

    opening_ids = set()
    apertures = []
    openings = _list(geometry["openings"], "geometry.openings", MAX_OPENINGS)
    for i, opening in enumerate(openings):
        path = f"geometry.openings[{i}]"
        _object(
            opening,
            "id wallId side offsetM widthM sillM heightM openFraction kind adjacent",
            path,
        )
        identity = _string(opening["id"], f"{path}.id", 16384)
        if identity in opening_ids:
            raise CfdInputError("Geometric opening IDs must be unique.")
        opening_ids.add(identity)
        side = _enum(opening["side"], _SIDES, f"{path}.side")
        wall_id = _string(opening["wallId"], f"{path}.wallId", 16384)
        if wall_id not in walls[side]["sourceIds"]:
            raise CfdInputError(f"{path}.wallId must resolve to its declared wall side.")
        _string(opening["kind"], f"{path}.kind", 64)
        _enum(
            opening["adjacent"], ("outside", "adjacent-room", "unknown"),
            f"{path}.adjacent",
        )
        length = geometry["rect"]["w" if side in ("N", "S") else "h"]
        offset = _number(opening["offsetM"], f"{path}.offsetM", 0, length)
        width = _number(opening["widthM"], f"{path}.widthM", MIN_FEATURE_M, length)
        sill = _number(opening["sillM"], f"{path}.sillM", 0, height)
        aperture_height = _number(
            opening["heightM"], f"{path}.heightM", MIN_FEATURE_M, height,
        )
        end = _end(offset, width, length, path, geometry_tolerance)
        top = _end(sill, aperture_height, height, path, geometry_tolerance)
        fraction = _number(opening["openFraction"], f"{path}.openFraction", 0, 1)
        if fraction not in (0, 1):
            raise CfdInputError(
                "Only fully open (1) or fully closed (0) apertures are supported.",
                "unsupported_feature",
            )
        for other_side, left, right, bottom, other_top in apertures:
            if other_side != side:
                continue
            horizontal_gap = max(left - end, offset - right)
            vertical_gap = max(bottom - top, sill - other_top)
            if horizontal_gap < 0 and vertical_gap < 0:
                raise CfdInputError("Opening rectangles on a wall must not overlap.")
            if max(horizontal_gap, vertical_gap) < MIN_FEATURE_M - geometry_tolerance:
                raise CfdInputError(
                    f"Separate apertures on one wall need at least {MIN_FEATURE_M} m "
                    "of separation; touching apertures are unsupported.",
                    "unsupported_feature",
                )
        apertures.append((side, offset, end, sill, top))

    scenario = _object(
        payload["scenario"],
        "sourceNote acknowledgeGeometry acknowledgeEmptyRoom acknowledgeModel "
        "floorThicknessM ceilingThicknessM air solid boundaries openings numerics sampling",
        "scenario",
    )
    _string(scenario["sourceNote"], "scenario.sourceNote", 4096)
    for name in ("acknowledgeGeometry", "acknowledgeEmptyRoom", "acknowledgeModel"):
        if scenario[name] is not True:
            raise CfdInputError(f"scenario.{name} must explicitly be true.")
    for name in ("floorThicknessM", "ceilingThicknessM"):
        _number(scenario[name], f"scenario.{name}", 0.02, 1)

    air = _object(
        scenario["air"],
        "initialC pressurePa molarMassGmol cpJkgK muPaS prandtl",
        "scenario.air",
    )
    _temperature(air["initialC"], "scenario.air.initialC")
    _number(air["pressurePa"], "scenario.air.pressurePa", 1000, 2000000)
    _number(air["molarMassGmol"], "scenario.air.molarMassGmol", 1, 200)
    _number(air["cpJkgK"], "scenario.air.cpJkgK", 100, 10000)
    _number(air["muPaS"], "scenario.air.muPaS", 0.0000001, 0.001)
    _number(air["prandtl"], "scenario.air.prandtl", 0.05, 100)
    if air["cpJkgK"] <= GAS_CONSTANT_J_KMOL_K / air["molarMassGmol"]:
        raise CfdInputError("The ideal-gas inputs must give positive Cv = Cp - R.")
    solid = _object(
        scenario["solid"], "initialC densityKgM3 cpJkgK conductivityWmK", "scenario.solid",
    )
    _temperature(solid["initialC"], "scenario.solid.initialC")
    _number(solid["densityKgM3"], "scenario.solid.densityKgM3", 1, 30000)
    _number(solid["cpJkgK"], "scenario.solid.cpJkgK", 1, 10000)
    _number(solid["conductivityWmK"], "scenario.solid.conductivityWmK", 0.001, 500)
    boundaries = _object(scenario["boundaries"], "N E S W floor ceiling", "scenario.boundaries")
    for side in _ENVELOPE:
        _temperature(boundaries[side], f"scenario.boundaries.{side}")

    condition_ids = set()
    by_id = {opening["id"]: opening for opening in openings}
    modes = set()
    for i, condition in enumerate(_list(scenario["openings"], "scenario.openings", MAX_OPENINGS)):
        path = f"scenario.openings[{i}]"
        _object(condition, "id mode temperatureC speedMps gaugePressurePa", path)
        identity = _string(condition["id"], f"{path}.id", 16384)
        if identity in condition_ids or identity not in by_id:
            raise CfdInputError("Opening conditions must have unique, resolved geometric IDs.")
        condition_ids.add(identity)
        mode = _enum(condition["mode"], ("inlet", "outlet", "closed"), f"{path}.mode")
        modes.add(mode)
        _temperature(condition["temperatureC"], f"{path}.temperatureC")
        expected_fraction = 0 if mode == "closed" else 1
        if by_id[identity]["openFraction"] != expected_fraction:
            raise CfdInputError("A scenario cannot override a geometric opening's operation.")
        if mode == "inlet":
            _number(condition["speedMps"], f"{path}.speedMps", 0.000001, 20)
        elif condition["speedMps"] is not None:
            raise CfdInputError(f"{path}.speedMps must be null for {mode}.")
        if mode == "outlet":
            gauge = _number(condition["gaugePressurePa"], f"{path}.gaugePressurePa", -2000000, 2000000)
            if air["pressurePa"] + gauge <= 0:
                raise CfdInputError("Outlet absolute static pressure must be positive.")
            if gauge != 0 and air["pressurePa"] + gauge == air["pressurePa"]:
                raise CfdInputError("Outlet gauge pressure is too small to resolve against the absolute reference.")
        elif condition["gaugePressurePa"] is not None:
            raise CfdInputError(f"{path}.gaugePressurePa must be null for {mode}.")
    if condition_ids != opening_ids:
        raise CfdInputError("Every geometric opening must have exactly one condition.")
    if "inlet" in modes and "outlet" not in modes:
        raise CfdInputError("A prescribed inlet requires at least one pressure outlet.")

    numerics = _object(
        scenario["numerics"],
        "spacingM solidCells deltaTSeconds endTimeSeconds writeIntervalSeconds maxCo maxRuntimeSeconds",
        "scenario.numerics",
    )
    _number(numerics["spacingM"], "scenario.numerics.spacingM", 0.02, 2)
    _integer(numerics["solidCells"], "scenario.numerics.solidCells", 2, 16)
    _number(numerics["deltaTSeconds"], "scenario.numerics.deltaTSeconds", 0.00001, 10)
    _number(numerics["endTimeSeconds"], "scenario.numerics.endTimeSeconds", 0.00001, 3600)
    _number(numerics["writeIntervalSeconds"], "scenario.numerics.writeIntervalSeconds", 0.00001, 3600)
    _number(numerics["maxCo"], "scenario.numerics.maxCo", 0.01, 1)
    _number(numerics["maxRuntimeSeconds"], "scenario.numerics.maxRuntimeSeconds", 1, MAX_RUNTIME_SECONDS)
    sampling = _object(scenario["sampling"], "heightM columns rows", "scenario.sampling")
    _number(sampling["heightM"], "scenario.sampling.heightM", MIN_FEATURE_M, height - MIN_FEATURE_M)
    _integer(sampling["columns"], "scenario.sampling.columns", 1, MAX_PROBES)
    _integer(sampling["rows"], "scenario.sampling.rows", 1, MAX_PROBES)

    # Streaming the size check also bounds JSON escaping without allocating a
    # large canonical string. The schema above rejects cycles and non-JSON types.
    size = 0
    for chunk in _JSON.iterencode(payload):
        size += _utf8_length(chunk)
        _payload_budget(size)
    return deepcopy(payload)


def _budget(value, maximum, description):
    if value > maximum:
        raise CfdInputError(
            f"{description} ({value}) exceeds the profile budget ({maximum}); "
            "change the explicit inputs. Nothing was coarsened or truncated.",
            "budget_exceeded",
        )


def _step_count(duration, delta, description):
    ratio = duration / delta
    count = round(ratio)
    if count < 1 or not math.isclose(ratio, count, rel_tol=1e-12, abs_tol=1e-9):
        raise CfdInputError(f"{description} must be a positive integer number of fixed timesteps.")
    return count


@dataclass(frozen=True)
class _Axis:
    points: tuple
    cells: tuple
    alignment_tolerance: float
    maximum_alignment: float

    def index(self, coordinate):
        for index, point in enumerate(self.points):
            if abs(point - coordinate) <= self.alignment_tolerance:
                return index
        raise RuntimeError("Compiler axis is missing a validated feature.")

    def count(self, lower, upper):
        return sum(self.cells[self.index(lower):self.index(upper)])

    def manifest(self):
        return {
            "breakpointsM": list(self.points),
            "cellsPerInterval": list(self.cells),
            "spacingPerIntervalM": [
                (high - low) / count
                for low, high, count in zip(self.points, self.points[1:], self.cells)
            ],
            "maximumFeatureAlignmentM": self.maximum_alignment,
        }


def _axis(dimension, before, after, features, spacing, solid_cells, tolerance):
    anchors = (-before, 0.0, dimension, dimension + after)
    # Domain planes always win over an almost-coincident aperture plane. Choosing
    # the first sorted coordinate instead could subtly shrink the actual room.
    anchored_features = [
        next((anchor for anchor in anchors if abs(anchor - feature) <= tolerance), feature)
        for feature in features
    ]
    points = sorted({*anchors, *anchored_features})
    unique = []
    for point in points:
        if unique and point - unique[-1] <= tolerance:
            continue
        if unique and point - unique[-1] < MIN_FEATURE_M - tolerance:
            raise CfdInputError(
                f"Structured mesh feature planes must be at least {MIN_FEATURE_M} m apart.",
                "unsupported_feature",
            )
        unique.append(point)
    cells = []
    for index, (low, high) in enumerate(zip(unique, unique[1:])):
        ratio = (high - low) / spacing
        nearest = round(ratio)
        if math.isclose(ratio, nearest, rel_tol=1e-12, abs_tol=1e-12):
            ratio = nearest
        count = max(1, math.ceil(ratio))
        if index in (0, len(unique) - 2):
            count = max(solid_cells, count)
        cells.append(count)
    maximum_alignment = max(
        (min(abs(point - feature) for point in unique) for feature in features), default=0.0,
    )
    return _Axis(tuple(unique), tuple(cells), tolerance, maximum_alignment)


def _plan(request):
    geometry, scenario = request["geometry"], request["scenario"]
    numerics, sampling = scenario["numerics"], scenario["sampling"]
    width, depth, height = geometry["rect"]["w"], geometry["rect"]["h"], geometry["heightM"]
    alignment_tolerance = _geometry_tolerance(geometry)
    steps = _step_count(numerics["endTimeSeconds"], numerics["deltaTSeconds"], "End time")
    write_steps = _step_count(
        numerics["writeIntervalSeconds"], numerics["deltaTSeconds"], "Write interval",
    )
    if write_steps > steps or steps % write_steps:
        raise CfdInputError("End time must be an integer multiple of the write interval.")
    probes = sampling["columns"] * sampling["rows"]
    writes = steps // write_steps
    _budget(steps, MAX_STEPS, "Timesteps")
    _budget(writes, MAX_WRITES, "Field writes")
    _budget(probes, MAX_PROBES, "Slice probes")
    _budget(probes * (writes + 1), MAX_PROBE_SAMPLES, "Probe-time samples including time zero")
    thickness = {wall["side"]: wall["thicknessM"] for wall in geometry["walls"]}
    thickness.update(floor=scenario["floorThicknessM"], ceiling=scenario["ceilingThicknessM"])
    conditions = {condition["id"]: condition for condition in scenario["openings"]}
    features = [[], [], []]
    openings = []
    for index, opening in enumerate(geometry["openings"]):
        side = opening["side"]
        offset, size, sill = opening["offsetM"], opening["widthM"], opening["sillM"]
        top = _end(sill, opening["heightM"], height, "Opening", alignment_tolerance)
        along_end = _end(
            offset, size, width if side in ("N", "S") else depth, "Opening", alignment_tolerance,
        )
        if side in ("N", "S"):
            lower = (offset, depth if side == "N" else -thickness["S"], sill)
            upper = (along_end, depth + thickness["N"] if side == "N" else 0.0, top)
            features[0].extend((offset, along_end))
            normal_axis = 1
        else:
            low_y, high_y = depth - along_end, depth - offset
            lower = (width if side == "E" else -thickness["W"], low_y, sill)
            upper = (width + thickness["E"] if side == "E" else 0.0, high_y, top)
            features[1].extend((low_y, high_y))
            normal_axis = 0
        features[2].extend((sill, top))
        condition = conditions[opening["id"]]
        openings.append({
            "index": index, "source": opening, "condition": condition,
            "lower": lower, "upper": upper, "normalAxis": normal_axis,
            "patch": f"closed_{index:03d}" if condition["mode"] == "closed" else f"opening_{index:03d}",
            "revealPatch": f"reveal_{index:03d}",
            "temperatureK": condition["temperatureC"] + 273.15,
        })
    axes = (
        _axis(width, thickness["W"], thickness["E"], features[0], numerics["spacingM"], numerics["solidCells"], alignment_tolerance),
        _axis(depth, thickness["S"], thickness["N"], features[1], numerics["spacingM"], numerics["solidCells"], alignment_tolerance),
        _axis(height, thickness["floor"], thickness["ceiling"], features[2], numerics["spacingM"], numerics["solidCells"], alignment_tolerance),
    )
    grid_blocks = math.prod(len(axis.cells) for axis in axes)
    _budget(grid_blocks, MAX_BLOCKS, "Structured grid blocks before closed-sleeve exclusion")
    outer_cells = math.prod(sum(axis.cells) for axis in axes)
    room_cells = math.prod(axis.count(0, dimension) for axis, dimension in zip(axes, (width, depth, height)))
    sleeve_cells = 0
    excluded_cells = 0
    inlet_courant_bounds = []
    for opening in openings:
        opening["indexLower"] = tuple(axis.index(low) for axis, low in zip(axes, opening["lower"]))
        opening["indexUpper"] = tuple(axis.index(high) for axis, high in zip(axes, opening["upper"]))
        opening["requestedLower"], opening["requestedUpper"] = opening["lower"], opening["upper"]
        opening["lower"] = tuple(axis.points[index] for axis, index in zip(axes, opening["indexLower"]))
        opening["upper"] = tuple(axis.points[index] for axis, index in zip(axes, opening["indexUpper"]))
        count = math.prod(axis.count(low, high) for axis, low, high in zip(axes, opening["lower"], opening["upper"]))
        opening["cells"] = count
        sleeve_cells += count
        if opening["condition"]["mode"] == "closed":
            excluded_cells += count
        if opening["condition"]["mode"] == "inlet":
            normal = opening["normalAxis"]
            axis = axes[normal]
            normal_cells = axis.count(opening["lower"][normal], opening["upper"][normal])
            normal_spacing = (opening["upper"][normal] - opening["lower"][normal]) / normal_cells
            courant = opening["condition"]["speedMps"] * numerics["deltaTSeconds"] / normal_spacing
            if courant > numerics["maxCo"] * (1 + 1e-12):
                raise CfdInputError(
                    "The imposed inlet speed and fixed timestep exceed maxCo across "
                    "the resolved wall sleeve; reduce deltaTSeconds or speedMps.",
                    "budget_exceeded",
                )
            inlet_courant_bounds.append({"patch": opening["patch"], "speedDeltaTOverNormalCell": courant})
    cells = outer_cells - excluded_cells
    solid_cells = outer_cells - room_cells - sleeve_cells
    air_cells = room_cells + sleeve_cells - excluded_cells
    _budget(cells, MAX_CELLS, "Mesh cells")
    _budget(cells * steps, MAX_CELL_STEPS, "Cell-timesteps")
    _budget(cells * (writes + 1), MAX_CELL_WRITES, "Cell-writes including initial fields")
    if air_cells <= 0 or solid_cells <= 0:
        raise CfdInputError("Both air and opaque solid regions must have cells.")
    layers = {}
    for side, axis_index, interval in (
        ("W", 0, 0), ("E", 0, -1), ("S", 1, 0), ("N", 1, -1),
        ("floor", 2, 0), ("ceiling", 2, -1),
    ):
        count = axes[axis_index].cells[interval]
        points = axes[axis_index].points
        meshed_thickness = points[1] - points[0] if interval == 0 else points[-1] - points[-2]
        layers[side] = {
            "thicknessM": thickness[side], "cells": count,
            "meshedThicknessM": meshed_thickness,
            "actualSpacingM": meshed_thickness / count,
        }
    return {
        "request": request, "axes": axes, "openings": openings,
        "dimensions": (width, depth, height), "thickness": thickness,
        "cells": cells, "solidCells": solid_cells, "airCells": air_cells,
        "excludedCells": excluded_cells, "gridBlocks": grid_blocks, "layers": layers,
        "alignmentToleranceM": alignment_tolerance,
        "steps": steps, "writeSteps": write_steps, "writes": writes,
        "inletCourantBounds": inlet_courant_bounds,
        "temperaturesK": {
            "air": scenario["air"]["initialC"] + 273.15,
            "solid": scenario["solid"]["initialC"] + 273.15,
            "boundaries": {side: scenario["boundaries"][side] + 273.15 for side in _ENVELOPE},
        },
    }


# Right-handed hex ordering; each face is outward when viewed from its owner.
_CORNERS = ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0),
            (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))
_FACES = (
    ((-1, 0, 0), (0, 4, 7, 3), "W", 0),
    ((1, 0, 0), (1, 2, 6, 5), "E", 0),
    ((0, -1, 0), (0, 1, 5, 4), "S", 1),
    ((0, 1, 0), (3, 7, 6, 2), "N", 1),
    ((0, 0, -1), (0, 3, 2, 1), "floor", 2),
    ((0, 0, 1), (4, 5, 6, 7), "ceiling", 2),
)


def _mesh(plan):
    axes = plan["axes"]
    shape = tuple(len(axis.cells) for axis in axes)
    sleeves = {}
    for opening in plan["openings"]:
        low, high = opening["indexLower"], opening["indexUpper"]
        for k in range(low[2], high[2]):
            for j in range(low[1], high[1]):
                for i in range(low[0], high[0]):
                    key = (i, j, k)
                    if key in sleeves:
                        raise RuntimeError("Validated sleeves unexpectedly overlap.")
                    sleeves[key] = opening
    regions = {}
    for k in range(shape[2]):
        for j in range(shape[1]):
            for i in range(shape[0]):
                key = (i, j, k)
                opening = sleeves.get(key)
                if opening:
                    if opening["condition"]["mode"] != "closed":
                        regions[key] = "air"
                elif all(0 < index < count - 1 for index, count in zip(key, shape)):
                    regions[key] = "air"
                else:
                    regions[key] = "solid"
    vertices, vertex_ids, blocks, patches = [], {}, [], {}
    interface_faces = 0
    mesh_counts = {"air": 0, "solid": 0}
    for key, region in regions.items():
        indices = []
        for corner in _CORNERS:
            vertex_key = tuple(index + offset for index, offset in zip(key, corner))
            if vertex_key not in vertex_ids:
                vertex_ids[vertex_key] = len(vertices)
                vertices.append(tuple(axis.points[index] for axis, index in zip(axes, vertex_key)))
            indices.append(vertex_ids[vertex_key])
        counts = tuple(axis.cells[index] for axis, index in zip(axes, key))
        blocks.append({"vertices": tuple(indices), "counts": counts, "region": region})
        mesh_counts[region] += math.prod(counts)
        for offset, corner_ids, side, normal in _FACES:
            neighbor = tuple(index + step for index, step in zip(key, offset))
            neighbor_region = regions.get(neighbor)
            face_cells = math.prod(counts[axis] for axis in range(3) if axis != normal)
            if neighbor_region:
                if region == "air" and neighbor_region == "solid":
                    interface_faces += face_cells
                continue
            outside = any(index < 0 or index >= count for index, count in zip(neighbor, shape))
            if outside:
                if region == "air":
                    opening = sleeves[key]
                    name, kind = opening["patch"], opening["condition"]["mode"]
                    info = {"openingIndex": opening["index"]}
                else:
                    name, kind, info = f"outer_{side}", "outer-temperature", {"side": side}
            else:
                opening = sleeves[neighbor]
                if opening["condition"]["mode"] != "closed":
                    raise RuntimeError("An open sleeve must contain air cells.")
                name = opening["patch"] if region == "air" else opening["revealPatch"]
                kind = "closed" if region == "air" else "closed-reveal"
                info = {"openingIndex": opening["index"], "side": opening["source"]["side"]}
            if name not in patches:
                patches[name] = {
                    "region": region, "kind": kind, "faces": [], "faceCells": 0, **info,
                }
            patch = patches[name]
            if patch["region"] != region:
                raise RuntimeError("Boundary patch cannot belong to two regions.")
            patch["faces"].append(tuple(indices[index] for index in corner_ids))
            patch["faceCells"] += face_cells
    if mesh_counts != {"air": plan["airCells"], "solid": plan["solidCells"]}:
        raise RuntimeError("Mesh classification failed the preflight cell accounting.")
    return {
        "vertices": vertices, "blocks": blocks, "patches": patches,
        "interfaceFaces": interface_faces,
    }


def _n(number):
    return "0" if number == 0 else format(number, ".17g")


def _vector(values):
    return "(" + " ".join(_n(value) for value in values) + ")"


def _header(object_name, field_class="dictionary"):
    return (
        "// Generated inputs only; OpenCFD OpenFOAM v2606; runtime verification pending.\n"
        "FoamFile\n{\n    version 2.0;\n    format ascii;\n"
        f"    class {field_class};\n    object {object_name};\n}}\n\n"
    )


def _block_mesh(mesh):
    lines = [_header("blockMeshDict"), "convertToMeters 1;\n\nvertices\n("]
    lines.extend("    " + _vector(vertex) for vertex in mesh["vertices"])
    lines.append(");\n\nblocks\n(")
    for block in mesh["blocks"]:
        indices = " ".join(str(index) for index in block["vertices"])
        counts = " ".join(str(count) for count in block["counts"])
        lines.append(f"    hex ({indices}) {block['region']} ({counts}) simpleGrading (1 1 1)")
    lines.append(");\n\nedges ();\n\nboundary\n(")
    for name, patch in sorted(mesh["patches"].items()):
        patch_type = "patch" if patch["kind"] in ("inlet", "outlet") else "wall"
        lines.extend((f"    {name}", "    {", f"        type {patch_type};", "        faces", "        ("))
        lines.extend(
            "            (" + " ".join(str(index) for index in face) + ")"
            for face in patch["faces"]
        )
        lines.extend(("        );", "    }"))
    lines.append(");\n\nmergePatchPairs ();\n")
    return "\n".join(lines)


def _field(name, dimensions, internal, patches, vector=False):
    field_class = "volVectorField" if vector else "volScalarField"
    lines = [
        _header(name, field_class), f"dimensions [{dimensions}];",
        f"internalField uniform {internal};", "\nboundaryField", "{",
    ]
    for patch, entries in patches.items():
        lines.extend((f"    {patch}", "    {"))
        lines.extend(f"        {entry}" for entry in entries)
        lines.append("    }")
    lines.append("}\n")
    return "\n".join(lines)


def _fields(plan, mesh):
    pressure = _n(plan["request"]["scenario"]["air"]["pressurePa"])
    air_t, solid_t = _n(plan["temperaturesK"]["air"]), _n(plan["temperaturesK"]["solid"])
    air_u, air_temp, air_p, air_prgh, solid_temp, solid_p = {}, {}, {}, {}, {}, {}
    for name, patch in sorted(mesh["patches"].items()):
        if patch["region"] == "solid":
            temperature = _n(plan["temperaturesK"]["boundaries"][patch["side"]])
            solid_temp[name] = ["type fixedValue;", f"value uniform {temperature};"]
            solid_p[name] = ["type calculated;", f"value uniform {pressure};"]
            continue
        opening = plan["openings"][patch["openingIndex"]]
        condition, side = opening["condition"], opening["source"]["side"]
        temperature = _n(opening["temperatureK"])
        air_p[name] = ["type calculated;", f"value uniform {pressure};"]
        if condition["mode"] == "inlet":
            speed = condition["speedMps"]
            velocity = {
                "N": (0, -speed, 0), "S": (0, speed, 0),
                "E": (-speed, 0, 0), "W": (speed, 0, 0),
            }[side]
            air_u[name] = ["type fixedValue;", f"value uniform {_vector(velocity)};"]
            air_temp[name] = ["type fixedValue;", f"value uniform {temperature};"]
            air_prgh[name] = ["type fixedFluxPressure;", f"value uniform {pressure};"]
        elif condition["mode"] == "outlet":
            static_pressure = _n(plan["request"]["scenario"]["air"]["pressurePa"] + condition["gaugePressurePa"])
            air_u[name] = [
                "type pressureInletOutletVelocity;", "phi phi;", "value uniform (0 0 0);",
            ]
            air_temp[name] = [
                "type inletOutlet;", "phi phi;", f"inletValue uniform {temperature};",
                f"value uniform {air_t};",
            ]
            air_prgh[name] = [
                "type prghPressure;", "rho rho;", f"p uniform {static_pressure};",
                f"value uniform {static_pressure};",
            ]
        else:
            air_u[name] = ["type fixedValue;", "value uniform (0 0 0);"]
            air_temp[name] = ["type fixedValue;", f"value uniform {temperature};"]
            air_prgh[name] = ["type fixedFluxPressure;", f"value uniform {pressure};"]
    air_u["air_to_solid"] = ["type fixedValue;", "value uniform (0 0 0);"]
    air_p["air_to_solid"] = ["type calculated;", f"value uniform {pressure};"]
    air_prgh["air_to_solid"] = ["type fixedFluxPressure;", f"value uniform {pressure};"]
    coupled = "type compressible::turbulentTemperatureCoupledBaffleMixed;"
    air_temp["air_to_solid"] = [
        coupled, "Tnbr T;", "kappaMethod fluidThermo;", f"value uniform {air_t};",
    ]
    solid_temp["solid_to_air"] = [
        coupled, "Tnbr T;", "kappaMethod solidThermo;", f"value uniform {solid_t};",
    ]
    solid_p["solid_to_air"] = ["type calculated;", f"value uniform {pressure};"]
    solid_fraction = {
        name: ["type fixedValue;", "value uniform 1;"] for name in solid_temp
    }
    return {
        "0/air/U": _field("U", "0 1 -1 0 0 0 0", "(0 0 0)", air_u, vector=True),
        "0/air/T": _field("T", "0 0 0 1 0 0 0", air_t, air_temp),
        "0/air/p": _field("p", "1 -1 -2 0 0 0 0", pressure, air_p),
        # createFluidFields.H resets this placeholder to p - rho*gh at startup.
        "0/air/p_rgh": _field("p_rgh", "1 -1 -2 0 0 0 0", pressure, air_prgh),
        "0/solid/T": _field("T", "0 0 0 1 0 0 0", solid_t, solid_temp),
        # basicThermo requires p even though rhoConst does not use it.
        "0/solid/p": _field("p", "1 -1 -2 0 0 0 0", pressure, solid_p),
        "0/solid/betavSolid": _field("betavSolid", "0 0 0 0 0 0 0", "1", solid_fraction),
    }


def _thermo(plan, region):
    material = plan["request"]["scenario"][region]
    if region == "air":
        thermo_type, transport, state = "heRhoThermo", "const", "perfectGas"
        mass = _n(material["molarMassGmol"])
        transport_data = f"mu {_n(material['muPaS'])}; Pr {_n(material['prandtl'])};"
        equation_data = ""
        explanation = ""
    else:
        thermo_type, transport, state = "heSolidThermo", "constIso", "rhoConst"
        # Mandatory specie token, unused by rhoConst/hConst/constIso equations.
        mass = "1"
        transport_data = f"kappa {_n(material['conductivityWmK'])};"
        equation_data = f"    equationOfState {{ rho {_n(material['densityKgM3'])}; }}\n"
        explanation = "// Solid molWeight=1 is inert specie bookkeeping, not a material measurement.\n"
    return _header("thermophysicalProperties") + explanation + f"""thermoType
{{
    type {thermo_type};
    mixture pureMixture;
    transport {transport};
    thermo hConst;
    equationOfState {state};
    specie specie;
    energy sensibleEnthalpy;
}}
mixture
{{
    specie {{ massFraction 1; molWeight {mass}; }}
    thermodynamics {{ Cp {_n(material['cpJkgK'])}; Hf 0; Tref 298.15; Href 0; }}
    transport {{ {transport_data} }}
{equation_data}}}
"""


def _schemes(fluid):
    advection = """
    div(phi,U) Gauss upwind;
    div(phi,h) Gauss upwind;
    div(phi,K) Gauss upwind;
    div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;
""" if fluid else ""
    return _header("fvSchemes") + f"""ddtSchemes {{ default Euler; }}
gradSchemes {{ default Gauss linear; }}
divSchemes
{{
    default none;{advection}
}}
laplacianSchemes {{ default Gauss linear corrected; }}
interpolationSchemes {{ default linear; }}
snGradSchemes {{ default corrected; }}
"""


def _solutions(plan, fluid):
    if fluid:
        return _header("fvSolution") + f"""solvers
{{
    "(rho|rhoFinal)"
    {{
        solver PCG;
        preconditioner DIC;
        tolerance 1e-8;
        relTol 0;
    }}
    p_rgh
    {{
        solver PCG;
        preconditioner DIC;
        tolerance 1e-8;
        relTol 0.05;
    }}
    p_rghFinal
    {{
        solver PCG;
        preconditioner DIC;
        tolerance 1e-8;
        relTol 0;
    }}
    "(U|h)"
    {{
        solver PBiCGStab;
        preconditioner DILU;
        tolerance 1e-8;
        relTol 0.05;
    }}
    "(U|h)Final"
    {{
        solver PBiCGStab;
        preconditioner DILU;
        tolerance 1e-8;
        relTol 0;
    }}
}}
PIMPLE
{{
    momentumPredictor yes;
    nCorrectors 2;
    nNonOrthogonalCorrectors 0;
    pRefCell 0;
    pRefValue {_n(plan['request']['scenario']['air']['pressurePa'])};
}}
relaxationFactors
{{
    equations {{ "U.*" 1; "h.*" 1; }}
}}
"""
    return _header("fvSolution") + """solvers
{
    "(h|hFinal)"
    {
        solver PCG;
        preconditioner DIC;
        tolerance 1e-8;
        relTol 0;
    }
}
PIMPLE { nNonOrthogonalCorrectors 0; }
"""


def _control(plan, probes):
    numerics = plan["request"]["scenario"]["numerics"]
    locations = "\n".join("            " + _vector((p["x"], p["y"], p["z"])) for p in probes)
    return _header("controlDict") + f"""application chtMultiRegionFoam;
startFrom startTime;
startTime 0;
stopAt endTime;
endTime {_n(numerics['endTimeSeconds'])};
deltaT {_n(numerics['deltaTSeconds'])};
adjustTimeStep no;
maxCo {_n(numerics['maxCo'])};
writeControl timeStep;
writeInterval {plan['writeSteps']};
purgeWrite 0;
writeFormat ascii;
writePrecision 12;
writeCompression off;
timeFormat general;
timePrecision 12;
runTimeModifiable no;

functions
{{
    errors strict;
    useNamePrefix false;
    courant
    {{
        type CourantNo;
        libs ("libfieldFunctionObjects.so");
        region air;
        field phi;
        rho rho;
        result Co;
        executeControl timeStep;
        executeInterval 1;
        writeControl none;
        log false;
    }}
    courantExtrema
    {{
        type fieldMinMax;
        libs ("libfieldFunctionObjects.so");
        region air;
        fields (Co);
        mode component;
        internal true;
        location false;
        log false;
        writeToFile false;
        executeControl timeStep;
        executeInterval 1;
        writeControl timeStep;
        writeInterval 1;
    }}
    courantLimit
    {{
        type runTimeControl;
        libs ("libutilityFunctionObjects.so");
        region air;
        executeControl timeStep;
        executeInterval 1;
        writeControl timeStep;
        writeInterval 1;
        nWriteStep 0;
        satisfiedAction abort;
        conditions
        {{
            maximumCourant
            {{
                type minMax;
                functionObject courantExtrema;
                fields ("max(Co)");
                mode maximum;
                value {_n(numerics['maxCo'])};
            }}
        }}
    }}
    probes
    {{
        type probes;
        libs ("libsampling.so");
        region air;
        fields (U T p);
        fixedLocations true;
        interpolationScheme cell;
        includeOutOfBounds true;
        sampleOnExecute false;
        executeControl none;
        writeControl timeStep;
        writeInterval {plan['writeSteps']};
        probeLocations
        (
{locations}
        );
    }}
}}
"""


def _probe_locations(plan):
    sampling = plan["request"]["scenario"]["sampling"]
    width, depth, _ = plan["dimensions"]
    return [
        {
            "x": (column + 0.5) * width / sampling["columns"],
            "y": depth - (row + 0.5) * depth / sampling["rows"],
            "z": sampling["heightM"],
        }
        for row in range(sampling["rows"])
        for column in range(sampling["columns"])
    ]


def _manifest(plan, mesh, probes, case_hash):
    request = plan["request"]
    geometry, scenario = request["geometry"], request["scenario"]
    width, depth, height = plan["dimensions"]
    t = plan["thickness"]
    meshed_t = {side: layer["meshedThicknessM"] for side, layer in plan["layers"].items()}
    outer_width, outer_depth, outer_height = (
        axis.points[-1] - axis.points[0] for axis in plan["axes"]
    )
    solid_parts = {
        "floor": outer_width * outer_depth * meshed_t["floor"],
        "ceiling": outer_width * outer_depth * meshed_t["ceiling"],
    }
    aperture_areas = {side: [] for side in _SIDES}
    open_sleeve_volume, excluded_volume = 0.0, 0.0
    opening_manifest = []
    for opening in plan["openings"]:
        source, condition = opening["source"], opening["condition"]
        area = source["widthM"] * source["heightM"]
        volume = area * t[source["side"]]
        spans = tuple(high - low for low, high in zip(opening["lower"], opening["upper"]))
        meshed_area = math.prod(span for axis, span in enumerate(spans) if axis != opening["normalAxis"])
        meshed_volume = meshed_area * spans[opening["normalAxis"]]
        aperture_areas[source["side"]].append(meshed_area)
        is_closed = condition["mode"] == "closed"
        if is_closed:
            excluded_volume += meshed_volume
        else:
            open_sleeve_volume += meshed_volume
        opening_manifest.append({
            "id": source["id"], "wallId": source["wallId"], "side": source["side"],
            "kind": source["kind"], "adjacent": source["adjacent"],
            "mode": condition["mode"], "patch": opening["patch"],
            "revealPatch": opening["revealPatch"] if is_closed else None,
            "geometricAreaM2": area, "operatingAreaM2": 0 if is_closed else area,
            "wallThicknessM": t[source["side"]], "sleeveVolumeM3": volume,
            "meshedAreaM2": meshed_area, "meshedSleeveVolumeM3": meshed_volume,
            "sleeveAirCells": 0 if is_closed else opening["cells"],
            "excludedSleeveCells": opening["cells"] if is_closed else 0,
            "sleeveBoundsM": {
                "min": dict(zip(("x", "y", "z"), opening["lower"])),
                "max": dict(zip(("x", "y", "z"), opening["upper"])),
            },
            "requestedSleeveBoundsM": {
                "min": dict(zip(("x", "y", "z"), opening["requestedLower"])),
                "max": dict(zip(("x", "y", "z"), opening["requestedUpper"])),
            },
            "boundaryLocation": "inner-wall-face" if is_closed else "outer-wall-face",
            "inletDirection": (
                dict(zip(("x", "y", "z"), {
                    "N": (0, -1, 0), "S": (0, 1, 0),
                    "E": (-1, 0, 0), "W": (1, 0, 0),
                }[source["side"]])) if condition["mode"] == "inlet" else None
            ),
            "temperatureK": opening["temperatureK"],
            "staticPressurePa": (
                scenario["air"]["pressurePa"] + condition["gaugePressurePa"]
                if condition["mode"] == "outlet" else None
            ),
        })
    for side in _SIDES:
        clear_face_area = (width if side in ("N", "S") else depth) * height
        remaining_area = math.fsum([clear_face_area, *(-area for area in aperture_areas[side])])
        corner_area = (meshed_t["N"] + meshed_t["S"]) * height if side in ("E", "W") else 0
        solid_parts[side] = (remaining_area + corner_area) * meshed_t[side]
    origin_x, origin_y = geometry["rect"]["x"], geometry["rect"]["y"] + depth
    angle = math.radians(geometry["headingDeg"])
    cosine, sine = math.cos(angle), math.sin(angle)
    room_volume = width * depth * height
    outer_volume = outer_width * outer_depth * outer_height
    return {
        "version": 1, "profile": PROFILE,
        "engine": {"id": "OpenCFD-OpenFOAM", "version": ENGINE_VERSION, "solver": "chtMultiRegionFoam"},
        "caseHash": case_hash,
        "caseHashCanonicalization": "SHA-256 of UTF-8, sorted-key compact Python JSON of the complete request; not JCS or a browser fingerprint",
        "source": request["source"], "geometry": geometry, "scenario": scenario,
        "coordinateSpace": "room-right-front-up",
        "coordinateMapping": {
            "units": "m", "engineAxes": {"X": "right (+site x)", "Y": "front (-site y)", "Z": "up"},
            "originSiteM": {"x": origin_x, "y": origin_y, "z": geometry["floorElevationM"]},
            "engineToSite": "x=origin.x+X; y=origin.y-Y; z=floorElevationM+Z",
            "engineToENU": (
                "E=(origin.x+X)*cos(h)-(origin.y-Y)*sin(h); "
                "N=-(origin.x+X)*sin(h)-(origin.y-Y)*cos(h); U=floorElevationM+Z"
            ),
            "headingDeg": geometry["headingDeg"],
            "engineToENUMatrix": [[cosine, sine, 0], [-sine, cosine, 0], [0, 0, 1]],
            "engineToENUTranslationM": {
                "east": origin_x * cosine - origin_y * sine,
                "north": -origin_x * sine - origin_y * cosine,
                "up": geometry["floorElevationM"],
            },
            "verticalDatum": "The supplied project floor-elevation datum, not an inferred geodetic elevation.",
            "handedness": "right-handed",
        },
        "gravityMps2": {"x": 0, "y": 0, "z": -GRAVITY_MPS2},
        "gravityReference": "Conventional standard gravity 9.80665 m/s2; not measured site gravity.",
        "receiverHeightM": scenario["sampling"]["heightM"],
        "probeLocations": probes,
        "probeOrdering": "row-major; columns increase X, rows decrease Y from the front/N side",
        "probeInterpolation": "Containing-cell value at the requested 3D point; not sub-cell reconstruction.",
        "probeOutputDirectory": "postProcessing/probes/air/0",
        "probeFields": {"U": {"units": "m/s", "components": "engine X,Y,Z"}, "T": {"units": "K"}, "p": {"units": "Pa", "reference": "absolute thermodynamic"}},
        "mesh": {
            "type": "conformal structured blockMesh, split by air/solid cellZones",
            "cells": plan["cells"], "airCells": plan["airCells"], "solidCells": plan["solidCells"],
            "excludedClosedSleeveCells": plan["excludedCells"],
            "blocks": len(mesh["blocks"]), "vertices": len(mesh["vertices"]),
            "gridBlocksBeforeExclusion": plan["gridBlocks"],
            "selectedSpacingM": scenario["numerics"]["spacingM"],
            "minimumSolidLayerCells": scenario["numerics"]["solidCells"],
            "layers": plan["layers"],
            "axes": {name: axis.manifest() for name, axis in zip(("X", "Y", "Z"), plan["axes"])},
            "minimumDistinctFeatureM": MIN_FEATURE_M,
            "geometryAlignmentToleranceM": plan["alignmentToleranceM"],
            "maximumFeatureAlignmentM": max(axis.maximum_alignment for axis in plan["axes"]),
            "roundoffAlignment": (
                "Enclosure and outer-shell planes retain input dimensions. Almost-coincident aperture "
                "planes share vertices within max(1e-9 m, 32 ulps of supplied site-coordinate scale); "
                "requested/aligned bounds and maximum shifts are explicit. Distinct undersized "
                "features are rejected, not truncated."
            ),
            "interface": {"airPatch": "air_to_solid", "solidPatch": "solid_to_air", "facesPerSide": mesh["interfaceFaces"], "polyPatchType": "mappedWall"},
            "boundaryPatches": [
                {"name": name, "region": patch["region"], "kind": patch["kind"], "faces": patch["faceCells"]}
                for name, patch in sorted(mesh["patches"].items())
            ],
            "volumesM3": {
                "outerBox": outer_volume, "roomAir": room_volume,
                "openSleeveAir": open_sleeve_volume, "air": room_volume + open_sleeve_volume,
                "solid": math.fsum(solid_parts.values()), "excludedClosedSleeves": excluded_volume,
            },
            "solidVolumeByEnvelopePartM3": solid_parts,
            "cornerPartition": "Floor/ceiling span the full outer footprint; E/W own vertical corners; N/S span the inner room width.",
        },
        "openings": opening_manifest,
        "initialConditions": {
            "scope": "Uniform region internal fields; prescribed boundary conditions take precedence.",
            "velocityMps": {"x": 0, "y": 0, "z": 0},
            "airTemperatureK": plan["temperaturesK"]["air"],
            "solidTemperatureK": plan["temperaturesK"]["solid"],
            "absolutePressurePa": scenario["air"]["pressurePa"],
            "hRefM": 0,
            "p_rgh": "chtMultiRegionFoam initializes p_rgh=p-rho*(g dot C) from uniform absolute p, with hRef=0.",
            "hydrostaticEquilibrium": False,
        },
        "model": {
            "momentum": "laminar", "airEquationOfState": "perfectGas (ideal gas)",
            "airThermo": "heRhoThermo/pureMixture/hConst/const/sensibleEnthalpy",
            "solidThermo": "heSolidThermo/pureMixture/rhoConst/hConst/constIso/sensibleEnthalpy",
            "solidVolumeFraction": 1,
            "solidPressureField": "Required basicThermo field uses the supplied air pressure reference; unused by rhoConst heat conduction, not a solid stress.",
            "enthalpyReference": {"TrefK": 298.15, "HrefJkg": 0, "HfJkg": 0, "meaning": "Fixed energy datum, not a supplied heat source."},
            "solidSpecieMolWeight": {"value": 1, "meaning": "Required inert specie bookkeeping; unused in rhoConst/hConst/constIso heat conduction, not a physical solid molar mass."},
            "outerBoundary": "Prescribed outer-face temperatures, with no external film or exterior air volume.",
            "temperatureInterface": "compressible::turbulentTemperatureCoupledBaffleMixed; fluidThermo/solidThermo conductivity; no contact resistance",
        },
        "numerics": {
            "timeStepping": "fixed Euler", "steps": plan["steps"],
            "writeEverySteps": plan["writeSteps"], "scheduledFieldWrites": plan["writes"],
            "maxRuntimeSeconds": scenario["numerics"]["maxRuntimeSeconds"],
            "wallClockEnforcement": "Required of the runtime for the entire command sequence, not performed by this pure compiler.",
            "maxCo": scenario["numerics"]["maxCo"],
            "courantEnforcement": "Inlet preflight bound and built-in CourantNo/fieldMinMax/runTimeControl abort after each timestep; no adaptive timestep or silent success.",
            "inletCourantPreflight": plan["inletCourantBounds"],
            "spatialAdvection": "first-order Gauss upwind",
            "outerCorrectors": 2, "pressureCorrectors": 2,
            "linearAbsoluteTolerance": 1e-8, "linearFinalRelativeTolerance": 0,
        },
        "budgets": {
            "maxPayloadBytes": MAX_PAYLOAD_BYTES, "maxCells": MAX_CELLS,
            "maxBlocks": MAX_BLOCKS, "maxProbes": MAX_PROBES, "maxSteps": MAX_STEPS,
            "maxCellSteps": MAX_CELL_STEPS, "maxFieldWrites": MAX_WRITES,
            "maxCellWrites": MAX_CELL_WRITES, "maxProbeSamples": MAX_PROBE_SAMPLES,
            "maxRuntimeSeconds": MAX_RUNTIME_SECONDS,
        },
        "commands": [list(command) for command in _COMMANDS],
        "limitations": [
            "Generated case inputs only. OpenFOAM has not been executed by this compiler; runtime verification, convergence, conservation and numerical accuracy are pending.",
            "One explicitly acknowledged empty rectangular inner-wall-face enclosure; sourceRoomRect is retained separately. No furniture, occupants, stairs, lifts, irregular usable regions or other room volumes.",
            "One homogeneous isotropic opaque solid shell with explicit density, heat capacity and conductivity; no wall assemblies, glazing conduction or contact resistance.",
            "Fully open apertures are unobstructed air sleeves through the actual wall thickness. No partial opening, door-leaf drag, screens, leakage or discharge-coefficient substitution.",
            "Inlets prescribe a uniform inward-normal speed and temperature, with no tangential inflow. Pressure outlets prescribe absolute static pressure and explicit backflow temperature.",
            "Closed doors/windows are prescribed-temperature inner-face patches. Their sleeve cells are excluded; exposed solid reveals use the corresponding side's outer temperature. This is not a glazing or door conduction model.",
            "Outside, adjacent-room and unknown adjacency are preserved labels. Every open terminal is an explicit truncated prescribed boundary, not an inferred outdoor condition or a coupled adjacent room. Unknown adjacency never supplies outdoor-air or ACH evidence.",
            "Laminar compressible ideal-gas airflow with constant Cp, viscosity and Prandtl number. Turbulence, radiation, HVAC, solar gain, moisture, contaminants and combustion are not modeled.",
            "Uniform initial absolute pressure and temperatures with U=0 are an explicit start-up condition, not a hydrostatically equilibrated or warmed-up building.",
            "First-order spatial/time discretization and containing-cell probes require mesh/timestep studies. A completed run would not by itself establish measured performance, calibrated temperatures, comfort or engineering adequacy.",
            "Cell, timestep, output and receiver budgets do not guarantee completion within the wall-clock allowance. The runtime must stop overdue or failed commands and reject incomplete output.",
            "No residual, heat-flux or conservation-success values are fabricated. Courant diagnostics are safety guards, not convergence or thermal-balance certification.",
        ],
        "referenceDocumentation": [
            "https://doc.openfoam.com/2606/tools/processing/solvers/rtm/heat-transfer/chtMultiRegionFoam/",
            _UPSTREAM + "tutorials/heatTransfer/chtMultiRegionFoam/multiRegionHeater/constant/topAir/thermophysicalProperties",
            _UPSTREAM + "src/finiteVolume/fields/fvPatchFields/derived/prghPressure/prghPressureFvPatchScalarField.cxx",
            _UPSTREAM + "src/sampling/probes/Probes/Probes.C",
        ],
        "runtimeVerification": "pending",
    }


def _files(plan, mesh, probes):
    files = _fields(plan, mesh)
    files.update({
        "system/blockMeshDict": _block_mesh(mesh),
        "system/controlDict": _control(plan, probes),
        "system/fvSchemes": _schemes(True),
        "system/fvSolution": _header("fvSolution") + "solvers {}\nPIMPLE { nOuterCorrectors 2; }\n",
        "system/air/fvSchemes": _schemes(True),
        "system/air/fvSolution": _solutions(plan, True),
        "system/solid/fvSchemes": _schemes(False),
        "system/solid/fvSolution": _solutions(plan, False),
        "constant/regionProperties": _header("regionProperties") + "regions (fluid (air) solid (solid));\n",
        "constant/g": _header("g", "uniformDimensionedVectorField") + "dimensions [0 1 -2 0 0 0 0];\nvalue (0 0 -9.80665);\n",
        "constant/air/hRef": _header("hRef", "uniformDimensionedScalarField") + "dimensions [0 1 0 0 0 0 0];\nvalue 0;\n",
        "constant/air/thermophysicalProperties": _thermo(plan, "air"),
        "constant/solid/thermophysicalProperties": _thermo(plan, "solid"),
        "constant/air/turbulenceProperties": _header("turbulenceProperties") + "simulationType laminar;\n",
        "constant/air/combustionProperties": _header("combustionProperties") + "combustionModel none;\n",
        "constant/air/radiationProperties": _header("radiationProperties") + "radiationModel none;\nradiation false;\n",
        "constant/solid/radiationProperties": _header("radiationProperties") + "radiationModel none;\nradiation false;\n",
    })
    return files


def prepare_case(payload):
    """Validate a complete request and return detached manifest and UTF-8 texts."""
    request = _validate_request(payload)
    plan = _plan(request)
    # All wire, geometry and allocation budgets pass before case generation.
    canonical = _JSON.encode(request).encode("utf-8")
    case_hash = hashlib.sha256(canonical).hexdigest()
    mesh = _mesh(plan)
    probes = _probe_locations(plan)
    manifest = _manifest(plan, mesh, probes, case_hash)
    files = _files(plan, mesh, probes)
    return {"manifest": manifest, "files": files}


def case_zip(prepared):
    """Serialize only compiler-owned paths to a deterministic in-memory ZIP."""
    _object(prepared, "manifest files", "prepared case")
    if type(prepared["files"]) is not dict or set(prepared["files"]) != _CASE_PATHS:
        raise CfdInputError("ZIP entries must be the fixed compiler-owned case paths.")
    # Revalidation prevents this helper becoming a dictionary/path override API.
    manifest = prepared["manifest"]
    if type(manifest) is not dict:
        raise CfdInputError("Prepared case manifest must be an object.")
    keys = ("version", "profile", "source", "geometry", "scenario")
    if any(key not in manifest for key in keys):
        raise CfdInputError("Prepared case manifest is incomplete.")
    expected = prepare_case({key: manifest[key] for key in keys})
    if prepared != expected:
        raise CfdInputError("Prepared case differs from its validated compiler output.")
    texts = {"manifest.json": _JSON.encode(manifest) + "\n", **prepared["files"]}
    _budget(sum(_utf8_length(text) for text in texts.values()), MAX_CASE_BYTES, "Uncompressed case bytes")
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
        for path, text in sorted(texts.items()):
            info = ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, text.encode("utf-8"))
    return output.getvalue()
