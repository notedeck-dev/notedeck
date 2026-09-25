import { describe, expect, it } from 'vitest'
import {
  SKILLS_BUILTIN_CAPABILITIES,
  skillsCreateCapability,
  skillsInstallCapability,
  skillsListCapability,
  skillsToggleCapability,
  skillsUninstallCapability,
} from './skills'

// 本体 (引数の検査 / 適用後全文 / 確認内容 / staged edit) は notecore
// (crates/notecore/src/capabilities/exec/skills.rs) にあり、そちらの単体テストが
// 持つ。ここは宣言の形 (id / permissions / signature / aiTool) だけ。

describe('skill capabilities — declaration', () => {
  it('skills.list: read permission, aiTool true, cheap', () => {
    expect(skillsListCapability.id).toBe('skills.list')
    expect(skillsListCapability.permissions).toEqual(['skills.read'])
    expect(skillsListCapability.aiTool).toBe(true)
    expect(skillsListCapability.signature?.cheap).toBe(true)
  })

  it('skills.toggle: write permission, no confirm (= 可逆な切替)', () => {
    expect(skillsToggleCapability.id).toBe('skills.toggle')
    expect(skillsToggleCapability.permissions).toEqual(['skills.write'])
    expect(skillsToggleCapability.requiresConfirmation).not.toBe(true)
  })

  it('skills.install: write + network.external, confirmation', () => {
    expect(skillsInstallCapability.permissions).toEqual([
      'skills.write',
      'network.external',
    ])
    expect(typeof skillsInstallCapability.requiresConfirmation).toBe('function')
  })

  it('skills.uninstall: write permission, confirmation', () => {
    expect(skillsUninstallCapability.permissions).toEqual(['skills.write'])
    expect(typeof skillsUninstallCapability.requiresConfirmation).toBe(
      'function',
    )
  })
})

describe('skills.create capability (#726)', () => {
  it('declares skills.write permission, aiTool, confirmation', () => {
    expect(skillsCreateCapability.id).toBe('skills.create')
    expect(skillsCreateCapability.permissions).toEqual(['skills.write'])
    expect(skillsCreateCapability.aiTool).toBe(true)
    expect(typeof skillsCreateCapability.requiresConfirmation).toBe('function')
  })

  it('marks name+body required / mode 等は optional、builtIn/isPersona/id はパラメータに存在しない', () => {
    const params = skillsCreateCapability.signature?.params
    expect(params?.name?.optional).not.toBe(true)
    expect(params?.body?.optional).not.toBe(true)
    expect(params?.mode?.optional).toBe(true)
    expect(params?.triggers?.optional).toBe(true)
    expect(params?.description?.optional).toBe(true)
    expect(params?.cheapCheckCapabilities?.optional).toBe(true)
    // ホワイトリスト: これ以外のパラメータ (builtIn / isPersona / id 等) は
    // 構造的に受け取れない
    expect(Object.keys(params ?? {}).sort()).toEqual([
      'body',
      'cheapCheckCapabilities',
      'description',
      'mode',
      'name',
      'triggers',
    ])
    expect(params?.mode?.enum).toEqual([
      'manual',
      'trigger',
      'always',
      'heartbeat',
    ])
  })
})

describe('SKILLS_BUILTIN_CAPABILITIES', () => {
  it('contains the 10 skill capabilities', () => {
    expect(SKILLS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()).toEqual([
      'skills.append',
      'skills.create',
      'skills.history',
      'skills.install',
      'skills.list',
      'skills.read',
      'skills.replaceSection',
      'skills.revert',
      'skills.toggle',
      'skills.uninstall',
    ])
  })
})
