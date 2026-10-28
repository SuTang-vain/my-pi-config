#!/usr/bin/env bash
# install.sh — copy this repository into ~/.pi/agent
#
#   ./install.sh                 copy configuration and install extension packages
#   ./install.sh --dry-run       print the copy operations without performing them
#   ./install.sh --with-skills   also rebuild the two skill clones (network, ~2 MB sparse)
#
# Idempotent. Does not create or overwrite auth.json (it holds credentials; see SECURITY.md),
# does not overwrite an existing models-store.json, does not touch sessions/, and does not
# install global npm packages.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DRY=0
WITH_SKILLS=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --with-skills) WITH_SKILLS=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

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

# Model registry: the example carries provider and model metadata (no keys). Never overwrite an
# existing registry, since it may hold providers this repository does not know about.
if [ -f "$ROOT/models-store.example.json" ]; then
  if [ -f "$DEST/models-store.json" ]; then
    say "-> models-store.json exists; keeping it (example available at models-store.example.json)"
  else
    say "-> models-store.json (from models-store.example.json)"
    run "cp '$ROOT/models-store.example.json' '$DEST/models-store.json'"
  fi
fi

# Extension packages. The updater creates host-link and host-deps links before npm resolves
# file: dependencies, keeping every direct host package on the active Pi release.
if [ -f "$ROOT/npm/package.json" ]; then
  say "-> npm dependencies ($ROOT/npm)"
  run "mkdir -p '$DEST/npm'"
  run "cp '$ROOT/npm/package.json' '$DEST/npm/package.json'"
  run "cp '$ROOT/npm/.npmrc' '$DEST/npm/.npmrc'"
  run "PI_AGENT_DIR='$DEST' node '$DEST/scripts/pi-config-update.mjs' --host-only"
fi

# Expose the same update path as a command. Never replace an unrelated executable.
BIN_DIR="${PI_CONFIG_UPDATE_BIN_DIR:-$HOME/.local/bin}"
UPDATE_LINK="$BIN_DIR/pi-config-update"
UPDATE_TARGET="$DEST/scripts/pi-config-update.mjs"
if [ -e "$UPDATE_LINK" ] && [ ! -L "$UPDATE_LINK" ]; then
  say "refusing to replace non-symlink $UPDATE_LINK" >&2
  exit 1
fi
say "-> command $UPDATE_LINK"
run "mkdir -p '$BIN_DIR'"
run "ln -sfn '$UPDATE_TARGET' '$UPDATE_LINK'"

# Skill clones: the whitelist in settings.json points into skills-optional/, and pi-skills is
# scanned from skills/. Both are clean clones of public repositories, so they are rebuilt instead
# of committed.
if [ "$WITH_SKILLS" = 1 ]; then
  say "-> skill clones (scripts/clone-skill-repos.sh)"
  run "PI_AGENT_DIR='$DEST' '$ROOT/scripts/clone-skill-repos.sh'"
elif [ ! -d "$DEST/skills-optional/scientific-agent-skills" ]; then
  say "-> skill clones skipped (--with-skills not given); the skill whitelist needs them"
fi

say ""
say "Next steps:"
say "  1. Create $DEST/auth.json with your own provider keys and chmod 600:"
say '     {"<provider>":{"type":"api_key","key":"..."}}'
say "  2. Rebuild the skill clones if you skipped them: scripts/clone-skill-repos.sh"
say "     (or ./install.sh --with-skills); settings.json whitelists four of those skills."
say "  3. Review $DEST/models-store.json: it came from models-store.example.json, and any provider"
say "     you do not have a key for is simply unusable."
say "  4. Verify: cd $DEST/npm && npm run selftest"
say "  5. Update Pi and extensions: pi-config-update"
