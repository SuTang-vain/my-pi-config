/**
 * Bridge: pi `ask_user_question` → herdr agent state `blocked`.
 *
 * herdr's pi integration (`herdr-agent-state.ts`, managed by herdr) listens for
 * a `herdr:blocked` event, but nothing in pi emits it — so a questionnaire that
 * blocks mid-run leaves the pane reporting `working`, and herdr can neither
 * show its "needs input" notification nor roll the workspace up as blocked.
 *
 * @juicesharp/rpiv-ask-user-question already brackets every open questionnaire
 * with `rpiv:ask-user:blocked` ({ active, toolCallId }). We only translate that
 * into the { active, label } shape the integration expects. No herdr file is
 * edited — this sits beside it, exactly as the integration's header asks.
 *
 * Inert outside herdr (no HERDR_ENV=1) and when the package is not installed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked";

type BlockedPayload = { active?: unknown; toolCallId?: unknown };

export default function (pi: ExtensionAPI) {
	pi.events.on(ASK_USER_BLOCKED_EVENT, (data: BlockedPayload) => {
		if (process.env.HERDR_ENV !== "1") return;
		if (!data || typeof data.active !== "boolean") return;

		pi.events.emit("herdr:blocked", {
			active: data.active,
			label: data.active ? "waiting for your input" : undefined,
		});
	});
}
