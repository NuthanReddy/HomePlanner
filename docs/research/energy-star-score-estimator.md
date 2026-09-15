# ENERGY STAR score estimator research

Research date: **2026-09-10**. Source:
[Simulations4All Energy Star Score Estimator](https://simulations4all.com/simulations/energy-star-score-estimator).

Status: article extracted and calculator inspected. "ENERGY STAR" is an EPA
program name; this third-party calculator is not Portfolio Manager.

## Page scope

The article explains site energy, source energy, EUI, source-site ratios,
building-type medians and the 1-100 ENERGY STAR score concept. It openly says
the actual EPA score uses building-type regression models and that its own
score is a simplified estimate.

## Observed calculator

Building types: Office, K-12 School, Hospital, Hotel, Retail, Multifamily,
Warehouse, Supermarket and Data Center. Presets include Efficient Office,
Typical School, Old Hospital, Green Hotel and Data Center.

| Input | Default | Range |
| --- | ---: | ---: |
| Gross floor area | 50,000 ft2 | 1,000-500,000 |
| Operating hours | 60/week | 20-168 |
| Occupants | 200 | 5-5,000 |
| Electricity | 800,000 kWh/year | 0-10,000,000 |
| Natural gas | 5,000 therms/year | 0-200,000 |
| Fuel oil #2 | 0 gal/year | 0-100,000 |
| District steam | 0 kBTU/year | 0-5,000,000 |
| District chilled water | 0 kBTU/year | 0-5,000,000 |

The tool provides play/pause/stop animation, a score gauge, source/site EUI,
total source energy, source/site ratio, electricity share, peer median,
occupant density, cost intensity and report export.

## Stated model

- Site energy is converted to kBTU using:
  `Esite = (kWh * 3.412) + (therms * 100) + (gallonsOil * 138.5) +
  steam_kBTU + chilledWater_kBTU`.
- Source energy is calculated as:
  `Esource = (kWh * 3.412 * 2.80) + (therms * 100 * 1.05) +
  (gallonsOil * 138.5 * 1.01) + (steam_kBTU * 1.20) +
  (chilledWater_kBTU * 1.00)`.
- `Site EUI = site energy / gross floor area`.
- `Source EUI = source energy / gross floor area`, in kBTU/sf/year.
- The page's simplified score is:
  `Score = 100 - (Source EUI / median EUI) * 50`, clamped to `[1, 100]`,
  with additional operating-hours and occupant-density adjustments whose exact
  implementation is not disclosed.
- Under this simplified equation, median EUI maps approximately to score 50 and
  half the median EUI maps approximately to score 75.

### Conversion and source-site factors reported by the page

| Fuel or service | Site conversion | Source-site factor |
| --- | ---: | ---: |
| Grid electricity | 3.412 kBTU/kWh | 2.80 |
| Natural gas | 100 kBTU/therm | 1.05 |
| Fuel oil #2 | 138.5 kBTU/gal | 1.01 |
| District steam | Already kBTU | 1.20 |
| District chilled water | Already kBTU | 1.00 |
| Propane | 91.5 kBTU/gal (reference table) | Not used by the visible calculator |
| Wood | 20,000 kBTU/cord (reference table) | Not used by the visible calculator |

The page additionally reports that on-site solar reduces purchased electricity
and describes self-generated energy as avoiding the grid's 2.80 multiplier.
That treatment must be checked against current Portfolio Manager accounting
rules before reuse.

## Review findings

1. **The score is not the EPA algorithm.** The linear equation cannot reproduce
   the official regression, eligibility rules, normalization or data-quality
   checks. It must never be labelled an official score.
2. **Certification is not score alone.** A displayed 75 does not establish
   eligibility or certification.
3. **Source ratios are versioned.** EPA factors and treatment of renewable,
   district and green-power energy require current Portfolio Manager rules.
4. **Building-type medians differ by dataset.** The page's source-EUI medians
   must not be mixed with site-EUI CBECS values from other calculators.
5. **Geographic scope is U.S.-specific.** This is not an appropriate Hyderabad
   residential benchmark.

## Additional page content

### Reported peer benchmarks

The article gives these approximate median **source** EUIs and labels the
building-type sample size qualitatively:

| Type | Median source EUI (kBTU/sf/year) |
| --- | ---: |
| Office | 148 |
| K-12 school | 141 |
| Hospital | 389 |
| Hotel | 163 |
| Retail | 117 |
| Multifamily | 123 |
| Warehouse | 55 |
| Supermarket | 458 |
| Data center | 1,400+ |

It also gives indicative energy-cost bands: office $2.50-$4.00/sf/year,
hospital $4.00-$8.00, retail $1.50-$3.00 and warehouse $0.50-$1.50, with
top- and bottom-quartile examples. These are context only and need geographic,
tariff, occupancy and year metadata.

### Additional workflow guidance

The article recommends:

- collecting a complete 12 consecutive months of utility data;
- entering gross floor area consistently rather than net rentable area;
- recording building type, year built, operating hours, occupants or units and
  ZIP code for weather normalization;
- benchmarking at least annually, with monthly tracking useful for anomalies;
- defining mixed-use portions separately rather than comparing unlike uses;
- using score results to prioritize audits, retrofits and utility programs.

The page's exercises cover the source/site gap, building-type comparisons, the
path to score 75, occupant-density sensitivity and fuel-switching scenarios.
Its challenge questions include hand calculation of source EUI, all-electric
versus mixed-fuel source energy, target EUI for score 75 and the effect of
offsetting electricity reductions with additional gas.

### Claims and examples requiring caution

The article discusses certification at score 75, mandatory benchmarking,
real-estate premiums, utility rebates, ESG reductions, federal-building
requirements and on-site solar. These are research leads, not verified
HomePlanner facts. The article's fuel-switching example correctly illustrates
that source energy can rise even when site energy falls, but it is not a
complete heat-pump lifecycle, emissions or tariff analysis.

## Reported verification cases

The page lists eight calculator checks, all marked PASS in its own February 2026
verification log:

1. 800,000 kWh -> 2,729,600 kBTU site -> 7,642,880 kBTU source.
2. 5,000 therms -> 500,000 kBTU site -> 525,000 kBTU source.
3. 50,000 sf and 3,229,600 kBTU site -> 64.6 site EUI.
4. 50,000 sf and 8,167,880 kBTU source -> 163.4 source EUI.
5. Office median source EUI -> 148 kBTU/sf/year.
6. Score 75 or higher -> displayed Certified state.
7. Fuel oil #2 -> 138.5 kBTU/gallon.
8. Hospital median source EUI -> approximately 389 kBTU/sf/year.

These are internal page claims and arithmetic checks, not independent
validation of EPA's current Portfolio Manager algorithm.

## Important distinction

The page contains much more explanatory material than the visible calculator
implements. The visible tool accepts electricity, gas, oil, district steam and
district chilled water, then displays a simplified score. It does not expose
the official EPA regression coefficients, weather-normalization implementation,
eligibility rules, data-quality checks, renewable accounting details or
mixed-use Portfolio Manager workflow. Those details should not be inferred from
the page's simplified score.

## HomePlanner relevance

Do not implement the score. Reusable ideas are annual fuel-entry normalization,
site/source distinction, clearly sourced conversion factors and peer benchmark
context. For HomePlanner, local tariffs, emissions and Indian residential
benchmarks would need separate authoritative sources.

## Complete page-content coverage

The page’s operating guidance covers selecting a building type, entering
12-month utility data, converting fuels to site and source energy, comparing
the result with the building-type median, exploring the path to a score of 75,
changing occupant density, and exporting the result. It discusses mixed-use
buildings, missing months, on-site solar, utility-cost interpretation and why
source energy is used for national comparison.

The educational sections explain building-type energy profiles, source/site
energy, conversion factors, benchmark medians, cost context and the limits of
using a single score. Activities compare source/site gaps, building types,
occupant density and the score target. The page also includes real-world
benchmarking applications, reference tables, challenge questions, common
mistakes, an FAQ, references, citation instructions and a verification log.

These sections are incorporated as paraphrased research coverage rather than
reproduced page text. Numerical values and verification cases remain
attributed to the page and should be rechecked against current EPA technical
reference material before implementation.
