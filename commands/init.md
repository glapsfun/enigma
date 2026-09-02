---
description: Initialize Enigma - discover the harness and the company, build the organizational map and memory in ./.enigma
argument-hint: "[--company <url>] [--docs <path>] [--reference <path>] [--full]"
---

Initialize Enigma's organizational memory in the current directory. Follow
the invariants in the enigma-core skill. Everything here is READ-ONLY toward
external systems; the only writes are inside `./.enigma/`.

Arguments given: $ARGUMENTS

## Phase 0 — Preflight

If `./.enigma/` exists and `$ARGUMENTS` does not contain `--full`:
run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .`, then
`node ${CLAUDE_PLUGIN_ROOT}/scripts/diff-state.mjs --dir .` and do an
INCREMENTAL run: only re-scan sources listed in `refresh` (Phase 2 below,
those sources only). Otherwise this is a FULL run.

## Phase 1 — Harness discovery (you, not a script)

Inventory your own environment — only you know your tool surface:
- Connected MCP servers/tools relevant to org knowledge (Jira, Confluence,
  Slack, GitHub/GitLab, Drive/Notion, trackers). A server listed as failed
  or erroring = status `degraded`, with a note.
- Local paths: the workspace itself, plus any `--docs` / `--reference`
  paths from `$ARGUMENTS` (verify they exist).
- `--company <url>` if provided.

Write the registry to `.enigma/index/sources.json` as
`{"sources": [{"id", "status": "available|degraded|unavailable", "tools": [...], "notes"}]}`
(schema: enigma-core `references/memory-schema.md`).

## Phase 2 — Company discovery (read-only, budgeted)

For each `available` source, follow the recipe and caps in enigma-core
`references/discovery.md`. Collect candidate entities and relationships into
one JSON file at `.enigma/state/candidates.json`:

```json
{ "entities": { "company": {}, "teams": [], "people": [], "projects": [], "components": [] },
  "relationships": [ {"from": "...", "type": "...", "to": "...", "provenance": {"value": "...", "status": "FACT", "source": {"type": "...", "ref": "..."}, "confidence": 0.9, "observed_at": "..."}} ] }
```

Every candidate carries provenance. Thin evidence → INFERENCE/ASSUMPTION.
Questions you cannot answer → collect as UNKNOWNs for Phase 4 (do not drop
them). A source failing mid-scan → mark it `degraded` in sources.json and
continue.

Classify each team's process (per `references/discovery.md`) as an
`INFERENCE`-status field on the team entity unless documentation states it.

## Phase 3 — Build the map (script)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/build-map.mjs --dir . --candidates .enigma/state/candidates.json`

If it reports `ok: false`, fix the candidate ids/relationships it names and
re-run. Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .`
and confirm it passes.

## Phase 4 — Checkpoint and report

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs --dir . --label init --scanned <comma-separated source ids you scanned>`
2. Write `.enigma/reports/company-overview.md`: teams (with inferred
   process + basis), projects and ownership, key components, relationship
   count, and an **Unknowns** section.
3. Present a summary in chat ending with the explicit UNKNOWN list, and ask
   the user (ONE batched round) which they can answer. Store answers as
   FACT envelopes with `source: {"type": "user"}` in
   `.enigma/memory/facts.jsonl` (append with `entity` field linking to the
   map id), and note the additions via
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/update-ledger.mjs --dir . --entry '{"type":"fact.added","entity":"<id>","source":"user"}'`.
