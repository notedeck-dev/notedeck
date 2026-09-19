/**
 * petdex 形式のスプライトシート仕様 (#1080)。
 *
 * ペットは `pet.json` + スプライトシート 1 枚。シートは 8 列 × 9 行 (v1) か
 * 8 列 × 11 行 (v2) のグリッドで、行がアニメーション状態に対応する。コマ数と
 * コマごとの表示時間は pet.json に無く描画側が固定表で持つ (petdex desktop の
 * sprite.zig と同じ値)。NoteDeck も同じ表を持てば本家と同じ動きになる。
 * v2 の残り 2 行は「クライアントが自由に使ってよい」予備で、ここでは使わない。
 */

import type { PetHitMask } from '@/bindings'

export const PET_COLUMNS = 8
export const PET_FRAME_WIDTH = 192
export const PET_FRAME_HEIGHT = 208

/** 表示倍率の範囲。既定は元の 3/4 */
export const PET_SCALE_MIN = 0.25
export const PET_SCALE_MAX = 2
export const PET_SCALE_DEFAULT = 0.75

/** 設定値を表示に使える倍率へ丸める (未設定・非数・範囲外の保険) */
export function clampPetScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return PET_SCALE_DEFAULT
  }
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, value))
}

/** 行順 = petdex の定義順 (row 0 = idle … row 8 = review) */
export const PET_STATES = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
] as const
export type PetState = (typeof PET_STATES)[number]

export interface PetFrame {
  /** シート上の列 (0..7) */
  col: number
  durationMs: number
}

function uniform(
  count: number,
  durationMs: number,
  lastMs: number,
): PetFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    col: i,
    durationMs: i === count - 1 ? lastMs : durationMs,
  }))
}

const FRAMES: Record<PetState, PetFrame[]> = {
  idle: [
    { col: 0, durationMs: 280 },
    { col: 1, durationMs: 110 },
    { col: 2, durationMs: 110 },
    { col: 3, durationMs: 140 },
    { col: 4, durationMs: 140 },
    { col: 5, durationMs: 320 },
  ],
  'running-right': uniform(8, 120, 220),
  'running-left': uniform(8, 120, 220),
  waving: uniform(4, 140, 280),
  jumping: uniform(5, 140, 280),
  failed: uniform(8, 140, 240),
  waiting: uniform(6, 150, 260),
  running: uniform(6, 120, 220),
  review: uniform(6, 150, 280),
}

export function petStateRow(state: PetState): number {
  return PET_STATES.indexOf(state)
}

export function petFrames(state: PetState): readonly PetFrame[] {
  return FRAMES[state]
}

/** アニメ 1 周の長さ (一発ものの表示時間に使う) */
export function petCycleMs(state: PetState): number {
  return FRAMES[state].reduce((sum, f) => sum + f.durationMs, 0)
}

export interface PetAtlasLayout {
  version: 1 | 2
  rows: 9 | 11
  /** 正規寸法 (8×192 幅) に対する倍率。整数境界に乗る縮小だけ許す */
  scale: number
}

/**
 * 画像寸法から対応グリッドを判定する (petdex の sprite-atlas と同じ規則)。
 * 行・列が整数のセル境界に乗らないものは null。
 */
export function detectPetAtlas(
  width: number,
  height: number,
): PetAtlasLayout | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }
  const canonicalWidth = PET_COLUMNS * PET_FRAME_WIDTH
  for (const layout of [
    { version: 1 as const, rows: 9 as const },
    { version: 2 as const, rows: 11 as const },
  ]) {
    const canonicalHeight = layout.rows * PET_FRAME_HEIGHT
    if (width % PET_COLUMNS !== 0 || height % layout.rows !== 0) continue
    if (width * canonicalHeight !== height * canonicalWidth) continue
    return { ...layout, scale: width / canonicalWidth }
  }
  return null
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * ユーザー入力 (slug / petdex.dev のペット URL / petdex:// リンク) から slug を
 * 取り出す。形に合わなければ null。
 */
export function parsePetSlugInput(input: string): string | null {
  const text = input.trim().toLowerCase()
  if (!text) return null
  if (SLUG_RE.test(text)) return text
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol === 'petdex:') {
    const slug = url.hostname || url.pathname.replace(/^\/+/, '')
    return SLUG_RE.test(slug) ? slug : null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname !== 'petdex.dev' && url.hostname !== 'www.petdex.dev') {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('pets')
  const slug = idx >= 0 ? parts[idx + 1] : undefined
  return slug && SLUG_RE.test(slug) ? slug : null
}

function px(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * 当たり判定マスク (Rust `pet_store::hit_mask`、状態ごとのブロックのラン) を
 * 表示寸法に合わせた `clip-path: path()` にする。ブロックは透明側にしか
 * 膨らんでいないので、描かれる画素は切れない。ランが無い行は null (= 矩形)
 */
export function petHitClipPath(
  mask: PetHitMask,
  row: number,
  cellW: number,
  cellH: number,
): string | null {
  const runs = mask.runs[row]
  if (!runs) return null
  // 行に絵が無い = 触れる場所も無い。null (= 矩形に戻す) と区別する
  if (runs.length === 0) return 'inset(50%)'
  const bw = cellW / mask.cols
  const bh = cellH / mask.rows
  let d = ''
  for (let i = 0; i + 2 < runs.length; i += 3) {
    const y = runs[i] as number
    const x = runs[i + 1] as number
    const w = runs[i + 2] as number
    d += `M${px(x * bw)} ${px(y * bh)}h${px(w * bw)}v${px(bh)}h${px(-w * bw)}z`
  }
  return `path("${d}")`
}
