"""Synthetic site arithmetic; not a survey, legal rule engine or app backend."""

import argparse
from decimal import Decimal
import json
import math
import xml.etree.ElementTree as ET


SKILL = "homeplanner-site-regulations"
EDGES = ("N", "E", "S", "W")


def finite_number(value, name, minimum=0.0, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be an explicitly supplied number")
    if not math.isfinite(value) or value < minimum or (positive and value <= 0):
        raise ValueError(f"{name} must be finite and {'positive' if positive else 'nonnegative'}")
    return float(value)


def edge_values(values, name):
    if not isinstance(values, dict) or set(values) != set(EDGES):
        raise ValueError(f"{name} must supply N, E, S and W")
    return {edge: finite_number(values[edge], f"{name}.{edge}") for edge in EDGES}


def rectangular_site(width_m, depth_m, strips_m, setbacks_m, open_fraction):
    width = finite_number(width_m, "gross width", positive=True)
    depth = finite_number(depth_m, "gross depth", positive=True)
    strips = edge_values(strips_m, "strips")
    setbacks = edge_values(setbacks_m, "setbacks")
    fraction = finite_number(open_fraction, "open-space fraction")
    if fraction > 1:
        raise ValueError("open-space fraction must not exceed one")
    net_width = width - strips["W"] - strips["E"]
    net_depth = depth - strips["N"] - strips["S"]
    if net_width <= 0 or net_depth <= 0:
        raise ValueError("boundary deductions consume the property")
    build_width = net_width - setbacks["W"] - setbacks["E"]
    build_depth = net_depth - setbacks["N"] - setbacks["S"]
    if build_width <= 0 or build_depth <= 0:
        raise ValueError("setbacks leave no positive rectangular envelope")
    gross_area = width * depth
    net_area = net_width * net_depth
    envelope_area = build_width * build_depth
    open_area = fraction * net_area
    usable = max(0.0, envelope_area - open_area)
    for value in (gross_area, net_area, envelope_area, open_area, usable):
        if not math.isfinite(value):
            raise ValueError("area arithmetic exceeded finite numeric range")
    return {
        "gross_m": {"w": width, "h": depth},
        "net_m": {"x": strips["W"], "y": strips["N"], "w": net_width, "h": net_depth},
        "envelope_m": {
            "x": strips["W"] + setbacks["W"], "y": strips["N"] + setbacks["N"],
            "w": build_width, "h": build_depth,
        },
        "gross_area_m2": gross_area,
        "net_area_m2": net_area,
        "surrendered_area_m2": gross_area - net_area,
        "envelope_area_m2": envelope_area,
        "open_space_m2": open_area,
        "usable_footprint_m2": usable,
        "coverage_percent": 100 * usable / net_area,
        "loss_percent": 100 * (1 - usable / net_area),
        "status": "positive-reference-envelope" if usable > 0 else "consumed-by-open-space",
    }


def fixed_band_optimum(area_m2, lateral_sum_m, longitudinal_sum_m):
    area = finite_number(area_m2, "fixed area", positive=True)
    lateral = finite_number(lateral_sum_m, "lateral setback sum", positive=True)
    longitudinal = finite_number(longitudinal_sum_m, "longitudinal setback sum", positive=True)
    if area <= lateral * longitudinal:
        raise ValueError("fixed area cannot contain this setback envelope")
    width = math.sqrt(area) * math.sqrt(lateral) / math.sqrt(longitudinal)
    depth = area / width
    envelope = (width - lateral) * (depth - longitudinal)
    if not all(math.isfinite(value) and value > 0 for value in (width, depth, envelope)):
        raise ValueError("optimum exceeds the supported finite numeric range")
    return {"width_m": width, "depth_m": depth, "envelope_area_m2": envelope}


def render_svg(site):
    root = ET.Element("svg", {
        "xmlns": "http://www.w3.org/2000/svg", "viewBox": "0 0 600 430",
        "role": "img", "aria-labelledby": "site-title site-description",
    })
    ET.SubElement(root, "title", {"id": "site-title"}).text = "Synthetic site envelope"
    ET.SubElement(root, "desc", {"id": "site-description"}).text = (
        "Metre-based gross, net and setback rectangles. Not a survey or approval drawing."
    )
    gross = site["gross_m"]
    scale = min(230 / gross["w"], 300 / gross["h"])
    ET.SubElement(root, "rect", {"width": "600", "height": "430", "fill": "white"})
    layers = (
        ({"x": 0, "y": 0, **gross}, "#edf0f2", "#56616d"),
        (site["net_m"], "white", "#1f5d99"),
        (site["envelope_m"], "#dbece3", "#28664b"),
    )
    for rectangle, fill, stroke in layers:
        ET.SubElement(root, "rect", {
            "x": f'{35 + rectangle["x"] * scale:.6f}',
            "y": f'{55 + rectangle["y"] * scale:.6f}',
            "width": f'{rectangle["w"] * scale:.6f}',
            "height": f'{rectangle["h"] * scale:.6f}',
            "fill": fill, "stroke": stroke, "stroke-width": "2",
        })
    labels = [
        ("North / example frontage", 35, 30),
        (f'Gross: {site["gross_area_m2"]:.3f} m2', 310, 75),
        (f'Net: {site["net_area_m2"]:.3f} m2', 310, 105),
        (f'Envelope: {site["envelope_area_m2"]:.3f} m2', 310, 135),
        (f'Usable: {site["usable_footprint_m2"]:.3f} m2', 310, 165),
        (f'Coverage: {site["coverage_percent"]:.3f}%', 310, 195),
        ("Synthetic dimensions; no legal approval", 35, 395),
    ]
    for label, x, y in labels:
        ET.SubElement(root, "text", {
            "x": str(x), "y": str(y), "font-family": "sans-serif", "font-size": "13", "fill": "#203040",
        }).text = label
    return ET.tostring(root, encoding="unicode")


def examples():
    site = rectangular_site(
        12, 18, {"N": 1, "E": 0, "S": 0, "W": 0},
        {"N": 3, "E": 1.5, "S": 1.5, "W": 1.5}, 0,
    )
    foot = Decimal("0.3048")
    return {
        "unit_factors_exact": {
            "foot_m": str(foot), "square_foot_m2": str(foot ** 2),
            "square_yard_m2": str((3 * foot) ** 2),
        },
        "site": site,
        "fixed_band_optimum": fixed_band_optimum(216, 3, 4.5),
        "three_repeated_plates_m2": 3 * site["usable_footprint_m2"],
        "svg": render_svg(site),
    }


def run_checks(data):
    count = 0

    def check(condition, message):
        nonlocal count
        if not condition:
            raise AssertionError(message)
        count += 1

    def rejects(callback):
        try:
            callback()
        except ValueError:
            check(True, "rejected invalid input")
        else:
            check(False, "invalid input was accepted")

    check(Decimal(data["unit_factors_exact"]["square_foot_m2"]) == Decimal("0.09290304"), "ft2 factor")
    check(Decimal(data["unit_factors_exact"]["square_yard_m2"]) == Decimal("0.83612736"), "yd2 factor")
    site = data["site"]
    for key, expected in (
        ("gross_area_m2", 216), ("net_area_m2", 204), ("envelope_area_m2", 112.5),
        ("surrendered_area_m2", 12), ("coverage_percent", 55.14705882352941),
    ):
        check(math.isclose(site[key], expected, rel_tol=1e-12, abs_tol=1e-12), key)
    check(math.isclose(site["coverage_percent"] + site["loss_percent"], 100), "percentage conservation")
    check(data["three_repeated_plates_m2"] == 337.5, "scenario plate sum")
    optimum = data["fixed_band_optimum"]
    check(math.isclose(optimum["width_m"], 12, abs_tol=1e-12), "optimum width")
    check(math.isclose(optimum["depth_m"], 18, abs_tol=1e-12), "optimum depth")
    check(math.isclose(optimum["envelope_area_m2"], 121.5, abs_tol=1e-12), "optimum area")
    for width in (11.5, 12.5):
        alternative = (width - 3) * (216 / width - 4.5)
        check(alternative < optimum["envelope_area_m2"], "optimum beats nearby aspect ratio")
    no_strips = dict.fromkeys(EDGES, 0)
    setbacks = {"N": 3, "E": 1.5, "S": 1.5, "W": 1.5}
    corner = rectangular_site(12, 18, {"N": 1, "E": 0, "S": 0, "W": 1}, setbacks, 0)
    check(corner["surrendered_area_m2"] == 29, "corner strips must not be double-counted")
    exhausted = rectangular_site(12, 18, no_strips, setbacks, 1)
    check(exhausted["usable_footprint_m2"] == 0 and exhausted["status"] == "consumed-by-open-space",
          "open-space exhaustion is explicit")
    for invalid in (None, True, float("nan"), float("inf"), -1, 0):
        rejects(lambda value=invalid: rectangular_site(value, 18, no_strips, setbacks, 0))
    rejects(lambda: rectangular_site(12, 18, no_strips, {"N": 3}, 0))
    rejects(lambda: rectangular_site(12, 18, no_strips, {**setbacks, "E": 12}, 0))
    rejects(lambda: rectangular_site(12, 18, {"N": 18, "E": 0, "S": 0, "W": 0}, setbacks, 0))
    rejects(lambda: rectangular_site(12, 18, no_strips, setbacks, 1.1))
    rejects(lambda: fixed_band_optimum(216, 0, 4.5))
    rejects(lambda: fixed_band_optimum(10, 3, 4.5))
    check(ET.fromstring(data["svg"]).tag == "{http://www.w3.org/2000/svg}svg", "valid SVG root")
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Run synthetic numerical and invalid-input checks")
    args = parser.parse_args()
    data = examples()
    print(json.dumps({
        "skill": SKILL, "checks": run_checks(data) if args.check else 0, "examples": data,
        "limitations": [
            "Synthetic rectangular reference; no survey, title opinion, approval or implemented TDR decision.",
            "The fixed-band optimum excludes changing rule bands and access or frontage constraints.",
            "The SVG is schematic and labelled in metres, not a certified construction sheet scale.",
        ],
    }, allow_nan=False, sort_keys=True))


if __name__ == "__main__":
    main()
