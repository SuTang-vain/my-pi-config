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
		fails.push({ label, problem: `check itself threw: ${error?.message ?? error}` });
	}
}

function warn(name, problem) {
	warns.push({ label: group ? `${group} · ${name}` : name, problem });
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
// A whitelist entry written as `~/.pi/agent/...` names the install root, so it follows AGENT_DIR
// (PI_AGENT_DIR) rather than a possibly different real home. Everything else expands normally.
const expand = (p) => {
	if (!p.startsWith("~/")) return p;
	const abs = path.join(os.homedir(), p.slice(2));
	const root = path.join(os.homedir(), ".pi", "agent");
	if (AGENT_DIR !== root && (abs === root || abs.startsWith(root + path.sep)))
		return path.join(AGENT_DIR, abs.slice(root.length + 1));
	return abs;
};

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

check("settings.json parses", () => {
	settings = readJson(SETTINGS_PATH);
	return null;
});
check("extensions/subagent/config.json parses", () => {
	subagentConfig = exists(SUBAGENT_CONFIG_PATH) ? readJson(SUBAGENT_CONFIG_PATH) : {};
	return null;
});

// ── the model registry: what can actually be selected ─────────────────
group = "model registry";
const storePath = path.join(AGENT_DIR, "models-store.json");
const authPath = path.join(AGENT_DIR, "auth.json");
let registry = new Set();
let registryNote = "not built";

check("models-store.json / auth.json parse", () => {
	const store = readJson(storePath);
	// auth.json is deliberately unmanaged and may not exist yet; treat that as "no provider".
	const auth = exists(authPath) ? readJson(authPath) : {};
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
	registryNote = `${registry.size} models available from ${authed.size} providers with credentials`;
	if (registry.size > 0) return null;
	// No credentials yet (auth.json is unmanaged and optional): the references cannot be verified,
	// but nothing is broken — this is a warning, not a failure.
	warn("models-store.json / auth.json parse", "no provider credentials yet; model references are not checked");
	return null;
});

const resolves = (id) => registry.has(id);

// ── every model reference must exist in the registry ──────────────────
group = "model references";
check("settings.defaultProvider/defaultModel resolve in the registry", () => {
	if (!settings) return "settings.json did not parse";
	if (registry.size === 0) return null;
	const id = `${settings.defaultProvider}/${settings.defaultModel}`;
	return resolves(id) ? null : `default model ${id} is not in the registry (${registryNote})`;
});

check("every settings.modelThinkingLevels key resolves in the registry", () => {
	if (!settings) return "settings.json did not parse";
	if (registry.size === 0) return null;
	const ghosts = Object.keys(settings.modelThinkingLevels ?? {}).filter((k) => !resolves(k));
	return ghosts.length ? `${ghosts.length} ghost keys (silently ignored): ${ghosts.join(", ")}` : null;
});

if (subagentConfig?.forkContext) {
	group = "model references";
	check("subagent forkContext.model resolves in the registry", () => {
		const mode = subagentConfig.forkContext.mode ?? "full";
		if (mode === "pruned" && !subagentConfig.forkContext.model) {
			return "forkContext.model is required when mode=pruned (otherwise PrunedForkConfigError is thrown before start)";
		}
		const m = (subagentConfig.forkContext.model ?? "").replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
		if (!m) return null;
		return resolves(m) ? null : `forkContext.model "${m}" is not in the registry → an explicit context:"fork" throws "Pruned fork model ... was not found"`;
	});
}

group = "model references";
check("models declared in agents/*.md resolve in the registry", () => {
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
	return bad.length ? `not in the registry: ${bad.join(", ")}` : null;
});

// ── skills ────────────────────────────────────────────────────────────
group = "skills";
check("every settings.skills path exists", () => {
	if (!settings) return "settings.json did not parse";
	const missing = (settings.skills ?? []).filter((p) => !exists(expand(p)));
	return missing.length ? `missing paths: ${missing.join(", ")}` : null;
});

check("all discovered skill frontmatter is valid YAML with unique names", () => {
	// Roots: `skills/` plus `skills-optional/`. The latter was previously unscanned —
	// which is how two skills with invalid frontmatter stayed invisible to this test.
	const roots = [path.join(AGENT_DIR, "skills"), path.join(AGENT_DIR, "skills-optional")];
	let YAML;
	try {
		YAML = createRequire(path.join(NPM_DIR, "package.json"))("yaml");
	} catch {
		return { warn: "the yaml package is unavailable; SKILL.md frontmatter cannot be parsed" };
	}
	const found = new Map();
	const bad = [];
	const seen = new Set();
	const walk = (dir) => {
		if (!exists(dir)) return;
		let real;
		try {
			real = fs.realpathSync(dir);
		} catch {
			return;
		}
		if (seen.has(real)) return; // symlinked roots / dup paths visit once
		seen.add(real);
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return; // unreadable directory is not a skill problem
		}
		for (const entry of entries) {
			// Two walker bugs were found here on 2026-09-20, in opposite directions:
			//   • NOT following symlinked DIRECTORIES silently skipped a whole tree
			//     (`skills/ego-browser` is a symlink) — a false negative.
			//   • Following symlinked FILES (`skills-optional/pdf-reader/.venv/bin/python`)
			//     made readdirSync throw ENOTDIR — a crash.
			// So: skip dot-entries, and recurse only after proving the target is a directory.
			if (entry.name.startsWith(".")) continue;
			const p = path.join(dir, entry.name);
			let isDir = entry.isDirectory();
			if (!isDir && entry.isSymbolicLink()) {
				try {
					isDir = fs.statSync(p).isDirectory();
				} catch {
					isDir = false;
				}
			}
			if (isDir) walk(p);
			else if (entry.name === "SKILL.md") {
				const raw = fs.readFileSync(p, "utf8");
				const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
				if (!fm) return bad.push(`${p}: no frontmatter`);
				// A real YAML parse, not regex field-extraction. A plain (unquoted) scalar
				// containing ": " makes the whole frontmatter invalid — "Nested mappings
				// are not allowed in compact mappings" — and the skill silently fails to
				// load. Regex extraction still finds name/description in such a file, so it
				// reported a false green on 2026-09-20 (2 of 17 skills).
				let doc;
				try {
					doc = YAML.parse(fm[1]);
				} catch (error) {
					return bad.push(`${p}: frontmatter is not valid YAML — ${String(error?.message ?? error).split("\n")[0]}`);
				}
				if (!doc || typeof doc !== "object" || Array.isArray(doc)) return bad.push(`${p}: frontmatter did not parse to a mapping`);
				if (typeof doc.name !== "string" || !doc.name.trim()) return bad.push(`${p}: missing name`);
				const name = doc.name.trim();
				if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64)
					bad.push(`${p}: name "${name}" violates the Agent Skills spec`);
				if (typeof doc.description !== "string" || !doc.description.trim()) bad.push(`${p}: missing description`);
				else if (doc.description.length > 1024) bad.push(`${p}: description is ${doc.description.length} characters > 1024`);
				if (found.has(name)) bad.push(`skill name "${name}" collides: ${found.get(name)} and ${p}`);
				else found.set(name, p);
			}
		}
	};
	for (const r of roots) walk(r);
	return bad.length ? bad.join("; ") : null;
});

// ── the host package must be natively resolvable ───────────────────────
group = "host package";
const HOST_PKG = "@earendil-works/pi-coding-agent";
const subagentsDir = path.join(MODULE_DIR, "pi-subagents");
let globalPiVersion = null;
let globalPiDir = null;

check("the pi host package is locatable and its version readable", () => {
	// Three layouts are in use: the managed installer (install/current-version ->
	// install/releases/<v>/node_modules), an extension dependency tree, and a global npm prefix.
	const candidates = [];
	try {
		const managed = fs.readFileSync(path.join(AGENT_DIR, "install", "current-version"), "utf8").trim();
		if (managed) candidates.push(path.join(AGENT_DIR, "install", "releases", managed, "node_modules", HOST_PKG, "package.json"));
	} catch {
		// no managed installer on this machine
	}
	candidates.push(path.join(MODULE_DIR, HOST_PKG, "package.json"));
	candidates.push(path.join(os.homedir(), ".local", "lib", "node_modules", HOST_PKG, "package.json"));
	const found = candidates.find((p) => exists(p));
	if (!found) return `not found in any of:\n${candidates.map((c) => `  ${c}`).join("\n")}`;
	globalPiDir = path.dirname(found);
	globalPiVersion = readJson(found).version;
	return null;
});

check(`native resolution of ${HOST_PKG} from the pi-subagents location`, () => {
	if (!exists(subagentsDir)) return "pi-subagents is not installed";
	try {
		execFileSync(
			process.execPath,
			["--input-type=module", "-e", `await import(${JSON.stringify(HOST_PKG)})`],
			{ cwd: subagentsDir, stdio: "pipe", timeout: 60_000 },
		);
		return null;
	} catch (error) {
		const detail = String(error?.stderr ?? error?.message ?? error).split("\n").find((l) => l.includes("Cannot find") || l.includes("Error")) ?? "";
		return `native resolution failed → every foreground/in-process subagent would fail to start. See README "Restoring this configuration · 1".${detail ? ` (${detail.trim()})` : ""}`;
	}
});

check("the resolved host package entry file exists", () => {
	const dir = path.join(MODULE_DIR, HOST_PKG);
	if (!exists(dir)) return `${dir} does not exist (missing symlink or copy)`;
	const manifest = readJson(path.join(dir, "package.json"));
	const entry = manifest?.exports?.["."]?.import ?? manifest?.exports?.["."]?.default ?? manifest?.main;
	if (!entry) return "package.json has no exports['.'] / main";
	const target = path.resolve(dir, entry);
	return exists(target) ? null : `manifest points at ${entry}, which does not exist (aliasing/resolution fails here)`;
});

check("the installed host package version matches the global pi (no stale copy)", () => {
	const dir = path.join(MODULE_DIR, HOST_PKG);
	if (!exists(dir) || !globalPiVersion) return null;
	const v = readJson(path.join(dir, "package.json")).version;
	return v === globalPiVersion ? null : `node_modules has ${v} while the global version is ${globalPiVersion} → child sessions would run a different pi`;
});

check("host-link resolves to the active host package", () => {
	const link = path.join(NPM_DIR, "host-link");
	if (!exists(link) || !globalPiDir) return `${link} is missing or the active host is unknown`;
	try {
		const linked = fs.realpathSync(link);
		const active = fs.realpathSync(globalPiDir);
		return linked === active ? null : `host-link resolves to ${linked}, active host is ${active} → run pi-config-update`;
	} catch (error) {
		return `host-link cannot be resolved: ${error?.message ?? error}`;
	}
});

check("direct host dependencies use local links to the active host", () => {
	if (!globalPiDir) return null;
	const manifest = readJson(path.join(NPM_DIR, "package.json"));
	const names = Object.keys(manifest.dependencies ?? {}).filter(
		(name) => name.startsWith("@earendil-works/pi-") && name !== HOST_PKG,
	);
	const problems = [];
	for (const name of names) {
		const base = path.basename(name);
		const spec = `file:host-deps/${base}`;
		if (manifest.dependencies[name] !== spec) problems.push(`${name}: manifest has ${manifest.dependencies[name]}, expected ${spec}`);
		const expected = path.join(path.dirname(globalPiDir), base);
		try {
			if (fs.realpathSync(path.join(NPM_DIR, "host-deps", base)) !== fs.realpathSync(expected))
				problems.push(`${name}: host-deps points away from the active host`);
			if (fs.realpathSync(path.join(MODULE_DIR, name)) !== fs.realpathSync(expected))
				problems.push(`${name}: node_modules points away from the active host`);
		} catch {
			problems.push(`${name}: host-deps or node_modules link is missing`);
		}
	}
	return problems.length ? `${problems.join("; ")} → run pi-config-update` : null;
});

// ── subagent config semantics ─────────────────────────────────────────
group = "subagent configuration";
check("defaultSubagentContext has a valid value", () => {
	const v = subagentConfig?.defaultSubagentContext;
	return v === undefined || v === "fresh" || v === "fork" ? null : `invalid value "${v}"`;
});

check("no agent defaultContext is shadowed and therefore dead", () => {
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
		? `overridden by config's "${subagentConfig.defaultSubagentContext}" and therefore dead: ${shadowed.join(", ")}`
		: null;
});

check("maxSubagentSpawnsPerSession and timeouts are positive integers", () => {
	const bad = [];
	for (const key of ["maxSubagentSpawnsPerSession", "toolTimeoutMs", "checkpointBeforeDeadlineMs"]) {
		const v = subagentConfig?.[key];
		if (v === undefined) continue;
		if (!Number.isInteger(v) || v <= 0) bad.push(`${key}=${JSON.stringify(v)}`);
	}
	return bad.length ? bad.join(", ") : null;
});

check("checkpointBeforeDeadlineMs is below the shortest run deadline (otherwise it never fires)", () => {
	const checkpoint = subagentConfig?.checkpointBeforeDeadlineMs;
	if (!Number.isInteger(checkpoint) || checkpoint <= 0) return null;
	// Run deadline precedence: call level > agent frontmatter timeoutMs > config timeoutMs > built-in 30 min.
	// Statically known lower bound = min(timeoutMs in agents/*.md, config.timeoutMs, 1_800_000)
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
	// A result <1000 schedules no timer silently: a checkpoint colliding with the shortest deadline disables the closing steer.
	return checkpoint <= minDeadline - 1000
		? null
		: `checkpointBeforeDeadlineMs=${checkpoint} collides with the shortest deadline ${minDeadline} (a gap <1000ms schedules no timer) → a subagent never receives the closing steer`;
});

// ── package peer compatibility ────────────────────────────────────────
group = "extension packages";
check("installed packages' @earendil-works/pi-* peer ranges are compatible with the host", () => {
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
				bad.push(`${manifest.name}@${manifest.version} requires ${name} "${range}" while the host is ${globalPiVersion}`);
		}
	}
	if (bad.length) {
		return {
			warn: `${bad.join("; ")} — does not block execution (pi uses --legacy-peer-deps), but the declared compatibility range no longer covers the current pi`,
		};
	}
	return null;
});

check("no empty @scope leftovers in node_modules", () => {
	if (!exists(MODULE_DIR)) return null;
	const empty = fs
		.readdirSync(MODULE_DIR)
		.filter((e) => e.startsWith("@"))
		.filter((e) => {
			const dir = path.join(MODULE_DIR, e);
			return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0;
		});
	if (empty.length) return { warn: `${empty.join(", ")} — npm pruning leftovers, harmless but misleading during diagnosis` };
	return null;
});

// ── extensions discoverable ───────────────────────────────────────────
group = "extensions";
check("every directory under extensions/ has a usable entry point", () => {
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
	return bad.length ? `sources present but no index.ts/index.js/package.json: ${bad.join(", ")}` : null;
});

// ── the extension's own unit tests ────────────────────────────────────
group = "unit tests";
check("the node:test suite for usage-policy.js passes", () => {
	const suite = path.join(AGENT_DIR, "extensions", "productivity", "usage-policy.test.mjs");
	if (!exists(suite)) return `missing test file ${suite}`;
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
		return `tests failed: ${failed}`;
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
