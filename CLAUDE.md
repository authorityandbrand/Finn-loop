# Finn-loop Configuration

## Project Bridge

The MCP project bridge (`mcp-project-bridge/`) connects claude.ai Projects
to Claude Code sessions. Projects store knowledge in GCS at
`gs://claude-kb-projects/{project_id}/`, authenticated via session key.

### Security

- Project knowledge and instructions are internal. Never commit, push,
  or expose project content to external services or repositories.
- Session keys and org IDs are secrets. Never commit them.
- The bridge authenticates via claude.ai session key — data stays within
  the authenticated session boundary.
- When spawning agents, project context goes into the agent prompt
  (ephemeral), never into files tracked by git.
- Never include project file contents, instructions, or knowledge
  excerpts in PR descriptions, commit messages, or code comments.

### Available Agent Types

Spawn project-wired agents with `Agent(subagent_type: "...")`:

| Agent | Purpose |
|-------|---------|
| `project-specialist` | Deep expert on one project's domain |
| `knowledge-researcher` | Cross-project research and synthesis |
| `project-builder` | Finn-loop builder with project knowledge |
| `project-reviewer` | Finn-loop reviewer with project standards |

### Bridge Tools

The project bridge exposes these MCP tools when connected:

- `list_projects` — List all projects in the org
- `get_project` — Get project details
- `list_project_files` — List knowledge files in a project
- `get_project_file` — Read a specific knowledge file
- `get_project_instructions` — Get project custom instructions
- `search_project_knowledge` — Search across project files
- `get_agent_context` — Batch load project context for agent bootstrapping
- `create_project_file` — Upload new knowledge to a project
- `delete_project_file` — Delete a knowledge file from a project
- `update_project_instructions` — Update project instructions

## Factory Skills

| Skill | What it does |
|-------|--------------|
| `/finn-spec` | Interview → GitHub issue with AC/NG contract |
| `/finn-build` | Claim issue → implement → open PR |
| `/finn-review` | Review PR against issue contract → verdict |
| `/finn-agent` | Spawn agents wired to claude.ai Projects |
