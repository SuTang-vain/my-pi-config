# pi subagent system: usage guide

> Baseline at first writing: pi 0.85.1 with pi-subagents 0.68.0 (2026-09-16).
> **Authority**: dispatch discipline lives in `skills/delegate-verify/SKILL.md`. Its audit stamps
> are historical provenance, not a declaration of the currently installed version; use
> `npm/package.json` and the local lockfile for versions, and re-check behavioral claims against
> installed source. This page is background on how the system is composed; if a behavioural
> statement here conflicts with that skill, the skill wins.
> Evidence base: source inspection (`schemas.ts`) plus runs on the local machine.

## 1. Composition

```
pi-subagents extension (npm package)
├── tools:     subagent (dispatch) + contact_supervisor (child → parent)
├── commands:  /subagents-* (management, status, stopping)
├── built-in:  scout / researcher / evidence-auditor / worker / reviewer / oracle / delegate
├── user:      agents/*.md in this repository (a same-name file overrides the built-in)
└── telemetry: run-history.jsonl (mode 0600, rotated) + subagent-artifacts/outputs/
```

A subagent is a focused child pi session: it has its own context, task and tool surface. The parent
dispatches work and collects results.

## 2. Choosing an agent

| Agent | Use | Permissions |
|---|---|---|
| `scout` | Reconnaissance of local code and configuration: relevant files, data flow, risks | read-oriented; returns compressed context |
| `researcher` | Web and document research with sources | needs web access in the child |
| `evidence-auditor` | Independent check that research claims are supported by their sources | read-only |
| `worker` | Implementation: edits, verification, escalates unapproved decisions instead of guessing | the only writing role |
| `reviewer` | Code review of a diff or plan | read-only plus small fixes |
| `verifier` | Executes the acceptance commands and reports raw output | read-only |
| `oracle` | Second opinion before a decision; challenges assumptions | does not edit |

Rule of thumb: scout before reasoning about code, researcher before trusting external facts,
evidence-auditor before quoting a conclusion, worker to change files, reviewer/verifier to check,
oracle when the decision itself is uncertain.

## 3. Invoking

Natural language is sufficient for most work ("have scout map this repository, then ask me
clarifying questions"); pi decides how to dispatch and orchestrate.

For precise control, the `subagent` tool takes:

| Parameter | Effect | Notes |
|---|---|---|
| `agent` | agent name | a user definition overrides a built-in of the same name |
| `task` | task description | must be self-contained: the child starts from a blank context, so paths, constraints and output format all belong in the task |
| `async` | run in the background | the parent is woken by a native completion message; do not poll |
| `cwd` | working directory | defaults to the parent's |
| `model` | model override | optional `:off/minimal/low/medium/high/xhigh/max` suffix sets the thinking level |
| `context` | `fresh` / `fork` / profile | `fork` carries parent context, `fresh` starts blank |
| `timeoutMs` | timeout | defaults to the configured value (30 min) |
| `toolBudget` | tool-call budget | `soft` warns, `hard` aborts |
| `usageBudget` | token or cost budget | past `hard`, further launches are refused |
| `isolation` | `none` / `worktree` | writing tasks should use a worktree to isolate the git state |

Parallel fan-out is expressed by issuing several `async` calls in one message block (four
concurrent children were stable in testing; the fan-out ceiling is 64). Chained and dynamic
workflows are available through the `workflow` parameter; see the package documentation.

## 4. Patterns verified locally

- **Parallel reconnaissance**: four scouts, one line of inquiry each, dispatched asynchronously.
  The task text should state "read-only, no write operations" and the expected output shape.
- **Headless fallback**: when child tools are unavailable, `pi -p --no-session "<task>"` with
  `PI_NO_AUTO_COMMIT=1 PI_NO_NOTIFY=1` runs a separate process with the same configuration.
  It inherits `HERDR_ENV` and therefore reports agent state to herdr.
- **Isolated writes**: `worker` with `isolation: worktree` and a review gate is the only
  configuration in which file changes are permitted.

## 5. Safety mechanisms

- A bash guard recognises subagents (`PI_SUBAGENT_ID`) and hard-blocks destructive commands
  without prompting, whereas the parent session asks for confirmation.
- Run history is written with mode 0600 and rotated.
- Credentials are not isolated by the runtime: a child runs with the same user privileges, so
  write permissions are constrained by task wording, not by the process boundary.

Discipline: state read-only for reconnaissance, dispatch writes to `worker` only, use a worktree
for work in production directories, and set `toolBudget` on large fan-outs.

## 6. Observing and diagnosing

```bash
tail -5 ~/.pi/agent/run-history.jsonl                                  # who ran what, outcome, duration
ls ~/.pi/agent/sessions/<project>/subagent-artifacts/outputs/          # full child output
herdr agent list                                                       # agent state as herdr sees it
```

Common issues:

1. Edits to `agents/*.md` have no effect in the current session: agent definitions, like
   extensions, are loaded at startup.
2. A child that appears to hang will wake the parent through the native completion message; do not
   poll with sleep in an interactive session.
3. Truncated output is usually available in full under `subagent-artifacts/outputs/`.

## 7. Cost observations

- Four parallel scout audits: roughly 30 to 60 seconds per child on a flash-tier model.
- Historical total across sessions: about 123M tokens, approximately $2 on the deepseek/glm price
  tier. Fan-out therefore has a low marginal cost.
- Children inherit the parent model by default; the `model` parameter can lower the tier for a
  child (for example `:minimal`).

## 8. Quick reference

```
minimal call:   subagent({agent:"scout", task:"read-only ... <=500 words"})
fan-out:        several async:true calls in the same block
waiting:        do not wait; the native completion message wakes the parent
```
