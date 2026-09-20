# pi 子代理系统使用说明书

> 版本 v1.0 · 2026-09-16 · 编写时基线:本机 pi 0.85.1 + pi-subagents 0.68.0
> ⚠️ **2026-09-20 现状:pi 0.86.0 + pi-subagents 0.70.0** —— 本次只核对了版本号与
> `toolBudget`/`resume` 一条（该条已修正，见 §…），**本文未整体重验**。引用本文的
> 行为结论前请先对着当前源码复查。
> 📌 **权威源声明（2026-09-20）：委派行为纪律以 `skills/delegate-verify/SKILL.md` 为唯一权威源
> （它带源码版本核验戳）；本文仅作系统构成的背景教程，其中的行为结论若与 delegate-verify
> 冲突，以 delegate-verify 为准。**
> 实证基础:本文全部结论均来自本机源码逆向(schemas.ts)与两轮实跑(4 无头 + 4 正式 scout)

---

## 1. 系统构成

```
pi-subagents 扩展(npm 包,编写时 0.68.0 → 2026-09-20 实装 0.70.0)
├── 工具:  subagent(调度)+ contact_supervisor(子→父求助)
├── 命令:  /subagents-* 约 20 个(管理/状态/停止等)
├── 内建 agent: scout / researcher / evidence-auditor / worker / reviewer / oracle / delegate
├── 用户 agent: ~/.pi/agent/agents/{research,scout,worker}.md(同名覆盖内建)
└── 观测:  run-history.jsonl(0600,1200 行轮转)+ subagent-artifacts/outputs/
```

**子代理本质**:一个专注的子 pi 会话 —— 有自己的上下文、任务、工具面;父会话派发任务并回收结果。

## 2. 何时用哪个 agent

| Agent | 用途 | 权限特征 |
|---|---|---|
| **scout** | 本地代码/配置侦查:相关文件、数据流、风险 | 只读导向,输出压缩上下文 |
| **researcher** | 网络/文档调研,带来源的简报 | 需子代理侧 pi-web-access |
| **research**(自定义) | 同上用 ego-browser | 复用浏览器登录态 |
| **worker** | 实现工作:改文件、验证、遇未批准决策时上报而非猜测 | **唯一写入线程** |
| **reviewer** | 对 diff/计划做代码评审 | 只读+小修 |
| **oracle** | 决策前第二意见,挑战假设 | 不编辑 |
| **evidence-auditor** | 独立核查研究结论是否有来源支撑 | 只读 |

口诀:**懂代码前 scout,信外部事实前 researcher,引结论前 evidence-auditor,动手用 worker,检查用 reviewer,决策没底用 oracle。**

## 3. 调用方式

### 3.1 自然语言(推荐起步)
```
"用 scout 摸清这个代码库,然后问我澄清问题"
"跑并行 reviewer:一个看正确性,一个看测试,一个看过度设计"
"问 oracle 我现在的计划有什么漏洞"
```
pi 自行决定调用与编排。

### 3.2 显式工具调用(精确控制)
核心参数(逆向自 schemas.ts,实证可用):

| 参数 | 作用 | 要点 |
|---|---|---|
| `agent` | agent 名 | 用户定义优先于内建同名 |
| `task` | 任务描述 | **必须自包含**:子代理是全新上下文,路径/约束/输出格式全写进去 |
| `async` | true=后台跑 | 完成时父会话收到原生通知;不要轮询等待 |
| `cwd` | 执行目录 | 默认继承父会话 |
| `model` | 模型覆盖 | 可后缀 `:off/minimal/low/medium/high/xhigh/max` 控思考档 |
| `context` | fresh/fork/profile | fork=带父上下文;fresh=白板(默认视配置) |
| `timeoutMs` | 超时 | 前台/单异步用配置值,默认 30m |
| `toolBudget` | 工具调用预算 | soft 提醒 / hard 熔断 |
| `usageBudget` | token/费用预算 | 超 hard 拒后续启动 |
| `isolation` | none/worktree | 写任务用 worktree 隔离 git 现场 |

### 3.3 并行编排
**同一个消息块内发多个 async subagent 调用**即并行扇出(实测 4 并发稳定,扇出上限 64)。
进阶:`workflow`/`workflowScript` 参数支持链式(`{previous}` 变量)、动态并行(`{item}` 模板)、收集聚合——见包内 docs/。

## 4. 已验证的实用模式

### 模式 A:并行侦查扇出(本机实测 2 轮 8 次全部成功)
4 个 scout 各管一条独立线索,异步并行,结果自动回巢:
- 提示词模板:`只读侦查,禁止写操作。任务:<具体目标+路径>。输出:紧凑中文报告 ≤500字。`
- 适用:审计、盘点、跨目录调查、数据挖掘

### 模式 B:无头降级通道(子代理工具不可用时的退路)
```bash
PI_NO_AUTO_COMMIT=1 PI_NO_NOTIFY=1 pi -p --no-session "<自包含任务>" &
```
OS 级并行,加载同款配置;实测 4/4 成功。注意会继承 HERDR_ENV 并向 herdr 上报状态。

### 模式 C:写任务隔离(设计要点,未实跑)
`worker` + `isolation:worktree` + `acceptance:reviewed` —— 唯一允许写的 agent,git 现场隔离,完成后评审门禁。

## 5. 安全机制(本机实证)

| 机制 | 状态 |
|---|---|
| bash-guard P1 补丁:子代理识别(PI_SUBAGENT_ID 三重检测)→ **灾难命令硬阻断不弹窗** | ✅ 补丁在位 |
| 主会话弹 Run/Abort(HIGH 级),子代理直接拒 | ✅ P4/P7 在位 |
| 密钥隔离:子代理不继承 auth.json 之外的敏感文件权限差异 | pi 进程同级,靠任务约束 |
| run-history 0600 + 轮转 | ✅ 实证 |

**纪律**:① 侦查任务必须写"只读,禁止写操作";② 写任务只派 worker;③ 生产目录操作配 worktree 隔离;④ 批量扇出设 toolBudget。

## 6. 观测与排障

```bash
# 运行历史(谁跑了什么、成败、耗时)
cat ~/.pi/agent/run-history.jsonl | tail -5
# 子代理产出没直接看到的,读 artifact
ls ~/.pi/agent/sessions/<项目目录>/subagent-artifacts/outputs/
# herdr 视角看子代理状态(权威 hook 已激活)
herdr agent list
```

**常见问题**:
1. 子代理改了 agents/*.md 不生效 → agent 定义同扩展一样**启动时加载**,需新会话
2. 长时间无响应 → 原生通知机制会唤醒父会话;交互式会话别用 sleep 轮询
3. 输出被截断 → artifact 文件里有完整版(实测 retention 管理)

## 7. 成本参考(本机实测)

- 4 个并行 scout 审计任务:每个约 30-60s,模型 glm-5.3-flash
- 历史总计 1.23 亿 token ≈ $2(deepseek/glm 系)——子代理扇出的边际成本极低
- 成本控制:默认继承父模型;`model` 参数可给子代理降档(如 `:minimal`)

## 8. 速查

```
最小调用:   subagent({agent:"scout", task:"只读...≤500字"})
并行扇出:   同一块内多个 async:true 调用
后台等结果: 不用等,原生通知会唤醒
强制同步:   async:false(阻塞父会话,慎用)
```

---
*维护:本说明书随 pi-subagents 升级而更新;实测记录见 run-history.jsonl*
