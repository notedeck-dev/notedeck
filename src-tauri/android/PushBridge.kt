package com.notedeck.desktop

import android.app.Activity
import android.content.Context
import android.util.Log
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import java.lang.ref.WeakReference

/**
 * push (UnifiedPush) の Kotlin 側 (#330 §5)。Rust 側は src-tauri/src/android_push.rs。
 *
 * 役割の分担 (§5.2): 配送アプリ (distributor) への登録 / 解除と、エンドポイントと鍵の
 * 保持は Kotlin。Misskey への購読登録・振り分け・文言・描画の組み立ては Rust。
 * Kotlin は Misskey の認証情報を知らず、Rust に渡すのは「復号できた push の中身」だけ。
 *
 * instance はホスト (VAPID 公開鍵がホストごとなので、配送アプリへの登録はホスト単位)。
 */
object PushBridge {
  private const val TAG = "PushBridge"

  /** エンドポイントと鍵の置き場 (アプリ専用領域、端末外バックアップから除外) */
  private const val PREFS = "notedeck_push"

  /** Cargo の [lib] name (NotificationWorker と同じ) */
  private const val NATIVE_LIBRARY = "notedeck_lib"

  @Volatile
  private var appContext: Context? = null

  /** 配送アプリが複数あって既定が無いとき、OS の選択画面を出すのに要る */
  @Volatile
  private var activity: WeakReference<Activity>? = null

  @JvmStatic
  fun init(context: Context) {
    appContext = context.applicationContext
  }

  @JvmStatic
  fun attachActivity(a: Activity?) {
    activity = a?.let { WeakReference(it) }
  }

  /**
   * Rust の入口: 復号できた push の中身 (本家の JSON)。前面か・可視カラムか・
   * どの口座かの判定と描画は Rust 側
   */
  @JvmStatic
  external fun onMessage(context: Context, dataDir: String, instance: String, payload: String)

  /**
   * PushService から呼ぶ。描画には画像の取得があるので別スレッドで Rust に入る。
   * 本文は先に出るので、配送時の前面猶予の内に通知が出る
   */
  @JvmStatic
  fun deliver(context: Context, instance: String, payload: String) {
    val app = context.applicationContext
    Thread {
      try {
        System.loadLibrary(NATIVE_LIBRARY)
        init(app)
        NotificationRenderer.init(app)
        if (!NotificationRenderer.notificationsEnabled()) return@Thread
        // Tauri の app_data_dir() と同じ場所 (NotificationWorker の注記を参照)
        onMessage(app, app.dataDir.absolutePath, instance, payload)
      } catch (e: Throwable) {
        // UnsatisfiedLinkError 等も含めて握る。push の失敗でプロセスを落とさない
        Log.w(TAG, "push delivery failed", e)
      }
    }.start()
  }

  // ---- PushService から呼ぶ保存 ----

  @JvmStatic
  fun saveEndpoint(context: Context, instance: String, endpoint: PushEndpoint) {
    val keys = endpoint.pubKeySet
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (keys == null) {
      // 鍵が無いと本家は暗号化できない (Web Push は鍵必須)。使えないので捨てる
      prefs.edit().remove(endpointKey(instance)).apply()
      return
    }
    val json = JSONObject()
      .put("url", endpoint.url)
      .put("pubKey", keys.pubKey)
      .put("auth", keys.auth)
    prefs.edit()
      .putString(endpointKey(instance), json.toString())
      .remove(failureKey(instance))
      .apply()
  }

  @JvmStatic
  fun saveFailure(context: Context, instance: String, reason: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(failureKey(instance), reason)
      .apply()
  }

  @JvmStatic
  fun clearEndpoint(context: Context, instance: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(endpointKey(instance))
      .apply()
  }

  // ---- Rust から JNI で呼ぶ静的メソッド ----

  /** "none" (配送アプリが無い) / "ready" (使う配送アプリが決まっている) / "choose" (複数あって未選択) */
  @JvmStatic
  fun distributorState(): String {
    val c = appContext ?: return "none"
    return try {
      if (UnifiedPush.getAckDistributor(c) != null || UnifiedPush.getSavedDistributor(c) != null) {
        "ready"
      } else {
        val found = UnifiedPush.getDistributors(c)
        when {
          found.isEmpty() -> "none"
          found.size == 1 -> "ready"
          else -> "choose"
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "distributorState failed", e)
      "none"
    }
  }

  /**
   * instance (ホスト) をサーバーの VAPID 公開鍵つきで配送アプリに登録する。
   * エンドポイントは後から PushService.onNewEndpoint に届く (Rust は [endpoint] を待つ)。
   * 配送アプリが 1 つなら自動で選び、複数で既定が無ければ OS の選択画面に委ねる。
   * 始められたら true
   */
  @JvmStatic
  fun register(instance: String, vapid: String): Boolean {
    val c = appContext ?: return false
    return try {
      val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      prefs.edit().remove(failureKey(instance)).apply()
      val decided = UnifiedPush.getAckDistributor(c) != null || UnifiedPush.getSavedDistributor(c) != null
      if (decided) {
        UnifiedPush.register(c, instance, null, vapid)
        return true
      }
      val found = UnifiedPush.getDistributors(c)
      when {
        found.isEmpty() -> false
        found.size == 1 -> {
          UnifiedPush.saveDistributor(c, found[0])
          UnifiedPush.register(c, instance, null, vapid)
          true
        }
        else -> {
          val a = activity?.get() ?: return false
          a.runOnUiThread {
            UnifiedPush.tryUseCurrentOrDefaultDistributor(a) { ok ->
              if (ok) UnifiedPush.register(c, instance, null, vapid)
            }
          }
          true
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "register failed", e)
      false
    }
  }

  /** 保存済みのエンドポイントと鍵 (JSON `{url, pubKey, auth}`)。無ければ null */
  @JvmStatic
  fun endpoint(instance: String): String? {
    val c = appContext ?: return null
    return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(endpointKey(instance), null)
  }

  /** 配送アプリへの登録の失敗の種別 (FailedReason の名前)。無ければ null */
  @JvmStatic
  fun failure(instance: String): String? {
    val c = appContext ?: return null
    return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(failureKey(instance), null)
  }

  /** instance を配送アプリから外し、保存したエンドポイントも捨てる */
  @JvmStatic
  fun unregister(instance: String) {
    val c = appContext ?: return
    try {
      UnifiedPush.unregister(c, instance)
    } catch (e: Throwable) {
      Log.w(TAG, "unregister failed", e)
    }
    clearEndpoint(c, instance)
  }

  private fun endpointKey(instance: String) = "endpoint:$instance"
  private fun failureKey(instance: String) = "failure:$instance"
}
