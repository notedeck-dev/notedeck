<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { HarnessInfo } from '@/bindings'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import { resolveAiConnection, useAiConfig } from '@/composables/useAiConfig'
import {
  harnessConnectionId,
  useAiHarnesses,
} from '@/composables/useAiHarnesses'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES, faviconUrl } from '@/data/connectionTemplates'
import { i18n } from '@/i18n'
import { useWindowsStore } from '@/stores/windows'
import AiSettingsSection from './AiSettingsSection.vue'
import AiSwitchRow from './AiSwitchRow.vue'

const { config } = useAiConfig()
const vault = useVault()
const harnesses = useAiHarnesses()
const windowsStore = useWindowsStore()

onMounted(() => {
  void vault.refresh()
  void harnesses.refresh()
})

// favicon の取得に失敗した接続 id。tabler icon に fallback する。
const failedIcons = ref(new Set<string>())

// AI プロバイダーとして使える接続 = protocol が設定済みの接続。
const aiConnections = computed(() =>
  vault.connections.value.filter((c) => c.protocol != null),
)

// 現在選択中の接続 (resolveAiConnection で解決)。未選択 / 不在なら null。
const current = computed(() =>
  resolveAiConnection(
    config.value,
    vault.connections.value,
    harnesses.harnesses.value,
  ),
)
const currentConnection = computed(() =>
  current.value?.kind === 'vault' ? current.value.connection : null,
)
/** 選択中の手元の CLI (#1104)。一覧未取得なら null */
const currentHarness = computed(() =>
  current.value?.kind === 'harness' ? current.value.harness : null,
)
/** 手元の CLI のアイコン。接続カードと同じく提供元サイトの favicon (無ければ端末アイコン) */
function harnessIconUrl(h: HarnessInfo): string | null {
  if (!h.homepage || failedIcons.value.has(harnessConnectionId(h))) return null
  return faviconUrl(h.homepage)
}

function selectHarness(h: HarnessInfo): void {
  if (h.blocked) return
  config.value.activeConnectionId = harnessConnectionId(h)
}

/** 中で他社のサブスクに繋げる CLI。Claude のサブスクをここ経由で使うのは規約違反 */
const RELAY_HARNESSES = new Set(['opencode', 'hermes'])

// 選択中接続のモデル名。`config.models[connectionId]` に保存する。
const currentModel = computed<string>({
  get: () => {
    const id = config.value.activeConnectionId
    return id ? (config.value.models[id] ?? '') : ''
  },
  set: (value) => {
    const id = config.value.activeConnectionId
    if (id) config.value.models = { ...config.value.models, [id]: value }
  },
})

/** 現在の接続の 1 日の token 予算 (0 = 無制限)。チャットも HEARTBEAT も同じ勘定 (#1133) */
const activeBudget = computed<number>({
  get: () => config.value.budgets[config.value.activeConnectionId] ?? 0,
  set: (v) => {
    const id = config.value.activeConnectionId
    if (!id) return
    const n = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
    const next = { ...config.value.budgets }
    if (n === 0) delete next[id]
    else next[id] = n
    config.value.budgets = next
  },
})

function selectConnection(id: string): void {
  config.value.activeConnectionId = id
  // モデル未設定の接続はテンプレートの defaultModel で初期化する —
  // 内蔵テンプレから作った接続は選ぶだけで書き込み無しに動き出せる
  if (!config.value.models[id]) {
    const conn = vault.connections.value.find((c) => c.id === id)
    const tpl = conn?.templateId
      ? BUILTIN_TEMPLATES.find((t) => t.id === conn.templateId)
      : undefined
    if (tpl?.defaultModel) {
      config.value.models = { ...config.value.models, [id]: tpl.defaultModel }
    }
  }
}

function openConnectionsWindow(): void {
  windowsStore.open('connections')
}
</script>

<template>
  <AiSettingsSection
    icon="ti-plug-connected"
    :title="i18n.ts._aiConnectionSection.title"
    :badge="currentConnection ? currentConnection.name : i18n.ts._aiConnectionSection.notSelected"
    :badge-icon="currentConnection ? 'ti-shield-check' : 'ti-shield-off'"
    :badge-ok="!!currentConnection"
  >
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      {{ i18n.ts._aiConnectionSection.keyHint }}
    </div>
    <ChoiceCardGrid v-if="aiConnections.length > 0">
      <ChoiceCard
        v-for="conn in aiConnections"
        :key="conn.id"
        :label="conn.name"
        :active="config.activeConnectionId === conn.id"
        :title="conn.baseUrl"
        :icon-url="failedIcons.has(conn.id) ? null : faviconUrl(conn.baseUrl)"
        icon="plug-connected"
        @icon-error="failedIcons.add(conn.id)"
        @click="selectConnection(conn.id)"
      />
    </ChoiceCardGrid>
    <div v-else :class="$style.connEmpty">
      <i class="ti ti-info-circle" />
      <span>
        {{ i18n.ts._aiConnectionSection.noConnections }}
      </span>
    </div>
    <button
      class="_button"
      :class="$style.keyBtn"
      @click="openConnectionsWindow"
    >
      <i class="ti ti-plug" />
      {{ i18n.ts._aiConnectionSection.manageConnections }}
    </button>
  </AiSettingsSection>

  <!-- 手元の CLI (#1104)。API キーの代わりに、ログイン済みの CLI を ACP で借りる -->
  <AiSettingsSection
    icon="ti-terminal-2"
    :title="i18n.ts._aiConnectionSection.acpTitle"
    :badge="currentHarness ? currentHarness.name : i18n.ts._aiConnectionSection.notSelected"
    :badge-icon="currentHarness?.available ? 'ti-shield-check' : 'ti-shield-off'"
    :badge-ok="!!currentHarness?.available"
  >
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      {{ i18n.ts._aiConnectionSection.harnessHint }}
    </div>
    <ChoiceCardGrid>
      <!-- 見つかったかどうかはボタンの外 (下) に添える。カード本体は接続カードと同じ形 -->
      <div v-for="h in harnesses.harnesses.value" :key="h.id" :class="$style.cell">
        <ChoiceCard
          :class="{ [$style.cardUnavailable]: !h.available, [$style.cardBlocked]: h.blocked }"
          :label="h.name"
          :active="config.activeConnectionId === harnessConnectionId(h)"
          :disabled="h.blocked"
          :title="h.blocked ? i18n.ts._aiConnectionSection.harnessBlockedHint : (h.detail ?? [h.command, ...h.args].join(' '))"
          :icon-url="harnessIconUrl(h)"
          icon="terminal-2"
          @icon-error="failedIcons.add(harnessConnectionId(h))"
          @click="selectHarness(h)"
        />
        <span :class="[$style.cellState, { [$style.cellStateOk]: h.available }]">
          <i class="ti" :class="h.blocked ? 'ti-ban' : h.available ? 'ti-circle-check' : 'ti-circle-dashed'" />
          {{
            h.blocked
              ? i18n.ts._aiConnectionSection.harnessBlocked
              : h.available
                ? i18n.ts._aiConnectionSection.harnessFound
                : i18n.ts._aiConnectionSection.harnessNotFound
          }}
        </span>
      </div>
    </ChoiceCardGrid>
    <div v-if="currentHarness && !currentHarness.available" :class="$style.connEmpty">
      <i class="ti ti-alert-triangle" />
      <span>{{ currentHarness.blocked ? i18n.ts._aiConnectionSection.harnessBlockedHint : currentHarness.detail }}</span>
    </div>
    <!-- 選んだときだけ出す一文。カードには載せない -->
    <div v-else-if="currentHarness && RELAY_HARNESSES.has(currentHarness.id)" :class="$style.connEmpty">
      <i class="ti ti-info-circle" />
      <span>{{ i18n.ts._aiConnectionSection.harnessRelayNote }}</span>
    </div>
    <!-- あなたについての記憶を CLI にも渡すか (既定は渡さない、#1162) -->
    <template v-if="currentHarness">
      <AiSwitchRow
        :label="i18n.ts._aiConnectionSection.harnessUserMemory"
        :on="config.harnessUserMemory"
        @toggle="config.harnessUserMemory = !config.harnessUserMemory"
      />
      <p :class="$style.fieldHint">{{ i18n.ts._aiConnectionSection.harnessUserMemoryHint }}</p>
    </template>
  </AiSettingsSection>

  <AiSettingsSection v-if="currentConnection" icon="ti-cube" :title="i18n.ts._aiConnectionSection.model">
    <input
      v-model="currentModel"
      :class="$style.input"
      type="text"
      :placeholder="i18n.ts._aiConnectionSection.modelPlaceholder"
    />
    <!-- 接続ごとの 1 日の token 予算 (#1133)。チャットと HEARTBEAT の合計なので接続の面に置く -->
    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiConnectionSection.dailyTokenBudget }}</span>
        <div :class="$style.fieldValue">
          <input
            v-model.number="activeBudget"
            type="number"
            min="0"
            step="1000"
            :class="$style.numberInput"
          />
          <span :class="$style.fieldUnit">{{ i18n.ts._aiConnectionSection.tokensPerDay }}</span>
        </div>
      </div>
      <p :class="$style.fieldHint">{{ i18n.ts._aiConnectionSection.dailyTokenBudgetHint }}</p>
    </div>
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;
@use '@/styles/buttons' as *;

.keyHint {
  @include key-hint;
  align-items: center;
}

.keyBtn {
  @include btn-secondary;
}

.cardUnavailable.cardUnavailable {
  opacity: 0.55;
}

.cardBlocked.cardBlocked {
  opacity: 0.35;
  cursor: not-allowed;
  filter: grayscale(1);
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cellState {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 0.7em;
  color: var(--nd-fgMuted);

  i {
    font-size: 1.2em;
  }
}

.cellStateOk {
  color: var(--nd-accent);
}

.field { @include field; }
.fieldHeader { @include field-header; }
.fieldLabel { @include field-label; }
.fieldValue { @include field-value; }
.fieldHint { @include field-hint; }
.numberInput { @include number-input; }
.fieldUnit { @include field-unit; }

.input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
  font-family: inherit;
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.35;
  }
}

// 「接続」ウィンドウ (ConnectionsContent) のカードグリッドと同じ見た目に揃える
.connEmpty {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 10px;
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.6;
  line-height: 1.5;

  i {
    flex-shrink: 0;
    margin-top: 1px;
  }
}
</style>
