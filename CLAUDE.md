# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Enigma is a **Claude Code plugin** (repo root = plugin root, manifest in `.claude-plugin/plugin.json`). It is a management copilot: `/enigma:init` discovers the company from sources the harness already exposes and writes a persistent org map to `./.enigma/` in the *user's workspace* (not this repo); `/enigma:status <id>` runs an evidence-gated status pipeline over that map. Slice 1 is the current scope. The design spec and task plan live locally under `docs/` but are **not tracked in git** (`docs/` is gitignored); if present, read `docs/superpowers/specs/*-enigma-plugin-design.md` for the full design. External writes, the Action Gate, and workflows beyond init/status are intentionally deferred to later slices.

## Commands

No `package.json`, no install step. Node ≥ 18, **stdlib only — never add npm dependencies**.

```bash
node --test 'scripts/test/*.test.mjs'         # all tests (or bare `node --test`)
node --test scripts/test/smoke.test.mjs        # one file
```

Note: `node --test scripts/test/` (a bare directory) fails on Node ≥ 22 — use the glob form.

Run scripts against a workspace with `--dir <workspace>` (defaults to cwd); all print JSON:

```bash
node scripts/validate-state.mjs --dir .                 # exit 1 on errors
node scripts/build-map.mjs --dir . --candidates .enigma/state/candidates.json
node scripts/load-context.mjs --dir . --entity data-platform
node scripts/update-ledger.mjs --dir . --entry '{"type":"...","entity":"<id>",...}'
node scripts/checkpoint.mjs --dir . --label init --scanned docs,jira
node scripts/diff-state.mjs --dir . [--max-age-hours 24]
```

Run tests before every commit. Commit messages: conventional style (`feat:`, `fix:`, `test:`), no `Co-Authored-By` or "Generated with" trailers.

## Architecture

**Three layers, strict division of labor:**

- `commands/*.md` → `/enigma:init`, `/enigma:status`. Multi-phase prompts that orchestrate scripts and agents. They reference scripts as `node ${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs`.
- `skills/enigma-core/` → the invariants every workflow obeys (`SKILL.md`) plus rubrics in `references/` (memory schema, gates, discovery recipes/caps, EM and methodology rubrics). Agents point at these reference files; rubric content is not duplicated into agents.
- `agents/` → five `*-oracle.md` (product, engineering, delivery, people, risk) and `judge.md`. Oracles get `Read, Grep, Glob` only, judge a handed-in evidence bundle through one lens, never fetch data, and reply with a fixed JSON verdict. The status command dispatches all five **in a single message** (parallel), then the Judge combines verdicts; a failed oracle is flagged as a missing lens, never fabricated.
- `scripts/*.mjs` → deterministic work only (normalize, validate, ledger, context bundle, diff, checkpoint). Scripts never interpret/classify/judge; the LLM never hand-edits JSON that a script owns.

**Script conventions:** each script exports its function (e.g. `buildMap`, `validateState`) and has a CLI entry guarded by `isMain(import.meta.url)`. Shared primitives (`readJson`/`writeJson`/`appendJsonl`/`readJsonl`/`envelopeErrors`/`parseArgs`) live in `scripts/lib/enigma.mjs`. Tests import the functions directly and build a throwaway `.enigma/` under `os.tmpdir()`; `scripts/test/smoke.test.mjs` runs the whole deterministic pipeline end to end.

**Two contracts that everything depends on:**

1. **Provenance envelope** — every fact, relationship, and inferred entity field is `{value, status: FACT|INFERENCE|ASSUMPTION|UNKNOWN, source: {type, ref}, confidence: 0..1, observed_at}`. `envelopeErrors()` is the single validator. Inference must never be presented as fact; unknowns are stored explicitly, not dropped.
2. **Ledger rule** — `.enigma/ledger/changes.jsonl` is append-only and `appendLedger` in `update-ledger.mjs` is its *only* writer. `build-map.mjs` appends a ledger entry per entity before writing `map/*.json`; `validate-state.mjs` fails any map entity without a ledger entry ("map was mutated outside the ledger"). Every command starts with `validate-state.mjs`.

**`.enigma/` layout** (created in the user's workspace by init): `map/{company,teams,people,projects,components,relationships}.json`, `memory/{facts,decisions}.jsonl`, `ledger/changes.jsonl`, `index/sources.json` (capability registry incl. `degraded` sources), `state/{discovery,checkpoints}.json`, `reports/*.md`. Full shapes in `skills/enigma-core/references/memory-schema.md`.

**Safety posture:** slice 1 is read-only toward every external system; the only writes are inside `.enigma/`. Gates (`references/gates.md`) are *reported* as weak in output, never silently passed.

## Testing fixtures and evals

`fixtures/acme/docs/` is a synthetic company with a planted contradiction (roadmap says June, delivery log/tickets say September, plus an unowned security review). `evals/evals.json` holds three eval prompts that exercise init, status, and contradiction detection against it. Structural plugin checks: `plugin-dev:plugin-validator`.

## Repo quirks

- `.gitignore` ignores all of `docs/` — design specs and plans are local working files, never committed. Don't reference them as if they exist in a fresh clone.
