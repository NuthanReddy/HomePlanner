# Integrity calculations: precision, identity and result ownership

These equations describe checkable reference contracts. They are not a new
database, command coordinator or project codec. The current JavaScript
`HomePlanner`, `HomePlannerModel` and feature-owned fingerprints remain the
application authority; inspect those APIs before applying a reference here.
The [persisted toolchain research](../../../../docs/research/building-analysis-toolchain.md)
is a guide to external workflows, not evidence those engines consume the app's
current plan. Any future adapter must preserve input identity, units, versions
and result provenance across that boundary.

## Symbols

| Symbol | Meaning | Unit / type |
| --- | --- | --- |
| \(a,b,\tau_a\) | Compared values and absolute tolerance | Same physical unit |
| \(\tau_r\) | Relative tolerance | Dimensionless |
| \(D,C(D),F(D)\) | Document, chosen canonical representation, fingerprint | Structured data, bytes/string, opaque token |
| \(r,r_e,r_s\) | Current, expected and saved revision | Nonnegative integer |
| \(p,f,m,j\) | Project ID, floor ID, method version and current job ID | Stable opaque identities |
| \(c_v,T_v\) | Synthetic task cost and earliest finish | Same declared time unit |

Do not equate a numerical tolerance with a design clearance, legal relaxation,
pixel rounding, object identity or acceptable measurement error.

## 1. Finite values and dimensional tolerances

For finite \(a,b\), the standard symmetric closeness predicate is

\[
|a-b|\le\max\!\left(\tau_a,\tau_r\max(|a|,|b|)\right).
\]

This is [Python's `math.isclose`](https://docs.python.org/3/library/math.html#math.isclose)
and [PEP 485](https://peps.python.org/pep-0485/). Choose \(\tau_a\) in the
compared quantity's unit and \(\tau_r\ge0\); use \(\tau_r<1\). For near-zero
results, a nonzero absolute tolerance is essential. Reject nonfinite inputs
before a geometry comparison: `math.isclose(inf, inf)` alone returns true.

Examples with an **illustrative**, not application-wide, metre tolerance:

- \(a=1\), \(b=1+5\times10^{-8}\), \(\tau_a=10^{-7}\), \(\tau_r=10^{-9}\):
  close.
- \(a=1\), \(b=1+2\times10^{-7}\), same tolerances: not close.
- Near-zero residual \(5\times10^{-8}\) m versus 0 m requires the absolute
  tolerance; a relative-only check would fail.

The editor uses its existing `ROOM_EPS`; model and study solvers can have
different, unit-scoped tolerances. Preserve declared tolerances instead of
globally replacing them with the example values.

For an area conservation residual:

\[
e_A=A_{\rm gross}-A_{\rm usable}-A_{\rm reserved},\quad
\eta_A=\frac{|e_A|}{\max(A_{\rm gross},A_{\rm scale})}.
\]

Here \(A_{\rm scale}>0\) is an explicit reference **area**, not the scalar 1
without units. Missing usable regions are not the same as `[]`, which means
zero usable floor. Use the shared region helper for the area calculation;
do not add overlapping reservation areas.

## 2. Authored edits, no-ops and revisions

For an optimistic edit to a known current project/floor:

\[
{\rm acceptEdit}=({\rm ownerMatches})\land(r_e=r)\land{\rm validCandidate}.
\]

\[
(D',r')=
\begin{cases}
(D,r), & \text{invalid, stale, cancelled or no content change},\\
({\rm apply}(D,c),r+1), & \text{one accepted content-changing command}.
\end{cases}
\]

An invalid/stale command must expose its error, not look like a successful
no-op. `r+1` is for the complete gesture/compound command, not every preview
pointer event. Undo restores prior authored content through a new revision;
it does not roll back the revision counter. Selection and navigation are not
authored changes.

Example: an edit based on revision 7 accepted at revision 7 produces revision
8. The same request arriving when the current revision is already 8 is stale.
A valid no-op at revision 8 remains at 8. Do not mutate another floor's
stored slice in any branch.

These are coordinator contracts, not a claim that arbitrary new
`expectedRevision` command fields exist. Use the actual command/adapter guard
for the operation in question.

## 3. Canonical bytes and ordered round trips

\[
B={\rm UTF8}(C(D)),\qquad F(D)=H(B).
\]

The canonicalization \(C\), hash \(H\), field selection, method version and
encoding must all agree before fingerprints can be compared. Preserve array
order and stable IDs; order can encode storey order and therefore elevation.
Object-property order may be normalized, but room positions must not become
IDs and deleted identities must not be recycled.

[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.txt), sections 3.1-3.2,
describes JCS's constrained input, ECMAScript number serialization,
UTF-16 property ordering and UTF-8 encoding. It rejects nonfinite numbers,
duplicate keys and invalid Unicode data. It is an informational RFC,
not evidence that the application's codec implements JCS.

**Important Python boundary:** `json.dumps(sort_keys=True)` is not JCS.
Python/JavaScript can differ on `1.0`, negative zero, exponent formatting and
non-BMP property ordering. The standalone script uses sorted Python JSON plus
SHA-256 only to show local content-change detection; its bytes must **not**
replace or be compared directly with HomePlanner fingerprints.
Do not convert IDs, dates or big-number strings to new types and then claim an
exact round trip.

For the supported plain-JSON reference subset:

\[
{\rm decode}({\rm encode}(D))=D
\]

means structural/type preservation, including `null`, explicit zero,
inactive-floor fields and unknown same-schema metadata. It does not mean
identical whitespace or float spelling. The example rejects duplicate keys,
nonfinite values, non-string keys, unsupported types and integers outside the
JavaScript safe-integer range rather than silently losing information.
The actual app performs additional schema, nesting, host, ownership and
descriptor validation; the reference is not a substitute.

## 4. Stable identity arithmetic

For a stored monotonic suffix \(n_{\rm next}\):

\[
{\rm id}_{\rm new}={\rm prefix}\mathbin{+\!\!+}"-"
\mathbin{+\!\!+}n_{\rm next},\qquad n'_{\rm next}=n_{\rm next}+1.
\]

Deleting an entity leaves \(n_{\rm next}\) unchanged. Example: IDs
`bed-1, bed-2, bed-3`, next suffix 4. Deleting `bed-2` leaves `bed-1, bed-3`
and next suffix 4; the next ID is `bed-4`, not `bed-2` or a renumbered `bed-3`.
Preserve the stored counter through export/import; `max(surviving IDs)+1`
cannot recover a deleted highest ID's history.

Names and order are not identities. Scene IDs are floor-namespaced, while
legacy source IDs stay intact; see
[project identity and geometry](../../../../docs/project-model.md).

## 5. Current worker results versus saved-state completion

Define a feature-scoped calculation key:

\[
K=(p,f,m,F_{\rm inputs},j).
\]

\[
{\rm attachResult}=(K_{\rm request}=K_{\rm current})
\land{\rm resultValid}\land\neg{\rm cancelled}.
\]

Use the existing feature's current-job and input-fingerprint contract.
Revision is useful provenance but a rename must not invalidate an otherwise
unchanged physical calculation merely because it increments the project
revision. Conversely, matching revisions from different imported projects
or divergent input snapshots cannot establish freshness.
The script demonstrates this using an explicitly width-only input subset:
renaming its fixture changes the document but not that example calculation.
This tiny subset is not an adequate input fingerprint for an actual
HomePlanner physical study.

Persisted content uses its own full-document identity:

\[
{\rm dirty}=(C_{\rm current}\ne C_{\rm lastCommitted}),\qquad
{\rm currentSaved}={\rm txComplete}\land\neg{\rm dirty}.
\]

If saving revision 7 completes after an edit creates revision 8, revision 7
was committed but the current project is still unsaved. A successful
IndexedDB request is not `txComplete`; a Blob URL is not a confirmed file
save. See [IndexedDB transactions](https://w3c.github.io/IndexedDB/) and
[the actual persistence contract](../../../../docs/local-persistence.md).
Never replace required storage errors with an in-memory success label.

## 6. Dependency ordering and calculation cost

For a derived dependency DAG, edges point from input/producer to consumer.
A valid ordering \(\pi\) satisfies

\[
u\rightarrow v\implies \pi(u)<\pi(v).
\]

For supplied nonnegative synthetic task costs and unlimited resources:

\[
T_v=c_v+\max_{u\in{\rm predecessors}(v)}T_u,
\]

with an empty predecessor maximum of zero. The maximum finish is a
critical-path **lower bound**, not a measured browser runtime; queues,
concurrency limits and rendering overhead can make execution slower.

Example costs in ms: project snapshot 2, geometry 5 after snapshot, boundary
inputs 3 after snapshot, field 11 after both geometry and boundary, overlay
2 after field. Finishes are 2, 7, 5, 18 and 20 ms. Changing geometry
invalidates downstream field and overlay evidence, not unrelated documents.
Cycles have no topological order and must be reported explicitly.

[`graphlib.TopologicalSorter`](https://docs.python.org/3/library/graphlib.html)
takes a mapping from a node to its **predecessors**, not successors.
The example's DAG is a teaching fixture, not a new work scheduler or
automatic permission to run analyses.

## Runnable evidence

[example.py](../scripts/example.py) checks finite tolerances, stable IDs,
JSON preservation, stale keys, revision arithmetic and the synthetic DAG,
then renders the computed revision/result state as labelled SVG. Optional
schema/graph/render tooling is described in [python-tools.md](python-tools.md).
