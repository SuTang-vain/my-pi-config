#!/usr/bin/env bash
# setup-macos-notifications.sh — install or inspect the macOS notification chain (herdr plugin)
#
# Procedure: docs/macos-notifications.md
# Idempotent: by default only missing pieces are created; an existing config.env is kept.
# --force-config overwrites it.
#
# Usage:
#   setup-macos-notifications.sh                 # inspect and fill gaps (keeps existing config)
#   setup-macos-notifications.sh --apply         # same, stated explicitly
#   setup-macos-notifications.sh --force-config  # overwrite config.env from the template
#   setup-macos-notifications.sh --test          # also send one self-test notification (checks TCC)
#
# Not performed: editing ~/.config/herdr/config.toml (it also holds theme settings; see the
# documentation), and granting notification permission (TCC requires a human action).
set -euo pipefail

PLUGIN_ID="dot.terminal-notifier"
PLUGIN_SLUG="dot/herdr-terminal-notifier"
HERDR="${HERDR_BIN:-herdr}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/herdr-notify.config.env"

mode_check=1; force_config=0; do_test=0
for arg in "$@"; do
  case "$arg" in
    --apply)        mode_check=0 ;;
    --force-config) force_config=1; mode_check=0 ;;
    --test)         do_test=1 ;;
    -h|--help)      sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
ok()   { printf '  ✅ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }
bad()  { printf '  ❌ %s\n' "$*"; }

command -v "$HERDR" >/dev/null 2>&1 || { bad "herdr is not on PATH (or set HERDR_BIN)"; exit 1; }
[ -f "$TEMPLATE" ] || { bad "template missing: $TEMPLATE"; exit 1; }

say "== 1. plugin =="
installed=0
if "$HERDR" plugin list 2>/dev/null | awk -v id="$PLUGIN_ID" '$1=="-" && $2==id {found=1} END{exit !found}'; then
  installed=1; ok "$PLUGIN_ID is installed"
else
  if [ "$mode_check" = 1 ]; then
    warn "$PLUGIN_ID is not installed (--apply runs: herdr plugin install $PLUGIN_SLUG --yes)"
  else
    "$HERDR" plugin install "$PLUGIN_SLUG" --yes >/dev/null && ok "installed $PLUGIN_ID"
    installed=1
  fi
fi

say "== 2. plugin configuration =="
cfg_dir="$("$HERDR" plugin config-dir "$PLUGIN_ID" 2>/dev/null || true)"
if [ -z "$cfg_dir" ]; then
  bad "cannot resolve the config directory (is the plugin installed?)"; exit 1
fi
cfg="$cfg_dir/config.env"
if [ -f "$cfg" ] && [ "$force_config" = 0 ]; then
  ok "existing ${cfg} kept (only --force-config overwrites it)"
elif [ "$mode_check" = 1 ]; then
  warn "$cfg is missing (--apply copies it from the template)"
else
  mkdir -p "$cfg_dir"; cp "$TEMPLATE" "$cfg"; ok "wrote $cfg"
fi
[ -f "$cfg" ] && say "     TRIGGER_STATUSES=$(sed -n 's/^TRIGGER_STATUSES=//p' "$cfg")"
[ -f "$cfg" ] && say "     CLICK_COMMAND=$(sed -n 's/^CLICK_COMMAND=//p' "$cfg")"

say "== 3. herdr native channel (prevents duplicates) =="
hcfg="$HOME/.config/herdr/config.toml"
if [ -f "$hcfg" ] && grep -qE '^\s*delivery\s*=\s*"off"' "$hcfg"; then
  ok "ui.toast delivery = off"
else
  warn "[ui.toast] delivery = \"off\" is not set (herdr and the plugin would both notify)"
fi
if [ -f "$hcfg" ] && grep -qE '^\s*enabled\s*=\s*false' "$hcfg"; then
  ok "ui.sound enabled = false"
else
  warn "[ui.sound] is not disabled (it would duplicate the plugin's SOUND_*)"
fi
"$HERDR" config check >/dev/null 2>&1 && ok "config.toml parses" || bad "config.toml has a syntax error: run herdr config check"

say "== 4. notifier app registration =="
app="$(find "$HOME/.config/herdr/plugins" -maxdepth 6 -name HerdrNotify.app -type d 2>/dev/null | head -1)"
if [ -n "$app" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" 2>/dev/null || true
  ok "registered $app"
else
  warn "HerdrNotify.app not found (is the plugin installed?)"
fi

say "== 5. notification permission (manual) =="
say "    System Settings -> Notifications -> herdr -> Allow Notifications (Banners or Alerts)"
say "    Without the grant, terminal-notifier still exits 0 while the system log shows 'Ignoring ... not visible'"
say "    Open the pane: open 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'"

if [ "$do_test" = 1 ] && [ -n "$app" ]; then
  say "== 6. self-test notification =="
  "$app/Contents/MacOS/terminal-notifier" -title "pi · notification self-test" \
    -message "A banner means the grant is active; clicking it should raise the terminal" -group "pi-notify-selftest" \
    >/dev/null 2>&1 && ok "sent; if nothing appears within 10 s, check: log show --last 1m --predicate 'eventMessage CONTAINS \"herdr-notify\"' --info | grep -E 'Presenting|not visible'"
fi

say ""
say "Verify: herdr plugin log list | jq -r '.result.logs[-3:][] | \"\(.exit_code) \(.stderr//\"\")\"'"
