# Enigma — Claude Code Plugin Design (Slice 1)

**Date:** 2026-09-02
**Status:** Approved design, pre-implementation
**Scope:** First sub-project of the Enigma management copilot: `/enigma:init` + `/enigma:status`, the org-memory foundation, oracle subagents, and deterministic `.mjs` scripts.

## 1. What Enigma is

Enigma is a Claude Code **plugin** — a management copilot for people who run software projects, products, and engineering teams (PM, Product Manager, EM, Tech Lead, Head of Engineering). Its core idea: **understand how the company works before helping the manager decide.** It builds persistent organizational context from sources the user's harness already exposes (MCP servers, local repos, docs), never bypasses existing permissions, and defaults to read-only discovery.

### Decomposition

The full vision (spec by the user) covers many subsystems. This design covers **Slice 1** only:

| Slice | Contents | Status |
|---|---|---|
| **1 (this doc)** | `enigma init`, org memory (`.enigma/`), capability registry, company map, ledger, provenance, `/enigma:status` workflow end-to-end, 5 oracles + Judge as subagents, core skill, 6 `.mjs` scripts | Designed here |
| 2+ | Remaining workflows (create epic, roadmap, risk assessment, prioritize backlog, 1:1 prep, …), Action Gate + writes via MCP, Process Oracle, `observations.jsonl`, richer indexes/reports, scheduled refresh, dashboards | Deferred |

Each later slice gets its own spec → plan → implementation cycle.

### Decisions made during brainstorming

- Form factor: **plugin** (commands + skills + agents + scripts), not a standalone skill. (Approach A; skill-only and MCP-server approaches rejected for slice 1 — MCP server remains a candidate future refactor once the memory format stabilizes.)
- First slice: **init + one workflow**; the workflow is **project status** (read-only, exercises the full judgment pipeline without write risk).
- Memory home: **`./.enigma/` in the working directory.** The manager runs Enigma from a dedicated workspace dir (e.g. `~/dev/acme-management`); one workspace = one company. Memory is inspectable and git-versionable.
- Oracles: **parallel subagents** (user decision), one per lens, plus a Judge subagent.

## 2. Plugin structure

```
enigma/  (repo root = plugin root)
├── .claude-plugin/plugin.json
├── commands/
│   ├── init.md            → /enigma:init
│   └── status.md          → /enigma:status
├── skills/
│   └── enigma-core/
│       ├── SKILL.md
│       └── references/
│           ├── memory-schema.md        # full JSON contracts
│           ├── gates.md                # gate checklists
│           ├── discovery.md            # per-source scan recipes + caps
│           ├── engineering-management.md  # condensed EM rubric (from research doc)
│           └── methodologies.md        # condensed methods rubric (from research doc)
├── agents/
│   ├── product-oracle.md
│   ├── engineering-oracle.md
│   ├── delivery-oracle.md
│   ├── people-oracle.md
│   ├── risk-oracle.md
│   └── judge.md
└── scripts/
    ├── build-map.mjs
    ├── load-context.mjs
    ├── update-ledger.mjs
    ├── diff-state.mjs
    ├── validate-state.mjs
    └── checkpoint.mjs
```

## 3. Persistent memory — `.enigma/`

Created in the user's working directory by `/enigma:init`:

```
.enigma/
├── map/
│   ├── company.json         # name, domains, top-level facts
│   ├── teams.json           # id, name, members[], process classification
│   ├── people.json          # id, name, role, team, source refs
│   ├── projects.json        # id, name, status, team, tracker refs
│   ├── components.json      # services / repos / systems
│   └── relationships.json   # first-class edges: {from, type, to, provenance}
├── memory/
│   ├── facts.jsonl          # atomic facts with provenance + epistemic status
│   └── decisions.jsonl      # recorded management decisions
├── ledger/
│   └── changes.jsonl        # append-only history; never rewritten
├── index/
│   └── sources.json         # capability registry (incl. degraded/failed sources)
├── state/
│   ├── discovery.json       # per-source scan cursors + timestamps
│   └── checkpoints.json
└── reports/                 # generated markdown (status reports, overview)
```

### Contract 1 — Provenance envelope

Every fact, entity field, and relationship carries:

```json
{
  "value": "…",
  "status": "FACT | INFERENCE | ASSUMPTION | UNKNOWN",
  "source": { "type": "jira|confluence|slack|github|repo|docs|user", "ref": "…" },
  "confidence": 0.0,
  "observed_at": "ISO-8601"
}
```

Rules:
- Statements found verbatim in a source → `FACT`.
- Conclusions drawn from evidence (e.g. process classification from board activity) → `INFERENCE`.
- Gap-filling defaults → `ASSUMPTION`.
- Known-missing answers are stored as explicit `UNKNOWN` entries, not omitted.
- User-provided answers → `FACT` with `source.type: "user"`.
- Oracles and the Judge must weight statuses differently; inference is never presented as fact.

### Contract 2 — Ledger rule

`map/` files are mutated only *through* the ledger: any script writing to `map/` first appends the diff to `ledger/changes.jsonl` (append-only, never rewritten). `validate-state.mjs` verifies map ↔ ledger consistency. `update-ledger.mjs` is the **only** writer of `changes.jsonl`.

Ledger entry shape:

```json
{ "time": "ISO-8601", "type": "project.updated", "entity": "data-platform",
  "source": "jira", "change": { "status": ["planning", "active"] } }
```

### Deferred (recorded, not built)

`memory/observations.jsonl`, `index/entities.json`, `index/relationships.json`, full `reports/company-overview.md` beyond a minimal version. Nothing in slice 1 reads them.

## 4. `/enigma:init`

Optional args: `--company <url> --docs <path> --reference <path> --full`.

**Phase 1 — Harness discovery (agent-led).** The agent inventories its own environment: connected MCP servers/tools, reachable local repos and docs, user-supplied paths. Written to `index/sources.json` as the capability registry. Failed/unavailable sources are recorded as degraded — later runs distinguish "no Slack" from "Slack was down." This phase cannot be a script: only the agent knows its tool surface.

**Phase 2 — Company discovery (agent-led, read-only, budgeted).** Bounded scan per available source (recipes + caps in `references/discovery.md`): Jira → projects/boards/active epics; Confluence → spaces + recently-updated pages; GitHub → repos + CODEOWNERS; local docs → structure + key files. Everything becomes candidate entities with provenance envelopes; thin evidence yields `INFERENCE`/`ASSUMPTION`, not fabricated facts. Strictly read-only; caps (top-N per source) keep first init fast.

**Phase 3 — Build the map (script-assisted).** Agent normalizes candidates; `build-map.mjs` dedups by id, checks referential integrity (every relationship endpoint exists), writes through the ledger. Team process classification (Scrum/Kanban/ad-hoc/…) is inferred from evidence and marked `INFERENCE` unless documentation states it. No methodology is forced.

**Phase 4 — Checkpoint + report.** `checkpoint.mjs` records discovery state. Agent writes minimal `reports/company-overview.md` (teams, projects, ownership, unknowns) and presents a summary **ending with the explicit UNKNOWN list**, inviting the user to fill gaps (answers stored as `FACT`, source `user`).

**Incremental re-runs:** if `state/discovery.json` exists, `diff-state.mjs` determines which sources changed; only those are refreshed; changes append to the ledger. `--full` forces a rescan.

**Safety posture:** read-only tools only; never enumerate resources the harness doesn't already expose; the only writes are inside `.enigma/`.

## 5. `/enigma:status <project-or-team>`

No argument → ask which, offering projects from the map.

1. **Load context.** `load-context.mjs <entity-id>` emits a compact JSON bundle: the entity, its team, components, relationships, recent ledger entries, related facts/decisions.
2. **Discover missing data (read-only).** Agent compares the bundle to what a status report needs (recent tickets, PRs, incidents, blockers) and fetches only the gaps from live sources in `sources.json`. New evidence gets provenance envelopes and is appended to `facts.jsonl`.
3. **Ask only necessary questions.** Material gaps that no source can answer go to the user — batched into one round, not drip-fed.
4. **Oracle fan-out.** Five oracle subagents launched **in a single message** (parallel). Each receives the same evidence bundle, applies only its lens, and returns a structured verdict (§6).
5. **Judge.** Sixth subagent combines the five verdicts + the bundle into the final assessment (§6).
6. **Gates + present.** Context/Evidence/Delivery/Risk gates run as a checklist; failures are *reported*, never silently passed ("Evidence Gate: weak — no delivery data newer than 3 weeks"). Output: status report in chat and `reports/status-<project>-<date>.md` — summary, health by lens, risks, decisions needed, evidence with provenance, unknowns.
7. **Record.** Run + conclusions appended to the ledger; notable new facts to `facts.jsonl`.

No Action Gate in this workflow — read-only by construction.

## 6. Oracles and Judge (subagents)

Shared design rules for `agents/*-oracle.md`:

- **Tools:** `Read, Grep, Glob` only. Oracles judge the evidence bundle they are handed; they do not fetch more data (keeps them cheap, parallel-safe, and prevents five agents hammering Jira).
- **Lens definition:** what the oracle evaluates *and what it must ignore*, so verdicts stay independent rather than five copies of one general take.
  - Product: user value, business impact, prioritization, product risk.
  - Engineering: architecture, complexity, technical dependencies, reliability, maintainability.
  - Delivery: scope, timeline, capacity, dependencies, blockers, WIP/aging-work signals.
  - People: ownership, team load, bus factor, communication, org dependencies.
  - Risk: delivery/technical/organizational risk, unknowns.
- **Epistemic rules:** weight `FACT` > `INFERENCE` > `ASSUMPTION`; never launder an assumption into a finding unflagged; list evidence gaps explicitly instead of filling them.
- **Shared prohibition:** never use velocity, story points, ticket/PR/commit counts, or LOC as individual performance measures.
- **Output contract** (final message of the agent):

```json
{ "lens": "delivery", "findings": [ … ], "risks": [ … ],
  "confidence": "high|medium|low", "evidence_gaps": [ … ] }
```

**Judge** (`agents/judge.md`): receives all verdicts + bundle. Scores the assessment on the judgment model (impact, confidence, effort, risk, urgency, dependencies, reversibility). Surfaces oracle disagreements explicitly and resolves them with stated reasoning. Output separates **Recommendation / Evidence / Unknowns** and downgrades confidence when inputs were `INFERENCE`-heavy. If an oracle failed, the Judge proceeds with the remaining verdicts and flags the missing lens; it never fabricates the absent view.

**Knowledge placement:** the user's two research documents are condensed into rubric form in `references/engineering-management.md` and `references/methodologies.md` (source links preserved). Oracles point at the relevant reference file; content is not duplicated per agent.

## 7. Core skill — `skills/enigma-core`

- **Triggers** on management-flavored asks ("what's the status of…", "who owns…", "risks on X") so Enigma also works conversationally. With `.enigma/` present it loads context like `/enigma:status`; without it, it suggests `/enigma:init`.
- **Body invariants** (every workflow obeys): provenance envelope, epistemic statuses, read-only default, ledger rule, gate checklist, ask-only-necessary-questions.
- **references/** as listed in §2.

## 8. Scripts

Node ≥ 18, **zero npm dependencies** (stdlib only — no install step).

| Script | Job |
|---|---|
| `build-map.mjs` | Normalize candidate entities → map files; dedup by id; referential integrity |
| `load-context.mjs` | Entity id → one JSON context bundle (map/memory/ledger slice) |
| `update-ledger.mjs` | Append ledger entries; sole writer of `changes.jsonl` |
| `diff-state.mjs` | Compare discovery cursors → which sources need refresh |
| `validate-state.mjs` | Schema-check all `.enigma/` files; verify map ↔ ledger consistency |
| `checkpoint.mjs` | Record discovery/session checkpoints |

Division of labor: scripts never interpret, classify, or judge; the agent never hand-edits JSON files a script owns. LLM handles interpretation, reasoning, classification, planning, judgment; scripts handle discovery persistence, normalization, diffing, validation, state updates.

## 9. Failure handling

- **Source fails mid-discovery** → marked degraded in `sources.json`; discovery continues; report notes the gap. Never a hard abort.
- **Corrupt/hand-edited state** → `validate-state.mjs` runs at the start of every command; on failure it names the broken file and offers ledger-based reconstruction; never silently proceeds.
- **Oracle subagent fails** → Judge proceeds with remaining verdicts, flags the missing lens.

## 10. Safety invariants (all slices)

- Respect existing permissions; only use tools/sources the harness already exposes.
- Read-only discovery by default; slice 1 performs **no writes to any external system**.
- Writes (future slices) require an explicit Action Gate with user confirmation of action + scope.
- Never send messages or create tickets without explicit user intent.
- Keep provenance for important conclusions; never silently rewrite history (append-only ledger).
- Avoid surfacing sensitive information beyond what the task requires.

## 11. Testing plan

- Fixture workspace: a synthetic `.enigma/` + local docs tree for a fake company.
- Eval prompts (per skill-creator loop, with baseline comparisons):
  1. `/enigma:init` against the local-docs fixture → correct map, provenance statuses, ledger entries, UNKNOWN list.
  2. `/enigma:status` on a healthy fixture project → full pipeline, parallel oracle fan-out, gated report.
  3. `/enigma:status` on a project with a planted contradiction (roadmap says June; tickets say September) → oracles catch it, Judge surfaces the disagreement explicitly.
- Structural validation via `plugin-dev:plugin-validator`.
- Script-level checks: `validate-state.mjs` against both valid and deliberately corrupted fixtures.

## 12. Out of scope for slice 1 (explicit)

Write actions to external systems and the Action Gate; create-epic/roadmap/backlog/1:1/risk workflows; Process Oracle; multi-company support; `~/.enigma` global memory; scheduled refresh; dashboards; Codex/Gemini support; multi-agent orchestration beyond the oracle fan-out.
