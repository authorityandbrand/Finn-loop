---
name: finn-build
description: Claim the next safe agent-ready issue from GitHub, implement it, and open a PR. Use when asked to run Finn-loop's builder, work the approved queue, or fix Finn-loop review feedback. Designed for /loop; one pass does one unit of work.
---

# Finn-loop builder (local setup — GitHub Issues)

One pass = one unit of work: fix review feedback on one existing PR, or build
one issue end to end. Under `/loop`, each iteration runs this skill once.

## 0. Preflight

Before changing issues, branches, or files:

- Confirm this is the intended GitHub repository and `origin` is reachable.
- Detect the repository's default branch with
  `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`; never
  assume it is `main`.
- Require a clean working tree (`git status --porcelain` must be empty). If it
  is dirty, report the paths and end the pass. Never stash, reset, overwrite,
  or commit unrelated work.

## 1. Review feedback first

List open PRs labeled `loop-changes-requested`, including their labels:

```bash
gh pr list --state open --label loop-changes-requested --json number,title,headRefName,headRefOid,labels,updatedAt,url
```

Skip every PR carrying `needs-human-review`; it has left the automated repair
queue until a human resolves the escalation.

If any PR remains, choose the least recently updated one. Read its linked
GitHub issue and latest `Finn-loop review of COMMIT_SHA` verdict. Check out its
branch, fix only the "Must fix before merge" items, run the relevant checks,
push, remove `loop-changes-requested`, and comment with what changed. End this
pass.

If a proposed fix would cross an issue non-goal or requires a product decision,
do not implement it. Comment the exact conflict, add `needs-human-review`,
remove `loop-changes-requested`, and end the pass. This prevents the next loop
iteration from retrying a decision only a human can make.

## 2. Pick

List open GitHub issues that meet every condition:

- labeled `agent-ready`
- unassigned
- not labeled `blocked`

```bash
gh issue list --label agent-ready --state open --json number,title,assignees,labels,updatedAt --jq '[.[] | select(.assignees | length == 0) | select(.labels | map(.name) | index("blocked") | not)]'
```

Sort by oldest first. If the queue is empty, say so and end the pass.
Do not invent work and do not pick a blocked issue.

## 3. Claim (the cooperative lock)

Assign yourself to the issue:

```bash
gh issue edit NUMBER --add-assignee @me
```

Claim before reading deeply or writing code. Re-fetch the issue immediately
after the update; if it is blocked, assigned to somebody else, or no longer
`agent-ready`, do not work it and return to step 2.

## 4. Read

Fetch the full issue body and comments. Implement only its acceptance criteria.
Non-goals are binding. Compare every `AC-N` against every `NG-N` before
editing. No unrelated changes and no opportunistic refactors.

If an acceptance criterion is ambiguous, conflicts with a non-goal, or depends
on another unfinished issue, go to step 8. Never guess.

## 5. Build

- Fetch the latest default branch from `origin` and create or resume a branch
  named `issue-NNN-short-slug`, using the issue number.
- Implement the acceptance criteria using the repository's existing style,
  architecture, and naming.
- Add or update tests when the change affects logic, data flow, permissions,
  integrations, or user-visible behavior.
- Preserve behavior outside the issue contract.

## 6. Verify

Run the project's relevant lint, typecheck, build, and narrowest useful tests.
All checks attributable to this change must pass before opening a PR. If a
broad check has a pre-existing unrelated failure, run the relevant targeted
check, preserve the evidence, and disclose both results in the PR.

Review `git diff` and `git status` before shipping. Stop if the diff contains
unrelated work or generated secrets.

## 7. Ship

Push and open a PR with `gh pr create`. Its description must include:

- What changed and why
- `Closes #NNN`, using the real GitHub issue number
- A scope ledger: one evidence line per `AC-N`, one preservation line per
  `NG-N`, and `Other behavior changes: None`
- Numbered manual test steps matching what was actually built
- Automated checks run and their results
- Risk: Low / Medium / High

If `Other behavior changes: None` is not true, stop and get the issue
amended before opening the PR.

Comment the PR URL on the GitHub issue. Never merge and never enable
auto-merge. End the pass.

## 8. Blocked

Comment one specific question a human can answer asynchronously, apply the
`blocked` label, and unassign yourself. Leave `agent-ready` in place: the pick
query explicitly excludes `blocked`, so the issue safely reappears only after
a human answers and removes that label.

Never use "this is unclear" as the question. State the exact decision, the
available options, and which acceptance criterion it affects. End the pass so
the next iteration can pick different work.
