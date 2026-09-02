# Methodology & process rubric

Condensed from PMI Pulse 2024, State of Agile 2025, Scrum Guide 2020, Kanban
Guide 2025, Shape Up, DORA. There is no single best methodology; hybrids
dominate. Classify what a team ACTUALLY does from evidence — never force a
framework.

## Classification signals

| Process | Evidence looks like |
|---|---|
| Scrum | fixed sprints, sprint goals, regular reviews/retros, stable cross-functional team |
| Kanban | continuous pull, WIP limits, flow metrics (age, cycle time), continuous replenishment |
| Scrumban | Scrum cadences + Kanban pull/WIP for daily work |
| Waterfall / predictive | phase gates, big up-front spec, one late validation phase |
| Release-driven | work batched to dated releases/cutovers |
| Incident-driven / ad-hoc | interrupt-dominated intake, no visible cadence |
| Continuous delivery | trunk-based, small batches, frequent deploys, feature flags |

## Fit heuristics (for assessments, not prescriptions)

- Continuous/interrupt-driven arrival → Kanban fits; sprint commitments that
  ignore interruptions are a red flag.
- Stable cadence + formable sprint goal → Scrum can help focus.
- High assurance/regulatory burden → risk gates + continuous evidence, not
  one big final validation.
- Dependencies dominating cycle time → fix boundaries/architecture BEFORE
  adding coordination ceremonies or scaling frameworks.

## Red flags (cite in findings when observed)

Infrequent releases + late integration labeled "Agile"; identical sprint
lengths mandated everywhere; committed feature roadmap with no discovery;
QA/security/ops as downstream queues; normalized sprint carry-over; story
points compared across teams; methodology compliance measured instead of
outcomes; scaling framework before priorities/boundaries fixed.

## Delivery-health lenses

Flow: WIP, throughput, work-item age, cycle time percentiles, blocked time.
Delivery: DORA five. Quality: escaped defects, SLO attainment, rework.
Team: SPACE dimensions (satisfaction, performance, activity, communication,
efficiency) — never reduced to a single activity count.
