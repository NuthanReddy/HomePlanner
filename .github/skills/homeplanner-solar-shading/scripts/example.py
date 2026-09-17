"""Supplied-angle solar geometry and UTC sums; --check runs offline references."""

import argparse
from datetime import datetime, timezone
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


def altitude(value):
    value = finite(value)
    if not -90 <= value <= 90:
        raise ValueError("Altitude must be in [-90, 90] degrees.")
    return value


def transmission(value):
    value = finite(value)
    if not 0 <= value <= 1:
        raise ValueError("Transmission must be a fraction.")
    return value


def sun_enu(altitude_deg, azimuth_deg):
    a = math.radians(altitude(altitude_deg))
    b = math.radians(finite(azimuth_deg) % 360)
    return math.cos(a) * math.sin(b), math.cos(a) * math.cos(b), math.sin(a)


def shadow_length(height_m, altitude_deg):
    height, degrees = finite(height_m), altitude(altitude_deg)
    if height < 0:
        raise ValueError("Pole height cannot be negative.")
    if degrees <= 0:
        return None
    if degrees == 90 or height == 0:
        return 0.0
    tangent = math.tan(math.radians(degrees))
    if tangent <= 0:
        raise ValueError("Altitude is below positive numerical resolution.")
    return finite(height / tangent)


def shadow_tip(height_m, altitude_deg, azimuth_deg):
    bearing = math.radians(finite(azimuth_deg) % 360)
    length = shadow_length(height_m, altitude_deg)
    if length is None:
        return None
    return finite(-length * math.sin(bearing)), finite(-length * math.cos(bearing))


def direct_plane_wm2(dni_wm2, altitude_deg, azimuth_deg, normal_enu, path_transmission):
    dni, tau = finite(dni_wm2), transmission(path_transmission)
    if dni < 0 or not isinstance(normal_enu, (list, tuple)) or len(normal_enu) != 3:
        raise ValueError("Supply nonnegative DNI and a 3D unit normal.")
    normal = tuple(map(finite, normal_enu))
    if not math.isclose(math.hypot(*normal), 1.0, rel_tol=1e-10, abs_tol=1e-10):
        raise ValueError("Surface normal must be unit length.")
    sun = sun_enu(altitude_deg, azimuth_deg)
    return 0.0 if altitude_deg <= 0 else finite(dni * max(0.0, sum(a*b for a, b in zip(normal, sun))) * tau)


def utc_instant(text):
    if not isinstance(text, str):
        raise ValueError("Supply an ISO datetime with an explicit UTC offset.")
    instant = datetime.fromisoformat(text)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("Naive civil times must be resolved before integration.")
    return instant.astimezone(timezone.utc)


def interval_totals(intervals):
    if not intervals:
        raise ValueError("At least one complete interval is required.")
    previous_end = None
    presence, equivalent, energy, elapsed = 0.0, 0.0, 0.0, 0.0
    for start_text, end_text, tau_value, irradiance_value in intervals:
        start, end = utc_instant(start_text), utc_instant(end_text)
        if end <= start or (previous_end is not None and start != previous_end):
            raise ValueError("Intervals must be positive and contiguous.")
        tau, irradiance = transmission(tau_value), finite(irradiance_value)
        if irradiance < 0:
            raise ValueError("Incident irradiance cannot be negative.")
        hours = (end - start).total_seconds() / 3600
        presence += hours if tau > 0 else 0
        equivalent += hours * tau
        energy += hours * irradiance
        elapsed += hours
        previous_end = end
    return {"presence_h": finite(presence), "transmitted_equivalent_h": finite(equivalent),
            "incident_Wh_m2": finite(energy), "elapsed_h": finite(elapsed)}


def synthetic_intervals():
    return [
        ("2026-06-21T06:00:00+00:00", "2026-06-21T07:00:00+00:00", 0.4, 500),
        ("2026-06-21T07:00:00+00:00", "2026-06-21T07:30:00+00:00", 0.0, 200),
    ]


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
    count = check_close(shadow_length(2, 30), 3.4641016151377544)
    count += check_close(shadow_length(2, 45), 2)
    count += check_close(shadow_length(2, 60), 1.1547005383792515)
    count += check_close(shadow_length(2, 90), 0)
    count += check_close(shadow_length(0, 30), 0)
    count += check_true(shadow_length(2, 0) is None and shadow_length(2, -30) is None)
    count += check_close(shadow_tip(2, 30, 90)[0], -3.4641016151377544)
    count += check_close(math.hypot(*sun_enu(30, 90)), 1)
    count += check_close(sun_enu(0, 0)[1], 1)
    count += check_close(sun_enu(0, 270)[0], -1)
    count += check_close(direct_plane_wm2(800, 30, 90, (0, 0, 1), 0.5), 200)
    count += check_close(direct_plane_wm2(800, -30, 90, (1, 0, 0), 1), 0)
    totals = interval_totals(synthetic_intervals())
    count += check_close(totals["presence_h"], 1)
    count += check_close(totals["transmitted_equivalent_h"], 0.4)
    count += check_close(totals["incident_Wh_m2"], 600)
    count += check_true(utc_instant("2026-06-21T12:00:00+05:30") == utc_instant("2026-06-21T06:30:00+00:00"))
    count += check_error(shadow_length, -1, 30)
    count += check_error(shadow_length, 2, 91)
    count += check_error(shadow_length, 2, None)
    count += check_error(shadow_length, 1e308, 0.001)
    count += check_error(sun_enu, math.nan, 90)
    count += check_error(transmission, 1.1)
    count += check_error(direct_plane_wm2, 800, 30, 90, (0, 0, 2), 1)
    count += check_error(direct_plane_wm2, 800, 30, 90, None, 1)
    count += check_error(utc_instant, "2026-06-21T12:00:00")
    count += check_error(interval_totals, [])
    count += check_error(interval_totals, [("2026-06-21T07:00:00+00:00", "2026-06-21T06:00:00+00:00", 1, 500)])
    count += check_error(interval_totals, [synthetic_intervals()[0], synthetic_intervals()[0]])
    count += check_error(interval_totals, [("2026-06-21T06:00:00+00:00", "2026-06-21T07:00:00+00:00", None, 500)])
    count += check_error(sun_enu, True, 0)
    return count


def examples():
    height, degrees, bearing = 2.0, 30.0, 90.0
    length = shadow_length(height, degrees)
    scale, ground_y, base_x = 60.0, 180.0, 265.0
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 260">'
        '<title>Synthetic level-ground pole shadow; section looking north</title>'
        '<rect width="470" height="260" fill="white"/>'
        '<text x="15" y="25" font-size="15">Supplied sun altitude 30 deg; azimuth E90</text>'
        f'<path d="M25 {ground_y} H440 M{base_x} {ground_y} V{ground_y-height*scale}" stroke="#222" fill="none"/>'
        f'<path d="M{base_x-length*scale} {ground_y} H{base_x}" stroke="#5b73b5" stroke-width="5"/>'
        f'<path d="M{base_x-length*scale} {ground_y} L{base_x} {ground_y-height*scale}" stroke="#c68b19" fill="none"/>'
        f'<text x="280" y="115" font-size="14">h = {height:g} m</text>'
        f'<text x="35" y="210" font-size="14">West shadow L = {length:.6f} m</text>'
        '<text x="15" y="242" font-size="12">Geometry only; no site ephemeris, weather or PV yield</text></svg>'
    )
    return {
        "supplied_angles_deg": {"altitude": degrees, "azimuth": bearing},
        "sun_enu": sun_enu(degrees, bearing), "pole_height_m": height,
        "shadow_length_m": length, "shadow_tip_enu_horizontal_m": shadow_tip(height, degrees, bearing),
        "night_shadow_m": shadow_length(height, -10), "interval_totals": interval_totals(synthetic_intervals()),
        "supplied_dni_800_transmission_half_horizontal_wm2": direct_plane_wm2(800, 30, 90, (0, 0, 1), 0.5),
        "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-solar-shading", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Supplied-angle, level-ground geometry only; not another ephemeris or arbitrary mesh shadow engine.",
            "Explicit UTC offsets do not resolve IANA gaps/repetitions; EPW standard time is a separate contract.",
            "Sun duration and incident Wh/m2 are not lux, absorbed heat, actual sunshine or PV electrical yield.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
