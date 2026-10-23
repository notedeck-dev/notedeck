package com.notedeck.desktop

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class MainActivity : TauriActivity() {
  companion object {
    private const val NOTIFICATION_PERMISSION_CODE = 42
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // OS 通知の描画を Activity から切り離す (#330 §4.1)。application Context を
    // 預け、Rust に JavaVM とクラス参照を渡す (ネイティブライブラリは super が読み込み済み)
    NotificationRenderer.init(applicationContext)
    NotificationBridge.register(applicationContext)
    // 通知の権限は起動時ではなく、最初の口座を追加した直後に説明つきで求める
    // (#330 §4.5)。Rust の request_notification_permission から JNI で呼ばれる
    scheduleNotificationPolling()
  }

  override fun onStart() {
    super.onStart()
    NotificationBridge.setForeground(true)
  }

  override fun onStop() {
    NotificationBridge.setForeground(false)
    super.onStop()
  }

  /**
   * フォアグラウンド復帰を WebView の JS に確実に伝える (#506)。
   *
   * Android WebView は復帰時に visibilitychange を発火しないことがあり、
   * その場合フロントの deckResume (WS 再接続 + visibility リフレッシュ +
   * 新着 refetch) が一切走らない。Tauri 側イベントも使えない: pin 済み
   * tauri-runtime-wry 2.10 系は tao の Event::Resumed を握り潰すため
   * RunEvent::Resumed は Android では発火しない。そこで Activity の
   * onResume から DOM イベントを直接 dispatch する。
   */
  override fun onResume() {
    super.onResume()
    val root = window?.decorView?.rootView as? ViewGroup ?: return
    findWebView(root)?.evaluateJavascript(
      "window.dispatchEvent(new Event('nd-app-resumed'))",
      null,
    )
  }

  /**
   * ステータスバー/ナビバーのアイコン明暗をアプリテーマに追従させる (#755)。
   * Rust の set_status_bar_style コマンドから JNI (call_method) で呼ばれる。
   * edge-to-edge のためバー背景は WebView が透ける — 切り替えるのはアイコンのみ。
   * lightBackground = true (ライトテーマ) → 濃色アイコン。
   */
  fun setStatusBarStyle(lightBackground: Boolean) {
    runOnUiThread {
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = lightBackground
      controller.isAppearanceLightNavigationBars = lightBackground
    }
  }

  private fun findWebView(group: ViewGroup): WebView? {
    for (i in 0 until group.childCount) {
      when (val child = group.getChildAt(i)) {
        is WebView -> return child
        is ViewGroup -> findWebView(child)?.let { return it }
      }
    }
    return null
  }

  /** 通知の権限を求める (Android 13+)。Rust から JNI (call_method) で呼ばれる */
  fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(
          this,
          Manifest.permission.POST_NOTIFICATIONS
        ) != PackageManager.PERMISSION_GRANTED
      ) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          NOTIFICATION_PERMISSION_CODE
        )
      }
    }
  }

  private fun scheduleNotificationPolling() {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .setRequiresBatteryNotLow(true)
      .build()

    val request = PeriodicWorkRequestBuilder<NotificationWorker>(
      15, TimeUnit.MINUTES,
    )
      .setConstraints(constraints)
      .setBackoffCriteria(
        BackoffPolicy.EXPONENTIAL,
        15,
        TimeUnit.MINUTES
      )
      .build()

    WorkManager.getInstance(this).enqueueUniquePeriodicWork(
      "notedeck_notification_poll",
      ExistingPeriodicWorkPolicy.KEEP,
      request,
    )
  }
}
