# Optional mechanics reference tools

Official documentation checked **17 Sep 2026**. No optional module or solver was
installed or executed. The [stdlib reference](../scripts/example.py) checks only
the [declared simply supported beam equations](calculations.md).

| Distribution → import | Appropriate selection | Additional requirements |
| --- | --- | --- |
| `sympy` → `sympy`; `sympy.physics.continuum_mechanics.beam.Beam` | Symbolic equilibrium/ODE and analytical beam fixtures | Consistent signs, loads and boundary conditions. Symbolic success is not code design. |
| `openseespy` → `openseespy.opensees` | Separately specified numerical structural analysis | Compatible platform-specific compiled OpenSees package, nodes/elements/material laws, restraints, loads, units and analysis configuration. Not just plotted member boxes. |
| `matplotlib` → `matplotlib.pyplot` | Optional equilibrium/refinement/deflection plots | Label magnification and units; avoid presenting a smooth curve as measured behavior. |

## Independent symbolic identity example

[SymPy beam API](https://docs.sympy.org/latest/modules/physics/continuum_mechanics/beam.html)
documents its own shear/moment/load convention. The following original symbolic
fixture explicitly uses **downward-positive deflection** and the equations in
this package; it does not silently mix that convention with `Beam` defaults.

```python
from sympy import diff, simplify, symbols

x = symbols("x", real=True)
L, E, I = symbols("L E I", positive=True)
q = symbols("q", real=True)
v = q * x * (L**3 - 2*L*x**2 + x**3) / (24*E*I)
moment = q * x * (L-x) / 2
assert simplify(E*I*diff(v, x, 4) - q) == 0
assert simplify(E*I*diff(v, x, 2) + moment) == 0
assert simplify(v.subs(x, 0)) == 0
assert simplify(v.subs(x, L)) == 0
```

This tests equation/boundary identities. It proves neither a real member's
constitutive assumptions nor its strength, supports, dimensions or connections.
Use independent fixture numbers as well as identities; never use a solver's
own output as its sole expected answer.

## OpenSeesPy is a different execution path

[OpenSeesPy model command](https://openseespydoc.readthedocs.io/en/latest/src/model.html)
and [documentation](https://openseespydoc.readthedocs.io/en/latest/).
The import uses `openseespy.opensees`, not a presumed generic “structural” module.
A compatible native distribution is required; don't infer compatibility from
the Python package name alone.

```python
import openseespy.opensees as ops

def initialize_explicit_empty_2d_frame():
    ops.wipe()
    ops.model("basic", "-ndm", 2, "-ndf", 3)
```

This function, if explicitly called in a disposable external context, creates
only an **empty** model with two spatial dimensions and three degrees of freedom
per node. It performs no analysis and yields no meaningful building result.
Choose an internally consistent force/length/time unit system; OpenSees does
not infer it from units in a drawing.
Do not invent nodes, fixes, releases, loads, E/I or material strengths to make
a system nonsingular. Require full engineering inputs and check equilibrium,
stability, convergence, mesh/step sensitivity and independent analytical cases.
Qualified code-design/geotechnical review remains separate.

Keep the app's stable IDs, nullable anchors/sizes, `not-assessed` status and
shared drawing/3D consumers unchanged. None of these tools is a new HomePlanner
engine or permission to overwrite structural intent with computed geometry.
