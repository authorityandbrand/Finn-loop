---
name: finn-agent
description: Spawn specialized agents wired to claude.ai Projects. Use to create domain experts, run cross-project research, or enhance builders and reviewers with project knowledge. Interactive — requires the user present to choose the project and task.
---

# Project-wired agent spawning

Spawns agents that are specialized through claude.ai Project knowledge.
The project bridge MCP server provides the knowledge layer; this skill
orchestrates the wiring.

## 1. Identify the task and select model tier

Ask the user what they need:

- **Domain question** → project-specialist agent
- **Cross-project research** → knowledge-researcher agent
- **Build with project standards** → project-builder agent
- **Review with project standards** → project-reviewer agent

If the task type is obvious from context, confirm rather than asking.

For non-obvious routing, spawn the task-advisor agent first:
```
Agent(subagent_type: "task-advisor", prompt: "<task description>")
```
It returns a structured recommendation with agent_type, model, and
effort level. Use those values when spawning the actual agent.

Select model and effort based on complexity (see CLAUDE.md Model
Selection table), or use the task-advisor's recommendation:

| Complexity | Model | Effort |
|------------|-------|--------|
| Simple lookup | `haiku` | `low` |
| Standard work | `sonnet` | `medium` |
| Complex reasoning | `opus` | `high` or `max` |

## 2. Select the project

If the user names a project, use it directly. Otherwise:

1. Call `list_projects` from the project bridge
2. Show the user a short list of relevant projects (name + description)
3. Let the user choose

If bridge tools are not connected, ask the user to provide the project
instructions and key knowledge inline, or tell them how to connect the
bridge:

```
claude mcp add --transport http project-bridge https://project-bridge-mcp.{account}.workers.dev/mcp
```

## 3. Load project context

Once a project is selected:

1. Call `get_agent_context` with the project_id — this returns
   instructions, file manifest, and metadata in one call
2. If the task requires deep knowledge, also call `get_project_file`
   for the most relevant files (cap at 10)
3. Compile the context into a prompt section

## 4. Spawn the agent

Use the Agent tool:

- Set `subagent_type` to the chosen agent type from step 1
- Set `model` based on the complexity assessment from step 1 (e.g.,
  `model: "sonnet"` for standard work, `model: "opus"` for complex)
- Build the prompt with three sections, ordered for prompt caching:
  1. **Project instructions** — the project's custom instructions
     verbatim (static, cacheable prefix)
  2. **Available knowledge** — the file manifest (names and IDs) so
     the agent knows what it can load (static, cacheable prefix)
  3. **Task** — the user's request in full (dynamic, after the
     cacheable prefix)

This ordering ensures repeated spawns against the same project cache
the static prefix (up to 90% savings on input tokens).

For project-builder and project-reviewer agents, include the relevant
Linear issue identifier or PR number in the task section.

## 5. Report results

Summarize what the agent produced. If the agent recommends storing
findings back into a project, confirm with the user before writing.

## Security rules

- Never send project knowledge to external services
- Never include project content in git commits, PR descriptions, or
  code comments
- Project data stays within the session boundary
- The bridge authenticates every request — unauthenticated calls are
  rejected
- When spawning agents, project context is ephemeral (in the prompt),
  never persisted to disk
