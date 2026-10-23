/**
 * Wiring tests for usage-inject.ts
 *
 * Run:
 *   node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     ~/.pi/agent/extensions/productivity/usage-inject.test.mjs
 *
 * Why this file exists: usage-policy.js has its own suite, but the wiring around it — the
 * env kill switch, the interactive/headless gate, the `costSinceInject` bookkeeping and the
 * shape of the injected message — was only ever verified by hand. That is the failure mode
 * nobody notices: the handler is wrapped in try/catch and fails silently, and a renamed
 * context API would simply stop the reports without any signal. These tests assert the
 * wiring, not the policy (whether $0.05 was worth it is the concern of usage-policy.test.mjs).
 */

import test from "node:test";
import assert from "node:assert/strict";

import usageInject from "./usage-inject.ts";
import { DEFAULT_POLICY } from "./usage-policy.js";

const WINDOW = 1_000_000;

/**
 * A fake pi + ExtensionContext pair that replays turns.
 *
 * `collect()` reads only three things: the branch's assistant usages, `getContextUsage()`,
 * and `ctx.model.contextWindow` — so the fake needs exactly those, plus `mode` for the gate.
 */
function harness({ mode = "tui", userTask = true } = {}) {
	const branch = [];
	const sent = [];
	const handlers = [];
	const state = { ctxTokens: 1_000 };
	const pi = {
		on: (event, cb) => handlers.push({ event, cb }),
		sendMessage: (message, options) => sent.push({ message, options }),
	};
	const ctx = {
		mode,
		model: { contextWindow: WINDOW },
		sessionManager: { getBranch: () => branch },
		getContextUsage: () => ({ percent: (state.ctxTokens / WINDOW) * 100, tokens: state.ctxTokens, contextWindow: WINDOW }),
	};
	if (userTask) branch.push({ type: "message", message: { role: "user", content: "do the thing" } });

	/** Replay one completed turn: append its usage, then fire turn_end like pi does. */
	async function turn({ cost, promptTokens = 20_000, ctxTokens, hitPct = 95 }) {
		const cacheRead = Math.round((promptTokens * hitPct) / 100);
		branch.push({
			type: "message",
			message: {
				role: "assistant",
				usage: { input: promptTokens - cacheRead, output: 100, cacheRead, cacheWrite: 0, cost: { total: cost } },
			},
		});
		if (ctxTokens !== undefined) state.ctxTokens = ctxTokens;
		const handler = handlers.find((h) => h.event === "turn_end");
		if (!handler) return;
		await handler.cb({}, ctx);
	}
	return { pi, ctx, turn, sent, events: () => handlers.map((h) => h.event), state };
}

// ── kill switch ───────────────────────────────────────────────────────

test("registers exactly one turn_end handler", () => {
	const h = harness();
	usageInject(h.pi);
	assert.deepEqual(h.events(), ["turn_end"]);
});

test("PI_NO_USAGE_INJECT=1 disables the whole module at load", () => {
	process.env.PI_NO_USAGE_INJECT = "1";
	try {
		const h = harness();
		usageInject(h.pi);
		assert.deepEqual(h.events(), [], "no handler may be registered");
	} finally {
		delete process.env.PI_NO_USAGE_INJECT;
	}
});

// ── interval clause: turn floor AND spend, both required ──────────────

test("no report before the turn floor, even with plenty of spend", async () => {
	const h = harness();
	usageInject(h.pi);
	for (let i = 0; i < DEFAULT_POLICY.everyTurns - 1; i++) await h.turn({ cost: 0.005 });
	assert.equal(h.sent.length, 0, `${DEFAULT_POLICY.everyTurns - 1} turns must stay silent`);
});

test("the first report needs the turn floor and the spend delta, and carries the marker", async () => {
	const h = harness();
	usageInject(h.pi);
	for (let i = 0; i < DEFAULT_POLICY.everyTurns; i++) await h.turn({ cost: 0.005 });
	assert.equal(h.sent.length, 1, `turn ${DEFAULT_POLICY.everyTurns} with $0.125 of new spend must report`);
	const { message, options } = h.sent[0];
	assert.equal(message.customType, "usage");
	assert.equal(message.display, false, "the injection is not shown to the human");
	assert.equal(options.deliverAs, "steer", "steer is what makes it land before the next request");
	assert.match(message.content, new RegExp(`${DEFAULT_POLICY.everyTurns} turns · \\+\\$0\\.\\d+ spend`));
	assert.match(message.content, /status only, not a task$/);
	assert.equal(message.content.includes("\n"), false);
});

test("the counters reset: the next report needs another full interval", async () => {
	const h = harness();
	usageInject(h.pi);
	for (let i = 0; i < DEFAULT_POLICY.everyTurns; i++) await h.turn({ cost: 0.005 });
	assert.equal(h.sent.length, 1);
	for (let i = 0; i < DEFAULT_POLICY.everyTurns - 1; i++) await h.turn({ cost: 0.005 });
	assert.equal(h.sent.length, 1, "still inside the new interval");
	await h.turn({ cost: 0.005 });
	assert.equal(h.sent.length, 2, "second interval completed");
});

// ── headless gate ─────────────────────────────────────────────────────

test("headless (print) suppresses the interval clause", async () => {
	const h = harness({ mode: "print" });
	usageInject(h.pi);
	for (let i = 0; i < DEFAULT_POLICY.everyTurns * 2; i++) await h.turn({ cost: 0.005 });
	assert.equal(h.sent.length, 0, "a one-shot run must not pay a turn for a status line");
});

test("headless still reports a context-tier crossing", async () => {
	const h = harness({ mode: "print" });
	usageInject(h.pi);
	// one warm-up turn: the warn tier is gated on minGapForCtxWarn (an alert is not)
	await h.turn({ cost: 0.005, ctxTokens: 149_000 });
	await h.turn({ cost: 0.005, ctxTokens: 149_500 });
	await h.turn({ cost: 0.005, ctxTokens: 151_000 });
	assert.equal(h.sent.length, 1);
	assert.match(h.sent[0].message.content, /ctx crossed 150k/);
});

test("headless still reports a cost band crossing", async () => {
	const h = harness({ mode: "print" });
	usageInject(h.pi);
	await h.turn({ cost: 0.1 });
	await h.turn({ cost: 0.5 }); // cumulative $0.60 crosses the $0.50 band
	assert.equal(h.sent.length, 1);
	assert.match(h.sent[0].message.content, /cost tier 0→1 \(\$0\.50\)/);
});

// ── fail-quiet ────────────────────────────────────────────────────────

test("a throwing context API never rejects the handler and never sends", async () => {
	const h = harness();
	usageInject(h.pi);
	h.ctx.getContextUsage = () => {
		throw new Error("boom");
	};
	await assert.doesNotReject(async () => {
		for (let i = 0; i < DEFAULT_POLICY.everyTurns + 2; i++) await h.turn({ cost: 0.005 });
	});
	assert.equal(h.sent.length, 0, "silent failure means silence, not a broken session");
});

test("a session without a real user task never reports", async () => {
	const h = harness({ userTask: false });
	usageInject(h.pi);
	for (let i = 0; i < DEFAULT_POLICY.everyTurns + 5; i++) await h.turn({ cost: 0.02 });
	assert.equal(h.sent.length, 0);
});
