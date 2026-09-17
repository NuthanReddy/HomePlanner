"""Geometry and supplied hydraulic laws; --check tests independent references."""

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


def positive(value):
    value = finite(value)
    if value <= 0:
        raise ValueError("A positive value is required.")
    return value


def nonnegative(value):
    value = finite(value)
    if value < 0:
        raise ValueError("A nonnegative value is required.")
    return value


def point3(value):
    if not isinstance(value, (tuple, list)) or len(value) != 3:
        raise ValueError("Supply a resolved (x,y,z) axis point.")
    return tuple(map(finite, value))


def route_lengths(points):
    if len(points) < 2:
        raise ValueError("At least two axis points are required.")
    points = [None if point is None else point3(point) for point in points]
    if any(point is None for point in points):
        return {"horizontal_m": None, "axis_xyz_m": None}
    horizontal, spatial = 0.0, 0.0
    for start, end in zip(points, points[1:]):
        delta = [finite(b-a) for a, b in zip(start, end)]
        horizontal = finite(horizontal + finite(math.hypot(*delta[:2])))
        spatial = finite(spatial + finite(math.hypot(*delta)))
    return {"horizontal_m": horizontal, "axis_xyz_m": spatial}


def fall_gradient(upstream_m, downstream_m, horizontal_m):
    upstream = None if upstream_m is None else finite(upstream_m)
    downstream = None if downstream_m is None else finite(downstream_m)
    run = None if horizontal_m is None else nonnegative(horizontal_m)
    fall = None if upstream is None or downstream is None else finite(upstream-downstream)
    return {"fall_m": fall, "gradient_m_m": None if fall is None or run in (None, 0) else finite(fall/run)}


def invert_profile(points, inverts_m):
    if len(points) < 2 or len(points) != len(inverts_m):
        raise ValueError("Each ordered route point needs an explicit invert entry, possibly None.")
    points = [None if point is None else point3(point) for point in points]
    levels = [None if level is None else finite(level) for level in inverts_m]
    lengths = route_lengths(points)
    spans = []
    for index, (start, end) in enumerate(zip(points, points[1:])):
        run = None if start is None or end is None else route_lengths([start, end])["horizontal_m"]
        spans.append({"horizontal_m": run, **fall_gradient(levels[index], levels[index+1], run)})
    return {
        **lengths, "endpoint": fall_gradient(levels[0], levels[-1], lengths["horizontal_m"]),
        "all_inverts_supplied": all(level is not None for level in levels),
        "all_gradients_available": all(span["gradient_m_m"] is not None for span in spans),
        "inverts_m": levels, "spans": spans,
    }


def continuity_residual(inflows_m3s, outflows_m3s, demand_m3s, storage_rate_m3s):
    incoming = finite(sum(map(nonnegative, inflows_m3s)))
    outgoing = finite(sum(map(nonnegative, outflows_m3s)))
    return finite(incoming - outgoing - nonnegative(demand_m3s) - finite(storage_rate_m3s))


def darcy_weisbach(flow_m3s, length_m, internal_diameter_m, darcy_factor, minor_k,
                  density_kg_m3, viscosity_m2_s, gravity_m_s2):
    flow, length, diameter = finite(flow_m3s), nonnegative(length_m), positive(internal_diameter_m)
    factor, minor = positive(darcy_factor), nonnegative(minor_k)
    density, viscosity, gravity = map(positive, (density_kg_m3, viscosity_m2_s, gravity_m_s2))
    area = positive(math.pi * diameter * diameter / 4)
    velocity = finite(flow / area)
    reynolds = finite(abs(velocity) * diameter / viscosity)
    loss_coefficient = nonnegative(factor * length / diameter + minor)
    head = finite(loss_coefficient * velocity * abs(velocity) / finite(2 * gravity))
    pressure = finite(density * gravity * head)
    return {"area_m2": area, "velocity_m_s": velocity, "reynolds": reynolds,
            "signed_headloss_m": head, "signed_pressure_drop_Pa": pressure}


def manning_open_channel(area_m2, wetted_perimeter_m, energy_gradient, roughness_s_mthird):
    area, perimeter = positive(area_m2), positive(wetted_perimeter_m)
    slope, roughness = nonnegative(energy_gradient), positive(roughness_s_mthird)
    radius = positive(area / perimeter)
    return finite((area / roughness) * radius ** (2/3) * math.sqrt(slope))


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
    points = [(0, 0, 2), (4, 0, 2), (8, 0, 2)]
    profile = invert_profile(points, [1.5, None, 1.34])
    count = check_close(profile["horizontal_m"], 8)
    count += check_close(profile["endpoint"]["fall_m"], 0.16)
    count += check_close(profile["endpoint"]["gradient_m_m"], 0.02)
    count += check_true(not profile["all_inverts_supplied"] and not profile["all_gradients_available"])
    count += check_true(profile["spans"][0]["gradient_m_m"] is None)
    complete = invert_profile(points, [1.5, 1.42, 1.34])
    count += check_true(complete["all_gradients_available"])
    count += check_close(complete["spans"][0]["gradient_m_m"], 0.02)
    count += check_close(fall_gradient(1, 1.2, 2)["gradient_m_m"], -0.1)
    count += check_true(fall_gradient(2, 1, 0)["gradient_m_m"] is None)
    count += check_true(route_lengths([(0, 0, 0), None, (3, 4, 0)])["axis_xyz_m"] is None)
    count += check_close(route_lengths([(0, 0, 0), (3, 4, 12)])["axis_xyz_m"], 13)
    count += check_close(route_lengths([(0, 0, 0), (3, 4, 12)])["horizontal_m"], 5)
    count += check_close(continuity_residual([0.020], [0.012], 0.008, 0), 0)
    count += check_close(continuity_residual([0.020], [0.012], 0.008, 0.001), -0.001)
    flow = math.pi*0.1*0.1/4
    hydraulic = darcy_weisbach(flow, 10, 0.1, 0.02, 1, 1000, 1e-6, 9.81)
    count += check_close(hydraulic["velocity_m_s"], 1)
    count += check_close(hydraulic["reynolds"], 100000)
    count += check_close(hydraulic["signed_headloss_m"], 0.1529051987767584)
    count += check_close(hydraulic["signed_pressure_drop_Pa"], 1500)
    count += check_close(darcy_weisbach(-flow, 10, 0.1, 0.02, 1, 1000, 1e-6, 9.81)["signed_pressure_drop_Pa"], -1500)
    count += check_close(darcy_weisbach(0, 10, 0.1, 0.02, 1, 1000, 1e-6, 9.81)["signed_headloss_m"], 0)
    count += check_close(manning_open_channel(0.5, 2, 0.01, 0.025), 0.7937005259840998)
    count += check_close(manning_open_channel(0.5, 2, 0, 0.025), 0)
    count += check_error(manning_open_channel, 0.5, 2, -0.01, 0.025)
    count += check_error(manning_open_channel, 0.5, 2, 0.01, 0)
    count += check_error(darcy_weisbach, flow, 10, 0, 0.02, 1, 1000, 1e-6, 9.81)
    count += check_error(darcy_weisbach, flow, 10, 0.1, 0.02, 1, 1000, None, 9.81)
    count += check_error(invert_profile, points, [1.5, 1.34])
    count += check_error(fall_gradient, 1.5, math.inf, 8)
    count += check_error(route_lengths, [(0, 0, 0), (math.nan, 1, 1)])
    count += check_error(darcy_weisbach, 1e308, 10, 0.1, 0.02, 1, 1000, 1e-6, 9.81)
    count += check_error(finite, True)
    return count


def examples():
    points = [(0, 0, 2), (4, 0, 2), (8, 0, 2)]
    levels = [1.5, None, 1.34]
    profile = invert_profile(points, levels)
    hydraulic = darcy_weisbach(math.pi*0.1*0.1/4, 10, 0.1, 0.02, 1, 1000, 1e-6, 9.81)
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 295">',
        '<title>Synthetic invert endpoints with an explicitly unknown via level</title>',
        '<rect width="600" height="295" fill="white"/>',
        '<text x="15" y="25" font-size="15">Supplied endpoint inverts; no interpolation through unknown via</text>',
        '<path d="M60 65 V205 H470" stroke="#222" fill="none"/>',
        '<text x="15" y="108" font-size="12">1.50 m</text><text x="15" y="208" font-size="12">1.30 m</text>',
    ]
    for point, level in zip(points, levels):
        x = 60 + point[0]*50
        parts.append(f'<text x="{x-8}" y="224" font-size="12">{point[0]:g} m</text>')
        if level is None:
            parts.append(f'<text x="{x-48}" y="145" font-size="13">invert unknown</text>')
        else:
            y = 205 - (level - 1.3)*500
            parts.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#286499"/>')
            parts.append(f'<text x="{x+8}" y="{y-8}" font-size="12">{level:.2f} m</text>')
    parts.extend([
        f'<text x="15" y="253" font-size="13">Endpoint fall {profile["endpoint"]["fall_m"]:.2f} m / {profile["horizontal_m"]:.0f} m run</text>',
        '<text x="15" y="280" font-size="12">Profile incomplete; no pipe capacity, sizing or discharge approval</text></svg>',
    ])
    return {
        "incomplete_invert_profile": profile,
        "separately_supplied_complete_profile": invert_profile(points, [1.5, 1.42, 1.34]),
        "synthetic_continuity_residual_m3_s": continuity_residual([0.020], [0.012], 0.008, 0),
        "supplied_filled_pipe_example": hydraulic,
        "separate_open_channel_flow_m3_s": manning_open_channel(0.5, 2, 0.01, 0.025),
        "svg": "".join(parts),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-plumbing-drainage", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Current app hydraulics are not evaluated; these separate supplied-law fixtures do not size a network.",
            "Darcy filled-pipe pressure loss and Manning uniform open-channel flow have different domains.",
            "Unknown inverts remain unknown; no safe cover, receiving capacity, rainfall or legal-discharge conclusion.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
