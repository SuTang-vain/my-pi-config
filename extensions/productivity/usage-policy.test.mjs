/**
 * Tests for usage-policy.js
 *
 * Run:
 *   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     ~/.pi/agent/extensions/productivity/usage-policy.test.mjs
 *
 * Why this file exists: usage-policy.js is the only non-trivial pure logic in this
 * config (threshold decisions that gate an injection into the model's context).
 * The "crossing" rule — `crossed(t, prev, cur) := prev < t && cur >= t` — is easy to
 * get wrong in a way that is invisible in a short session: a plain `cur >= t` test
 * re-fires on every subsequent turn once a cumulative threshold is passed, so the
 * usage line becomes the noise source it was written to fight. These tests pin the
 * documented intent, not the implementation.
 *
 * Every assertion here was derived from the comments in usage-policy.js and then run
 * against the real module; nothing was copied out of the implementation.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_POLICY, shouldInject, formatUsageLine } from "./usage-policy.js";

/**
 * Baseline that triggers nothing: no threshold crossing, the everyTurns gap not
 * reached, healthy cache, a real user task present.
 */
const BASE = {
	prev: { ctxPct: 0, ctxTokens: 0, costUsd: 0 },
	cur: { ctxPct: 1, ctxTokens: 1_000, costUsd: 0.01, turnCacheHitPct: 100, contextWindow: 1_000_000 },
	turnsSinceInject: 1,
	hasPrev: true,
	hasUserTask: true,
};

/** Deep-merge overrides so each test changes only what it is about. */
function input(over = {}) {
	return {
		...BASE,
		...over,
		prev: { ...BASE.prev, ...(over.prev ?? {}) },
		cur: { ...BASE.cur, ...(over.cur ?? {}) },
	};
}

const reasonsOf = (over) => shouldInject(input(over)).reasons;

// ── totality ──────────────────────────────────────────────────────────

test("is total: no args and an empty object never inject; a bare wrapper still hits the interval", () => {
	assert.equal(shouldInject(undefined).inject, false);
	assert.equal(shouldInject({}).inject, false);
	assert.deepEqual(shouldInject(undefined).reasons, []);
	// hasUserTask:true with everything else absent must not throw. turnsSinceInject
	// defaults to +Infinity, so the first report after a real user message appears comes
	// from the interval clause — that is the designed baseline report, and the
	// hasUserTask gate is what stops a fresh session from running a turn for it.
	const bare = shouldInject({ hasUserTask: true });
	assert.equal(bare.inject, true);
	assert.deepEqual(bare.reasons, [`间隔 ${DEFAULT_POLICY.everyTurns} 轮`]);
});

test("an empty session (no real user task yet) never injects, even at the interval", () => {
	assert.deepEqual(reasonsOf({ hasUserTask: false, turnsSinceInject: 999 }), []);
	assert.equal(shouldInject(input({ hasUserTask: false, turnsSinceInject: 999 })).inject, false);
});

// ── interval ──────────────────────────────────────────────────────────

test("the everyTurns gap is a trigger on its own", () => {
	assert.equal(shouldInject(input({ turnsSinceInject: DEFAULT_POLICY.everyTurns })).inject, true);
	assert.equal(shouldInject(input({ turnsSinceInject: DEFAULT_POLICY.everyTurns - 1 })).inject, false);
	assert.ok(reasonsOf({ turnsSinceInject: DEFAULT_POLICY.everyTurns })[0].includes(`${DEFAULT_POLICY.everyTurns} 轮`));
});

// ── cache ─────────────────────────────────────────────────────────────

test("a cache miss is exempt on the first turn, and reported afterwards", () => {
	assert.equal(shouldInject(input({ hasPrev: false, cur: { turnCacheHitPct: 0 } })).inject, false);
	assert.equal(shouldInject(input({ hasPrev: true, cur: { turnCacheHitPct: 0 } })).inject, true);
});

test("the cache threshold is a strict lower bound (exactly cacheMissPct is not a miss)", () => {
	assert.equal(shouldInject(input({ cur: { turnCacheHitPct: DEFAULT_POLICY.cacheMissPct } })).inject, false);
	assert.equal(shouldInject(input({ cur: { turnCacheHitPct: DEFAULT_POLICY.cacheMissPct - 1 } })).inject, true);
});

// ── ctx thresholds: the crossing rule ─────────────────────────────────

test("crossing the warn tier fires once", () => {
	assert.deepEqual(
		reasonsOf({ prev: { ctxTokens: 149_000 }, cur: { ctxTokens: 151_000 }, turnsSinceInject: DEFAULT_POLICY.minGapForCtxWarn }),
		["ctx 越过 150k"],
	);
});

test("crossing the alert tier fires the alert wording instead of the warn wording", () => {
	assert.deepEqual(reasonsOf({ prev: { ctxTokens: 299_000 }, cur: { ctxTokens: 301_000 } }), [
		"ctx 越过 300k（里程碑后适合 /compact）",
	]);
});

test("ALREADY past a tier stays silent — this is the whole point of crossing semantics", () => {
	// prev is already above both tiers; cur climbs further. A "cur >= t" test would
	// report this on every single turn from here on.
	const r = shouldInject(input({ prev: { ctxTokens: 400_000 }, cur: { ctxTokens: 450_000 } }));
	assert.deepEqual(r.reasons, []);
	assert.equal(r.inject, false);
});

test("sitting exactly on a tier is not a crossing (prev < t is strict)", () => {
	const gap = { turnsSinceInject: DEFAULT_POLICY.minGapForCtxWarn };
	assert.deepEqual(reasonsOf({ ...gap, prev: { ctxTokens: 150_000 }, cur: { ctxTokens: 150_000 } }), []);
	// ...but landing exactly on it from below is.
	assert.deepEqual(reasonsOf({ ...gap, prev: { ctxTokens: 149_999 }, cur: { ctxTokens: 150_000 } }), ["ctx 越过 150k"]);
});

test("the minGap applies to the warn tier only — an alert ignores it", () => {
	// Asymmetry worth knowing: the warn branch is gated on minGapForCtxWarn, the alert
	// branch is not. A warn can wait a turn; an alert is rare and decisive.
	const seed = { turnsSinceInject: 1 };
	assert.deepEqual(reasonsOf({ ...seed, prev: { ctxTokens: 149_000 }, cur: { ctxTokens: 151_000 } }), []);
	assert.deepEqual(reasonsOf({ ...seed, prev: { ctxTokens: 299_000 }, cur: { ctxTokens: 301_000 } }), [
		"ctx 越过 300k（里程碑后适合 /compact）",
	]);
});

test("a large window falls back to the absolute tier, a small one uses the share tier", () => {
	const gap = { turnsSinceInject: DEFAULT_POLICY.minGapForCtxWarn };
	// 1M window: 50% would be 500k, so the 150k absolute tier must win.
	assert.deepEqual(reasonsOf({ ...gap, prev: { ctxTokens: 0 }, cur: { ctxTokens: 150_000 } }), ["ctx 越过 150k"]);
	assert.deepEqual(reasonsOf({ ...gap, prev: { ctxTokens: 0 }, cur: { ctxTokens: 149_000 } }), []);
	// 128k window: 50% is 64k, which is earlier than the absolute tier.
	assert.deepEqual(
		reasonsOf({ ...gap, prev: { ctxTokens: 63_000 }, cur: { ctxTokens: 64_000, contextWindow: 128_000 } }),
		["ctx 越过 64k"],
	);
});

test("a ctx warn arriving too soon after the last injection is suppressed", () => {
	const r = shouldInject(input({ prev: { ctxTokens: 149_000 }, cur: { ctxTokens: 151_000 }, turnsSinceInject: 1 }));
	assert.deepEqual(r.reasons, []);
	assert.equal(r.inject, false);
	// one more turn of gap and it goes through (minGapForCtxWarn === 2)
	assert.deepEqual(
		reasonsOf({ prev: { ctxTokens: 149_000 }, cur: { ctxTokens: 151_000 }, turnsSinceInject: DEFAULT_POLICY.minGapForCtxWarn }),
		["ctx 越过 150k"],
	);
});

// ── cost ──────────────────────────────────────────────────────────────

test("cost reports once per step band, not once ever", () => {
	assert.equal(shouldInject(input({ prev: { costUsd: 0.0 }, cur: { costUsd: 0.49 } })).inject, false);
	assert.equal(shouldInject(input({ prev: { costUsd: 0.4 }, cur: { costUsd: 0.6 } })).inject, true);
	assert.equal(shouldInject(input({ prev: { costUsd: 0.6 }, cur: { costUsd: 0.7 } })).inject, false, "same band");
	assert.equal(shouldInject(input({ prev: { costUsd: 0.9 }, cur: { costUsd: 1.1 } })).inject, true, "next band");
});

test("a multi-band jump is reported once, not once per band", () => {
	const r = reasonsOf({ prev: { costUsd: 0.0 }, cur: { costUsd: 2.6 } });
	assert.equal(r.filter((x) => x.startsWith("成本")).length, 1);
});

// ── policy lock ───────────────────────────────────────────────────────

test("DEFAULT_POLICY is unchanged (thresholds are a deliberate tuning, not incidental)", () => {
	assert.deepEqual(DEFAULT_POLICY, {
		everyTurns: 8,
		ctxWarnPct: 50,
		ctxAlertPct: 75,
		ctxWarnTokens: 150_000,
		ctxAlertTokens: 300_000,
		costWarnUsd: 0.5,
		cacheMissPct: 20,
		minGapForCtxWarn: 2,
	});
});

// ── formatting ────────────────────────────────────────────────────────

test("formatUsageLine emits exactly one line with the documented fields", () => {
	const line = formatUsageLine({
		prompt: 1_953_300,
		output: 20_600,
		cost: 0.063,
		ctxPct: 12,
		contextWindow: 1_000_000,
		hitPct: 95,
		why: ["间隔 8 轮"],
	});
	assert.equal(line.includes("\n"), false, "the injected line must itself be compressible: no newlines");
	assert.match(line, /^\[usage\] /);
	assert.match(line, /↑1953\.3k/);
	assert.match(line, /↓20\.6k/);
	assert.match(line, /\$0\.063/);
	assert.match(line, /ctx 12%\/1000k/);
	assert.match(line, /cache hit 95%/);
	assert.match(line, /触发：间隔 8 轮/);
});

test("formatUsageLine omits the trigger clause when there is no reason, and tolerates missing fields", () => {
	assert.equal(formatUsageLine({ prompt: 0, output: 0, cost: 0, ctxPct: 0, contextWindow: 0, hitPct: 100 }).includes("触发"), false);
	assert.doesNotThrow(() => formatUsageLine({}));
	assert.equal(formatUsageLine({}).startsWith("[usage] "), true);
});
