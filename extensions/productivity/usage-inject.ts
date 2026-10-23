/**
 * Usage injection (utility module).
 *
 * Motivation (measured 2026-09-19, voxel project): the model cannot see the cost and context
 * figures in the TUI footer, so work continued without any sense of cost — about 40 turns of
 * aesthetic refinement at 19.4M cache-read tokens.
 *
 * Approach: reuse the same data path as footer.ts (assistant usage on the branch plus
 * ctx.getContextUsage()) and, on turn_end, let usage-policy.js decide whether to inject one
 * usage line via pi.sendMessage(..., { deliverAs: "steer" }). "steer" is delivered after the
 * current tool batch and before the next model call, so it can still change this turn's behaviour.
 *
 * Safety: the whole handler is wrapped in try/catch and fails silently — an extension that
 * throws would affect every session the user runs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { shouldInject, formatUsageLine, DEFAULT_POLICY } from "./usage-policy.js";

/**
 * Only print/json are unattended one-shot runs. tui and rpc keep the turn-based throttle,
 * consistent with hasUI semantics. This is a denylist rather than an allowlist so that a mode
 * added later keeps the heartbeat by default instead of silently losing cost awareness.
 */
function interactiveMode(ctx: ExtensionContext): boolean {
	return ctx.mode !== "print" && ctx.mode !== "json";
}

export default function (pi: ExtensionAPI) {
	// Global switch, aligned with PI_NO_NOTIFY in notify.ts. Subagent runners and batch
	// environments can set it to avoid paying the same injection in every child session
	// (observed to fire in child run sessions).
	if (process.env.PI_NO_USAGE_INJECT === "1" || process.env.PI_NO_USAGE_INJECT === "true") return;

	let lastStats: { ctxPct: number; costUsd: number } | null = null;
	// Starts at 0 rather than +Infinity: the 25-turn floor of the interval clause must also hold
	// for the first report, otherwise that report would be driven by cost alone while its reason
	// string cites a turn count that never happened. Urgent cost events are handled by the cost
	// and ctx tiers, which ignore turn count.
	let turnsSinceInject = 0;
	/** Cumulative cost at the last injection: the interval clause requires both an interval and real spend within it (see usage-policy.js). */
	let costAtLastInject = 0;

	/** Aggregate usage from the current branch (same accounting as footer.ts: prompt = input + cacheRead + cacheWrite). */
	function collect(ctx: ExtensionContext) {
		let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
		let lastTurnHitPct = 100;
		for (const e of ctx.sessionManager.getBranch()) {
			const m = (e as { message?: { role?: string; usage?: Record<string, number | { total?: number }> } }).message;
			if (!m?.usage || m.role !== "assistant") continue;
			const u = m.usage as {
				input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
				cost?: { total?: number } | number;
			};
			input += u.input ?? 0;
			output += u.output ?? 0;
			cacheRead += u.cacheRead ?? 0;
			cacheWrite += u.cacheWrite ?? 0;
			cost += typeof u.cost === "number" ? u.cost : (u.cost?.total ?? 0);
			const turnPrompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
			lastTurnHitPct = turnPrompt > 0 ? ((u.cacheRead ?? 0) / turnPrompt) * 100 : 100;
		}
		const prompt = input + cacheRead + cacheWrite;
		const usage = ctx.getContextUsage();
		return {
			prompt, output, cost,
			hitPct: prompt > 0 ? (cacheRead / prompt) * 100 : 0,
			lastTurnHitPct,
			ctxPct: usage?.percent ?? 0,
			ctxTokens: usage?.tokens ?? (usage?.percent != null && usage?.contextWindow ? (usage.percent / 100) * usage.contextWindow : 0),
			contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
		};
	}

	pi.on("turn_end", async (_event, ctx) => {
		try {
			const s = collect(ctx);
			const cur = { ctxPct: s.ctxPct, ctxTokens: s.ctxTokens, costUsd: s.cost, turnCacheHitPct: s.lastTurnHitPct, contextWindow: s.contextWindow };
			const hasPrev = lastStats !== null;
			// Report only after a real user message exists (a fresh session would otherwise spend a turn on a status line).
			const hasUserTask = ctx.sessionManager.getBranch().some((e) => {
				const mm = (e as { message?: { role?: string; content?: unknown } }).message;
				if (mm?.role !== "user") return false;
				const c = mm.content;
				if (typeof c === "string") return c.trim().length > 0;
				return Array.isArray(c) && c.some((x) => (x as { type?: string })?.type === "text" && String((x as { text?: string }).text ?? "").trim().length > 0);
			});
			const prev = lastStats ?? { ctxPct: 0, ctxTokens: 0, costUsd: 0 };
			// Increment before the decision: this turn_end already counts as one elapsed turn, otherwise a 25-turn interval lands on turn 26.
			turnsSinceInject++;
			const { inject, reasons } = shouldInject(
				{
					prev,
					cur,
					turnsSinceInject,
					hasPrev,
					hasUserTask,
					interactive: interactiveMode(ctx),
					costSinceInject: Math.max(0, s.cost - costAtLastInject),
				},
				DEFAULT_POLICY,
			);
			lastStats = { ctxPct: cur.ctxPct, ctxTokens: cur.ctxTokens, costUsd: cur.costUsd };
			if (!inject) return;
			turnsSinceInject = 0;
			costAtLastInject = s.cost;
			pi.sendMessage(
				{
					customType: "usage",
					content: formatUsageLine({ ...s, why: reasons, statusOnly: true }),
					display: false,
				},
				{ deliverAs: "steer" },
			);
		} catch {
			// Fail silently: an accounting anomaly must never affect a normal session.
		}
	});
}
