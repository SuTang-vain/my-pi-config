# 上游问题报告：裸工具名词牌被读为实现意图（**已提交 #2351，已闭环**）

> 提交状态（2026-09-20）：新 issue **#2351** — <https://github.com/nicobailon/pi-subagents/issues/2351>（草稿正文全部提交；未追加到 CLOSED 的 #2039/#2079/#1911，理由见下）
> 本地证据：2026-09-20 派发机制深度测试中两次真实误杀 + node 确定性复现 + 反事实对照

## 结局（2026-09-20 当日闭环；本文件写于提交当时，本节为事后追记）

| UTC | 事件 |
|---|---|
| 06:03 | 本报告提交为 **#2351** |
| 06:32 | 维护者**亲自实现**修复 **#2354**（新增 `stripMarkdownToolsColumnValues`）；PR 描述逐字致谢本报告；148 测试 + 24/24 反斜杠奇偶矩阵通过 |
| 06:48 | **#2354 关闭未合并** —— “继续教正则认每一种数据语法不是务实的长期契约” |
| 06:49 | **#2351 关闭（NOT_PLANNED）**；同期 #2353 一并关闭 |
| 07:27 | 开出替代方案追踪票 **#2355**，再次具名致谢 @SuTang-vain，明写 *“This replaces the approaches closed in #2351, #2353, and #2354”* |
| 08:15 | 实现 PR **#2356** 开出（OPEN，未合并）：净 **−3,521 行**，整文件删除 `task-intent.ts` / `completion-guard.ts` / `llm-intent-arbiter.ts` / `completion-evidence.ts`；`inferLevel` 改为**只依赖声明的 `acceptanceRole`** |

> **结论：报告有效并改变了架构决策。** 维护者原话 *“it exposed that the architecture, not this table shape, needed to change”*。
> `NOT_PLANNED` 指的是“不再采用本报告的**具体修法**”，不是“报告不成立”。
> 截至本追记，npm `latest` 仍为 **0.70.0** → **根因修复尚未发布**。

## 提交后独立复核（2026-09-20，全项通过）

| 检验项 | 方法 | 结果 |
|---|---|---|
| 本地副本=上游原码 | npmjs.org 官方 dist.integrity vs 镜像 tarball sha512 逐字节比对；本地 5 个关键源文件 vs 纯净解包哈希 | 全部一致 |
| 纯净包上可复现 | 在纯净 tarball 解包副本重跑确定性复现 | real→implementation/true；redacted→unknown/false |
| 复现忠实性（排除框架注入干扰） | 从失败子 run 的 output-0.log 提取**运行时真实存储任务串**（2505 字符）重过分类器 | implementation/true |
| 上游现状（**提交当时**，已被上方「结局」覆盖） | 0.70.0 即最新版；main 分支 task-intent.ts:126 仍含裸词模式，无 tool-name strip，该文件最后提交 2026-09-09 #2083 | ⚠️ 已过时（见「结局」）。另：本行有两处子claim**无法从 npm tarball 推出** —— 行号 pin（diff 显示该区域因新增函数而后移）与 git 提交日期 |
| 验收契约污染链 | acceptance.js:55-101 全分支审读：kind=implementation → taskMayWrite 恒真（read-only 角色亦不可豁免，inferredReadOnly 要求 !taskMayWrite）→ async+writeTask → risky → checked 契约 | 与子会话注入契约逐字吻合 |

---

## Title

Task-intent classifier and acceptance inference read bare tool names (`edit`, `write`) inside embedded task data as implementation intent — read-only children hard-fail the completion guard

## Summary

Two read-only verification children (workflow-script `runs.run`, agents `evidence-auditor` and `delegate`) completed their work, produced full artifacts, and were then hard-failed with:

```
Subagent completed without making edits for an implementation task.
It appears to have returned planning or scratchpad output instead of applying changes.
```

Root cause is deterministic and reproducible without dispatching anything: the task text embedded a markdown table of agent definitions whose `tools` column contains the bare words `edit` (worker) and `write` (4 rows). Those tokens:

1. match `EXPLICIT_IMPLEMENTATION_PATTERNS` (`\b(?:implement|edit|modify|refactor)\b`) in `src/runs/shared/task-intent.js` → `classifyTaskMutationIntent()` returns `implementation` → the completion mutation guard hard-fails the (correctly) no-edit run;

   > ⚠️ **归属修正（2026-09-20 复核）**：该 agent 的实际派发分支走 `GENERAL_IMPLEMENTATION_PATTERNS`（`task-intent.js:160-165` 的 agent 分支），**不是** `EXPLICIT_*`。结论不变，引用需改。
2. match `MAY_MUTATE_VERB_PATTERN` (`write`) → `taskMayMutate()` returns `true` → **acceptance-level inference raised a read-only audit task to a full implementation acceptance contract** (`src/runs/shared/acceptance.js:91` — criterion "Implement the requested change without widening scope", required evidence changed-files/tests-added/commands-run), which the child can never satisfy.

So the same payload tokens contaminate two consumers at once: the completion verdict *and* the acceptance contract.

This is not covered by the closed fixes: #2039 strips verbs inside path-like tokens (tool names are not path-like), #2079 strips severity compounds (`must-fix`), and #1911 wired the LLM intent arbiter into the background runner (it is wired and was invoked on this path in 0.70.0 — `subagent-runner.js:1059-1073` — but did not rescue, see Observability below).

## Environment

| | |
|---|---|
| pi | 0.86.0 (npm global, `@earendil-works/pi-coding-agent`) |
| pi-subagents | 0.70.0 (installed via `settings.packages`) |
| node | v26.0.0 |
| OS | macOS (darwin) |
| session model | deepseek/deepseek-flash |
| path | async workflowScript children (`runs.run` inside an async workflow) |

## Deterministic repro (no agent dispatch needed)

```bash
cd <pi-subagents package root>   # e.g. ~/.pi/agent/npm/node_modules/pi-subagents
node --input-type=module -e "
import { classifyTaskMutationIntent, taskMayMutate } from './src/runs/shared/task-intent.js';
const table = '| name | tools |\n|---|---|\n| worker.md | read, grep, find, ls, bash, edit, write, contact_supervisor |';
const t1 = 'Verify every cell of this table against the actual files:\n\n' + table + '\n\nOutput the corrected table and a CORRECTIONS list.';
const t2 = t1.replaceAll('edit','X').replaceAll('write','Y');   // counterfactual
console.log('real     :', JSON.stringify(classifyTaskMutationIntent('evidence-auditor', t1).kind), taskMayMutate(t1));
console.log('redacted :', JSON.stringify(classifyTaskMutationIntent('evidence-auditor', t2).kind), taskMayMutate(t2));
"
```

Observed (0.70.0):

```
real     : "implementation" true
redacted : "unknown" false
```

## In-the-wild evidence (2026-09-20)

- Run `3d626d3d-09e1-4517-ab21-3d1f30d35014` (agent `evidence-auditor`, task: verify a 7×4 agent-definition table cell-by-cell): completed a full 28/28-cell verification report, then failed with the guard message. The child's injected system prompt shows the contaminated acceptance contract — "Acceptance level: checked … criterion-1: Implement the requested change without widening scope … Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files" — on a task that never asked for changes.
- Run `349169ab-83b4-4174-8a9b-dc2864bb0d66` (agent `delegate`, task: "Compute and output compact stats only … No file access needed", same table embedded): same guard failure; control event `{"reason":"completion_guard","message":"delegate completed without making edits for an implementation task"}`.
- Sibling runs in the same workflows whose task text did **not** embed tool-name tokens (`b1-structured`, `b2-output-bound`, both `delegate`, both no-edit) passed the guard — consistent with the counterfactual above.

## Observability gap (secondary)

The LLM intent arbiter is wired on this path (`src/runs/background/subagent-runner.js:1059-1073`) and per its docstring "every error, timeout, or non-read-only verdict keeps the guard's original behavior". For both failed runs, no arbitration outcome is recorded anywhere parent-visible: no field in `status.json`, no event in `events.jsonl`, no line in `runner.stderr.log`. From the orchestrator side the cause (model error / auth failure / 10s timeout / adverse verdict) is indistinguishable from "arbiter never ran".

## Suggested directions (non-prescriptive)

- Treat comma-separated lowercase identifier lists and inline-code spans / table cells as data, not imperatives (a `tools:` column of an embedded table is data by construction); or extend the existing strip family (`stripPathLikeTokens`, severity compounds, finding-classification quotes) with a tool-name vocabulary strip. → **已试过并被否决**：#2354 实现了 tools 列剥离，随后关闭转向 #2355/#2356。
- Consider having `taskMayMutate` ignore bare write verbs that appear inside a fenced/inline code span or table row. → **已试过并被否决**（同上）。
- Always record the arbitration outcome (verdict/error/timeout + resolved model) to `status.json` or an event when the guard fires, so silent non-rescue is diagnosable. → **已失效（superseded）**：#2356 删除整个 arbiter，本建议的目标机制不存在了；只留下通用原则——“凡会触发守卫的机制必须公布原因”。

## Workarounds (verified locally)

- Paraphrase embedded tool lists to avoid bare write verbs (e.g. omit the tools column), or
- Resume the failed child with an explicit read-only clarification — the resumed run passed, or
- Wrap sequential workflow steps in try/catch and salvage the retained output artifact (artifacts survive the failed verdict, which is how we recovered).

## Related

- #2039 (verbs inside artifact filenames — path-strip fix; different token shape)
- #2079 ("must fix before…" quoted severity — compound-strip fix)
- #1911 (arbiter missing on background path — now wired; silent non-rescue remains)
- #1765 / #1416 / #1110 / #1054 (earlier no-edit false-failure fixes)
