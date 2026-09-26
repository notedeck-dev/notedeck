import type { SystemState } from '@/bindings'
import { i18n } from '@/i18n'

/**
 * OS の状態 (#931 電源 / #935 従量制回線 / #928 集中モード) とウィンドウの
 * 状態 (#986 background) から「何を落とすか」を決める純ロジック。観測は
 * Rust (`system_state.rs`) と `useAppBackground` が担い、ここは判断だけ。
 *
 * - 取れない項目 (null) は「非対応 = 通常どおり」。代替トグルは作らない
 * - 電源・回線・ウィンドウへの適応は `system.autoAdapt` (既定 ON) 1 つで全体を切る
 * - 集中モードで通知音を止めるのは設定に依らない (#928)。OS が静かにしろと
 *   言っているなら黙るだけで、ユーザーに選ばせる余地を作らない
 */
export interface Adaptation {
  /** 画像の先読みを止める (バッテリー / 省電力 / 従量制) */
  suppressPrefetch: boolean
  /** アニメーション絵文字を 1 フレーム目で止める (バッテリー / 省電力) */
  staticEmoji: boolean
  /** 添付画像・動画を自動で読まず、タップで読み込む (従量制) */
  deferMedia: boolean
  /** 自前再生の通知音を鳴らさない (集中モード) */
  muteSounds: boolean
  /**
   * タイムラインのストリーム購読を warm に落とす (ウィンドウが隠れている)。
   * WS 接続と main チャネル (OS 通知の経路) は維持し、復帰は既存の gap 検知で埋める
   */
  suspendStreams: boolean
}

export const NO_ADAPTATION: Adaptation = {
  suppressPrefetch: false,
  staticEmoji: false,
  deferMedia: false,
  muteSounds: false,
  suspendStreams: false,
}

export function deriveAdaptation(
  state: SystemState,
  autoAdapt: boolean,
  background = false,
): Adaptation {
  const powerSaving =
    autoAdapt && (state.onBattery === true || state.lowPowerMode === true)
  const metered = autoAdapt && state.metered === true
  return {
    suppressPrefetch: powerSaving || metered,
    staticEmoji: powerSaving,
    deferMedia: metered,
    muteSounds: state.doNotDisturb === true,
    suspendStreams: autoAdapt && background,
  }
}

/**
 * 適応が「効き始めた」ときにユーザーへ伝える文言。自動で落ちたことに気付けないと
 * 不具合に見える (#931) ので、入るときだけ知らせ、抜けるときは黙る。
 * 集中モードは OS 側で既にユーザーが選んだ状態なので何も言わない。
 */
export function describeAdaptationEntry(
  prev: Adaptation,
  next: Adaptation,
  state: SystemState,
): string | null {
  if (!prev.deferMedia && next.deferMedia) {
    return i18n.ts._systemAdaptation.meteredDeferMedia
  }
  if (!prev.staticEmoji && next.staticEmoji) {
    return state.lowPowerMode === true
      ? i18n.ts._systemAdaptation.lowPowerStaticEmoji
      : i18n.ts._systemAdaptation.batteryStaticEmoji
  }
  return null
}
