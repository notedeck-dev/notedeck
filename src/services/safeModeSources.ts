/**
 * セーフモード (#794) の判定。起動経路 (CLI 引数 / URL クエリ / localStorage の
 * 保存値) を集めた `SafeModeSources` から有効かどうかを決める純関数。
 * index.html の boot script が同じ規則を inline で持つ (import できないため)
 * ので、ここはその規則の検査可能な写し。読み書き (localStorage / reload) は
 * utils/safeMode。
 */
export interface SafeModeSources {
  /** CLI 引数由来 (Tauri) */
  argFlag: boolean
  /** `location.search` 相当 (ブラウザ / dev サーバー用) */
  search: string
  /** localStorage の保存値 */
  stored: string | null
}

export function resolveSafeMode(sources: SafeModeSources): boolean {
  if (sources.stored === 'true') return true
  if (sources.argFlag) return true
  return new URLSearchParams(sources.search).get('safemode') === 'true'
}
