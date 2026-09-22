"""Integral-output contract and end-step balances for the pinned CHT profile.

These are reconstructed finite-volume budgets, not matrix residuals, numerical
acceptance thresholds or evidence that OpenFOAM has been executed/validated.
"""
from __future__ import annotations

import math
import re
from io import StringIO


VERSION = 1
METHOD = "cht-enthalpy-end-step-v1"
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 24 * 1024 * 1024
MAX_ROWS = 10001
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z")


class ConservationError(ValueError):
    pass


def _finite(value, label):
    if type(value) not in (int, float):
        raise ConservationError(f"{label} must be a finite number.")
    try:
        converted = float(value)
    except (OverflowError, ValueError):
        raise ConservationError(f"{label} exceeds the finite numerical range.") from None
    if not math.isfinite(converted):
        raise ConservationError(f"{label} exceeds the finite numerical range.")
    return converted


def _sum(values):
    try:
        return _finite(math.fsum(values), "Conservation sum")
    except (OverflowError, ValueError):
        raise ConservationError("Conservation arithmetic exceeds the finite numerical range.") from None


def _numeric(token):
    if len(token) > 64 or not NUMBER.fullmatch(token):
        raise ConservationError("Integral output contains an invalid numeric token.")
    return _finite(float(token), "Integral value")


def _close(a, b):
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-7)


def build_contract(scenario, boundary_patches, gravity):
    """Derive fixed names/paths and coefficients; no user-supplied output paths."""
    if any(p["region"] not in ("air", "solid") or p["kind"] not in
           (("closed", "inlet", "outlet") if p["region"] == "air" else ("outer-temperature", "closed-reveal"))
           for p in boundary_patches):
        raise ConservationError("Integral diagnostics encountered an unsupported boundary kind.")
    groups = {
        "airClosed": sorted(p["name"] for p in boundary_patches if p["region"] == "air" and p["kind"] == "closed"),
        "airOpen": sorted(p["name"] for p in boundary_patches if p["region"] == "air" and p["kind"] in ("inlet", "outlet")),
        "solidExternal": sorted(p["name"] for p in boundary_patches if p["region"] == "solid"),
    }
    for names in groups.values():
        if len(names) != len(set(names)) or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,80}", name) for name in names):
            raise ConservationError("Integral diagnostics require unique generated patch names.")
    if not groups["solidExternal"]:
        raise ConservationError("Integral diagnostics need the solid's outer boundary.")
    air_all = ["air_to_solid", *groups["airClosed"], *groups["airOpen"]]
    series = {}

    def add(name, region, operation, fields, components, patches=None, weight=None):
        kind = "surfaceFieldValue" if patches is not None else "volFieldValue"
        item = {
            "name": name, "region": region, "kind": kind, "operation": operation,
            "fields": fields, "components": components, "weight": weight,
            "patches": patches,
            "path": f"postProcessing/{region}/{name}/0/{kind}.dat",
        }
        series[name] = item

    add("cfdAirExtensive", "air", "volIntegrate", ["rho", "p", "dpdt"], [1, 1, 1])
    add("cfdAirEnergy", "air", "weightedVolIntegrate", ["h", "K", "U"], [1, 1, 3], weight="rho")
    add("cfdSolidEnergy", "solid", "volIntegrate", ["h"], [1])
    add("cfdMassFlux", "air", "sum", ["phi"], [1], air_all)
    add("cfdAdvectiveFlux", "air", "weightedSum", ["h", "K"], [1, 1], air_all, "phi")
    add("cfdAirInterfaceHeat", "air", "areaIntegrate", ["wallHeatFlux"], [1], ["air_to_solid"])
    add("cfdSolidInterfaceHeat", "solid", "areaIntegrate", ["wallHeatFlux"], [1], ["solid_to_air"])
    add("cfdSolidExternalHeat", "solid", "areaIntegrate", ["wallHeatFlux"], [1], groups["solidExternal"])
    if groups["airClosed"]:
        add("cfdAirClosedHeat", "air", "areaIntegrate", ["wallHeatFlux"], [1], groups["airClosed"])
    if groups["airOpen"]:
        add("cfdAirOpenGradient", "air", "areaNormalIntegrate", ["cfdGradT"], [3], groups["airOpen"])
    air, solid, numerics = scenario["air"], scenario["solid"], scenario["numerics"]
    mu, cp, prandtl = (_finite(air[name], f"Air {name}") for name in ("muPaS", "cpJkgK", "prandtl"))
    if min(mu, cp, prandtl) <= 0:
        raise ConservationError("Air properties must be positive.")
    conductivity = mu * cp / prandtl
    if _finite(conductivity, "Air conductivity") <= 0:
        raise ConservationError("Air conductivity must be positive.")
    return {
        "version": VERSION, "method": METHOD,
        "deltaTSeconds": numerics["deltaTSeconds"], "endTimeSeconds": numerics["endTimeSeconds"],
        "airConductivityWmK": conductivity, "solidDensityKgM3": solid["densityKgM3"],
        "gravityMps2": dict(gravity), "patchGroups": groups, "series": series,
        "timePolicy": "Every fixed timestep; only intervals bracketed by actual integral rows are assessed. No initial state is fabricated.",
        "fluxSigns": "phi is positive outward; conductive heat is positive into each region; dpdt and gravity work are signed inputs.",
        "heatMethod": "wallHeatFlux on walls/interfaces; k*integral(grad(T) dot outward-normal dA) on open patches, including inlet diffusion.",
    }


def checked_contract(manifest):
    if "conservation" not in manifest:
        return None
    value = manifest["conservation"]
    try:
        expected = build_contract(manifest["scenario"], manifest["mesh"]["boundaryPatches"], manifest["gravityMps2"])
    except (KeyError, TypeError, ZeroDivisionError) as exc:
        raise ConservationError("The case is missing required conservation metadata.") from exc
    if type(value) is not dict or type(value.get("version")) is not int or value != expected:
        raise ConservationError("The conservation method, paths or physical coefficients do not match the prepared case.")
    for name in ("deltaTSeconds", "endTimeSeconds", "solidDensityKgM3"):
        if _finite(value[name], name) <= 0:
            raise ConservationError("Conservation time and material parameters must be positive.")
    for axis in ("x", "y", "z"):
        _finite(value["gravityMps2"][axis], "Gravity")
    return value


def function_objects(contract):
    """Original configuration for built-in, non-coded OpenFOAM functions."""
    chunks = []
    for region in ("air", "solid"):
        patches = (["air_to_solid", *contract["patchGroups"]["airClosed"]] if region == "air"
                   else ["solid_to_air", *contract["patchGroups"]["solidExternal"]])
        chunks.append(f"""
    cfdWallHeat{region.title()}
    {{
        type wallHeatFlux;
        model wall;
        libs ("libfieldFunctionObjects.so");
        region {region};
        patches ({" ".join(patches)});
        useNamePrefix false;
        log false;
        writeToFile false;
        executeControl timeStep;
        executeInterval 1;
        writeControl none;
    }}
""")
    if contract["patchGroups"]["airOpen"]:
        chunks.append("""
    cfdOpenTemperatureGradient
    {
        type grad;
        libs ("libfieldFunctionObjects.so");
        region air;
        field T;
        result cfdGradT;
        useNamePrefix false;
        log false;
        executeControl timeStep;
        executeInterval 1;
        writeControl none;
    }
""")
    for item in contract["series"].values():
        region_type = "patch" if item["patches"] is not None else "all"
        patches = ""
        if item["patches"] is not None:
            patches = f'\n        name {item["patches"][0]};\n        names ({" ".join(item["patches"])});\n        empty-surface strict;'
        weight = f'\n        weightField {item["weight"]};' if item["weight"] else ""
        chunks.append(f"""
    {item["name"]}
    {{
        type {item["kind"]};
        libs ("libfieldFunctionObjects.so");
        region {item["region"]};
        regionType {region_type};{patches}
        operation {item["operation"]};
        fields ({" ".join(item["fields"])});{weight}
        writeFields false;
        writeToFile true;
        writeArea false;
        writePrecision 16;
        useUserTime false;
        log false;
        executeControl timeStep;
        executeInterval 1;
        writeControl timeStep;
        writeInterval 1;
    }}
""")
    return "".join(chunks)


def _series(data, descriptor, contract):
    if not data or not data.endswith(b"\n"):
        raise ConservationError("Integral output is missing or its final row is truncated.")
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        raise ConservationError("Integral output must be bounded ASCII.") from None
    if re.search(r"[^\x09\x0a\x0d\x20-\x7e]", text):
        raise ConservationError("Integral output contains unsupported control bytes.")
    expected_header = [f'{descriptor["operation"]}({field})' for field in descriptor["fields"]]
    header = False
    weight = None
    rows = []
    for line_index, raw in enumerate(StringIO(text)):
        if line_index > 2 * MAX_ROWS + 64:
            raise ConservationError("Integral output exceeds its total line budget.")
        if len(raw) > 4096:
            raise ConservationError("Integral output exceeds its line budget.")
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            if rows:
                raise ConservationError("Repeated or appended integral headers are not accepted.")
            weighted = re.fullmatch(r"#\s*Weight field\s*:?\s*(.*?)\s*", line)
            if weighted:
                if weight is not None:
                    raise ConservationError("Duplicate integral weighting metadata.")
                weight = weighted.group(1).strip()
            if re.match(r"#\s*Time(?:\s|$)", line):
                if header or re.sub(r"^#\s*Time\s*", "", line).split() != expected_header:
                    raise ConservationError("Integral columns do not match the generated field/operation contract.")
                if weight != descriptor["weight"]:
                    raise ConservationError("Integral weighting is missing or does not match rho/phi.")
                header = True
            continue
        if not header:
            raise ConservationError("Integral output has no matching Time/field header.")
        tokens = re.findall(r"\(|\)|[^\s()]+", line)
        values = [_numeric(tokens[0])]
        offset = 1
        for count in descriptor["components"]:
            if count == 1:
                if offset >= len(tokens):
                    raise ConservationError("Integral output has missing scalar columns.")
                values.append(_numeric(tokens[offset])); offset += 1
            else:
                if offset + 4 >= len(tokens) or tokens[offset] != "(" or tokens[offset + 4] != ")":
                    raise ConservationError("Integral vector output requires exactly three parenthesized components.")
                values.append(tuple(_numeric(token) for token in tokens[offset + 1:offset + 4])); offset += 5
        if offset != len(tokens):
            raise ConservationError("Integral output has extra columns.")
        if len(rows) >= MAX_ROWS or values[0] < 0 or rows and values[0] <= rows[-1][0]:
            raise ConservationError("Integral times are repeated, reversed or exceed the row budget.")
        rows.append(values)
    if not rows:
        raise ConservationError("Integral output has no computed rows.")
    dt, end = contract["deltaTSeconds"], contract["endTimeSeconds"]
    steps = round(end / dt)
    first = 0 if _close(rows[0][0], 0) else 1
    if steps < 1 or steps > MAX_ROWS - 1 or not _close(steps * dt, end):
        raise ConservationError("The integral output has an unsupported fixed-step duration.")
    if len(rows) != steps + 1 - first or any(not _close(row[0], (index + first) * dt) for index, row in enumerate(rows)):
        raise ConservationError("Integral output must contain every fixed timestep through the requested end.")
    return rows


def read_conservation(manifest, read_file):
    """Use the caller's bounded, owned-file reader; never discover other paths."""
    contract = checked_contract(manifest)
    if contract is None:
        return {
            "conservation": {"status": "not-evaluated", "message": "This older case did not request integral diagnostics."},
            "massBalance": {"status": "not-evaluated", "message": "No mass-integral history was requested."},
            "energyBalance": {"status": "not-evaluated", "message": "No energy-integral history was requested."},
        }
    series, total = {}, 0
    for name, descriptor in contract["series"].items():
        data = read_file(descriptor["path"], MAX_FILE_BYTES)
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise ConservationError("Conservation files exceed the aggregate byte budget.")
        series[name] = _series(data, descriptor, contract)
    times = [row[0] for row in series["cfdAirExtensive"]]
    for rows in series.values():
        if len(rows) != len(times) or any(not _close(row[0], time) for row, time in zip(rows, times)):
            raise ConservationError("Conservation series times do not match.")
    coverage = {"startSeconds": times[0], "endSeconds": times[-1], "intervals": len(times) - 1,
                "includesInitialState": times[0] == 0, "integration": "right-endpoint, every fixed Euler step"}
    metadata = {
        "status": "computed-unvalidated" if len(times) > 1 else "insufficient-history",
        "version": VERSION, "method": METHOD, "coverage": coverage,
        "acceptance": "No numerical acceptance threshold or empirical validation is inferred.",
        "meaning": "Reconstructed balances from end-step fields, not linear-system residuals; pressure, gravity, kinetic energy and inlet conduction are included.",
        "precision": "Double-precision arithmetic and 16-digit output; unresolved tiny differences are not a measurement.",
        "sourceFiles": [row["path"] for row in contract["series"].values()],
    }
    for row in series["cfdAirExtensive"]:
        if row[1] <= 0 or row[2] <= 0:
            raise ConservationError("Air mass and integrated absolute pressure must be positive.")
    for row in series["cfdAirEnergy"]:
        if row[2] < 0:
            raise ConservationError("Integrated kinetic energy cannot be negative.")
    for row in series.get("cfdAirOpenGradient", []):
        if row[1][1:] != (0.0, 0.0):
            raise ConservationError("areaNormalIntegrate must report the scalar normal integral in the first vector component.")
    if len(times) == 1:
        missing = {"status": "insufficient-history", "message": "One actual integral row cannot establish a storage change. No initial state was invented."}
        return {"conservation": metadata, "massBalance": dict(missing), "energyBalance": dict(missing)}
    gravity = tuple(contract["gravityMps2"][axis] for axis in ("x", "y", "z"))
    rho_s, k_air = contract["solidDensityKgM3"], contract["airConductivityWmK"]
    mass, fluid, solid, combined, mismatch = [], [], [], [], []
    totals = {name: [] for name in ("massOut", "advection", "pressureWork", "gravityWork",
                                    "airExternal", "airInterface", "solidExternal", "solidInterface")}

    def heat(name, i):
        if name not in series:
            group = {"cfdAirClosedHeat": "airClosed", "cfdAirOpenGradient": "airOpen"}.get(name)
            if group is None or contract["patchGroups"][group]:
                raise ConservationError("A required conductive-flux collector is missing.")
            # A deliberately empty geometric patch set has zero boundary flux.
            return 0.0
        return series[name][i][1]

    def state(i):
        air_energy = series["cfdAirEnergy"][i]
        return (series["cfdAirExtensive"][i][1], _sum(air_energy[1:3]),
                _finite(rho_s * series["cfdSolidEnergy"][i][1], "Solid stored enthalpy"))

    initial, last = state(0), state(len(times) - 1)
    for i in range(1, len(times)):
        dt = contract["deltaTSeconds"]
        a, b = state(i - 1), state(i)
        mass_out = series["cfdMassFlux"][i][1] * dt
        adv = _sum(series["cfdAdvectiveFlux"][i][1:]) * dt
        pwork = series["cfdAirExtensive"][i][3] * dt
        gwork = _sum(g * momentum for g, momentum in zip(gravity, series["cfdAirEnergy"][i][3])) * dt
        gradient = heat("cfdAirOpenGradient", i)
        if "cfdAirOpenGradient" in series:
            gradient = gradient[0]
        qa_ext = _sum([heat("cfdAirClosedHeat", i), k_air * gradient]) * dt
        qa_if = heat("cfdAirInterfaceHeat", i) * dt
        qs_ext = heat("cfdSolidExternalHeat", i) * dt
        qs_if = heat("cfdSolidInterfaceHeat", i) * dt
        mass.append(_sum([b[0], -a[0], mass_out]))
        fluid.append(_sum([b[1], -a[1], adv, -pwork, -gwork, -qa_ext, -qa_if]))
        solid.append(_sum([b[2], -a[2], -qs_ext, -qs_if]))
        combined.append(_sum([b[1], -a[1], b[2], -a[2], adv, -pwork, -gwork, -qa_ext, -qs_ext]))
        mismatch.append(_finite(_sum([qa_if, qs_if]) / dt, "Interface mismatch"))
        for name, value in zip(totals, (mass_out, adv, pwork, gwork, qa_ext, qa_if, qs_ext, qs_if)):
            totals[name].append(_finite(value, "Integrated flux"))
    flux = {name: _sum(values) for name, values in totals.items()}

    def residual(values, unit):
        index = max(range(len(values)), key=lambda i: abs(values[i]))
        return {
            f"residual{unit}": _sum(values), f"maxAbsStepResidual{unit}": abs(values[index]),
            "worstInterval": {"startSeconds": times[index], "endSeconds": times[index + 1],
                              f"residual{unit}": values[index]},
        }

    return {
        "conservation": metadata,
        "massBalance": {
            "status": "computed-unvalidated", "storedChangeKg": _sum([last[0], -initial[0]]),
            "netOutflowKg": flux["massOut"], **residual(mass, "Kg"),
            "maxAbsStepResidualKgS": _finite(max(abs(value) for value in mass) / contract["deltaTSeconds"], "Mass residual rate"),
        },
        "energyBalance": {
            "status": "computed-unvalidated",
            "storageMeaning": "Air integral(rho*(h+K)) and solid integral(rho*h). Pressure work is an explicit input; this is an enthalpy/kinetic ledger, not inferred room heat capacity.",
            "fluid": {**residual(fluid, "J"), "storedChangeJ": _sum([last[1], -initial[1]]),
                      "netAdvectiveOutflowJ": flux["advection"], "pressureWorkInputJ": flux["pressureWork"],
                      "gravityWorkInputJ": flux["gravityWork"], "externalHeatInputJ": flux["airExternal"],
                      "interfaceHeatInputJ": flux["airInterface"]},
            "solid": {**residual(solid, "J"), "storedChangeJ": _sum([last[2], -initial[2]]),
                      "externalHeatInputJ": flux["solidExternal"], "interfaceHeatInputJ": flux["solidInterface"]},
            "combinedExternal": {**residual(combined, "J"), "regionalResidualSumJ": _sum([*fluid, *solid])},
            "interface": {"maxAbsMismatchW": max(abs(value) for value in mismatch),
                          "signedMismatchJ": _sum([flux["airInterface"], flux["solidInterface"]]),
                          "signConvention": "Two positive-into-region interface heat inputs should be equal and opposite."},
        },
    }
