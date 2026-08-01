#!/usr/bin/env bash
# 開発環境の診断コマンド (#896)
#
#   pnpm doctor
#
# 必要なツールチェーン・システム依存・モバイル SDK の有無を検査し、
# 欠落があれば具体的な対処を指示する。
set -u

cd "$(dirname "$0")/.." || exit 1

RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' BOLD=$'\033[1m' RESET=$'\033[0m'
if [ ! -t 1 ]; then RED='' GREEN='' YELLOW='' BOLD='' RESET=''; fi

fails=0
warns=0

ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
fail() { printf '%s✗%s %s\n    %s→ %s%s\n' "$RED" "$RESET" "$1" "$BOLD" "$2" "$RESET"; fails=$((fails + 1)); }
warn() { printf '%s!%s %s\n    → %s\n' "$YELLOW" "$RESET" "$1" "$2"; warns=$((warns + 1)); }

section() { printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"; }

# ---------------------------------------------------------------- 基本ツール

section "基本ツール"

if command -v node >/dev/null 2>&1; then
  node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
  if [ "$node_major" -ge 24 ]; then
    ok "Node.js $(node --version)"
  else
    fail "Node.js $(node --version) は古い (24 以上が必要)" \
      "nix develop に入る、または Node.js 24+ をインストール"
  fi
else
  fail "Node.js が見つからない" "nix develop に入る (推奨)、または https://nodejs.org/ から 24+ をインストール"
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm --version)"
else
  fail "pnpm が見つからない" "nix develop に入る、または corepack enable && corepack prepare pnpm@latest --activate"
fi

if [ -d node_modules ]; then
  ok "node_modules (依存インストール済み)"
else
  fail "node_modules が無い" "pnpm install を実行"
fi

# ---------------------------------------------------------------- Rust

section "Rust ツールチェーン"

expected_channel=$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)

if command -v rustup >/dev/null 2>&1; then
  ok "rustup $(rustup --version 2>/dev/null | head -1 | cut -d' ' -f2)"
  if rustup which rustc >/dev/null 2>&1; then
    ok "rustc $(rustc --version | cut -d' ' -f2) (rust-toolchain.toml: ${expected_channel})"
  else
    fail "ツールチェーン ${expected_channel} が未インストール" \
      "リポジトリ直下で rustup toolchain install ${expected_channel} を実行 (rust-toolchain.toml から自動解決される)"
  fi
  for c in rust-analyzer rust-src; do
    if rustup component list 2>/dev/null | grep -q "^${c}.*(installed)"; then
      ok "component: ${c}"
    else
      fail "component ${c} が無い (補完・定義ジャンプが動かない)" \
        "rustup component add ${c} を実行 (通常は rust-toolchain.toml から自動で入る)"
    fi
  done
elif command -v cargo >/dev/null 2>&1; then
  warn "rustup ではなく cargo を直接使用中 ($(rustc --version 2>/dev/null || echo '?'))" \
    "rust-toolchain.toml (${expected_channel}) との一致は自分で管理すること"
else
  fail "Rust が見つからない" "nix develop に入る、または https://rustup.rs/ からインストール"
fi

# ---------------------------------------------------------------- Linux システム依存

if [ "$(uname -s)" = "Linux" ]; then
  section "Linux システム依存 (Tauri デスクトップビルド)"

  if command -v pkg-config >/dev/null 2>&1; then
    ok "pkg-config"
    for spec in webkit2gtk-4.1 gtk+-3.0 openssl libsoup-3.0; do
      if pkg-config --exists "$spec" 2>/dev/null; then
        ok "$spec"
      else
        fail "$spec が見つからない" \
          "nix develop に入る (推奨)、または apt: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libsoup-3.0-dev"
      fi
    done
  else
    fail "pkg-config が見つからない" "nix develop に入る、または sudo apt install pkg-config"
  fi

  if grep -qi microsoft /proc/version 2>/dev/null; then
    if [ "${WEBKIT_DISABLE_DMABUF_RENDERER:-}" = "1" ]; then
      ok "WSL2: WebKitGTK EGL 対策 (WEBKIT_DISABLE_DMABUF_RENDERER=1)"
    else
      warn "WSL2 なのに WEBKIT_DISABLE_DMABUF_RENDERER が未設定 (ウィンドウが真っ白/起動不能になる)" \
        "nix develop に入る (flake が自動設定する)"
    fi
  fi
fi

# ---------------------------------------------------------------- 言語サーバー

section "言語サーバー (エディタ非依存の補完・定義ジャンプ)"

for ls_cmd in taplo nil vue-language-server; do
  if command -v "$ls_cmd" >/dev/null 2>&1; then
    ok "$ls_cmd"
  else
    warn "$ls_cmd が見つからない" "nix develop に入ると揃う (flake.nix 同梱)"
  fi
done

# ---------------------------------------------------------------- git hooks

section "git hooks"

if [ -f .git/hooks/pre-commit ] && grep -q lefthook .git/hooks/pre-commit 2>/dev/null; then
  ok "lefthook (pre-commit / commit-msg)"
else
  fail "lefthook の git hooks が未インストール" "pnpm install を実行 (postinstall で入る)。入らない場合は npx lefthook install"
fi

# ---------------------------------------------------------------- モバイル (任意)

section "モバイル SDK (Android を触らないなら不要)"

if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME}" ]; then
  ok "ANDROID_HOME: ${ANDROID_HOME}"
  if [ -n "${NDK_HOME:-}" ] && [ -d "${NDK_HOME}" ]; then
    ok "NDK_HOME: ${NDK_HOME}"
  else
    warn "NDK_HOME が無効 (${NDK_HOME:-未設定})" "nix develop .#android に入ると設定される"
  fi
  if command -v java >/dev/null 2>&1; then
    ok "Java $(java -version 2>&1 | head -1 | sed 's/.*"\(.*\)".*/\1/')"
  else
    warn "java が見つからない" "nix develop .#android に入ると JDK 17 が入る"
  fi
else
  warn "ANDROID_HOME が未設定 (Android ビルドはできない)" "nix develop .#android に入ると SDK/NDK ごと揃う"
fi

# ---------------------------------------------------------------- サマリ

printf '\n'
if [ "$fails" -gt 0 ]; then
  printf '%s✗ 問題 %d 件%s (警告 %d 件) — 上の → の指示に従って解消してください\n' "$RED" "$fails" "$RESET" "$warns"
  exit 1
elif [ "$warns" -gt 0 ]; then
  printf '%s! 必須項目は OK%s (警告 %d 件 — 該当機能を触るときだけ対応すれば良い)\n' "$YELLOW" "$RESET" "$warns"
else
  printf '%s✓ 開発環境は完璧です%s\n' "$GREEN" "$RESET"
fi
