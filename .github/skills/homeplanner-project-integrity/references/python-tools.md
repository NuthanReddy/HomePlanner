# Python tools for integrity reference calculations

These modules support local reference examples and diagnostics. They do not
implement or replace HomePlanner's coordinator, project schema, IndexedDB
store, analysis keys or browser rendering pipeline.

## Module selection

| Module | Concrete use | Boundary / official reference |
| --- | --- | --- |
| `math` (stdlib) | Finite guards and dimension-scoped closeness checks | [math.isclose](https://docs.python.org/3/library/math.html#math.isclose); reject nonfinite geometry before comparison. |
| `json`, `copy` (stdlib) | Explicit plain-JSON fixtures and detached candidates | [JSON](https://docs.python.org/3/library/json.html); use `allow_nan=False`, reject duplicate keys/non-JSON types, retain array order and unknown metadata. Do not use `default=str` to disguise unsupported values. |
| `hashlib` (stdlib) | Hash explicitly selected byte sequences in standalone examples | [SHA-256](https://docs.python.org/3/library/hashlib.html). Same hash algorithm with different canonical bytes is not compatible. |
| `graphlib` (stdlib) | Check a declared dependency DAG and compute a synthetic critical path | [TopologicalSorter](https://docs.python.org/3/library/graphlib.html). It consumes predecessor lists and reports `CycleError`; it is not a runtime task scheduler. |
| `xml.etree.ElementTree` (stdlib) | Labelled local SVG showing actual example state/ownership | [ElementTree](https://docs.python.org/3/library/xml.etree.elementtree.html). No live project or network is needed. |
| `jsonschema` (optional) | Validate a separately supplied, versioned JSON schema | [Draft202012Validator](https://python-jsonschema.readthedocs.io/en/stable/validate/). Schema checks do not replace semantic, descriptor, ownership, size or host validation. |
| `networkx` (optional) | Inspect larger dependency graphs, descendants and cycles | [topological_sort](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.dag.topological_sort.html). Use producer-to-consumer edges and preserve data separately from display layout. |
| `matplotlib` (optional) | Static dependency/state diagrams and measured comparison charts | [savefig](https://matplotlib.org/stable/api/_as_gen/matplotlib.figure.Figure.savefig.html). Label synthetic costs as synthetic, not observed application performance. |

The provided script needs no optional packages. Select a library for a concrete
calculation in an isolated environment; do not install a global solver stack,
create a second app datastore or rewrite the user's project to demonstrate a
reference.

## Explicit local digest, not cross-language JCS

```python
import hashlib
import json

fixture = {"floor": "example-ground", "inputs": {"widthM": 4.0, "heightM": 3.0}}
encoded = json.dumps(fixture, sort_keys=True, separators=(",", ":"),
                     ensure_ascii=True, allow_nan=False).encode("utf-8")
digest = hashlib.sha256(encoded).hexdigest()
assert len(digest) == 64
```

This snippet assumes an already-validated plain-JSON fixture. The supplied
script adds guards. For cross-language canonical JSON, inspect
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.txt) and choose an explicitly
validated implementation if that is a separately approved requirement.
Sorted Python JSON is not an implementation of that RFC and does not match
the app's existing fingerprint by declaration.

## Optional schema check, preserving unknown data

With `jsonschema` already available:

```python
from jsonschema import Draft202012Validator

reference_schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "revision": {"type": "integer", "minimum": 0},
        "activeFloorId": {"type": "string", "minLength": 1},
    },
    "required": ["revision", "activeFloorId"],
}
Draft202012Validator.check_schema(reference_schema)
validator = Draft202012Validator(reference_schema)
record = {"revision": 7, "activeFloorId": "example-ground", "notes": None}
validator.validate(record)
assert "notes" in record and record["notes"] is None
```

This deliberately small **reference** schema is not the HomePlanner project
schema. Validation must not strip unknown same-schema fields or fill absent
physical evidence with zeros. A local schema URI names its dialect here; do
not auto-fetch arbitrary remote `$ref` documents from an imported project.

## Optional graph render

With NetworkX and Matplotlib already available, this explicitly writes a
synthetic dependency SVG in the current folder:

```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import networkx as nx

graph = nx.DiGraph()
graph.add_edges_from([
    ("snapshot", "geometry"),
    ("geometry", "field"),
    ("field", "overlay"),
])
order = list(nx.topological_sort(graph))
positions = {name: (index, 0) for index, name in enumerate(order)}
fig, ax = plt.subplots(figsize=(8, 2))
nx.draw_networkx(graph, pos=positions, ax=ax, node_size=2600, arrows=True)
ax.set_title("Synthetic dependency order - not measured execution time")
ax.set_axis_off()
fig.savefig("integrity-reference.svg")
plt.close(fig)
```

Let `NetworkXUnfeasible` surface for a cyclic graph rather than quietly dropping
an edge. An SVG arrow is not proof that an application worker observes the
depicted dependency.

## Run the dependency-free reference

```powershell
.\.venv\Scripts\python.exe -I -B .github\skills\homeplanner-project-integrity\scripts\example.py --check
```

The JSON includes checked numerical/state examples and `examples.svg`.
The script uses synthetic data, no network, no subprocesses and no file writes.
It is not imported by the app.
