# Management gates

Run the applicable gates as a checklist before presenting any significant
output. A failed gate is REPORTED in the output, never silently passed —
"Evidence Gate: weak — no delivery data newer than 3 weeks" is a valid and
useful result.

| Gate | Question | Applies to |
|---|---|---|
| Context | Do we understand enough about the problem? | every workflow |
| Evidence | Is every recommendation supported by company information with provenance? | every workflow |
| People | Did we consider ownership, capacity, stakeholders, communication? | judgments |
| Product | Does this align with customer and business value? | judgments |
| Engineering | Did we consider architecture, debt, dependencies, reliability, delivery complexity? | judgments |
| Delivery | Is the proposed plan/assessment realistic given capacity and history? | judgments |
| Risk | What could fail? Are unknowns explicit? | every workflow |
| Decision | Are alternatives and trade-offs clear? | recommendations |
| Action | Exact action + scope confirmed by the user before ANY write to an external system? | write workflows (none in slice 1) |

Slice 1 workflows are read-only; if a workflow ever appears to need a write
to Jira/Slack/GitHub/etc., stop — that requires the Action Gate and belongs
to a later slice.
