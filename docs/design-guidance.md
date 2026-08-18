# Passive, green, and Vastu guidance

The planner keeps three lenses separate so a cultural preference cannot be
presented as law or building science.

## Daylight and ventilation

The science checklist uses geometric proxies rather than simulation:

- Exterior-wall exposure.
- Gross window area and effective openable area.
- Window-head height and side-light reach.
- Opposing or corner openings for cross-flow.
- Selected prevailing-wind direction.
- Dedicated exhaust expectations for kitchens/bathrooms.
- Basic room/furniture clearances and circulation access.

These checks help compare schematic layouts. They do not predict lux, glare,
operative temperature, pressure coefficients, air changes per hour, or annual
energy.

## IGBC and LEED comparison

The green checklist exposes indicative comparisons for daylight, ventilation,
solar control, efficient lighting/appliances, and related design preparation.
It is not an IGBC or LEED scorecard and cannot award points. Certification
requires the applicable rating-system version, simulation/measurements,
documentation, commissioning, and third-party review.

The UI labels simulation-, authority-, and detail-design-dependent items as
manual steps instead of pretending to fix them.

## Vastu

Vastu mode is optional, cultural, non-statutory, and scored independently.
Common directional preferences are advisory only. Vastu never overrides:

- Setbacks or planning law.
- Fire and life safety.
- Sanitation and privacy.
- Structural feasibility.
- Accessibility.
- Daylight, ventilation, and environmental performance.

The application explicitly reports that Vastu is not scientifically validated
and is not required by GHMC, TG-bPASS, or RERA.

## Checklist fixes

Each checklist row identifies one of three action types:

- **Fix**: the planner can attempt a measurable schematic change.
- **Manual step**: simulation, professional design, authority review, or
  information outside the model is required.
- No action: already satisfactory or not applicable.

Automated strategies include moving a room to legal exposed positions, adding
or resizing an exterior window, creating a second exposure for cross-flow, and
searching legal Vastu placements. A fix is retained only when the target row's
severity or numeric result improves after a full re-score. Otherwise the
pre-fix snapshot is restored automatically.

**Fix all feasible** applies the same principle to the aggregate checklist.
**Undo last fix** restores the complete pre-fix planner snapshot. Because the
snapshot is complete, edits made after a successful fix are also reverted when
that fix is undone. Up to ten successful fix snapshots are retained.

