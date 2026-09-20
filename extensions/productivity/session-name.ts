/**
 * Session naming extension.
 *
 * - Auto-names the session from the first interactive user message
 *   (so /resume shows a meaningful title instead of a raw prompt).
 * - /session-name [name] to set or show the current name manually.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	// Auto-name on the first interactive input of the session.
	pi.on("input", async (event) => {
		// Only interactive typing; ignore RPC/extension-injected messages.
		if (event.source !== "interactive") return;
		// Don't rename while a reply is streaming (steer/follow-up).
		if (event.streamingBehavior) return;
		// Already named (auto or manual) — keep it.
		if (pi.getSessionName()) return;

		const text = (event.text ?? "").trim();
		if (!text || text.startsWith("/")) return;

		const name = text.replace(/\s+/g, " ").slice(0, 40);
		pi.setSessionName(name);
	});

	pi.registerCommand("session-name", {
		description: "Set or show session name (usage: /session-name [new name])",
		handler: async (args, ctx) => {
			const name = args.trim();

			if (name) {
				pi.setSessionName(name);
				ctx.ui.notify(`Session named: ${name}`, "info");
			} else {
				const current = pi.getSessionName();
				ctx.ui.notify(current ? `Session: ${current}` : "No session name set", "info");
			}
		},
	});
}
