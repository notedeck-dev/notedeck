// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Connection } from '@/bindings'
import { useAiConfig } from '@/composables/useAiConfig'
import { i18n } from '@/i18n'
import AiConnectionSection from './AiConnectionSection.vue'

/**
 * 接続ピッカーの下に出す案内 (#1329): 「接続がありません」は AI プロバイダー接続が
 * 1 つも無いときだけ。選んだ接続がローカルなら「推論はこの端末の中」の案内。
 * #880 でローカルの案内を足したとき、`v-else` の掛かり先が「選んだ接続がローカルで
 * ない」になり、接続があっても「ありません」が常に出ていた。
 */

const connections = ref<Connection[]>([])

vi.mock('@/composables/useVault', () => ({
  useVault: () => ({
    connections,
    refresh: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => ({ ok: false })),
  }),
}))

vi.mock('@/composables/useAiHarnesses', async () => {
  const actual = await vi.importActual<
    typeof import('@/composables/useAiHarnesses')
  >('@/composables/useAiHarnesses')
  return {
    ...actual,
    useAiHarnesses: () => ({
      harnesses: ref([]),
      refresh: vi.fn(async () => undefined),
    }),
  }
})

function conn(id: string, local: boolean): Connection {
  return {
    id,
    name: id,
    baseUrl: local ? 'http://127.0.0.1:11434/v1' : 'https://api.example.com',
    authType: 'bearer',
    protocol: 'openai-compat',
    local,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Connection
}

function mountSection() {
  return mount(AiConnectionSection, {
    global: {
      stubs: {
        AiSettingsSection: { template: '<section><slot /></section>' },
      },
    },
  })
}

describe('AiConnectionSection — 接続ピッカーの案内 (#1329)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    connections.value = []
    useAiConfig().config.value.activeConnectionId = ''
  })

  it('AI プロバイダー接続が無いときだけ「接続がありません」を出す', async () => {
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(i18n.ts._aiConnectionSection.noConnections)
  })

  it('接続があって選んでいれば「接続がありません」は出ない', async () => {
    connections.value = [conn('cloud', false)]
    useAiConfig().config.value.activeConnectionId = 'cloud'
    const w = mountSection()
    await flushPromises()
    expect(w.text()).not.toContain(i18n.ts._aiConnectionSection.noConnections)
    expect(w.text()).not.toContain(i18n.ts._aiConnectionSection.localHint)
  })

  it('接続はあるが未選択でも「接続がありません」は出ない', async () => {
    connections.value = [conn('cloud', false)]
    const w = mountSection()
    await flushPromises()
    expect(w.text()).not.toContain(i18n.ts._aiConnectionSection.noConnections)
  })

  it('選んだ接続がローカルなら「推論はこの端末の中」の案内を出す', async () => {
    connections.value = [conn('ollama', true)]
    useAiConfig().config.value.activeConnectionId = 'ollama'
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(i18n.ts._aiConnectionSection.localHint)
    expect(w.text()).not.toContain(i18n.ts._aiConnectionSection.noConnections)
  })
})
