# Productivity suite

A set of small, independent extensions for `~/.pi/agent/extensions/productivity/`. pi loads the
directory at startup; `index.ts` composes the modules so each one can be disabled on its own.

## Modules

| File | Function | Switch |
|---|---|---|
| `session-name.ts` | Names a session from its first user message (truncated to 40 characters, slash commands skipped); `/session-name [name]` sets or prints it | — |
| `notify.ts` | Desktop notification when the agent settles. **Only fires outside herdr** — it returns immediately when `HERDR_ENV=1`, because herdr owns notifications for panes it hosts. Ghostty, iTerm2 and WezTerm receive OSC 777 (the notification belongs to the terminal app and clicking it focuses that window), Kitty receives OSC 99, other macOS terminals fall back to osascript | `PI_NO_NOTIFY=1` |
| ~~`model-status.ts`~~ | Status-bar model indicator — **disabled** (2026-09-20): the footer already shows the model, so a second display is redundant. To restore, uncomment the two lines in `index.ts` | in `index.ts` |
| `todo.ts` | The `todo` tool plus a `/todos` panel; state lives in the session and survives branching | — |
| `footer.ts` | Custom TUI footer: tokens, cost, git branch and model for this session; `/footer` toggles it | `/footer` |
| `usage-inject.ts` + `usage-policy.js` | Injects usage, cost and context figures into the model context on a policy (the model cannot see the footer). The policy is pure functions with unit tests | — |

## Day-to-day behaviour

- The footer shows `↑3.2k ↓1.1k $0.042 deepseek-v4-pro (main)` for the current session.
- Asking for a task list makes the model call the `todo` tool; `/todos` renders the panel.
- Each settled run produces one notification (issued by herdr when the pane runs under herdr).
- `/resume` lists session names derived from the task summary rather than the raw prompt.

## Adjusting

- To disable a module, comment out its line in `index.ts` and run `/reload`.
- To run a single module in isolation: `pi -e ~/.pi/agent/extensions/productivity/index.ts`.

## Notes

- Extensions run with the full privileges of your user account. This suite only reads git state,
  emits terminal notification sequences, and calls `osascript` on macOS; it makes no network
  requests.
- `usage-inject` reports on turn boundaries and at context or cost thresholds; the injected line is
  marked `status only, not a task` so it is not mistaken for an instruction.
