#!/usr/bin/env bash
# Android の起動スモークテスト (#858)。
#
# 起動直後の native crash はアプリ内の診断ログにも残らず、About ウィンドウ
# すら開けないため、実際にエミュレータで起動させる以外に検出手段がない。
# v1.33.0 はそれを検出できずに公開まで到達した。
#
# このファイルを独立させているのは、android-emulator-runner が `script:` を
# **1 行ずつ別々の `sh -c` で実行する**ため。複数行の if/then/fi は成立せず、
# 変数も行をまたいで保持されない。ワークフロー側からは 1 行で呼ぶこと。
set -euo pipefail

PACKAGE=com.notedeck.desktop
APK_DIR=${1:-apk}
# 起動直後の native crash は数秒以内に出る
SURVIVE_SECONDS=${2:-20}

# 署名済みだけを対象にする。Android は未署名 APK の install を
# INSTALL_PARSE_FAILED_NO_CERTIFICATES で拒否するため、`-release-*.apk` の
# ような緩い glob で unsigned / aligned を掴むとテストが成立しない
APK=$(find "$APK_DIR" -name '*x86_64*-release-signed.apk' | head -1)
if [ -z "$APK" ]; then
  echo "ERROR: 署名済みの x86_64 APK が見つからない ($APK_DIR)" >&2
  echo "配布物は署名が必須。keystore の設定を確認すること" >&2
  find "$APK_DIR" -name '*.apk' >&2 || true
  exit 1
fi

echo "installing $APK"
adb install -r "$APK"

adb logcat -c
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1

sleep "$SURVIVE_SECONDS"

# pidof はプロセスが無いと非 0 で終わるので set -e に巻き込ませない
PID=$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r\n' || true)
if [ -z "$PID" ]; then
  echo "::error::アプリが起動後 ${SURVIVE_SECONDS} 秒以内に終了した (起動クラッシュ)"
  adb logcat -d -t 300 | grep -iE 'notedeck|FATAL|AndroidRuntime|libc|DEBUG' | tail -80 || true
  exit 1
fi

echo "アプリは ${SURVIVE_SECONDS} 秒間生存した (pid $PID)"
