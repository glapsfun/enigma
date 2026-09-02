# Discovery recipes (read-only, budgeted)

Discovery uses ONLY tools already exposed by the harness. Never enumerate
resources the user cannot access; never authenticate to anything new. Every
extracted item gets a provenance envelope. Where evidence is thin, record
INFERENCE or ASSUMPTION — never fabricate a FACT.

Consent rule: no source is read until `index/sources.json` records its
`consent` value. An `excluded` source is never touched.

Budget rule: the shallow pass maps structure and must finish in minutes.
Deep passes are per area, resumable, and capped at 50 items per area by
default; the user may raise a cap in a checkpoint round.

| Source | Shallow (structure) | Deep (per area, <=50 items) |
|---|---|---|
| Jira / tracker MCP | visible projects, boards, project keys | active epics, recent tickets, blockers, stated dates for the area |
| Confluence / wiki MCP | space list, page titles | 20 most recent pages for the area, with excerpts |
| GitHub / GitLab MCP | repo list, CODEOWNERS | recent PRs, release tags, README/ARCHITECTURE for the area's repos |
| Slack MCP | channel names + topics only | channel topics and pinned items only; message bodies ONLY with an explicit consent note |
| Local repos & docs | directory tree, README/ARCHITECTURE/OWNERS | full read of the area's docs, `git log --since`, `git shortlog -sn --since` |
| Company URL | the page itself | about/team/product pages |

Failure handling: a source that errors mid-scan is marked `degraded` in
`index/sources.json` with a note; continue with remaining sources; the final
report names the gap. Never hard-abort discovery for one bad source.

Process classification per team: infer Scrum/Kanban/Scrumban/waterfall/
ad-hoc/release-driven/continuous-delivery from evidence (board type, sprint
cadence, WIP patterns, release tags). Always status INFERENCE unless a
document states the process. Do not force one methodology onto all teams.

## CLI recipes (read-only, consent required)

Use only when the CLI is present and its source entry is `approved` or
`limited`. Read-only verbs only; never a mutating subcommand.

| CLI | Shallow | Deep |
|---|---|---|
| `gh` | `repo list`, `api repos/:owner/:repo/contents/CODEOWNERS` | `pr list --limit 50`, `issue list --limit 50` |
| `jira` (any flavour) | project list, board list | issue search by JQL scoped to the area |
| `git` | `ls-files`, top-level structure | `log --since`, `shortlog -sn --since` |
| `kubectl` | `get namespaces` | `get deployments -A` for component inventory |
| `glab` | mirrors `gh` | mirrors `gh` |

Never use `git shortlog` or PR/commit counts as an individual performance
measure — they describe activity shape only.

## Scout output contract

Every scout returns exactly one JSON object as its final message:

```json
{
  "source": "jira",
  "depth": "shallow | deep",
  "candidates": { "entities": { "teams": [], "people": [], "projects": [], "components": [] }, "relationships": [] },
  "evidence": [ ],
  "aliases": [ { "alias": "DP", "entity": "data-platform" } ],
  "coverage": { "read": 20, "known": 310, "cursor": "...", "complete": false },
  "unknowns": [ "Who owns the Security review for data-platform?" ],
  "error": null
}
```

Evidence items follow the shape in `memory-schema.md`. Report
`coverage.known` (how much exists) even when you read less. A scout never
writes to `.enigma/`; the parent runs the scripts.
