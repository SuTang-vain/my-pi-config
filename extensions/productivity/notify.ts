/**
 * Notify extension — desktop notification when the agent is done.
 *
 * Notification backends (in order of preference):
 *   - macOS: osascript "display notification" (works in any terminal app)
 *   - Windows Terminal (WSL): PowerShell toast
 *   - Kitty: OSC 99
 *   - iTerm2 / Ghostty / WezTerm / rxvt-unicode: OSC 777
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

function notify(title: string, body: string): void {
	if (process.platform === "darwin") {
		notifyMac(title, body);
	} else if (process.env.WT_SESSION) {
		notifyWindows(title, body);
	} else if (process.env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body);
	} else {
		notifyOSC777(title, body);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		if (process.env.PI_NO_NOTIFY === "1") return;

		const name = pi.getSessionName();
		notify("pi", name ? `「${name}」已完成,等待输入` : "已完成,等待输入");
	});
}
