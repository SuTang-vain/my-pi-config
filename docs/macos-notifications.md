# macOS notification setup (herdr + Ghostty)

Scope: this page documents the desktop-notification chain for agents running inside herdr
(pi, claude, kimi, ...) on macOS: a notification when a run finishes or needs input, and a
click that returns to the corresponding pane.

Verified against herdr 0.9.5, Ghostty 1.3.1 and macOS 26 on 2026-10-23.

## 1. Which delivery channel works

| Channel | Notification identity | Click behaviour | Verdict |
|---|---|---|---|
| herdr plugin `dot.terminal-notifier` (bundled `HerdrNotify.app`) | herdr — a registered app bundle | `-execute` plus our `open -b` addition | **Adopted** |
| Ghostty OSC 777 | Ghostty (the most native option) | terminal app is raised by the OS | Not reachable inside herdr: the pane's escape sequences are consumed by herdr's VT parser and are not forwarded to the outer terminal |
| herdr `[ui.toast] delivery="system"` | Script Editor (osascript fallback; the Homebrew `terminal-notifier` cannot obtain notification permission on macOS 26) | opens Script Editor, not the terminal | Rejected |
| herdr `[ui.toast] delivery="terminal"` | — | — | Rejected: herdr emits OSC 99 only, which Ghostty does not parse (it handles OSC 9 and OSC 777) |

The plugin is the only option that produces a real app identity, because macOS attributes the
left icon and the click target to the application that posts the notification.

## 2. One-time installation

```bash
# 1) Install the plugin. Its [[build]] step registers the notifier app with Launch Services
#    and re-signs it ad hoc only when the existing signature is invalid.
herdr plugin install dot/herdr-terminal-notifier --yes

# 2) Write the plugin configuration from the template in this repository.
mkdir -p "$(herdr plugin config-dir dot.terminal-notifier)"
cp scripts/herdr-notify.config.env \
   "$(herdr plugin config-dir dot.terminal-notifier)/config.env"

# 3) Disable herdr's own channel so notifications and sounds are not doubled.
#    Append to ~/.config/herdr/config.toml:
#      [ui.toast]
#      delivery = "off"
#      [ui.sound]
#      enabled = false
herdr config check && herdr server reload-config

# 4) Manual step: System Settings -> Notifications -> herdr -> Allow Notifications
#    (Banners or Alerts). This grant cannot be scripted.
open "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
```

Skipping step 4 is the most common failure. `terminal-notifier` still exits 0 and the plugin log
still reports success, while nothing appears on screen.

## 3. Verification

```bash
# a) Did the plugin receive events, and did it fail?
herdr plugin log list | jq -r '.result.logs[-5:][] | "\(.log_id) exit=\(.exit_code) \(.stderr // "")"'

# b) Was the notification presented? This distinguishes "not sent" from "not permitted".
log show --last 5m --predicate 'eventMessage CONTAINS "herdr-notify"' --info \
  | grep -E "Presenting|Ignoring .* not visible"

# c) Decision trace: set DEBUG=1 in config.env, then read
cat ~/.local/state/herdr/plugins/dot.terminal-notifier/last-event.json
```

| Log line | Meaning |
|---|---|
| `Presenting <NotificationRecord app:"codes.dot.herdr-notify">` | presented to the user |
| `Ignoring ... from codes.dot.herdr-notify, not visible` | not permitted — return to step 4 |
| `decision=notify title=...` | the event triggered a notification |
| `drop reason=focused ws=... frontmost=...` | suppressed on purpose: the workspace is focused and the terminal is frontmost |
| `drop reason=trigger status=... not in [...]` | the status is outside `TRIGGER_STATUSES` |
| no new log entry at all | no event reached the plugin: the pane status did not change, or the plugin is disabled |

## 4. Triggers and noise control

herdr uses two words for a completion:

- a completion in a background workspace is reported as `done`;
- a completion in the focused workspace is reported as `idle` (treated as already seen);
- `agent focus` turns `done` into `idle` without emitting `agent_status_changed`, so clicking a
  notification does not retrigger one.

`TRIGGER_STATUSES` must therefore list `blocked done idle`. Listing `done` alone misses the case
"same workspace, user switched to another application"; listing `idle` alone misses background
workspaces. Noise is then handled by `SUPPRESS_FOCUSED=1`, which stays silent only when the
event's workspace is the focused one **and** the terminal is the frontmost application
(determined with `lsappinfo`; if detection fails, the notification is delivered).

## 5. Click-to-jump

The plugin passes `CLICK_COMMAND` to `terminal-notifier -execute` and never passes `-activate`,
so a click does not raise the terminal by itself. Append an explicit activation:

```env
CLICK_COMMAND="agent focus {pane}; open -b com.mitchellh.ghostty"
```

The pane is selected first and the terminal is raised afterwards, so the window appears with the
target pane already focused. Replace the bundle identifier when using another terminal
(`mdls -name kMDItemCFBundleIdentifier /Applications/<App>.app`).

## 6. Rollback

```bash
herdr plugin uninstall dot.terminal-notifier
# Restore herdr's own notifications if wanted: [ui.toast] delivery = "system" (macOS 26 renders
# these as Script Editor) or "herdr" (in-app toast).
```

## 7. Duplicate notifications

If both the plugin and a pi-side fallback notify, the cause is a running pi process that loaded
the extension before it was changed. Extensions are read from disk at startup, so a process
started earlier keeps executing the old code until `/reload` or restart.

```bash
log show --last 30m --predicate 'eventMessage CONTAINS "Presenting <NotificationRecord"' --info \
  | grep -oE 'app:"[^"]*"' | sort | uniq -c
#   codes.dot.herdr-notify      the plugin (should be the only source)
#   com.apple.ScriptEditor2     the old osascript path from notify.ts
```

## 8. Ownership boundaries

| Item | Owner | Versionable |
|---|---|---|
| Plugin and `HerdrNotify.app` | `herdr plugin` (under `~/.config/herdr/plugins/github-installations/`) | restored by `herdr plugin install` |
| Plugin configuration `config.env` | `~/.config/herdr/plugins/config/dot.terminal-notifier/` | template in this repository |
| herdr keys `[ui.toast]` / `[ui.sound]` | `~/.config/herdr/config.toml` (also holds themes) | documented here, not managed |
| Notification permission (TCC) | System Settings, keyed by bundle id and signature CDHash | not scriptable; an ad-hoc re-sign resets it |
| pi-side fallback `notify.ts` and the blocked-state bridge | this repository (`extensions/`) | shipped with this repository |
