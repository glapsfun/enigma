---
description: Initialize Enigma - discover the harness and the company, build the organizational map, evidence store, and index in ./.enigma
argument-hint: "[--company <url>] [--docs <path>] [--reference <path>] [--full] [--reconsent] [--deep <area-id,...>]"
---

Build Enigma's organizational memory in the current directory. Follow the
invariants in the enigma-core skill. Everything here is READ-ONLY toward
external systems; the only writes are inside `./.enigma/`.

Arguments given: $ARGUMENTS

## Phase 0 — Preflight

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .` and stop
on errors (name the broken file, offer ledger-based reconstruction).

If `./.enigma/` exists:
- Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/diff-state.mjs --dir .`. Its
  `resume` array lists deep-pass queue entries that are not done.
- `--deep <ids>` — append those areas to the queue and go straight to Phase 5.
- No `--full` — skip Phase 1 unless `--reconsent` is present, re-scan only
  the sources in `refresh`, then continue with `resume`. Run Phase 2 for every
  id in `needs_consent` (and for all sources when `--reconsent` is present) —
  a source without a recorded consent decision is never read (invariant 11).
- `--full` — reset cursors (keep consent and evidence) and run every phase.

## Phase 1 — Harness inventory (you, not a script)

Only you know your tool surface. Inventory what you can reach, reading
nothing yet:
- MCP servers and tools relevant to organizational knowledge (Jira,
  Confluence, Slack, GitHub/GitLab, Drive/Notion, trackers). A server the
  harness reports as failed is `status: degraded` with a note.
- CLIs on this machine: run `command -v gh jira git kubectl glab` and record
  what exists.
- Local paths: the workspace itself plus any `--docs` / `--reference` paths
  from `$ARGUMENTS`. Verify each exists.
- `--company <url>` if provided.

Write `.enigma/index/sources.json`:

```json
{"sources": [{"id": "jira", "type": "mcp|cli|local|url",
  "status": "available|degraded|unavailable",
  "tools": ["..."], "yields": ["projects", "epics"], "notes": "..."}]}
```

## Phase 2 — Consent round (ONE batched question)

Present the inventory and ask, in one round, which sources Enigma may read:
approve, exclude, or limit each (a limit is a note such as "only projects DP
and PLAT" or "Slack channel names only"). Nothing is read before this.

Write each answer back to `sources.json` as `consent` plus `consent_note`.
Skip this phase only when every source already has a consent value and
`--reconsent` is absent.

## Phase 3 — Shallow pass (scouts in parallel)

Dispatch ONE `scout` subagent per `approved` or `limited` source, ALL IN ONE
MESSAGE so they run concurrently. Each prompt contains:
1. The source entry from `sources.json`, including its consent note.
2. `depth: shallow`.
3. The rubric path `${CLAUDE_PLUGIN_ROOT}/skills/enigma-core/references/`.
4. The entity ids already in the map (empty on a first run) so ids are reused.
5. "Reply with exactly one JSON object matching the scout output contract."

Collect the results. A scout that fails or returns non-JSON gets ONE retry;
if it fails again, mark its source `degraded` in `sources.json` with the
error and continue with the rest.

Then merge and persist, in this order:
1. Merge candidates: dedup ids, union relationships, normalize topic tags to
   lowercase, fold confirmed aliases onto the entities they name.
2. Write the merged candidates to `.enigma/state/candidates.json` and run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/build-map.mjs --dir . --candidates .enigma/state/candidates.json`
   Fix any ids or relationship endpoints it names, then re-run.
3. Write the collected evidence to `.enigma/state/evidence-batch.json` and run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/ingest-evidence.mjs --dir . --items .enigma/state/evidence-batch.json`
   It rejects the whole batch on any error — fix the named items and re-run.
4. `node ${CLAUDE_PLUGIN_ROOT}/scripts/build-index.mjs --dir .`
   Report any alias-collision warnings in the next question round.
5. `node ${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs --dir . --label shallow --scanned <ids> --source-state '<json>'`
   where the source state carries each source's `depth`, `read`, `known`,
   `cursor`, and `complete`.
6. `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .` — confirm clean.

## Phase 4 — Checkpoint round 1 (ONE batched question)

Present what you found and ask, in one round:
- Is the structure right (teams, projects, ownership)? Correct anything wrong.
- Confirm the aliases you observed, and resolve any alias collision
  `build-index.mjs` warned about.
- The UNKNOWNs your scouts collected — which can the user answer now?
- The proposed deep-pass queue: every project and team with an approved
  source behind it, ordered by evidence count ascending so the thinnest
  areas go first. Let the user add, drop, or reorder.

Store answers as FACT envelopes with `source: {"type": "user"}` appended to
`.enigma/memory/facts.jsonl` with an `entity` field, then record each with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/update-ledger.mjs --dir . --entry '{"type":"fact.added","entity":"<id>","source":"user"}'`
Alias confirmations go on the entity through `build-map.mjs`, not by hand.
Write the agreed queue with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs --dir . --label queue --queue '<json>'`

## Phase 5 — Deep passes (batched, resumable)

Repeat until the queue is empty or the user stops:

1. Take up to 5 `pending` queue entries as one batch. Mark them
   `in_progress` via `checkpoint.mjs --queue`.
2. For each, run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.mjs --dir . --entity <area>`
   and dispatch ONE `scout` per entry, ALL IN ONE MESSAGE, with `depth: deep`,
   the area's bundle, the source entry, and the cap (50 items unless the user
   raised it).
3. Merge and persist exactly as in Phase 3 steps 1-6, labelling the
   checkpoint `deep`.
4. Mark each entry `done`, or `failed` with the error.
5. If that batch produced UNKNOWNs or INFERENCEs worth confirming, ask ONE
   batched round now and store the answers as in Phase 4. Skip the round when
   there is nothing material to ask.

The user may stop after any batch. The queue persists, so a later
`/enigma:init` resumes exactly here.

## Phase 6 — Report

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/coverage.mjs --dir .`
2. Write `.enigma/reports/company-overview.md`: company facts, teams with
   their inferred process and the basis for it, projects and ownership, key
   components, relationship count, a coverage table (per source: consent,
   depth, read/known, last scanned), and an **Unknowns** section.
3. Present the same summary in chat, ending with the explicit UNKNOWN list
   and what remains in the queue.
