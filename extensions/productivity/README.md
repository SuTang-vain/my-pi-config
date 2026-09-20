# Productivity Suite(方案 C)

个人效率扩展套件,安装在 `~/.pi/agent/extensions/productivity/`,pi 启动时自动加载。

## 模块

| 文件 | 功能 | 开关 |
| --- | --- | --- |
| `session-name.ts` | 首次输入时自动命名会话(截断 40 字符,跳过 `/` 命令);`/session-name [名字]` 手动设置/查看 | — |
| `notify.ts` | agent 完成时桌面通知(macOS 用 osascript,兼容任何终端;Kitty/iTerm2/Ghostty 用 OSC 协议) | `PI_NO_NOTIFY=1` |
| ~~`model-status.ts`~~ | 状态栏常驻当前模型——**已停用**(2026-09-20,footer 已常驻显示模型,双显示属纯重复);恢复=取消 `index.ts` 里两行注释 | 在 `index.ts` 注释中 |
| `todo.ts` | 官方 todo 扩展:模型可调用的 `todo` 工具 + `/todos` 可视化面板(状态存会话内,分支安全) | — |
| `footer.ts` | TUI 底部自定义 footer:本会话 token 用量 / 成本 / git 分支 / 模型,`/footer` 开关 | — |
| `usage-inject.ts`(+`usage-policy.js`) | 把用量/成本/ctx 按策略周期性注入模型上下文(模型看不到 footer);策略是纯函数,测试 `npm run selftest` 含 | — |

## 日常用法

- 启动 `pi` 后,future 底部自动显示 `↑3.2k ↓1.1k $0.042 deepseek-v4-pro (main)`
- 直接说"帮我列个待办"——模型会调用 `todo` 工具;`/todos` 查看面板
- 每次 agent 跑完,系统弹通知
- `/resume` 列表里会话名是任务摘要而不是原始长 prompt

## 调整

- 想关掉某个模块:编辑 `index.ts`,注释掉对应行,`/reload` 热重载
- 单独调试:`pi -e ~/.pi/agent/extensions/productivity/index.ts`

## 注意

- 扩展以你的完整用户权限运行(本套件仅调用 git / osascript / 通知协议,无网络请求)
