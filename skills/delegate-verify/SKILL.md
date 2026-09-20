---
name: delegate-verify
description: Use when dispatching subagents to verify or cross-check conclusions/recommendations (your own or others'). Triggers on requests like "派子agent核对/验证/校验/复核", "verify with subagents", "cross-check these claims". Standard read-only verification flow — do not re-derive it on the spot.
---

# Delegated Verification

## Flow

1. **Preflight**: `subagent({action:"list", capabilities:true})` — confirm the target agent is executable and note its role/tool constraints.
2. **Casting** (read-only by default): claim verification → `evidence-auditor`; directory/package recon → `scout`; use a writer agent only when the operator explicitly asks for modifications.
3. **Fan out once**: a single async `workflowScript` + `runs.all([...])` with all verification tasks; stable independent keys, verb-phrase labels.
4. **Yield immediately**: no bg_wait, no polling; wake on the native completion notification.
5. **Reconcile conflicts first**: when a child's verdict conflicts with yours, trust the side with reproducible evidence; if still in doubt, re-check or re-run — don't split the difference.

## Child Prompt — Five Required Elements

- Objective + cwd + **read-only boundary** (be specific, e.g. "no chezmoi write operations")
- Claims listed and numbered (C1…Cn), each falsifiable
- Uniform verdict format: per-claim `CONFIRMED / REFUTED / PARTIAL` + evidence line → overall verdict
- Stop condition: halt and report if a write operation or boundary violation would be needed — do not expand scope on your own
- No `model` override for verification tasks (inherit the session model)
- For tasks expected to run long (multi-stage builds, wide recon): set `timeoutMs` sized to the task, and add one line — "send a one-line `progress_update` at each milestone". Heartbeats ride the child's context; the parent only receives event stubs. Never poll with `bg_wait`

## Discipline (verified against pi-subagents v0.68 source; re-checked against v0.70.0 on 2026-09-20)

| Scenario | Rule |
|---|---|
| File-mutating child | Always attach a `gate`, and require the child to log its commands in the acceptance report's `commandsRun` — otherwise you get "host checks all green, whole run rejected" false failures |
| Applying a child's patch | Normalize hunk headers first; only apply after `git apply --check` passes (field data: raw apply succeeds ~1/5 mechanically; normalized 5/5) |
| Acceptance roles | Static review → `reviewer` (its tool set has no `bash`; a PASS is not execution evidence). Execution-level acceptance → `verifier`/`delegate` + gate |
| Context | Default to `fresh`; fork only when session-private context is genuinely required, and set `timeoutMs`/budget explicitly for that run |
| Fan-out size | Estimate the count first: `maxSubagentSpawnsPerRun` is an all-or-nothing group admission — if exceeded, none of the group start |
| Gate semantics | Gate passing ≠ run passing (failure only blocks the verdict, it does not delete produced artifacts); `gate` and `acceptance` are mutually exclusive — passing both errors out |

## Anti-patterns

- Nested async helpers inside workflowScript (sandbox rejects it); splitting a fan-out into multiple direct calls instead of one
- Attaching acceptance / toolBudget to read-only verification tasks
- Vague claims ("check if there are any problems") — must be numbered and falsifiable
- Writing lore into this skill without checking it against the current source: e.g. the retelling that "`resume` drops / doesn't inherit the toolBudget" is **wrong in mechanism but right in effect**, and the counter-retelling "that's refuted, resume restores `initialToolBudget`" is **an over-claim**. `async-resume.js` does restore the launch-time `initialToolBudget`, but that object is then fed through `initialToolBudgetState()`, which returns `toolCount: 0` — and `toolCount` is not among the resume descriptor's persisted fields (0 occurrences in `async-resume.js`). So the *counter* is re-armed and the resumed child gets the full original allowance again. The budget is not dropped, it is re-granted in full. Every piece of lore must survive a source audit before landing here

## Wrap-up

Summary table (original claim × verdict × key evidence) → ask the operator for execution scope; for irreversible actions (deletion etc.), restate the scope and wait for one explicit confirmation even if already selected.
