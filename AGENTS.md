# Global agent instructions

## Machine-verified local facts (usable as context)

- Operating rules live in `~/.pi/agent/APPEND_SYSTEM.md` (same directory, chezmoi-managed); its rules 6 and 7 apply to **parent sessions only** (child sessions have no todo tool and are explicitly forbidden from delegating further — a probe child confirmed it "did not receive" them).
- Child sessions do **not** inherit the base prompt or context files by default (pi-subagents `docs/agents.md`); for a child to read this file,
  the agent must declare `inheritProjectContext: true` **and** `inheritGlobalContext: true`.
- Project-level rules live in each repo's own `<repo>/AGENTS.md`; a child's visibility of project-level files is governed by those same two flags.
- The productivity extension suite lives in `~/.pi/agent/extensions/productivity/` (provides the `todo` tool and the `/todos` panel);
  its toggle mechanism is documented in that directory's README (edit `index.ts` + `/reload`).
- When compaction (`/compact`) fails with "the summary is incomplete": the summary call's output cap is `min(0.8 × reserveTokens, model.maxTokens)` (source: `src/core/compaction/compaction.ts`);
  the default `reserveTokens: 16384` ⇒ only 13,107 tokens, regardless of history size; switching models does not help (the cap takes the min).
  Note the **key is nested**: in `settings.json` write `"compaction": { "reserveTokens": 48000, "keepRecentTokens": 60000 }`
  (read via `src/core/settings-manager.ts`: `this.settings.compaction?.reserveTokens ?? 16384`; a top-level key is silently ignored).
  Apply with `/reload` (the `resource-loader` calls `settingsManager.reload()`); no restart needed.
