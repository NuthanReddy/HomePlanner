"""Supplied AC quantities and mounting geometry; --check verifies references."""

import argparse
import json
import math


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("A supplied real number is required.")
    try:
        value = float(value)
    except OverflowError as error:
        raise ValueError("Number is outside the finite range.") from error
    if not math.isfinite(value):
        raise ValueError("A finite number is required.")
    return value


def nonnegative(value):
    value = finite(value)
    if value < 0:
        raise ValueError("A nonnegative value is required.")
    return value


def positive(value):
    value = finite(value)
    if value <= 0:
        raise ValueError("A positive value is required.")
    return value


def ac_power(voltage_rms, current_rms, power_factor, reactive_kind, phases=1):
    voltage, current, pf = positive(voltage_rms), nonnegative(current_rms), nonnegative(power_factor)
    if pf > 1 or reactive_kind not in ("lagging", "leading") or type(phases) is not int or phases not in (1, 3):
        raise ValueError("Supply pf in [0,1], lagging/leading, and one or three balanced phases.")
    apparent = finite(voltage * current * (1.0 if phases == 1 else math.sqrt(3)))
    active = finite(apparent * pf)
    reactive = finite(apparent * math.sqrt(1 - pf * pf) * (1 if reactive_kind == "lagging" else -1))
    return {"active_W": active, "reactive_var": reactive, "apparent_VA": apparent}


def energy_kwh(intervals):
    if not intervals:
        raise ValueError("Supply explicit power/time intervals.")
    joules = 0.0
    for power_w, seconds in intervals:
        joules = finite(joules + finite(nonnegative(power_w) * nonnegative(seconds)))
    return finite(joules / 3_600_000)


def point2(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("Supply an (x, y) point.")
    return tuple(map(finite, value))


def wall_face_point(start, end, offset_m, thickness_m, side):
    ax, ay = point2(start)
    bx, by = point2(end)
    dx, dy = finite(bx - ax), finite(by - ay)
    length, thickness, offset = positive(math.hypot(dx, dy)), positive(thickness_m), nonnegative(offset_m)
    if side not in ("left", "right") or offset > length:
        raise ValueError("Supply a wall face and an offset within the physical wall.")
    tx, ty = dx / length, dy / length
    sign = 1 if side == "left" else -1
    nx, ny = ty * sign, -tx * sign
    return finite(ax + offset * tx + thickness * nx / 2), finite(ay + offset * ty + thickness * ny / 2)


def vertical_band(elevation_m, envelope_height_m, datum, datum_to_bottom_m=None):
    if datum not in ("plate-centre", "plate-bottom", "operable-part-centre"):
        raise ValueError("This reference requires a supplied plate/operable-part datum.")
    elevation = None if elevation_m is None else nonnegative(elevation_m)
    height = None if envelope_height_m is None else positive(envelope_height_m)
    offset = None if datum_to_bottom_m is None else nonnegative(datum_to_bottom_m)
    if elevation is None or height is None:
        return None
    if datum == "plate-centre":
        offset = height / 2
    elif datum == "plate-bottom":
        offset = 0.0
    elif offset is None:
        return None
    if offset > height:
        raise ValueError("The declared operable-part point must be within this supplied envelope.")
    bottom = nonnegative(elevation - offset)
    return bottom, finite(bottom + height)


def absolute_band(floor_elevation_m, band):
    floor = finite(floor_elevation_m)
    if band is None:
        return None
    bottom, top = point2(band)
    if top < bottom:
        raise ValueError("Band order is invalid.")
    return finite(floor + bottom), finite(floor + top)


def band_overlap(first, second):
    if first is None or second is None:
        return None
    a, b = point2(first)
    c, d = point2(second)
    if b < a or d < c:
        raise ValueError("Band order is invalid.")
    return finite(max(0.0, min(b, d) - max(a, c)))


def check_close(actual, expected):
    if not math.isclose(finite(actual), expected, rel_tol=1e-10, abs_tol=1e-10):
        raise AssertionError((actual, expected))
    return 1


def check_true(condition):
    if not condition:
        raise AssertionError("Invariant failed.")
    return 1


def check_error(function, *args):
    try:
        function(*args)
    except ValueError:
        return 1
    raise AssertionError("Invalid input was accepted.")


def run_checks():
    power = ac_power(230, 10, 0.8, "lagging")
    count = check_close(power["active_W"], 1840)
    count += check_close(power["reactive_var"], 1380)
    count += check_close(power["apparent_VA"], 2300)
    count += check_close(math.hypot(power["active_W"], power["reactive_var"]), power["apparent_VA"])
    count += check_close(ac_power(230, 10, 0.8, "leading")["reactive_var"], -1380)
    count += check_close(ac_power(230, 0, 1, "lagging")["apparent_VA"], 0)
    count += check_close(ac_power(230, 10, 0, "lagging")["reactive_var"], 2300)
    count += check_close(ac_power(400, 10, 1, "lagging", 3)["active_W"], 6928.203230275509)
    count += check_close(energy_kwh([(1840, 7200)]), 3.68)
    count += check_close(energy_kwh([(30, 1800)]), 0.015)
    count += check_close(energy_kwh([(0, 7200), (30, 0)]), 0)
    face = wall_face_point((0, 0), (4, 0), 1, 0.2, "left")
    count += check_close(face[0], 1)
    count += check_close(face[1], -0.1)
    reversed_face = wall_face_point((4, 0), (0, 0), 3, 0.2, "right")
    count += sum(check_close(a, b) for a, b in zip(face, reversed_face))
    band = vertical_band(0.3, 0.08, "plate-centre")
    count += check_close(band[0], 0.26)
    count += check_close(band[1], 0.34)
    count += check_close(absolute_band(3.2, band)[0], 3.46)
    count += check_close(vertical_band(0.3, 0.08, "plate-bottom")[1], 0.38)
    count += check_close(vertical_band(0.3, 0.08, "operable-part-centre", 0.02)[0], 0.28)
    count += check_true(vertical_band(0.3, None, "plate-centre") is None)
    count += check_true(vertical_band(0.3, 0.08, "operable-part-centre") is None)
    count += check_true(band_overlap(band, None) is None)
    count += check_close(band_overlap((0.26, 0.34), (0.30, 0.50)), 0.04)
    count += check_close(band_overlap((0, 1), (1, 2)), 0)
    count += check_error(ac_power, 230, 10, 1.1, "lagging")
    count += check_error(ac_power, 230, -1, 0.8, "lagging")
    count += check_error(ac_power, 0, 1, 0.8, "lagging")
    count += check_error(ac_power, 230, 10, 0.8, "lagging", 2)
    count += check_error(energy_kwh, [(30, -1)])
    count += check_error(wall_face_point, (0, 0), (0, 0), 0, 0.2, "left")
    count += check_error(wall_face_point, (0, 0), (4, 0), 5, 0.2, "left")
    count += check_error(vertical_band, 0.01, 0.08, "plate-centre")
    count += check_error(ac_power, math.nan, 10, 0.8, "lagging")
    count += check_error(ac_power, 1e308, 10, 0.8, "lagging")
    count += check_error(finite, True)
    return count


def examples():
    power = ac_power(230, 10, 0.8, "lagging")
    band = vertical_band(0.3, 0.08, "plate-centre")
    absolute = absolute_band(3.2, band)
    px, qy = power["active_W"] / 10, power["reactive_var"] / 10
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 285">'
        '<title>Synthetic power triangle and supplied vertical device envelope</title>'
        '<rect width="600" height="285" fill="white"/>'
        '<text x="15" y="25" font-size="15">230 V, 10 A, pf 0.8 lagging; not a circuit design</text>'
        f'<path d="M40 205 H{40+px} V{205-qy} Z" fill="#e3eef8" stroke="#285980"/>'
        f'<text x="40" y="227" font-size="13">P {power["active_W"]:.0f} W</text>'
        f'<text x="{50+px}" y="130" font-size="13">Q {power["reactive_var"]:.0f} var</text>'
        f'<text x="50" y="100" font-size="13">S {power["apparent_VA"]:.0f} VA</text>'
        '<path d="M410 205 H560" stroke="#222"/>'
        f'<rect x="455" y="{205-band[1]*350}" width="30" height="{(band[1]-band[0])*350}" fill="#e6b978" stroke="#222"/>'
        f'<text x="390" y="75" font-size="12">Plate {band[0]:.2f} to {band[1]:.2f} m above floor</text>'
        f'<text x="390" y="230" font-size="12">Absolute {absolute[0]:.2f} to {absolute[1]:.2f} m</text>'
        '<text x="15" y="266" font-size="12">No cable/protection sizing, wet-area or accessibility certification</text></svg>'
    )
    return {
        "single_phase": power, "active_energy_2h_kWh": energy_kwh([(power["active_W"], 7200)]),
        "fan_30w_30min_kWh": energy_kwh([(30, 1800)]),
        "left_face_point_m": wall_face_point((0, 0), (4, 0), 1, 0.2, "left"),
        "floor_relative_band_m": band, "absolute_band_m": absolute,
        "unknown_envelope_band_m": vertical_band(0.3, None, "plate-centre"), "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-electrical-modeling", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Supplied sinusoidal consumption quantities only; no distorted/unbalanced circuit or protection model.",
            "Spatial bands do not resolve physical hosts, door swept volumes, wet-area safety or complete reach.",
            "All sizes/loads are synthetic, not universal mounting or cable/protective-device ratings.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
