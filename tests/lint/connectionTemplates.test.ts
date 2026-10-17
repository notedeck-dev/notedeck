// 「内蔵接続テンプレは crates/notecore/connection_templates.json5 が正本で、TS / Rust の
// 生成物がそれに一致する」を機械検査に落とす (#1160)。ずれたら `pnpm gen:connection-templates`。

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_TEMPLATES,
  matchTemplateByUrl,
} from '@/data/connectionTemplates'
import {
  GENERATED_RS_PATH,
  GENERATED_TS_PATH,
  generate,
  loadDeclarations,
} from '../../scripts/gen-connection-templates.mjs'

describe('内蔵接続テンプレの宣言 (#1160)', () => {
  const { decls, generatedTs, generatedRs } = generate()

  it('connectionTemplates.generated.ts は宣言ファイルから再生成したものと一致する', () => {
    expect(
      readFileSync(GENERATED_TS_PATH, 'utf8'),
      'connectionTemplates.generated.ts が古い — `pnpm gen:connection-templates` を実行してコミットする',
    ).toBe(generatedTs)
  })

  it('connection_templates.generated.rs は宣言ファイルから再生成したものと一致する', () => {
    expect(
      readFileSync(GENERATED_RS_PATH, 'utf8'),
      'connection_templates.generated.rs が古い — `pnpm gen:connection-templates` を実行してコミットする',
    ).toBe(generatedRs)
  })

  it('TS の一覧は宣言と同じ id を同じ順で持つ', () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual(decls.map((d) => d.id))
  })

  it('i18n のラベルは辞書のキーを引けて空でない', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.secretLabel, t.id).not.toBe('')
      expect(typeof t.secretLabel, t.id).toBe('string')
    }
  })

  it('ホストは複数のテンプレにまたがらない (URL と宛先ホストで一意に引く)', () => {
    const seen = new Map<string, string>()
    for (const d of decls) {
      for (const h of d.allowedHosts) {
        expect(
          seen.get(h),
          `${h} は ${seen.get(h)} と ${d.id} の両方にある`,
        ).toBeUndefined()
        seen.set(h, d.id)
      }
    }
  })

  it('URL ペーストの照合は base URL と同じホストの別パスにも当たる', () => {
    expect(matchTemplateByUrl('https://opencode.ai/zen/v1')?.id).toBe(
      'builtin:opencode-go@1',
    )
    expect(matchTemplateByUrl('https://api.deepl.com/v2')?.id).toBe(
      'builtin:deepl@1',
    )
    expect(matchTemplateByUrl('https://api.opencode.ai/zen/go/v1')).toBeNull()
  })

  it('宣言の検査: 壊れた宣言は読み込みで落ちる', () => {
    const good = JSON.stringify([
      {
        id: 'builtin:x@1',
        name: 'X',
        icon: 'x',
        baseUrl: 'https://api.x.example/v1',
        authType: { kind: 'bearer' },
        allowedHosts: ['api.x.example'],
        testPath: '/me',
        secretLabel: 'Key',
        secretHelpUrl: 'https://x.example',
      },
    ])
    expect(loadDeclarations(good)).toHaveLength(1)
    const broken = (patch: Record<string, unknown>) =>
      JSON.stringify([{ ...JSON.parse(good)[0], ...patch }])
    expect(() =>
      loadDeclarations(broken({ allowedHosts: ['other.example'] })),
    ).toThrow(/baseUrl のホスト/)
    expect(() =>
      loadDeclarations(broken({ allowedHosts: ['API.x.example'] })),
    ).toThrow(/小文字/)
    expect(() => loadDeclarations(broken({ protocol: 'anthropic' }))).toThrow(
      /セット/,
    )
    expect(() =>
      loadDeclarations(broken({ affinityHeader: 'X-Session' })),
    ).toThrow(/affinityHeader/)
    expect(() => loadDeclarations(broken({ extra: 1 }))).toThrow(/未知の項目/)
  })
})
