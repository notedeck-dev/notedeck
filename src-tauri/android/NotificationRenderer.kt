package com.notedeck.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * OS 通知の描画 (Activity 非依存、#330 §4.1)。
 *
 * Rust (streaming.rs) から JNI の静的メソッドとして呼ばれる。以前は Activity の
 * インスタンスメソッドで、戻るキーで Activity を閉じてプロセスだけ残った状態で
 * 通知が届くと、Activity に紐づくネイティブ文脈が解放済みで落ちていた。
 * application Context を起動時に 1 回受け取り、以後は Activity が無くても描く。
 * ワーカー / push の経路も同じ描画を使う (#330 §4)。
 *
 * 配置はデスクトップ (user-notify) と揃える:
 *   avatarPath -> large icon   (アクターのアバター。Windows の appLogoOverride)
 *   imagePath  -> big picture  (リアクションのカスタム絵文字。Windows のインライン画像)
 *   small icon -> ロゴの型抜き (ic_stat_notify、#1195)。Android は small icon の alpha
 *                 だけを形にして単色で塗るので、ランチャーのアイコンを渡すと白い丸になる
 *
 * 画像は Rust 側が ImageCache (ディスクキャッシュ・サイズ上限・negative cache) を
 * 通してローカルファイル化済みで、揃ってから 1 回だけ呼ばれる (締切は Rust 側、#1195)。
 * ここではネットワークに触れず decode するだけ。
 * decode は inSampleSize で寸法を抑える (上限なしの原寸デコードは
 * OutOfMemoryError でプロセスごと落ちる)。
 *
 * クリック遷移は notedeck:// deep link で行う (アプリ終了中のタップでも遷移できる)。
 */
object NotificationRenderer {
  private const val TAG = "NotificationRenderer"

  /** 以前の 1 本だけのチャネル。種別群のチャネルに移行するときに消す */
  private const val LEGACY_CHANNEL_ID = "notedeck_notifications"

  /**
   * リアクション絵文字を載せる透明カンバス。Android の big picture は
   * 通知の横幅に合わせて拡縮されるため、表示される高さは画像のアスペクト比
   * だけで決まる。カンバスを固定比にすることで絵文字ごとの高さを揃える
   * (Windows toast と同じ理由 — os_notify.rs の normalize_emoji_height 参照)。
   */
  private const val EMOJI_CANVAS_W = 728
  private const val EMOJI_CANVAS_H = 128

  /** decode 後の長辺の上限。large icon の表示サイズには十分 */
  private const val AVATAR_MAX_DIM = 512

  /** 絵文字 (big picture) の decode 上限。カンバス幅の 728px を賄える値 */
  private const val EMOJI_MAX_DIM = 1024

  /**
   * 通知の色 = UI のアクセント色 (global.css の --nd-accent)。通知シェードの見出しと、
   * 大きいアイコンが無い通知で small icon の背景になる丸に効く (Android 12 以降は
   * small icon の色にも)。ステータスバーの色とタイトル / 本文の文字色は変わらない
   */
  private const val ACCENT_COLOR = 0xFF86B300.toInt()

  @Volatile
  private var appContext: Context? = null

  /** 起動時に application Context を預かる (Activity ではない)。冪等 */
  @JvmStatic
  fun init(context: Context) {
    appContext = context.applicationContext
  }

  /**
   * 通知チャネルを種別群で作る / 名前を付け直す (#330 §4.4)。Rust が表示言語で
   * 組んだ名前を JSON (`[{id, name, important}]`) で渡す。同じ id で作り直すと
   * 名前だけ更新される。以前の 1 本だけのチャネルが残っていれば消し、そこに
   * 出ていた通知 (旧ビルドの連番 ID、tag 無し) も全部消す。
   */
  @JvmStatic
  fun ensureChannels(json: String) {
    val context = appContext ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val items = JSONArray(json)
      for (i in 0 until items.length()) {
        val item = items.getJSONObject(i)
        val importance = if (item.optBoolean("important")) {
          NotificationManager.IMPORTANCE_HIGH
        } else {
          NotificationManager.IMPORTANCE_DEFAULT
        }
        val channel = NotificationChannel(item.getString("id"), item.getString("name"), importance)
          .apply { setShowBadge(true) }
        manager.createNotificationChannel(channel)
      }
      if (manager.getNotificationChannel(LEGACY_CHANNEL_ID) != null) {
        manager.cancelAll()
        manager.deleteNotificationChannel(LEGACY_CHANNEL_ID)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to ensure channels", e)
    }
  }

  /** 通知が OS で許可されているか (権限の拒否 / アプリ単位のブロックを含む) */
  @JvmStatic
  fun notificationsEnabled(): Boolean {
    val context = appContext ?: return true
    return androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  /** OS のこのアプリの通知設定を開く (拒否が重なってダイアログが出なくなった後の導線) */
  @JvmStatic
  fun openSettings() {
    val context = appContext ?: return
    try {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(android.net.Uri.parse("package:" + context.packageName))
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to open notification settings", e)
    }
  }

  /** tag の通知を全部消す (既読になった口座の分)。Rust から JNI で呼ばれる */
  @JvmStatic
  fun cancel(tag: String) {
    val context = appContext ?: return
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      for (n in manager.activeNotifications) {
        if (n.tag == tag) manager.cancel(tag, n.id)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to cancel notifications", e)
    }
  }

  /**
   * 通知を出す。Rust から JNI で呼ばれる (スレッドは問わない)。
   * (tag, id) は Rust が口座 + 種別と Misskey の ID から決める: 同じ通知を
   * 2 経路で受けても上書きされるだけで 2 件にならず、既読は tag 単位で消す。
   * init 前に呼ばれたら何もしない (起動直後の競合)。
   */
  @JvmStatic
  fun show(
    tag: String,
    id: Int,
    channelId: String,
    title: String,
    body: String?,
    deepLink: String?,
    avatarPath: String?,
    imagePath: String?,
  ) {
    val context = appContext
    if (context == null) {
      Log.w(TAG, "show() before init(): dropped")
      return
    }
    // Bitmap decode があるので呼び出しスレッドを塞がない
    Thread {
      try {
        val builder = NotificationCompat.Builder(context, channelId)
          .setSmallIcon(R.drawable.ic_stat_notify)
          .setColor(ACCENT_COLOR)
          .setContentTitle(title)
          .setPriority(NotificationCompat.PRIORITY_DEFAULT)
          .setAutoCancel(true)
          .setOnlyAlertOnce(true)
          .setContentIntent(buildContentIntent(context, id, deepLink))
        if (body != null) builder.setContentText(body)

        avatarPath?.let { decodeBounded(it, AVATAR_MAX_DIM) }?.let {
          builder.setLargeIcon(circleCrop(it))
        }
        imagePath?.let { decodeBounded(it, EMOJI_MAX_DIM) }?.let {
          builder.setStyle(
            NotificationCompat.BigPictureStyle().bigPicture(normalizeEmojiHeight(it))
          )
        }

        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE)
          as NotificationManager
        manager.notify(tag, id, builder.build())
      } catch (e: Throwable) {
        // OutOfMemoryError 等の Error も含めて握る。生 Thread の未捕捉
        // Throwable は uncaughtExceptionHandler がプロセスを殺す
        Log.w(TAG, "Failed to show notification", e)
      }
    }.start()
  }

  private fun buildContentIntent(context: Context, id: Int, deepLink: String?): PendingIntent {
    val intent = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      if (deepLink != null) {
        action = Intent.ACTION_VIEW
        data = android.net.Uri.parse(deepLink)
      }
    }
    return PendingIntent.getActivity(
      context,
      id,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /**
   * 寸法を抑えてローカルファイルを decode する。まず bounds だけ読み、
   * 長辺が maxDim に収まる inSampleSize を選んでから本体を decode する
   * (Android 標準のサブサンプリングパターン)。任意の巨大寸法でもメモリを
   * 確保しない。壊れた画像・寸法 0 は null (画像なしで通知を出す)。
   */
  private fun decodeBounded(path: String, maxDim: Int): Bitmap? {
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= maxDim || bounds.outHeight / (sample * 2) >= maxDim) {
        sample *= 2
      }
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to decode image: $path", e)
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
}
