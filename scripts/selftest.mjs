#!/usr/bin/env node
/**
 * pi config selftest — machine-checkable invariants for ~/.pi/agent
 *
 *   cd ~/.pi/agent/npm && npm run selftest
 *
 * Why this file exists: the 2026-09-20 audit found three defects that all had the
 * same shape — *the config named something that does not exist in the runtime
 * registry*. None were caught by any test, and each surfaced only when the
 * affected feature happened to be invoked:
 *
 *   1. `settings.modelThinkingLevels` had 2 ghost keys (`deepseek/deepseek-v4-flash`
 *      etc.) — they silently did nothing.
 *   2. `extensions/subagent/config.json` had `forkContext.model` pointing at the
 *      same nonexistent id — every explicit `context:"fork"` threw before the
 *      child could start.
 *   3. `npm/node_modules/@earendil-works/pi-coding-agent` was not resolvable, so
 *      every in-process subagent launch failed with ERR_MODULE_NOT_FOUND.
 *
 * Everything below is one of those checks. Add a check whenever a *new* class of
 * "config names something that must exist" appears — not whenever a bug appears.
 *
 * Exit code: 0 only when there are zero FAILs. WARNs never affect the exit code.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AGENT_DIR = process.env.PI_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
const NPM_DIR = path.join(AGENT_DIR, "npm");
const MODULE_DIR = path.join(NPM_DIR, "node_modules");

const fails = [];
const warns = [];
const passes = [];
let group = "";

function check(name, fn) {
	const label = group ? `${group} · ${name}` : name;
	try {
		const problem = fn();
		// A check may report a non-blocking observation via { warn: "…" }.
		if (problem && typeof problem === "object" && problem.warn) {
			warns.push({ label, problem: problem.warn });
			return;
		}
		if (problem) fails.push({ label, problem });
		else passes.push(label);
	} catch (error) {
		fails.push({ label, problem: `检查本身抛错: ${error?.message ?? error}` });
	}
}

function warn(name, problem) {
	warns.push({ label: group ? `${group} · ${name}` : name, problem });
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
const expand = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

/** Minimal `>=a.b.c <d.e.f`-style comparator. Returns null when it cannot judge. */
function satisfies(version, range) {
	const parse = (v) => v.split("-")[0].split(".").map((x) => Number.parseInt(x, 10) || 0);
	const cmp = (a, b) => {
		for (let i = 0; i < 3; i++) {
			const d = (a[i] ?? 0) - (b[i] ?? 0);
			if (d !== 0) return d < 0 ? -1 : 1;
		}
		return 0;
	};
	if (!range || range.trim() === "*") return true;
	const cur = parse(version);
	const ops = range.trim().split(/\s+/);
	for (const op of ops) {
		const m = op.match(/^(>=|<=|>|<|\^|~)?(.*)$/);
		if (!m) return null;
		const [, kind = "", raw] = m;
		if (!/^\d/.test(raw)) return null;
		const want = parse(raw);
		const c = cmp(cur, want);
		if (kind === ">=" && c < 0) return false;
		if (kind === "<=" && c > 0) return false;
		if (kind === ">" && c <= 0) return false;
		if (kind === "<" && c >= 0) return false;
		if (kind === "^" && (c < 0 || parse(version)[0] !== want[0])) return false;
		if (kind === "~" && (c < 0 || parse(version)[1] !== want[1])) return false;
		if (kind === "" && c !== 0) return false;
	}
	return true;
}

// ── config files parse ────────────────────────────────────────────────
group = "JSON";
const SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");
const SUBAGENT_CONFIG_PATH = path.join(AGENT_DIR, "extensions", "subagent", "config.json");
let settings = null;
let subagentConfig = null;

check("settings.json 可解析", () => {
	settings = readJson(SETTINGS_PATH);
	return null;
});
check("extensions/subagent/config.json 可解析", () => {
	subagentConfig = exists(SUBAGENT_CONFIG_PATH) ? readJson(SUBAGENT_CONFIG_PATH) : {};
	return null;
});

// ── the model registry: what can actually be selected ─────────────────
group = "模型注册表";
const storePath = path.join(AGENT_DIR, "models-store.json");
const authPath = path.join(AGENT_DIR, "auth.json");
let registry = new Set();
let registryNote = "未构建";

check("models-store.json / auth.json 可解析", () => {
	const store = readJson(storePath);
	const auth = readJson(authPath);
	const authed = new Set(
		Object.entries(auth)
			.filter(([, v]) => v && typeof v === "object" && (v.key || v.type))
			.map(([k]) => k),
	);
	registry = new Set();
	for (const [provider, entry] of Object.entries(store)) {
		if (!authed.has(provider)) continue;
		for (const model of entry?.models ?? []) {
			const id = typeof model === "string" ? model : model?.id;
			if (id) registry.add(`${provider}/${id}`);
		}
	}
	registryNote = `${registry.size} 个可用模型，来自 ${authed.size} 个已配置密钥的 provider`;
	return registry.size > 0 ? null : "注册表为空：所有 provider 都没有密钥，配置里的任何模型引用都无法验证";
});

const resolves = (id) => registry.has(id);

// ── every model reference must exist in the registry ──────────────────
group = "模型引用";
check("settings.defaultProvider/defaultModel 在注册表中", () => {
	if (!settings) return "settings.json 未解析成功";
	const id = `${settings.defaultProvider}/${settings.defaultModel}`;
	return resolves(id) ? null : `默认模型 ${id} 不在注册表中（${registryNote}）`;
});

check("settings.modelThinkingLevels 每个键都在注册表中", () => {
	if (!settings) return "settings.json 未解析成功";
	const ghosts = Object.keys(settings.modelThinkingLevels ?? {}).filter((k) => !resolves(k));
	return ghosts.length ? `${ghosts.length} 个幽灵键（静默失效）: ${ghosts.join(", ")}` : null;
});

if (subagentConfig?.forkContext) {
	group = "模型引用";
	check("subagent forkContext.model 在注册表中", () => {
		const mode = subagentConfig.forkContext.mode ?? "full";
		if (mode === "pruned" && !subagentConfig.forkContext.model) {
			return "mode=pruned 时 forkContext.model 必填（否则启动前必抛 PrunedForkConfigError）";
		}
		const m = (subagentConfig.forkContext.model ?? "").replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
		if (!m) return null;
		return resolves(m) ? null : `forkContext.model "${m}" 不在注册表中 → 显式 context:"fork" 必抛 "Pruned fork model ... was not found"`;
	});
}

group = "模型引用";
check("agents/*.md 声明的 model 在注册表中", () => {
	const dir = path.join(AGENT_DIR, "agents");
	if (!exists(dir)) return null;
	const bad = [];
	for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
		const raw = fs.readFileSync(path.join(dir, file), "utf8");
		const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		const m = fm?.[1]?.match(/^model\s*:\s*(.+)$/m);
		if (!m) continue;
		const id = m[1].trim().replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
		if (id === "inherit" || id === "inherit-model") continue;
		if (resolves(id)) continue;
		// bare id (no provider prefix) is legal when unique in the registry
		if (!id.includes("/") && [...registry].some((r) => r.split("/")[1] === id)) continue;
		bad.push(`${file} → ${id}`);
	}
	return bad.length ? `不在注册表中: ${bad.join(", ")}` : null;
});

// ── skills ────────────────────────────────────────────────────────────
group = "技能";
check("settings.skills 每个路径都存在", () => {
	if (!settings) return "settings.json 未解析成功";
	const missing = (settings.skills ?? []).filter((p) => !exists(expand(p)));
	return missing.length ? `不存在的路径: ${missing.join(", ")}` : null;
});

check("所有已发现技能 frontmatter 合法且无重名", () => {
	const roots = [path.join(AGENT_DIR, "skills")];
	const found = new Map();
	const bad = [];
	const walk = (dir) => {
		if (!exists(dir)) return;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory() || entry.isSymbolicLink()) walk(p);
			else if (entry.name === "SKILL.md") {
				const raw = fs.readFileSync(p, "utf8");
				const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
				if (!fm) return bad.push(`${p}: 无 frontmatter`);
				const name = fm[1].match(/^name\s*:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
				const desc = fm[1].match(/^description\s*:\s*(.+)$/m)?.[1]?.trim();
				if (!name) return bad.push(`${p}: 缺 name`);
				if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64)
					bad.push(`${p}: name "${name}" 违反 Agent Skills 规范`);
				if (!desc) bad.push(`${p}: 缺 description`);
				else if (desc.length > 1024) bad.push(`${p}: description ${desc.length} 字符 > 1024`);
				if (found.has(name)) bad.push(`技能名 "${name}" 冲突: ${found.get(name)} 与 ${p}`);
				else found.set(name, p);
			}
		}
	};
	for (const r of roots) walk(r);
	return bad.length ? bad.join("; ") : null;
});

// ── the host package must be natively resolvable ───────────────────────
group = "宿主包";
const HOST_PKG = "@earendil-works/pi-coding-agent";
const subagentsDir = path.join(MODULE_DIR, "pi-subagents");
let globalPiVersion = null;

check("全局 pi 包可定位并读出版本", () => {
	const guess = path.join(os.homedir(), ".local", "lib", "node_modules", HOST_PKG, "package.json");
	if (!exists(guess)) return `未找到 ${guess}`;
	globalPiVersion = readJson(guess).version;
	return null;
});

check(`从 pi-subagents 位置可原生解析 ${HOST_PKG}`, () => {
	if (!exists(subagentsDir)) return "pi-subagents 未安装";
	try {
		execFileSync(
			process.execPath,
			["--input-type=module", "-e", `await import(${JSON.stringify(HOST_PKG)})`],
			{ cwd: subagentsDir, stdio: "pipe", timeout: 60_000 },
		);
		return null;
	} catch (error) {
		const detail = String(error?.stderr ?? error?.message ?? error).split("\n").find((l) => l.includes("Cannot find") || l.includes("Error")) ?? "";
		return `原生解析失败 → 所有「前台/进程内」子代理启动都会挂。修复见 README「还原本配置 · 1」。${detail ? ` (${detail.trim()})` : ""}`;
	}
});

check("已解析的宿主包入口文件真实存在", () => {
	const dir = path.join(MODULE_DIR, HOST_PKG);
	if (!exists(dir)) return `${dir} 不存在（符号链接或副本缺失）`;
	const manifest = readJson(path.join(dir, "package.json"));
	const entry = manifest?.exports?.["."]?.import ?? manifest?.exports?.["."]?.default ?? manifest?.main;
	if (!entry) return "package.json 里找不到 exports['.'] / main";
	const target = path.resolve(dir, entry);
	return exists(target) ? null : `manifest 指向 ${entry}，但该文件不存在（别名/解析会在这里失败）`;
});

check("安装的宿主包版本与全局 pi 一致（无陈旧副本）", () => {
	const dir = path.join(MODULE_DIR, HOST_PKG);
	if (!exists(dir) || !globalPiVersion) return null;
	const v = readJson(path.join(dir, "package.json")).version;
	return v === globalPiVersion ? null : `node_modules 里是 ${v}，全局是 ${globalPiVersion} → 子会话会跑与宿主不同版本的 pi`;
});

// ── subagent config semantics ─────────────────────────────────────────
group = "子代理配置";
check("defaultSubagentContext 取值合法", () => {
	const v = subagentConfig?.defaultSubagentContext;
	return v === undefined || v === "fresh" || v === "fork" ? null : `非法值 "${v}"`;
});

check("没有「配了却永远走不到」的 agent defaultContext", () => {
	// fork-context.js: `defaultSubagentContext ?? agentDefaultContext ?? "fresh"` —
	// the config value wins, so an agent-level fork default is dead config.
	if (!subagentConfig?.defaultSubagentContext) return null;
	const dir = path.join(AGENT_DIR, "agents");
	if (!exists(dir)) return null;
	const shadowed = [];
	for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
		const raw = fs.readFileSync(path.join(dir, file), "utf8");
		const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		const dc = fm?.[1]?.match(/^defaultContext\s*:\s*(.+)$/m)?.[1]?.trim();
		if (dc && dc !== subagentConfig.defaultSubagentContext)
			shadowed.push(`${file}(${dc})`);
	}
	return shadowed.length
		? `被 config 的 "${subagentConfig.defaultSubagentContext}" 覆盖，属死声明: ${shadowed.join(", ")}`
		: null;
});

check("maxSubagentSpawnsPerSession / 超时是正整数", () => {
	const bad = [];
	for (const key of ["maxSubagentSpawnsPerSession", "toolTimeoutMs", "checkpointBeforeDeadlineMs"]) {
		const v = subagentConfig?.[key];
		if (v === undefined) continue;
		if (!Number.isInteger(v) || v <= 0) bad.push(`${key}=${JSON.stringify(v)}`);
	}
	return bad.length ? bad.join(", ") : null;
});

check("checkpointBeforeDeadlineMs 小于最短运行时限（否则永不触发）", () => {
	const checkpoint = subagentConfig?.checkpointBeforeDeadlineMs;
	if (!Number.isInteger(checkpoint) || checkpoint <= 0) return null;
	// run deadline 优先级：调用级 > agent frontmatter timeoutMs > config timeoutMs > 内置 30min。
	// 静态可知的下限 = min(agents/*.md 的 timeoutMs, config.timeoutMs, 1_800_000)
	const deadlines = [subagentConfig?.timeoutMs, 1_800_000].filter((v) => Number.isInteger(v) && v > 0);
	const dir = path.join(AGENT_DIR, "agents");
	if (exists(dir)) {
		for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
			const raw = fs.readFileSync(path.join(dir, file), "utf8");
			const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
			const t = fm?.[1]?.match(/^timeoutMs\s*:\s*(\d+)\s*$/m)?.[1];
			if (t) deadlines.push(Number(t));
		}
	}
	const minDeadline = Math.min(...deadlines);
	// subagent-runner.js: checkpointDelayMs = remaining - checkpointBeforeDeadlineMs，
	// 结果 <1000 时静默不挂定时器 —— 即 checkpoint 与最短时限相撞等于关掉收尾 steer。
	return checkpoint <= minDeadline - 1000
		? null
		: `checkpointBeforeDeadlineMs=${checkpoint} 撞上最短时限 ${minDeadline}（差 <1000ms 时定时器静默不挂）→ 子代理死前收不到收尾 steer`;
});

// ── package peer compatibility ────────────────────────────────────────
group = "扩展包";
check("已装包的 @earendil-works/pi-* peer 范围与宿主兼容", () => {
	if (!globalPiVersion) return null;
	const bad = [];
	const packageDirs = [];
	for (const entry of fs.readdirSync(MODULE_DIR)) {
		const full = path.join(MODULE_DIR, entry);
		if (entry.startsWith("@")) {
			for (const inner of fs.readdirSync(full)) packageDirs.push(path.join(full, inner));
		} else {
			packageDirs.push(full);
		}
	}
	for (const dir of packageDirs) {
		const pj = path.join(dir, "package.json");
		if (!exists(pj)) continue;
		let manifest;
		try {
			manifest = readJson(pj);
		} catch {
			continue;
		}
		for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
			if (!name.startsWith("@earendil-works/pi-")) continue;
			if (satisfies(globalPiVersion, range) === false)
				bad.push(`${manifest.name}@${manifest.version} 要求 ${name} "${range}"，宿主是 ${globalPiVersion}`);
		}
	}
	if (bad.length) {
		return {
			warn: `${bad.join("; ")} — 不阻塞运行（pi 用 --legacy-peer-deps），但它意味着该包声明的兼容区间已不覆盖当前 pi`,
		};
	}
	return null;
});

check("node_modules 里没有空的 @scope 残骸", () => {
	if (!exists(MODULE_DIR)) return null;
	const empty = fs
		.readdirSync(MODULE_DIR)
		.filter((e) => e.startsWith("@"))
		.filter((e) => {
			const dir = path.join(MODULE_DIR, e);
			return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
		});
	if (empty.length) return { warn: `${empty.join(", ")} — npm 剪枝残骸，无害但会误导排查` };
	return null;
});

// ── extensions discoverable ───────────────────────────────────────────
group = "扩展";
check("extensions/ 下每个目录都有可用入口", () => {
	const dir = path.join(AGENT_DIR, "extensions");
	if (!exists(dir)) return null;
	const bad = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const at = path.join(dir, entry.name);
		let top = [];
		try {
			top = fs.readdirSync(at);
		} catch {
			continue;
		}
		// Data-only directories (e.g. extensions/subagent/ holds just config.json) are
		// not extension attempts — only flag dirs that contain source but no entry point.
		if (!top.some((f) => f.endsWith(".ts") || f.endsWith(".js"))) continue;
		const hasEntry = top.includes("index.ts") || top.includes("index.js") || top.includes("package.json");
		if (!hasEntry) bad.push(entry.name);
	}
	return bad.length ? `有源码但无 index.ts/index.js/package.json: ${bad.join(", ")}` : null;
});

// ── the extension's own unit tests ────────────────────────────────────
group = "单元测试";
check("usage-policy.js 的 node:test 套件通过", () => {
	const suite = path.join(AGENT_DIR, "extensions", "productivity", "usage-policy.test.mjs");
	if (!exists(suite)) return `缺少测试文件 ${suite}`;
	try {
		execFileSync(
			process.execPath,
			["--test", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", suite],
			{ stdio: "pipe", timeout: 120_000 },
		);
		return null;
	} catch (error) {
		const out = String(error?.stdout ?? "") + String(error?.stderr ?? "");
		const failed = out.match(/^# fail \d+$/m)?.[0] ?? out.split("\n").filter((l) => l.startsWith("✖")).slice(0, 3).join(" | ");
		return `测试未通过: ${failed}`;
	}
});

// ── report ────────────────────────────────────────────────────────────
const R = (s, n) => s + "─".repeat(Math.max(0, n - [...s].length));
const width = 74;
console.log(`\npi config selftest — ${AGENT_DIR}`);
console.log(`pi ${globalPiVersion ?? "?"} · ${registryNote}\n`);
console.log(R("", width));
for (const p of passes) console.log(`  \x1b[32mPASS\x1b[0m  ${p}`);
for (const w of warns) console.log(`  \x1b[33mWARN\x1b[0m  ${w.label}\n        ↳ ${w.problem}`);
for (const f of fails) console.log(`  \x1b[31mFAIL\x1b[0m  ${f.label}\n        ↳ ${f.problem}`);
console.log(R("", width));
console.log(`  ${passes.length} passed · ${warns.length} warned · ${fails.length} failed\n`);

process.exit(fails.length > 0 ? 1 : 0);
