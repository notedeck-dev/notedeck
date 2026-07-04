<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ApiTokenMeta } from '@/bindings'
import PermissionProfileEditor from '@/components/window/PermissionProfileEditor.vue'
import { useVault } from '@/composables/useVault'
import { presetChipLabel } from '@/permissions/labels'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import {
  AI_INSTRUCTION_KEYS,
  EXTERNAL_READ_FLOOR,
  type PermissionsConfig,
} from '@/permissions/schema'
import { resolveForProfiled, usePermissionsConfig } from '@/permissions/store'
import { useDeckStore } from '@/stores/deck'
import { usePluginsStore } from '@/stores/plugins'
import { useWidgetsStore } from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * 権限ウィンドウ (#712 §8.1)。principal-first — 「誰に」が行、「何を」が
 * 行の中身。ユーザーは説明を読まなくても「行 = 相手」と分かる。
 * 権限の保存先は permissions.json5 (capability から書き換え不能な独立ファイル)。
 */

const { file: permissionsFile, save: savePermissions } = usePermissionsConfig()
const vault = useVault()
const pluginsStore = usePluginsStore()
const widgetsStore = useWidgetsStore()
const windowsStore = useWindowsStore()

onMounted(() => {
  void vault.refresh()
  void pluginsStore.ensureLoaded?.()
  void widgetsStore.ensureLoaded?.()
})

// 編集は PermissionProfileEditor が permissionsFile を直接書くので、
// ここで debounce 保存する (AI 設定と同じパターン)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => savePermissions(), 300)
}

const expanded = ref<ProfiledPrincipalId | null>(null)
function toggleRow(id: ProfiledPrincipalId) {
  expanded.value = expanded.value === id ? null : id
}

function chipFor(id: ProfiledPrincipalId): string {
  const profile: PermissionsConfig = permissionsFile.value.principals[id] ?? {
    preset: 'readonly',
    custom: {} as never,
  }
  return presetChipLabel(profile)
}

// --- 固定キー (変更できない下限 / 上限) の宣言 (#712 §3.7 / §3.8 / §5.3 / §6.1) ---

const INSTRUCTION_RULE = {
  keys: AI_INSTRUCTION_KEYS,
  reason: 'AI への指示チャネルは第三者には開放できません',
  fixedValue: false,
} as const
const TASKS_RULE = {
  keys: ['tasks.run'],
  reason: 'タスクは本人と AI のみが実行できます',
  fixedValue: false,
} as const
const PLUGIN_VAULT_RULE = {
  keys: ['vault.use'],
  reason: 'Secret Vault はプラグインには開示されません',
  fixedValue: false,
} as const
const EXTERNAL_FLOOR_RULE = {
  keys: EXTERNAL_READ_FLOOR,
  reason:
    '共有プロファイルでは Misskey の read は常に許可 — 遮断するにはトークンを失効',
  fixedValue: true,
} as const

const PLUGIN_DISABLED = [INSTRUCTION_RULE, TASKS_RULE, PLUGIN_VAULT_RULE]
const EXTERNAL_DISABLED = [INSTRUCTION_RULE, TASKS_RULE, EXTERNAL_FLOOR_RULE]

// --- 状態依存 chip: vault.use 実効 ON かつ開示接続 0 件 (#712 §6.3) ---

const aiVaultChip = computed(() => {
  void permissionsFile.value
  const vaultUse =
    resolveForProfiled('ai.chat')['vault.use'] ||
    resolveForProfiled('ai.heartbeat')['vault.use']
  if (!vaultUse) return false
  return !vault.connections.value.some((c) => c.exposedTo?.includes('ai'))
})
const externalVaultChip = computed(() => {
  void permissionsFile.value
  if (!resolveForProfiled('external')['vault.use']) return false
  return !vault.connections.value.some((c) => c.exposedTo?.includes('external'))
})

function openConnections() {
  windowsStore.open('connections')
}

// --- plugin 行: blast radius の受動表示 (#712 §8.1) ---

const pluginCount = computed(() => pluginsStore.plugins?.length ?? 0)
const widgetCount = computed(() => widgetsStore.widgets?.length ?? 0)

function openPluginColumn() {
  useDeckStore().toggleSidebarColumn('pluginManager', null)
}

// --- 永続 API トークン (#709 — 外部アプリ行に併設 #712 §8.1) ---
// トークン (= 誰) と権限 (= 何を) が同じ場所にあることが principal 概念を
// 「触ればわかる」にする要。「read を遮断したい」の正解 (トークン失効) が
// chip の指す先すぐ下にある。

const apiTokens = ref<ApiTokenMeta[]>([])
const newTokenName = ref('')
const createdToken = ref<{ name: string; token: string } | null>(null)
const tokenError = ref('')
const copied = ref(false)

async function refreshApiTokens(): Promise<void> {
  try {
    apiTokens.value = await commands.listApiTokens()
  } catch {
    // 非 Tauri (ブラウザ dev) では invoke 不可 — 空のまま
  }
}

async function createToken(): Promise<void> {
  const name = newTokenName.value.trim()
  if (!name) return
  tokenError.value = ''
  try {
    const created = unwrap(await commands.createApiToken(name))
    createdToken.value = { name: created.meta.name, token: created.token }
    newTokenName.value = ''
    await refreshApiTokens()
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e)
  }
}

async function revokeToken(id: string): Promise<void> {
  tokenError.value = ''
  try {
    unwrap(await commands.revokeApiToken(id))
    await refreshApiTokens()
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e)
  }
}

function copyCreatedToken(): void {
  if (!createdToken.value) return
  navigator.clipboard.writeText(createdToken.value.token)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}

function formatTokenDate(t: ApiTokenMeta): string {
  return new Date(t.createdAtMs).toLocaleDateString()
}

onMounted(refreshApiTokens)

const ROWS: readonly {
  id: ProfiledPrincipalId
  icon: string
  label: string
  hint: string
}[] = [
  {
    id: 'ai.chat',
    icon: 'ti-robot',
    label: 'AI チャット',
    hint: 'AI の tool calling (チャット / コマンド / タスク) に許可する操作',
  },
  {
    id: 'ai.heartbeat',
    icon: 'ti-activity',
    label: 'HEARTBEAT',
    hint: '無人で定期実行される AI daemon に許可する操作 (チャットとは独立)',
  },
  {
    id: 'plugin',
    icon: 'ti-puzzle',
    label: 'プラグイン',
    hint: 'AiScript プラグイン / ウィジェット / Play に許可する操作',
  },
  {
    id: 'external',
    icon: 'ti-plug-connected',
    label: '外部アプリ',
    hint: 'HTTP API (永続トークン) 経由の外部アプリに許可する操作',
  },
]

function disabledFor(id: ProfiledPrincipalId) {
  if (id === 'plugin') return PLUGIN_DISABLED
  if (id === 'external') return EXTERNAL_DISABLED
  return undefined
}
</script>

<template>
  <div :class="$style.content" @change="scheduleSave" @click="scheduleSave">
    <div v-for="row in ROWS" :key="row.id" :class="$style.principalRow">
      <button class="_button" :class="$style.rowHeader" @click="toggleRow(row.id)">
        <i :class="'ti ' + row.icon" />
        <span :class="$style.rowLabel">{{ row.label }}</span>
        <span :class="$style.chip">{{ chipFor(row.id) }}</span>
        <span
          v-if="row.id === 'plugin'"
          :class="[$style.chip, $style.chipLink]"
          title="この行の許可が効いている第三者コードの数。クリックでプラグイン管理を開く"
          @click.stop="openPluginColumn"
        >
          対象: プラグイン {{ pluginCount }}・ウィジェット {{ widgetCount }}
        </span>
        <i
          class="ti ti-chevron-down"
          :class="[$style.chevron, { [$style.chevronOpen]: expanded === row.id }]"
        />
      </button>
      <div v-if="expanded === row.id" :class="$style.rowBody">
        <p :class="$style.hint">{{ row.hint }}</p>

        <div
          v-if="(row.id === 'ai.chat' && aiVaultChip) || (row.id === 'external' && externalVaultChip)"
          :class="$style.stateChip"
        >
          <i class="ti ti-info-circle" />
          <span>開示された接続がまだありません —</span>
          <button class="_button" :class="$style.chipAction" @click="openConnections">
            接続一覧を開く
          </button>
        </div>

        <PermissionProfileEditor
          :principal-id="row.id"
          :disabled-keys="disabledFor(row.id)"
        />

        <!-- 外部アプリ行: 永続 API トークン管理を併設 (#712 §8.1) -->
        <div v-if="row.id === 'external'" :class="$style.tokenSection">
          <div :class="$style.tokenSectionLabel">永続 API トークン</div>
          <div :class="$style.hint">
            再起動を跨いで使える名前付きトークン。本体はハッシュのみ保存され、発行時に一度だけ表示されます。
          </div>
          <div v-if="apiTokens.length > 0" :class="$style.tokenList">
            <div v-for="t in apiTokens" :key="t.id" :class="$style.tokenRow">
              <i class="ti ti-key" :class="$style.tokenIcon" />
              <span :class="$style.tokenName">{{ t.name }}</span>
              <span :class="$style.tokenDate">{{ formatTokenDate(t) }}</span>
              <button
                class="_button"
                :class="$style.tokenRevoke"
                title="失効"
                @click="revokeToken(t.id)"
              >
                <i class="ti ti-trash" />
              </button>
            </div>
          </div>
          <div :class="$style.tokenCreateRow">
            <input
              v-model="newTokenName"
              :class="$style.input"
              type="text"
              placeholder="トークン名 (例: Raycast, Claude Cowork)"
              @keydown.enter="createToken"
            />
            <button
              class="_button"
              :class="$style.tokenCreateButton"
              :disabled="!newTokenName.trim()"
              @click="createToken"
            >
              発行
            </button>
          </div>
          <div v-if="createdToken" :class="$style.tokenCreated">
            <div :class="$style.hint">
              <i class="ti ti-alert-triangle" />
              「{{ createdToken.name }}」のトークン — この表示を閉じると再表示できません
            </div>
            <div :class="$style.tokenValueRow">
              <code :class="$style.tokenValue">{{ createdToken.token }}</code>
              <button class="_button" :class="$style.tokenCreateButton" @click="copyCreatedToken">
                <i class="ti ti-copy" />
                {{ copied ? 'コピーしました' : 'コピー' }}
              </button>
            </div>
          </div>
          <div v-if="tokenError" :class="$style.errorMessage">
            <i class="ti ti-alert-triangle" />
            {{ tokenError }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
}

.principalRow {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
}

.rowHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  color: var(--nd-fg);
  font-size: 0.85em;
  text-align: left;

  &:hover { background: var(--nd-buttonHoverBg); }

  > i:first-child { font-size: 16px; flex-shrink: 0; }
}

.rowLabel {
  font-weight: bold;
}

.chip {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
  font-size: 0.8em;
  white-space: nowrap;
}

.chipLink {
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);
  opacity: 0.75;

  &:hover { opacity: 1; }
}

.chevron {
  margin-left: auto;
  opacity: 0.4;
  transition: transform var(--nd-duration-base);
}

.chevronOpen {
  transform: rotate(180deg);
}

.rowBody {
  padding: 4px 12px 12px;
  border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
}

.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 8px;
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.65;
  line-height: 1.4;
}

.stateChip {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 0.78em;
  color: var(--nd-fg);
  opacity: 0.8;
}

.chipAction {
  color: var(--nd-link);
  font-size: 1em;
  text-decoration: underline;
}

.tokenSection {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
}

.tokenSectionLabel {
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-fg);
  margin-bottom: 4px;
}

.tokenList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.tokenRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  font-size: 0.8em;
}

.tokenIcon {
  opacity: 0.6;
}

.tokenName {
  flex: 1;
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tokenDate {
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 0.9em;
}

.tokenRevoke {
  color: var(--nd-love);
  padding: 2px 4px;

  &:hover { opacity: 0.8; }
}

.tokenCreateRow {
  display: flex;
  gap: 6px;
}

.input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
}

.tokenCreateButton {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  font-size: 0.8em;

  &:hover:not(:disabled) { background: var(--nd-buttonHoverBg); }
  &:disabled { opacity: 0.5; }
}

.tokenCreated {
  margin-top: 8px;
}

.tokenValueRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.tokenValue {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-size: 0.75em;
  overflow-x: auto;
  white-space: nowrap;
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--nd-love);
  font-size: 0.78em;
}
</style>
