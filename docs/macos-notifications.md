# macOS 通知设置方法（herdr / Ghostty 场景）

> 这是**本机桌面通知链路的完整设置方法**，不是 pi 专属功能说明。
> 适用：在 herdr 里跑任意 agent（pi / claude / kimi …），希望"跑完/需要输入"时弹出系统通知，且**点通知能跳回对应 pane**。
> 最后验证：2026-10-23，herdr 0.9.5 / Ghostty 1.3.1 / macOS 26 (Tahoe)。

## 1. 结论：四条通道，只有一条能点得动

| 通道 | 通知归属 | 点击行为 | 判定 |
|---|---|---|---|
| **herdr 插件 + `HerdrNotify.app`** | **herdr**（真实 App 身份，独立 bundle） | 插件 `-execute` + 我们补的 `open -b` | ✅ 采用 |
| Ghostty OSC 777 | Ghostty（最原生） | 系统自动聚焦窗口 | ❌ 在 herdr 里不可达：pane 的 OSC 被 herdr 的 VT 吃掉，不转发外层终端 |
| herdr `[ui.toast] delivery="system"` | 脚本编辑器（osascript 回落，brew terminal-notifier 在 macOS 26 拿不到授权） | 打开脚本编辑器，不跳终端 | ❌ |
| herdr `[ui.toast] delivery="terminal"` | — | — | ❌ herdr 只发 OSC 99，Ghostty 解析器没有 `99`（只认 OSC 9 / OSC 777） |

**为什么插件是"最原生"的那个**：macOS 通知的左图标与点开行为由**发通知的 App 的身份**决定。只有落成一个注册过的 `.app`（bundle id `codes.dot.herdr-notify`，`LSUIElement`）才能拿到真实归属；`osascript` 永远是「脚本编辑器」。

## 2. 一次性安装（约 3 分钟）

```bash
# 1) 装插件（会跑 [[build]]：lsregister 注册 notifier app，必要时 adhoc 重签）
herdr plugin install dot/herdr-terminal-notifier --yes

# 2) 写配置（模板在 ~/.pi/agent/scripts/herdr-notify.config.env）
mkdir -p "$(herdr plugin config-dir dot.terminal-notifier)"
cp ~/.pi/agent/scripts/herdr-notify.config.env \
   "$(herdr plugin config-dir dot.terminal-notifier)/config.env"

# 3) 关掉 herdr 自己的重复通道，避免双弹/双响
#    ~/.config/herdr/config.toml 追加：
#      [ui.toast]
#      delivery = "off"
#      [ui.sound]
#      enabled = false
herdr config check && herdr server reload-config

# 4) 【必须人工】系统设置 → 通知 → herdr → 允许通知 + 横幅/提醒
open "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
```

第 4 步不可脚本化（TCC 授权只能人来点）。**跳过它的表现极具误导性**：`terminal-notifier` 返回 `0`、插件日志 `exit=0`，但屏幕上什么都没有。

## 3. 验证三板斧

```bash
# a) 插件是否被事件驱动、是否报错
herdr plugin log list | jq -r '.result.logs[-5:][] | "\(.log_id) exit=\(.exit_code) \(.stderr//"")"'

# b) 通知到底有没有被展示（最关键，能区分"没发"和"没权限"）
log show --last 5m --predicate 'eventMessage CONTAINS "herdr-notify"' --info \
  | grep -E "Presenting|Ignoring .* not visible"

# c) 决策轨迹：config.env 里设 DEBUG=1 后
cat ~/.local/state/herdr/plugins/dot.terminal-notifier/last-event.json
```

判读：

| 日志 | 含义 |
|---|---|
| `Presenting <NotificationRecord app:"codes.dot.herdr-notify"…>` | ✅ 已展示 |
| `Ignoring … from codes.dot.herdr-notify, not visible` | ❌ 未授权（回第 2 步第 4 条） |
| `decision=notify title=…` | ✅ 触发了 |
| `drop reason=focused ws=… frontmost=com.mitchellh.ghostty` | ✅ 有意静音（你正在看这个 workspace 且终端在前台） |
| `drop reason=trigger status=… not in [...]` | 状态不在 `TRIGGER_STATUSES`，检查是否漏了 `done`/`idle` |
| 完全没有新日志 | 事件没到插件：pane 状态没变化，或插件被 disable |
| Script Editor 也弹了一条（双弹） | 老 pi 进程仍在用改前的 `notify.ts`（`agent_end` + osascript 无 herdr 守卫）。扩展是**启动时读文件**，改完不 `/reload` 就一直用内存里的旧代码 |

## 4. 触发与抖动控制（状态词表是坑）

herdr 的"完成"有**两个词**，实测结论：

- 后台 workspace 里完成 → `agent_status="done"`
- **当前聚焦的 workspace** 里完成 → `agent_status="idle"`（herdr 视为已看过）
- `agent focus` 把 done 变 idle，且**不再发** `agent_status_changed` → 点通知不会自激

所以 `TRIGGER_STATUSES` 必须 `"blocked done idle"`：只写 `done` 会漏「同一 workspace 内切到别的 App」，只写 `idle` 会漏后台 workspace。真正的降噪靠 `SUPPRESS_FOCUSED=1`（仅当 workspace 聚焦**且**终端是前台 App 时静音，用 `lsappinfo` 判前台，判不出就照发）。

## 5. 点击跳转（插件的缺口）

插件只把 `CLICK_COMMAND` 塞进 `terminal-notifier -execute`，**不传 `-activate`**，所以默认点通知不会把终端拉前台（看起来"点了没反应"）。补法：

```env
CLICK_COMMAND="agent focus {pane}; open -b com.mitchellh.ghostty"
```

顺序：先 herdr 选中目标 pane，再激活窗口 —— 窗口上来时已经在正确 pane。若换终端，改 bundle id（`mdls -name kMDCFBundleIdentifier /Applications/<App>.app`）。实测：点击后 Ghostty 前置且 herdr 切到目标 workspace/pane。

## 5.5 双弹排障（实测踩过）

`notify.ts` 改成 `HERDR_ENV=1` 早退后，**已经在跑的 pi 会话不会自动变**——它们内存里是旧代码，每次 settle 仍会 osascript 弹一条「脚本编辑器」。

```bash
# 谁在发：看最近半小时的展示记录
log show --last 30m --predicate 'eventMessage CONTAINS "Presenting <NotificationRecord"' --info \
  | grep -oE 'app:"[^"]*"' | sort | uniq -c
#   codes.dot.herdr-notify (插件，应为唯一来源)
#   com.apple.ScriptEditor2 (旧 notify.ts 的 osascript) ← 双弹元凶
```

处置：在每个在跑的 pi 会话里执行 `/reload`（同时也会加载阻塞桥）；不想逐个重载可临时关掉 系统设置→通知→脚本编辑器，立即静音。

## 6. 回滚

```bash
herdr plugin uninstall dot.terminal-notifier
# 恢复 herdr 自弹（可选）：config.toml 里 [ui.toast] delivery = "system" 或 "herdr"
#   （在 macOS 26 上 "system" 实际由 osascript 显示为「脚本编辑器」）
```

`notify.ts`（pi 侧兜底，仅在 herdr 之外生效）不受影响；它靠 `HERDR_ENV=1` 自抑制。

## 7. 归属边界

| 内容 | 归属 | 是否可版本化 |
|---|---|---|
| 插件本体、`HerdrNotify.app` | `herdr plugin`（`~/.config/herdr/plugins/github-installations/`，herdr 管理） | 由 `herdr plugin install` 恢复 |
| 插件配置 `config.env` | `~/.config/herdr/plugins/config/dot.terminal-notifier/`（herdr 管理的目录，内容归用户） | 模板在 `~/.pi/agent/scripts/herdr-notify.config.env` |
| herdr 主配置 `[ui.toast]`/`[ui.sound]` | `~/.config/herdr/config.toml`（含主题等无关项，herdr 无 include 机制） | 文档记录，未纳管 |
| 通知授权（TCC） | macOS 系统设置，按 bundle id + 签名 CDHash | ❌ 不可脚本化；adhoc 重签会重置 |
| pi 侧兜底 `notify.ts` + 阻塞桥 | 本仓 `extensions/` | ✅ 已随本仓发布 |

## 8. 相关文档

- 平台细节与否决项：`~/.pi/agent/docs-notes/pi-config-facts.md` 第 5 节
- 一键安装/自检：`~/.pi/agent/scripts/setup-macos-notifications.sh`
