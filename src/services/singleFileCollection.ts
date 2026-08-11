import {
  casefold,
  isSlugConforming,
  resolveAvailable,
  slugifyName,
} from '@/services/settingsSlug'

/**
 * 「単一ファイルで 1 アイテム」を表すコレクションのファイル永続化サービス
 * (#913 — テーマ `.ndtheme.json5` / スキル `.md` 共通)。
 * sidecarFileCollection の単一ファイル版で、不変条件は同じ:
 *
 * - ファイル basename は ASCII slug (slugify の不動点)。参照はファイル内 ID
 * - ID → 実ファイル名の対応表が唯一の正。実体は各アイテムの runtime-only
 *   フィールド `fileBase` (ファイルへは書かない。localStorage ミラーには同乗)
 * - ID 凍結は常設規則: ID 欠損のファイルを読んだら種別の実効値を書き戻す
 * - 履歴サイドカー (`<fileBase>.history.json5`) の basename は主ファイルと同一
 *
 * 状態は持たない。reactive state・localStorage・seed の方針は store 側が持ち、
 * ファイル I/O の手続きだけをここへ委譲する。
 * (同一ウィンドウ内の書込交錯を防ぐ直列化キューのみ内部に持つ)
 */

/** 各アイテムが持つ runtime-only のファイル対応フィールド。 */
export interface SingleItemFile {
  /**
   * 実ファイル基底名 (規定拡張子を除いた部分)。
   * 未割当 (undefined) = まだファイル化されていない。
   * ファイルへは書かない (serialize に含めないこと)。
   */
  fileBase?: string
}

export interface SingleFileCollectionConfig<T extends SingleItemFile, P> {
  /** console.warn の識別子 (例: 'theme' | 'skills') */
  logTag: string
  /** slug が空になったときの種別 fallback ('theme' | 'skill') */
  kindFallback: string
  /** 規定複合拡張子 ('.ndtheme.json5' | '.md') */
  ext: string
  list(): Promise<string[]>
  read(filename: string): Promise<string>
  write(filename: string, content: string): Promise<void>
  remove(filename: string): Promise<void>
  rename(oldFilename: string, newFilename: string): Promise<void>
  /** 生内容のパース。throw = パース不能 (読込スキップ・正規化対象外) */
  parse(raw: string): P
  /** パース成功でも採用しない個体 (テーマの props 欠損等)。false = 警告スキップ (凍結もしない) */
  accepts?(parsed: P): boolean
  /** パース結果から生 ID 値 (欠損判定前) を取り出す */
  rawIdOf(parsed: P): unknown
  /** ID 凍結の実効値 (テーマ = `custom-<完全ファイル名>` / スキル = 拡張子なし basename) */
  effectiveIdOf(filename: string, base: string): string
  /** 生内容への最小変換で ID を注入する (idFreeze) */
  injectId(raw: string, id: string): string
  /** パース結果 + 確定 ID → アイテム。fileBase はサービスが付与する */
  fromFile(parsed: P, id: string, filename: string): T
  /** copy-adopt で slug の元にする表示名 (欠損なら '' → kindFallback に落ちる) */
  displayNameOf(parsed: P): string
  idOf(item: T): string
  /** 表示名 (新規割当・リネームの slug の元)。空なら kindFallback に落ちる */
  nameOf(item: T): string
  /** 通常保存経路の再シリアライズ。fileBase を含めないこと */
  serialize(item: T): string
}

const HISTORY_SUFFIX = '.history.json5'
/** ID 凍結の欠損判定に使う上限長。制御文字含有は欠損に含めない (#913) */
const ID_MAX_LENGTH = 256

export interface LoadAllResult<T> {
  items: T[]
  /**
   * ディレクトリに存在した規定拡張子ファイル数。`items.length` と別に返すのは
   * 「全ファイルがパース失敗」(entryFileCount > 0, items 空) と「ファイルなし」
   * (= localStorage → ファイルの片方向移行が必要) を呼び出し側が区別するため。
   */
  entryFileCount: number
}

const encoder = new TextEncoder()

/** ファイル名の辞書順 (UTF-8 バイト順)。OS 依存の列挙順に依存しない。 */
function compareBytes(a: string, b: string): number {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const d = (x[i] as number) - (y[i] as number)
    if (d !== 0) return d
  }
  return x.length - y.length
}

/** ID 凍結の「欠損」判定: キー不在・空・非文字列・上限長超過。 */
function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX_LENGTH
}

export function createSingleFileCollection<T extends SingleItemFile, P>(
  cfg: SingleFileCollectionConfig<T, P>,
) {
  // 同一ウィンドウ内の変更系操作を直列化する (空き名探索 → 書込の交錯防止)。
  let chain: Promise<unknown> = Promise.resolve()
  function enqueue<R>(fn: () => Promise<R>): Promise<R> {
    const next = chain.then(fn, fn)
    chain = next.catch(() => undefined)
    return next
  }

  /** 規定拡張子 or 履歴を剥がした basename。どちらでもなければ null。 */
  function stripKnownExt(filename: string): string | null {
    if (filename.endsWith(HISTORY_SUFFIX)) {
      return filename.slice(0, -HISTORY_SUFFIX.length)
    }
    if (filename.endsWith(cfg.ext)) {
      return filename.slice(0, -cfg.ext.length)
    }
    return null
  }

  /**
   * 占有集合 (casefold 済み) を構築する。
   * 探索空間 = 種別ディレクトリの実列挙 (規定拡張子 + 履歴の basename。
   * パース不能・スキップ個体も含む) ∪ 対応表 (各アイテムの fileBase)
   * ∪ (ID を決める操作では) 種別内 ID 集合。
   * 操作対象アイテム自身 (とその実ファイル) は占有とみなさない。
   */
  async function buildTaken(
    allItems: readonly T[],
    opts: { excludeItem?: T; includeIds: boolean },
  ): Promise<Set<string>> {
    const files = await cfg.list()
    const excludeBase = opts.excludeItem?.fileBase
    const taken = new Set<string>()
    for (const f of files) {
      const base = stripKnownExt(f)
      if (base === null) continue
      if (excludeBase !== undefined && base === excludeBase) continue
      taken.add(casefold(base))
    }
    for (const it of allItems) {
      if (it === opts.excludeItem) continue
      if (it.fileBase !== undefined) taken.add(casefold(it.fileBase))
      if (opts.includeIds) taken.add(casefold(cfg.idOf(it)))
    }
    return taken
  }

  async function loadAllImpl(): Promise<LoadAllResult<T>> {
    const allFiles = (await cfg.list()).slice().sort(compareBytes)
    const mainFiles = allFiles.filter(
      (f) => f.endsWith(cfg.ext) && !f.endsWith(HISTORY_SUFFIX),
    )

    const items: T[] = []
    const seenIds = new Set<string>()
    for (const filename of mainFiles) {
      try {
        const base = filename.slice(0, -cfg.ext.length)
        let raw = await cfg.read(filename)
        let parsed = cfg.parse(raw)
        if (cfg.accepts && !cfg.accepts(parsed)) {
          console.warn(
            `[${cfg.logTag}] ${filename} is not a valid item — skipped (file kept)`,
          )
          continue
        }
        if (!isValidId(cfg.rawIdOf(parsed))) {
          // ID 凍結 (常設規則): 種別の実効値を最小変換で注入して書き戻す
          raw = cfg.injectId(raw, cfg.effectiveIdOf(filename, base))
          await cfg.write(filename, raw)
          parsed = cfg.parse(raw)
        }
        const id = cfg.rawIdOf(parsed) as string
        if (seenIds.has(id)) {
          console.warn(
            `[${cfg.logTag}] duplicate id "${id}" in ${filename} — skipped (file kept)`,
          )
          continue
        }
        seenIds.add(id)

        const item = cfg.fromFile(parsed, id, filename)
        item.fileBase = base
        items.push(item)
      } catch (e) {
        console.warn(`[${cfg.logTag}] failed to parse ${filename}:`, e)
      }
    }
    return { items, entryFileCount: mainFiles.length }
  }

  async function persistItemImpl(
    item: T,
    allItems: readonly T[],
  ): Promise<void> {
    if (item.fileBase === undefined) {
      // 新規割当 (ID を決める操作): ファイル名と ID 集合の両方に対して空きを探す
      const taken = await buildTaken(allItems, {
        excludeItem: item,
        includeIds: true,
      })
      item.fileBase = resolveAvailable(
        slugifyName(cfg.nameOf(item), cfg.kindFallback),
        (c) => taken.has(casefold(c)),
      )
    }
    await cfg.write(item.fileBase + cfg.ext, cfg.serialize(item))
  }

  async function deleteItemFilesImpl(item: T): Promise<void> {
    const base = item.fileBase
    if (base === undefined) return
    // 履歴サイドカーも削除 (残すと同名の新規アイテムが削除済みアイテムの
    // 履歴リングを継承する)。remove は missing = no-op 意味論。
    await cfg.remove(base + cfg.ext)
    await cfg.remove(base + HISTORY_SUFFIX)
  }

  /** 主ファイル → history の順で rename する。不在は skip (ensure-dest)。 */
  async function renameFileSet(from: string, to: string): Promise<void> {
    const files = new Set(await cfg.list())
    for (const ext of [cfg.ext, HISTORY_SUFFIX]) {
      const oldFile = from + ext
      const newFile = to + ext
      if (!files.has(oldFile)) continue
      if (files.has(newFile)) {
        console.warn(
          `[${cfg.logTag}] rename target already exists, skipped: ${newFile}`,
        )
        continue
      }
      await cfg.rename(oldFile, newFile)
    }
  }

  /**
   * 表示名リネームにファイルを追随させる (ID 不変・ファイル名側のみ占有解決)。
   * fileBase 未割当なら no-op (次の persist が割り当てる)。
   */
  async function renameItemFilesImpl(
    item: T,
    allItems: readonly T[],
  ): Promise<void> {
    const oldBase = item.fileBase
    if (oldBase === undefined) return
    const newBase = slugifyName(cfg.nameOf(item), cfg.kindFallback)
    if (newBase === oldBase) return
    const taken = await buildTaken(allItems, {
      excludeItem: item,
      includeIds: false,
    })
    const resolved = resolveAvailable(newBase, (c) => taken.has(casefold(c)))
    if (resolved === oldBase) return
    if (casefold(resolved) === casefold(oldBase)) {
      // 大文字小文字のみ違う自己リネーム: case-insensitive FS では同一ファイル
      // へ解決するため、規定拡張子を維持した slug 中間名経由の 2 段で行う
      const inter = resolveAvailable(
        slugifyName(`${resolved} mv`, cfg.kindFallback),
        (c) => taken.has(casefold(c)) || casefold(c) === casefold(resolved),
      )
      await renameFileSet(oldBase, inter)
      await renameFileSet(inter, resolved)
    } else {
      await renameFileSet(oldBase, resolved)
    }
    item.fileBase = resolved
  }

  /** 読み戻し検証: 書いた内容と一致するか。 */
  async function verifyWritten(base: string, raw: string): Promise<boolean> {
    try {
      return (await cfg.read(base + cfg.ext)) === raw
    } catch {
      return false
    }
  }

  /**
   * 移行 (a): 規約外名 1 アイテムの copy-adopt。
   * 読む → (凍結済みの) 生内容を新 slug 名へ書込 → 検証 → 旧削除。
   */
  async function copyAdoptOne(
    item: T,
    oldBase: string,
    allItems: readonly T[],
  ): Promise<void> {
    const oldFile = oldBase + cfg.ext
    const raw = await cfg.read(oldFile)
    const parsed = cfg.parse(raw)
    // slug の元はファイル内の表示名 (欠損なら種別 fallback)
    const candidate = slugifyName(cfg.displayNameOf(parsed), cfg.kindFallback)
    const taken = await buildTaken(allItems, {
      excludeItem: item,
      includeIds: false,
    })
    const isTaken = (c: string) => taken.has(casefold(c))

    if (!isTaken(candidate) && casefold(candidate) === casefold(oldBase)) {
      // 大文字小文字のみ違い: 中間名経由の 2 段 (copy → 旧削除 → rename)
      const inter = resolveAvailable(
        slugifyName(`${candidate} mv`, cfg.kindFallback),
        (c) => isTaken(c) || casefold(c) === casefold(candidate),
      )
      await cfg.write(inter + cfg.ext, raw)
      if (!(await verifyWritten(inter, raw))) {
        console.warn(`[${cfg.logTag}] migration verify failed for ${inter}`)
        await cfg.remove(inter + cfg.ext)
        return
      }
      await cfg.remove(oldFile)
      await cfg.rename(inter + cfg.ext, candidate + cfg.ext)
      item.fileBase = candidate
      return
    }

    let final: string
    if (!isTaken(candidate)) {
      final = candidate
    } else {
      // 達成済み判定: 衝突先 (casefold 一致の実名。自身の旧名は除く) の
      // 内部 ID と内容を照合する
      const files = await cfg.list()
      const occupantFile = files.find(
        (f) =>
          f.endsWith(cfg.ext) &&
          !f.endsWith(HISTORY_SUFFIX) &&
          f.slice(0, -cfg.ext.length) !== oldBase &&
          casefold(f.slice(0, -cfg.ext.length)) === casefold(candidate),
      )
      if (occupantFile !== undefined) {
        const occupantBase = occupantFile.slice(0, -cfg.ext.length)
        let occupantId: unknown
        let occupantRaw: string | null = null
        try {
          occupantRaw = await cfg.read(occupantFile)
          occupantId = cfg.rawIdOf(cfg.parse(occupantRaw))
        } catch {
          // パース不能な衝突先は ID 不一致として扱う (単純占有 → suffix)
        }
        if (occupantId === cfg.idOf(item)) {
          if (occupantRaw === raw) {
            // 達成済み (クラッシュ残骸の回収): 旧削除のみ再実行
            await cfg.remove(oldFile)
            item.fileBase = occupantBase
            return
          }
          // ID 一致・内容不一致 (旧形式バックアップ復元等): 削除せず suffix へ。
          // 重複 ID 警告として可視化し手動解決に委ねる
          console.warn(
            `[${cfg.logTag}] duplicate id "${cfg.idOf(item)}" at ${occupantFile} with different content — kept both`,
          )
        }
      }
      final = resolveAvailable(candidate, isTaken)
    }

    await cfg.write(final + cfg.ext, raw)
    if (!(await verifyWritten(final, raw))) {
      console.warn(`[${cfg.logTag}] migration verify failed for ${final}`)
      await cfg.remove(final + cfg.ext)
      return
    }
    if (casefold(final) === casefold(oldBase)) {
      // 保険: 旧削除前に新旧が同一ファイルへ解決しないことを確認
      console.warn(
        `[${cfg.logTag}] migration target resolves to the same file as ${oldBase} — old file kept`,
      )
      item.fileBase = final
      return
    }
    await cfg.remove(oldFile)
    item.fileBase = final
  }

  /**
   * 移行 (a): 対応表のうち規約外名 (slugify の不動点でない) のアイテムを
   * copy-adopt で正規化する。冪等 (失敗分は次回起動でリトライされる)。
   */
  async function migrateItemsImpl(items: readonly T[]): Promise<void> {
    for (const item of items) {
      const oldBase = item.fileBase
      if (oldBase === undefined) continue
      if (isSlugConforming(oldBase)) continue
      try {
        await copyAdoptOne(item, oldBase, items)
      } catch (e) {
        console.warn(`[${cfg.logTag}] migration failed for ${oldBase}:`, e)
      }
    }
  }

  /**
   * 履歴 sweep: sweep 時点のディレクトリ実列挙に存在する規定拡張子付き
   * 全主ファイル (読込採否を問わない) の basename 集合と casefold で照合し、
   * 対応の取れない `.history.json5` を削除する。
   */
  async function sweepHistoryImpl(): Promise<void> {
    const files = await cfg.list()
    const mainBases = new Set<string>()
    for (const f of files) {
      if (f.endsWith(HISTORY_SUFFIX)) continue
      if (f.endsWith(cfg.ext)) {
        mainBases.add(casefold(f.slice(0, -cfg.ext.length)))
      }
    }
    for (const f of files) {
      if (!f.endsWith(HISTORY_SUFFIX)) continue
      const base = casefold(f.slice(0, -HISTORY_SUFFIX.length))
      if (!mainBases.has(base)) {
        await cfg.remove(f)
      }
    }
  }

  return {
    loadAll: () => enqueue(loadAllImpl),
    persistItem: (item: T, allItems: readonly T[]) =>
      enqueue(() => persistItemImpl(item, allItems)),
    deleteItemFiles: (item: T) => enqueue(() => deleteItemFilesImpl(item)),
    renameItemFiles: (item: T, allItems: readonly T[]) =>
      enqueue(() => renameItemFilesImpl(item, allItems)),
    migrateItems: (items: readonly T[]) =>
      enqueue(() => migrateItemsImpl(items)),
    sweepHistory: () => enqueue(sweepHistoryImpl),
  }
}
