/**
 * setup コンテキスト外 (module スコープのサービス設定等) から
 * トーストを出すための遅延ヘルパ。pinia 未初期化なら黙って捨てる。
 */
export function notifyWarningToast(message: string): void {
  import('@/stores/toast')
    .then(({ useToast }) => {
      useToast().show(message, 'warning')
    })
    .catch(() => {
      /* toast unavailable — skip */
    })
}
