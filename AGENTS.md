# Global agent instructions

## Facts (verified, not assumed)

- Project-level rules live in each repo's own `AGENTS.md`; operating discipline lives in `~/.pi/agent/APPEND_SYSTEM.md`.
- Child sessions inherit neither the base prompt nor context files by default (pi-subagents `docs/agents.md`): a child reads this file only when its agent declares `inheritProjectContext: true` **and** `inheritGlobalContext: true`. A child has no todo tool and must not delegate further.
- The productivity suite (the `todo` tool and the `/todos` panel) lives in `~/.pi/agent/extensions/productivity/`; its toggle mechanism is documented in that directory's README.
- Troubleshooting recipes — the compaction `reserveTokens` output cap, child-session inheritance probes, why a top-level `compaction` key is silently ignored — live in `docs/pi-config-facts.md`.

## Web tool routing

Baseline 2026-09-30, after the Kimi Code plan was added.

- Chinese-language and broad queries, and cost-sensitive work → the default `pi-web-access` path (Kimi Code plan quota, about 4k characters, usable at turn start with no extra `web_enable` hop).
- Precise English retrieval, faithful extraction (tables, formulas), or a primary URL → `provider: exa` explicitly, or the `exa-search` skill. Exa raw output is truncated at 12k characters, which crowds out the Sources list; use `get_search_content` when the source list matters.
- `fallbackOn` degrades only on **failure** (transient, quota, network, invalid response) and never on relevance. Signals that the anchor is too weak: generic results, zero sources, a follow-up question from the user → escalate to exa explicitly and state the reason in the reply; the fallback will not do this on its own.
- Browser channel: `ego-browser` is the default (logged-in pages, screenshots, interaction); `kimi-webbridge` only when the user names Kimi/WebBridge, or when ego is unavailable and webbridge is installed locally. `selftest` checks that the channel is alive, and the skill descriptions are narrowed so the two do not compete for the same requests.
- The two exa paths are split by capability: the in-extension `provider: exa` covers broad search, faithful extraction and primary URLs; strict academic filtering is available through the extension's `category: "research paper"` (0.37.0+, PR #493); the `exa-search` skill still covers batch extraction and academic workflow orchestration.
- Absolute values such as version numbers → local `npm view`; rendered web pages do not carry the version.
- For web-heavy tasks dispatched to a subagent, whitelist tools with `--tools` to keep the tool surface narrow; `source_check` is disabled (zero invocations across all runs).
