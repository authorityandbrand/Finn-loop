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

| Agent | Purpose | Default model | Default effort |
|-------|---------|---------------|----------------|
| `task-advisor` | Route tasks to the right model/agent | `haiku` | `low` |
| `project-specialist` | Deep expert on one project's domain | inherited | varies |
| `knowledge-researcher` | Cross-project research and synthesis | inherited | varies |
| `project-builder` | Finn-loop builder with project knowledge | inherited | varies |
| `project-reviewer` | Finn-loop reviewer with project standards | inherited | varies |

### Model Selection

Before spawning an expensive agent, consult the task-advisor or use
this table directly:

| Complexity | Model | Cost (in/out per 1M) | Use when |
|------------|-------|----------------------|----------|
| Simple | `haiku` | $1 / $5 | Lookups, classification, extraction |
| Standard | `sonnet` | $3 / $15 | Implementation, review, drafting |
| Complex | `opus` | $5 / $25 | Architecture, research, legal analysis |

Set `model` and `effort` on the Agent tool call:
```
Agent(subagent_type: "project-builder", model: "sonnet", prompt: "...")
```

Each agent definition includes a Model & Effort Guidance table. The
task-advisor agent automates this selection — spawn it first for
non-obvious routing decisions.

### Bridge CLI (fallback)

When the MCP bridge is not connected, use `scripts/bridge-cli.mjs` with
`CLAUDE_SESSION_KEY` set as an environment variable:

```bash
export CLAUDE_SESSION_KEY="sk-ant-sid02-..."
node scripts/bridge-cli.mjs list-projects
node scripts/bridge-cli.mjs agent-context <project-id>
node scripts/bridge-cli.mjs get-file <project-id> <file-id>
node scripts/bridge-cli.mjs search <query>
```

Pre-fetch context, then embed it in agent spawn prompts. The session key
comes from the browser (DevTools → Application → Cookies → `sessionKey`).

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

### Prompt Caching

Structure agent prompts for Anthropic's prefix-match caching (up to
90% savings on cached input tokens, 5-min TTL on Claude Code):

1. **Static prefix first** — project instructions, tool inventories,
   coding standards, file manifests. This content is identical across
   repeated spawns and forms the cacheable prefix.
2. **Dynamic suffix last** — the specific task, issue details, or
   research question. This changes per spawn and sits after the
   cached prefix.

Example prompt structure for a project-builder spawn:
```
[Project instructions — cacheable]
[Coding standards — cacheable]
[Tool inventory — cacheable]
[File manifest — cacheable]
---
[Issue #42 details — dynamic]
[Specific build instructions — dynamic]
```

Repeated spawns against the same project hit cache on the static
prefix. The first spawn pays full price; subsequent spawns within the
TTL window save up to 90% on those tokens.

### Prompt Engineering

Apply these patterns when constructing agent spawn prompts:

- **Role-task-context structure**: Open with the agent's role, then the
  specific task, then supporting context. This maps to how Claude
  processes instructions.
- **Adaptive thinking**: Claude 4.6+ models use `thinking: {type:
  "adaptive"}` — the model decides how much to think based on task
  complexity. No budget_tokens needed.
- **Specific over vague**: "Fix the null check on line 42 of
  api/client.ts" beats "fix the bug in the API". Specificity reduces
  wasted reasoning tokens.
- **One task per agent**: Each agent spawn should do one thing well.
  Split multi-part work across multiple agents rather than overloading
  one prompt.

### Context Mode Integration

[context-mode](https://github.com/authorityandbrand/context-mode) is
an MCP server that saves 98% of context window with session continuity.

Install as a Claude Code plugin:
```bash
claude plugin add context-mode
```

Or add as an MCP server:
```json
{
  "mcpServers": {
    "context-mode": {
      "command": "npx",
      "args": ["-y", "context-mode@latest"]
    }
  }
}
```

Key capabilities for agent workflows:
- **ctx_execute** — run analysis code in sandbox; only stdout enters
  context (saves reading large files)
- **ctx_search** — BM25-ranked search over indexed content
- **ctx_batch_execute** — one call replaces 30+ sequential commands
- **ctx_fetch_and_index** — fetch URLs without flooding context
- **Session continuity** — survives compaction via FTS5-indexed event
  history

When context-mode is connected, agents should:
- Use `ctx_execute` for data analysis instead of reading raw files
- Use `ctx_batch_execute` for multi-step data gathering
- Use `ctx_search` after compaction to recover prior state
- Use `ctx_index` to persist findings for later retrieval

## Factory Skills

| Skill | What it does |
|-------|--------------|
| `/finn-spec` | Interview → GitHub issue with AC/NG contract |
| `/finn-build` | Claim issue → implement → open PR |
| `/finn-review` | Review PR against issue contract → verdict |
| `/finn-agent` | Spawn agents wired to claude.ai Projects |
