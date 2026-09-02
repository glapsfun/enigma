# Enigma memory schema (`.enigma/`)

All paths are relative to the user's workspace directory.

## Provenance envelope (used everywhere)

```json
{
  "value": "Platform team owns Airflow",
  "status": "FACT",
  "source": { "type": "confluence", "ref": "12345" },
  "confidence": 0.94,
  "observed_at": "2026-09-02T10:00:00Z"
}
```

- `status`: `FACT` (stated verbatim in a source) | `INFERENCE` (concluded from
  evidence) | `ASSUMPTION` (gap-filling default) | `UNKNOWN` (question with no
  answer yet — stored, not omitted).
- `source.type`: `jira|confluence|slack|github|repo|docs|user`. User answers
  are `FACT` with `source.type: "user"`.
- Never present INFERENCE or ASSUMPTION as fact downstream.

## Files

| File | Shape |
|---|---|
| `map/company.json` | `{name, domains?, ...}` single object |
| `map/teams.json` | `[{id, name, process?: envelope, ...}]` |
| `map/people.json` | `[{id, name, role, team, ...}]` |
| `map/projects.json` | `[{id, name, status, team, tracker?: {type, ref}, ...}]` |
| `map/components.json` | `[{id, name, kind?: "service|repo|system", ...}]` |
| `map/relationships.json` | `[{from, type, to, provenance: envelope}]` |
| `memory/facts.jsonl` | one envelope per line, plus `entity: <id>` linking it to the map |
| `memory/decisions.jsonl` | `{entity, decision, rationale, ...envelope}` per line |
| `ledger/changes.jsonl` | `{time, type, entity, source, change}` — append-only |
| `index/sources.json` | `{sources: [{id, status: "available|degraded|unavailable", tools?: [...], notes?}]}` |
| `state/discovery.json` | `{sources: {<id>: {last_scanned}}}` |
| `state/checkpoints.json` | `[{time, label, note}]` |
| `reports/*.md` | generated markdown outputs |

## Relationship types (initial vocabulary)

`owns`, `manages`, `member_of`, `implements`, `depends_on`, `belongs_to`,
`stakeholder_of`. Add new types when evidence demands — record them in a
ledger entry.

## Rules

1. Map files are mutated only by `scripts/build-map.mjs`, which writes the
   ledger first. Never hand-edit files a script owns.
2. `ledger/changes.jsonl` is append-only. Never rewrite history.
3. Ids are kebab-case slugs, stable across runs (`data-platform`, not
   `Data Platform (Q3)`).
