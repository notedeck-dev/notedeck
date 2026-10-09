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
  function add(key: string) {
    keys.delete(key)
    keys.add(key)
    if (keys.size > max) {
      const oldest = keys.values().next().value
      if (oldest !== undefined) keys.delete(oldest)
    }
  }
  return {
    has: (key: string) => keys.has(key),
    add,
    /** 開閉のように戻せる状態用。偽なら忘れる */
    set(key: string, value: boolean) {
      if (value) add(key)
      else keys.delete(key)
    },
  }
}

/** リアクション行を描画済みのノート id (MkNote の遅延描画) */
export const renderedReactionNotes = createRenderedMemo(2000)

/** 読み込みが済んだメディアの URL (MkMediaGrid のフェードイン) */
export const loadedMediaUrls = createRenderedMemo(2000)

/**
 * 利用者が開いた CW / 長文のノート id (MkNote)。キーは `cw:` / `long:` 接頭辞付き。
 * 行が作り直されても開いたままにする
 */
export const expandedNoteContent = createRenderedMemo(2000)

/** 利用者が開いた NSFW (と従量制回線で保留した) 添付の file id (MkMediaGrid) */
export const revealedMediaFiles = createRenderedMemo(2000)

/**
 * 読み込みに失敗した同梱 Twemoji の URL (MkEmoji)。同梱版より新しい絵文字は
 * 404 になるので、行が作り直されても取り直さず最初から文字で出す (#1219)
 */
export const failedTwemojiUrls = createRenderedMemo(500)
