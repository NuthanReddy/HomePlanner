# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

HomePlanner must support two modes: Homeowner and Expert. This is a confirmed
product requirement. Both operate on one shared project with Overview, Site,
Design, Analyze, Compare and Report destinations. The user approved guided
homeowner entry and direct expert controls with edits preserved across modes.
Specific expert disciplines and collaboration permissions
remain open; choosing Expert mode does not establish professional credentials.

## Product Purpose

Help users turn a house brief and site constraints into editable design
candidates, then understand their feasibility and environmental performance.
AI-assisted generation is the primary planned outcome, not a claim about the
current application.

Confirmed example briefs:

- A three-bedroom Hyderabad house with 1800 sq ft total built-up area, including
  walls and summed across floors. Floor count is not yet specified.
- A 3BHK within a 23 by 45 plot, with explicit dimension units, frontage,
  non-cardinal orientation and surrounding obstructions. This is a separate
  example unless the user combines the briefs.

## Operating Context

The existing application is a local-first browser workbench with plot
comparisons, editable floors, optional 3D, sun paths, environmental scenarios
and electrical-point planning. Existing projects use browser storage and JSON
backup/import. See README.md for current capabilities and limitations.

The planned location flow accepts an address, coordinates, or explicitly
requested browser location, followed by user confirmation of the plot on a map.
A map pin is not a plot survey or an orientation measurement.

## Capabilities and Constraints

The building-performance roadmap proposes structured briefs, deterministic
geometry validation, weather acquisition and EPW validation, engine-backed
analysis, and bounded AI workflows. These are planned, not already implemented.

The Google map picker is an optional proposed provider integration. Its shared
10,000-per-month per-SKU usage guard is a confirmed planning requirement;
implementation and service activation are not authorized by the planning task.

Preserve the distinction between built-up and usable area, supplied and unknown
site data, heuristic screening and simulation, and advisory rules and certified
compliance. Do not treat an unknown neighboring building as an empty site.

## Evidence on Hand

- README.md: current features, runtime, storage and limitations.
- index.html: incumbent navigation, editor, plot analysis and regulatory sources.
- planner-model.js and planner-bridge.js: current editing and model contracts.
- environment-ui.js: existing site, weather, context and scenario surfaces.
- docs/building-performance-roadmap.md: proposed technical architecture.

## Product Principles

- Make AI-generated designs editable and their assumptions inspectable.
- Respect explicit site and area constraints; explain infeasible requests.
- Keep heuristic advice, physical evidence and cultural preferences distinct.
- Request consent before location detection or external data operations.
- Preserve user edits and existing local projects as capabilities expand.

## Open Decisions

The website organization brief records the approved navigation and shared-project
mode structure; detailed layouts remain proposed. It does not authorize a visual
rebrand or application implementation.
Cloud hosting, accounts, collaboration roles and professional certification
workflows are not settled.
