# Discovery recipes (read-only, budgeted)

Discovery uses ONLY tools already exposed by the harness. Never enumerate
resources the user cannot access; never authenticate to anything new. Every
extracted item gets a provenance envelope. Where evidence is thin, record
INFERENCE or ASSUMPTION — never fabricate a FACT.

Budget rule: first init should complete in minutes, not hours. Respect the
per-source caps below; deeper scans can be requested explicitly later.

| Source | Fetch (capped) | Extract |
|---|---|---|
| Jira / tracker MCP | visible projects; boards; up to 20 active epics per project | projects, teams (from boards/components), process signals (board type, cadence) |
| Confluence / wiki MCP | space list; 20 most recently updated pages per relevant space (titles + excerpts) | teams, people, roles, ownership, architecture notes |
| GitHub / GitLab MCP | repo list; CODEOWNERS; up to 20 recent PRs per key repo | components, ownership, delivery signals |
| Slack MCP | channel list only on first init (names + topics); NO message bodies unless the user asks | team/communication structure |
| Local repos & docs (`--docs`, `--reference` paths) | directory tree; README/ARCHITECTURE/OWNERS-style files | components, structure, ownership |
| Company URL (`--company`) | the page itself + obvious about/team pages | company facts, products |

Failure handling: a source that errors mid-scan is marked `degraded` in
`index/sources.json` with a note; continue with remaining sources; the final
report names the gap. Never hard-abort discovery for one bad source.

Process classification per team: infer Scrum/Kanban/Scrumban/waterfall/
ad-hoc/release-driven/continuous-delivery from evidence (board type, sprint
cadence, WIP patterns, release tags). Always status INFERENCE unless a
document states the process. Do not force one methodology onto all teams.
