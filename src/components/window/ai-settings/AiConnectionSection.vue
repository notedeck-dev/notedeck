<script setup lang="ts">
import { computed, onMounted } from 'vue'
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
  // OpenAI / Anthropic / OpenRouter を選ぶだけで書き込み無しに動き出せる
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
    default-expanded
  >
    <div :class="$style.keyHint">
      <i class="ti ti-info-circle" />
      API キーは Secret Vault (OS キーチェーン) に保管され、フロントエンドや AI には渡りません。接続の追加・編集は「接続」ウィンドウで行います。
    </div>
    <div :class="$style.connList">
      <label
        v-for="conn in aiConnections"
        :key="conn.id"
        :class="[$style.connOption, { [$style.connOptionActive]: config.activeConnectionId === conn.id }]"
      >
        <input
          type="radio"
          :checked="config.activeConnectionId === conn.id"
          @change="selectConnection(conn.id)"
        />
        <img
          v-if="faviconUrl(conn.baseUrl)"
          :src="faviconUrl(conn.baseUrl) ?? ''"
          :class="$style.connOptionAvatar"
          alt=""
          aria-hidden="true"
        />
        <i v-else class="ti ti-plug" :class="$style.connOptionIcon" />
        <div :class="$style.connOptionMain">
          <div :class="$style.connOptionName">{{ conn.name }}</div>
          <div :class="$style.connOptionDesc">
            {{ conn.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 互換' }}
            · {{ conn.baseUrl }}
          </div>
        </div>
      </label>
      <div v-if="aiConnections.length === 0" :class="$style.connEmpty">
        <i class="ti ti-info-circle" />
        <span>
          AI プロバイダー接続がありません。「接続」ウィンドウで OpenAI / Anthropic / OpenRouter のテンプレートから接続を追加してください。
        </span>
      </div>
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
      placeholder="claude-sonnet-5, gpt-5.4-mini, deepseek/deepseek-v4-pro など"
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

// AiPersonaSection の personaOption と同型の radio 選択リスト
.connList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.connOption {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  input[type='radio'] {
    flex-shrink: 0;
    margin: 0;
  }
}

.connOptionActive {
  background: color-mix(in srgb, var(--nd-accent) 10%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 14%, transparent);
  }
}

.connOptionIcon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--nd-fg);
  opacity: 0.6;
  flex-shrink: 0;
}

// 接続 favicon (ラスタ画像)。persona icon と違い SVG mask は使わずそのまま表示。
.connOptionAvatar {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--nd-radius-sm);
  object-fit: contain;
}

.connOptionMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.connOptionName {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--nd-fg);
}

.connOptionDesc {
  font-size: 0.7em;
  color: var(--nd-fg);
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
