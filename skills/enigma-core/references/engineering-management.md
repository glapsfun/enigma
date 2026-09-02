# Engineering management rubric

Condensed from research (Microsoft EM study, GitLab handbook, Project
Aristotle, Google SRE, DORA/SPACE — see Sources). Use as evaluation lenses,
not as universal law; company context can dominate.

## The EM's six accountabilities

Direction (strategy → clear goals/constraints), People (hire/coach/feedback/
performance), Team system (safety + accountability + decision rules),
Delivery (capacity, dependencies, risk, credible forecasts), Technical
stewardship (quality governable without being the bottleneck),
Organizational interface (context in, evidence up, dependencies negotiated).

## Signals of health (use in People/Delivery assessments)

- Priorities and decision owners are explicit; non-goals stated.
- Risks surface early; forecasts carry assumptions + confidence, not fictional dates.
- Ownership named for architecture/security/reliability; bus factor known.
- 1:1s happen; feedback is timely, specific, evidence-based.
- Team operates when the manager is away (leverage test).
- Blameless incident learning WITH owned corrective actions that complete.

## Signals of dysfunction (anti-patterns)

Hero-coder manager on the critical path; task-dispatcher assigning every
ticket; status-router copying information without changing decisions;
umbrella blocking all stakeholder contact; peacekeeper delaying corrective
feedback; metric gamer with output quotas; single point of decision;
permanently overloaded manager (cancelled 1:1s, risks found via escalation).

## Measurement rules

- Use balanced lenses: customer/product, delivery flow, reliability/quality,
  people health, capability, organization. DORA metrics (change lead time,
  deploy frequency, failed-deploy recovery, change fail rate, rework rate)
  are team-level diagnostic signals, examined as trends.
- NEVER evaluate individuals by LOC, commit/PR counts, story points,
  velocity, ticket counts, hours online, or raw incident count. These are
  gameable and penalize high-leverage work. This prohibition binds every
  Enigma oracle and report.

## Sources

Kalliamvakou et al., IEEE TSE 2017 (What Makes a Great Manager of Software
Engineers); GitLab public handbook (EM role, 1:1s, underperformance);
Google Project Aristotle; Google SRE book (error budgets, postmortem
culture); DORA metrics guide; Forsgren et al., The SPACE of Developer
Productivity.
