# Plumbing and drainage method sources

Checked **17 Sep 2026**. Official EPA pages and its hosted manual chapter were
retrieved. The following summaries are original; no manual tables or lengthy
excerpts are reproduced. A source check is not a project hydraulic assessment.

## P1 — U.S. EPA: EPANET

- URL: https://www.epa.gov/water-research/epanet
- Checked: 17 Sep 2026; official HTML retrieved, HTTP 200.
- Relevance: EPA describes extended-period analysis of pressurised distribution
  networks, including junctions, pipes, reservoirs/tanks, pumps and valves.
  Demands, operating conditions, pressures and convergence are hydraulic-model
  concerns rather than properties established by a connectivity drawing.
  The EPA page links its official EPANET 2.2 online manual.
- Applicability limits: pressurised water-network modelling, not gravity sewer
  sizing or a local plumbing code. HomePlanner's current service records lack
  a complete demand/head/roughness/equipment model and compute no hydraulic flows.
  This reference does not install EPANET or establish calibrated project results.

## P2 — U.S. EPA: EPANET 2.2 analysis algorithms

- URL: https://usepa.github.io/EPANET2.2/12_analysis_algorithms.html
- Checked: 17 Sep 2026; manual chapter retrieved from EPA's official GitHub Pages
  manual, whose root is linked by the EPA product page.
- Relevance: the chapter formulates nodal continuity and link energy relations
  using explicit demands, fixed heads and headloss behavior, then describes an
  iterative global-gradient solution. Its convergence discussion motivates
  separate mass/energy residual checks and declared flow sign conventions.
- Applicability limits: these equations and solver assumptions concern the
  specified EPANET hydraulic problem, not proof that a geometric drain falls
  correctly or has adequate capacity. Read the version-specific method and
  supported device behavior before designing a comparison fixture. No formulas,
  default coefficients or solver stopping tolerances are imported into HomePlanner.

## P3 — U.S. EPA: Storm Water Management Model

- URL: https://www.epa.gov/water-research/storm-water-management-model-swmm
- Checked: 17 Sep 2026; official HTML retrieved, HTTP 200.
- Relevance: EPA distinguishes rainfall/runoff processes from hydraulic routing
  through pipes, channels and storage, and lists kinematic/dynamic-wave options,
  manuals, errata and a dynamic-wave quality-assurance report. This informs
  keeping storm inflows, receiving boundaries and routing assumptions explicit
  when selecting future solver-validation cases.
- Applicability limits: HomePlanner implements geometric drainage profiles,
  not these hydrologic/hydraulic solvers. No rainfall, infiltration, storage,
  overflow or flood-capacity result follows from an invert polyline.
  The product page was reviewed; the linked QA archive was not executed.
  Consult the relevant manual/errata before numerical thresholds or benchmarks.

## Access and authority boundaries

Neither EPA solver documentation nor agreement with a supplied slope establishes
applicable local plumbing law, a minimum pipe size, safe cover, discharge
permission or receiving capacity. Current jurisdiction/code edition and
professional review must be supplied for engineering work.
No paywalled plumbing standard was reproduced or assumed to have been reviewed.
Do not fetch public data automatically or send private repository content,
coordinates, plans or user records to any external service.
