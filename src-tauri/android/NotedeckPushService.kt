package com.notedeck.desktop

import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * 配送アプリ (UnifiedPush の distributor) からの受け口 (#330 §5)。非公開・同一プロセス
 * (前面フラグと背景の処理をアプリと共有する前提)。中身の扱いは [PushBridge] と Rust。
 */
class NotedeckPushService : PushService() {
  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    PushBridge.saveEndpoint(applicationContext, instance, endpoint)
  }

  override fun onMessage(message: PushMessage, instance: String) {
    // 復号できたものだけが本物。エンドポイントの URL を知っていれば誰でも平文を
    // 送れるので、復号できなかったものは無条件で捨てる (§5.4)
    if (!message.decrypted) return
    PushBridge.deliver(applicationContext, instance, String(message.content, Charsets.UTF_8))
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    PushBridge.saveFailure(applicationContext, instance, reason.name)
  }

  override fun onUnregistered(instance: String) {
    PushBridge.clearEndpoint(applicationContext, instance)
  }
}
