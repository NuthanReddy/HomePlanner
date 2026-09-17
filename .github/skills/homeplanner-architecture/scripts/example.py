"""Independent rectangle-area references; --check runs offline invariants."""

import argparse
import json
import math


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("A supplied real number is required.")
    try:
        result = float(value)
    except OverflowError as error:
        raise ValueError("Number is outside the finite range.") from error
    if not math.isfinite(result):
        raise ValueError("A finite number is required.")
    return result


def rectangle(value):
    if not isinstance(value, (tuple, list)) or len(value) != 4:
        raise ValueError("Expected (x, y, width, height).")
    x, y, w, h = map(finite, value)
    if w <= 0 or h <= 0:
        raise ValueError("Rectangle dimensions must be positive.")
    right, bottom = finite(x + w), finite(y + h)
    if right <= x or bottom <= y or finite(w * h) <= 0:
        raise ValueError("Rectangle is below numerical resolution.")
    return x, y, w, h


def intersection(first, second):
    ax, ay, aw, ah = rectangle(first)
    bx, by, bw, bh = rectangle(second)
    x, y = max(ax, bx), max(ay, by)
    w, h = min(ax + aw, bx + bw) - x, min(ay + ah, by + bh) - y
    return (x, y, w, h) if w > 0 and h > 0 else None


def union_area(rectangles):
    boxes = [rectangle(item) for item in rectangles]
    xs = sorted({edge for x, _, w, _ in boxes for edge in (x, x + w)})
    areas = []
    for left, right in zip(xs, xs[1:]):
        intervals = sorted((y, y + h) for x, y, w, h in boxes if x < right and x + w > left)
        height, end = 0.0, None
        for low, high in intervals:
            height = finite(height + (high - low if end is None else max(0.0, high - max(low, end))))
            end = high if end is None else max(end, high)
        areas.append(finite((right - left) * height))
    return finite(sum(areas))


def net_area(host, cutters):
    host = rectangle(host)
    clipped = [cut for item in cutters if (cut := intersection(host, item)) is not None]
    return finite(host[2] * host[3] - union_area(clipped))


def reservation_bounds(carpet, module):
    cx, cy, cw, ch = rectangle(carpet)
    mx, my, mw, mh = rectangle(module)
    west, north = cx - mx, cy - my
    east, south = mx + mw - cx - cw, my + mh - cy - ch
    if min(west, north, east, south) < 0:
        raise ValueError("The centreline module must contain the carpet.")
    result = rectangle((mx - west, my - north, mw + west + east, mh + north + south))
    if ((west > 0 and result[0] >= mx) or (north > 0 and result[1] >= my)
            or (east > 0 and result[0] + result[2] <= mx + mw)
            or (south > 0 and result[1] + result[3] <= my + mh)):
        raise ValueError("Wall allowance is below numerical resolution.")
    return result


def site_to_enu(x, y, z, heading_deg):
    x, y, z, heading_deg = map(finite, (x, y, z, heading_deg))
    angle = math.radians(heading_deg % 360)
    c, s = math.cos(angle), math.sin(angle)
    return finite(x * c - y * s), finite(-x * s - y * c), z


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
    host = (0, 0, 6, 5)
    cut = reservation_bounds((2, 2, 1.5, 1.5), (1.94, 1.94, 1.62, 1.62))
    count = sum(check_close(a, b) for a, b in zip(cut, (1.88, 1.88, 1.74, 1.74)))
    count += check_close(net_area(host, [cut]), 26.9724)
    cuts = [(1, 1, 2, 2), (2, 1, 2, 2)]
    count += check_close(union_area(cuts), 6)
    count += check_close(net_area(host, cuts), 24)
    count += check_close(net_area(host, cuts + cuts), 24)
    count += check_close(net_area(host, [(5, 4, 2, 2)]), 29)
    count += check_close(net_area(host, [(9, 9, 1, 1)]), 30)
    count += check_close(net_area(host, [host]), 0)
    count += check_close(net_area(host, []), 30)
    count += check_close(union_area([]), 0)
    count += check_true(intersection(host, (6, 0, 2, 2)) is None)
    unequal = reservation_bounds((2, 2, 1, 1), (1.9, 1.8, 1.4, 1.5))
    count += sum(check_close(a, b) for a, b in zip(unequal, (1.8, 1.6, 1.8, 2)))
    count += sum(check_close(a, b) for a, b in zip(site_to_enu(2, 3, 4, 90), (-3, -2, 4)))
    east, north, _ = site_to_enu(2, 3, 4, 37)
    count += check_close(math.hypot(east, north), math.sqrt(13))
    count += check_error(rectangle, (0, 0, 0, 1))
    count += check_error(rectangle, (0, 0, math.inf, 1))
    count += check_error(rectangle, (1e30, 0, 1, 1))
    count += check_error(rectangle, (0, 0, 1e308, 1e308))
    count += check_error(reservation_bounds, (0, 0, 2, 2), (0, 0, 1, 1))
    count += check_error(site_to_enu, 0, None, 0, 0)
    count += check_error(site_to_enu, 0, 0, 0, math.nan)
    count += check_error(rectangle, (False, 0, 1, 1))
    return count


def examples():
    host = (0, 0, 6, 5)
    cut = reservation_bounds((2, 2, 1.5, 1.5), (1.94, 1.94, 1.62, 1.62))
    reserved, net = union_area([cut]), net_area(host, [cut])
    scale, origin_x, origin_y = 45, 35, 55
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 335">'
        '<title>Synthetic wall-inclusive reservation, metres</title>'
        '<rect width="390" height="335" fill="white"/>'
        '<text x="20" y="25" font-size="15">6 x 5 m host; local x right, y down</text>'
        f'<rect x="{origin_x}" y="{origin_y}" width="{host[2]*scale}" height="{host[3]*scale}" '
        'fill="#e2f2df" stroke="#222"/>'
        f'<rect x="{origin_x+cut[0]*scale}" y="{origin_y+cut[1]*scale}" '
        f'width="{cut[2]*scale}" height="{cut[3]*scale}" fill="#f5c76d" stroke="#222"/>'
        f'<text x="20" y="302" font-size="14">Reserved {reserved:.4f} m2; net {net:.4f} m2</text>'
        '<text x="20" y="324" font-size="12">Synthetic geometry, not an approved layout</text></svg>'
    )
    return {
        "host_m": host, "reservation_m": cut, "reserved_m2": reserved, "net_m2": net,
        "overlapping_cut_union_m2": union_area([(1, 1, 2, 2), (2, 1, 2, 2)]),
        "site_2_3_4_heading90_enu_m": site_to_enu(2, 3, 4, 90), "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-architecture", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Synthetic axis-aligned area oracle only; app work must use HomePlannerRegions and commands.",
            "Union accounting does not authorize overlapping service reservations.",
            "No packing, physical clearance, structural, surveyed-bearing or regulatory validation.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
