#!/bin/bash
# 新机器装机脚本：重建 ~/.pi/agent 下两个不入 chezmoi 的技能克隆。
# 背景（2025-09-18 评估）：两者均为公开仓库的 clean 克隆，由本脚本重建，
# .chezmoiignore 已排除，chezmoi apply 不会触碰这里。
# 幂等：已存在的克隆会跳过；scientific-agent-skills 用 sparse 只拉 skills/（~2MB 而非 857MB）。
set -euo pipefail

AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

# 1) pi-skills：小仓库，全量浅克隆（含 .git，方便日后 pull 更新）
if [ -d "$AGENT_DIR/skills/pi-skills/.git" ]; then
  echo "skip: pi-skills 已存在"
else
  rm -rf "$AGENT_DIR/skills/pi-skills"
  git clone --depth 1 https://github.com/badlogic/pi-skills.git "$AGENT_DIR/skills/pi-skills"
  echo "done: pi-skills"
fi

# 2) scientific-agent-skills：sparse 克隆，只取 skills/ 目录
#    settings.json 引用其中 4 个技能；技能经 PEP723 uv run / 纯 stdlib 运行，无需 .venv
SAS="$AGENT_DIR/skills-optional/scientific-agent-skills"
if [ -d "$SAS/.git" ]; then
  echo "skip: scientific-agent-skills 已存在"
else
  rm -rf "$SAS"
  git clone --depth 1 --filter=blob:none --sparse https://github.com/K-Dense-AI/scientific-agent-skills.git "$SAS"
  git -C "$SAS" sparse-checkout set skills/
  echo "done: scientific-agent-skills (sparse: skills/)"
fi

echo "全部完成。验证：ls $SAS/skills/"
