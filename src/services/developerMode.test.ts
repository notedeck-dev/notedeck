import { describe, expect, it } from 'vitest'
import { resolveDeveloperMode } from '@/services/developerMode'

describe('resolveDeveloperMode', () => {
  it('保存済みの値があればそのまま尊重する', () => {
    expect(
      resolveDeveloperMode(false, {
        hasAccounts: true,
        hasDeveloperArtifacts: true,
      }),
    ).toBe(false)
    expect(
      resolveDeveloperMode(true, {
        hasAccounts: false,
        hasDeveloperArtifacts: false,
      }),
    ).toBe(true)
  })

  it('未決定 + アカウントあり = 既存インストールとみなして on', () => {
    expect(
      resolveDeveloperMode(undefined, {
        hasAccounts: true,
        hasDeveloperArtifacts: false,
      }),
    ).toBe(true)
  })

  it('未決定 + 開発者向け設定ファイルあり = 既存インストールとみなして on', () => {
    expect(
      resolveDeveloperMode(undefined, {
        hasAccounts: false,
        hasDeveloperArtifacts: true,
      }),
    ).toBe(true)
  })

  it('未決定 + 痕跡なし = 新規インストールなので off', () => {
    expect(
      resolveDeveloperMode(undefined, {
        hasAccounts: false,
        hasDeveloperArtifacts: false,
      }),
    ).toBe(false)
  })
})
