---
name: enigma-core
description: Organizational-context engine for management questions. Use this whenever the user asks management-flavored questions — project or team status, who owns a service or component, delivery risks, dependencies between teams, roadmap or priority questions — even if they don't mention Enigma. Also use it whenever a `.enigma/` directory exists in the workspace, or before running any /enigma command logic.
---

# Enigma core

Enigma answers management questions from a persistent organizational map in
`./.enigma/` instead of guessing. If `.enigma/` does not exist, say so and
suggest `/enigma:init`; do not fabricate organizational facts.

## Invariants (every Enigma workflow obeys these)

1. **Validate first.** Start every workflow with
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-state.mjs --dir .`
   On errors: name the broken file and offer ledger-based reconstruction;
   never silently proceed on corrupt state.
2. **Provenance envelope** on every stored fact/relationship — schema in
   `references/memory-schema.md`. FACT / INFERENCE / ASSUMPTION / UNKNOWN
   are distinct; never launder inference into fact.
3. **Read-only default.** Slice 1 never writes to external systems. The only
   writes are `.enigma/` and `reports/`. Anything else needs the Action Gate
   (`references/gates.md`) — which no slice-1 workflow passes.
4. **Ledger rule.** Map changes go through `scripts/build-map.mjs` /
   `scripts/update-ledger.mjs`. Never hand-edit `map/*.json` or append to
   `changes.jsonl` directly.
5. **Gates are reported, not performed.** Run the checklist in
   `references/gates.md`; a weak gate appears in the output as a warning.
6. **Ask only necessary questions**, batched in one round — after exhausting
   map, memory, and live read-only sources.
7. **Division of labor.** Scripts (in `${CLAUDE_PLUGIN_ROOT}/scripts/`) do
   deterministic work: normalization, ledger, validation, context bundles,
   diffing, checkpoints. You do interpretation, classification, judgment.
8. **Resolve before load.** Never fail on an unrecognized name. Run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/query.mjs --dir . --q "<text>"` first;
   it resolves ids, aliases, and keywords. Only after it returns nothing do
   you say the map has no coverage — and then offer a targeted deep pass.
9. **Evidence is quoted, never laundered.** An excerpt is verbatim source
   text. Cite evidence by title and source ref. A paraphrase is INFERENCE.
10. **Indexes are derived.** Rebuild with `build-index.mjs`; never hand-edit
    `index/entities.json`, `aliases.json`, `keywords.json`, or `topics.json`.
11. **Consent precedes reading.** No source is read until `sources.json`
    records its consent. An `excluded` source is never touched.

## Conversational use (no slash command)

For a management question with `.enigma/` present:
1. Resolve the subject:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/query.mjs --dir . --q "<the user's words>"`
2. Load the entity:
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.mjs --dir . --entity <resolved id>`
3. Answer from the bundle, citing each finding's provenance status and the
   evidence title plus source ref it came from. Where coverage is shallow,
   say so in the answer.
4. If nothing resolves, say the map has no coverage there and offer
   `/enigma:init --deep <area>`. Never fill the gap with a guess.
5. For a full status assessment, tell the user `/enigma:status <id>` runs the
   complete oracle pipeline, and offer to run it.

## Reference files

- `references/memory-schema.md` — all `.enigma/` file shapes + envelope
- `references/gates.md` — gate checklist
- `references/discovery.md` — per-source scan recipes and caps
- `references/engineering-management.md` — EM rubric (People/Delivery/Risk lenses)
- `references/methodologies.md` — process classification + delivery health
- Scripts: `build-map`, `load-context`, `update-ledger`, `diff-state`,
  `validate-state`, `checkpoint`, `ingest-evidence`, `build-index`, `query`,
  `coverage` — all in `${CLAUDE_PLUGIN_ROOT}/scripts/`
