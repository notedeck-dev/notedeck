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

# pidof はプロセスが無いと非 0 で終わるので set -e に巻き込ませない
pid_of_app() {
  adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r\n' || true
}

# 起動を頼んでから、プロセスが「現れた」ことを先に確かめる。エミュレータが
# 起動直後で monkey の intent を取りこぼすことがあり (v1.74.3 の Android job)、
# 「現れなかった」を「落ちた」と誤判定しないため。現れなければ 1 回だけ起こし直す
launch() {
  adb logcat -c
  adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1
}
launch
STARTED=""
for _ in $(seq 1 15); do
  sleep 1
  if [ -n "$(pid_of_app)" ]; then STARTED=1; break; fi
done
if [ -z "$STARTED" ]; then
  echo "アプリのプロセスが 15 秒待っても現れない。起こし直す"
  adb shell ps -A | grep -i notedeck || true
  launch
  for _ in $(seq 1 15); do
    sleep 1
    if [ -n "$(pid_of_app)" ]; then STARTED=1; break; fi
  done
fi
if [ -z "$STARTED" ]; then
  echo "::error::アプリのプロセスが起動しなかった (エミュレータ側の問題の可能性。logcat を確認)"
  adb logcat -d -t 400 | tail -120 || true
  exit 1
fi

sleep "$SURVIVE_SECONDS"

PID=$(pid_of_app)
if [ -z "$PID" ]; then
  echo "::error::アプリが起動後 ${SURVIVE_SECONDS} 秒以内に終了した (起動クラッシュ)"
  # `-t N` は末尾 N 行だけで、Google API 入りのエミュレータでは 20 秒分のノイズに
  # 押し出されて crash の本文が残らない。起動 (logcat -c) 以降を全部取り、アプリと
  # crash の印 (tombstone の "F DEBUG" / Java の AndroidRuntime / Rust の panic) で絞る
  adb logcat -d > /tmp/logcat-all.txt || true
  echo "--- app / crash lines ---"
  grep -iE 'notedeck|com\.notedeck|F DEBUG|AndroidRuntime|panicked|RustStdoutStderr|Fatal signal' /tmp/logcat-all.txt | tail -150 || true
  echo "--- raw tail ---"
  tail -60 /tmp/logcat-all.txt || true
  exit 1
fi

echo "アプリは ${SURVIVE_SECONDS} 秒間生存した (pid $PID)"
