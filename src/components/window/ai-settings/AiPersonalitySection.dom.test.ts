// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { useWindowsStore } from '@/stores/windows'
import AiPersonalitySection from './AiPersonalitySection.vue'

/**
 * 「ルール」(予約 skill AGENTS.md、#1162) の編集の入口。AGENTS.md は配布物ではなく
 * AI への常設の指示なので、スキルカラムではなく AI 設定の「ペルソナ」から開く。
 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

function agents(body: string): Omit<SkillMeta, 'createdAt' | 'updatedAt'> {
  return {
    id: 'AGENTS',
    name: 'AGENTS',
    fileBase: 'AGENTS',
    version: '1.0.0',
    description: '',
    mode: 'always',
    triggers: [],
    body,
    cheapCheckCapabilities: [],
    reserved: true,
  }
}

function mountSection() {
  return mount(AiPersonalitySection, {
    global: {
      stubs: {
        AiSettingsSection: { template: '<section><slot /></section>' },
      },
    },
  })
}

function rulesCard(wrapper: ReturnType<typeof mountSection>) {
  const card = wrapper.findAll('[data-testid="ai-rules"]').at(0)
  if (!card) throw new Error('rules card not found')
  return card
}

describe('AiPersonalitySection — ルール (AGENTS.md)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('「ルールを編集」を押すと AGENTS.md を無ければ置いて skill エディタで開く', async () => {
    const skills = useSkillsStore()
    const seed = vi.spyOn(skills, 'seedAgents').mockResolvedValue('AGENTS')
    const open = vi.spyOn(useWindowsStore(), 'open')
    const wrapper = mountSection()
    await nextTick()

    const button = rulesCard(wrapper)
      .findAll('button')
      .find((b) => b.text().includes('ルールを編集'))
    expect(button).toBeDefined()
    await button?.trigger('click')
    await flushPromises()

    expect(seed).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('skill-edit', { skillId: 'AGENTS' })
  })

  it('本文が案内のコメントだけ (実質空) なら「まだ何も書かれていません」を出す', async () => {
    useSkillsStore().add(agents('# AGENTS.md\n\n<!-- ここに書く -->'))
    const wrapper = mountSection()
    await nextTick()
    expect(rulesCard(wrapper).text()).toContain('まだ何も書かれていません')
  })

  it('指示が書かれていれば空の案内は出さない', async () => {
    useSkillsStore().add(agents('# AGENTS.md\n\n- 絵文字を使わない'))
    const wrapper = mountSection()
    await nextTick()
    expect(rulesCard(wrapper).text()).not.toContain('まだ何も書かれていません')
  })

  it('AGENTS.md がまだ無いときも空の案内を出す (最初の AI ターンで置かれる前)', async () => {
    const wrapper = mountSection()
    await nextTick()
    expect(rulesCard(wrapper).text()).toContain('まだ何も書かれていません')
  })
})
