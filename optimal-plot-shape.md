# Optimal plot shape under Telangana Building Rules (G.O.Ms.No.168)

Derived and independently verified on 2026-08-18. Applies to non-high-rise buildings
under Table III of G.O.Ms.No.168 MA&UD dt. 07.04.2012.

## The result

For a plot of fixed area `A`, with frontage `W` and depth `D`:

```
buildable envelope = (W − 2s) × (D − f − s)
```

where `f` = front setback and `s` = the Table III **column 10** setback, which applies to
*both* side edges **and** the rear.

Maximising at fixed area gives a closed form for the optimal depth-to-frontage ratio:

```
k* = (f + s) / 2s          where k = D / W
```

Equivalently `W* = √(2sA / (f+s))`.

## The rule of thumb

The front setback is charged **once**. The side setback is charged **twice** — once on each
flank. So the contest is **`2s` versus `f + s`**, not `f` versus `s`:

| condition | equivalent to | optimal shape |
|---|---|---|
| `f + s > 2s` | `f > s` | **deeper** than wide |
| `f + s < 2s` | `f < s` | **wider** than deep |
| `f + s = 2s` | `f = s` | square |

To dilute a fixed absolute loss, you want the dimension carrying the **larger** loss to be
the **longer** one.

## Why the common intuition misleads

"Front setbacks are bigger, so a deeper plot is better" is true only for **small** plots.
Table III grows the side/rear setback from 0.5 m up to 6.0 m as plot size rises, while the
front setback stays pinned at 3.0 m on any road of 12 m or less. So the side setback
overtakes the front at around **500 sq m**, and above that **wide-shallow beats deep**.

## Optima by plot band (abutting road ≤ 12 m, so front is at its floor)

| Table III band (sq m) | f | s | 2s | f+s | k* | shape |
|---|---|---|---|---|---|---|
| 50 – 100 (h=10)    | 1.5 | 0.5 | 1.0  | 2.0 | **2.00**  | deep |
| 100 – 200          | 1.5 | 1.0 | 2.0  | 2.5 | **1.25**  | deep |
| 200 – 300 (h=10)   | 2.0 | 1.5 | 3.0  | 3.5 | **1.167** | deep |
| 300 – 400 (h=12)   | 3.0 | 2.0 | 4.0  | 5.0 | **1.25**  | deep |
| 400 – 500 (h=12)   | 3.0 | 2.5 | 5.0  | 5.5 | **1.10**  | deep |
| 500 – 750 (h=15)   | 3.0 | 3.5 | 7.0  | 6.5 | **0.929** | wide |
| 750 – 1000 (h=15)  | 3.0 | 4.0 | 8.0  | 7.0 | **0.875** | wide |
| 1000 – 2500 (h=15) | 3.0 | 5.0 | 10.0 | 8.0 | **0.80**  | wide |
| above 2500 (h=15)  | 3.0 | 6.0 | 12.0 | 9.0 | **0.75**  | wide |

## How much it is actually worth — very little

Gain of the optimal shape over a plain square plot:

| plot | optimal k | gain vs square |
|---|---|---|
| 75 sq yd   | 2.00  | +3.3% |
| 150 sq yd  | 1.25  | +0.4% |
| 250 sq yd  | 1.167 | +0.2% |
| 400 sq yd  | 1.25  | +0.5% |
| 600 sq yd  | 0.929 | +0.1% |
| 1200 sq yd | 0.80  | +0.8% |
| 3000 sq yd | 0.75  | +0.8% |

The objective is **very flat near the optimum**, so shape is a second-order concern.
It is dominated by:

1. **Plot-size band boundaries.** Setbacks step at 200/300/500/750/1000 sq m. Buying
   slightly more land can push you into the next band and leave you with *less* buildable
   area.
2. **Road width.** On a road capped at 12 m height, crossing 1500 sq m drops you from the
   12 m row to the 7 m row (Table III Sl.No 10 has no 12 m option) — roughly halving floors.
3. **Floors**, which are capped by Table II road category regardless of shape.

Do not pay a premium for plot shape. Do care about which band you land in.

## Caveats

- Optima above assume an abutting road **≤ 12 m**, where the front setback is at its
  minimum. On wider roads the front rises (4, 5, 6, 7.5 m), which raises `k*` — deeper
  plots become optimal again.
- Assumes a clean rectangle, one road, and the tallest height permitted for the band.
  A corner plot takes the front setback on the priority road and Column-10 elsewhere,
  which changes the arithmetic.
- The tot-lot deduction (5% above 750 sq m) is a flat area subtraction and does **not**
  move the argmax.
- Sub-50 sq m plots have `s = 0` (no side setback required), so `k*` is undefined —
  the formula divides by zero. There, depth is unboundedly favourable in the model, but
  practical frontage minimums and TG-bPASS rules bind instead.

## Verification method

1. Algebraic: substitute `D = A/W`, differentiate `(W−2s)(A/W−f−s)` w.r.t. `W`, set to
   zero → `W² = 2sA/(f+s)` → `k* = (f+s)/2s`.
2. Numerical brute force from first principles, independent of the calculator's own code,
   sweeping k from 0.20 to 5.00 in 0.0005 steps. Matched the closed form to 3 decimals at
   all five test bands.
3. Cross-checked against the calculator's `evalPlot()` at nine plot sizes — predicted and
   empirical argmax agreed exactly.
