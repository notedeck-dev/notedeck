package com.notedeck.desktop

import android.content.Context

/**
 * Kotlin → Rust の入口 (#330 §4.1)。Rust 側は src-tauri/src/android_notify.rs。
 *
 * 起動時に 1 回 [register] を呼び、Rust に JavaVM と [NotificationRenderer] の
 * クラス参照を預ける。以後 Rust は Activity に紐づくネイティブ文脈 (ndk_context)
 * に触らずに通知を描ける (Activity が破棄された後でも落ちない)。
 *
 * ネイティブライブラリは TauriActivity が読み込む。この object は Activity の
 * onCreate (= 読み込み後) からしか使わない。
 */
object NotificationBridge {
  /** JavaVM とクラス参照を Rust に預ける。冪等 */
  @JvmStatic
  external fun register(context: Context)
}
