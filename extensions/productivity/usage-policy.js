/**
 * 用量注入的判定策略 —— 纯函数、零依赖，可用 node 直接测。
 *
 * 为什么要有这个模块：footer.ts 已经把指标显示给「人」，但模型看不到 footer，
 * 于是出现「无成本感的打磨」——本项目的实测代价是约 40 轮审美微调与 19.4M cache-read。
 * 把数字送进模型上下文才能改变决策；但注入会永久留在上下文里，所以判定必须克制。
 *
 * 关键设计：阈值用「跨越」语义（prev < t ≤ cur）而非「高于」语义。
 * 否则累计成本、ctx 百分比一旦越过阈值，之后每一轮都会播报 —— 注入自己变成噪声源。
 */

export const DEFAULT_POLICY = {
	everyTurns: 8, // 至少间隔多少轮播报一次
	ctxWarnPct: 50, // ctx 越过窗口 50% 播报
	ctxAlertPct: 75, // ctx 越过窗口 75% 播报并建议在里程碑后 /compact
	ctxWarnTokens: 150_000, // 绝对预算档：成本/延迟随绝对 token 增长，不只随窗口占比
	ctxAlertTokens: 300_000,
	costWarnUsd: 0.5, // 累计成本每 +此值 播报一档
	cacheMissPct: 20, // 本轮 cache 命中率低于此值 = 前缀被完整重计费（首轮豁免，见 hasPrev）
	minGapForCtxWarn: 2, // ctx 类播报的最小间隔（避免连着两轮都说）
};

/**
 * @param {{prev: Stats, cur: Stats, turnsSinceInject: number}} input
 *   Stats: { ctxPct, costUsd, turnCacheHitPct }
 * @returns {{inject: boolean, reasons: string[]}}
 */
export function shouldInject(input, policy = DEFAULT_POLICY) {
	const { prev = {}, cur = {}, turnsSinceInject = Number.POSITIVE_INFINITY, hasPrev = false, hasUserTask = false } = input ?? {};
	// 会话还没有任何用户任务时不播报：实测新会话会为一个纯状态行空转一轮（cfgtest2）
	if (!hasUserTask) return { inject: false, reasons: [] };
	const reasons = [];
	const crossed = (t, a, b) => (Number.isFinite(a) ? a : 0) < t && (Number.isFinite(b) ? b : 0) >= t;

	// ctx 阈值取「绝对预算」与「窗口占比」中更早到的那条：
	// 128k 模型按 50%/75% 走；1000k 窗口模型改由 150k/300k 绝对档兜住（否则永不触发）
	const window = Number.isFinite(cur.contextWindow) ? cur.contextWindow : 0;
	const warnAt = window > 0 ? Math.min(policy.ctxWarnTokens, (policy.ctxWarnPct / 100) * window) : policy.ctxWarnTokens;
	const alertAt = window > 0 ? Math.min(policy.ctxAlertTokens, (policy.ctxAlertPct / 100) * window) : policy.ctxAlertTokens;
	const tok = Number.isFinite(cur.ctxTokens) ? cur.ctxTokens : 0;
	if (crossed(alertAt, prev.ctxTokens, tok)) reasons.push(`ctx 越过 ${Math.round(alertAt / 1000)}k（里程碑后适合 /compact）`);
	else if (crossed(warnAt, prev.ctxTokens, tok) && turnsSinceInject >= policy.minGapForCtxWarn) {
		reasons.push(`ctx 越过 ${Math.round(warnAt / 1000)}k`);
	}
	// 成本用「分档跨越」：每+$step 播报一次（单阈值只会响一次，越花越安静是错误行为）
	const step = policy.costWarnUsd;
	if (step > 0 && Number.isFinite(cur.costUsd)) {
		const t0 = Math.floor((Number.isFinite(prev.costUsd) ? prev.costUsd : 0) / step);
		const t1 = Math.floor(cur.costUsd / step);
		if (t1 > t0) reasons.push(`成本 ${t0}→${t1} 档（$${(t1 * step).toFixed(2)}）`);
	}
	// 首轮豁免：新会话/刚 /reload 时本就没有缓存前缀，报它是噪声（实测于 herdr 验证会话）
	if (hasPrev && Number.isFinite(cur.turnCacheHitPct) && cur.turnCacheHitPct < policy.cacheMissPct) {
		reasons.push("本轮 cache 全 miss（前缀被完整重计费）");
	}
	if (turnsSinceInject >= policy.everyTurns) reasons.push(`间隔 ${policy.everyTurns} 轮`);

	return { inject: reasons.length > 0, reasons };
}

/** 单行、无 details —— 注入物自身也必须「可被压缩掉」 */
export function formatUsageLine(s) {
	const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n ?? 0)));
	const pct = (n) => (Number.isFinite(n) ? Math.round(n) : 0);
	const parts = [
		`↑${k(s.prompt)}`,
		`↓${k(s.output)}`,
		`$${(s.cost ?? 0).toFixed(3)}`,
		`ctx ${pct(s.ctxPct)}%/${Math.round((s.contextWindow ?? 0) / 1000)}k`,
		`cache hit ${pct(s.hitPct)}%`,
	];
	if (s.why?.length) parts.push(`触发：${s.why.join('、')}`);
	return `[usage] ${parts.join(' · ')}`;
}
