import { type Ref, ref } from 'vue'
import {
  type DistributableCodec,
  type DistributableFileCollection,
  type DistributableMeta,
  type DistributableStoreOrigin,
  hasScopeTarget,
  isScopeEmpty,
  type ScopeTarget,
  withoutScopeTarget,
  withScopeTarget,
} from '@/services/distributable'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import {
  type EditAttribution,
  type HistoryKind,
  pushSnapshot,
} from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import { getStorageJson, setStorageJson } from '@/utils/storage'
import { isRepresentativeNow } from '@/windows/roles'

/**
 * 配布物 5 種 (plugin / widget / query / skill / theme) の store の共通層
 * (#1202 段階 1)。envelope (`services/distributable.ts`) の個体を写しに持ち、
 * 共通のアクション (初回読込ゲート / add / remove+undo / 改名 / 本文更新 /
 * 有効切替 / ストア更新の適用 / 基準記録 / 紐付け / アカウント削除時の掃除 /
 * 変更通知の受け口 / 履歴 push) を提供する。kind 固有の意味は宣言と hook で
 * 差し込み、**ここに kind の分岐は書かない** (設計原則 3)。
 *
 * - 変更系は async に統一 (決定 (e))。ファイル反映は「初回読込 (対応表確定) +
 *   移行」の完了を待つゲートの後ろに直列化する (#913)
 * - 読取専用 (ソース欠損) の個体は変更を拒否して false (#1111)。保存できず
 *   端末ローカルにだけ載って次回起動で巻き戻るため、写しに書く前に抜ける
 * - Tauri ではファイルが唯一の正で localStorage には書かない (#1042)。ブラウザ
 *   dev モードだけ `browserStorageKey` に写す (無い kind は永続化しない)
 * - 変更通知 (別の書き手 = notecore / 他のウィンドウ) はその個体だけ読み直し、
 *   本文が変わったときだけ `afterContentChange`、有効が変わったときだけ
 *   `afterEnabledChange` を呼ぶ (自分の書込は届かない)
 */

/**
 * アカウント削除時の方針。呼び出し側 (account actions) の差は統合対象外
 * - `unlink`: 紐付けを外すだけ。本体はライブラリに残る (plugin / widget / query)
 * - `unlinkOrRemove`: 外して紐付けが空になったら本体ごと消す (theme)
 */
export type PurgeAccountPolicy = 'unlink' | 'unlinkOrRemove'

/**
 * 本文が変わった経路。`local` はこの store の API (編集 / ストア更新)、
 * `external` は別の書き手 (notecore の capability / 他のウィンドウ) の変更通知
 */
export type ContentChangeSource = 'local' | 'external'

export interface DistributableStoreHooks<Item> {
  /**
   * 初回読込の後の kind 側の移行 (旧 UUID → 安定キー、スコープ導入前の個体の
   * 全体スコープ化 等)。in-place で直し、変えた個体を返す (永続化される)。
   * 個体を減らす移行 (複製の統合) は配列から splice し、ファイルは kind 側が消す
   */
  migrate?(items: Item[]): Item[]
  /**
   * 本文が変わった後 (本文更新 / ストア更新 / 変更通知)。有効 / 無効の切替では
   * 呼ばない (query のサスペンド解除は前者だけ、という判断を保つ)
   */
  afterContentChange?(item: Item, prev: Item, source: ContentChangeSource): void
  /** 有効 / 無効が変わった後 (切替 / 変更通知)。plugin の起動・停止はここ */
  afterEnabledChange?(item: Item): void
  /** 削除前に store 外の付帯状態 (Mk:save 領域 / サイドバーの並び) を退避する */
  snapshotForUndo?(item: Item): unknown
  /** undo で復活させた後、退避した付帯状態を戻す */
  restoreFromUndo?(item: Item, snapshot: unknown): void
  /**
   * 個体が消えた後 (削除 / 別の書き手による削除の通知)。store 外の付帯状態
   * (Mk:save 領域 / サイドバーの並び) の掃除はここ。退避は `snapshotForUndo` が先
   */
  afterRemove?(item: Item): void
  /**
   * 初回読込に失敗した (一覧が取れなかった)。この起動中はファイルに一切書かない
   * (一覧が空のまま同じ ID の個体を入れると既存のファイルの横に別名で書かれ、
   * 次の起動で片方が読み込まれなくなる)。利用者への通知はここで
   */
  onLoadFailed?(error: unknown): void
}

export interface DistributableStoreDeclaration<
  Content,
  Item extends DistributableMeta<Content, unknown>,
> {
  /** console.warn の識別子 */
  logTag: string
  /** 「有効」の宣言だけを使う (読み書きの projection はコレクション側が持つ) */
  codec: Pick<DistributableCodec<unknown, Item>, 'enabled'>
  files: DistributableFileCollection<Item>
  /** 変更通知のスコープ (設定ディレクトリの subdir 名) */
  settingsScope: string
  /** 変更通知のファイル名 → fileBase。対象外のファイル (ソース / 履歴) は undefined */
  fileBaseOf(filename: string): string | undefined
  /** ブラウザ dev モードの永続化先 (localStorage)。無い kind は永続化しない */
  browserStorageKey?: string
  generateId(): string
  /** 編集前スナップショットのリング (#1117)。無い kind は積まない */
  history?: {
    kind: HistoryKind
    /** 履歴に残す範囲。これが動いたときだけ積む (同じ内容で積むとリングを使い潰す) */
    snapshot(item: Item): Record<string, unknown>
  }
  purgeAccount: PurgeAccountPolicy
  /** 本文の同一性 (省略時は ===) */
  contentEquals?(a: Content, b: Content): boolean
  hooks?: DistributableStoreHooks<Item>
}

/** `add` の入力。id / 時刻 / fileBase は factory が埋める */
export type NewDistributable<Item extends DistributableMeta<unknown, unknown>> =
  Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'fileBase' | 'readOnly'> & {
    id?: string
  }

export interface StoreUpdatePatch<Content> {
  content: Content
  description?: string
  iconUrl?: string
  /** 照合済みの配布ソースの 3 点 (更新検知 #1040 の基準) */
  store: DistributableStoreOrigin
}

export function createDistributableStore<
  Content,
  Item extends DistributableMeta<Content, unknown>,
>(decl: DistributableStoreDeclaration<Content, Item>) {
  const tag = `[${decl.logTag}]`
  // ref の深い reactivity は保つ (store の写しとして watch される)。generic な
  // Item の UnwrapRef を型で追わないために Ref<Item[]> へ寄せる
  const items = ref([]) as Ref<Item[]>
  const contentEquals = decl.contentEquals ?? ((a, b) => a === b)
  const hooks = decl.hooks ?? {}

  let loaded = false
  // 初回読込に失敗した起動ではファイルに書かない (hooks.onLoadFailed 参照)
  let loadFailed = false
  // 変更系操作のファイル反映は「初回読込 (対応表確定) + 初回移行」の完了を
  // 待つゲート (#913)
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  function ensureLoaded(): void {
    if (loaded) return
    loaded = true
    if (settingsFs.isTauri) {
      void initFileStorage().finally(() => resolveReady?.())
    } else {
      if (decl.browserStorageKey) {
        // 読込前にメモリへ足された個体は残す (ファイル経路と同じ規則)
        const stored = getStorageJson<Item[]>(decl.browserStorageKey, [])
        const storedIds = new Set(stored.map((i) => i.id))
        items.value = [
          ...stored,
          ...items.value.filter((i) => !storedIds.has(i.id)),
        ]
      }
      runMigration()
      resolveReady?.()
    }
  }

  async function initFileStorage(): Promise<void> {
    try {
      const { items: fromFiles, outdated } = await decl.files.loadAll()

      // 初期化中にメモリ追加された個体は残す (各自の persist が ready 後に
      // ファイル化する)
      const fileIds = new Set(fromFiles.map((i) => i.id))
      const memoryOnly = items.value.filter((i) => !fileIds.has(i.id))
      if (fromFiles.length > 0) {
        items.value = [...fromFiles, ...memoryOnly]
      }
      runMigration()

      // ファイルの移行は代表窓だけが行う (#1131)。冪等
      if (await isRepresentativeNow()) {
        // 規約外名の copy-adopt 正規化 (#913)
        await decl.files.migrateItems(items.value)
        // on-disk の揃え (#1202 段階 0): 旧形式を今の projection で書き戻す。
        // 一度きり (次回は outdated に入らない)
        for (const o of outdated) {
          const live = items.value.find((i) => i.id === o.id) ?? o
          await decl.files
            .persistItem(live, items.value)
            .catch((e) =>
              console.warn(`${tag} failed to align on-disk format:`, e),
            )
        }
        // 履歴 sweep: 主ファイルと対応の取れない履歴サイドカーを削除
        await decl.files
          .sweepHistory()
          .catch((e) => console.warn(`${tag} history sweep failed:`, e))
      }
    } catch (e) {
      loadFailed = true
      console.warn(`${tag} file storage init failed`, e)
      hooks.onLoadFailed?.(e)
    }
  }

  function runMigration(): void {
    const changed = hooks.migrate?.(items.value) ?? []
    if (changed.length > 0) void Promise.all(changed.map((i) => persist(i)))
  }

  function whenReady(): Promise<void> {
    ensureLoaded()
    return ready
  }

  function persistMirror(): void {
    if (settingsFs.isTauri || !decl.browserStorageKey) return
    setStorageJson(decl.browserStorageKey, items.value)
  }

  async function persist(item: Item): Promise<void> {
    persistMirror()
    if (!settingsFs.isTauri) return
    await ready
    if (loadFailed) return
    try {
      // ref の深い reactivity で items.value の要素は proxy になるため、
      // 占有判定の「操作対象自身は占有とみなさない」参照一致が崩れない
      // よう live 要素 (proxy) を渡す
      const live = items.value.find((i) => i.id === item.id) ?? item
      await decl.files.persistItem(live, items.value)
    } catch (e) {
      console.warn(`${tag} persist failed`, e)
    }
  }

  function get(id: string): Item | undefined {
    ensureLoaded()
    return items.value.find((i) => i.id === id)
  }

  /** 写しの該当個体を差し替える */
  function replace(prev: Item, next: Item): void {
    items.value = items.value.map((i) => (i === prev ? next : i))
  }

  function rejectIfReadOnly(item: Item): boolean {
    if (!item.readOnly) return false
    console.warn(`${tag} read-only item — change rejected`)
    return true
  }

  function sameSnapshot(a: Item, b: Item): boolean {
    const h = decl.history
    if (!h) return true
    return JSON.stringify(h.snapshot(a)) === JSON.stringify(h.snapshot(b))
  }

  /**
   * 編集前の状態を履歴サイドカーに積む (#1117)。履歴キーは対応表の fileBase
   * (未割当 = ファイル未作成なら履歴も無し)。呼び出し側は完了を待つ — 改名は
   * 履歴サイドカーも動かすので、書込中に rename すると最新 snapshot が旧
   * basename に取り残される
   */
  async function pushHistory(
    prev: Item,
    next: Item,
    attribution?: EditAttribution,
  ): Promise<void> {
    const h = decl.history
    if (!h || !prev.fileBase || sameSnapshot(prev, next)) return
    await pushSnapshot(
      h.kind,
      prev.fileBase,
      h.snapshot(prev),
      attribution,
    ).catch((e) => console.warn(`${tag} history push failed:`, e))
  }

  async function add(input: NewDistributable<Item>): Promise<Item> {
    ensureLoaded()
    const now = Date.now()
    const item = {
      ...input,
      id: input.id ?? decl.generateId(),
      createdAt: now,
      updatedAt: now,
    } as unknown as Item
    items.value = [...items.value, item]
    await persist(item)
    return item
  }

  /**
   * 名前 / 説明 / 本文 (と編集で変わる kind 固有の値 `extra`) の更新。編集の
   * 経路なので履歴の範囲が動けば積む。改名はファイル名を追随させる (ID 不変)。
   * false = 未知の id か読取専用で拒否 (UI は理由を出す)
   */
  async function update(
    id: string,
    patch: Partial<Pick<Item, 'name' | 'description' | 'content'>> & {
      extra?: Partial<Item['extra']>
    },
    attribution?: EditAttribution,
  ): Promise<boolean> {
    const prev = get(id)
    if (!prev || rejectIfReadOnly(prev)) return false
    const { extra, ...rest } = patch
    const next: Item = {
      ...prev,
      ...rest,
      ...(extra ? { extra: { ...(prev.extra as object), ...extra } } : {}),
      updatedAt: Date.now(),
    }
    await pushHistory(prev, next, attribution)
    replace(prev, next)
    // 写しの差し替えを watch する側 (署名変化 等) が走る前に hook を済ませる
    if (
      patch.content !== undefined &&
      !contentEquals(patch.content as Content, prev.content)
    ) {
      hooks.afterContentChange?.(next, prev, 'local')
    }
    // 改名はファイルを rename で追随させる (ID 不変)。完了を待ってから保存
    if (settingsFs.isTauri && patch.name && patch.name !== prev.name) {
      await ready
      if (loadFailed) return true
      try {
        await decl.files.renameItemFiles(next, items.value)
      } catch (e) {
        console.warn(`${tag} rename failed`, e)
      }
    }
    await persist(next)
    return true
  }

  /**
   * 本体の有効 / 無効 (#1043)。kind が「有効」を宣言していなければ false。
   * 参加先 (スコープ) やカラム側の適用には触れない
   */
  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const declared = decl.codec.enabled
    if (!declared) return false
    const prev = get(id)
    if (!prev || rejectIfReadOnly(prev)) return false
    if (declared.get(prev) === enabled) return true
    const next: Item = { ...declared.set(prev, enabled), updatedAt: Date.now() }
    replace(prev, next)
    hooks.afterEnabledChange?.(next)
    await persist(next)
    return true
  }

  /**
   * kind 固有の付帯情報 (`extra`) の更新 (widget の autoRun / plugin の設定値 等)。
   * 状態の印なので履歴には積まず、本文や有効の hook も呼ばない (編集で変わる
   * 値は `update` の `extra` で)
   */
  async function updateExtra(
    id: string,
    patch: Partial<Item['extra']>,
  ): Promise<boolean> {
    const prev = get(id)
    if (!prev || rejectIfReadOnly(prev)) return false
    const next: Item = {
      ...prev,
      extra: { ...(prev.extra as object), ...patch },
      updatedAt: Date.now(),
    }
    replace(prev, next)
    await persist(next)
    return true
  }

  /**
   * ストア再インストール / 更新 (#913): 本文とストア由来を上書きする。
   * ローカル値 (改名した name / 参加先 / 有効) は維持。ソース欠損の readOnly
   * 個体は検証済み配布ソースで復旧する (persist 抑止を解除)。配布ソースから
   * 決まる kind 固有の値 (plugin のヘッダ由来の版 / 権限 / 設定定義) は kind 側が
   * `extra` に組んで渡す (ローカル値を残す規則は kind 側の持ち物)
   */
  async function applyStoreUpdate(
    id: string,
    patch: StoreUpdatePatch<Content> & { extra?: Item['extra'] },
  ): Promise<boolean> {
    const prev = get(id)
    if (!prev) return false
    const next: Item = {
      ...prev,
      ...patch,
      readOnly: undefined,
      updatedAt: Date.now(),
    }
    // readOnly 個体は復旧なので積まない (空ソースを履歴に残す意味が無い)
    if (!prev.readOnly) await pushHistory(prev, next)
    replace(prev, next)
    if (!contentEquals(patch.content, prev.content)) {
      hooks.afterContentChange?.(next, prev, 'local')
    }
    await persist(next)
    return true
  }

  /**
   * 更新検知の基準記録 (#1040)。基準未記録のストア由来個体へ registry 現行値を
   * 無通知で記録する。本文・ローカル値・updatedAt には触れない
   */
  async function recordStoreBaseline(
    id: string,
    baseline: { sha512: string; version: string },
  ): Promise<void> {
    const prev = get(id)
    if (!prev?.store) return
    const next: Item = { ...prev, store: { ...prev.store, ...baseline } }
    replace(prev, next)
    await persist(next)
  }

  /**
   * 削除。取り消す undo を返す (#988 — confirm → 削除 → 元に戻すトースト)。
   * 未知の id なら undefined。undo は元の位置に戻し、hook が退避した付帯状態
   * (Mk:save 領域 等) も戻す
   */
  async function remove(id: string): Promise<(() => void) | undefined> {
    ensureLoaded()
    const idx = items.value.findIndex((i) => i.id === id)
    const target = items.value[idx]
    if (!target) return undefined
    const snapshot = hooks.snapshotForUndo?.(target)
    items.value = items.value.filter((i) => i.id !== id)
    hooks.afterRemove?.(target)
    persistMirror()
    if (settingsFs.isTauri) {
      await ready
      try {
        if (!loadFailed) await decl.files.deleteItemFiles(target)
      } catch (e) {
        console.warn(`${tag} delete failed`, e)
      }
    }
    return () => {
      if (items.value.some((i) => i.id === id)) return
      const at = Math.min(idx, items.value.length)
      items.value = [
        ...items.value.slice(0, at),
        target,
        ...items.value.slice(at),
      ]
      hooks.restoreFromUndo?.(target, snapshot)
      void persist(target)
    }
  }

  async function setScope(
    id: string,
    nextScopeOf: (item: Item) => Item['scope'],
  ): Promise<boolean> {
    const prev = get(id)
    if (!prev || rejectIfReadOnly(prev)) return false
    const scope = nextScopeOf(prev)
    if (scope === prev.scope) return true
    const next: Item = { ...prev, scope, updatedAt: Date.now() }
    replace(prev, next)
    await persist(next)
    return true
  }

  /** 参加させる (#1018)。本体は増やさない。false = 読取専用で拒否 */
  function link(id: string, target: ScopeTarget): Promise<boolean> {
    return setScope(id, (i) => withScopeTarget(i.scope, target))
  }

  /** 外す。本体はライブラリに残る */
  function unlink(id: string, target: ScopeTarget): Promise<boolean> {
    return setScope(id, (i) => withoutScopeTarget(i.scope, target))
  }

  /** アカウント削除時の掃除 (#1114)。方針は宣言 (`purgeAccount`) */
  async function purgeAccount(scopeKey: string): Promise<void> {
    ensureLoaded()
    const target: ScopeTarget = { kind: 'account', key: scopeKey }
    for (const item of [...items.value]) {
      if (!hasScopeTarget(item.scope, target)) continue
      // 掃除は読取専用でも通す (紐付けだけの変更で、本文を書き戻す訳ではない)
      const next: Item = {
        ...item,
        scope: withoutScopeTarget(item.scope, target),
        updatedAt: Date.now(),
      }
      if (decl.purgeAccount === 'unlinkOrRemove' && isScopeEmpty(next.scope)) {
        await remove(item.id)
        continue
      }
      replace(item, next)
      await persist(next)
    }
  }

  /**
   * 1 ファイルを読み直して写しに載せる (別の書き手 = notecore の capability /
   * 他のウィンドウ, #1133 / #1042)。変更通知の受け口と、通知を待たずに結果が
   * 要る呼び出し側 (notemaid が置いた個体を開く等) の両方から使う。対象外の
   * ファイル名 (ソース / 履歴) は何もしない
   */
  async function reload(filename: string): Promise<void> {
    const fileBase = decl.fileBaseOf(filename)
    if (fileBase === undefined) return
    ensureLoaded()
    await ready
    let next: Item | undefined
    try {
      next = await decl.files.loadOne(filename)
    } catch (e) {
      console.warn(`${tag} reload ${filename} failed:`, e)
      return
    }
    if (!next) return
    const loaded = next
    const prev = items.value.find(
      (i) => i.id === loaded.id || i.fileBase === fileBase,
    )
    if (prev) replace(prev, loaded)
    else items.value = [...items.value, loaded]
    if (!prev) return
    if (!contentEquals(prev.content, loaded.content)) {
      hooks.afterContentChange?.(loaded, prev, 'external')
    }
    const declared = decl.codec.enabled
    if (declared && declared.get(prev) !== declared.get(loaded)) {
      hooks.afterEnabledChange?.(loaded)
    }
  }

  registerSettingsFileHandler(decl.settingsScope, async (change) => {
    const fileBase = decl.fileBaseOf(change.name)
    if (fileBase === undefined) return
    if (change.op !== 'delete') {
      await reload(change.name)
      return
    }
    ensureLoaded()
    await ready
    const removed = items.value.filter((i) => i.fileBase === fileBase)
    if (removed.length === 0) return
    items.value = items.value.filter((i) => i.fileBase !== fileBase)
    for (const r of removed) hooks.afterRemove?.(r)
  })

  return {
    items,
    ensureLoaded,
    whenReady,
    reload,
    get,
    add,
    update,
    setEnabled,
    updateExtra,
    applyStoreUpdate,
    recordStoreBaseline,
    remove,
    link,
    unlink,
    purgeAccount,
  }
}
