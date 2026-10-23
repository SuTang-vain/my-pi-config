# Configuration notes (troubleshooting reference)

Findings that are only needed when something breaks or when the configuration is being changed.
None of this is required reading for normal use.

## 1. Compaction failure: "the summary is incomplete"

- The summary call is capped at `min(0.8 x reserveTokens, model.maxTokens)`
  (`src/core/compaction/compaction.ts`).
- With the default `reserveTokens: 16384` the cap is 13,107 tokens regardless of history length;
  changing the model does not help, because `min` takes the smaller value.
- The key is nested: `settings.json` must contain

  ```json
  "compaction": { "reserveTokens": 48000, "keepRecentTokens": 60000 }
  ```

  The reader is `this.settings.compaction?.reserveTokens ?? 16384` in
  `src/core/settings-manager.ts`; a top-level key of the same name is silently ignored.
- Takes effect after `/reload` (`resource-loader` calls `settingsManager.reload()`), no restart.

## 2. What a child session inherits

- Child sessions do not inherit the base system prompt or context files. A subagent reads
  `AGENTS.md` only when it declares both `inheritProjectContext: true` and
  `inheritGlobalContext: true`.
- Operating rules in `APPEND_SYSTEM.md` apply to parent sessions only: a probe child confirmed it
  does not receive them, has no todo tool, and is explicitly forbidden from delegating further.
- Project-level rules live in each repository's own `AGENTS.md`; visibility follows the same two
  switches.

## 3. Switching modules of the productivity suite

- Location: `extensions/productivity/`. Each module can be disabled by commenting out its line in
  `index.ts`, then `/reload`.
- The `usage-inject` cadence is controlled by `usage-policy.js` (`everyTurns`, `minCostDeltaUsd`,
  and the absolute context and cost tiers).

## 4. Environment variables versus settings

- `PI_REASONING_LEVEL` (and `PI_PROVIDER`, `PI_MODEL`, `PI_SESSION_*`) are values pi exports to
  shell commands to describe the current state, not inputs. They do not conflict with
  `defaultThinkingLevel`.
- In `settings.json`, a per-model entry in `modelThinkingLevels` takes precedence over
  `defaultThinkingLevel`.

## 5. Notification chain

- Notifications for panes hosted by herdr are issued by the herdr plugin, not by pi; `notify.ts`
  returns immediately when `HERDR_ENV=1`. See `docs/macos-notifications.md` for the full setup and
  for the verification commands.
- `agent_end` can be followed by retries, overflow recovery, compaction or queued work, so
  notification work belongs on `agent_settled`.
