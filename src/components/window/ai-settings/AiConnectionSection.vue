<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { HarnessInfo } from '@/bindings'
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
const badgeLabel = computed(() => {
  if (currentConnection.value) return currentConnection.value.name
  if (current.value?.kind === 'harness') {
    return currentHarness.value?.name ?? current.value.connectionId
  }
  return i18n.ts._aiConnectionSection.notSelected
})
const badgeOk = computed(
  () =>
    !!currentConnection.value ||
    (current.value?.kind === 'harness' && !!currentHarness.value?.available),
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
    :badge="badgeLabel"
    :badge-icon="badgeOk ? 'ti-shield-check' : 'ti-shield-off'"
    :badge-ok="badgeOk"
  >
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      {{ i18n.ts._aiConnectionSection.keyHint }}
    </div>
    <div v-if="aiConnections.length > 0" :class="$style.grid">
      <button
        v-for="conn in aiConnections"
        :key="conn.id"
        class="_button"
        :class="[$style.card, { [$style.cardActive]: config.activeConnectionId === conn.id }]"
        :aria-pressed="config.activeConnectionId === conn.id"
        :title="conn.baseUrl"
        @click="selectConnection(conn.id)"
      >
        <span
          v-if="config.activeConnectionId === conn.id"
          :class="$style.activeBadge"
        >
          <i class="ti ti-circle-check-filled" />
        </span>
        <img
          v-if="faviconUrl(conn.baseUrl) && !failedIcons.has(conn.id)"
          :src="faviconUrl(conn.baseUrl)!"
          :class="$style.logo"
          alt=""
          @error="failedIcons.add(conn.id)"
        />
        <i v-else class="ti ti-plug-connected" :class="$style.logoFallback" />
        <span>{{ conn.name }}</span>
      </button>
    </div>
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

    <!-- 手元の CLI (#1104)。API キーの代わりに、ログイン済みの CLI を ACP で借りる -->
    <div :class="$style.subTitle">
      <i class="ti ti-terminal-2" />
      {{ i18n.ts._aiConnectionSection.harnessTitle }}
    </div>
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      {{ i18n.ts._aiConnectionSection.harnessHint }}
    </div>
    <div :class="$style.grid">
      <!-- 見つかったかどうかはボタンの外 (下) に添える。カード本体は接続カードと同じ形 -->
      <div v-for="h in harnesses.harnesses.value" :key="h.id" :class="$style.cell">
        <button
          class="_button"
          :class="[
            $style.card,
            {
              [$style.cardActive]: config.activeConnectionId === harnessConnectionId(h),
              [$style.cardUnavailable]: !h.available,
              [$style.cardBlocked]: h.blocked,
            },
          ]"
          :disabled="h.blocked"
          :aria-pressed="config.activeConnectionId === harnessConnectionId(h)"
          :title="h.blocked ? i18n.ts._aiConnectionSection.harnessBlockedHint : (h.detail ?? [h.command, ...h.args].join(' '))"
          @click="selectHarness(h)"
        >
          <span
            v-if="config.activeConnectionId === harnessConnectionId(h)"
            :class="$style.activeBadge"
          >
            <i class="ti ti-circle-check-filled" />
          </span>
          <img
            v-if="harnessIconUrl(h)"
            :src="harnessIconUrl(h)!"
            :class="$style.logo"
            alt=""
            @error="failedIcons.add(harnessConnectionId(h))"
          />
          <i v-else class="ti ti-terminal-2" :class="$style.logoFallback" />
          <span>{{ h.name }}</span>
        </button>
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
    </div>
    <div v-if="currentHarness && !currentHarness.available" :class="$style.connEmpty">
      <i class="ti ti-alert-triangle" />
      <span>{{ currentHarness.blocked ? i18n.ts._aiConnectionSection.harnessBlockedHint : currentHarness.detail }}</span>
    </div>
    <!-- 選んだときだけ出す一文。カードには載せない -->
    <div v-else-if="currentHarness && RELAY_HARNESSES.has(currentHarness.id)" :class="$style.connEmpty">
      <i class="ti ti-info-circle" />
      <span>{{ i18n.ts._aiConnectionSection.harnessRelayNote }}</span>
    </div>
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

.subTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  font-size: 0.8em;
  font-weight: 600;
  color: var(--nd-fg);
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
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

// `_button` と特異度が同点だと WebView2 で display: inline-block に負けるため (0,2,0) に上げる
.card.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8em;
  cursor: pointer;
  text-align: center;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
}

// 選択中の接続。ConnectionsContent には無い状態なのでアクセントで示す
.cardActive.cardActive {
  background: color-mix(in srgb, var(--nd-accent) 12%, var(--nd-buttonBg));
  box-shadow: inset 0 0 0 1px var(--nd-accent);
}

.activeBadge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  color: var(--nd-accent);

  i {
    font-size: 12px;
  }
}

.logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.logoFallback {
  font-size: 22px;
  color: var(--nd-fgMuted);
}

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
