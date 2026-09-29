#!/usr/bin/env bash
# notemaid (AI の別プロセス) を sidecar としてビルドし、Tauri の externalBin が拾う場所に置く (#1106 案 B)。
#
#   bash scripts/build-sidecar.sh                      # ホストの target
#   bash scripts/build-sidecar.sh x86_64-pc-windows-msvc
#   bash scripts/build-sidecar.sh universal-apple-darwin   # aarch64 + x86_64 を lipo
#
# 置き場: src-tauri/binaries/notemaid-<target triple>[.exe] (git 管理外)。
# 無ければアプリは AI を in-process で回すので、開発時は省略できる。
set -euo pipefail
cd "$(dirname "$0")/.."

host="$(rustc -vV | sed -n 's/^host: //p')"
target="${1:-$host}"
out_dir="src-tauri/binaries"
mkdir -p "$out_dir"

build_one() {
  local t="$1"
  cargo build --release -p notemaid --features daemon --target "$t"
  echo "target/$t/release/notemaid"
}

case "$target" in
  universal-apple-darwin)
    a="$(build_one aarch64-apple-darwin)"
    x="$(build_one x86_64-apple-darwin)"
    # Tauri の universal ビルドはアーキごとに build.rs を回し、その都度
    # notemaid-<アーキの triple> を要求する。束ねるときは universal を使うので 3 つとも置く
    cp "$a" "$out_dir/notemaid-aarch64-apple-darwin"
    cp "$x" "$out_dir/notemaid-x86_64-apple-darwin"
    lipo -create -output "$out_dir/notemaid-universal-apple-darwin" "$a" "$x"
    ;;
  *-windows-*)
    bin="$(build_one "$target")"
    cp "$bin.exe" "$out_dir/notemaid-$target.exe"
    ;;
  *)
    bin="$(build_one "$target")"
    cp "$bin" "$out_dir/notemaid-$target"
    ;;
esac
ls -la "$out_dir"
