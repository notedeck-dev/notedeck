package com.notedeck.desktop

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
import android.util.Log
import androidx.core.app.NotificationCompat
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
 *
 * 画像は Rust 側が ImageCache (ディスクキャッシュ・サイズ上限・negative cache) を
 * 通してローカルファイル化済み。ここではネットワークに触れず decode するだけ。
 * decode は inSampleSize で寸法を抑える (上限なしの原寸デコードは
 * OutOfMemoryError でプロセスごと落ちる)。
 *
 * クリック遷移は notedeck:// deep link で行う (アプリ終了中のタップでも遷移できる)。
 */
object NotificationRenderer {
  private const val TAG = "NotificationRenderer"

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

  /** decode 後の長辺の上限。large icon の表示サイズには十分 */
  private const val AVATAR_MAX_DIM = 512

  /** 絵文字 (big picture) の decode 上限。カンバス幅の 728px を賄える値 */
  private const val EMOJI_MAX_DIM = 1024

  @Volatile
  private var appContext: Context? = null

  /** 起動時に application Context を預かる (Activity ではない)。冪等 */
  @JvmStatic
  fun init(context: Context) {
    appContext = context.applicationContext
  }

  /**
   * 通知を出す。Rust から JNI で呼ばれる (スレッドは問わない)。
   * init 前に呼ばれたら何もしない (起動直後の競合)。
   */
  @JvmStatic
  fun show(
    id: Int,
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
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
          .setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title)
          .setPriority(NotificationCompat.PRIORITY_DEFAULT)
          .setAutoCancel(true)
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
        manager.notify(id, builder.build())
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
