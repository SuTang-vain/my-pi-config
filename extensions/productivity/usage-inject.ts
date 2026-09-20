/**
 * 用量注入（utility module）
 *
 * 动机（实测，2026-09-19 体素项目）：模型看不到 TUI footer 的成本/上下文数字，
 * 于是出现无成本感的长时间打磨 —— 该项目约 40 轮审美微调、19.4M cache-read。
 *
 * 做法：复用 footer.ts 的同一数据路径（branch 上的 assistant usage + ctx.getContextUsage()），
 * 在 turn_end 时按 usage-policy.js 的判定，用 pi.sendMessage(..., {deliverAs:"steer"})
 * 注入一行用量。steer = 当前工具批次结束后、下一次 LLM 调用前送达，因此能改变当轮行为。
 *
 * 安全：整个 handler 包在 try/catch 里并静默失败 —— 一个会抛错的扩展会污染用户所有会话。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { shouldInject, formatUsageLine, DEFAULT_POLICY } from "./usage-policy.js";

export default function (pi: ExtensionAPI) {
	let lastStats: { ctxPct: number; costUsd: number } | null = null;
	let turnsSinceInject = Number.POSITIVE_INFINITY;

	/** 从当前 branch 汇总用量（与 footer.ts 同口径：prompt = input + cacheRead + cacheWrite） */
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
			// 会话里出现过真实用户消息才播报（避免新会话对状态行空转）
			const hasUserTask = ctx.sessionManager.getBranch().some((e) => {
				const mm = (e as { message?: { role?: string; content?: unknown } }).message;
				if (mm?.role !== "user") return false;
				const c = mm.content;
				if (typeof c === "string") return c.trim().length > 0;
				return Array.isArray(c) && c.some((x) => (x as { type?: string })?.type === "text" && String((x as { text?: string }).text ?? "").trim().length > 0);
			});
			const prev = lastStats ?? { ctxPct: 0, ctxTokens: 0, costUsd: 0 };
			const { inject, reasons } = shouldInject({ prev, cur, turnsSinceInject, hasPrev, hasUserTask }, DEFAULT_POLICY);
			lastStats = { ctxPct: cur.ctxPct, ctxTokens: cur.ctxTokens, costUsd: cur.costUsd };
			if (!inject) {
				turnsSinceInject++;
				return;
			}
			turnsSinceInject = 0;
			pi.sendMessage(
				{
					customType: "usage",
					content: formatUsageLine({ ...s, why: reasons }),
					display: false,
				},
				{ deliverAs: "steer" },
			);
		} catch {
			// 静默失败：绝不因为统计口径异常而影响正常会话
		}
	});
}
