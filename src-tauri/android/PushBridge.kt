package com.notedeck.desktop

import android.app.Activity
import android.content.Context
import android.util.Log
import org.json.JSONArray
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
 * instance は「口座 ID + 世代」(Rust の push_state::instance_name)。connector には登録の
 * 一覧を返す API が無いので、登録した instance はここで覚えておく ([instances])。
 */
object PushBridge {
  private const val TAG = "PushBridge"

  /** エンドポイントと鍵の置き場 (アプリ専用領域、端末外バックアップから除外) */
  private const val PREFS = "notedeck_push"

  /** Cargo の [lib] name (NotificationWorker と同じ) */
  private const val NATIVE_LIBRARY = "notedeck_lib"

  /** 登録した instance の一覧 */
  private const val INSTANCES = "instances"

  /** 複数の配送アプリから選べなかった (Rust の push_flow::FAILURE_NOT_CHOSEN と同じ値) */
  private const val FAILURE_NOT_CHOSEN = "NOT_CHOSEN"

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
   * 画像は締切 (Rust の image_deadline::PUSH、配送の猶予より短い) まで待って 1 回で
   * 描く (#1195)。締切後も取得は共有の runtime で続き、次の配送では待たない
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

  /**
   * Context を預かっているか。無いプロセスでは登録の有無を読めず「無い」と区別できない
   * ので、Rust は突き合わせを止める
   */
  @JvmStatic
  fun isReady(): Boolean = appContext != null

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
   * instance をサーバーの VAPID 公開鍵つきで配送アプリに登録する。`message` は配送アプリの
   * 画面で口座を見分けるための文 (`@user@host`)。エンドポイントは後から
   * PushService.onNewEndpoint に届く (Rust は [endpoint] を待つ)。配送アプリが 1 つなら
   * 自動で選び、複数で既定が無ければ OS の選択画面に委ね、選べなければ失敗の種別に
   * [FAILURE_NOT_CHOSEN] を残す (NoteDeck の一覧で選んでもらう)。始められたら true
   */
  @JvmStatic
  fun register(instance: String, vapid: String, message: String): Boolean {
    val c = appContext ?: return false
    return try {
      val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      prefs.edit().remove(failureKey(instance)).apply()
      val decided = UnifiedPush.getAckDistributor(c) != null || UnifiedPush.getSavedDistributor(c) != null
      if (decided) {
        start(c, instance, vapid, message)
        return true
      }
      val found = UnifiedPush.getDistributors(c)
      when {
        found.isEmpty() -> false
        found.size == 1 -> {
          UnifiedPush.saveDistributor(c, found[0])
          start(c, instance, vapid, message)
          true
        }
        else -> {
          val a = activity?.get() ?: return false
          a.runOnUiThread {
            UnifiedPush.tryUseCurrentOrDefaultDistributor(a) { ok ->
              if (ok) {
                start(c, instance, vapid, message)
              } else {
                saveFailure(c, instance, FAILURE_NOT_CHOSEN)
              }
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

  private fun start(c: Context, instance: String, vapid: String, message: String) {
    val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val known = prefs.getStringSet(INSTANCES, emptySet()).orEmpty().toMutableSet()
    known.add(instance)
    prefs.edit().putStringSet(INSTANCES, known).apply()
    UnifiedPush.register(c, instance, message, vapid)
  }

  /** 登録した instance (JSON の文字列の配列)。v1.94.0 が残したサーバー単位の分も含む */
  @JvmStatic
  fun instances(): String {
    val c = appContext ?: return "[]"
    val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val all = prefs.getStringSet(INSTANCES, emptySet()).orEmpty().toMutableSet()
    for (key in prefs.all.keys) {
      if (key.startsWith(ENDPOINT_PREFIX)) all.add(key.removePrefix(ENDPOINT_PREFIX))
    }
    return JSONArray(all.sorted()).toString()
  }

  /** 入っている配送アプリ (JSON `[{package, label, active}]`)。active は今使っているもの */
  @JvmStatic
  fun distributors(): String {
    val c = appContext ?: return "[]"
    val list = JSONArray()
    try {
      val pm = c.packageManager
      val found = UnifiedPush.getDistributors(c)
      // まだ決めていなくても 1 つしか無ければ、登録のときにそれを使う ([register])
      val current = UnifiedPush.getAckDistributor(c)
        ?: UnifiedPush.getSavedDistributor(c)
        ?: found.singleOrNull()
      for (pkg in found) {
        val label = try {
          pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: Throwable) {
          pkg
        }
        list.put(JSONObject().put("package", pkg).put("label", label).put("active", pkg == current))
      }
    } catch (e: Throwable) {
      Log.w(TAG, "distributors failed", e)
    }
    return list.toString()
  }

  /** 使う配送アプリを決める (一覧から選んだとき) */
  @JvmStatic
  fun saveDistributor(pkg: String) {
    val c = appContext ?: return
    try {
      UnifiedPush.saveDistributor(c, pkg)
    } catch (e: Throwable) {
      Log.w(TAG, "saveDistributor failed", e)
    }
  }

  /** 保存済みのエンドポイントと鍵 (JSON `{url, pubKey, auth}`)。無ければ null */
  @JvmStatic
  fun endpoint(instance: String): String? {
    val c = appContext ?: return null
    return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(endpointKey(instance), null)
  }

  /** 配送アプリへの登録の失敗の種別 (FailedReason の名前か [FAILURE_NOT_CHOSEN])。無ければ null */
  @JvmStatic
  fun failure(instance: String): String? {
    val c = appContext ?: return null
    return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(failureKey(instance), null)
  }

  /** instance を配送アプリから外し、保存したエンドポイントと失敗の記録も捨てる */
  @JvmStatic
  fun unregister(instance: String) {
    val c = appContext ?: return
    try {
      UnifiedPush.unregister(c, instance)
    } catch (e: Throwable) {
      Log.w(TAG, "unregister failed", e)
    }
    val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val known = prefs.getStringSet(INSTANCES, emptySet()).orEmpty().toMutableSet()
    known.remove(instance)
    prefs.edit()
      .putStringSet(INSTANCES, known)
      .remove(endpointKey(instance))
      .remove(failureKey(instance))
      .apply()
  }

  private const val ENDPOINT_PREFIX = "endpoint:"
  private fun endpointKey(instance: String) = "$ENDPOINT_PREFIX$instance"
  private fun failureKey(instance: String) = "failure:$instance"
}
