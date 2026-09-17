"""Cosine-weighted geometric access; --check tests normalized reference cases."""

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


def fraction(value):
    value = finite(value)
    if not 0 <= value <= 1:
        raise ValueError("Transmission must be a fraction.")
    return value


def positive(value):
    value = finite(value)
    if value <= 0:
        raise ValueError("A positive value is required.")
    return value


def grid_count(value):
    if type(value) is not int or not 1 <= value <= 256:
        raise ValueError("Reference quadrature counts must be integers in [1, 256].")
    return value


def sky_access(transmission_function, radial_bands=12, azimuth_sectors=24):
    if not callable(transmission_function):
        raise ValueError("Supply an explicit directional transmission function.")
    radial_bands, azimuth_sectors = grid_count(radial_bands), grid_count(azimuth_sectors)
    values = []
    for radial in range(radial_bands):
        u = (radial + 0.5) / radial_bands
        for sector in range(azimuth_sectors):
            phi = 2 * math.pi * (sector + 0.5) / azimuth_sectors
            direction = (math.sqrt(u) * math.cos(phi), math.sqrt(u) * math.sin(phi), math.sqrt(1-u))
            values.append(fraction(transmission_function(direction)))
    return finite(math.fsum(values) / len(values))


def area_average(values, areas_m2):
    if len(values) != len(areas_m2):
        raise ValueError("Each sensor needs one area.")
    areas = [positive(area) for area in areas_m2]
    known = [None if value is None else fraction(value) for value in values]
    if not areas or any(value is None for value in known):
        return None
    return finite(sum(value * area for value, area in zip(known, areas)) / positive(sum(areas)))


def path_hours(intervals):
    if not intervals:
        raise ValueError("Supply a nonempty period.")
    presence, equivalent, known_hours, period_hours = 0.0, 0.0, 0.0, 0.0
    unknown = False
    for seconds, value in intervals:
        hours = positive(seconds) / 3600
        period_hours = finite(period_hours + hours)
        if value is None:
            unknown = True
            continue
        tau = fraction(value)
        known_hours = finite(known_hours + hours)
        presence = finite(presence + (hours if tau > 0 else 0))
        equivalent = finite(equivalent + tau * hours)
    return {
        "presence_h": None if unknown else presence,
        "transmitted_equivalent_h": None if unknown else equivalent,
        "known_h": known_hours, "period_h": period_hours, "complete": not unknown,
    }


def reference_cases():
    return {
        "full": sky_access(lambda direction: 1.0),
        "blocked": sky_access(lambda direction: 0.0),
        "clear_half": sky_access(lambda direction: 1.0 if direction[0] > 0 else 0.0),
        "half_with_0_6_transmission": sky_access(lambda direction: 0.6 if direction[0] > 0 else 0.0),
        "zenith_cone_60deg": sky_access(lambda direction: 1.0 if direction[2] >= 0.5 else 0.0),
    }


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
    cases = reference_cases()
    count = check_close(cases["full"], 1)
    count += check_close(cases["blocked"], 0)
    count += check_close(cases["clear_half"], 0.5)
    count += check_close(cases["half_with_0_6_transmission"], 0.3)
    count += check_close(cases["zenith_cone_60deg"], 0.75)
    count += check_close(sky_access(lambda direction: 0.37, 3, 7), 0.37)
    count += check_close(sky_access(lambda direction: 1.0 if direction[2] >= 0.5 else 0.0, 24, 48), 0.75)
    count += check_close(area_average([0.2, 0.6], [1, 3]), 0.5)
    count += check_close(area_average([0, 0], [1, 3]), 0)
    count += check_true(area_average([], []) is None)
    count += check_true(area_average([0.2, None], [1, 3]) is None)
    hours = path_hours([(3600, 0.4), (1800, 0.0)])
    count += check_close(hours["presence_h"], 1)
    count += check_close(hours["transmitted_equivalent_h"], 0.4)
    count += check_close(hours["known_h"], 1.5)
    count += check_close(path_hours([(3600, 0)])["presence_h"], 0)
    unknown = path_hours([(3600, 0.4), (1800, None)])
    count += check_true(unknown["presence_h"] is None and unknown["transmitted_equivalent_h"] is None)
    count += check_close(unknown["known_h"], 1)
    count += check_error(sky_access, lambda direction: 1.1)
    count += check_error(sky_access, lambda direction: None)
    count += check_error(sky_access, lambda direction: math.nan)
    count += check_error(sky_access, lambda direction: 1, 0, 24)
    count += check_error(sky_access, lambda direction: 1, 12, 3.5)
    count += check_error(sky_access, None)
    count += check_error(area_average, [0.2], [0])
    count += check_error(area_average, [0.2], [1, 2])
    count += check_error(path_hours, [(0, 0.5)])
    count += check_error(path_hours, [(3600, -0.1)])
    count += check_error(path_hours, [])
    count += check_error(fraction, True)
    return count


def examples():
    cases = reference_cases()
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 270">',
        '<title>Synthetic cosine-weighted sky access fractions, not lux</title>',
        '<rect width="600" height="270" fill="white"/>',
        '<text x="15" y="25" font-size="15">Computed geometric reference fractions (0 to 1)</text>',
    ]
    for index, (label, value) in enumerate(cases.items()):
        y = 48 + index * 34
        parts.append(f'<text x="15" y="{y+16}" font-size="12">{label}</text>')
        parts.append(f'<rect x="230" y="{y}" width="{300*value:.6f}" height="23" fill="#4a89b6"/>')
        parts.append(f'<text x="{237+300*value:.6f}" y="{y+16}" font-size="12">{value:.3f}</text>')
    parts.append('<text x="15" y="250" font-size="12">Supplied directional masks; no photometric sky or interreflection</text></svg>')
    return {
        "cosine_sky_fraction": cases, "area_weighted_mean": area_average([0.2, 0.6], [1, 3]),
        "known_intervals": path_hours([(3600, 0.4), (1800, 0.0)]),
        "incomplete_intervals": path_hours([(3600, 0.4), (1800, None)]), "svg": "".join(parts),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-daylight-modeling", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Normalized cosine-weighted geometric access is not illuminance, daylight factor or an annual daylight metric.",
            "Synthetic directional masks do not test real aperture reveals, optical materials or room reflections.",
            "Unknown intervals/sensors remain unavailable; numerical fixtures are not calibrated daylight validation.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
