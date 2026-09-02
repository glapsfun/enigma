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
| `index/sources.json` | `{sources: [{id, type: "mcp\|cli\|local\|url", status: "available\|degraded\|unavailable", consent: "approved\|excluded\|limited", consent_note?, tools?: [], yields?: [], notes?}]}` |
| `evidence/<source-type>/<id>.json` | one summarized source item — see below |
| `index/entities.json` | `{"<id>": {kind, name, file, aliases[], evidence_count}}` (derived) |
| `index/aliases.json` | `{"<lowercase alias>": "<entity id>"}` (derived) |
| `index/keywords.json` | `{"<term>": [{ref, weight}]}` (derived) |
| `index/topics.json` | `{"<topic>": {entities: [], evidence: []}}` (derived) |
| `state/discovery.json` | `{sources: {<id>: {last_scanned, depth: "none\|shallow\|deep", cursor, read, known, complete}}, queue: [{area, source, depth, status: "pending\|in_progress\|done\|failed"}]}` |
| `state/checkpoints.json` | `[{time, label, note}]` |
| `reports/*.md` | generated markdown outputs |

## Evidence item

Summaries and quoted excerpts only — full source text is never stored.

```json
{
  "id": "confluence-a1b2c3d4",
  "source": { "type": "confluence", "ref": "12345", "url": "https://..." },
  "title": "Data Platform architecture",
  "kind": "page | ticket | epic | pr | readme | channel | webpage | cli-output",
  "summary": "Agent-written, 2-5 sentences.",
  "excerpts": [ { "quote": "Verbatim text from the source.", "why": "states June target" } ],
  "entities": ["data-platform", "data-eng"],
  "topics": ["architecture", "roadmap"],
  "fetched_at": "ISO-8601",
  "updated_at_source": "ISO-8601 or null",
  "content_hash": "sha256 hex of the source text as read"
}
```

- `id` is `<source.type>-<first 8 hex of content_hash>`, so unchanged content
  re-ingests as a no-op.
- `source.type` is one of `jira|confluence|slack|github|repo|docs|user|cli|web`.
- `excerpts[].quote` is verbatim source text. Never paraphrase a quote.
- `entities` must name at least one existing map id. Evidence that links to
  nothing in the map is rejected — add the entity first.
- Slack message bodies are never stored unless the consent note for that
  source allows them.
- `ingest-evidence.mjs` is the sole writer; it appends the `evidence.added`
  ledger entry before writing the file.

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
4. Index files are derived. Rebuild them with `build-index.mjs`; never
   hand-edit or patch them. One `index.rebuilt` ledger entry covers a whole
   rebuild.
5. No source is read before its `consent` value is recorded in
   `index/sources.json`. An `excluded` source is never touched.
6. Entities may carry `aliases: []`. `build-map.mjs` merges aliases across
   runs rather than overwriting them.
