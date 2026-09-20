/**
 * Productivity suite entry point (Plan C).
 *
 * Composes five independent modules so each one can be disabled
 * individually by commenting out its line:
 *
 *   session-name.ts  - auto-names sessions from the first user message
 *   notify.ts        - desktop notification when the agent finishes
 *   model-status.ts  - current model in the status bar（已停用：footer 已覆盖模型显示）
 *   todo.ts          - LLM-callable todo tool + /todos UI (official example)
 *   footer.ts        - custom footer: tokens / cost / git branch / model
 *   usage-inject.ts  - 把用量/成本/ctx 周期性注入模型上下文（模型看不到 footer）
 *
 * Install: this whole directory lives under ~/.pi/agent/extensions/,
 * so pi auto-discovers it. Use /reload to hot-reload after edits.
 * Kill switches: PI_NO_NOTIFY=1 (skip notifications).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import sessionName from "./session-name.ts";
import notify from "./notify.ts";
// model-status 已停用（2026-09-20）：footer 已常驻显示模型，状态栏再显示一次属纯重复。
// 若关闭 footer 后想要状态栏模型指示，取消下面两行的注释即可。
// import modelStatus from "./model-status.ts";
import todo from "./todo.ts";
import footer from "./footer.ts";
import usageInject from "./usage-inject.ts";

export default function (pi: ExtensionAPI) {
	sessionName(pi);
	notify(pi);
	// modelStatus(pi);
	todo(pi);
	footer(pi);
	usageInject(pi);

	console.log("[productivity] 5 modules loaded (session-name, notify, todo, footer, usage-inject)");
}
