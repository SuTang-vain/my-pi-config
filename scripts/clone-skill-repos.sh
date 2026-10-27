#!/bin/bash
# Bootstrap script: recreate the two skill clones under ~/.pi/agent that this repo does not carry.
# Both are clean clones of public repositories (assessed 2025-09-18) and are rebuilt by this
# script rather than committed (large, and reproducible).
# Idempotent: existing clones are skipped; scientific-agent-skills uses a sparse checkout of skills/
# (~2 MB instead of 857 MB).
set -euo pipefail

AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

# 1) pi-skills: small repository, shallow full clone (keeps .git so it can be pulled later)
if [ -d "$AGENT_DIR/skills/pi-skills/.git" ]; then
  echo "skip: pi-skills already present"
else
  rm -rf "$AGENT_DIR/skills/pi-skills"
  git clone --depth 1 https://github.com/badlogic/pi-skills.git "$AGENT_DIR/skills/pi-skills"
  echo "done: pi-skills"
fi

# The repository ships its own copy of the vscode skill under skills/; the pi-skills clone carries
# one too, and two skills with the same name make pi report a conflict.
if [ -f "$AGENT_DIR/skills/vscode/SKILL.md" ] && [ -d "$AGENT_DIR/skills/pi-skills/vscode" ]; then
  rm -rf "$AGENT_DIR/skills/pi-skills/vscode"
  echo "removed duplicate: skills/pi-skills/vscode (skills/vscode wins)"
fi

# 2) scientific-agent-skills: sparse clone of the skills/ directory only
#    settings.json whitelists four of its skills; they run through PEP 723 `uv run` or the standard
#    library, so no .venv is required.
SAS="$AGENT_DIR/skills-optional/scientific-agent-skills"
if [ -d "$SAS/.git" ]; then
  echo "skip: scientific-agent-skills already present"
else
  rm -rf "$SAS"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/K-Dense-AI/scientific-agent-skills.git "$SAS"
  git -C "$SAS" sparse-checkout set skills/
  echo "done: scientific-agent-skills (sparse: skills/)"
fi

echo "done. verify with: ls $SAS/skills/"
