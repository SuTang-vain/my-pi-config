/**
 * Notify extension — desktop notification when the agent is done.
 *
 * Scope: this only fires when pi runs OUTSIDE herdr. Inside herdr the
 * notification is owned by herdr itself ([ui.toast] delivery = "system",
 * fed by the state the herdr pi integration reports), so the handler bails
 * on HERDR_ENV=1 to avoid a second, duplicate notification.
 *
 * Backends, first match wins:
 *   - Ghostty / iTerm2 / WezTerm / rxvt-unicode: OSC 777 (title + body, the
 *     notification is attributed to the terminal app and clicking it focuses
 *     that window — hence preferred over osascript on macOS)
 *   - Kitty: OSC 99
 *   - Windows Terminal (WSL): PowerShell toast
 *   - macOS fallback: osascript "display notification" (shows as Script Editor,
 *     cannot activate the terminal)
 *
 * Trigger: agent_settled, not agent_end — agent_end can be followed by
 * retries, overflow recovery, compaction or queued work, so notifying there
 * fires repeatedly inside one run. Docs: "Use agent_settled for
 * notification-only work."
 *
 * Kill switch: PI_NO_NOTIFY=1
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

function notifyMac(title: string, body: string): void {
	// JSON.stringify gives a safely quoted AppleScript string.
	const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
	execFile("osascript", ["-e", script]);
}

function notifyWindows(title: string, body: string): void {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	const script = [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
	].join("; ");
	execFile("powershell.exe", ["-NoProfile", "-Command", script]);
}

function notifyOSC777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
	process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

/** Terminals whose OSC 777 notification Ghostty-style is supported and clickable. */
const OSC777_TERMINALS = new Set(["ghostty", "iTerm.app", "WezTerm", "rxvt-unicode"]);

function notify(title: string, body: string): void {
	if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else if (OSC777_TERMINALS.has(process.env.TERM_PROGRAM ?? "")) {
		notifyOSC777(title, body);
	} else if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.platform === "darwin") {
		notifyMac(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_settled", async () => {
		if (process.env.PI_NO_NOTIFY === "1") return;
		// herdr owns notifications for panes it hosts (and suppresses them for
		// the tab you are already looking at, which we cannot detect from here).
		if (process.env.HERDR_ENV === "1") return;

		const name = pi.getSessionName();
		notify("pi", name ? `[${name}] finished, awaiting input` : "finished, awaiting input");
	});
}
