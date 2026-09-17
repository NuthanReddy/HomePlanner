"""Simply supported linear-elastic beam reference; --check tests mechanics."""

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


def stiffness(young_pa, inertia_m4):
    return positive(positive(young_pa) * positive(inertia_m4))


def load_reactions(span_m, point_loads):
    span = positive(span_m)
    total, moment = 0.0, 0.0
    for force_n, position_m in point_loads:
        force, position = finite(force_n), finite(position_m)
        if not 0 <= position <= span:
            raise ValueError("Point load must be within the supported span.")
        total = finite(total + force)
        moment = finite(moment + finite(force * position))
    right = finite(moment / span)
    return {"left_N": finite(total - right), "right_N": right}


def uniform_beam_at(span_m, load_n_m, young_pa, inertia_m4, x_m):
    span, load, x = positive(span_m), finite(load_n_m), finite(x_m)
    ei = stiffness(young_pa, inertia_m4)
    if not 0 <= x <= span:
        raise ValueError("The station must lie within the supported span.")
    reaction = finite(load * span / 2)
    shear = finite(load * (span / 2 - x))
    moment = finite(load * x * (span - x) / 2)
    polynomial = finite(span*span*span - 2*span*x*x + x*x*x)
    deflection = finite(load * x * polynomial / finite(24 * ei))
    return {"reaction_left_N": reaction, "reaction_right_N": reaction,
            "shear_N": shear, "moment_Nm": moment, "deflection_down_m": deflection}


def central_point_deflection(span_m, point_load_n, young_pa, inertia_m4):
    span, load = positive(span_m), finite(point_load_n)
    ei = stiffness(young_pa, inertia_m4)
    return finite(load * span * span * span / finite(48 * ei))


def bending_stress(moment_nm, fibre_y_m, inertia_m4):
    return finite(-finite(moment_nm) * finite(fibre_y_m) / positive(inertia_m4))


def check_close(actual, expected):
    if not math.isclose(finite(actual), expected, rel_tol=1e-10, abs_tol=1e-10):
        raise AssertionError((actual, expected))
    return 1


def check_error(function, *args):
    try:
        function(*args)
    except ValueError:
        return 1
    raise AssertionError("Invalid input was accepted.")


def run_checks():
    span, load, young, inertia = 4, 1000, 200e9, 8e-6
    mid = uniform_beam_at(span, load, young, inertia, 2)
    count = check_close(stiffness(young, inertia), 1_600_000)
    count += check_close(mid["reaction_left_N"], 2000)
    count += check_close(mid["reaction_right_N"], 2000)
    count += check_close(mid["shear_N"], 0)
    count += check_close(mid["moment_Nm"], 2000)
    count += check_close(mid["deflection_down_m"], 0.0020833333333333333)
    count += check_close(mid["reaction_left_N"] + mid["reaction_right_N"] - load*span, 0)
    count += check_close(mid["reaction_right_N"]*span - load*span*span/2, 0)
    for x in (0, span):
        end = uniform_beam_at(span, load, young, inertia, x)
        count += check_close(end["deflection_down_m"], 0)
        count += check_close(end["moment_Nm"], 0)
    left = uniform_beam_at(span, load, young, inertia, 1)
    right = uniform_beam_at(span, load, young, inertia, 3)
    count += check_close(left["deflection_down_m"], right["deflection_down_m"])
    count += check_close(uniform_beam_at(span, -load, young, inertia, 2)["deflection_down_m"], -mid["deflection_down_m"])
    count += check_close(uniform_beam_at(span, 2*load, young, inertia, 2)["deflection_down_m"], 2*mid["deflection_down_m"])
    count += check_close(uniform_beam_at(span, load, young, 2*inertia, 2)["deflection_down_m"], mid["deflection_down_m"]/2)
    count += check_close(uniform_beam_at(span, 0, young, inertia, 2)["deflection_down_m"], 0)
    derivative = (uniform_beam_at(span, load, young, inertia, 1.1)["moment_Nm"]
                  - uniform_beam_at(span, load, young, inertia, 0.9)["moment_Nm"]) / 0.2
    count += check_close(derivative, left["shear_N"])
    count += check_close(central_point_deflection(span, 2000, young, inertia), 0.0016666666666666668)
    count += check_close(bending_stress(2000, 0.1, inertia), -25e6)
    reactions = load_reactions(4, [(1000, 1), (2000, 3)])
    count += check_close(reactions["left_N"], 1250)
    count += check_close(reactions["right_N"], 1750)
    count += check_close(load_reactions(4, [])["left_N"], 0)
    count += check_error(uniform_beam_at, 0, load, young, inertia, 0)
    count += check_error(uniform_beam_at, span, load, 0, inertia, 2)
    count += check_error(uniform_beam_at, span, load, young, None, 2)
    count += check_error(uniform_beam_at, span, load, young, inertia, 5)
    count += check_error(load_reactions, 4, [(100, -1)])
    count += check_error(stiffness, math.inf, inertia)
    count += check_error(stiffness, 1e308, 1e308)
    count += check_error(stiffness, 1e-300, 1e-300)
    count += check_error(finite, True)
    return count


def examples():
    span, load, young, inertia = 4.0, 1000.0, 200e9, 8e-6
    mid = uniform_beam_at(span, load, young, inertia, span/2)
    samples = [{"x_m": span*index/20,
                "deflection_down_m": uniform_beam_at(span, load, young, inertia, span*index/20)["deflection_down_m"]}
               for index in range(21)]
    points = " ".join(f'{50+row["x_m"]*100:.4f},{75+row["deflection_down_m"]*40000:.4f}' for row in samples)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 590 280">'
        '<title>Synthetic simply supported beam deflection, magnified ordinate</title>'
        '<rect width="590" height="280" fill="white"/>'
        '<text x="15" y="25" font-size="14">L=4 m; q=1000 N/m; supplied E=200 GPa, I=8e-6 m4</text>'
        '<path d="M50 75 H450 M50 65 V195" stroke="#222" fill="none"/>'
        f'<polyline points="{points}" fill="none" stroke="#286499" stroke-width="2"/>'
        '<text x="35" y="215" font-size="12">0 m</text><text x="430" y="215" font-size="12">4 m</text>'
        f'<text x="100" y="185" font-size="13">Midspan {mid["deflection_down_m"]*1000:.6f} mm downward</text>'
        '<text x="15" y="240" font-size="12">Vertical graph scale: 40 px/mm; not actual-size deformation</text>'
        '<text x="15" y="266" font-size="12">Linear analytical fixture only; engineered safety not assessed</text></svg>'
    )
    return {
        "supplied": {"span_m": span, "load_N_m": load, "young_Pa": young, "inertia_m4": inertia},
        "midspan": mid,
        "force_equilibrium_residual_N": mid["reaction_left_N"]+mid["reaction_right_N"]-load*span,
        "moment_equilibrium_residual_Nm": mid["reaction_right_N"]*span-load*span*span/2,
        "separate_centre_point_2000N_deflection_m": central_point_deflection(span, 2000, young, inertia),
        "supplied_top_fibre_0_1m_stress_Pa": bending_stress(mid["moment_Nm"], 0.1, inertia),
        "samples": samples, "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-structural-engineering", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Supplied stable simply supported, prismatic, small-deflection linear-elastic bending only.",
            "No shear deformation, cracking, buckling, load combinations, connection/foundation or code-design checks.",
            "Synthetic E/I/loads are not safe member recommendations; HomePlanner engineering remains not-assessed.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
