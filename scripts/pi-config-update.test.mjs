import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-config-update.mjs");
const HOST_PKG = "@earendil-works/pi-coding-agent";
const PEERS = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-codemode",
	"@earendil-works/pi-mcp",
	"@earendil-works/pi-telemetry",
	"@earendil-works/pi-tui",
];

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-update-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const agent = path.join(root, "agent");
	const npmDir = path.join(agent, "npm");
	const bin = path.join(root, "bin");
	const log = path.join(root, "commands.log");
	fs.mkdirSync(npmDir, { recursive: true });
	fs.mkdirSync(bin, { recursive: true });
	const manifest = {
		name: "pi-extensions",
		private: true,
		dependencies: Object.fromEntries([
			...PEERS.map((name) => [name, "1.4.0"]),
			[HOST_PKG, "file:host-link"],
			["pi-subagents", "^0.83.0"],
		]),
	};
	fs.writeFileSync(path.join(npmDir, "package.json"), JSON.stringify(manifest, null, 2));
	const setHost = (version) => {
		fs.mkdirSync(path.join(agent, "install"), { recursive: true });
		fs.writeFileSync(path.join(agent, "install", "current-version"), `${version}\n`);
		const scope = path.join(agent, "install", "releases", version, "node_modules", "@earendil-works");
		for (const name of [HOST_PKG, ...PEERS]) {
			const dir = path.join(scope, path.basename(name));
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
		}
		return path.join(scope, path.basename(HOST_PKG));
	};
	setHost("1.4.0");
	fs.writeFileSync(path.join(bin, "pi"), `#!/bin/sh
printf 'pi %s\\n' "$*" >> "$MOCK_LOG"
if [ "$MOCK_PI_FAIL" = "1" ]; then exit 23; fi
if [ "$1" = "update" ] && [ "$2" = "--all" ]; then
  printf '%s\\n' "$MOCK_NEXT_VERSION" > "$PI_AGENT_DIR/install/current-version"
fi
`);
	fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$MOCK_LOG"
if [ "$1" = "root" ]; then exit 1; fi
if [ "$1" = "install" ]; then
  node -e 'const fs = require("fs"); const path = require("path"); const npmDir = process.argv[1]; const pkg = JSON.parse(fs.readFileSync(path.join(npmDir, "package.json"))); for (const [name, spec] of Object.entries(pkg.dependencies)) { if (!name.startsWith("@earendil-works/") || !spec.startsWith("file:")) continue; const target = path.resolve(npmDir, spec.slice(5)); const dest = path.join(npmDir, "node_modules", name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.rmSync(dest, { recursive: true, force: true }); fs.symlinkSync(target, dest, "dir"); }' "$PI_AGENT_DIR/npm"
fi
`);
	for (const command of ["pi", "npm"]) fs.chmodSync(path.join(bin, command), 0o755);
	const run = (extraEnv = {}, scriptArgs = []) => spawnSync(process.execPath, [SCRIPT, ...scriptArgs], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}${path.delimiter}${process.env.PATH}`,
			PI_AGENT_DIR: agent,
			MOCK_LOG: log,
			MOCK_NEXT_VERSION: "1.5.0",
			...extraEnv,
		},
	});
	return { agent, npmDir, log, setHost, run };
}

test("default update repoints host links and removes peer version pins", (t) => {
	const f = fixture(t);
	const nextDir = f.setHost("1.5.0");
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.realpathSync(path.join(f.npmDir, "host-link")), fs.realpathSync(nextDir));
	const manifest = JSON.parse(fs.readFileSync(path.join(f.npmDir, "package.json"), "utf8"));
	for (const peer of PEERS) {
		const base = path.basename(peer);
		assert.equal(manifest.dependencies[peer], `file:host-deps/${base}`);
		assert.equal(fs.realpathSync(path.join(f.npmDir, "host-deps", base)), fs.realpathSync(path.join(f.npmDir, "node_modules", peer)));
	}
	assert.equal(manifest.dependencies[HOST_PKG], "file:host-link");
	const log = fs.readFileSync(f.log, "utf8").trim().split("\n");
	assert.equal(log[0], "pi update --all");
	assert.equal(log[1], "npm install --legacy-peer-deps");
	assert.ok(!log[1].includes("@1.5.0"));
	assert.equal(log[2], "npm run selftest");
});

test("--host-only repairs dependencies without invoking Pi or selftest", (t) => {
	const f = fixture(t);
	const result = f.run({}, ["--host-only"]);
	assert.equal(result.status, 0, result.stderr);
	const log = fs.readFileSync(f.log, "utf8").trim().split("\n");
	assert.deepEqual(log, ["npm install --legacy-peer-deps"]);
	assert.equal(fs.readFileSync(path.join(f.agent, "install", "current-version"), "utf8").trim(), "1.4.0");
});

test("--dry-run performs no writes or updates", (t) => {
	const f = fixture(t);
	const before = fs.readFileSync(path.join(f.npmDir, "package.json"), "utf8");
	const result = f.run({}, ["--dry-run"]);
	assert.equal(result.status, 0, result.stderr);
	assert.ok(result.stdout.includes("pi update --all"));
	assert.equal(fs.existsSync(path.join(f.npmDir, "host-link")), false);
	assert.equal(fs.existsSync(f.log), false);
	assert.equal(fs.readFileSync(path.join(f.npmDir, "package.json"), "utf8"), before);
});

test("a failed Pi update stops before dependency synchronization and selftest", (t) => {
	const f = fixture(t);
	const result = f.run({ MOCK_PI_FAIL: "1" });
	assert.equal(result.status, 23, result.stderr);
	const log = fs.readFileSync(f.log, "utf8").trim().split("\n");
	assert.deepEqual(log, ["pi update --all"]);
	assert.match(result.stderr, /pi exited with status 23/);
});

test("an existing non-symlink host-link is never replaced", (t) => {
	const f = fixture(t);
	fs.writeFileSync(path.join(f.npmDir, "host-link"), "keep me");
	const result = f.run({}, ["--host-only"]);
	assert.equal(result.status, 1);
	assert.equal(fs.readFileSync(path.join(f.npmDir, "host-link"), "utf8"), "keep me");
	assert.match(result.stderr, /refusing to replace it/);
});

test("a later host upgrade changes links without rewriting the shared manifest", (t) => {
	const f = fixture(t);
	assert.equal(f.run().status, 0);
	const manifestPath = path.join(f.npmDir, "package.json");
	const before = fs.readFileSync(manifestPath, "utf8");
	f.setHost("1.6.0");
	const result = f.run({}, ["--host-only"]);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(fs.readFileSync(manifestPath, "utf8"), before);
	assert.equal(fs.realpathSync(path.join(f.npmDir, "host-deps", "pi-ai")), fs.realpathSync(path.join(f.agent, "install", "releases", "1.6.0", "node_modules", "@earendil-works", "pi-ai")));
});
