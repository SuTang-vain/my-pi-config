# my-pi-config

**[English](README.md)** | **简体中文**

一套经过实测校准、可自我校验的 [pi](https://github.com/badlogic/pi-mono) 编码代理（`@earendil-works/pi-coding-agent`）配置。

本仓库是一套完整的生产在用配置：七个角色专精的子代理、精选的技能白名单、按需组合的自写扩展套件，以及一个对全部跨文件不变量做机器检查的 selftest 测试框架。文中记录的每项设计决策都有实测数据、源码审计或真实生产事故作为依据。

**快照**：pi 0.86.0 · pi-subagents 0.70.0 · 2026-09-20。

---

## 目录

- [设计理念](#设计理念)
- [架构](#架构)
- [子代理团队](#子代理团队)
- [扩展](#扩展)
- [技能](#技能)
- [实测发现](#实测发现)
- [已记录的踩坑](#已记录的踩坑)
- [仓库结构](#仓库结构)
- [安装与适配](#安装与适配)
- [刻意排除的内容](#刻意排除的内容)
- [许可](#许可)

---

## 设计理念

### 1. 机制优于提示词

提示词层面的纪律可能被断章取义、错误解读或静默忽略。一次对照实验（n = 60，两臂 × 两模型 × 四档规模）显示：在系统提示中加入一条委派纪律句，可归因效果为 **0/60**——且该句被模型反向引用为「不要委派」的理由，与其本意相反。因此本配置中的知识按强度选择载体：工具参数优先，其次机制，再次文档，提示词只保留操作结论。

### 2. 实测优于传闻

几乎每条规则都内联附带着证据——一个实测数字或一处源码引用。代表性数据见[实测发现](#实测发现)。

### 3. 每个组件必须自证存在价值

零调用记录的技能、被上游追平功能的扩展、只守一扇门的安全装置——均已移除。每次删除都记录了理由与恢复路径，使配置能够主动瘦身，而不是持续堆积。

### 4. 配置必须可被机器校验

`npm run selftest` 校验 19 项不变量——例如：任何位置引用的模型都必须存在于已认证的 provider 注册表中；任何 agent 声明的默认上下文不得被全局配置静默覆盖。该框架源于 2026-09-20 的一次审计：当时发现三个同构缺陷——**配置引用了运行时注册表中不存在的东西**——且每一个都只在对应功能被实际调用时才暴露。

## 架构

```
元层    chezmoi（版本化 + age 加密密钥文件）· selftest.mjs（19 项不变量）
规则层  AGENTS.md（可验证事实）· APPEND_SYSTEM.md（7 条操作规则）
基座层  settings.json：默认模型、逐模型思考档位、compaction 调参
能力层  9 个常驻技能（白名单 4 + 自动扫描 5），其余按需挂载
编排层  pi-subagents + 7 个角色专精 agent + delegate-verify（派发纪律权威源）
计划层  pi-goal-x（跨会话目标账本）· todo 工具（会话内断言）
会话层  内置 /resume（跨工作区搜索与删除）· analyze-sessions（批量分析）
反馈层  footer（面向人的用量）· usage-inject（面向模型）· /context（按需深视图）
```

## 子代理团队

`agents/` 下七个角色专精的 agent，共享同一套证据纪律：结论分为 **measured / quoted / unverified** 三级，失败必须显式报告，不得掩饰。

| Agent | 职责 | 关键约束 |
|---|---|---|
| `scout` | 只读快速侦察，产出可交接的压缩上下文 | `thinking: low` |
| `researcher` | 案头调研（exa 索引检索，广度优先、批量抽取） | 拿不到全文必须明示「证据不足」，禁止用摘要拼凑 |
| `inspector` | 现场勘验（真实浏览器：登录态、JS 渲染、交互） | 是 `researcher` 的下游环节，而非替代 |
| `evidence-auditor` | 对载荷性论断做独立稽核 | URL 本身不是证据 |
| `verifier` | 执行级验收：亲自跑命令并引用原始输出 | 结论必须带 stdout 与退出码 |
| `reviewer` | 静态评审（本地覆盖版） | 上游定义声明了一个无 child 可加载载体的工具，本地版修复并留证 |
| `worker` | **唯一写线程**，按已批准方向做最小实现 | 遇到未批准的决策必须上报，不得擅自扩 scope |

其中两个角色构成刻意的流水线（`researcher` → `inspector`）：前者定位「有哪些来源」，后者取得关键页面的一手内容。

## 扩展

`extensions/` 下的自写扩展：

| 扩展 | 功能 |
|---|---|
| `productivity/` | 五个启用中的模块：会话自动命名、完成桌面通知、模型可调用的 `todo` 工具与 `/todos` 面板、用量 footer（token/成本/分支/模型），以及 `usage-inject`——周期性把用量数据注入模型上下文（模型看不到 footer） |
| `prompt-snippets/` | 六个单用途提示词片段，按消息手动开关（`alt+s`）；发送后自动复位，未启用的片段零成本 |
| `context.ts` | `/context` 把上下文窗口构成渲染为彩色方块网格，带阈值告警 |
| `md-link.ts` | 把一个 Markdown 文件链接到会话做协作编辑（助手输出自动追加；`/send-diff` 把改动发回模型） |
| `subagent/config.json` | pi-subagents 调优：默认 fresh 上下文、spawn 预算、checkpoint 收尾宽限 |

## 技能

`skills/` 下的常驻技能（另有四个经 `settings.json` 白名单来自 scientific-agent-skills 库）：

- `delegate-verify`——委派核对的权威派发手册，每条纪律都对照所装 pi-subagents 源码验证过（带版本戳）。
- `analyze-sessions`——零依赖 Python 工具集：成本聚合、提示词模式挖掘、单会话渲染、跨会话全文搜索。

## 实测发现

| 断言 | 证据 |
|---|---|
| 委派划算的条件是 `M − δ > 包税` | pi-subagents 固定税为每轮 5,809 token（两次独立测量，相差 0.6%）；`outputMode: "file-only"` 使 14,465 字节的报告只回传 90 字符存根（δ 降低 228 倍） |
| 技能白名单必不可少 | 注入全部 160+ 个可用技能约需 19,300 token/会话；常驻九个仅占约 3.7 KB 字符（取舍依据为 128 个会话的调用记录） |
| 子代理补丁需先规范化 hunk 头 | 原始 `git apply` 机械可用率 1/5；规范化后语义正确率 5/5 |
| `/compact` 失败的根因 | 摘要输出上限 = `min(0.8 × reserveTokens, model.maxTokens)`，与历史大小无关（`src/core/compaction/compaction.ts`） |

## 已记录的踩坑

以下缺陷均在本配置中真实出现并已修复，每一处都附有源码引用：

- **pruned fork 死配置**：摘要器模型 id 在其 provider 注册表中不存在，显式 fork 在启动前必抛错；且全局 `defaultSubagentContext` 会静默覆盖 agent 级声明——「配了却永远走不到」。
- **checkpoint 与时限相撞**：当 `checkpointBeforeDeadlineMs` 等于 agent 的 `timeoutMs` 时，收尾定时器**静默不挂**（差值小于 1,000ms 即解除）。
- **全局 `toolTimeoutMs` 误伤**：设置后每个非豁免工具（含 `bash`）都被套上时限，且超时杀死整个子代理而非仅失败该次工具调用。
- **验收分类器误杀只读任务**：任务数据中嵌入的裸工具名（`edit`/`write`）被读为实现意图，导致只读子代理被硬性判失败。已上溯为 [pi-subagents#2351](https://github.com/nicobailon/pi-subagents/issues/2351)，附确定性复现（见 `docs/`）。

## 仓库结构

```
├── settings.json · AGENTS.md · APPEND_SYSTEM.md   # 主配置与两层提示词
├── agents/            # 七个子代理定义
├── extensions/        # context · md-link · productivity · prompt-snippets · subagent
├── skills/            # delegate-verify · analyze-sessions
├── scripts/           # selftest.mjs（19 项不变量）· 技能库重建脚本
├── npm/package.json   # 扩展包（pi-subagents · pi-goal-x · rpiv-ask-user-question）
├── themes/            # catppuccin-mocha
└── docs/              # 子代理系统说明书 · 两篇已提交上游的 issue 报告
```

## 安装与适配

```bash
# 1. 复制到 ~/.pi/agent/（或按需摘取）
# 2. 安装扩展包
cd npm && npm install
# 3. 将 npm/package.json 中的 file: 依赖改为你机器上全局 pi 的绝对路径
#    （npm 不展开 ~）。背景见 docs/upstream-issue-host-package-resolution.md
# 4. 自建 auth.json 填入你的 provider 密钥，然后 chmod 600：
#    { "<provider>": { "type": "api_key", "key": "sk-..." } }
# 5. 校验
npm run selftest   # 预期 19 passed
```

`settings.json` 中的技能白名单指向 `~/.pi/agent/skills-optional/...`，可用 `scripts/clone-skill-repos.sh` 重建或自行删减。

## 刻意排除的内容

`auth.json`（密钥）、`models-store.json`（本机模型目录缓存，由 pi 自行生成）、`sessions/`、`missions/`、`run-history.jsonl`（隐私数据）、Herdr 集成生成件（经 `herdr integration install pi` 重新生成）、第三方技能库（由重建脚本恢复）。

## 许可

自写部分采用 MIT。第三方内容遵循各自上游许可。
