/**
 * 「入力が同じなら結果も同じ」描画関数の結果を、表示単位で 1 枠ずつ覚えておく。
 *
 * Markdown → HTML やシンタックスハイライトは純粋関数だが、呼び出しがテンプレート
 * 内の式である以上、Vue は純粋だと知りようがなく、親が再レンダリングされるたびに
 * 全件を計算し直す。AI の応答ストリーム中は 1 トークンごとに親が描き直るため、
 * 本文が変わっていない過去のメッセージまで毎回 正規表現 + ハイライト +
 * サニタイズを通っていた。
 *
 * キーは「表示単位の id」で、値は「その id で最後に計算した入力と結果」。
 * 入力が変わった枠 (= ストリーム中の末尾メッセージ) だけが計算し直され、
 * 他は前回の結果を返す。`revision` は本文以外に出力を変える要因 (ハイライトの
 * テーマ切り替え・遅延ロードされた文法の到着) を表し、進めば全枠が計算し直される。
 */
export interface RenderCache {
  /** 枠 `key` の描画結果を返す。入力と revision が前回と同じなら compute を呼ばない。 */
  render(
    key: string,
    input: string,
    revision: number,
    compute: () => string,
  ): string
  /** 覚えている枠数 (テスト・診断用)。 */
  size(): number
}

interface Entry {
  input: string
  revision: number
  output: string
}

/**
 * @param max 覚えておく枠の上限。超えたら古い枠から捨てる。セッションを
 *   切り替えても前のセッションの枠が残るため、伸びっぱなしにしないための蓋。
 */
export function createRenderCache(max: number): RenderCache {
  const entries = new Map<string, Entry>()

  return {
    render(key, input, revision, compute) {
      const hit = entries.get(key)
      if (hit && hit.input === input && hit.revision === revision) {
        return hit.output
      }
      const output = compute()
      // 既存の枠の上書きは枠数を増やさない (= ストリーム中の末尾メッセージは
      // 自分の枠を使い続け、他の枠を押し出さない)
      if (!entries.has(key) && entries.size >= max) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
      entries.set(key, { input, revision, output })
      return output
    },
    size: () => entries.size,
  }
}
