/**
 * Custom Footer extension — prompt volume / cache hit / cost / branch / model.
 *
 * Auto-enabled at session start in TUI mode; /footer toggles it.
 * Token stats come from assistant message usage on the current branch;
 * the git branch comes from footerData (live, updates on branch change).
 *
 * `↑` reports the full prompt volume (input + cacheRead + cacheWrite), the same
 * definition /session uses. It previously reported `input` alone, which
 * understated real context traffic by roughly 35x: prompt-cache reads are ~97%
 * of prompt tokens, so the old figure hid nearly all of the volume and cost.
 *
 * `hit` is the cumulative cache hit rate (cacheRead / prompt). A `⚠` prefix
 * appears when the most recent turn was a full miss, because the cumulative
 * rate stays high long after a single expensive miss and would never alert.
 *
 * Cache semantics worth knowing: provider prompt caches are keyed by model and
 * expire after ~5 minutes idle (pi's CACHE_TTL_MS documents this), so both
 * switching models and resuming a long session after a break re-bill the whole
 * prefix at full price.
 *
 * The right side shows the active model, live context-window usage, and the git
 * branch. Context usage comes from ctx.getContextUsage() and is rendered with
 * pi's own official wording (`ctx 22%/128k`, falling back to `ctx ?`), as used
 * by examples/extensions/border-status-editor.ts.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Context-window usage for the active model. Copied from pi's own
 * examples/extensions/border-status-editor.ts so the wording and the fallback
 * match the official spec. `percent` is null right after compaction, until a
 * fresh assistant response supplies valid usage data; getContextUsage() uses
 * the last assistant usage when available and otherwise estimates the trailing
 * messages, so it is safe to call from render().
 */
function formatContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!contextWindow || !usage || usage.percent === null) {
		return "ctx ?";
	}
	return `ctx ${Math.round(usage.percent)}%/${(contextWindow / 1000).toFixed(0)}k`;
}

export default function (pi: ExtensionAPI) {
	let enabled = false;

	const enable = (ctx: ExtensionContext) => {
		if (enabled || ctx.mode !== "tui") return;
		enabled = true;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					let turns = 0;
					let lastPrompt = 0;
					let lastCacheRead = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cacheRead += m.usage.cacheRead;
							cacheWrite += m.usage.cacheWrite;
							cost += m.usage.cost.total;
							lastPrompt = m.usage.input + m.usage.cacheRead + m.usage.cacheWrite;
							lastCacheRead = m.usage.cacheRead;
							turns++;
						}
					}

					const branch = footerData.getGitBranch();
					const fmt = (n: number) =>
						n < 1000
							? `${n}`
							: n < 1_000_000
								? `${(n / 1000).toFixed(1)}k`
								: `${(n / 1_000_000).toFixed(2)}M`;

					// Full prompt volume, matching /session's own definition.
					const prompt = input + cacheRead + cacheWrite;
					const hit = prompt > 0 ? (cacheRead / prompt) * 100 : 0;

					// A miss needs a previous request to hit against; a session's first
					// turn is uncached by definition and must not be reported as a miss.
					const lastMissed = turns > 1 && lastPrompt > 0 && lastCacheRead / lastPrompt < 0.5;
					const hitColor: "dim" | "success" | "warning" | "error" =
						turns <= 1
							? "dim"
							: lastMissed
								? "error"
								: hit >= 90
									? "success"
									: hit >= 50
										? "warning"
										: "error";

					const left =
						(lastMissed ? theme.fg("error", "⚠ ") : "") +
						theme.fg("dim", `↑${fmt(prompt)} `) +
						theme.fg(hitColor, `hit ${hit.toFixed(1)}%`) +
						theme.fg("dim", ` ↓${fmt(output)} $${cost.toFixed(3)}`);
					const branchStr = branch ? ` (${branch})` : "";
					// Separator and context wording follow the official example.
					const right = theme.fg(
						"dim",
						`${ctx.model?.id || "no-model"} · ${formatContext(ctx)}${branchStr}`,
					);

					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		enable(ctx);
	});

	pi.registerCommand("footer", {
		description: "Toggle the custom footer (prompt / cache hit / cost / model / ctx / branch)",
		handler: async (_args, ctx) => {
			if (!enabled) {
				enable(ctx);
				ctx.ui.notify("Custom footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				enabled = false;
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});
}
