#!/usr/bin/env bash
# install.sh — 把本仓内容装到 ~/.pi/agent（幂等，不覆盖你已有的 auth.json / sessions / models-store）
#
#   ./install.sh            # 复制配置 + 安装扩展包
#   ./install.sh --dry-run   # 只打印将要执行的复制动作
#
# 不做什么：不写 auth.json（含密钥，需你自备）、不碰 sessions/、不装 npm 全局包。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "[dry] $*"; else eval "$@"; fi; }

say "源: $ROOT"
say "目标: $DEST"
mkdir -p "$DEST"

# 目录：整体同步（agents / extensions / skills / themes / docs / scripts）
for d in agents extensions skills themes docs scripts; do
  [ -d "$ROOT/$d" ] || continue
  say "→ $d/"
  run "mkdir -p '$DEST/$d'"
  run "rsync -a --exclude='node_modules' '$ROOT/$d/' '$DEST/$d/'"
done

# 单文件：settings.json 与提示层
for f in settings.json AGENTS.md APPEND_SYSTEM.md; do
  [ -f "$ROOT/$f" ] || continue
  say "→ $f"
  if [ -f "$DEST/$f" ]; then
    say "  （已存在，备份为 $f.bak-$(date +%Y%m%d%H%M%S)）"
    run "cp '$DEST/$f' '$DEST/$f.bak-$(date +%Y%m%d%H%M%S)'"
  fi
  run "cp '$ROOT/$f' '$DEST/$f'"
done

# 扩展包
if [ -f "$ROOT/npm/package.json" ]; then
  say "→ npm 依赖安装（$ROOT/npm）"
  run "mkdir -p '$DEST/npm'"
  run "cp '$ROOT/npm/package.json' '$DEST/npm/package.json'"
  run "cd '$DEST/npm' && npm install --legacy-peer-deps"
fi

say ""
say "完成。下一步："
say "  1. 自备凭据：写 $DEST/auth.json（{\"<provider>\":{\"type\":\"api_key\",\"key\":\"...\"}}）并 chmod 600"
say "  2. 技能白名单里的 skills-optional/* 需自行放置，或从 settings.json 里删掉对应条目"
say "  3. 验证：cd $DEST/npm && npm run selftest"
