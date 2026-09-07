# Contributing to Enigma

Enigma is a Claude Code plugin. The repo root is the plugin root; the manifest
is `.claude-plugin/plugin.json`.

## Prerequisites

Node **≥ 22**. That is the whole toolchain.

There is no `package.json` and no install step, and **npm dependencies are never
added** — every script is Node stdlib only. `scripts/dev/lint-repo.mjs` enforces
this: a bare import specifier, a stray `package.json`, or a committed lockfile
fails the build.

## Running things

```bash
node --test 'scripts/test/*.test.mjs'     # the suite -- quote the glob
node --test scripts/test/smoke.test.mjs   # one file
node scripts/dev/lint-repo.mjs --dir .    # structural lint, exit 1 on errors
claude plugin validate .                  # manifest and component wiring
```

`node --test scripts/test/` (a bare directory) fails on Node ≥ 22, and the glob
form needs Node ≥ 21 — hence the floor of 22. CI runs 22.x and 24.x.

Run scripts against a workspace with `--dir <workspace>` (defaults to cwd); all
of them print JSON and exit non-zero on errors.

## Optional git hooks

```bash
pre-commit install
```

This mirrors CI locally: the whitespace/JSON/YAML hygiene hooks, the structural
linter, and the full suite. It needs the Python [`pre-commit`][pc] tool.

The hooks are **optional**. CI is the real gate, and `git commit --no-verify`
stays a working escape hatch — nothing in CI depends on `pre-commit` being
installed.

[pc]: https://pre-commit.com

## Conventions

**Layers.** `commands/*.md` orchestrate, `agents/*.md` judge, `skills/` hold
rubrics, `scripts/*.mjs` do deterministic work. Scripts never interpret,
classify, or judge; the LLM never hand-edits JSON a script owns. See
[CLAUDE.md](CLAUDE.md) for the full architecture.

**Scripts.** Every `scripts/*.mjs` exports its function *and* has a CLI entry
guarded by `isMain(import.meta.url)`, so tests can import it directly. Shared
primitives live in `scripts/lib/enigma.mjs`. Every script needs at least one
test that imports it. `scripts/dev/` is developer tooling, not pipeline.

**Provenance.** Every fact, relationship, and inferred field carries the
envelope `{value, status, source, confidence, observed_at}`, validated by
`envelopeErrors()`. Inference is never presented as fact; unknowns are stored
explicitly, not dropped.

**Ledger.** `.enigma/ledger/changes.jsonl` is append-only and `appendLedger` is
its only writer. `validate-state.mjs` fails any map entity without a ledger
entry.

**Agents.** An agent's frontmatter `name` must match its filename. Oracles and
the judge get `Read, Grep, Glob` **only** — they reason over a handed-in bundle
and never fetch data.

**Tests first.** Write the failing test, then the code. Run the suite before
every commit.

## Commits

Conventional style — `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`.

No `Co-Authored-By` trailers and no "Generated with" trailers.
