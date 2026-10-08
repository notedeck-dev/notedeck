import type {
  DistributableCodec,
  DistributableMeta,
  FileContext,
} from '@/services/distributable'
import {
  type Frontmatter,
  type ParsedSkillFile,
  parseSkillFile,
  serializeSkillFile,
} from '@/services/skillFrontmatter'
import type { SkillMode } from '@/stores/skills'

/**
 * skill (`skills/<base>.md`、frontmatter がメタ) の codec (#1202 段階 0)。
 * Rust 側は `crates/notemaid/src/skills.rs` の `meta_from_frontmatter` /
 * `frontmatter_from_meta`。段階 0 では on-disk を変えない。
 *
 * frontmatter (書く順): id, name, version, mode, createdAt, updatedAt,
 * description?, author?, triggers? (空は書かない), active? (true のときだけ),
 * storeId? / storeSha512? / storeVersion?, builtIn? (true のときだけ),
 * iconUrl?, cheapCheckCapabilities? (空は書かない), isPersona? (true のときだけ),
 * tainted? (true のときだけ)
 *
 * 予約 skill (`AGENTS.md` / `HEARTBEAT.md`、#1162) はファイル名で決まり、mode は
 * ファイルが何と言おうと固定 (persona にもならない)
 */
export type SkillFile = ParsedSkillFile

export interface SkillExtra {
  version: string
  author?: string
  mode: SkillMode
  triggers: string[]
  /**
   * 本体の有効 (#1116)。有効のときだけ true (無効は無い)。mode='always' は
   * この印に関係なく常時有効 — 実効の有効は `skillCodec.enabled.get`
   */
  active?: boolean
  /** 旧・内蔵テンプレ由来 (#746 で同梱は廃止。移行判定にだけ使う) */
  builtIn: boolean
  /** HEARTBEAT の cheap check に使う capability id (#411) */
  cheapCheckCapabilities: string[]
  /** persona 候補として扱うか (#491) */
  isPersona: boolean
  /** tainted なセッションが書いた (#1103)。一度付いたら外れない */
  tainted?: boolean
  /** 予約 skill (runtime-only、ファイル名から決まる) */
  reserved?: boolean
}

export type SkillItem = DistributableMeta<string, SkillExtra>

type ReservedKind = 'agents' | 'heartbeat'

/** 予約 skill のファイル名 (拡張子なし) → 種別。大文字小文字は区別する */
function reservedKindOf(fileBase: string): ReservedKind | undefined {
  if (fileBase === 'AGENTS') return 'agents'
  if (fileBase === 'HEARTBEAT') return 'heartbeat'
  return undefined
}

const RESERVED_MODE: Record<ReservedKind, SkillMode> = {
  agents: 'always',
  heartbeat: 'heartbeat',
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v) return [v]
  return []
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

function modeOf(v: unknown): SkillMode {
  return v === 'always' ||
    v === 'trigger' ||
    v === 'heartbeat' ||
    v === 'manual'
    ? v
    : 'manual'
}

function fromFile(file: SkillFile, ctx: FileContext): SkillItem {
  const fm = file.meta
  const fallbackId = ctx.filename.replace(/\.md$/, '')
  const reserved = reservedKindOf(fallbackId)
  const storeId = str(fm.storeId)
  const storeSha512 = str(fm.storeSha512)
  const storeVersion = str(fm.storeVersion)
  return {
    id: str(fm.id) || fallbackId,
    name: str(fm.name) || fallbackId,
    description: str(fm.description),
    iconUrl: str(fm.iconUrl),
    createdAt: num(fm.createdAt) ?? ctx.now,
    updatedAt: num(fm.updatedAt) ?? ctx.now,
    store: storeId
      ? {
          id: storeId,
          ...(storeSha512 ? { sha512: storeSha512 } : {}),
          ...(storeVersion ? { version: storeVersion } : {}),
        }
      : undefined,
    scope: { kind: 'none' },
    content: file.body,
    extra: {
      version: str(fm.version) || '0.1.0',
      author: str(fm.author),
      mode: reserved ? RESERVED_MODE[reserved] : modeOf(fm.mode),
      triggers: asArray(fm.triggers),
      ...(fm.active === true ? { active: true } : {}),
      builtIn: fm.builtIn === true,
      cheapCheckCapabilities: asArray(fm.cheapCheckCapabilities),
      isPersona: reserved ? false : fm.isPersona === true,
      ...(fm.tainted === true ? { tainted: true } : {}),
      ...(reserved ? { reserved: true } : {}),
    },
  }
}

function toFile(item: SkillItem): SkillFile {
  const x = item.extra
  const meta: Frontmatter = {
    id: item.id,
    name: item.name,
    version: x.version,
    mode: x.mode,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
  if (item.description) meta.description = item.description
  if (x.author) meta.author = x.author
  if (x.triggers.length > 0) meta.triggers = x.triggers
  if (x.active) meta.active = true
  if (item.store) {
    meta.storeId = item.store.id
    if (item.store.sha512) meta.storeSha512 = item.store.sha512
    if (item.store.version) meta.storeVersion = item.store.version
  }
  if (x.builtIn) meta.builtIn = true
  if (item.iconUrl) meta.iconUrl = item.iconUrl
  if (x.cheapCheckCapabilities.length > 0) {
    meta.cheapCheckCapabilities = x.cheapCheckCapabilities
  }
  if (x.isPersona) meta.isPersona = true
  if (x.tainted) meta.tainted = true
  return { meta, body: item.content }
}

export const skillCodec: DistributableCodec<SkillFile, SkillItem> = {
  kind: 'skill',
  fromFile,
  toFile,
  encode: (file) => serializeSkillFile(file.meta, file.body),
  decode: (text) => parseSkillFile(text),
  // 段階 0 では on-disk を変えない
  outdated: () => false,
  enabled: {
    // 実効の有効: mode=always は印に関係なく常時有効
    get: (item) => item.extra.mode === 'always' || item.extra.active === true,
    set: (item, enabled) => {
      const { active: _omit, ...rest } = item.extra
      return {
        ...item,
        extra: enabled ? { ...rest, active: true } : rest,
      }
    },
  },
}
