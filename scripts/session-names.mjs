#!/usr/bin/env node
/**
 * List pi sessions with the same display name that `/resume` shows.
 *
 * Uses pi's own SessionManager (dist/core/session-manager.js -> SessionManager.listAll),
 * so the output is exactly what the session selector reads — no re-implementation of
 * the session_info lookup, no guessing.
 *
 * Usage:
 *   node session-names.mjs                # newest first
 *   node session-names.mjs --json         # machine-readable (id, name, cwd, modified, path)
 *   node session-names.mjs --stale        # only names that still look auto-generated
 *   node session-names.mjs --cwd <substr> # filter by cwd substring
 *
 * "stale" = the name equals the first ~40 chars of the first user message (pi's
 * auto-name from the productivity extension), or the session has no name at all.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

/** Find the installed pi package dir: env override, pi's host-link, or the global npm root. */
function resolvePiPackageDir() {
	const candidates = [];
	const envDir = process.env.PI_PACKAGE_DIR?.trim();
	if (envDir) candidates.push(envDir);
	candidates.push(join(homedir(), ".pi", "agent", "npm", "host-link"));
	try {
		const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
		if (npmRoot) candidates.push(join(npmRoot, PACKAGE_NAME));
	} catch {
		/* npm unavailable — the other candidates may still hit */
	}
	for (const dir of candidates) {
		if (dir && existsSync(join(dir, "dist", "index.js"))) return dir;
	}
	throw new Error(
		`Could not locate the installed pi package. Tried:\n  ${candidates.join("\n  ")}\n` +
			`Set PI_PACKAGE_DIR to the package directory if pi lives elsewhere.`,
	);
}

async function loadSessionManager() {
	const dir = resolvePiPackageDir();
	const mod = await import(pathToFileURL(join(dir, "dist", "index.js")).href);
	if (!mod.SessionManager) throw new Error(`SessionManager not exported by ${dir}/dist/index.js`);
	return mod.SessionManager;
}

function looksAutoNamed(session) {
	const name = session.name;
	if (!name) return true;
	const first = (session.firstMessage ?? "").replace(/\s+/g, " ").trim();
	if (!first) return false;
	return name.trim() === first.slice(0, 40).trim();
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const staleOnly = args.includes("--stale");
const cwdIdx = args.indexOf("--cwd");
const cwdFilter = cwdIdx >= 0 ? args[cwdIdx + 1] : undefined;

const SessionManager = await loadSessionManager();
const sessions = await SessionManager.listAll();
const now = Date.now();

let rows = sessions
	.map((s) => ({
		id: s.id,
		name: s.name ?? null,
		cwd: s.cwd,
		modified: s.modified,
		path: s.path,
		messageCount: s.messageCount,
		firstMessage: s.firstMessage ?? null,
	}))
	.filter((s) => (cwdFilter ? String(s.cwd).includes(cwdFilter) : true))
	.sort((a, b) => new Date(b.modified) - new Date(a.modified));

if (staleOnly) rows = rows.filter(looksAutoNamed);

if (asJson) {
	console.log(JSON.stringify(rows, null, 2));
} else {
	console.log(`total sessions: ${sessions.length}${rows.length !== sessions.length ? ` (shown: ${rows.length})` : ""}`);
	for (const r of rows) {
		const age = `${((now - new Date(r.modified).getTime()) / 3_600_000).toFixed(1)}h`;
		console.log(
			`${age.padStart(6)}  ${r.id}  ${String(r.messageCount).padStart(4)}msg  ${String(r.name ?? "<NO NAME>").slice(0, 42).padEnd(43)} ${String(r.cwd).slice(0, 40)}`,
		);
	}
}
