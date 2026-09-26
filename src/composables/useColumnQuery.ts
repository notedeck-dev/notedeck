import type { Ref } from 'vue'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import type { NormalizedNote, NoteUpdateEvent } from '@/adapters/types'
import type { QirQuery } from '@/bindings'
import { i18n } from '@/i18n'
import {
  type CompileResult,
  compileColumnQuery,
  hashQirQuery,
} from '@/services/columnQuery/compiler'
import { composeQir } from '@/services/columnQuery/composeQir'
import { getSharedDegradedRunner } from '@/services/columnQuery/degradedRunner'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'
import { type VariantKey, variantKey, variantKeyOf } from '@/services/noteKey'
import { isQueryActive, useColumnQueriesStore } from '@/stores/columnQueries'
import { type DeckColumn, useDeckStore } from '@/stores/deck'
import { readSafeMode } from '@/utils/safeMode'

/** 🐢 (逐次適用) パーツ。key はサスペンドの単位 (名前付きクエリ id / インライン) */
interface DegradedPart {
  label: string | null
  key: string
  source: string
}

/**
 * カラムクエリ (#783 層 2) の評価器。カラム設定の noteQuery (インライン式) +
 * noteQueryRefs (名前付きクエリ参照) を QIR にコンパイルし、全取り込み経路
 * (キャッシュ復元 / REST / ページング / streaming / refresh) で評価する。
 * 合成は And (仕様追補 B)。層 1 述語 (isHidden) は表示 computed 側で、合成は
 * 「!isHidden && query」(#831 の縫い目)。組込フィルタとは AND 合成 (組込が
 * 先 = 最安) で、組込の判定は呼び出し側が enqueue の前段で行う。
 *
 * per-account の `useNoteColumn` と全アカウント面の `useCrossAccountNotes`
 * が同じ評価器を共有する。列の保持 (rawNotes / setNotes)、再取得、streaming
 * の enqueue は面ごとに違うので依存として受け取る。
 */
export interface ColumnQueryDeps {
  getColumn: () => Pick<DeckColumn, 'id' | 'noteQuery' | 'noteQueryRefs'>
  /** 列の生ノート (フィルタ前)。再適用と更新イベント後の再評価に使う */
  rawNotes: Ref<NormalizedNote[]>
  setNotes: (notes: NormalizedNote[]) => void
  /** クエリ変更時の再取得 (緩和方向の回収) と、サスペンド再開後の取り直し */
  refresh: (opts?: { force?: boolean }) => Promise<void> | void
  /** streaming 挿入の受け口 (判定を通ったノートだけ渡す) */
  enqueue: (note: NormalizedNote) => void
  /** 更新イベントの本処理。クエリ再評価はその後段 */
  onNoteUpdate: (event: NoteUpdateEvent) => void
}

export function useColumnQuery(deps: ColumnQueryDeps) {
  const columnQueriesStore = useColumnQueriesStore()
  const compiledQuery = computed(() => {
    // セーフモード時はカラムクエリを無いものとして扱う (#838 条件 3)。
    // コンパイルしない・Worker を起動しない・QIR キャッシュ検索に入らない・
    // フィルタなしで表示 (fail-open)。プラグインと同じ「自動実行される
    // ユーザーコードを止める」意味論。評価時に読むのはテスト容易性のため
    if (readSafeMode()) return null
    const col = deps.getColumn()
    const inline = col.noteQuery?.trim() ? col.noteQuery : null
    const refs = col.noteQueryRefs ?? []
    if (!inline && refs.length === 0) return null
    // ⚡ = QIR で同期評価、🐢 = Worker で逐次適用 (Phase 2)、拒否 = fail-closed
    const fast: { label: string | null; query: QirQuery }[] = []
    const degraded: DegradedPart[] = []
    const rejected: { label: string | null; result: CompileResult }[] = []
    // 参照消失 (削除・未導入) は捨てず fail-closed (仕様追補 A)
    const missing: string[] = []
    // 無効化された参照 (#1043)。評価上は「無いもの」(fail-open) だが、
    // 「設定してあるのに効いていない」を表示で見せるために名前を残す
    const disabled: string[] = []

    function classify(label: string | null, key: string, src: string): void {
      const result = compileColumnQuery(src)
      if (result.ok) {
        fast.push({ label, query: result.query })
      } else if (result.degradable) {
        degraded.push({ label, key, source: src })
      } else {
        rejected.push({ label, result })
      }
    }

    if (inline) classify(null, `${col.id}:inline`, inline)
    for (const id of refs) {
      const named = columnQueriesStore.getQuery(id)
      if (!named) {
        missing.push(id)
        continue
      }
      // 無効はコンパイルしない・Worker に渡さない・キャッシュ検索にも入れない。
      // 解釈不能でも無効なら止まる側 (消失だけは無効化で救えない)
      if (!isQueryActive(named)) {
        disabled.push(named.name)
        continue
      }
      // key は名前付きクエリ id。同じクエリを使う全カラムでサスペンドを共有する
      classify(named.name, id, named.src)
    }
    return { fast, degraded, rejected, missing, disabled }
  })
  /** per-note エラーの診断計上 (V14: エラー = 除外 + 計上) */
  const queryErrorCount = ref(0)
  /** クエリで除外したノート数 (空状態の「TL が空」との区別表示用) */
  const queryExcludedCount = ref(0)
  /**
   * 共有 runner のサスペンド集合の版 (#1110)。runner は reactive ではないので、
   * 変更通知で版を上げて下の computed を再評価させる。別カラムでの
   * サスペンド・再開も、バッチを通らずにこのカラムの表示へ届く
   */
  const suspensionVersion = ref(0)
  const unsubscribeSuspension = getSharedDegradedRunner().subscribe(() => {
    suspensionVersion.value++
  })
  onScopeDispose(() => unsubscribeSuspension())
  /**
   * 暴走で打ち切られサスペンド中のフィルタ (「N 件保留中」表示用)。
   * 「今このカラムが評価対象にしている 🐢 パーツ」∩「runner のサスペンド集合」
   * から毎回導く (#1110)。保持した一覧を使い回すと、適用トグルや無効化で
   * 評価対象から外れたクエリの表示が残り、その「再開」が外れたクエリまで
   * 解除してしまう (他カラムで黙って走り直す)
   */
  const suspendedQueryKeys = computed<readonly string[]>(() => {
    suspensionVersion.value
    const compiled = compiledQuery.value
    if (!compiled || compiled.degraded.length === 0) return []
    const runner = getSharedDegradedRunner()
    return compiled.degraded
      .map((d) => d.key)
      .filter((key) => runner.isSuspended(key))
  })
  /** サスペンド中に判定できず取り込めなかった件数 */
  const querySuspendedCount = ref(0)

  const columnQueryState = computed(() => {
    const compiled = compiledQuery.value
    if (!compiled) {
      // セーフモードでクエリを止めているカラムは、止まっていることが見えないと
      // 「もともとクエリを設定していないカラム」と区別がつかない (#971)。
      // クエリの主用途は「見たくないものを隠す」ことなので、停止が黙って
      // 起きると隠していたものが予告なく表示に戻る。fail-open は維持する。
      const col = deps.getColumn()
      const hasQuery =
        !!col.noteQuery?.trim() || (col.noteQueryRefs ?? []).length > 0
      if (hasQuery && readSafeMode()) {
        return { status: 'safeMode' as const, diagnostics: [], disabled: [] }
      }
      return { status: 'none' as const, diagnostics: [], disabled: [] }
    }
    const disabled = compiled.disabled
    const diagnostics: { message: string }[] = []
    for (const id of compiled.missing) {
      diagnostics.push({
        message: i18n.tsx._useColumnQuery.missingNamedQuery({ id }),
      })
    }
    for (const part of compiled.rejected) {
      const prefix = part.label ? `${part.label}: ` : ''
      for (const d of part.result.ok ? [] : part.result.diagnostics) {
        diagnostics.push({ message: `${prefix}${d.message}` })
      }
    }
    if (diagnostics.length > 0) {
      return { status: 'invalid' as const, diagnostics, disabled }
    }
    // 適用がすべて無効 (#1043): 評価対象が空。クエリ無しと同じ結果を返すが、
    // 「未設定」と見分けるためバッジは消さない (セーフモードの #971 と同型)
    if (
      compiled.fast.length === 0 &&
      compiled.degraded.length === 0 &&
      disabled.length > 0
    ) {
      return { status: 'disabled' as const, diagnostics: [], disabled }
    }
    // 🐢: 逐次適用に降格しているカラム (インデックス検索は使えない)
    if (compiled.degraded.length > 0) {
      return { status: 'degraded' as const, diagnostics: [], disabled }
    }
    return { status: 'active' as const, diagnostics: [], disabled }
  })

  /**
   * ⚡ パーツ (QIR) だけの同期判定。🐢 パーツは Worker が要るのでここでは見ない。
   * 取り込み経路はまずこれで短絡し、生き残りだけを Worker に回す。
   */
  function queryAdmitsFast(note: NormalizedNote): boolean {
    const compiled = compiledQuery.value
    if (!compiled) return true
    // 参照消失・拒否されたクエリの残留は fail-closed (不変条件 (f))
    if (columnQueryState.value.status === 'invalid') return false
    // And 合成: 全部 match のときだけ表示 (短絡)。error = 除外 + 計上
    for (const part of compiled.fast) {
      const verdict = evaluateQirQuery(part.query, note)
      if (verdict === 'match') continue
      if (verdict === 'error') queryErrorCount.value++
      queryExcludedCount.value++
      return false
    }
    return true
  }

  /**
   * クエリ変更の世代。遅れて返った再適用と Worker 判定が新しい状態を壊さない
   * ためのガード (querySignature の watch で進める)
   */
  let querySignatureGeneration = 0

  /**
   * 🐢 パーツを Worker で評価する (Phase 2c)。⚡ で生き残ったノートだけが対象。
   * 評価不能 (サスペンド・タイムアウト) は error = 除外 + 計上で、カラムは
   * fail-closed のまま新着が積まれない状態になる (不変条件 (f))。
   */
  async function admitDegraded(
    notes: NormalizedNote[],
  ): Promise<NormalizedNote[]> {
    const compiled = compiledQuery.value
    if (!compiled || compiled.degraded.length === 0 || notes.length === 0) {
      return notes
    }
    const runner = getSharedDegradedRunner()
    const generation = querySignatureGeneration
    const outcome = await runner.run(
      compiled.degraded.map((d) => ({ key: d.key, source: d.source })),
      notes,
    )
    // Worker 往復の間にクエリ (ソース・参照・有効状態) が変わっていたら、
    // 返ってきたのは変更前のクエリの判定なので捨て、現在のクエリで ⚡ から
    // 評価し直す (#1119)。hold-and-release と更新後の再評価はこの経路しか
    // 通らないので、ガードはここ 1 箇所に置く
    if (generation !== querySignatureGeneration) {
      return admitDegraded(notes.filter(queryAdmitsFast))
    }
    const isSuspended = compiled.degraded.some((d) => runner.isSuspended(d.key))
    const admitted: NormalizedNote[] = []
    outcome.verdicts.forEach((verdict, i) => {
      const note = notes[i]
      if (note === undefined) return
      if (verdict === 'match') {
        admitted.push(note)
        return
      }
      // サスペンド中は全件が error で返る。評価できていないだけなので
      // 「保留」に数え、評価エラー・除外には積まない (積むとバッジの
      // エラー件数が停止している間ずっと増え続ける)
      if (isSuspended) {
        querySuspendedCount.value++
        return
      }
      if (verdict === 'error') queryErrorCount.value++
      queryExcludedCount.value++
    })
    return admitted
  }

  /**
   * QIR キャッシュ検索に使えるクエリ (#783 Phase 3)。
   *
   * ⚡ パーツのみで構成されるカラムに限る (🐢 パーツは QIR を持たない)。
   * 複数 ⚡ は let スロットを renumber したうえで And 合成する (#965)。
   * 該当しないカラムは従来どおり「キャッシュから読んでフロントで絞る」
   * 経路を通る。
   */
  function cacheSearchableQuery(): QirQuery | null {
    const compiled = compiledQuery.value
    if (!compiled) return null
    if (compiled.degraded.length > 0 || compiled.rejected.length > 0)
      return null
    if (compiled.missing.length > 0) return null
    if (compiled.fast.length === 0) return null
    return composeQir(compiled.fast.map((f) => f.query))
  }

  /** 参照先が消えた名前付きクエリの id (削除・未導入)。fail-closed の原因 */
  const missingQueryIds = computed(() => compiledQuery.value?.missing ?? [])

  /**
   * 消えたクエリへの参照をこのカラムから外す。
   *
   * 参照は自動では掃除しない (再導入で復帰させたい・黙ってフィルタが外れるのを
   * 避けたい、仕様追補 A) が、外す手段が無いと fail-closed から抜け出せない。
   * フィルタメニューは存在するクエリしか列挙しないので、ここが唯一の導線になる。
   */
  function dropMissingQueryRefs(): void {
    const col = deps.getColumn()
    const missing = new Set(missingQueryIds.value)
    const refs = (col.noteQueryRefs ?? []).filter((id) => !missing.has(id))
    useDeckStore().updateColumn(col.id, {
      noteQueryRefs: refs.length > 0 ? refs : undefined,
    })
  }

  /**
   * サスペンドを解除して取り込みを再開する (V15 の明示再開)。
   * 自動では戻さない — 暴走したクエリを黙って走らせ直さないため。
   */
  function resumeSuspendedQueries(): void {
    const runner = getSharedDegradedRunner()
    // 今このカラムが評価対象にしているキーだけ。外れたクエリは対象外 (#1110)
    for (const key of suspendedQueryKeys.value) runner.resume(key)
    querySuspendedCount.value = 0
    void deps.refresh()
  }

  /** 合成クエリの実効シグネチャ (dedup キーと変更検知を兼ねる)。 */
  const querySignature = computed(() => {
    const compiled = compiledQuery.value
    if (!compiled) return ''
    if (columnQueryState.value.status === 'invalid') {
      return `invalid:${compiled.missing.join(',')}`
    }
    return [
      ...compiled.fast.map((p) => hashQirQuery(p.query)),
      // 🐢 パーツは QIR を持たないのでソース全文を署名に混ぜる。長さだけだと
      // 同じ文字数への編集で署名が動かず、再適用も再取得も起きない
      ...compiled.degraded.map(
        (d) => `slow:${JSON.stringify([d.key, d.source])}`,
      ),
    ].join('+')
  })

  // クエリ変更時 (インライン編集・トグル・named の編集伝播): 診断をリセットし、
  // 表示中ノートへ即時適用 (絞り込み方向) + refetch (緩和方向の回収)
  watch(querySignature, (next, prev) => {
    if (next === prev) return
    queryErrorCount.value = 0
    queryExcludedCount.value = 0
    // 保留件数は外れたクエリのものかもしれないので一緒に捨てる (#1110)
    querySuspendedCount.value = 0
    const generation = ++querySignatureGeneration
    // 再適用と refetch は直列に流す。並行にすると、🐢 の Worker 待ちで遅れた
    // 再適用が refetch の結果を「変更前のクエリで絞った列」で上書きしてしまう
    // (fail-closed 中は空列なので、解除した瞬間に一覧が消える)
    void (async () => {
      if (deps.rawNotes.value.length > 0) {
        const filtered = await applyQueryFilter(deps.rawNotes.value)
        if (generation !== querySignatureGeneration) return
        deps.setNotes(filtered)
      }
      if (generation !== querySignatureGeneration) return
      // 再適用で列が空になっていても取り直す。ストリーミングカラムの
      // catch-up は「ノートが 1 件も無ければ API を叩かない」ので、
      // force なしだと空のまま次のストリームイベントまで埋まらない (#957)
      await deps.refresh({ force: true })
    })()
  })

  async function applyQueryFilter(
    incoming: NormalizedNote[],
  ): Promise<NormalizedNote[]> {
    if (!compiledQuery.value) return incoming
    return admitDegraded(incoming.filter((n) => queryAdmitsFast(n)))
  }

  /**
   * streaming 挿入にも組込フィルタ + クエリを適用する (enqueue 前段、V13/V22)。
   *
   * ⚡ だけのカラムは同期のまま即 enqueue する。🐢 パーツがあるカラムは
   * 判定が非同期になるので、判定待ちバッファへ積んで hold-and-release する。
   */
  function enqueueWithQuery(n: NormalizedNote): void {
    if (!queryAdmitsFast(n)) return
    if ((compiledQuery.value?.degraded.length ?? 0) === 0) {
      deps.enqueue(n)
      return
    }
    holdForDegraded(n)
  }

  // --- 判定待ちバッファ (hold-and-release, V22) ---
  // 到着順を保つため、バッチは 1 本ずつ直列に流す。判定が終わったものから
  // 順に enqueue するので、Worker の応答が前後しても表示順は入れ替わらない。
  let heldNotes: NormalizedNote[] = []
  let holdFlush: Promise<void> | null = null
  /** 判定中 (Worker 往復の間) に削除されたキー。enqueue の直前で再確認する */
  const droppedWhileHeld = new Set<VariantKey>()

  function holdForDegraded(n: NormalizedNote): void {
    heldNotes.push(n)
    // 実行中なら積むだけ。flush 側のループが同じバッファを拾って続ける
    if (holdFlush !== null) return
    holdFlush = flushHeldNotes().finally(() => {
      holdFlush = null
    })
  }

  async function flushHeldNotes(): Promise<void> {
    while (heldNotes.length > 0) {
      const batch = heldNotes
      heldNotes = []
      const admitted = await admitDegraded(batch)
      for (const note of admitted) {
        if (droppedWhileHeld.has(variantKeyOf(note))) continue
        deps.enqueue(note)
      }
    }
    droppedWhileHeld.clear()
  }

  /** 判定待ちのまま削除されたノートを捨てる (removePending と同じ役割) */
  function dropHeldNote(key: VariantKey): void {
    heldNotes = heldNotes.filter((n) => variantKeyOf(n) !== key)
    if (holdFlush !== null) droppedWhileHeld.add(key)
  }

  /**
   * ノート更新イベント後の再評価 (V24)。表示中ノートが更新でクエリ条件を
   * 外れたら即除去する (例: reactions を見るクエリ)。逆方向 (外 → 内) は
   * 挿入しない — 取得経路を通っていないノートは位置が定まらない (追補 C-7)。
   * 本文編集はライブイベントが無く、refetch 経路の applyFilter が担う。
   */
  function onNoteUpdateWithQuery(event: NoteUpdateEvent): void {
    deps.onNoteUpdate(event)
    if (!compiledQuery.value || event.type === 'deleted') return
    const key = variantKey(event.accountId, event.noteId)
    void nextTick(async () => {
      const note = deps.rawNotes.value.find((n) => variantKeyOf(n) === key)
      if (!note) return
      if (!queryAdmitsFast(note)) {
        deps.setNotes(
          deps.rawNotes.value.filter((n) => variantKeyOf(n) !== key),
        )
        return
      }
      const admitted = await admitDegraded([note])
      if (admitted.length === 0) {
        deps.setNotes(
          deps.rawNotes.value.filter((n) => variantKeyOf(n) !== key),
        )
      }
    })
  }

  return {
    compiledQuery,
    columnQueryState,
    queryErrorCount,
    queryExcludedCount,
    suspendedQueryKeys,
    querySuspendedCount,
    resumeSuspendedQueries,
    missingQueryIds,
    dropMissingQueryRefs,
    querySignature,
    applyQueryFilter,
    queryAdmitsFast,
    admitDegraded,
    cacheSearchableQuery,
    enqueueWithQuery,
    dropHeldNote,
    onNoteUpdateWithQuery,
  }
}
