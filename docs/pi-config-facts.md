# Configuration notes (troubleshooting reference)

Findings that are only needed when something breaks or when the configuration is being changed.
None of this is required reading for normal use.

## 1. Compaction trigger and summary output

- Auto-compaction fires when `contextTokens > contextWindow - reserveTokens`. `reserveTokens` only
  decides *when* compaction happens (default `16384`); raising it compacts earlier, it does not buy
  a larger summary output budget.
- Since Pi 1.4.0 the summary's output budget defaults to the model's output limit and is reduced so
  that input + output fit the context window; the input itself is not truncated on the compaction
  path (input trimming exists only for branch summaries). The old
  `min(0.8 x reserveTokens, model.maxTokens)` cap is gone (see `docs/compaction.md` and the 1.4.0
  entry in `CHANGELOG.md` inside the pi package).
- `keepRecentTokens` is how many recent tokens stay out of the summary, default `20000`.
- The keys must live inside the `compaction` object; putting `reserveTokens` or `keepRecentTokens`
  at the top level is silently ignored. Reader: `settings-manager.ts` ->
  `getCompactionTokenSetting()`, resolving matched `modelOverride` -> plain `compaction` settings
  -> built-in defaults.

  ```json
  "compaction": { "reserveTokens": 48000, "keepRecentTokens": 60000 }
  ```

- Takes effect after `/reload`, no restart: `/reload` -> `AgentSession.reload()` ->
  `settingsManager.reload()`; values are read live on every check and nothing watches
  `settings.json`. `/reload` is refused while a response is streaming or a compaction is running.
- With the shipped values `reserveTokens: 48000` and `keepRecentTokens: 60000`, the threshold for a
  model with context window `C` is `C - 48000`; use `compaction.modelOverrides` when a per-model
  split is needed.

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
