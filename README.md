# Enigma

[![ci](https://github.com/glapsfun/enigma/actions/workflows/ci.yml/badge.svg)](https://github.com/glapsfun/enigma/actions/workflows/ci.yml)

A Claude Code plugin — a management copilot for people who run software
projects, products, and engineering teams.

Enigma understands how the company works before helping the manager decide:
`/enigma:init` builds a persistent organizational map (`.enigma/`) from
sources your harness already exposes (Jira, Confluence, Slack, GitHub, local
docs — read-only, never bypassing permissions), and `/enigma:status <project>`
produces an evidence-gated status assessment via independent oracle agents.

## Install

```
/plugin marketplace add glapsfun/enigma
/plugin install enigma
```

## Quick start

```
/enigma:init                       # discover the company, with a consent round first
/enigma:init --docs ./docs         # scope discovery to a path
/enigma:status data-platform       # status for a project or team id
/enigma:status DP                  # aliases resolve too
```

`init` asks before it reads anything, and it is resumable — stop a deep pass
partway and re-run to pick up where it left off.

`status` dispatches five oracles (product, engineering, delivery, people, risk)
in parallel over one evidence bundle, then a judge combines their verdicts. An
oracle that fails is reported as a missing lens, never fabricated.

## What it writes

Everything lands in `.enigma/` in your workspace. Nothing else is written, and
nothing outside is modified.

```
map/          company, teams, people, projects, components, relationships
memory/       facts.jsonl, decisions.jsonl
evidence/     summarized source excerpts, content-addressed
index/        derived entity/alias/keyword indexes, source capability registry
ledger/       changes.jsonl -- append-only
state/        discovery cursors, resumable queue, checkpoints
reports/      generated status reports
```

## Three guarantees

**Read-only.** Enigma never writes to Jira, Slack, GitHub, or any other
external system. The only writes are inside `.enigma/`.

**Provenance on everything.** Every fact, relationship, and inferred field
carries `{value, status, source, confidence, observed_at}`, where `status` is
one of `FACT`, `INFERENCE`, `ASSUMPTION`, `UNKNOWN`. Inference is never
presented as fact, and unknowns are stored explicitly rather than dropped.

**An append-only ledger.** Every map change is recorded in
`ledger/changes.jsonl` before it is applied. A map entity with no ledger entry
fails validation — the map cannot be mutated behind the ledger's back.

Management gates are *reported* as weak in the output, never silently passed.

## Development

Node ≥ 22, stdlib only, no install step.

```bash
node --test 'scripts/test/*.test.mjs'
node scripts/dev/lint-repo.mjs --dir .
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the optional
pre-commit hooks, and [CLAUDE.md](CLAUDE.md) for the architecture.

## License

MIT — see [LICENSE](LICENSE).
