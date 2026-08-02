#!/usr/bin/env bash
# リリース時のバージョン同期をワンコマンドにする (CLAUDE.md「リリース手順」の 1)。
#
# package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json の 3 ファイルを
# 手で揃える運用だったが、加えて Cargo.lock と openapi.json も再生成が必要で、
# openapi.json を忘れると CI の openapi_snapshot_is_current だけが後から落ちる。
#
#   bash scripts/bump-version.sh 1.37.0
set -eu

cd "$(dirname "$0")/.." || exit 1

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "使い方: bash scripts/bump-version.sh <X.Y.Z>" >&2
  exit 1
fi
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "バージョンは X.Y.Z 形式で指定してください (先頭の v は不要): $VERSION" >&2
  exit 1
fi

# 生成物の差分と手元の編集が混ざると、何が bump によるものか分からなくなる
if [ -n "$(git status --porcelain)" ]; then
  echo "作業ツリーに未コミットの変更があります。先にコミットするか stash してください。" >&2
  exit 1
fi

CURRENT=$(node -p "require('./package.json').version")
if [ "$CURRENT" = "$VERSION" ]; then
  echo "すでに $VERSION です。" >&2
  exit 1
fi
echo "==> $CURRENT -> $VERSION"

# それぞれ最初の 1 件だけ置換する。依存クレートの version 行を巻き込まないよう、
# Cargo.toml は行頭 version = にアンカーする。
# (sed ではなく perl なのは -i の書式が GNU と BSD で違うため)
perl -0pi -e "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
perl -0pi -e "s/^version = \"[^\"]*\"/version = \"$VERSION\"/m" src-tauri/Cargo.toml
perl -0pi -e "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

# perl は一致が無くても成功で終わるので、置換されたことを確かめる
check() {
  if ! grep -q "$2" "$1"; then
    echo "$1 のバージョンを書き換えられませんでした。ファイルの形式が変わっていないか確認してください。" >&2
    exit 1
  fi
  echo "    $1"
}
echo "==> バージョンを更新"
check package.json "\"version\": \"$VERSION\""
check src-tauri/Cargo.toml "^version = \"$VERSION\""
check src-tauri/tauri.conf.json "\"version\": \"$VERSION\""

echo "==> Cargo.lock を同期"
cargo check --manifest-path src-tauri/Cargo.toml --quiet

echo "==> openapi.json を再生成 (バージョン番号を埋め込んでいる)"
cargo run --manifest-path src-tauri/Cargo.toml --example gen_openapi --quiet

echo
git --no-pager diff --stat
echo
echo "次の手順:"
echo "  git add -A && git commit -m \"chore: bump version to $VERSION\""
echo "  develop -> main の PR を作成 (タイトル: Release v$VERSION)"
