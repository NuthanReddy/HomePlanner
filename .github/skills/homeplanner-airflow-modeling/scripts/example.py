"""Signed airflow and bounded scalar references; --check runs offline checks."""

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


def fraction(value):
    value = nonnegative(value)
    if value > 1:
        raise ValueError("Supply a fraction, not percent.")
    return value


def orifice_flow(cd, area_m2, from_pa, to_pa, imposed_pa, density_kg_m3):
    cd, area, density = positive(cd), nonnegative(area_m2), positive(density_kg_m3)
    if cd > 1:
        raise ValueError("Supported discharge coefficient is at most one.")
    delta = finite(finite(from_pa) - finite(to_pa) + finite(imposed_pa))
    coefficient = finite(cd * area * math.sqrt(finite(2 / density)))
    if area > 0 and coefficient == 0:
        raise ValueError("Positive flow coefficient underflows.")
    return finite(coefficient * math.copysign(math.sqrt(abs(delta)), delta))


def mass_residual(outward_flows_m3s, density_kg_m3):
    return finite(positive(density_kg_m3) * finite(sum(map(finite, outward_flows_m3s))))


def outside_ach(outside_inflow_m3s, volume_m3):
    return finite(3600 * nonnegative(outside_inflow_m3s) / positive(volume_m3))


def channel_velocity(flow_m3s, volume_m3, usable_area_m2, width_m):
    depth = positive(positive(volume_m3) / positive(usable_area_m2))
    return finite(finite(flow_m3s) / positive(depth * positive(width_m)))


def scalar_step(initial, inlet, source_per_s, delivered_m3s, volume_m3, seconds):
    initial, inlet, source = map(nonnegative, (initial, inlet, source_per_s))
    flow, volume, seconds = nonnegative(delivered_m3s), positive(volume_m3), nonnegative(seconds)
    if flow == 0:
        return finite(initial + finite(source * seconds / volume))
    rate_time = finite(flow * seconds / volume)
    exchanged = -math.expm1(-rate_time)
    return finite(initial + (inlet - initial) * exchanged + finite(source / flow) * exchanged)


def isothermal_rh(initial_rh, inlet_rh, delivered_m3s, volume_m3, seconds, room_c, inlet_c):
    initial, inlet = fraction(initial_rh), fraction(inlet_rh)
    room, makeup = finite(room_c), finite(inlet_c)
    if min(room, makeup) <= -273.15 or not math.isclose(room, makeup, rel_tol=0, abs_tol=1e-9):
        raise ValueError("This RH scalar requires supplied equal, physical temperatures.")
    return scalar_step(initial, inlet, 0.0, delivered_m3s, volume_m3, seconds)


def decay_target_seconds(initial_rh, inlet_rh, target_rh, delivered_m3s, volume_m3):
    initial, inlet, target = map(fraction, (initial_rh, inlet_rh, target_rh))
    flow, volume = nonnegative(delivered_m3s), positive(volume_m3)
    if initial <= target:
        return 0.0
    if flow == 0 or target <= inlet:
        return None
    return finite((volume / flow) * math.log((initial - inlet) / (target - inlet)))


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
    count = check_close(orifice_flow(0.5, 0.2, 0.6, 0, 0, 1.2), 0.1)
    count += check_close(orifice_flow(0.5, 0.2, 0, 0.6, 0, 1.2), -0.1)
    count += check_close(orifice_flow(0.5, 0.2, 0, 0, 0.6, 1.2), 0.1)
    count += check_close(orifice_flow(0.5, 0.2, 0, 0, 0, 1.2), 0)
    count += check_close(orifice_flow(0.5, 0, 0.6, 0, 0, 1.2), 0)
    count += check_close(mass_residual([-0.1, 0.1], 1.2), 0)
    count += check_close(mass_residual([-0.1, 0.08], 1.2), -0.024)
    count += check_close(outside_ach(0.1, 30), 12)
    count += check_close(outside_ach(0, 30), 0)
    count += check_close(channel_velocity(0.1, 30, 15, 2), 0.025)
    count += check_close(channel_velocity(-0.1, 30, 15, 2), -0.025)
    count += check_close(isothermal_rh(0.9, 0.4, 0.05, 30, 600, 25, 25), 0.5839397205857212)
    count += check_close(isothermal_rh(0.9, 0.4, 0, 30, 600, 25, 25), 0.9)
    count += check_close(isothermal_rh(0.9, 0.4, 0.05, 30, 0, 25, 25), 0.9)
    count += check_close(scalar_step(0.4, 0.4, 0, 0.05, 30, 600), 0.4)
    count += check_close(scalar_step(0, 0, 0.01, 0, 30, 600), 0.2)
    count += check_close(scalar_step(1, 0, 0.05, 0.05, 30, 600), 1)
    count += check_close(decay_target_seconds(0.9, 0.4, 0.5, 0.05, 30), 965.6627474604602)
    count += check_close(decay_target_seconds(0.4, 0.4, 0.5, 0, 30), 0)
    count += check_true(decay_target_seconds(0.9, 0.4, 0.4, 0.05, 30) is None)
    count += check_true(decay_target_seconds(0.9, 0.4, 0.5, 0, 30) is None)
    count += check_error(orifice_flow, 1.1, 0.2, 1, 0, 0, 1.2)
    count += check_error(orifice_flow, 0.5, -0.2, 1, 0, 0, 1.2)
    count += check_error(orifice_flow, 0.5, 0.2, None, 0, 0, 1.2)
    count += check_error(orifice_flow, 0.5, 0.2, 1, 0, 0, 0)
    count += check_error(outside_ach, 0.1, 0)
    count += check_error(channel_velocity, 0.1, 30, 0, 2)
    count += check_error(isothermal_rh, 0.9, 0.4, 0.05, 30, 600, 25, 24)
    count += check_error(isothermal_rh, 90, 40, 0.05, 30, 600, 25, 25)
    count += check_error(scalar_step, 1, 0, 0, -1, 30, 60)
    count += check_error(scalar_step, 1, 0, 0, 1, 30, -60)
    count += check_error(outside_ach, math.inf, 30)
    count += check_error(outside_ach, 1e308, 1)
    count += check_error(finite, True)
    return count


def examples():
    samples = [{"elapsed_s": t, "rh_fraction": isothermal_rh(0.9, 0.4, 0.05, 30, t, 25, 25)}
               for t in range(0, 1201, 100)]
    points = " ".join(f'{45+row["elapsed_s"]*0.3:.4f},{205-(row["rh_fraction"]-0.4)*260:.4f}'
                      for row in samples)
    at_600 = isothermal_rh(0.9, 0.4, 0.05, 30, 600, 25, 25)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 490 295">'
        '<title>Synthetic isothermal RH scalar dilution, not wet-surface drying</title>'
        '<rect width="490" height="295" fill="white"/>'
        '<text x="15" y="25" font-size="14">Delivered 0.05 m3/s, 30 m3, both streams 25 C</text>'
        '<path d="M45 55 V205 H420" stroke="#222" fill="none"/>'
        '<path d="M45 205 H420" stroke="#888" stroke-dasharray="4 4"/>'
        f'<polyline points="{points}" stroke="#2868aa" fill="none" stroke-width="2"/>'
        '<text x="10" y="76" font-size="12">90%</text><text x="10" y="206" font-size="12">40%</text>'
        '<text x="45" y="225" font-size="12">0 s</text><text x="375" y="225" font-size="12">1200 s</text>'
        f'<text x="15" y="252" font-size="14">At 600 s: {at_600*100:.4f}% RH scalar</text>'
        '<text x="15" y="280" font-size="12">No continuing moisture source, surface drying or CFD</text></svg>'
    )
    return {
        "orifice_flow_m3s": orifice_flow(0.5, 0.2, 0.6, 0, 0, 1.2),
        "nodal_mass_residual_kg_s": mass_residual([-0.1, 0.1], 1.2),
        "direct_outdoor_ach_h_inverse": outside_ach(0.1, 30),
        "channel_velocity_m_s": channel_velocity(0.1, 30, 15, 2),
        "separate_delivered_dilution": {"flow_m3s": 0.05, "volume_m3": 30, "rh_at_600s": at_600,
                                       "target_0_5_seconds": decay_target_seconds(0.9, 0.4, 0.5, 0.05, 30),
                                       "target_at_inlet_seconds": decay_target_seconds(0.9, 0.4, 0.4, 0.05, 30),
                                       "samples": samples},
        "svg": svg,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps({
        "skill": "homeplanner-airflow-modeling", "checks": run_checks() if args.check else 0,
        "examples": examples(),
        "limitations": [
            "Orifice and uniform-channel references do not solve an arbitrary network or validate CFD.",
            "Direct outdoor ACH and depth-averaged velocity do not establish mixing or occupant exposure.",
            "RH scalar decay requires supplied equal temperatures and no continuing source; not wet-surface drying.",
            "The app does not gain a contaminant/moisture engine from this standalone reference.",
        ],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
