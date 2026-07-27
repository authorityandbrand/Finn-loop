---
name: context-mode
description: Context-efficient execution patterns for legal case analysis. Use when analyzing large files, running multi-step data gathering, recovering state after compaction, or persisting findings for cross-agent search. Saves 98% of context window.
---

# Context-mode patterns for Nguyen v. Fay Servicing

Use context-mode tools to keep your context window lean. These patterns
are tailored for legal case analysis where source documents are large
and cross-referencing is frequent.

## When to use context-mode

- **Large file analysis** — KB files, Drive documents, case filings
- **Multi-step data gathering** — violations + findings + timeline in one call
- **Post-compaction recovery** — find prior state without re-reading everything
- **Cross-agent knowledge sharing** — index findings for sibling agents

## Core patterns

### 1. Analyze case data without flooding context

Instead of reading a large KB file into context:
```
ctx_execute: "Read the HAF fraud evidence file and extract all
dollar amounts, dates, and violation IDs. Output as a table."
```
Only the table enters your context, not the full document.

### 2. Multi-source legal research in one call

Instead of 5+ sequential tool calls:
```
ctx_batch_execute:
  - "Search violations for RESPA: mcp__Case_API__violations filter significance=CRITICAL"
  - "Get timeline events for 2022-2024: mcp__Case_API__timeline"
  - "Search findings for HAF fraud: mcp__Legal_API__search_findings q=HAF"
```
All results indexed automatically, only summaries enter context.

### 3. Recover state after compaction

When context is compressed and you lose prior analysis:
```
ctx_search: "HAF grant analysis three grants $170,000"
```
Returns BM25-ranked results from everything you previously indexed.

### 4. Persist findings for other agents

After completing analysis, store it so other agents can search:
```
ctx_index: "VERIFIED: Fay Servicing sabotaged three HAF grants
totaling $170,000. Grant 1: $40K (Jun 2022), Grant 2: $65K
(Sep 2022), Grant 3: $65K (Dec 2023). Source: violation #V-042,
Case API violations table."
```

### 5. Fetch and index Drive documents

Pull reference material without reading it all into context:
```
ctx_fetch_and_index: "https://drive.google.com/file/d/FILE_ID"
```
Content is indexed for search but doesn't enter context directly.

## Legal-specific patterns

### Citation verification pipeline
```
ctx_execute: "Extract all case citations from the following text.
For each, output: citation, court, year, relevance.
Text: [paste or pipe the draft section]"
```
Then verify each via `mcp__CourtListener__analyze_citations`.

### Violation cross-reference
```
ctx_batch_execute:
  - "Get all CRITICAL violations: mcp__Case_API__violations"
  - "Get all key findings: mcp__Case_API__findings"
  - "Cross-reference: which findings support which violations?"
```

### KB audit sweep
```
ctx_execute: "Read all files in project KB via bridge CLI.
For each file, check for stale values: $52K, $105K, Jan 15 2027,
v2.27. Output only files with stale values and the specific
values found."
```

## Integration with finn-loop

- **finn-build**: Use `ctx_execute` for test output analysis, `ctx_batch_execute`
  for lint + typecheck + test in one call
- **finn-review**: Use `ctx_execute` for large diff analysis, `ctx_index` to
  store review findings for the builder to search
- **finn-agent**: Spawned agents inherit context-mode when connected — they
  should use `ctx_search` after compaction to recover prior state

## Rules

- Always use context-mode tools when analyzing files over 500 lines
- Index all significant findings with `ctx_index` for cross-agent use
- After compaction, `ctx_search` before re-reading files
- Label indexed content with [VERIFIED] / [ANALYSIS] / [INFERENCE]
