#!/usr/bin/env node
/**
 * Rename pi sessions — appends one `session_info` entry, exactly like pi's own
 * SessionManager.appendSessionInfo (dist/core/session-manager.js):
 *
 *   {type:"session_info", id:<randomUUID().slice(0,8)>, parentId:<current leaf>,
 *    timestamp:<ISO>, name:<sanitized>}
 *
 * Why append (not rewrite): pi reads the name with getSessionName(), which walks the
 * session file in reverse and returns the last session_info entry — independent of the
 * tree/branch. Appending therefore never touches history, and cannot break a session.
 *
 * Caveat: a session that is running right now keeps its old name in memory until it is
 * restarted or resumed; the file (and thus /resume) shows the new name immediately.
 *
 * Usage:
 *   node session-rename.mjs --list
 *   node session-rename.mjs --set <id-prefix> "<new name>"
 *   node session-rename.mjs --names <file.json|-> [--dry-run]
 *
 * --names JSON shape: {"<id-prefix>": "<new name>", ...}   ("-" reads stdin)
 * Options:
 *   --dry-run        print what would be appended, write nothing
 *   --no-backup      skip the per-file backup copy
 *   --backup <dir>   backup directory (default: $TMPDIR/pi-session-renames-<timestamp>)
 *   --no-verify      skip the read-back verification
 *
 * Exit code is non-zero if any rename failed verification.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

function resolvePiPackageDir() {
	const candidates = [];
	const envDir = process.env.PI_PACKAGE_DIR?.trim();
	if (envDir) candidates.push(envDir);
	candidates.push(join(homedir(), ".pi", "agent", "npm", "host-link"));
	try {
		const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
		if (npmRoot) candidates.push(join(npmRoot, PACKAGE_NAME));
	} catch {
		/* npm unavailable */
	}
	for (const dir of candidates) {
		if (dir && existsSync(join(dir, "dist", "index.js"))) return dir;
	}
	throw new Error(`Could not locate the installed pi package. Tried:\n  ${candidates.join("\n  ")}`);
}

async function loadSessionManager() {
	const dir = resolvePiPackageDir();
	const mod = await import(pathToFileURL(join(dir, "dist", "index.js")).href);
	if (!mod.SessionManager) throw new Error(`SessionManager not exported by ${dir}/dist/index.js`);
	return mod.SessionManager;
}

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

const dryRun = flag("--dry-run");
const noBackup = flag("--no-backup");
const noVerify = flag("--no-verify");
const backupDir = value("--backup") ?? join(tmpdir(), `pi-session-renames-${Date.now()}`);
const doList = flag("--list");
const setName = value("--set");
const namesFile = value("--names");

const SessionManager = await loadSessionManager();
const sessions = await SessionManager.listAll();

function findSession(prefix) {
	const hits = sessions.filter((s) => s.id === prefix || s.id.startsWith(prefix));
	if (hits.length === 0) throw new Error(`No session matches id prefix "${prefix}"`);
	if (hits.length > 1) throw new Error(`Ambiguous id prefix "${prefix}": ${hits.map((h) => h.id).join(", ")}`);
	return hits[0];
}

function buildEntry(session, name) {
	const lines = readFileSync(session.path, "utf-8").split("\n").filter((l) => l.trim().length > 0);
	const usedIds = new Set();
	let leafId = null;
	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			if (entry.id) usedIds.add(entry.id);
		} catch {
			/* tolerate a partially written trailing line */
		}
	}
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			const entry = JSON.parse(lines[i]);
			if (entry.id) {
				leafId = entry.id;
				break;
			}
		} catch {
			/* keep looking upwards */
		}
	}
	if (!leafId) throw new Error(`Cannot determine the current leaf of ${session.path}`);

	let id = randomUUID().slice(0, 8);
	while (usedIds.has(id)) id = randomUUID().slice(0, 8);

	const sanitizedName = name.replace(/[\r\n]+/g, " ").trim();
	if (!sanitizedName) throw new Error("Empty name — refusing to write (an empty name clears the title)");

	return {
		entry: { type: "session_info", id, parentId: leafId, timestamp: new Date().toISOString(), name: sanitizedName },
		lineCount: lines.length,
	};
}

function renameSession(session, newName) {
	const { entry, lineCount } = buildEntry(session, newName);
	const before = session.name ?? "<NO NAME>";
	const rendered = JSON.stringify(entry);

	if (dryRun) {
		console.log(`[dry-run] ${session.id}  ${before}  ->  ${entry.name}`);
		console.log(`          file: ${session.path} (${lineCount} entries)  append: ${rendered}`);
		return { ok: true, verified: null };
	}

	if (!noBackup) {
		mkdirSync(backupDir, { recursive: true });
		const dest = join(backupDir, `${session.id}-${Date.now()}.jsonl`);
		copyFileSync(session.path, dest);
	}

	appendFileSync(session.path, `${rendered}\n`);

	let verified = null;
	if (!noVerify) {
		const reopened = SessionManager.open(session.path);
		const readBack = reopened.getSessionName();
		verified = readBack === entry.name;
		if (!verified) console.error(`  !! verification failed for ${session.id}: read back "${readBack}"`);
	}
	console.log(`${verified === false ? "FAIL" : "ok"}  ${session.id}  ${before}  ->  ${entry.name}`);
	return { ok: verified !== false, verified };
}

// ---------------------------------------------------------------- main

if (doList) {
	for (const s of sessions) {
		console.log(`${s.id}  ${String(s.name ?? "<NO NAME>").slice(0, 46).padEnd(47)} ${s.cwd}`);
	}
	process.exit(0);
}

let targets; // [{ prefix, name }]
if (setName) {
	const prefix = argv[argv.indexOf("--set") + 1];
	const rest = argv.slice(argv.indexOf("--set") + 2).filter((a) => !a.startsWith("--"));
	targets = [{ prefix, name: rest.join(" ") }];
} else if (namesFile) {
	const raw = namesFile === "-" ? readFileSync(0, "utf-8") : readFileSync(namesFile, "utf-8");
	targets = Object.entries(JSON.parse(raw)).map(([prefix, name]) => ({ prefix, name: String(name) }));
} else {
	console.error("Nothing to do. Use --list, --set <id-prefix> <name>, or --names <file.json>.");
	process.exit(2);
}

let failures = 0;
for (const { prefix, name } of targets) {
	try {
		const session = findSession(prefix);
		const { ok } = renameSession(session, name);
		if (!ok) failures++;
	} catch (error) {
		failures++;
		console.error(`FAIL  ${prefix}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

if (!dryRun && !noBackup && targets.length > 0) console.log(`backups: ${backupDir}`);
if (failures > 0) {
	console.error(`${failures} rename(s) failed`);
	process.exit(1);
}
