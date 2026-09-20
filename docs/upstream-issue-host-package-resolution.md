# 上游问题报告：宿主包解析（**已提交**）

> 本文是本配置审计产出的上游材料。
> 各条附「实测环境 / 复现 / 实测输出 / 分析 / 建议修复」，**未验证的部分逐条标注**。
>
> 本地证据留档：`~/.pi/agent/scripts/selftest.mjs`（宿主包解析检查已内置，会持续监控这一项）。

## 提交状态（2026-09-20）

| 内容 | 去向 | 形式 | URL |
|---|---|---|---|
| 主机包解析失败 + workaround 不可靠的实测 | `nicobailon/pi-subagents` | **评论**（非新 issue） | <https://github.com/nicobailon/pi-subagents/issues/2346#issuecomment-5747633105> |
| `pi-goal-x` peer 区间排除 pi 0.86 | `tmonk/pi-goal-x` | 新 issue **#77** | <https://github.com/tmonk/pi-goal-x/issues/77> |
| `<pkg>/index.js` 未定性观察 | 不单独提交 | 已并入上表第 1 条 | — |

### 事后追记（2026-09-20 当日）：Issue 1 已在上游修复

`#2346` 于 **2026-09-20T06:21:15Z 关闭为 COMPLETED**，由 **#2352**（`fix(child-session): preserve host SDK ownership`，06:21:14Z 合并）修复。该 PR 完成的是社区贡献者 **#2348（@nazerim）** 的方案，CHANGELOG（unreleased）原文：

> *Load the host `pi-coding-agent` for in-process child sessions from the **resolved host package root instead of only a bare specifier**, so foreground children launch on npm-hosted Pi installations where the extension's own `node_modules` tree cannot resolve the bare module.*

⇒ **本文正文描述的“当前状态”已过时**：该缺陷对 **0.70.0** 成立，但在 main 上已修。截至本追记 npm `latest` 仍为 **0.70.0**，所以修复**尚未发布**。

⇒ 连带：我本地为绕过它装的 `file:` 符号链接（`npm/package.json`）在发布后应**复评是否可撤**。但 #2352 **只改了 `child-session.ts`**，包内另有 3 处裸 specifier 站点（`fleet.js` / `prompt-audit.js` / `llm-intent-arbiter.js`），所以**大概率仍需保留**（其中 `llm-intent-arbiter` 将被 #2356 整个删除）。

### 为什么第 1 条是评论而非新 issue（重要教训）

发布前查重发现 **`pi-subagents#2346` 已存在且 OPEN** ——
*"pi-subagents@0.70.0: foreground child launch cannot find the host Pi package"*，
由 `kuronekomichael` 于 **2026-09-20T03:10:26Z** 提交，另有两份独立复现
（`expoli` 03:36Z / Linux、`horizonzzzz` 03:55Z / Windows）—— **全部早于本轮探针**。

该 issue 已有的证据在本条上**强于**本报告：

* 入口回归定位：`pi.extensions` 从 0.69.0 的 `./index.ts` 变为 0.70.0 的 `./index.js`（关联 PR #2260）
* 一张覆盖 `.ts`/`.js` × 静态/延迟 import × 两种 Node 版本的 isolated fixture 矩阵
  （含"别名解析到的是宿主别名还是物理包"的 marker 对照）

因此最终**只补充了 #2346 里没有的部分**：符号链接 workaround 在真实包布局下**并不能**修好前台路径
（错误形态从裸 specifier 变成 `<pkg>/index.js` 路径），以及由此提出的"目录索引回退"假设（明确标注未验证）。

> **流程教训**：提交前用 `gh issue list --search` 查重，比写完再发现重复便宜得多。
> 上游报告的价值在于**增量**，不是完整性 —— #2346 的空白点是"缓解手段是否可靠"，不是"机制是什么"。

---

## Issue 1 — `pi-subagents`: deferred dynamic `import()` of the host SDK fails in in-process child sessions

### Summary

`pi-subagents@0.70.0` on `pi@0.86.0` cannot create **foreground / in-process** child sessions.
Every such launch dies before the child starts with a raw Node module-resolution error.
Background (detached) child sessions are unaffected, so the failure is easy to miss: the
default path works and only an explicit `async: false` breaks.

### Environment

| | |
|---|---|
| pi | `0.86.0`, installed via npm global (`~/.local/lib/node_modules/@earendil-works/pi-coding-agent`) |
| pi-subagents | `0.70.0` (installed into `~/.pi/agent/npm/node_modules`, per `settings.packages`) |
| node | `v26.0.0` |
| OS | macOS (darwin) |
| config | `~/.pi/agent/extensions/subagent/config.json` present |

### Repro

```js
// from a pi session
subagent({ agent: "delegate", async: false, task: "Run: pwd ; echo EXIT=$?" })
```

### Observed

```
Cannot find package '@earendil-works/pi-coding-agent'
imported from /Users/<user>/.pi/agent/npm/node_modules/pi-subagents/src/runs/shared/child-session.js
```

The run is reported as failed (`Mission: … (failed)`), an output artifact is created, and **no
child session appears** — `run-history.jsonl` gains no entry, i.e. the failure happens before
run registration.

The equivalent call with `async: true` (or with `async` omitted, given `asyncByDefault: true`):

```
PROBE3-OK | /Users/<user> | 0
```

works fine. So only the in-process path is broken.

### Why the two paths differ

The background runner resolves the host **explicitly**:

* `src/runs/shared/pi-spawn.js` — `resolveInstalledPiPackageRoot()` → `findPiPackageRootFromEntry(fileURLToPath(import.meta.resolve(PI_CODING_AGENT_PACKAGE)))`
* `src/runs/background/async-execution.js:441-446` — derives `piPackageRoot`, then `resolveHostPeerAliases(piPackageRoot)` and errors out early with a readable message if the host package is unusable

The in-process path relies on pi's **jiti alias** instead:

```js
// pi-subagents/src/runs/shared/child-session.js:133
const loadPiCodingAgent = options.loadPiCodingAgent ?? (() => import("@earendil-works/pi-coding-agent"));
...
async create(launch) {
    const pi = await loadPiCodingAgent();
```

### Analysis (with an A/B experiment)

pi loads extension entries through jiti with an alias table that maps the host scope to pi's own
entry point (`dist/core/extensions/loader.js:62`):

```js
const packageIndex = path.resolve(__dirname, "../..", "index.js");
_aliases = { "@earendil-works/pi-coding-agent": piCodingAgentEntry, ... }
```

Minimal A/B — identical deferred dynamic import, only the *module kind* differs:

```js
// target.js
export async function go() {
  const m = await import("@earendil-works/pi-coding-agent");
  return Object.keys(m).length;
}
```

```js
// probe.mjs
const createJiti = (await import("<…>/jiti/lib/jiti.mjs")).default;
const HOST = "<…>/@earendil-works/pi-coding-agent/dist/index.js";
const jiti = createJiti(HOST, { moduleCache: false, alias: { "@earendil-works/pi-coding-agent": HOST } });
for (const p of ["/tmp/probe-target.js", "/tmp/esmprobe/target.js"]) {
  try { console.log(p, "-> OK", await (await jiti.import(p)).go()); }
  catch (e) { console.log(p, "-> BYPASSED", e.code); }
}
```

Measured result:

```
CJS-ish (/tmp/probe-target.js) -> ALIAS OK, keys = 151
ESM pkg (/tmp/esmprobe/target.js) -> ALIAS BYPASSED: ERR_MODULE_NOT_FOUND
```

`/tmp/esmprobe/` differs only by a `package.json` containing `"type": "module"`.

**Conclusion:** jiti's `alias` is honoured for modules jiti compiles, but a true-ESM module is
handed to **native ESM resolution**, which knows nothing about the alias. `pi-subagents` is
`"type": "module"`, so `child-session.js` is native ESM and its deferred `import()` needs a
**natively resolvable** copy of the host package.

That copy cannot be expected to exist, because pi's own package manager deliberately prevents it:

```js
// pi: dist/core/package-manager.js
// Disable peer dependency resolution for managed installs (npm's --legacy-peer-deps, and
// equivalent bun/pnpm settings) so package managers do not install or solve host-provided
// @earendil-works/pi-* peers. Stale auto-installed pi peers can otherwise block updates.
return ["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"];
```

So: extension packages are documented to "resolve pi APIs through loader aliases/virtual modules",
but a *deferred* `import()` inside a true-ESM package escapes those aliases.

### Workaround that works

Add a `file:` dependency in the extensions install root, pointing at the global pi installation:

```jsonc
// ~/.pi/agent/npm/package.json
"dependencies": {
  "@earendil-works/pi-coding-agent": "file:/Users/<user>/.local/lib/node_modules/@earendil-works/pi-coding-agent"
}
```

`npm install --legacy-peer-deps` then creates a **symlink** (not a copy), so there is no disk
growth and no version drift:

```
node_modules/@earendil-works/pi-coding-agent -> ../../../../../.local/lib/node_modules/@earendil-works/pi-coding-agent
```

Verified: `node --input-type=module -e "await import('@earendil-works/pi-coding-agent')"` executed
with `cwd = …/npm/node_modules/pi-subagents` → `NATIVE OK, exports = 151`.

### Suggested fixes (for the maintainer)

1. Preferable: thread the host module through from the extension entry — e.g. pass
   `loadPiCodingAgent: () => import("@earendil-works/pi-coding-agent")` from
   `src/extension/index.js` into `createDefaultChildSessionFactory()`. The entry module *is* loaded
   through jiti, so its import resolves.
2. Or resolve the host the way the background runner already does (explicit package root), instead
   of a bare specifier import at depth.
3. Failing either: fail fast with an actionable message, e.g.
   `Host package '@earendil-works/pi-coding-agent' is not resolvable from <dir>. Foreground child
   sessions need a natively resolvable host package; see <docs>.` The current surface is a raw
   `ERR_MODULE_NOT_FOUND` with no hint, on a path that only fails for `async: false`.

### Secondary observation (NOT fully diagnosed — reported as-is, do not treat as a conclusion)

After applying the workaround, the same `async: false` call moved to a **different** error:

```
Cannot find package '/Users/<user>/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/index.js'
imported from /Users/<user>/.pi/agent/npm/node_modules/pi-subagents/src/runs/shared/child-session.js
```

i.e. something resolved the specifier to a **`index.js` at the package root**, which does not exist
in an npm-installed layout — the real entry is `dist/index.js` (`package.json` → `"main": "./dist/index.js"`,
`exports["."].import = "./dist/index.js"`).

The error shape (a path, not a bare specifier) shows an alias/lookup step *did* run this time, so
this looks like a second, distinct defect rather than a consequence of the first.
**What I did not establish:** whether this target is produced by jiti's alias table, by a jiti
directory-index fallback (`<dir>/index.js`), or by the loader — I could not isolate it from outside
the pi process. Note also that the alias source I read computes `path.resolve(__dirname, "../..", "index.js")`,
which from `dist/core/extensions/` yields `dist/index.js` (correct), so the `<pkg>/index.js` I
observed must come from somewhere else.

### Impact

Any third-party extension package that is `"type": "module"` and defers a `import("<host package>")`
to runtime is affected. Grep of `pi-subagents@0.70.0` found 4 such sites:

```
src/runs/shared/child-session.js:133
src/tui/fleet.js:1351
src/runs/foreground/prompt-audit.js:38-40
src/runs/shared/llm-intent-arbiter.js:100-102
```

---

## Issue 2 — `pi-goal-x`: latest release's peer range excludes the current pi, with no released version that supports it

### Summary

`pi-goal-x@0.31.6` (npm `latest`, and the newest in the published line) pins the host packages to
`>=0.83.0 <0.85.0`. Against `pi@0.86.0` the peer requirement is **unsatisfiable**, and no released
version supports 0.86.

### Evidence

```
$ npm view pi-goal-x@latest version peerDependencies
version = '0.31.6'
peerDependencies = {
  '@earendil-works/pi-ai': '>=0.83.0 <0.85.0',
  '@earendil-works/pi-coding-agent': '>=0.83.0 <0.85.0',
  '@earendil-works/pi-tui': '>=0.83.0 <0.85.0',
  typebox: '^1.3.11'
}

$ npm view pi-goal-x versions --json | tail -3
  "0.31.4", "0.31.5", "0.31.6"

$ pi --version
0.86.0
```

By contrast, `pi-subagents@0.70.0` and `@juicesharp/rpiv-ask-user-question@2.10.1` both declare
`"*"` and are unaffected.

### Why this is worse than a normal peer warning

pi's package manager installs extension packages with `--legacy-peer-deps` (see Issue 1). So:

1. npm will neither satisfy the peer nor surface a meaningful warning.
2. Any *stale* peer copy that happened to be present earlier gets pruned, silently removing a
   natively resolvable host package that other extensions may be relying on.

Practical consequence observed on this machine: `~/.pi/agent/npm/node_modules/@earendil-works/`
(and 10 sibling empty `@scope` directories belonging to the host package's dependency tree:
`@anthropic-ai @aws @aws-crypto @aws-sdk @babel @google @moyai @protobufjs @smithy @types`)
remained as empty directories after such a prune.

### Suggested fix

Widen the range to the current minor (e.g. `>=0.83.0 <0.87.0`) or use `"*"` like the sibling
packages, and/or state the supported pi range explicitly in the README.

### Caveat

I did **not** reproduce a functional failure attributable to the peer range: `pi-goal-x@0.31.6`'s
goal features load and run on 0.86.0 on this machine. The finding is about the declared range and
the install-time behaviour it produces, not a demonstrated runtime break.

---

## Residual uncertainty across both issues (please read before filing)

1. On this machine `npm/node_modules/@earendil-works/` had been an empty directory since **2026-09-18 10:57**,
   yet subagent runs **succeeded** on 09-18 17:01, 09-18 17:14 and 09-19 23:23 (after the pi 0.86.0
   upgrade the in-process path fails). "No natively resolvable host package" does not by itself
   explain those earlier successes. The most likely explanation is that those runs were detached
   (background) runs whose resolution behaves differently *inside* the pi process than in a bare
   `node` probe — **not verified**.
2. No before/after control was run for the workaround: I never ran a background probe *before*
   installing the symlink, so I cannot strictly claim the background path depends on it.
