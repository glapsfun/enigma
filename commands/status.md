---
description: Evidence-gated project/team status via Enigma's oracle pipeline (read-only)
argument-hint: "<project-or-team-id>"
---

Produce a status assessment for: $ARGUMENTS
Follow the invariants in the enigma-core skill. This workflow is READ-ONLY
toward external systems.

## 1. Validate and load context

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .` — on
  errors, stop and report (offer ledger-based reconstruction). If `.enigma/`
  is missing, suggest `/enigma:init` and stop.
- If `$ARGUMENTS` is empty, list project ids from `.enigma/map/projects.json`
  and ask which one.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.mjs --dir . --entity <id>`
  — on unknown id, show the `known` list and ask.

## 2. Fill evidence gaps (read-only)

Compare the bundle against what a status report needs: recent tickets/epics,
recent PRs/commits, incidents, blockers, stated dates. Fetch ONLY the gaps
from `available` sources in `.enigma/index/sources.json` (respect the caps in
enigma-core `references/discovery.md`). Append new evidence to
`.enigma/memory/facts.jsonl` as envelopes with an `entity` field.

## 3. Ask only necessary questions

If something material cannot be answered from map + live sources, ask the
user now — ONE batched round. Store answers as FACT envelopes
(`source.type: "user"`).

## 4. Oracle fan-out (parallel — single message)

Dispatch ALL FIVE oracle agents (`product-oracle`, `engineering-oracle`,
`delivery-oracle`, `people-oracle`, `risk-oracle`) in ONE message so they run
concurrently. Each prompt contains:
1. The full evidence bundle JSON (from step 1, plus step 2/3 additions).
2. The rubric directory path: `${CLAUDE_PLUGIN_ROOT}/skills/enigma-core/references/`.
3. The instruction: "Judge this bundle through your lens only. Reply with
   exactly your JSON verdict."

Collect the five JSON verdicts. If one fails or returns non-JSON, keep going
with the rest and note the missing lens.

## 5. Judge

Dispatch the `judge` agent with: the verdicts you received, the evidence
bundle, and the note of any missing lens. Its markdown assessment
(Recommendation / Health by lens / Disagreements / Judgment model /
Evidence / Unknowns) is the core of the report.

## 6. Gates and presentation

Run the Context, Evidence, Delivery, and Risk gates from enigma-core
`references/gates.md`. Report any weak gate in the output ("Evidence Gate:
weak — no delivery data newer than 3 weeks").

Write `.enigma/reports/status-<id>-<YYYY-MM-DD>.md` containing: title + date, gate
results, the Judge's assessment verbatim, and a provenance appendix (each
key finding's status and source type). Present the same content in chat.

## 7. Record

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/update-ledger.mjs --dir . --entry '{"type":"status.assessed","entity":"<id>","source":"enigma","change":{"overall":"<one-line health call>","report":".enigma/reports/status-<id>-<date>.md"}}'`
- Append notable NEW facts discovered during this run to
  `.enigma/memory/facts.jsonl` (if not already done in step 2).
