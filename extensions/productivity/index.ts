/**
 * Productivity suite entry point (Plan C).
 *
 * Composes five independent modules so each one can be disabled
 * individually by commenting out its line:
 *
 *   session-name.ts  - auto-names sessions from the first user message
 *   notify.ts        - desktop notification when the agent finishes
 *   model-status.ts  - current model in the status bar (disabled: the footer already shows it)
 *   todo.ts          - LLM-callable todo tool + /todos UI (official example)
 *   footer.ts        - custom footer: tokens / cost / git branch / model
 *   usage-inject.ts  - periodically inject usage/cost/ctx into the model context (the model cannot see the footer)
 *
 * Install: this whole directory lives under ~/.pi/agent/extensions/,
 * so pi auto-discovers it. Use /reload to hot-reload after edits.
 * Kill switches: PI_NO_NOTIFY=1 (skip notifications).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import sessionName from "./session-name.ts";
import notify from "./notify.ts";
// model-status is disabled (2026-09-20): the footer already shows the model, so a second display is redundant.
// To restore a status-bar model indicator after disabling the footer, uncomment the two lines below.
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
