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

## Conversational use (no slash command)

For a management question with `.enigma/` present:
1. Identify the entity (`node ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.mjs
   --dir . --entity <id>`; on unknown id, offer the `known` list).
2. Answer from the bundle, citing provenance status. For a full status
   assessment, tell the user `/enigma:status <id>` runs the complete
   oracle pipeline, and offer to run it.

## Reference files

- `references/memory-schema.md` — all `.enigma/` file shapes + envelope
- `references/gates.md` — gate checklist
- `references/discovery.md` — per-source scan recipes and caps
- `references/engineering-management.md` — EM rubric (People/Delivery/Risk lenses)
- `references/methodologies.md` — process classification + delivery health
