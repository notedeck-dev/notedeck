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
cp "$SCRIPT_DIR/NotificationRenderer.kt" "$JAVA_DIR/NotificationRenderer.kt"
cp "$SCRIPT_DIR/NotificationBridge.kt" "$JAVA_DIR/NotificationBridge.kt"
cp "$SCRIPT_DIR/PushBridge.kt" "$JAVA_DIR/PushBridge.kt"
cp "$SCRIPT_DIR/NotedeckPushService.kt" "$JAVA_DIR/NotedeckPushService.kt"
cp "$SCRIPT_DIR/AndroidManifest.xml" "$GEN_DIR/AndroidManifest.xml"

# networkSecurityConfig (#921): release はループバック (127.0.0.1) のみ
# cleartext 許可、debug は dev サーバー (LAN IP) 用に全面許可で上書き
mkdir -p "$GEN_DIR/res/xml" "$GEN_DIR/../debug/res/xml"
cp "$SCRIPT_DIR/network_security_config.xml" "$GEN_DIR/res/xml/network_security_config.xml"
cp "$SCRIPT_DIR/network_security_config_debug.xml" "$GEN_DIR/../debug/res/xml/network_security_config.xml"

# 端末外バックアップの除外 (#330 §4.3)。Android 11 以下 / 12 以上の 2 方式
cp "$SCRIPT_DIR/backup_rules.xml" "$GEN_DIR/res/xml/backup_rules.xml"
cp "$SCRIPT_DIR/data_extraction_rules.xml" "$GEN_DIR/res/xml/data_extraction_rules.xml"

# adaptive icon。`tauri icon` の foreground はロゴを 108dp キャンバス全面に
# 置くため丸マスクで大きく見切れ、背景も白になる。セーフゾーンに収めた
# foreground (scripts/gen-android-foreground.mjs) と背景色で上書きする。
# legacy の ic_launcher.png は `tauri icon` の出力のまま使う
ICONS_DIR="$SCRIPT_DIR/../icons/android"
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
    mkdir -p "$GEN_DIR/res/mipmap-$density"
    cp "$ICONS_DIR/mipmap-$density/ic_launcher_foreground.png" "$GEN_DIR/res/mipmap-$density/ic_launcher_foreground.png"
done
mkdir -p "$GEN_DIR/res/mipmap-anydpi-v26" "$GEN_DIR/res/values"
cp "$ICONS_DIR/mipmap-anydpi-v26/ic_launcher.xml" "$GEN_DIR/res/mipmap-anydpi-v26/ic_launcher.xml"
cp "$ICONS_DIR/values/ic_launcher_background.xml" "$GEN_DIR/res/values/ic_launcher_background.xml"

# 通知の small icon (ロゴの型抜き、#1195)。生成プロジェクトにだけ置くと CI (tauri android
# init から始める) で消えるので、リポジトリ側から写す
mkdir -p "$GEN_DIR/res/drawable"
cp "$SCRIPT_DIR/res/drawable/"*.xml "$GEN_DIR/res/drawable/"

# Rust から JNI で呼ぶメソッドを release の R8 から守る。build.gradle.kts は
# app 直下の *.pro を全部読むので置くだけで効く
cp "$SCRIPT_DIR/proguard-jni.pro" "$SCRIPT_DIR/../gen/android/app/proguard-jni.pro"

# Add WorkManager dependency to build.gradle.kts if not already present
BUILD_GRADLE="$SCRIPT_DIR/../gen/android/app/build.gradle.kts"
WORK_DEP='implementation("androidx.work:work-runtime-ktx:2.10.1")'
if [ -f "$BUILD_GRADLE" ] && ! grep -q "work-runtime-ktx" "$BUILD_GRADLE"; then
    sed -i "/androidx.appcompat:appcompat/a\\    $WORK_DEP" "$BUILD_GRADLE"
    echo "WorkManager dependency added."
fi

# push の受け口 (#330 §5)。配送アプリ (distributor) は同梱しない。
# 3.0 系に固定する: Tauri が生成するプロジェクトの Kotlin プラグインは 1.9.25 で、
# 読めるメタデータは 2.0 まで。connector 3.1 以降は kotlin-stdlib 2.2 以上を引き込み、
# アプリの Kotlin が全部コンパイルできなくなる (手元の APK ビルドで確認)
PUSH_DEP='implementation("org.unifiedpush.android:connector:3.0.10")'
if [ -f "$BUILD_GRADLE" ] && ! grep -q "unifiedpush.android:connector" "$BUILD_GRADLE"; then
    sed -i "/androidx.appcompat:appcompat/a\\    $PUSH_DEP" "$BUILD_GRADLE"
    echo "UnifiedPush connector dependency added."
fi

echo "Android custom files synced."
