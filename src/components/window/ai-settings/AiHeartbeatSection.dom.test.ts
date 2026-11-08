// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Connection, HeartbeatStatus } from '@/bindings'
import { useAiConfig } from '@/composables/useAiConfig'
import { i18n } from '@/i18n'
import AiHeartbeatSection from './AiHeartbeatSection.vue'

/**
 * HEARTBEAT の「巡回に使う AI」(#1321): チャットが手元の CLI なら「動きません」、選んだ接続が
 * 消えていれば「見つかりません」+ 戻すボタン、モデル / 予算の欄はチャットと違う接続のときだけ
 * (ローカルには予算を出さない)。状態行は outcome の文字列を表示の種別に落とす
 */

const connections = ref<Connection[]>([])
const status = ref<HeartbeatStatus | null>(null)

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
      harnesses: ref([
        {
          id: 'codex',
          name: 'Codex',
          command: 'codex',
          args: [],
          available: true,
          detail: null,
          custom: false,
          homepage: null,
          blocked: false,
        },
      ]),
      refresh: vi.fn(async () => undefined),
    }),
  }
})

vi.mock('@/composables/useHeartbeatStatus', () => ({
  useHeartbeatStatus: () => ({
    status,
    loading: ref(false),
    refresh: vi.fn(async () => undefined),
    triggerNow: vi.fn(async () => undefined),
    probe: vi.fn(async () => ({ outcome: 'ok' })),
  }),
}))

function conn(id: string, local: boolean): Connection {
  return {
    id,
    name: `name-${id}`,
    baseUrl: local ? 'http://127.0.0.1:11434/v1' : 'https://api.example.com',
    authType: 'bearer',
    protocol: 'openai-compat',
    local,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Connection
}

function mountSection() {
  return mount(AiHeartbeatSection, {
    global: {
      stubs: {
        AiSettingsSection: { template: '<section><slot /></section>' },
        AiHeartbeatResidentRow: { template: '<div />' },
        AiModelField: { template: '<div data-test="model-field" />' },
        AiBudgetField: { template: '<div data-test="budget-field" />' },
      },
    },
  })
}

describe('AiHeartbeatSection — 巡回に使う AI (#1321)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    connections.value = [conn('cloud', false), conn('ollama', true)]
    status.value = null
    const cfg = useAiConfig().config.value
    cfg.activeConnectionId = 'cloud'
    cfg.heartbeat.connectionId = ''
    cfg.heartbeat.enabled = false
  })

  it('既定はチャットと同じで、モデル / 予算の欄は出ない', async () => {
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(
      i18n.tsx._aiHeartbeatSection.sameAsChat({ name: 'name-cloud' }),
    )
    expect(w.find('[data-test="model-field"]').exists()).toBe(false)
    expect(w.find('[data-test="budget-field"]').exists()).toBe(false)
    expect(w.text()).toContain(i18n.ts._aiHeartbeatSection.disclosure)
    // 有効でなくても「巡回に使う AI」は出る
    expect(w.text()).toContain(i18n.ts._aiHeartbeatSection.provider)
  })

  it('チャットが手元の CLI で追従しているなら「動きません」を出す', async () => {
    useAiConfig().config.value.activeConnectionId = 'harness:codex'
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(i18n.ts._aiHeartbeatSection.harnessWarning)
  })

  it('別のクラウド接続を選ぶとモデルと予算の欄が出る', async () => {
    useAiConfig().config.value.activeConnectionId = 'ollama'
    useAiConfig().config.value.heartbeat.connectionId = 'cloud'
    const w = mountSection()
    await flushPromises()
    expect(w.find('[data-test="model-field"]').exists()).toBe(true)
    expect(w.find('[data-test="budget-field"]').exists()).toBe(true)
    // チャットがローカルで巡回がクラウド: 端末の外に出る一文
    expect(w.text()).toContain(
      i18n.ts._aiHeartbeatSection.disclosureLeavesDevice,
    )
  })

  it('ローカル接続を選ぶとモデルの欄は出て予算は出ない', async () => {
    useAiConfig().config.value.heartbeat.connectionId = 'ollama'
    const w = mountSection()
    await flushPromises()
    expect(w.find('[data-test="model-field"]').exists()).toBe(true)
    expect(w.find('[data-test="budget-field"]').exists()).toBe(false)
    expect(w.text()).not.toContain(
      i18n.ts._aiHeartbeatSection.disclosureLeavesDevice,
    )
  })

  it('選んだ接続が消えていれば「見つかりません」と戻すボタンを出し、押すとチャットに戻る', async () => {
    useAiConfig().config.value.heartbeat.connectionId = 'gone'
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(i18n.ts._aiHeartbeatSection.connectionMissing)
    const reset = w
      .findAll('button')
      .find((b) => b.text() === i18n.ts._aiHeartbeatSection.resetToChat)
    expect(reset).toBeTruthy()
    await reset?.trigger('click')
    expect(useAiConfig().config.value.heartbeat.connectionId).toBe('')
  })

  it('状態行は outcome の文字列を表示に落とし、待機の文言は notemaid の手がかりで描く', async () => {
    // JsonValue (再帰型) の欄を含むので、リテラルの直接代入は TS2589 になる。形はここで固定する
    const waiting: HeartbeatStatus = {
      mounted: true,
      running: false,
      lastTickAt: Date.now() - 60_000,
      lastTickSource: 'scheduled',
      lastOutcome: 'skip:unreachable',
      consecutiveFailures: 0,
      dailyCount: 0,
      config: null,
      recentFailures: [],
      provider: null,
      usage: null,
      lastErrorKind: null,
      waiting: {
        kind: 'unreachable',
        since: 1,
        message: 'Waiting (en)',
        i18n: {
          message: {
            key: '_native.heartbeat.waitingUnreachable',
            params: { detail: 'refused' },
          },
        },
      },
      nextTickAt: null,
    } as unknown as HeartbeatStatus
    status.value = waiting
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(
      i18n.tsx._native.heartbeat.waitingUnreachable({ detail: 'refused' }),
    )
    // 失敗ではないので「失敗しました」は出ない
    expect(w.text()).not.toContain('失敗しました')
  })

  it('接続はあるがモデルが未設定なら警告し、試走は押せない', async () => {
    useAiConfig().config.value.heartbeat.connectionId = 'ollama'
    useAiConfig().config.value.models = { ollama: '  ' }
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(i18n.ts._aiHeartbeatSection.modelMissing)
    const probe = w
      .findAll('button')
      .find((b) => b.text() === i18n.ts._aiHeartbeatSection.probe)
    expect(probe?.attributes('disabled')).toBeDefined()
    // モデルを入れれば押せる
    useAiConfig().config.value.models = { ollama: 'qwen' }
    await flushPromises()
    expect(w.text()).not.toContain(i18n.ts._aiHeartbeatSection.modelMissing)
    expect(probe?.attributes('disabled')).toBeUndefined()
  })

  it('最初の巡回の前は「未実行」', async () => {
    const w = mountSection()
    await flushPromises()
    expect(w.text()).toContain(i18n.ts._aiHeartbeatSection.lastTickNever)
  })
})
