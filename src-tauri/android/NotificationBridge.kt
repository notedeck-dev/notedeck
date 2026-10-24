package com.notedeck.desktop

import android.content.Context

/**
 * Kotlin → Rust の入口 (#330 §4.1)。Rust 側は src-tauri/src/android_notify.rs と
 * android_worker.rs。
 *
 * 起動時に 1 回 [register] を呼び、Rust に JavaVM と [NotificationRenderer] の
 * クラス参照を預ける。以後 Rust は Activity に紐づくネイティブ文脈 (ndk_context)
 * に触らずに通知を描ける (Activity が破棄された後でも落ちない)。
 *
 * ネイティブライブラリは TauriActivity が読み込む。Activity を通らずに起きる
 * ワーカー ([NotificationWorker]) は自分で読み込んでから [runWorker] を呼ぶ。
 */
object NotificationBridge {
  /** JavaVM とクラス参照を Rust に預ける。冪等 */
  @JvmStatic
  external fun register(context: Context)

  /**
   * Activity が前面にあるか (onStart / onStop)。前面で通知カラムが見えているときの
   * OS 通知の抑止に使う (#330 §3.3)。WebView の可視性は凍結中に古いまま残りうる
   * ので、OS が確定的に呼ぶこちらを正とする
   */
  @JvmStatic
  external fun setForeground(foreground: Boolean)

  /**
   * 閉じている間の巡回 1 回 (#330 段階 C)。口座の読取 / トークン / 問い合わせ /
   * 文言 / 描画は全部 Rust 側。[context] は keychain を開くための application Context、
   * [dataDir] は Tauri の app_data_dir() と同じ場所 (Context.getDataDir())。
   * 戻り値は 0 = 成功、1 = 再試行 (全口座がネットワークの失敗)
   */
  @JvmStatic
  external fun runWorker(context: Context, dataDir: String): Int
}
