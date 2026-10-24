package com.notedeck.desktop

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * 閉じている間の通知の巡回 (#330 段階 C)。WorkManager が 15 分おきに起こす。
 *
 * ここは薄い: ネイティブライブラリを読み込み、描画ヘルパーに application Context を
 * 預け、OS で通知が許可されているときだけ Rust ([NotificationBridge.runWorker]) に
 * 入る。口座の読取 / トークン / Misskey への問い合わせ / 文言 / 描画の呼出は全部
 * Rust が持つので、アプリを開いている間のストリーミングと同じ通知が出る。
 *
 * アプリの Activity が無いプロセスで起きることがある (OS がプロセスを殺した後の
 * 巡回)。その場合もライブラリの読込とヘルパーの初期化はここで足りる。
 */
class NotificationWorker(
  context: Context,
  params: WorkerParameters,
) : CoroutineWorker(context, params) {

  companion object {
    private const val TAG = "NotificationWorker"
    /** Cargo の [lib] name。TauriActivity が読み込むのと同じライブラリ */
    private const val NATIVE_LIBRARY = "notedeck_lib"
    private const val RESULT_RETRY = 1
  }

  override suspend fun doWork(): Result {
    return try {
      System.loadLibrary(NATIVE_LIBRARY)
      NotificationRenderer.init(applicationContext)
      // 許可されていなければ問い合わせだけ無駄になる
      if (!NotificationRenderer.notificationsEnabled()) return Result.success()
      val code = NotificationBridge.runWorker(applicationContext, applicationContext.dataDir.absolutePath)
      if (code == RESULT_RETRY) Result.retry() else Result.success()
    } catch (e: Throwable) {
      // UnsatisfiedLinkError 等も含めて握る。巡回の失敗でプロセスを落とさない
      Log.w(TAG, "Worker failed", e)
      Result.success()
    }
  }
}
