#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST_PKG = "@earendil-works/pi-coding-agent";
const DEFAULT_AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const AGENT_DIR = path.resolve(process.env.PI_AGENT_DIR?.trim() || DEFAULT_AGENT_DIR);
const NPM_DIR = path.join(AGENT_DIR, "npm");
const HOST_LINK = path.join(NPM_DIR, "host-link");

const args = new Set(process.argv.slice(2));
const known = new Set(["--dry-run", "--host-only", "-h", "--help"]);
for (const arg of args) {
	if (!known.has(arg)) {
		console.error(`unknown argument: ${arg}`);
		process.exit(2);
	}
}
if (args.has("-h") || args.has("--help")) {
	console.log(`Usage: pi-config-update [--dry-run] [--host-only]

Update Pi and all configured extensions, repair local host dependency links,
and run selftest without sharing host version pins across machines.

  --dry-run    Print actions without changing files or running updates
  --host-only  Repair the host link and dependencies without updating Pi/extensions

Environment:
  PI_AGENT_DIR  Configuration root (default: ~/.pi/agent)`);
	process.exit(0);
}
const DRY = args.has("--dry-run");
const HOST_ONLY = args.has("--host-only");

const exists = (p) => fs.existsSync(p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const isInside = (p, root) => p === root || p.startsWith(root + path.sep);
const quote = (s) => (s.includes(" ") ? JSON.stringify(s) : s);

function run(command, commandArgs, options = {}) {
	console.log(`+ ${[command, ...commandArgs].map(quote).join(" ")}`);
	if (DRY) return;
	const result = spawnSync(command, commandArgs, {
		cwd: options.cwd,
		env: process.env,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const error = new Error(`${command} exited with status ${result.status ?? "unknown"}`);
		error.exitCode = result.status ?? 1;
		throw error;
	}
}

function hostAt(dir) {
	try {
		const manifest = readJson(path.join(dir, "package.json"));
		if (manifest.name !== HOST_PKG || !manifest.version) return null;
		return { dir: path.resolve(dir), version: manifest.version };
	} catch {
		return null;
	}
}

function managedHosts() {
	const roots = [...new Set([AGENT_DIR, DEFAULT_AGENT_DIR])];
	const hosts = [];
	for (const root of roots) {
		try {
			const version = fs.readFileSync(path.join(root, "install", "current-version"), "utf8").trim();
			if (!/^[0-9A-Za-z._+-]+$/.test(version)) continue;
			const host = hostAt(path.join(root, "install", "releases", version, "node_modules", HOST_PKG));
			if (host) hosts.push(host);
		} catch {
			// Try the next installation layout.
		}
	}
	return hosts;
}

function hostFromExecutable(executable) {
	try {
		if (isInside(executable, NPM_DIR)) return null;
		const real = fs.realpathSync(executable);
		if (isInside(real, NPM_DIR)) return null;
		let dir = path.dirname(real);
		while (true) {
			const host = hostAt(dir);
			if (host) return host;
			const parent = path.dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	} catch {
		return null;
	}
}

function pathHosts() {
	const hosts = [];
	for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!entry) continue;
		const host = hostFromExecutable(path.join(entry, "pi"));
		if (host) hosts.push(host);
	}
	return hosts;
}

function globalNpmHost() {
	const result = spawnSync("npm", ["root", "-g"], {
		encoding: "utf8",
		env: process.env,
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return null;
	return hostAt(path.join(result.stdout.trim(), HOST_PKG));
}

function resolveHost() {
	const host = managedHosts()[0] ?? pathHosts()[0] ?? globalNpmHost();
	if (!host) {
		throw new Error(`cannot locate the active ${HOST_PKG} package; checked managed installs, PATH, and npm root -g`);
	}
	return host;
}

function hostDependencyNames() {
	const manifest = readJson(path.join(NPM_DIR, "package.json"));
	return Object.keys(manifest.dependencies ?? {}).filter(
		(name) => name.startsWith("@earendil-works/pi-") && name !== HOST_PKG,
	);
}

function hostDependencyTarget(host, name) {
	const target = path.join(path.dirname(host.dir), path.basename(name));
	let manifest;
	try {
		manifest = readJson(path.join(target, "package.json"));
	} catch {
		throw new Error(`host dependency ${name} is not available beside the active host at ${target}`);
	}
	if (manifest.name !== name) throw new Error(`host dependency at ${target} is ${manifest.name}, expected ${name}`);
	return target;
}

function ensureLink(link, target) {
	if (DRY) {
		console.log(`[dry] ${link} -> ${target}`);
		return;
	}
	fs.mkdirSync(path.dirname(link), { recursive: true });
	let stat;
	try {
		stat = fs.lstatSync(link);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (stat && !stat.isSymbolicLink()) throw new Error(`${link} exists and is not a symlink; refusing to replace it`);
	if (stat) {
		try {
			if (fs.realpathSync(link) === fs.realpathSync(target)) return;
		} catch {
			// A dangling link is exactly what this command repairs.
		}
	}
	const temporary = path.join(path.dirname(link), `.host-link-${process.pid}`);
	try {
		fs.symlinkSync(target, temporary, "dir");
		fs.renameSync(temporary, link);
	} finally {
		if (exists(temporary)) fs.unlinkSync(temporary);
	}
}

function ensureHostLinks(host) {
	console.log(`host: ${host.version} at ${host.dir}`);
	if (DRY) console.log(`[dry] mkdir -p ${NPM_DIR}`);
	else fs.mkdirSync(NPM_DIR, { recursive: true });
	ensureLink(HOST_LINK, host.dir);
	for (const name of hostDependencyNames()) {
		ensureLink(path.join(NPM_DIR, "host-deps", path.basename(name)), hostDependencyTarget(host, name));
	}
}

function synchronizeDependencies(host) {
	const manifestPath = path.join(NPM_DIR, "package.json");
	const manifest = readJson(manifestPath);
	const names = hostDependencyNames();
	let changed = false;
	for (const name of names) {
		const spec = `file:host-deps/${path.basename(name)}`;
		if (manifest.dependencies[name] === spec) continue;
		changed = true;
		console.log(`${DRY ? "[dry] " : ""}${name}: ${manifest.dependencies[name]} -> ${spec}`);
		if (!DRY) manifest.dependencies[name] = spec;
	}
	if (changed && !DRY) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`synchronizing npm dependencies with host ${host.version}`);
	run("npm", ["install", "--legacy-peer-deps"], { cwd: NPM_DIR });
	if (!DRY) {
		const updated = readJson(manifestPath);
		const mismatched = names.filter((name) => updated.dependencies?.[name] !== `file:host-deps/${path.basename(name)}`);
		if (mismatched.length) throw new Error(`host dependency specs were not preserved for: ${mismatched.join(", ")}`);
		const unresolved = names.filter((name) => {
			try {
				return fs.realpathSync(path.join(NPM_DIR, "node_modules", name)) !== fs.realpathSync(hostDependencyTarget(host, name));
			} catch {
				return true;
			}
		});
		if (unresolved.length) throw new Error(`npm did not link host dependencies to the active host: ${unresolved.join(", ")}`);
	}
}

try {
	let host = resolveHost();
	ensureHostLinks(host);
	if (!HOST_ONLY) {
		run("pi", ["update", "--all"], { cwd: AGENT_DIR });
		host = resolveHost();
		ensureHostLinks(host);
	}
	synchronizeDependencies(host);
	if (!HOST_ONLY) run("npm", ["run", "selftest"], { cwd: NPM_DIR });
	console.log(DRY ? "dry run complete" : HOST_ONLY ? "host dependencies ready" : "Pi configuration update complete");
} catch (error) {
	console.error(`pi-config-update: ${error?.message ?? error}`);
	process.exitCode = error?.exitCode ?? 1;
}
