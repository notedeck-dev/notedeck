/**
 * 動画・音声プレイヤーの時刻表示 (#1214)。
 *
 * 本家 MkMediaVideo / MkMediaAudio の hms と同じく 1 時間未満は分:秒、
 * 以上は時:分:秒。メタデータを読む前の duration は NaN、ライブ配信は
 * Infinity になるので、どちらも 0:00 に倒す。
 */
export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 再生速度の選択肢。本家のメニューと同じ並び */
export const MEDIA_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const
