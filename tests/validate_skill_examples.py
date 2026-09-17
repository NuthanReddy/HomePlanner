"""Offline execution and JSON/SVG contract checks for the specialist examples."""

import argparse
import ast
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / ".github" / "skills"
SVG_NAMESPACE = "{http://www.w3.org/2000/svg}"
FORBIDDEN_IMPORTS = {"subprocess", "socket", "urllib", "http", "webbrowser", "importlib"}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def reject_constant(value):
    raise ValueError(f"Nonfinite JSON token: {value}")


def finite_tree(value):
    if type(value) is float:
        require(math.isfinite(value), "Nonfinite example value")
    elif type(value) is dict:
        for item in value.values():
            finite_tree(item)
    elif type(value) is list:
        for item in value:
            finite_tree(item)


def inspect_imports(script):
    tree = ast.parse(script.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        modules = []
        if isinstance(node, ast.Import):
            modules = [alias.name.split(".")[0] for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            require(node.level == 0 and node.module is not None, "Examples must not import repository/app modules")
            modules = [node.module.split(".")[0]]
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            require(node.func.id != "__import__", "Dynamic imports are outside the offline example contract")
        for module in modules:
            require(module in sys.stdlib_module_names, f"Optional dependency in example: {module}")
            require(module not in FORBIDDEN_IMPORTS, f"Network/process module in offline example: {module}")


def inspect_reference_snippets(folder):
    count = 0
    for reference in (folder / "references").glob("*.md"):
        text = reference.read_text(encoding="utf-8")
        for index, source in enumerate(re.findall(r"```python[ \t]*\r?\n(.*?)```", text, re.DOTALL), 1):
            ast.parse(source, filename=f"{reference}:{index}")
            count += 1
    return count


def validate_svg(text):
    require(type(text) is str and bool(text.strip()), "examples.svg must be a nonempty SVG string")
    root = ET.fromstring(text)
    require(root.tag == SVG_NAMESPACE + "svg", "SVG needs the standard namespace")
    require(any(part.strip() for part in root.itertext()), "SVG must contain readable labels")
    if "viewBox" in root.attrib:
        dimensions = [float(value) for value in root.attrib["viewBox"].replace(",", " ").split()]
        require(len(dimensions) == 4 and all(math.isfinite(value) for value in dimensions), "Invalid SVG viewBox")
        require(dimensions[2] > 0 and dimensions[3] > 0, "SVG viewport must be positive")
    for element in root.iter():
        require(element.tag not in (SVG_NAMESPACE + "script", SVG_NAMESPACE + "foreignObject"),
                "Examples must produce self-contained non-script SVG")
        for attribute, value in element.attrib.items():
            if attribute.endswith("href"):
                require(value.startswith("#"), "SVG may not reference remote or external resources")
    return len(list(root.iter()))


def run_example(name):
    script = SKILLS / name / "scripts" / "example.py"
    require(script.is_file(), f"Missing example: {script}")
    inspect_imports(script)
    snippets = inspect_reference_snippets(SKILLS / name)
    outputs = []
    with tempfile.TemporaryDirectory(prefix="homeplanner-skill-example-") as folder:
        for arguments in ([], ["--check"]):
            result = subprocess.run(
                [sys.executable, "-I", "-B", str(script), *arguments],
                cwd=folder, capture_output=True, text=True, encoding="utf-8", timeout=30, check=False,
            )
            require(result.returncode == 0, f"{name} {arguments} failed:\n{result.stdout}\n{result.stderr}")
            require(not result.stderr.strip(), f"{name} produced unexpected stderr: {result.stderr}")
            payload = json.loads(result.stdout, parse_constant=reject_constant)
            require(type(payload) is dict and payload.get("skill") == name, f"{name}: incorrect output identity")
            require(type(payload.get("examples")) is dict and bool(payload["examples"]), f"{name}: missing examples")
            require(type(payload.get("checks")) is int and payload["checks"] >= 0, f"{name}: invalid check count")
            if arguments:
                require(payload["checks"] >= 3, f"{name}: at least three explicit checks are required")
            require(type(payload.get("limitations")) is list and bool(payload["limitations"]),
                    f"{name}: limitations must be explicit")
            require(all(type(item) is str and item.strip() for item in payload["limitations"]),
                    f"{name}: invalid limitations")
            finite_tree(payload)
            outputs.append(payload)
        require(not any(Path(folder).iterdir()), f"{name}: default/--check wrote unexpected files")
    require(outputs[0]["examples"] == outputs[1]["examples"], f"{name}: calculations are not deterministic")
    svg_elements = validate_svg(outputs[1]["examples"]["svg"]) if "svg" in outputs[1]["examples"] else 0
    return {"skill": name, "checks": outputs[1]["checks"], "svg_elements": svg_elements,
            "python_snippets_parsed": snippets}


def main():
    if sys.version_info < (3, 10):
        raise SystemExit("The shared skill validator requires Python 3.10 or newer.")
    names = sorted(folder.name for folder in SKILLS.iterdir() if folder.is_dir() and (folder / "SKILL.md").is_file())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill", choices=names, action="append", help="Validate only a named skill; repeat as needed")
    args = parser.parse_args()
    results = [run_example(name) for name in (args.skill or names)]
    print(json.dumps({
        "skills": len(results), "checks": sum(item["checks"] for item in results),
        "svg_renders": sum(item["svg_elements"] > 0 for item in results), "results": results,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
