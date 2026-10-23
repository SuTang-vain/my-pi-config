# pi 配置：排查型参考（按需查阅，不进 always-on）

> 这些结论在 2026-09 逐条实测过，但从 AGENTS.md 外移（2026-09-30 配置瘦身）——它们只在出问题或改配置时才需要。

## 1. 压缩失败："the summary is incomplete"

- 摘要调用的输出上限是 `min(0.8 × reserveTokens, model.maxTokens)`（源码：`src/core/compaction/compaction.ts`）。
- 默认 `reserveTokens: 16384` ⇒ 上限只有 13,107 tokens，**与历史多长无关**；换模型也没用（`min` 会取小值）。
- **键是嵌套的**：在 `settings.json` 里写

  ```json
  "compaction": { "reserveTokens": 48000, "keepRecentTokens": 60000 }
  ```

  读取处：`src/core/settings-manager.ts` 的 `this.settings.compaction?.reserveTokens ?? 16384` —— **顶层同名键会被静默忽略**（历史坑）。
- 生效方式：`/reload`（`resource-loader` 会调 `settingsManager.reload()`），不需重启。
- 本机现值：`reserveTokens: 48000` ⇒ 摘要上限 `min(38400, maxTokens)`；`keepRecentTokens: 60000`。

## 2. 子会话的继承边界（实测探针结论）

- 子会话**不**继承基础提示词与 context 文件；子代理要读到 `AGENTS.md` 需要同时声明 `inheritProjectContext: true` **和** `inheritGlobalContext: true`。
- `APPEND_SYSTEM.md` 里的委派/待办纪律**只对父会话生效**：探针子代理确认它"没有收到"这两条，且子会话没有 `todo` 工具、被明确禁止继续派子代理。
- 项目级规则走各仓库自己的 `<repo>/AGENTS.md`，可见性同样由上面两个开关决定。

## 3. productivity 扩展的开关机制

- 位置：`~/.pi/agent/extensions/productivity/`（提供 `todo` 工具、`/todos` 面板、footer/notify/usage-inject/session-name 模块）。
- 开关机制写在该目录的 README 中：编辑 `index.ts` 后 `/reload`。
- `usage-inject` 的播报节奏由 `usage-policy.js` 控制（`everyTurns: 8`、`minGapForCtxWarn: 2`，以及 150k/300k 绝对档）——那条 `[usage] … 触发：…` 是自动播报，不是用户指令。

## 4. 环境变量与设置的关系

- `PI_REASONING_LEVEL`（以及 `PI_PROVIDER`/`PI_MODEL`/`PI_SESSION_*`）是 pi **导出给 shell 命令的当前状态**（docs/environment-variables.md），不是输入项 —— 因此它不会与 `settings.json` 的 `defaultThinkingLevel` 冲突，设置仍是唯一真相源。
- `settings.json` 里 `modelThinkingLevels` 的逐模型覆盖优先于 `defaultThinkingLevel`（本机 deepseek-flash 因此显示 max）。

## 5. 通知链路：herdr 插件 vs pi 脚本（2026-10-23 实测）

**现役架构**：herdr 插件 `dot.terminal-notifier` 监听 `pane.agent_status_changed`，用自带重签名 App（`HerdrNotify.app`，bundle id `codes.dot.herdr-notify`）发系统通知，点击执行 `agent focus <pane>`。herdr 自身 `[ui.toast] delivery = "off"`、`[ui.sound] enabled = false` 关掉重复通道。pi 侧 `notify.ts` 在 `HERDR_ENV=1` 时早退，只作 herdr 外的兜底。

- **`delivery` 四个值**：`off`｜`herdr` 应用内浮窗｜`terminal` 让外层终端弹｜`system` 走 OS 通知服务。
- **`terminal` 与 Ghostty 不兼容**：herdr 0.9.5 的终端投递只发 OSC 99（二进制字面量只有 `]99;i=1:d=0;` / `]99;i=1:p=body;`），Ghostty 1.3.1 `src/terminal/osc.zig` 的状态表里**没有 `99`**，只认 OSC 9（title 恒空）与 OSC 777（`777;notify;<title>;<body>`）。`desktop-notifications` 默认 true。
- **`system` 在 macOS 26 失效**：herdr 先找 `terminal-notifier`，但 brew 版由 CLI 直接执行，TCC 拒发（`Notifications are not allowed for this application`，exit 3），于是回落 osascript ⇒ 显示「脚本编辑器」、点击无跳转。插件自带的 `HerdrNotify.app` 有独立 bundle 与 Info.plist，实测 exit 0 可用（首次需在 系统设置→通知→herdr 授权；重新 adhoc 签名会重置授权）。
- **点击跳转要自己补激活**：插件只把 `CLICK_COMMAND` 塞进 `-execute`（形如 `'/path/herdr' agent focus <pane>`，由 shell 执行），不传 `-activate` ⇒ 缺 `open -b com.mitchellh.ghostty` 时点通知不会把 Ghostty 拉前台。实测 `"agent focus {pane}; open -b com.mitchellh.ghostty"` 一次成功（先切 pane 再激活窗口）。
- **授权是硬门槛（实测踩过）**：未在 系统设置→通知→herdr 里允许时，`terminal-notifier` 照样 exit 0，`herdr plugin log new` 也是 exit 0，但 `log show --predicate 'eventMessage CONTAINS "herdr-notify"'` 会给出 `Ignoring <uuid> from codes.dot.herdr-notify, not visible`；授权后同一条变成 `Presenting <NotificationRecord …>` + `Queuing action present`。这就是"脚本跑通了却看不见通知"的唯一原因，排查先看这条日志。
- **状态词表（实测两轮才定下来）**：herdr 的"完成"有两个词 —— **后台 workspace** 的事件里 `data.agent_status="done"`；**当前聚焦 workspace** 里完成则记 `idle`（等价于已看过；`agent focus` 也会把 done 变 idle，且**不**再发 `agent_status_changed`，所以点通知不会自激）。因此 `TRIGGER_STATUSES` 必须 `"blocked done idle"`：只写 `done` 会漏「同一 workspace 内切到别的 App」，只写 `idle` 会漏后台 workspace。测试手法：`herdr pane report-agent <pane> --source test --agent pi --state working|blocked|idle`。
- **阻塞态必须补桥**：herdr 的 pi 集成 `pi.events.on("herdr:blocked")`，但 pi 内核与 `rpiv-ask-user-question` 都不发这个事件（后者发 `rpiv:ask-user:blocked`，载荷 `{active,toolCallId}`）⇒ 不补桥则问卷阻塞期间 pane 仍报 `working`。桥接点：`extensions/herdr-blocked-bridge.ts`。
- **噪声控制**：插件 `SUPPRESS_FOCUSED=1` 只在「event 的 workspace 就是 herdr 内聚焦的 workspace」且「终端是前台 App」时静音（`lsappinfo` 判前台，失败则 fail-open 照发）；`DEBOUNCE_SECONDS=2`；`GROUP="{pane}-{new_status}"` 让 done 不顶掉未读的 blocked。
- **触发时机（pi 侧，仅 herdr 外）**：`agent_end` 后仍可能有 retry / overflow recovery / compaction / 排队任务，通知应挂 `agent_settled`（docs/extensions.md 明写）。
- **排查**：`herdr plugin log list`（每次事件的 exit/stderr）；插件 `DEBUG=1` 后看 `~/.local/state/herdr/plugins/dot.terminal-notifier/last-event.json`（含 `decision=notify|drop reason=…`）。配置在 `~/.config/herdr/plugins/config/dot.terminal-notifier/config.env`。
- 附带发现：herdr 自带声音播放失败过（`AudioQueueStart failed (-66681)`，client log 2026-10-20），现已随 `[ui.sound] enabled=false` 关闭，声音交给插件的 `SOUND_*`。
