package com.notedeck.desktop

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
    requestNotificationPermission()
    scheduleNotificationPolling()
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

  private fun findWebView(group: ViewGroup): WebView? {
    for (i in 0 until group.childCount) {
      when (val child = group.getChildAt(i)) {
        is WebView -> return child
        is ViewGroup -> findWebView(child)?.let { return it }
      }
    }
    return null
  }

  private fun requestNotificationPermission() {
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
