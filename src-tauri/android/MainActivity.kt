package com.notedeck.desktop

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  companion object {
    private const val TAG = "MainActivity"
    private const val NOTIFICATION_PERMISSION_CODE = 42

    /** NotificationWorker / Rust 側 (streaming.rs) と同一チャンネル */
    private const val CHANNEL_ID = "notedeck_notifications"

    /**
     * リアクション絵文字を載せる透明カンバス。Android の big picture は
     * 通知の横幅に合わせて拡縮されるため、表示される高さは画像のアスペクト比
     * だけで決まる。カンバスを固定比にすることで絵文字ごとの高さを揃える
     * (Windows toast と同じ理由 — os_notify.rs の normalize_emoji_height 参照)。
     */
    private const val EMOJI_CANVAS_W = 728
    private const val EMOJI_CANVAS_H = 128
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

  /**
   * アバター / リアクション絵文字を添付した通知を出す (#754 の Android 版)。
   * Rust の show_os_notification から JNI で呼ばれる。
   *
   * tauri-plugin-notification の Android 実装は largeIcon に drawable リソース名
   * しか渡せず (attachments は Android 側で無視される)、サーバーから取ってくる
   * 動的画像を添付できないため自前で組む。配置はデスクトップ (user-notify) と
   * 揃える:
   *   avatarUrl -> large icon   (アクターのアバター。Windows の appLogoOverride)
   *   imageUrl  -> big picture  (リアクションのカスタム絵文字。Windows のインライン画像)
   *
   * クリック遷移は plugin の extra + JS onAction ではなく notedeck:// deep link
   * で行う (NotificationWorker と同じ経路。アプリ終了中のタップでも遷移できる)。
   */
  fun showRichNotification(
    id: Int,
    title: String,
    body: String?,
    deepLink: String?,
    avatarUrl: String?,
    imageUrl: String?,
  ) {
    // 画像フェッチがあるので UI スレッドを塞がない
    Thread {
      try {
        val builder = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title)
          .setPriority(NotificationCompat.PRIORITY_DEFAULT)
          .setAutoCancel(true)
          .setContentIntent(buildContentIntent(id, deepLink))
        if (body != null) builder.setContentText(body)

        avatarUrl?.let { fetchBitmap(it) }?.let { builder.setLargeIcon(circleCrop(it)) }
        imageUrl?.let { fetchBitmap(it) }?.let {
          builder.setStyle(
            NotificationCompat.BigPictureStyle().bigPicture(normalizeEmojiHeight(it))
          )
        }

        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE)
          as NotificationManager
        manager.notify(id, builder.build())
      } catch (e: Exception) {
        Log.w(TAG, "Failed to show notification", e)
      }
    }.start()
  }

  private fun buildContentIntent(id: Int, deepLink: String?): PendingIntent {
    val intent = Intent(applicationContext, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      if (deepLink != null) {
        action = Intent.ACTION_VIEW
        data = android.net.Uri.parse(deepLink)
      }
    }
    return PendingIntent.getActivity(
      applicationContext,
      id,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun fetchBitmap(url: String): Bitmap? {
    return try {
      val conn = URL(url).openConnection() as HttpURLConnection
      try {
        conn.connectTimeout = 5_000
        conn.readTimeout = 5_000
        if (conn.responseCode != 200) return null
        conn.inputStream.use { BitmapFactory.decodeStream(it) }
      } finally {
        conn.disconnect()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to fetch image: $url", e)
      null
    }
  }

  /** large icon は角丸のまま出るランチャーがあるので自前で円形に抜く */
  private fun circleCrop(src: Bitmap): Bitmap {
    val size = min(src.width, src.height)
    val square = Bitmap.createBitmap(
      src,
      (src.width - size) / 2,
      (src.height - size) / 2,
      size,
      size,
    )
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val paint = Paint().apply {
      isAntiAlias = true
      shader = BitmapShader(square, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    val radius = size / 2f
    Canvas(out).drawCircle(radius, radius, radius, paint)
    return out
  }

  /**
   * 絵文字を高さ基準でスケールし、固定サイズの透明カンバスに中央配置する。
   * 横幅はカンバス内で絵文字ごとに変わったままにする (揃えると横長絵文字が
   * 潰れて小さく見えるため)。
   */
  private fun normalizeEmojiHeight(src: Bitmap): Bitmap {
    // カンバス比 (5.7:1) より横長の絵文字だけは幅で頭打ちになり高さが縮む
    val scale = min(
      EMOJI_CANVAS_W.toFloat() / src.width,
      EMOJI_CANVAS_H.toFloat() / src.height,
    )
    val w = (src.width * scale).roundToInt().coerceAtLeast(1)
    val h = (src.height * scale).roundToInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(src, w, h, true)
    val out = Bitmap.createBitmap(EMOJI_CANVAS_W, EMOJI_CANVAS_H, Bitmap.Config.ARGB_8888)
    Canvas(out).drawBitmap(scaled, (EMOJI_CANVAS_W - w) / 2f, (EMOJI_CANVAS_H - h) / 2f, null)
    return out
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
