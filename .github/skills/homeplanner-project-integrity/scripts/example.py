"""Synthetic integrity arithmetic and state diagrams, not an application codec."""

import argparse
import copy
from graphlib import CycleError, TopologicalSorter
import hashlib
import json
import math
import xml.etree.ElementTree as ET


SKILL = "homeplanner-project-integrity"
MAX_SAFE_INTEGER = 2 ** 53 - 1


def finite_close(left, right, *, absolute, relative):
    for name, value in (("left", left), ("right", right), ("absolute", absolute), ("relative", relative)):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite number")
    if absolute < 0 or relative < 0 or relative >= 1:
        raise ValueError("tolerances require absolute >= 0 and 0 <= relative < 1")
    return math.isclose(left, right, abs_tol=absolute, rel_tol=relative)


def revision_after(current, expected, changed):
    for value in (current, expected):
        if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
            raise ValueError("revision must be a nonnegative safe integer")
    if type(changed) is not bool:
        raise ValueError("changed must be an explicit boolean")
    if current != expected:
        raise ValueError("stale expected revision")
    if changed and current == MAX_SAFE_INTEGER:
        raise ValueError("revision cannot exceed the portable safe-integer range")
    return current + int(changed)


def validate_plain_json(value, ancestors=None):
    ancestors = set() if ancestors is None else ancestors
    if value is None or type(value) in (str, bool):
        return
    if type(value) is int:
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError("large integers require an explicit string/schema contract")
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("nonfinite JSON number")
        return
    if type(value) not in (dict, list):
        raise ValueError("reference accepts only plain JSON objects, arrays and primitives")
    if id(value) in ancestors:
        raise ValueError("cyclic input is not JSON")
    ancestors.add(id(value))
    try:
        if type(value) is dict:
            if any(type(key) is not str for key in value):
                raise ValueError("JSON object keys must be strings")
            for key, item in value.items():
                if key in ("__proto__", "constructor", "prototype"):
                    raise ValueError("reserved cross-runtime object key")
                validate_plain_json(item, ancestors)
        else:
            for item in value:
                validate_plain_json(item, ancestors)
    finally:
        ancestors.remove(id(value))


def reference_bytes(value):
    validate_plain_json(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def reference_digest(value):
    return hashlib.sha256(reference_bytes(value)).hexdigest()


def parse_reference(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError(f"nonfinite JSON token: {value}")

    if type(text) is not str:
        raise ValueError("JSON input must be text")
    result = json.loads(text, object_pairs_hook=pairs, parse_constant=reject_constant)
    validate_plain_json(result)
    return result


def current_result(request, current, valid, cancelled):
    fields = ("project", "floor", "method", "input_fingerprint", "job")
    for key in (request, current):
        if type(key) is not dict or any(type(key.get(field)) is not str or not key[field] for field in fields):
            raise ValueError("result key needs all stable owner, method, input and job identities")
    if type(valid) is not bool or type(cancelled) is not bool:
        raise ValueError("result status must be explicit")
    return valid and not cancelled and all(request[field] == current[field] for field in fields)


def allocate_identity(prefix, active_ids, next_suffix):
    if type(prefix) is not str or not prefix:
        raise ValueError("identity prefix must be supplied")
    if type(active_ids) is not list or any(type(item) is not str or not item for item in active_ids):
        raise ValueError("active identities must be nonempty strings")
    if len(active_ids) != len(set(active_ids)):
        raise ValueError("active identities must be unique")
    if type(next_suffix) is not int or not 1 <= next_suffix < MAX_SAFE_INTEGER:
        raise ValueError("stored next suffix must be a positive safe integer with room to increment")
    new_id = f"{prefix}-{next_suffix}"
    if new_id in active_ids:
        raise ValueError("stored counter collides with an active identity")
    return [*active_ids, new_id], next_suffix + 1


def critical_path_ms(predecessors, costs):
    order = tuple(TopologicalSorter(predecessors).static_order())
    if set(order) != set(costs):
        raise ValueError("every task needs an explicit cost and unknown tasks are not added")
    finish = {}
    for node in order:
        cost = costs[node]
        if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
            raise ValueError("synthetic task cost must be finite and nonnegative")
        finish[node] = cost + max((finish[parent] for parent in predecessors.get(node, ())), default=0)
        if not math.isfinite(finish[node]):
            raise ValueError("critical-path arithmetic exceeded finite numeric range")
    return {"order": list(order), "earliest_finish_ms": finish,
            "lower_bound_ms": max(finish.values(), default=0)}


def render_svg(data):
    root = ET.Element("svg", {
        "xmlns": "http://www.w3.org/2000/svg", "viewBox": "0 0 760 220",
        "role": "img", "aria-labelledby": "integrity-title integrity-description",
    })
    ET.SubElement(root, "title", {"id": "integrity-title"}).text = "Synthetic revision and result ownership"
    ET.SubElement(root, "desc", {"id": "integrity-description"}).text = (
        "One edit increments the revision; changed inputs reject a stale result. No live project is displayed."
    )
    ET.SubElement(root, "rect", {"width": "760", "height": "220", "fill": "white"})
    nodes = (
        (30, f'Before: revision {data["revision_before"]}', "#e8eef5"),
        (285, f'Accepted: revision {data["revision_after"]}', "#dfede4"),
        (540, f'Stale result accepted: {str(data["stale_result_accepted"]).lower()}', "#f5e5e5"),
    )
    for x, label, fill in nodes:
        ET.SubElement(root, "rect", {"x": str(x), "y": "55", "width": "190", "height": "75",
                                    "fill": fill, "stroke": "#526372"})
        ET.SubElement(root, "text", {"x": str(x + 10), "y": "96", "font-family": "sans-serif",
                                    "font-size": "11", "fill": "#203040"}).text = label
    for start in (220, 475):
        ET.SubElement(root, "path", {"d": f"M {start} 92 H {start + 55} m -8 -5 l 8 5 -8 5",
                                    "fill": "none", "stroke": "#526372", "stroke-width": "2"})
    ET.SubElement(root, "text", {"x": "30", "y": "165", "font-family": "sans-serif", "font-size": "12"}).text = (
        f'Example digest changed: {str(data["digest_changed"]).lower()}; '
        f'synthetic critical-path lower bound: {data["dependency"]["lower_bound_ms"]} ms'
    )
    ET.SubElement(root, "text", {"x": "30", "y": "190", "font-family": "sans-serif", "font-size": "12"}).text = (
        "Reference state only; not a save confirmation or measured application runtime."
    )
    return ET.tostring(root, encoding="unicode")


def examples():
    fixture = {"kind": "reference-only", "revision": 7,
               "floors": [{"id": "example-ground", "widthM": 4.0}, {"id": "example-upper", "widthM": 3.0}],
               "metadata": {"unknown": None, "explicit_zero": 0}}
    changed = copy.deepcopy(fixture)
    changed["floors"][0]["widthM"] = 4.5
    changed["revision"] = revision_after(fixture["revision"], fixture["revision"], True)
    before_inputs = {"widthM": fixture["floors"][0]["widthM"]}
    after_inputs = {"widthM": changed["floors"][0]["widthM"]}
    request = {"project": "example-project", "floor": "example-ground", "method": "example/v1",
               "input_fingerprint": reference_digest(before_inputs), "job": "example-job"}
    current = {**request, "input_fingerprint": reference_digest(after_inputs)}
    renamed = copy.deepcopy(fixture)
    renamed["name"] = "Presentation-only example name"
    renamed["revision"] = 8
    rename_key = {**request, "input_fingerprint": reference_digest({"widthM": renamed["floors"][0]["widthM"]})}
    active_ids = ["bed-1", "bed-2", "bed-3"]
    active_ids.remove("bed-2")
    new_ids, next_suffix = allocate_identity("bed", active_ids, 4)
    dependencies = {"snapshot": (), "geometry": ("snapshot",), "boundary": ("snapshot",),
                    "field": ("geometry", "boundary"), "overlay": ("field",)}
    data = {
        "revision_before": 7, "revision_after": revision_after(7, 7, True),
        "no_op_revision": revision_after(8, 8, False),
        "digest_before": reference_digest(fixture), "digest_after": reference_digest(changed),
        "digest_changed": reference_digest(fixture) != reference_digest(changed),
        "stale_result_accepted": current_result(request, current, True, False),
        "current_result_accepted": current_result(current, current, True, False),
        "unchanged_inputs_after_rename_accepted": current_result(request, rename_key, True, False),
        "old_save_matches_current_document": reference_digest(fixture) == reference_digest(changed),
        "stable_ids_after_delete_and_add": new_ids,
        "next_id_suffix": next_suffix,
        "near_zero_close": finite_close(5e-8, 0, absolute=1e-7, relative=1e-9),
        "dependency": critical_path_ms(dependencies, {"snapshot": 2, "geometry": 5, "boundary": 3,
                                                    "field": 11, "overlay": 2}),
        "fixture": fixture,
    }
    data["svg"] = render_svg(data)
    return data


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

    check(finite_close(1, 1 + 5e-8, absolute=1e-7, relative=1e-9), "within declared tolerance")
    check(not finite_close(1, 1 + 2e-7, absolute=1e-7, relative=1e-9), "beyond declared tolerance")
    check(data["near_zero_close"], "absolute tolerance near zero")
    rejects(lambda: finite_close(float("inf"), float("inf"), absolute=0, relative=0))
    rejects(lambda: finite_close(1, 1, absolute=-1, relative=0))
    rejects(lambda: revision_after(8, 7, True))
    rejects(lambda: revision_after(True, 1, True))
    rejects(lambda: revision_after(MAX_SAFE_INTEGER, MAX_SAFE_INTEGER, True))
    check(data["revision_after"] == 8 and data["no_op_revision"] == 8, "one edit and no-op revision")
    fixture = data["fixture"]
    restored = parse_reference(reference_bytes(fixture).decode("utf-8"))
    check(restored == fixture, "ordered JSON round trip")
    check(restored["metadata"]["unknown"] is None and restored["metadata"]["explicit_zero"] == 0,
          "unknown and zero remain distinct")
    reordered = dict(reversed(list(fixture.items())))
    check(reference_digest(reordered) == reference_digest(fixture), "object key order does not affect local digest")
    reversed_floors = {**fixture, "floors": list(reversed(fixture["floors"]))}
    check(reference_digest(reversed_floors) != reference_digest(fixture), "floor order remains meaningful")
    check(data["digest_changed"], "edited numeric input changes local digest")
    check(not data["stale_result_accepted"] and data["current_result_accepted"], "input-key ownership")
    check(data["unchanged_inputs_after_rename_accepted"], "presentation-only edit preserves input validity")
    check(not data["old_save_matches_current_document"], "an old completed save is not the current document")
    check(fixture["floors"][0]["widthM"] == 4.0 and fixture["floors"][1]["widthM"] == 3.0,
          "reference calculation preserves original and inactive floor")
    for text in ('{"x": 1, "x": 2}', '{"x": NaN}', '{"x": 1e999}', '{"prototype": {}}'):
        rejects(lambda value=text: parse_reference(value))
    for invalid in ({"x": float("nan")}, {1: "coerced key"}, {"x": MAX_SAFE_INTEGER + 1}, {"x": {1, 2}}):
        rejects(lambda value=invalid: reference_bytes(value))
    cyclic = []
    cyclic.append(cyclic)
    rejects(lambda: reference_bytes(cyclic))
    try:
        critical_path_ms({"a": ("b",), "b": ("a",)}, {"a": 1, "b": 1})
    except CycleError:
        check(True, "cycle surfaced explicitly")
    else:
        check(False, "cycle was accepted")
    rejects(lambda: critical_path_ms({"a": ()}, {}))
    rejects(lambda: critical_path_ms({"a": ()}, {"a": float("nan")}))
    check(math.isclose(data["dependency"]["lower_bound_ms"], 20, rel_tol=0, abs_tol=1e-12),
          "synthetic critical-path value")
    ids, next_suffix = ["bed-1", "bed-2", "bed-3"], 4
    ids.remove("bed-2")
    ids.append(f"bed-{next_suffix}")
    next_suffix += 1
    check(ids == data["stable_ids_after_delete_and_add"] and next_suffix == data["next_id_suffix"],
          "deleted identity is not reused")
    rejects(lambda: allocate_identity("bed", ["bed-1"], 1))
    rejects(lambda: allocate_identity("bed", ["bed-1", "bed-1"], 2))
    rejects(lambda: allocate_identity("bed", ["bed-1"], True))
    check(ET.fromstring(data["svg"]).tag == "{http://www.w3.org/2000/svg}svg", "valid labelled SVG")
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Run deterministic arithmetic and invariant checks")
    args = parser.parse_args()
    data = examples()
    print(json.dumps({
        "skill": SKILL, "checks": run_checks(data) if args.check else 0, "examples": data,
        "limitations": [
            "This is not HomePlanner's project validator, coordinator, persistence layer or fingerprint algorithm.",
            "Sorted Python JSON plus SHA-256 is not RFC 8785/JCS or guaranteed JavaScript-compatible canonicalization.",
            "Synthetic DAG costs and the SVG are reference examples, not measured runtime or durable-save evidence.",
        ],
    }, allow_nan=False, sort_keys=True))


if __name__ == "__main__":
    main()
