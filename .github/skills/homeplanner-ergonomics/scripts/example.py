"""Supplied clearance and thin-leaf sweep examples; --check tests invariants."""

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


def point2(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("Supply an (x, y) pair.")
    return tuple(map(finite, value))


def clearance_margin(measured_m, target_m, verified):
    target = positive(target_m)
    if type(verified) is not bool:
        raise ValueError("Verification state must be explicit.")
    if measured_m is None:
        return None
    measured = finite(measured_m)
    if measured < 0:
        raise ValueError("Clear width cannot be negative.")
    return finite(measured - target) if verified else None


def free_intervals(width_m, blocked_spans):
    width = positive(width_m)
    blocked = []
    for span in blocked_spans:
        left, right = point2(span)
        if right <= left:
            raise ValueError("Obstructed intervals must have positive extent.")
        low, high = max(0.0, left), min(width, right)
        if high > low:
            blocked.append((low, high))
    cursor, free = 0.0, []
    for left, right in sorted(blocked):
        if left > cursor:
            free.append((cursor, left))
        cursor = max(cursor, right)
    if cursor < width:
        free.append((cursor, width))
    return free


def largest_interval(intervals):
    widths = []
    for interval in intervals:
        left, right = point2(interval)
        widths.append(positive(right - left))
    return max(widths, default=0.0)


def door_tip(hinge, radius_m, angle_deg):
    hx, hy = point2(hinge)
    radius, degrees = positive(radius_m), finite(angle_deg)
    if not 0 <= degrees <= 90:
        raise ValueError("This reference covers only the +x to +y quarter sweep.")
    angle = math.radians(degrees)
    return finite(hx + radius * math.cos(angle)), finite(hy + radius * math.sin(angle))


def quarter_sweep_area(radius_m):
    radius = positive(radius_m)
    return finite(math.pi * radius * radius / 4)


def quarter_sweep_intersects(hinge, radius_m, obstacle):
    hx, hy = point2(hinge)
    radius = positive(radius_m)
    if not isinstance(obstacle, (tuple, list)) or len(obstacle) != 4:
        raise ValueError("Supply an (x,y,width,height) obstacle.")
    x, y = finite(obstacle[0]), finite(obstacle[1])
    width, height = positive(obstacle[2]), positive(obstacle[3])
    right, bottom = finite(x + width), finite(y + height)
    if right <= x or bottom <= y:
        raise ValueError("Obstacle dimensions are below numerical resolution.")
    xmin, ymin = max(0.0, finite(x-hx)), max(0.0, finite(y-hy))
    xmax, ymax = finite(right-hx), finite(bottom-hy)
    return xmax >= xmin and ymax >= ymin and finite(math.hypot(xmin, ymin)) <= radius


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
    count = check_close(clearance_margin(0.86, 0.9, True), -0.04)
    count += check_close(clearance_margin(0.9, 0.9, True), 0)
    count += check_true(clearance_margin(None, 0.9, False) is None)
    count += check_true(clearance_margin(0.9, 0.9, False) is None)
    free = free_intervals(1.4, [(0.45, 0.65)])
    count += check_close(largest_interval(free), 0.75)
    count += check_close(sum(right-left for left, right in free), 1.2)
    count += check_close(largest_interval(free_intervals(1.4, [])), 1.4)
    count += check_close(largest_interval(free_intervals(1.4, [(0, 2)])), 0)
    count += check_close(largest_interval(free_intervals(1.4, [(2, 3)])), 1.4)
    count += check_close(largest_interval(free_intervals(1.4, [(0.4, 0.6), (0.5, 0.7)])), 0.7)
    count += check_close(quarter_sweep_area(0.9), 0.6361725123519332)
    tip = door_tip((0, 0), 0.9, 90)
    count += check_close(tip[0], 0)
    count += check_close(tip[1], 0.9)
    count += check_true(quarter_sweep_intersects((0, 0), 0.9, (0.5, 0.5, 0.2, 0.2)))
    count += check_true(not quarter_sweep_intersects((0, 0), 1, (0.8, 0.8, 0.1, 0.1)))
    count += check_true(quarter_sweep_intersects((0, 0), 1, (1, 0, 0.1, 0.1)))
    count += check_true(not quarter_sweep_intersects((0, 0), 1, (-2, -2, 0.5, 0.5)))
    count += check_true(quarter_sweep_intersects((3, 4), 0.9, (3.5, 4.5, 0.2, 0.2)))
    count += check_error(clearance_margin, -1, 0.9, True)
    count += check_error(clearance_margin, 1, None, True)
    count += check_error(free_intervals, 0, [])
    count += check_error(free_intervals, 1.4, [(0.6, 0.4)])
    count += check_error(door_tip, (0, 0), 0, 90)
    count += check_error(door_tip, (0, 0), 1, 91)
    count += check_error(quarter_sweep_intersects, (0, 0), 1, (0, 0, -1, 1))
    count += check_error(quarter_sweep_area, math.inf)
    count += check_error(quarter_sweep_area, 1e308)
    count += check_error(finite, True)
    return count


def examples():
    radius, obstacle = 0.9, (0.5, 0.5, 0.2, 0.2)
    free = free_intervals(1.4, [(0.45, 0.65)])
    largest = largest_interval(free)
    arc = [door_tip((0, 0), radius, degree) for degree in range(0, 91, 3)]
    points = "40,55 " + " ".join(f"{40+x*160:.4f},{55+y*160:.4f}" for x, y in arc) + " 40,55"
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 615 295">',
        '<title>Synthetic thin-leaf sweep and route cross-section, not certification</title>',
        '<rect width="615" height="295" fill="white"/>',
        '<text x="15" y="25" font-size="15">Supplied r=0.90 m; plan sweep only</text>',
        f'<polygon points="{points}" fill="#deebf5" stroke="#286499"/>',
        f'<rect x="{40+obstacle[0]*160}" y="{55+obstacle[1]*160}" width="{obstacle[2]*160}" height="{obstacle[3]*160}" fill="#e8b881" stroke="#222"/>',
        '<text x="300" y="55" font-size="13">One cross-section, not the full route</text>',
        '<rect x="300" y="85" width="280" height="55" fill="#e8b881" stroke="#222"/>',
    ]
    for left, right in free:
        parts.append(f'<rect x="{300+left*200}" y="85" width="{(right-left)*200}" height="55" fill="#d9efd9" stroke="#222"/>')
    parts.extend([
        f'<text x="300" y="167" font-size="13">Largest gap {largest:.2f} m; target 0.90 m</text>',
        f'<text x="300" y="190" font-size="13">Margin {clearance_margin(largest, 0.9, True):.2f} m</text>',
        '<text x="15" y="238" font-size="12">Door clear opening unknown; nominal leaf is not a measured passage</text>',
        '<text x="15" y="272" font-size="12">No vertical/hardware, full-route, ADA or medical assessment</text></svg>',
    ])
    return {
        "supplied_target_m": 0.9, "unverified_nominal_width_margin_m": clearance_margin(0.9, 0.9, False),
        "measured_0_86_margin_m": clearance_margin(0.86, 0.9, True),
        "free_intervals_m": free, "largest_section_gap_m": largest,
        "sweep_area_m2": quarter_sweep_area(radius), "door_tip_at_90deg_m": door_tip((0, 0), radius, 90),
        "supplied_obstacle_plan_contact": quarter_sweep_intersects((0, 0), radius, obstacle),
        "vertical_overlap_assessed": False, "svg": "".join(parts),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-ergonomics", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "All targets are synthetic supplied dimensions, never universal ADA, local-code or medical thresholds.",
            "One section and a thin-leaf plan sector do not prove continuous circulation or 3D clearance.",
            "Nominal leaf width and unknown heights remain unverified; no physical or interaction certification.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
