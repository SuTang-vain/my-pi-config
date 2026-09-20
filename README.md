# my-pi-config

**English** | [简体中文](README.zh-CN.md)

A measured, self-verifying configuration for the [pi](https://github.com/badlogic/pi-mono) coding agent (`@earendil-works/pi-coding-agent`).

This repository contains a complete, production-used configuration: seven role-specialized subagents, a curated skill whitelist, a purpose-built extension suite, and a selftest harness that machine-checks every cross-file invariant. Every design choice documented here is backed by a measurement, a source-code audit, or a recorded production failure.

**Snapshot**: pi 0.86.0 · pi-subagents 0.70.0 · 2026-09-20.

---

## Table of Contents

- [Design Principles](#design-principles)
- [Architecture](#architecture)
- [Subagent Team](#subagent-team)
- [Extensions](#extensions)
- [Skills](#skills)
- [Measured Findings](#measured-findings)
- [Documented Pitfalls](#documented-pitfalls)
- [Repository Layout](#repository-layout)
- [Installation and Adaptation](#installation-and-adaptation)
- [Deliberately Excluded](#deliberately-excluded)
- [License](#license)

---

## Design Principles

### 1. Mechanisms over prompts

Prompt-level discipline can be quoted out of context, misread, or silently ignored. In one controlled experiment (n = 60, two arms × two models × four sizes), a delegation-discipline sentence added to the system prompt produced **zero attributable effect (0/60)** — and was cited by the model as a reason *not* to delegate, the opposite of its intent. Consequently, knowledge in this configuration lives at the strongest available layer: tool parameters first, then mechanisms, then documentation, and prompts only for operational conclusions.

### 2. Measurements over lore

Nearly every rule carries its evidence inline — a measured number or a source-code reference. Examples are listed under [Measured Findings](#measured-findings).

### 3. Every component must justify its existence

Skills with zero recorded invocations, extensions overtaken by upstream features, and security theater that guards only one door have all been removed. Each removal is recorded with its rationale and a restore path, so the configuration shrinks deliberately rather than accumulating.

### 4. Configuration must be machine-checkable

`npm run selftest` verifies 19 invariants — for example, that every model referenced anywhere exists in the authenticated provider registry, and that no agent declares a default context that the global config would silently override. The harness exists because a 2026-09-20 audit found three defects of one shape — *the configuration named something that does not exist in the runtime registry* — each of which surfaced only when the affected feature happened to be invoked.

## Architecture

```
Meta layer      chezmoi (versioning + age-encrypted secrets) · selftest.mjs (19 invariants)
Rule layer      AGENTS.md (verified facts) · APPEND_SYSTEM.md (7 operating rules)
Base layer      settings.json — default model, per-model thinking levels, compaction tuning
Capability      9 resident skills (4 whitelisted + 5 auto-discovered); others mount on demand
Orchestration   pi-subagents + 7 role-specialized agents + delegate-verify (dispatch canon)
Planning        pi-goal-x (cross-session goal ledger) · todo tool (in-session assertions)
Session layer   built-in /resume (cross-workspace search & delete) · analyze-sessions (batch)
Feedback        footer (human-facing usage) · usage-inject (model-facing) · /context overlay
```

## Subagent Team

Seven role-specialized agents under `agents/`, all sharing one evidence discipline: conclusions are graded **measured / quoted / unverified**, and failure must be reported explicitly rather than smoothed over.

| Agent | Role | Key constraint |
|---|---|---|
| `scout` | Read-only reconnaissance; produces a compact, handoff-ready context | `thinking: low` |
| `researcher` | Desk research via the Exa index (breadth-first, batch extraction) | Must report "insufficient evidence" explicitly instead of padding with snippets |
| `inspector` | Field inspection via a real browser (login state, JS rendering, interaction) | Second stage after `researcher`, not a substitute |
| `evidence-auditor` | Independent audit of load-bearing claims | A URL alone is not evidence |
| `verifier` | Execution-level acceptance: runs commands and quotes raw output | Conclusions must include stdout and exit codes |
| `reviewer` | Static review (local override) | The upstream definition declares a tool with no child-loadable provider; the override fixes and documents this |
| `worker` | The **only writer**; implements the approved direction minimally | Must escalate rather than make unapproved decisions |

Two roles form a deliberate pipeline (`researcher` → `inspector`): the first locates which sources exist, the second secures first-hand content of the critical pages.

## Extensions

Self-written extensions under `extensions/`:

| Extension | Function |
|---|---|
| `productivity/` | Five active modules: session auto-naming, completion notifications, an LLM-callable `todo` tool with a `/todos` panel, a usage footer (tokens / cost / branch / model), and `usage-inject`, which periodically injects usage data into the model's context (the model cannot see the footer) |
| `prompt-snippets/` | Six single-purpose prompt fragments toggled per message (`alt+s`); toggles reset after each send, so unused snippets cost nothing |
| `context.ts` | `/context` renders a colored grid of context-window composition with threshold warnings |
| `md-link.ts` | Links a Markdown file to the session for collaborative editing (assistant output is appended; `/send-diff` returns edits to the model) |
| `subagent/config.json` | pi-subagents tuning: fresh context by default, spawn budget, checkpoint grace period |

## Skills

Resident skills under `skills/` (plus four whitelisted from the scientific-agent-skills library via `settings.json`):

- `delegate-verify` — the canonical dispatch playbook for delegated verification, with every discipline row verified against the installed pi-subagents source (version-stamped).
- `analyze-sessions` — dependency-free Python tooling for cost aggregation, prompt-pattern mining, single-session rendering, and cross-session search over the session archive.

## Measured Findings

| Claim | Evidence |
|---|---|
| Delegation is worthwhile iff `M − δ > package tax` | pi-subagents costs a fixed 5,809 tokens per round (two independent measurements, 0.6% apart); `outputMode: "file-only"` returns a 90-character stub for a 14,465-byte report (δ reduced 228×) |
| Skill whitelisting matters | Injecting all 160+ available skills costs ≈19,300 tokens per session; the resident nine cost ≈3.7 KB of characters (selection supported by invocation records across 128 sessions) |
| Subagent patches need hunk-header normalization | Raw `git apply` succeeded mechanically 1/5; after normalization, 5/5 semantically correct |
| `/compact` failure root cause | Summary output cap = `min(0.8 × reserveTokens, model.maxTokens)`, independent of history size (`src/core/compaction/compaction.ts`) |

## Documented Pitfalls

These defects were found in this configuration and fixed; each is recorded with source references:

- **Pruned-fork dead configuration**: the summarizer model id did not exist in its provider's registry, so explicit forks threw before launch; additionally, the global `defaultSubagentContext` silently overrides agent-level declarations.
- **Checkpoint/deadline collision**: when `checkpointBeforeDeadlineMs` equals an agent's `timeoutMs`, the wrap-up timer is silently never armed (a difference below 1,000 ms disarms it).
- **Global `toolTimeoutMs` collateral damage**: when set, every non-exempt tool (including `bash`) inherits the cap, and a timeout kills the entire subagent rather than failing the single tool call.
- **Acceptance classifier false positives**: bare tool names (`edit`, `write`) inside embedded task data are read as implementation intent, hard-failing read-only children. Filed upstream as [pi-subagents#2351](https://github.com/nicobailon/pi-subagents/issues/2351) with a deterministic reproduction (see `docs/`).

## Repository Layout

```
├── settings.json · AGENTS.md · APPEND_SYSTEM.md   # Main configuration and prompt layers
├── agents/            # Seven subagent definitions
├── extensions/        # context · md-link · productivity · prompt-snippets · subagent
├── skills/            # delegate-verify · analyze-sessions
├── scripts/           # selftest.mjs (19 invariants) · skill-library bootstrap
├── npm/package.json   # Extension packages (pi-subagents · pi-goal-x · rpiv-ask-user-question)
├── themes/            # catppuccin-mocha
└── docs/              # Subagent system guide · two filed upstream issue reports
```

## Installation and Adaptation

```bash
# 1. Copy into ~/.pi/agent/ (or adopt individual pieces)
# 2. Install extension packages
cd npm && npm install
# 3. The pi host package is a normal semver dependency (^0.86.0) — resolution
#    works out of the box; npm/.npmrc sets legacy-peer-deps to tolerate
#    pi-goal-x's outdated peer range. Background: docs/upstream-issue-host-package-resolution.md
# 4. Create auth.json with your provider keys, then chmod 600:
#    { "<provider>": { "type": "api_key", "key": "sk-..." } }
# 5. Verify
npm run selftest   # expect 19 passed
```

The skill whitelist in `settings.json` references `~/.pi/agent/skills-optional/...`; rebuild with `scripts/clone-skill-repos.sh` or trim to taste.

## Deliberately Excluded

`auth.json` (credentials), `models-store.json` (machine-local model catalog, regenerated by pi), `sessions/`, `missions/`, `run-history.jsonl` (private data), Herdr-generated integration files (regenerate via `herdr integration install pi`), and third-party skill libraries (restored by the bootstrap script).

## License

MIT for the configuration and self-written extensions. Third-party content retains its respective upstream licenses.
