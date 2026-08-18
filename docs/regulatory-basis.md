# Regulatory basis

## Primary rule set

The calculator maps these sources into deterministic inputs and outputs:

| Source | Provisions used |
|---|---|
| G.O.Ms.No.168 MA&UD, 07.04.2012 | Rule 4 and Table II (approach road), Rule 5 and Table III (non-high-rise height/setbacks), Rule 6 (projections), Rule 7 and Table IV (high-rise), Rule 13 and Table V (parking), Rule 21 and Table VI (impact fee), Rule 26 (occupancy and compounding), Rule 27 (enforcement) |
| G.O.Ms.No.95 MA&UD, 21.03.2026 | High-rise threshold changed to 21 m; Rule 17(d)(viii)-(xii) and Rule 17(f)(xii) TDR provisions |
| TG-bPASS Act 12 of 2020 | Section 7 permission tiers and self-certification route |
| Telangana Municipalities Act 2019 | Section 174 enforcement context |
| G.O.Ms.No.131/135 of 2020 | LRS charge model |
| G.O.Ms.No.152 of 2015 | Legacy BRS estimate for eligible existing deviations/unauthorised work |

The tool retains the 2012 Table II-IV cell values. Later scanned amendments
must be checked against the current TG-bPASS/BuildNow publication set.

## Plot size, road width, height, and floors

The permitted result is the intersection of several controls, not one table:

1. Net plot area selects a Table III plot band.
2. Selected height chooses an allowed row within that band.
3. Effective abutting-road width limits height and floors under Table II.
4. Setbacks are taken from the selected Table III row, or Table IV for
   high-rise construction.
5. Floor-to-floor height converts the height cap into a schematic floor count.
6. TDR adds benefits only when its qualifying plot/road/height conditions are
   met.

### The 30 ft road question

A 30 ft road is approximately 9.14 m and falls below 12 m. The calculator
therefore applies the Table II B1 maximum of five habitable floors and the
applicable Table III height cap. Providing larger setbacks inside the plot does
not make the public road wider and does not unlock a sixth floor. A sixth
habitable floor requires at least a 12 m (about 40 ft) road, plus a qualifying
plot/height row and all other approvals.

If the entered road is below 9 m, the model automatically deducts the strip
needed to reach 4.5 m from the road center line, treats setbacks as starting
after that strip, and applies the narrow-road height constraints.

## Corner plots

For a corner plot, the application models roads on both selected edges. It
chooses a deterministic front-edge priority (East, North, West, South) for
repeatable calculations. Rule 5(f)(ii) generally places the front on the wider
road, while an individual residential applicant may elect the other road if
access from the wider road is not taken. The user must verify that election
with the authority.

The remaining edges receive the Table III column-10 side/rear setback. The
site diagram also shows the Rule 5(f)(xiv) junction splay according to road
width.

## High-rise and TDR

- The application treats 21 m and above as high-rise under G.O.Ms.No.95.
- High-rise rows use Table IV minimum road widths and all-round setbacks.
- The model requires a 2,000 sq m plot for high-rise scenarios.
- The 18-21 m band is exposed as a TDR-only scenario for plots from 750 to
  2,000 sq m, with a warning that the amendment does not restate every setback
  cell for this band.
- For plots above 2,000 sq m, the model adds up to 3/4/5 TDR floors on
  40/60/80 ft roads respectively.
- The high-rise TDR setback relaxation is capped at 10 percent and never below
  7 m all round.

TDR is a design-stage entitlement only when all stated conditions and required
development rights are satisfied. It is not the same as post-facto
compounding.

## Ten-percent deviation and compounding

The "10% side/rear compounding" control is a scenario comparison for Rule
26(d), not permission to design a violation.

- It applies only to non-high-rise construction.
- It excludes the front setback.
- It models up to 10 percent reduction in side/rear setbacks.
- The indicative fee is 100 percent of the Registration Department land value
  of the violated portion.
- It is discretionary, post-facto, and tied to occupancy-certificate review.
- The model warns that construction without a sanctioned plan is not eligible
  for this compounding path.
- Deviations above the applicable tolerance can be treated as unauthorised
  construction and face enforcement.

## Balconies and setback projections

- For non-high-rise buildings, Rule 6 keeps balconies/corridors out of
  mandatory setbacks; only the listed chajja/weather-shade allowance is
  represented in the explanatory text.
- For high-rise floors at least 6 m above ground, Rule 7(a)(xiv) is modelled as
  allowing a balcony projection up to 2 m, further capped by the available
  setback.
- The Room Planner therefore reserves balcony space inside the envelope unless
  the selected floor is explicitly eligible for the high-rise exception.

## Permission routes

The application presents three TG-bPASS-oriented procedural bands:

- Up to 75 sq yd, residential ground or ground+1: exemption/registration route
  described by section 7(2), subject to its exclusions.
- Individual residential, up to 500 sq m and 10 m: instant approval by
  self-certification under section 7(3).
- Larger, taller, commercial, apartment, or high-rise cases: scrutiny and
  applicable NOCs.

These procedural routes do not erase the substantive setback, land-use,
parking, fire, airport, buffer-zone, or title requirements.

## Source links

- [G.O.Ms.No.168 - HMDA](https://lrsbrs.hmda.gov.in/hmdaLMS/data/168.pdf)
- [G.O.Ms.No.168 - MoHUA mirror](https://www.amrut.mohua.gov.in/uploads/reform/ulb/GO168-Dt07042012pdf247.pdf)
- [G.O.Ms.No.95 - PDF](https://archive.org/download/in.gov.telangana.goir.2026-03-21.municipal-administration-and-urban-development-manuscript-95/municipal-administration-and-urban-development-manuscript-95.pdf)
- [TG-bPASS](https://tgbpass.telangana.gov.in/)
- [BuildNow GOs and Acts](https://buildnow.telangana.gov.in/go-and-act/)
- [HMDA government orders](https://lrsbrs.hmda.gov.in/hmdaLMS/govtOrderpage)
- [GHMC BRS](https://brs.ghmc.gov.in/)
- [Telangana LRS](https://lrs.telangana.gov.in/)

