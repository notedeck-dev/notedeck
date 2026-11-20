package com.notedeck.desktop

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
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
    private const val UI_PREFS = "nd_ui"
    private const val KEY_THEME_BG = "theme_bg"
    // src/styles/global.css の --nd-bg の既定値。テーマをまだ覚えていない初回だけ使う
    private val DEFAULT_THEME_BG = Color.rgb(0x23, 0x23, 0x23)
    private val RGB_PATTERN = Regex("""rgba?\((\d+),\s*(\d+),\s*(\d+)""")
    // --nd-bg を「rgb(r, g, b)」の形で読む。変数が無ければ空文字 (前景色を拾わないため)
    private const val READ_THEME_BG_JS =
      "(function(){var r=document.documentElement;" +
        "if(!getComputedStyle(r).getPropertyValue('--nd-bg').trim())return '';" +
        "var d=document.createElement('div');d.style.color='var(--nd-bg)';r.appendChild(d);" +
        "var c=getComputedStyle(d).color;d.remove();return c})()"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // 起動時の明滅を防ぐ (#1433)。ウィンドウと WebView (onWebViewCreate) を、最初の描画が
    // 出る前から前回のテーマの背景色で塗っておく。指定しないと OS の配色と WebView の
    // 既定色が先に見えて、アプリの色と合わない瞬間ができる
    window.setBackgroundDrawable(ColorDrawable(launchBackground()))
    super.onCreate(savedInstanceState)
    // OS 通知の描画を Activity から切り離す (#330 §4.1)。application Context を
    // 預け、Rust に JavaVM とクラス参照を渡す (ネイティブライブラリは super が読み込み済み)
    NotificationRenderer.init(applicationContext)
    NotificationBridge.register(applicationContext)
    // push (#330 §5): 配送アプリが複数あるときの選択画面に Activity が要る
    PushBridge.init(applicationContext)
    PushBridge.attachActivity(this)
    // 通知の権限は起動時ではなく、最初の口座を追加した直後に説明つきで求める
    // (#330 §4.5)。Rust の request_notification_permission から JNI で呼ばれる
    scheduleNotificationPolling()
  }

  override fun onDestroy() {
    PushBridge.attachActivity(null)
    super.onDestroy()
  }

  override fun onStart() {
    super.onStart()
    NotificationBridge.setForeground(true)
  }

  override fun onStop() {
    NotificationBridge.setForeground(false)
    rememberThemeBackground()
    super.onStop()
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.setBackgroundColor(launchBackground())
  }

  private fun launchBackground(): Int =
    getSharedPreferences(UI_PREFS, Context.MODE_PRIVATE).getInt(KEY_THEME_BG, DEFAULT_THEME_BG)

  /**
   * 今のテーマの背景色を次の起動のために覚える (#1433)。起動直後は WebView もフロントも
   * まだ無いので、アプリを離れるときに読んでおく。rgb 以外の書式で返ってきたら覚え直さない
   */
  private fun rememberThemeBackground() {
    val root = window?.decorView?.rootView as? ViewGroup ?: return
    findWebView(root)?.evaluateJavascript(READ_THEME_BG_JS) { value ->
      val (r, g, b) = RGB_PATTERN.find(value ?: "")?.destructured ?: return@evaluateJavascript
      getSharedPreferences(UI_PREFS, Context.MODE_PRIVATE).edit()
        .putInt(KEY_THEME_BG, Color.rgb(r.toInt(), g.toInt(), b.toInt()))
        .apply()
    }
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

  /**
   * 通知の権限を求める (Android 13+)。Rust から JNI (call_method) で呼ばれるので、
   * JVM の main thread 外から来る。権限ダイアログは UI スレッドで出す
   */
  fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    runOnUiThread {
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

  /**
   * 閉じている間の巡回を 15 分おきに予約する (#330 段階 C)。制約はネットワークだけ:
   * 電池が少ないときも通知は要る (判断 J)。既存の予約があれば制約と間隔を更新する
   */
  private fun scheduleNotificationPolling() {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
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
      ExistingPeriodicWorkPolicy.UPDATE,
      request,
    )
  }
}
