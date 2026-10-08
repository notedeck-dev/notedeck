/**
 * 「一度描画した / 読み込み済み」を覚えておく上限付きの集合 (古い順に忘れる)。
 *
 * 仮想スクロールは画面外の行を破棄し、戻ると作り直す。コンポーネント内の
 * 状態 (遅延描画の済み / 画像の読み込み済み) はそのたびに初期値へ戻るので、
 * 再表示のたびに「予約 → 実寸」の伸び縮みやフェードのやり直しが起きる。
 * モジュール単位でこれを持ち、作り直した行は最初から済みの状態で描く。
 */
export function createRenderedMemo(max: number) {
  const keys = new Set<string>()
  return {
    has: (key: string) => keys.has(key),
    add(key: string) {
      keys.delete(key)
      keys.add(key)
      if (keys.size > max) {
        const oldest = keys.values().next().value
        if (oldest !== undefined) keys.delete(oldest)
      }
    },
  }
}

/** リアクション行を描画済みのノート id (MkNote の遅延描画) */
export const renderedReactionNotes = createRenderedMemo(2000)

/** 読み込みが済んだメディアの URL (MkMediaGrid のフェードイン) */
export const loadedMediaUrls = createRenderedMemo(2000)
