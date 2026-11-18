#!/usr/bin/env bash
# 実機確認待ちの一覧 (#1064)。`verify:<os>` ラベルの付いた open な issue を古い順に出す。
# Release PR の本文に載せる (DEVELOPMENT.md「実機確認の宣言」)
set -euo pipefail

gh issue list --state open --limit 500 \
  --search 'label:"verify:linux","verify:windows","verify:macos","verify:android","verify:ios" sort:created-asc' \
  --json number,title,labels \
  --jq '.[] | "- #\(.number) [\([.labels[].name | select(startswith("verify:")) | ltrimstr("verify:")] | join(" / "))] \(.title)"'
