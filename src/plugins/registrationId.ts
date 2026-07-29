/**
 * プラグイン登録アイテムの同一性 (#794 未決事項 2)。
 *
 * 永続化されたデッキ構成やナビバー構成は「どのプラグインの、どの登録物か」を
 * 参照する。`installId` は再インストールで変わるので、そのまま参照すると
 * アカウント内部 UUID 再生成と同型の「再インストールで無言に腐る」罠になる。
 *
 * ID は `<provider>:<localName>` の 2 段構成:
 *   - provider  = プラグインの安定キー
 *   - localName = プラグインが自分で付ける名前 (プラグイン内で一意)
 */

const BUILTIN_PREFIX = 'nd'
const SEPARATOR = ':'

export interface ProviderSource {
  installId: string
  /** MisStore 由来の追跡 ID */
  storeId?: string
}

/**
 * プラグインの安定キー。
 *
 * 配布物 (MisStore 経由) は再インストールしても `storeId` で同一性が保たれる。
 * ローカル自作は `local:<installId>` になり、再インストールすると別物になる —
 * これは意図した挙動で、手元で作り直したものを黙って同一視しない方が安全。
 */
export function pluginProviderKey(source: ProviderSource): string {
  return source.storeId ?? `local${SEPARATOR}${source.installId}`
}

/**
 * 登録 ID を組む。
 *
 * @throws 予約接頭辞を名乗った場合、localName が空 or 区切り文字を含む場合
 */
export function registrationId(
  source: ProviderSource,
  localName: string,
): string {
  return makeRegistrationId(pluginProviderKey(source), localName)
}

/**
 * 安定キーを既に持っている呼び出し側 (AiScript env など) 向け。
 *
 * @throws 予約接頭辞を名乗った場合、localName が空 or 区切り文字を含む場合
 */
export function makeRegistrationId(
  provider: string,
  localName: string,
): string {
  if (
    provider === BUILTIN_PREFIX ||
    provider.startsWith(`${BUILTIN_PREFIX}${SEPARATOR}`)
  ) {
    throw new Error(`provider "${provider}" is reserved by NoteDeck`)
  }
  if (!localName) {
    throw new Error('registration name must not be empty')
  }
  if (localName.includes(SEPARATOR)) {
    throw new Error(
      `registration name "${localName}" must not contain "${SEPARATOR}"`,
    )
  }
  return `${provider}${SEPARATOR}${localName}`
}

/**
 * 登録 ID を分解する。組込種別のような 2 段でない ID は null。
 *
 * provider 側は `local:<installId>` のように区切り文字を含みうるので、
 * 最後の区切りで割る。
 */
export function parseRegistrationId(
  id: string,
): { provider: string; localName: string } | null {
  const idx = id.lastIndexOf(SEPARATOR)
  if (idx <= 0 || idx === id.length - 1) return null
  return { provider: id.slice(0, idx), localName: id.slice(idx + 1) }
}

/**
 * 実行文脈の principal から provider を導く。
 *
 * プラグイン / ウィジェット / Play / ページはいずれも `{ kind: 'plugin' }` を
 * 名乗り、`pluginId` に `widget:<id>` / `play:<id>` 等の出自つき ID を持つ。
 * MisStore 配布物は storeId が渡るのでそちらを優先する (再インストールを跨いで
 * 同一性が保たれる)。
 */
export function providerFromPrincipal(
  principal: { kind: string; pluginId?: string },
  storeId?: string,
): string {
  if (storeId) return storeId
  if (principal.kind === 'plugin' && principal.pluginId) {
    return `local${SEPARATOR}${principal.pluginId}`
  }
  // 本人がその場で書いて実行するコード (スクラッチパッド等)
  return `local${SEPARATOR}user`
}
