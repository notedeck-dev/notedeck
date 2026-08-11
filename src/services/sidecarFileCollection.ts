import JSON5 from 'json5'

import { injectJson5Id } from '@/services/idFreeze'
import {
  casefold,
  isSlugConforming,
  resolveAvailable,
  slugifyName,
} from '@/services/settingsSlug'

/**
 * 「src + meta サイドカーペアで 1 アイテム」を表すコレクションのファイル
 * 永続化サービス (#782 Phase 2 → #913 で対応表化)。
 *
 * #913 の不変条件:
 * - ファイル basename は ASCII slug (slugify の不動点)。参照はファイル内 ID
 * - ID → 実ファイル名の対応表が唯一の正。実体は各アイテムの runtime-only
 *   フィールド `fileBase` (ファイルへは書かない。localStorage ミラーには同乗)
 * - ID 凍結は常設規則: ID 欠損のメタを読んだらメタファイル完全名を書き戻す
 * - 履歴サイドカー (`<fileBase>.history.json5`) の basename は主ファイルと同一
 *
 * 状態は持たない。reactive state・localStorage・マージ/seed の方針は
 * 引き続き store 側が持ち、ファイル I/O の手続きだけをここへ委譲する。
 * (同一ウィンドウ内の書込交錯を防ぐ直列化キューのみ内部に持つ)
 */

/** 各アイテムが持つ runtime-only のファイル対応フィールド。 */
export interface SidecarItemFile {
  /**
   * 実ファイル基底名 (拡張子 `.is` / `.meta.json5` を除いた部分)。
   * 未割当 (undefined) = まだファイル化されていない。
   * ファイルへは書かない (toFileMeta に含めないこと)。
   */
  fileBase?: string
  /**
   * ソース欠損 (localStorage ミラーにも本文なし) の読取専用アイテム。
   * persist は抑止される (空ソースの書き戻しでコードを恒久喪失させない)。
   */
  readOnly?: boolean
}

export interface SidecarCollectionConfig<T extends SidecarItemFile, M> {
  /** console.warn の識別子 (例: 'plugins') */
  logTag: string
  /** slug が空になったときの種別 fallback ('widget' | 'plugin' | 'query') */
  kindFallback: string
  /** メタ JSON5 内の ID キー名 ('installId' | 'id') */
  idKey: string
  list(): Promise<string[]>
  read(filename: string): Promise<string>
  write(filename: string, content: string): Promise<void>
  remove(filename: string): Promise<void>
  rename(oldFilename: string, newFilename: string): Promise<void>
  idOf(item: T): string
  /** 表示名 (slug の元)。空なら kindFallback に落ちる */
  nameOf(item: T): string
  srcOf(item: T): string
  /** item → meta ファイルに書く projection。fileBase/readOnly を含めないこと */
  toFileMeta(item: T): M
  /** パース済み meta + src → item。呼び出し側の try/catch はサービスが持つ */
  fromFile(meta: M, src: string, metaFile: string): T
  /**
   * localStorage ミラーから同 ID の本文を引く。
   * 「メタあり・ソースなし」のソース再作成 (読込規則) に使う。
   */
  mirrorSrcById?(id: string): string | undefined
  /**
   * 新規割当時に優先するファイル基底名 (ストアインストールの storeId 等)。
   * 規約不適合なら無視して表示名 slug に落ち、占有時は連番 suffix で回避する。
   */
  preferredBase?(item: T): string | undefined
}

const META_SUFFIX = '.meta.json5'
const SRC_SUFFIX = '.is'
const HISTORY_SUFFIX = '.history.json5'
/** ID 凍結の欠損判定に使う上限長。制御文字含有は欠損に含めない (#913) */
const ID_MAX_LENGTH = 256

export interface LoadAllResult<T> {
  items: T[]
  /**
   * ディレクトリに存在した meta ファイル数。`items.length` と別に返すのは
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

/** 規定拡張子を剥がした basename。規定拡張子でなければ null。 */
function stripKnownExt(filename: string): string | null {
  for (const ext of [META_SUFFIX, HISTORY_SUFFIX, SRC_SUFFIX]) {
    if (filename.endsWith(ext)) return filename.slice(0, -ext.length)
  }
  return null
}

export function createSidecarCollection<T extends SidecarItemFile, M>(
  cfg: SidecarCollectionConfig<T, M>,
) {
  // 同一ウィンドウ内の変更系操作を直列化する (空き名探索 → 書込の交錯防止)。
  let chain: Promise<unknown> = Promise.resolve()
  function enqueue<R>(fn: () => Promise<R>): Promise<R> {
    const next = chain.then(fn, fn)
    chain = next.catch(() => undefined)
    return next
  }

  /**
   * 占有集合 (casefold 済み) を構築する。
   * 探索空間 = 種別ディレクトリの実列挙 (規定拡張子の basename。パース不能・
   * スキップ個体・履歴も含む) ∪ 対応表 (各アイテムの fileBase)
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
    const fileSet = new Set(allFiles)
    const metaFiles = allFiles.filter((f) => f.endsWith(META_SUFFIX))

    const items: T[] = []
    const seenIds = new Set<string>()
    for (const metaFile of metaFiles) {
      try {
        const base = metaFile.slice(0, -META_SUFFIX.length)
        let rawMeta = await cfg.read(metaFile)
        let parsed = JSON5.parse(rawMeta) as Record<string, unknown>
        if (!isValidId(parsed[cfg.idKey])) {
          // ID 凍結 (常設規則): 実効値 = メタファイルの完全名を最小変換で注入
          rawMeta = injectJson5Id(rawMeta, cfg.idKey, metaFile)
          await cfg.write(metaFile, rawMeta)
          parsed = JSON5.parse(rawMeta) as Record<string, unknown>
        }
        const id = parsed[cfg.idKey] as string
        if (seenIds.has(id)) {
          console.warn(
            `[${cfg.logTag}] duplicate id "${id}" in ${metaFile} — skipped (file kept)`,
          )
          continue
        }
        seenIds.add(id)

        const srcFile = base + SRC_SUFFIX
        let src = ''
        let readOnly = false
        if (fileSet.has(srcFile)) {
          src = await cfg.read(srcFile)
        } else {
          const mirror = cfg.mirrorSrcById?.(id)
          if (typeof mirror === 'string' && mirror.length > 0) {
            // ミラー本文からソースを再作成して通常読込 (移行 (b) と同じ向き)
            await cfg.write(srcFile, mirror)
            src = mirror
            console.warn(
              `[${cfg.logTag}] ${srcFile} was missing — recreated from mirror`,
            )
          } else {
            // 空ソースは書かない。読取専用で可視化する
            readOnly = true
            console.warn(
              `[${cfg.logTag}] ${srcFile} is missing and no mirror body — read-only`,
            )
          }
        }

        const item = cfg.fromFile(parsed as unknown as M, src, metaFile)
        item.fileBase = base
        if (readOnly) item.readOnly = true
        items.push(item)
      } catch (e) {
        console.warn(`[${cfg.logTag}] failed to parse ${metaFile}:`, e)
      }
    }
    return { items, entryFileCount: metaFiles.length }
  }

  async function persistItemImpl(
    item: T,
    allItems: readonly T[],
  ): Promise<void> {
    if (item.readOnly) {
      console.warn(
        `[${cfg.logTag}] skip persisting read-only item "${cfg.idOf(item)}"`,
      )
      return
    }
    if (item.fileBase === undefined) {
      // 新規割当 (ID を決める操作): ファイル名と ID 集合の両方に対して空きを探す
      const taken = await buildTaken(allItems, {
        excludeItem: item,
        includeIds: true,
      })
      const preferred = cfg.preferredBase?.(item)
      const base =
        preferred !== undefined && isSlugConforming(preferred)
          ? preferred
          : slugifyName(cfg.nameOf(item), cfg.kindFallback)
      item.fileBase = resolveAvailable(base, (c) => taken.has(casefold(c)))
    }
    const base = item.fileBase
    // 書込順は src → meta (メタを存在マーカーとする)
    await cfg.write(base + SRC_SUFFIX, cfg.srcOf(item))
    await cfg.write(
      base + META_SUFFIX,
      JSON5.stringify(cfg.toFileMeta(item), null, 2),
    )
  }

  async function persistAllImpl(
    items: readonly T[],
    allItems: readonly T[],
  ): Promise<void> {
    // 直列実行 (並行だと空き名探索が交錯して同名を二重割当する)
    for (const item of items) {
      await persistItemImpl(item, allItems)
    }
  }

  async function deleteItemFilesImpl(item: T): Promise<void> {
    const base = item.fileBase
    if (base === undefined) return
    // 削除順は meta → src (メタを存在マーカーとする)。履歴サイドカーも削除
    // (残すと同名の新規アイテムが削除済みアイテムの履歴リングを継承する)。
    // remove は missing = no-op 意味論 (settings_store.rs 側)。
    await cfg.remove(base + META_SUFFIX)
    await cfg.remove(base + SRC_SUFFIX)
    await cfg.remove(base + HISTORY_SUFFIX)
  }

  /** src → meta → history の順で rename する。不在は skip (ensure-dest)。 */
  async function renameFileSet(from: string, to: string): Promise<void> {
    const files = new Set(await cfg.list())
    for (const ext of [SRC_SUFFIX, META_SUFFIX, HISTORY_SUFFIX]) {
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
  async function verifyWritten(
    base: string,
    rawSrc: string,
    rawMeta: string,
  ): Promise<boolean> {
    try {
      const [src, meta] = await Promise.all([
        cfg.read(base + SRC_SUFFIX),
        cfg.read(base + META_SUFFIX),
      ])
      return src === rawSrc && meta === rawMeta
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
    const oldMetaFile = oldBase + META_SUFFIX
    const rawMeta = await cfg.read(oldMetaFile)
    const rawSrc = await cfg.read(oldBase + SRC_SUFFIX)
    const parsed = JSON5.parse(rawMeta) as Record<string, unknown>
    // slug の元はファイル内メタの表示名 (欠損なら種別 fallback)
    const displayName = typeof parsed.name === 'string' ? parsed.name : ''
    const candidate = slugifyName(displayName, cfg.kindFallback)
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
      await cfg.write(inter + SRC_SUFFIX, rawSrc)
      await cfg.write(inter + META_SUFFIX, rawMeta)
      if (!(await verifyWritten(inter, rawSrc, rawMeta))) {
        console.warn(`[${cfg.logTag}] migration verify failed for ${inter}`)
        await cfg.remove(inter + META_SUFFIX)
        await cfg.remove(inter + SRC_SUFFIX)
        return
      }
      await cfg.remove(oldMetaFile)
      await cfg.remove(oldBase + SRC_SUFFIX)
      await cfg.rename(inter + SRC_SUFFIX, candidate + SRC_SUFFIX)
      await cfg.rename(inter + META_SUFFIX, candidate + META_SUFFIX)
      item.fileBase = candidate
      return
    }

    let final: string
    if (!isTaken(candidate)) {
      final = candidate
    } else {
      // 達成済み判定: 衝突先 (casefold 一致の実名 meta。自身の旧名は除く) の
      // 内部 ID と内容を照合する
      const files = await cfg.list()
      const occupantMetaFile = files.find(
        (f) =>
          f.endsWith(META_SUFFIX) &&
          f.slice(0, -META_SUFFIX.length) !== oldBase &&
          casefold(f.slice(0, -META_SUFFIX.length)) === casefold(candidate),
      )
      if (occupantMetaFile !== undefined) {
        const occupantBase = occupantMetaFile.slice(0, -META_SUFFIX.length)
        let occupantId: unknown
        let occupantMeta: string | null = null
        try {
          occupantMeta = await cfg.read(occupantMetaFile)
          occupantId = (JSON5.parse(occupantMeta) as Record<string, unknown>)[
            cfg.idKey
          ]
        } catch {
          // パース不能な衝突先は ID 不一致として扱う (単純占有 → suffix)
        }
        if (occupantId === cfg.idOf(item)) {
          let occupantSrc: string | null = null
          try {
            occupantSrc = await cfg.read(occupantBase + SRC_SUFFIX)
          } catch {
            // 衝突先ソース不在 → 内容不一致扱い
          }
          if (occupantMeta === rawMeta && occupantSrc === rawSrc) {
            // 達成済み (クラッシュ残骸の回収): 旧削除のみ再実行
            await cfg.remove(oldMetaFile)
            await cfg.remove(oldBase + SRC_SUFFIX)
            item.fileBase = occupantBase
            return
          }
          // ID 一致・内容不一致 (旧形式バックアップ復元等): 削除せず suffix へ。
          // 重複 ID 警告として可視化し手動解決に委ねる
          console.warn(
            `[${cfg.logTag}] duplicate id "${cfg.idOf(item)}" at ${occupantMetaFile} with different content — kept both`,
          )
        }
      }
      final = resolveAvailable(candidate, isTaken)
    }

    await cfg.write(final + SRC_SUFFIX, rawSrc)
    await cfg.write(final + META_SUFFIX, rawMeta)
    if (!(await verifyWritten(final, rawSrc, rawMeta))) {
      console.warn(`[${cfg.logTag}] migration verify failed for ${final}`)
      await cfg.remove(final + META_SUFFIX)
      await cfg.remove(final + SRC_SUFFIX)
      return
    }
    if (casefold(final) === casefold(oldBase)) {
      // 保険: 旧削除前に新旧が同一ファイルへ解決しないことを確認
      console.warn(
        `[${cfg.logTag}] migration target resolves to the same file as ${oldBase} — old files kept`,
      )
      item.fileBase = final
      return
    }
    await cfg.remove(oldMetaFile)
    await cfg.remove(oldBase + SRC_SUFFIX)
    item.fileBase = final
  }

  /**
   * 移行 (a): 対応表のうち規約外名 (slugify の不動点でない) のアイテムを
   * copy-adopt で正規化する。ソースを欠く readOnly アイテムは据え置き。
   * 冪等 (失敗分は次回起動でリトライされる)。
   */
  async function migrateItemsImpl(items: readonly T[]): Promise<void> {
    for (const item of items) {
      const oldBase = item.fileBase
      if (oldBase === undefined || item.readOnly) continue
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
      if (f.endsWith(META_SUFFIX)) {
        mainBases.add(casefold(f.slice(0, -META_SUFFIX.length)))
      } else if (f.endsWith(SRC_SUFFIX)) {
        mainBases.add(casefold(f.slice(0, -SRC_SUFFIX.length)))
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
    persistAll: (items: readonly T[], allItems: readonly T[]) =>
      enqueue(() => persistAllImpl(items, allItems)),
    deleteItemFiles: (item: T) => enqueue(() => deleteItemFilesImpl(item)),
    renameItemFiles: (item: T, allItems: readonly T[]) =>
      enqueue(() => renameItemFilesImpl(item, allItems)),
    migrateItems: (items: readonly T[]) =>
      enqueue(() => migrateItemsImpl(items)),
    sweepHistory: () => enqueue(sweepHistoryImpl),
  }
}
