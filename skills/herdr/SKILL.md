---
name: herdr
description: "Interact with an independent agent (herdr terminal workspace): use when the user explicitly mentions herdr, or asks to open a separate, persistent, watchable agent session For one-shot subtasks whose results must flow back to the orchestrator, use pi-subagents instead — this skill covers working *alongside* an agent, not *dispatching* one."
---

# Herdr: working alongside independent agents

## Decide the relationship model first (single test: does the peer need its own identity and lifetime?)

- **Dispatching a subagent**: one-shot, results flow back, no independent identity → use pi-subagents, **not this skill**
- **Interacting with an independent agent**: its own session, survives across sessions, the user can watch or step in at any time → this skill

## Authority on commands (drift protection)

This file is only an entry point. Command syntax and safety rules come from the live output — read it before operating:

```bash
herdr --skill
```

Gate: if `test "$HERDR_ENV" = 1` fails, this session is not inside herdr. Stop and say so — never control a session from outside.

## Minimal path (covers ~90% of cases)

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus   # wide→right, narrow/tall→down; returns .result.pane.pane_id
herdr agent start <name> --kind pi --pane <pane_id>                    # name: [a-z][a-z0-9_-]{0,31}
herdr agent prompt <name> "task" --wait --timeout 600000               # submit and wait for the first settled state
herdr agent read <name> --source recent-unwrapped --lines 120          # read output
```

Closing: when the user says archive/close, run `herdr pane close <pane_id>` (the pi session transcript is already persisted under ~/.pi/agent/sessions/).

Discipline: always parse IDs from JSON responses, never invent them; use `--no-focus` for background work so the user keeps focus; never close panes you did not create.
