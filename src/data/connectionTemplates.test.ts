import { describe, expect, it } from 'vitest'
import { connectionIconUrl } from '@/data/connectionTemplates'

/**
 * 接続カードのブランドアイコンの導出。
 *
 * 既定は DuckDuckGo の favicon サービスに apex ドメインで引くが、API ホストが
 * サービス本体のドメインと違う (googleapis.com / vrchat.cloud) か、DDG に
 * 登録が無い (chunirec / Shodan) サービスは DDG が仮画像を返す。そういう
 * テンプレは宣言の `iconUrl` でブランドアイコンの URL を直接持ち、同じホストの
 * 接続 (テンプレから作ったもの・手動追加) にもそれを使う。
 */
describe('connectionIconUrl', () => {
  it('テンプレが iconUrl を宣言していれば、同じホストの接続はそれをプロキシ経由で使う', () => {
    const url = connectionIconUrl('https://api.shodan.io')
    expect(url).toContain('/proxy/image?url=')
    expect(url).toContain(
      encodeURIComponent('https://www.shodan.io/static/img/favicon.png'),
    )
    expect(url).not.toContain('duckduckgo')
  })

  it('iconUrl を宣言していないテンプレ / 未知のホストは favicon の導出に倒す', () => {
    expect(connectionIconUrl('https://api.openai.com/v1')).toContain(
      encodeURIComponent('https://icons.duckduckgo.com/ip3/openai.com.ico'),
    )
    expect(connectionIconUrl('https://api.example.com/v1')).toContain(
      encodeURIComponent('https://icons.duckduckgo.com/ip3/example.com.ico'),
    )
  })

  it('URL として壊れていれば null', () => {
    expect(connectionIconUrl('not a url')).toBeNull()
  })
})
