"""Fixed-scale length and sheet examples; --check verifies units and failures."""

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


def paper_mm(length_m, scale_denominator):
    return finite(nonnegative(length_m) * (1000 / positive(scale_denominator)))


def model_metres(length_mm, scale_denominator):
    return finite(nonnegative(length_mm) * positive(scale_denominator) / 1000)


def pdf_points(length_mm):
    return finite(nonnegative(length_mm) * (72 / 25.4))


def ideal_pixels(length_mm, dpi):
    return finite(nonnegative(length_mm) * (positive(dpi) / 25.4))


def pdf_point(x_mm, y_mm, page_height_mm):
    x, y, height = nonnegative(x_mm), nonnegative(y_mm), positive(page_height_mm)
    if y > height:
        raise ValueError("The supplied y coordinate is outside this page.")
    return pdf_points(x), pdf_points(height - y)


def sheet_fit(width_m, height_m, scale_denominator, paper_width_mm, paper_height_mm, margins_mm):
    width, height = positive(width_m), positive(height_m)
    paper_width, paper_height = positive(paper_width_mm), positive(paper_height_mm)
    if not isinstance(margins_mm, (list, tuple)) or len(margins_mm) != 4:
        raise ValueError("Supply left, right, top and bottom margins.")
    left, right, top, bottom = map(nonnegative, margins_mm)
    available_width = positive(paper_width - left - right)
    available_height = positive(paper_height - top - bottom)
    drawn_width, drawn_height = paper_mm(width, scale_denominator), paper_mm(height, scale_denominator)
    return {
        "fits_geometry_only": drawn_width <= available_width and drawn_height <= available_height,
        "available_mm": [available_width, available_height],
        "drawn_mm": [drawn_width, drawn_height],
        "diagnostic_minimum_denominator": finite(max(width * 1000 / available_width, height * 1000 / available_height)),
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
    count = check_close(paper_mm(10, 100), 100)
    count += check_close(model_metres(100, 100), 10)
    count += check_close(pdf_points(25.4), 72)
    count += check_close(ideal_pixels(25.4, 300), 300)
    count += check_close(paper_mm(0, 75), 0)
    count += check_close(paper_mm(10, 50), 200)
    count += check_close(pdf_points(297), 841.8897637795276)
    count += check_close(pdf_point(20, 40, 210)[1], 481.8897637795276)
    count += check_close(pdf_point(20, 210, 210)[1], 0)
    count += check_true(sheet_fit(10, 5, 100, 297, 210, (15, 15, 15, 15))["fits_geometry_only"])
    overflow = sheet_fit(30, 5, 100, 297, 210, (15, 15, 15, 15))
    count += check_true(not overflow["fits_geometry_only"])
    count += check_close(overflow["drawn_mm"][0], 300)
    count += check_close(overflow["diagnostic_minimum_denominator"], 112.35955056179775)
    count += check_error(paper_mm, 1, 0)
    count += check_error(paper_mm, -1, 100)
    count += check_error(ideal_pixels, 100, -300)
    count += check_error(paper_mm, None, 100)
    count += check_error(paper_mm, math.nan, 100)
    count += check_error(pdf_points, math.inf)
    count += check_error(paper_mm, 1e308, 1)
    count += check_error(sheet_fit, 10, 5, 100, 100, 100, (50, 50, 0, 0))
    count += check_error(sheet_fit, 10, 5, 100, 100, 100, (-1, 0, 0, 0))
    count += check_error(pdf_point, 0, 211, 210)
    count += check_error(paper_mm, True, 100)
    return count


def examples():
    scale = 100
    fit = sheet_fit(10, 5, scale, 297, 210, (15, 15, 15, 15))
    width, height = fit["drawn_mm"]
    bar = paper_mm(1, scale)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">'
        '<title>Synthetic fixed 1:100 sheet, paper millimetres</title>'
        '<rect width="297" height="210" fill="white"/>'
        '<rect x="15" y="15" width="267" height="180" fill="none" stroke="#999" stroke-width="0.2"/>'
        f'<rect x="20" y="40" width="{width}" height="{height}" fill="#e3eef8" stroke="#222" stroke-width="0.4"/>'
        f'<text x="20" y="34" font-size="4">10 x 5 m; 1:{scale}; {width:.0f} x {height:.0f} paper mm</text>'
        f'<path d="M20 110 h{bar} M20 108 v4 M{20+bar} 108 v4" fill="none" stroke="#222" stroke-width="0.4"/>'
        '<text x="20" y="121" font-size="4">1 m scale bar; print actual size and verify</text>'
        '<text x="20" y="180" font-size="4">Synthetic unit fixture, not a construction drawing</text></svg>'
    )
    return {
        "scale_denominator": scale, "length_m": 10, "length_paper_mm": paper_mm(10, scale),
        "length_pdf_pt": pdf_points(width), "length_ideal_px_at_300dpi": ideal_pixels(width, 300),
        "page_pdf_pt": [pdf_points(297), pdf_points(210)],
        "point_20_40_pdf_pt": pdf_point(20, 40, 210), "fit": fit,
        "overflow_30m": sheet_fit(30, 5, scale, 297, 210, (15, 15, 15, 15)), "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-drawing-exports", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Only unit conversion and necessary geometric fit; labels, fonts and full pagination are not assessed.",
            "Ideal pixel counts are not an encoded PNG or guaranteed print-DPI metadata.",
            "No PDF file, CAD/BIM semantics, download verification or professional drawing approval.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
