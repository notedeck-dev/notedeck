/**
 * AI の活動をペットの状態 1 つに畳む純ロジック (#1080)。
 *
 * 複数の AI カラム / HEARTBEAT / タスクが同時に動くので、発生源ごとに
 * 「今何をしているか」を数え、優先順位で 1 つに畳む。一発もの (jumping /
 * waving / failed) は表示時間つきで、恒常状態に割り込む。
 *
 * 優先順位: waiting > 一発もの > running > review > idle
 */
import { type PetState, petCycleMs } from './petSprite'

export type PetSteadyKind = 'waiting' | 'running' | 'review'
export type PetPulseKind = 'jumping' | 'waving' | 'failed'

export type PetActivityCounts = Record<PetSteadyKind, number>

export interface PetPulse {
  state: PetPulseKind
  /** この時刻 (ms) になったら消える */
  until: number
}

/** 一発ものの表示時間 = 本家のアニメ 1 周分 */
export const PET_PULSE_DURATION_MS: Record<PetPulseKind, number> = {
  jumping: petCycleMs('jumping'),
  waving: petCycleMs('waving'),
  failed: petCycleMs('failed'),
}

export function resolvePetState(
  counts: PetActivityCounts,
  pulse: PetPulse | null,
  now: number,
): PetState {
  if (counts.waiting > 0) return 'waiting'
  if (pulse && now < pulse.until) return pulse.state
  if (counts.running > 0) return 'running'
  if (counts.review > 0) return 'review'
  return 'idle'
}

/**
 * 読み取り系だけの capability か。petdex が read / grep / glob を review に
 * するのと同じ発想で、`*.read*` の権限しか要らない (または権限不要の) 実行は
 * review、それ以外は running として見せる。
 */
export function isReadOnlyPermissions(keys: readonly string[]): boolean {
  return keys.every((k) => /\.read(?:[A-Z]|$)/.test(k))
}
