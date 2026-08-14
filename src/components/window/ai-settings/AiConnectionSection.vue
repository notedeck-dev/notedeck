<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { resolveAiConnection, useAiConfig } from '@/composables/useAiConfig'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES, faviconUrl } from '@/data/connectionTemplates'
import { useWindowsStore } from '@/stores/windows'
import AiSettingsSection from './AiSettingsSection.vue'

const { config } = useAiConfig()
const vault = useVault()
const windowsStore = useWindowsStore()

onMounted(() => {
  void vault.refresh()
})

// favicon の取得に失敗した接続 id。tabler icon に fallback する。
const failedIcons = ref(new Set<string>())

// AI プロバイダーとして使える接続 = protocol が設定済みの接続。
const aiConnections = computed(() =>
  vault.connections.value.filter((c) => c.protocol != null),
)

// 現在選択中の接続 (resolveAiConnection で解決)。未選択 / 不在なら null。
const currentConnection = computed(
  () => resolveAiConnection(config.value, vault.connections.value)?.connection,
)

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
    title="AI 接続"
    :badge="currentConnection ? currentConnection.name : '未選択'"
    :badge-icon="currentConnection ? 'ti-shield-check' : 'ti-shield-off'"
    :badge-ok="!!currentConnection"
  >
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      API キーは Secret Vault (OS キーチェーン) に保管され、フロントエンドや AI には渡りません。接続の追加・編集は「接続」ウィンドウで行います。
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
        AI プロバイダー接続がありません。「接続」ウィンドウのテンプレートから接続を追加してください。
      </span>
    </div>
    <button
      class="_button"
      :class="$style.keyBtn"
      @click="openConnectionsWindow"
    >
      <i class="ti ti-plug" />
      接続を追加 / 管理
    </button>
  </AiSettingsSection>

  <AiSettingsSection v-if="currentConnection" icon="ti-cube" title="モデル">
    <input
      v-model="currentModel"
      :class="$style.input"
      type="text"
      placeholder="claude-sonnet-5, gpt-5.4-mini, moonshotai/kimi-k3 など"
    />
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.keyHint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7em;
  opacity: 0.5;
}

.keyBtn {
  @include btn-secondary;
}

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
