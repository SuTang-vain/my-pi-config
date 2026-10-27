/**
 * Model status extension — shows the current model in the status bar.
 *
 * Updates:
 *   - on session_start (session restore / new session)
 *   - on model_select (/model, Ctrl+P cycling, runtime setModel)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const show = (ctx: ExtensionContext, modelId: string | undefined) => {
		if (ctx.mode === "tui" && modelId) {
			ctx.ui.setStatus("model", `🤖 ${modelId}`);
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		show(ctx, ctx.model?.id);
	});

	pi.on("model_select", async (event, ctx) => {
		const { model, previousModel, source } = event;
		const next = `${model.provider}/${model.id}`;
		const prev = previousModel ? `${previousModel.provider}/${previousModel.id}` : "none";

		if (source !== "restore") {
			ctx.ui.notify(`Model: ${next}`, "info");
		}
		show(ctx, model.id);
		console.log(`[model_select] ${prev} → ${next} (${source})`);
	});
}
