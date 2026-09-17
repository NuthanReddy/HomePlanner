"""Explicit assembly/RC/property identities; --check runs offline references."""

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


def temperature(value):
    value = finite(value)
    if value <= -273.15:
        raise ValueError("Supply a physical temperature above absolute zero.")
    return value


def fraction(value):
    value = nonnegative(value)
    if value > 1:
        raise ValueError("Supply RH as a fraction, not percent.")
    return value


def assembly_properties(layers, inside_film_m2k_w, outside_film_m2k_w):
    if not layers:
        raise ValueError("At least one explicit material layer is required.")
    resistance = finite(nonnegative(inside_film_m2k_w) + nonnegative(outside_film_m2k_w))
    areal_capacity = 0.0
    for layer in layers:
        if not isinstance(layer, (tuple, list)) or len(layer) != 4:
            raise ValueError("Supply each layer's thickness, conductivity, density and specific heat.")
        thickness, conductivity, density, specific_heat = map(positive, layer)
        resistance = positive(resistance + positive(thickness / conductivity))
        areal_capacity = positive(areal_capacity + positive(density * specific_heat * thickness))
    return {"R_m2K_W": resistance, "U_W_m2K": positive(1/resistance), "capacity_J_m2K": areal_capacity}


def conductive_gain(u_w_m2k, area_m2, outside_c, inside_c):
    return finite(nonnegative(u_w_m2k) * nonnegative(area_m2) * (temperature(outside_c)-temperature(inside_c)))


def rc_inputs(initial_c, outside_c, gains_w, capacity_j_k, conductance_w_k, seconds):
    return (temperature(initial_c), temperature(outside_c), finite(gains_w),
            positive(capacity_j_k), nonnegative(conductance_w_k), nonnegative(seconds))


def resolved_temperature(initial, increment):
    increment = finite(increment)
    result = temperature(initial + increment)
    if increment != 0 and result == initial:
        raise ValueError("The computed increment is below temperature resolution.")
    return result


def rc_exact(initial_c, outside_c, gains_w, capacity_j_k, conductance_w_k, seconds):
    initial, outside, gains, capacity, conductance, dt = rc_inputs(
        initial_c, outside_c, gains_w, capacity_j_k, conductance_w_k, seconds)
    forcing = finite(conductance * (outside-initial) + gains)
    rate_time = nonnegative(conductance * dt / capacity)
    response = 1.0 if rate_time == 0 else -math.expm1(-rate_time)/rate_time
    return resolved_temperature(initial, finite(forcing * (dt/capacity) * response))


def rc_backward_euler(initial_c, outside_c, gains_w, capacity_j_k, conductance_w_k, seconds):
    initial, outside, gains, capacity, conductance, dt = rc_inputs(
        initial_c, outside_c, gains_w, capacity_j_k, conductance_w_k, seconds)
    forcing = finite(conductance * (outside-initial) + gains)
    denominator = positive(capacity + finite(conductance*dt))
    result = resolved_temperature(initial, finite(forcing * dt / denominator))
    stored = finite(capacity*(result-initial))
    outdoor = finite(dt*conductance*(outside-result))
    supplied = finite(dt*gains)
    return {"temperature_C": result, "stored_J": stored, "outdoor_J": outdoor,
            "gains_J": supplied, "residual_J": finite(stored-outdoor-supplied)}


def interzone_energy(conductance_w_k, temperature_a_c, temperature_b_c, seconds):
    conductance, dt = nonnegative(conductance_w_k), nonnegative(seconds)
    a, b = temperature(temperature_a_c), temperature(temperature_b_c)
    into_a = finite(conductance*(b-a)*dt)
    return {"into_a_J": into_a, "into_b_J": -into_a}


def humidity_ratio(vapor_pa, total_pa, molecular_mass_ratio):
    vapor, total, ratio = nonnegative(vapor_pa), positive(total_pa), positive(molecular_mass_ratio)
    if vapor >= total:
        raise ValueError("Water partial pressure must be below total pressure.")
    return nonnegative(ratio*vapor/(total-vapor))


def supplied_surface_screen(air_c, rh_fraction, air_saturation_pa, total_pa, molecular_mass_ratio,
                            surface_c, surface_saturation_pa):
    air, rh = temperature(air_c), fraction(rh_fraction)
    air_saturation, pressure = positive(air_saturation_pa), positive(total_pa)
    vapor = nonnegative(rh*air_saturation)
    humidity = humidity_ratio(vapor, pressure, molecular_mass_ratio)
    surface = None if surface_c is None else temperature(surface_c)
    surface_saturation = None if surface_saturation_pa is None else positive(surface_saturation_pa)
    saturation_ratio = None if surface is None or surface_saturation is None else nonnegative(vapor/surface_saturation)
    return {"air_C": air, "vapor_pressure_Pa": vapor, "humidity_ratio_kg_kg_dry_air": humidity,
            "supplied_surface_C": surface, "surface_saturation_ratio": saturation_ratio,
            "condensation_potential": None if saturation_ratio is None else saturation_ratio > 1}


def check_close(actual, expected, abs_tol=1e-9):
    if not math.isclose(finite(actual), expected, rel_tol=1e-10, abs_tol=abs_tol):
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


def synthetic_layers():
    return [(0.1, 0.5, 800, 1000), (0.05, 0.04, 30, 1400)]


def run_checks():
    assembly = assembly_properties(synthetic_layers(), 0.13, 0.04)
    count = check_close(assembly["R_m2K_W"], 1.62)
    count += check_close(assembly["U_W_m2K"], 0.6172839506172839)
    count += check_close(assembly["capacity_J_m2K"], 82100)
    count += check_close(assembly["R_m2K_W"] * assembly["U_W_m2K"], 1)
    count += check_close(conductive_gain(assembly["U_W_m2K"], 10, 35, 25), 61.72839506172839)
    exact = rc_exact(20, 10, 0, 360000, 100, 3600)
    coarse = rc_backward_euler(20, 10, 0, 360000, 100, 3600)
    count += check_close(exact, 13.678794411714424)
    count += check_close(coarse["temperature_C"], 15)
    count += check_close(coarse["stored_J"], -1_800_000)
    count += check_close(coarse["outdoor_J"], -1_800_000)
    count += check_close(coarse["residual_J"], 0)
    refined = 20.0
    for _ in range(10):
        step = rc_backward_euler(refined, 10, 0, 360000, 100, 360)
        refined = step["temperature_C"]
        count += check_close(step["residual_J"], 0, abs_tol=1e-7)
    count += check_close(refined, 13.855432894295314)
    count += check_true(abs(refined-exact) < abs(coarse["temperature_C"]-exact))
    count += check_close(rc_exact(20, 10, 500, 100000, 0, 600), 23)
    count += check_close(rc_backward_euler(20, 10, 500, 100000, 0, 600)["stored_J"], 300000)
    count += check_close(rc_backward_euler(20, 10, -500, 100000, 0, 600)["temperature_C"], 17)
    count += check_close(rc_exact(20, 10, 1000, 360000, 100, 3600), 20)
    count += check_close(rc_exact(20, 10, 0, 360000, 100, 0), 20)
    count += check_close(rc_backward_euler(20, 10, 0, 360000, 0, 3600)["temperature_C"], 20)
    exchange = interzone_energy(10, 30, 20, 60)
    count += check_close(exchange["into_a_J"], -6000)
    count += check_close(exchange["into_a_J"]+exchange["into_b_J"], 0)
    state = supplied_surface_screen(25, 0.6, 3169, 101325, 0.621945, 15, 1705)
    count += check_close(state["vapor_pressure_Pa"], 1901.4)
    count += check_close(state["humidity_ratio_kg_kg_dry_air"], 0.011894220517060336)
    count += check_close(state["surface_saturation_ratio"], 1.1151906158357772)
    count += check_true(state["condensation_potential"])
    count += check_true(supplied_surface_screen(25, 0.6, 3169, 101325, 0.621945, None, 1705)["condensation_potential"] is None)
    count += check_true(not supplied_surface_screen(25, 1, 3169, 101325, 0.621945, 25, 3169)["condensation_potential"])
    count += check_close(humidity_ratio(0, 101325, 0.621945), 0)
    count += check_error(assembly_properties, [], 0.13, 0.04)
    count += check_error(assembly_properties, [(0.1, 0, 800, 1000)], 0.13, 0.04)
    count += check_error(assembly_properties, synthetic_layers(), None, 0.04)
    count += check_error(rc_exact, 20, 10, 0, 0, 100, 3600)
    count += check_error(rc_backward_euler, 20, 10, None, 360000, 100, 3600)
    count += check_error(rc_backward_euler, 20, 10, 0, 360000, -1, 3600)
    count += check_error(rc_backward_euler, 20, 20, 1e-12, 1e20, 0, 1)
    count += check_error(humidity_ratio, 101325, 101325, 0.621945)
    count += check_error(supplied_surface_screen, 25, 60, 3169, 101325, 0.621945, 15, 1705)
    count += check_error(supplied_surface_screen, 25, 0.6, 3169, 101325, 0.621945, 15, 0)
    count += check_error(rc_exact, math.nan, 10, 0, 360000, 100, 3600)
    count += check_error(rc_backward_euler, 20, 10, 1e308, 1, 0, 3600)
    count += check_error(temperature, -273.15)
    count += check_error(finite, True)
    return count


def examples():
    assembly = assembly_properties(synthetic_layers(), 0.13, 0.04)
    coarse = rc_backward_euler(20, 10, 0, 360000, 100, 3600)
    samples = [{"elapsed_s": 0, "exact_C": 20.0, "implicit_C": 20.0}]
    implicit = 20.0
    for seconds in range(360, 3601, 360):
        implicit = rc_backward_euler(implicit, 10, 0, 360000, 100, 360)["temperature_C"]
        samples.append({"elapsed_s": seconds, "exact_C": rc_exact(20, 10, 0, 360000, 100, seconds),
                        "implicit_C": implicit})
    exact_points = " ".join(f'{50+row["elapsed_s"]/10:.4f},{65+(20-row["exact_C"])*18:.4f}' for row in samples)
    implicit_points = " ".join(f'{50+row["elapsed_s"]/10:.4f},{65+(20-row["implicit_C"])*18:.4f}' for row in samples)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 615 315">'
        '<title>Synthetic sensible single-zone RC decay, exact versus backward Euler</title>'
        '<rect width="615" height="315" fill="white"/>'
        '<text x="15" y="25" font-size="14">C=360000 J/K; H=100 W/K; outside 10 C; zero gains</text>'
        '<path d="M50 55 V205 H430" stroke="#222" fill="none"/>'
        f'<polyline points="{exact_points}" fill="none" stroke="#286499" stroke-width="2"/>'
        f'<polyline points="{implicit_points}" fill="none" stroke="#bf6b27" stroke-width="2"/>'
        '<text x="12" y="66" font-size="12">20 C</text><text x="12" y="198" font-size="12">13 C</text>'
        '<text x="48" y="225" font-size="12">0 s</text><text x="380" y="225" font-size="12">3600 s</text>'
        f'<text x="450" y="105" font-size="12" fill="#286499">Exact {samples[-1]["exact_C"]:.6f} C</text>'
        f'<text x="450" y="129" font-size="12" fill="#bf6b27">10 steps {implicit:.6f} C</text>'
        f'<text x="15" y="258" font-size="13">One implicit step: {coarse["temperature_C"]:.2f} C; energy residual {coarse["residual_J"]:.1f} J</text>'
        '<text x="15" y="290" font-size="12">Hypothetical sensible state, not actual room temperature or moisture</text></svg>'
    )
    return {
        "assembly": assembly, "coarse_implicit_step": coarse, "exact_and_refined_samples": samples,
        "supplied_psat_surface_screen": supplied_surface_screen(25, 0.6, 3169, 101325, 0.621945, 15, 1705),
        "missing_surface_temperature": supplied_surface_screen(25, 0.6, 3169, 101325, 0.621945, None, 1705),
        "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-thermal-modeling", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Series descriptors and a supplied sensible RC experiment are not calibrated indoor-temperature/HVAC predictions.",
            "Psychrometric identities require consistent supplied property/temperature pairs; no saturation curve or surface temperature is inferred.",
            "Condensation potential is not drying, moisture transport, mold growth, clinical advice or code compliance.",
            "Optional libraries/engines and coupled building models are not installed or executed by this reference.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
