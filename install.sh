#!/usr/bin/env bash
# install.sh — copy this repository into ~/.pi/agent
#
#   ./install.sh             copy configuration and install extension packages
#   ./install.sh --dry-run   print the copy operations without performing them
#
# Idempotent. Does not create or overwrite auth.json (it holds credentials; see SECURITY.md),
# does not touch sessions/, and does not install global npm packages.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "[dry] $*"; else eval "$@"; fi; }

say "source: $ROOT"
say "target: $DEST"
mkdir -p "$DEST"

# Directories are synced wholesale.
for d in agents extensions skills themes docs scripts; do
  [ -d "$ROOT/$d" ] || continue
  say "-> $d/"
  run "mkdir -p '$DEST/$d'"
  run "rsync -a --exclude='node_modules' '$ROOT/$d/' '$DEST/$d/'"
done

# Single files: the settings file and the two prompt layers.
for f in settings.json AGENTS.md APPEND_SYSTEM.md; do
  [ -f "$ROOT/$f" ] || continue
  say "-> $f"
  if [ -f "$DEST/$f" ]; then
    stamp="$(date +%Y%m%d%H%M%S)"
    say "   exists; keeping a backup as $f.bak-$stamp"
    run "cp '$DEST/$f' '$DEST/$f.bak-$stamp'"
  fi
  run "cp '$ROOT/$f' '$DEST/$f'"
done

# Extension packages.
if [ -f "$ROOT/npm/package.json" ]; then
  say "-> npm dependencies ($ROOT/npm)"
  run "mkdir -p '$DEST/npm'"
  run "cp '$ROOT/npm/package.json' '$DEST/npm/package.json'"
  run "cd '$DEST/npm' && npm install --legacy-peer-deps"
fi

say ""
say "Next steps:"
say "  1. Create $DEST/auth.json with your own provider keys and chmod 600:"
say '     {"<provider>":{"type":"api_key","key":"..."}}'
say "  2. The skill whitelist in settings.json points at skills-optional/; place those skills"
say "     there yourself, or delete the corresponding entries."
say "  3. Verify: cd $DEST/npm && npm run selftest"
