#!/usr/bin/env bash
# setup-macos-notifications.sh — 安装/自检 macOS 通知链路（herdr 插件版）
#
# 方法说明：~/.pi/agent/docs-notes/macos-notifications.md
# 幂等：默认只补齐缺失项，不覆盖已有 config.env；--force-config 才覆盖。
#
# 用法：
#   setup-macos-notifications.sh                 # 检查 + 补齐（不动已有配置）
#   setup-macos-notifications.sh --apply         # 同上（显式）
#   setup-macos-notifications.sh --force-config  # 用模板覆盖 config.env
#   setup-macos-notifications.sh --test          # 额外发一条自检通知（验 TCC）
#
# 不做什么：不修改 ~/.config/herdr/config.toml（含主题等无关项，见文档），
#           不动 macOS 通知授权（TCC 只能人工点）。
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

command -v "$HERDR" >/dev/null 2>&1 || { bad "herdr 不在 PATH（或设 HERDR_BIN）"; exit 1; }
[ -f "$TEMPLATE" ] || { bad "模板缺失: $TEMPLATE"; exit 1; }

say "== 1. 插件 =="
installed=0
if "$HERDR" plugin list 2>/dev/null | awk -v id="$PLUGIN_ID" '$1=="-" && $2==id {found=1} END{exit !found}'; then
  installed=1; ok "$PLUGIN_ID 已安装"
else
  if [ "$mode_check" = 1 ]; then
    warn "$PLUGIN_ID 未安装（--apply 时执行：herdr plugin install $PLUGIN_SLUG --yes）"
  else
    "$HERDR" plugin install "$PLUGIN_SLUG" --yes >/dev/null && ok "已安装 $PLUGIN_ID"
    installed=1
  fi
fi

say "== 2. 插件配置 =="
cfg_dir="$("$HERDR" plugin config-dir "$PLUGIN_ID" 2>/dev/null || true)"
if [ -z "$cfg_dir" ]; then
  bad "取不到 config-dir（插件未装好？）"; exit 1
fi
cfg="$cfg_dir/config.env"
if [ -f "$cfg" ] && [ "$force_config" = 0 ]; then
  ok "已有 ${cfg}（保留，--force-config 才覆盖）"
elif [ "$mode_check" = 1 ]; then
  warn "$cfg 缺失（--apply 时从模板复制）"
else
  mkdir -p "$cfg_dir"; cp "$TEMPLATE" "$cfg"; ok "已写入 $cfg"
fi
[ -f "$cfg" ] && say "     TRIGGER_STATUSES=$(sed -n 's/^TRIGGER_STATUSES=//p' "$cfg")"
[ -f "$cfg" ] && say "     CLICK_COMMAND=$(sed -n 's/^CLICK_COMMAND=//p' "$cfg")"

say "== 3. herdr 自身通道（防双弹）=="
hcfg="$HOME/.config/herdr/config.toml"
if [ -f "$hcfg" ] && grep -qE '^\s*delivery\s*=\s*"off"' "$hcfg"; then
  ok "ui.toast delivery = off"
else
  warn "未设 [ui.toast] delivery = \"off\"（herdr 与插件会双弹）"
fi
if [ -f "$hcfg" ] && grep -qE '^\s*enabled\s*=\s*false' "$hcfg"; then
  ok "ui.sound enabled = false"
else
  warn "未关 [ui.sound]（会与插件 SOUND_* 双响）"
fi
"$HERDR" config check >/dev/null 2>&1 && ok "config.toml 语法通过" || bad "config.toml 语法错误：herdr config check"

say "== 4. notifier app 注册 =="
app="$(find "$HOME/.config/herdr/plugins" -maxdepth 6 -name HerdrNotify.app -type d 2>/dev/null | head -1)"
if [ -n "$app" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" 2>/dev/null || true
  ok "已注册 $app"
else
  warn "找不到 HerdrNotify.app（插件未安装？）"
fi

say "== 5. 通知授权（只能人工）=="
say "    系统设置 → 通知 → herdr → 允许通知（横幅/提醒）"
say "    未授权时 terminal-notifier 仍返回 0，但系统日志是 'Ignoring … not visible'"
say "    打开设置：open 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'"

if [ "$do_test" = 1 ] && [ -n "$app" ]; then
  say "== 6. 自检通知 =="
  "$app/Contents/MacOS/terminal-notifier" -title "π · 通知自检" \
    -message "看到横幅=已授权；点我应跳到 Ghostty" -group "pi-notify-selftest" \
    >/dev/null 2>&1 && ok "已发送；10 秒内没看到就查：log show --last 1m --predicate 'eventMessage CONTAINS \"herdr-notify\"' --info | grep -E 'Presenting|not visible'"
fi

say ""
say "验证：herdr plugin log list | jq -r '.result.logs[-3:][] | \"\(.exit_code) \(.stderr//\"\")\"'"
