/**
 * Injection policy for usage reporting — pure functions, zero dependencies, testable with node.
 *
 * Why this module exists: footer.ts shows metrics to the human, but the model cannot see the
 * footer, so work continues without any sense of cost. In this project that produced roughly
 * 40 turns of aesthetic refinement at 19.4M cache-read tokens. Numbers reach the model only if
 * they are injected into its context; but an injection stays in the context permanently, so the
 * decision to inject has to be conservative.
 *
 * Design note: thresholds use "crossing" semantics (prev < t <= cur), not "above" semantics.
 * With "above", cumulative cost or ctx percentage would trigger on every subsequent turn once
 * the threshold is passed, and the reporting would become the source of noise.
 */

export const DEFAULT_POLICY = {
	everyTurns: 25, // lower bound on the interval (subordinate: also requires minCostDeltaUsd)
	minCostDeltaUsd: 0.05, // new spend since the last injection required for an interval report
	ctxWarnPct: 50, // report when ctx crosses 50% of the window
	ctxAlertPct: 75, // report and suggest /compact at 75% of the window
	ctxWarnTokens: 150_000, // absolute budget tier: cost and latency grow with absolute tokens, not only with window share
	ctxAlertTokens: 300_000,
	costWarnUsd: 0.5, // report once per +step of cumulative cost
	cacheMissPct: 20, // a turn cache-hit ratio below this means the prefix was re-billed in full (first turn exempt, see hasPrev)
	minGapForCtxWarn: 2, // minimum gap between ctx-class reports
};

/**
 * @param {{prev: Stats, cur: Stats, turnsSinceInject: number, costSinceInject: number, interactive: boolean}} input
 *   Stats: { ctxPct, costUsd, turnCacheHitPct }
 *   interactive: true only when a human drives the session (TUI/RPC). In headless modes
 *   (print/json) the interval clause is suppressed — see the note at the interval test.
 *   costSinceInject: spend since the last injection; the interval clause is subordinate to it.
 * @returns {{inject: boolean, reasons: string[]}}
 */
export function shouldInject(input, policy = DEFAULT_POLICY) {
	// Guard null as well as undefined on both stat objects: callers that throw are swallowed by
	// the extension's try/catch, which would silently disable the whole feature
	// (observed in a replay harness on 2026-10-11).
	const { turnsSinceInject = Number.POSITIVE_INFINITY, hasPrev = false, hasUserTask = false, interactive = true, costSinceInject = 0 } = input ?? {};
	const prev = input?.prev ?? {};
	const cur = input?.cur ?? {};
	// No user task in this session yet: nothing to report. A fresh session otherwise spends a
	// turn reporting a status line (cfgtest2).
	if (!hasUserTask) return { inject: false, reasons: [] };
	const reasons = [];
	const crossed = (t, a, b) => (Number.isFinite(a) ? a : 0) < t && (Number.isFinite(b) ? b : 0) >= t;

	// ctx thresholds take whichever comes first: absolute budget or window share.
	// A 128k model follows 50%/75%; a 1000k-window model is covered by the 150k/300k tiers
	// (otherwise it would never trigger).
	const window = Number.isFinite(cur.contextWindow) ? cur.contextWindow : 0;
	const warnAt = window > 0 ? Math.min(policy.ctxWarnTokens, (policy.ctxWarnPct / 100) * window) : policy.ctxWarnTokens;
	const alertAt = window > 0 ? Math.min(policy.ctxAlertTokens, (policy.ctxAlertPct / 100) * window) : policy.ctxAlertTokens;
	const tok = Number.isFinite(cur.ctxTokens) ? cur.ctxTokens : 0;
	if (crossed(alertAt, prev.ctxTokens, tok)) reasons.push(`ctx crossed ${Math.round(alertAt / 1000)}k (a good point to /compact after a milestone)`);
	else if (crossed(warnAt, prev.ctxTokens, tok) && turnsSinceInject >= policy.minGapForCtxWarn) {
		reasons.push(`ctx crossed ${Math.round(warnAt / 1000)}k`);
	}
	// Cost uses tiered crossings: report once per +step (a single threshold fires only once,
	// and reporting less as spend rises is the wrong behaviour).
	const step = policy.costWarnUsd;
	if (step > 0 && Number.isFinite(cur.costUsd)) {
		const t0 = Math.floor((Number.isFinite(prev.costUsd) ? prev.costUsd : 0) / step);
		const t1 = Math.floor(cur.costUsd / step);
		if (t1 > t0) reasons.push(`cost tier ${t0}→${t1} ($${(t1 * step).toFixed(2)})`);
	}
	// First turn is exempt: a new session or a fresh /reload has no cached prefix yet, so
	// reporting it is noise (observed in a herdr verification session).
	if (hasPrev && Number.isFinite(cur.turnCacheHitPct) && cur.turnCacheHitPct < policy.cacheMissPct) {
		reasons.push("cache fully missed this turn (prefix re-billed in full)");
	}
	// The interval clause is subordinate, not a trigger: it reports only when spend actually
	// occurred during that interval (costSinceInject at or above the threshold). Rationale
	// (measured 2026-10-11): 21 of 23 injections in one session came from this clause alone —
	// 91% of the volume at the lowest value, since cost-tier and ctx reports already cover the
	// "cost blindness" target. It is also meaningful only while a human watches the screen; in
	// headless modes it buys one extra turn to say that nothing needs doing.
	// costSinceInject defaults to 0, i.e. no evidence of spend means no interruption,
	// so older callers do not start reporting.
	if (interactive && turnsSinceInject >= policy.everyTurns && costSinceInject >= policy.minCostDeltaUsd)
		reasons.push(`${policy.everyTurns} turns · +$${costSinceInject.toFixed(2)} spend`);

	return { inject: reasons.length > 0, reasons };
}

/** Single line, no details: the injected text must itself be compactable away. */
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
	if (s.why?.length) parts.push(`triggers: ${s.why.join('; ')}`);
	// The injection is a user-role message and can be mistaken for a task; state explicitly that
	// it is not one (about 9 tokens of insurance).
	if (s.statusOnly) parts.push('status only, not a task');
	return `[usage] ${parts.join(' · ')}`;
}
