#!/bin/bash
# src-tauri/android/ のカスタムファイルを gen/android/ にコピーする
# Androidビルド前に実行: ./src-tauri/android/sync.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GEN_DIR="$SCRIPT_DIR/../gen/android/app/src/main"
JAVA_DIR="$GEN_DIR/java/com/notedeck/desktop"

mkdir -p "$JAVA_DIR"

cp "$SCRIPT_DIR/MainActivity.kt" "$JAVA_DIR/MainActivity.kt"
cp "$SCRIPT_DIR/NotificationWorker.kt" "$JAVA_DIR/NotificationWorker.kt"
cp "$SCRIPT_DIR/AndroidManifest.xml" "$GEN_DIR/AndroidManifest.xml"

# networkSecurityConfig (#921): release はループバック (127.0.0.1) のみ
# cleartext 許可、debug は dev サーバー (LAN IP) 用に全面許可で上書き
mkdir -p "$GEN_DIR/res/xml" "$GEN_DIR/../debug/res/xml"
cp "$SCRIPT_DIR/network_security_config.xml" "$GEN_DIR/res/xml/network_security_config.xml"
cp "$SCRIPT_DIR/network_security_config_debug.xml" "$GEN_DIR/../debug/res/xml/network_security_config.xml"

# Add WorkManager dependency to build.gradle.kts if not already present
BUILD_GRADLE="$SCRIPT_DIR/../gen/android/app/build.gradle.kts"
WORK_DEP='implementation("androidx.work:work-runtime-ktx:2.10.1")'
if [ -f "$BUILD_GRADLE" ] && ! grep -q "work-runtime-ktx" "$BUILD_GRADLE"; then
    sed -i "/androidx.appcompat:appcompat/a\\    $WORK_DEP" "$BUILD_GRADLE"
    echo "WorkManager dependency added."
fi

echo "Android custom files synced."
