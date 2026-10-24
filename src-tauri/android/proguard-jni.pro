# Rust から JNI で呼ぶ Kotlin のメソッド。Kotlin からは誰も呼ばないので、keep しないと
# release の R8 が消したり名前を変えたりする。v1.92.0〜v1.95.1 の release 版はこれが無く、
# OS 通知の描画・push の登録・ステータスバーの明暗・通知の許可の要求が動いていなかった
# (debug ビルドは縮小しないので手元では気づかない)。
#
# Rust 側の呼び出し (android_notify の call_static / with_push_class、commands/utility の
# call_method) を足したらここも足す。tests/lint/androidJniKeep.test.ts が突き合わせる。
# sync.sh が gen/android/app/ に置き、build.gradle.kts が app 直下の *.pro を全部読む。

# 静的メソッド (Kotlin の object の @JvmStatic)
-keep class com.notedeck.desktop.NotificationRenderer { public static *; }
-keep class com.notedeck.desktop.PushBridge { public static *; }

# Activity のインスタンスメソッド
-keepclassmembers class com.notedeck.desktop.MainActivity {
    public void setStatusBarStyle(boolean);
    public void requestNotificationPermission();
}
