<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { describeAuthType, useVault } from '@/composables/useVault'
import {
  BUILTIN_TEMPLATES,
  faviconUrl,
  matchTemplateByUrl,
} from '@/data/connectionTemplates'
import { useWindowsStore } from '@/stores/windows'

const vault = useVault()
const windowsStore = useWindowsStore()

const pasteUrl = ref('')
const pasteError = ref('')

// favicon の取得に失敗したロゴのキー集合 (テンプレ id / 接続 id)。
// 失敗したものは tabler icon に fallback する。
const failedIcons = ref(new Set<string>())

const connections = computed(() => vault.connections.value)
const isEmpty = computed(
  () => vault.loaded.value && connections.value.length === 0,
)

onMounted(() => {
  void vault.refresh()
})

/** 接続編集ウィンドウを開く。connectionId 未指定 = 新規作成。 */
function openEdit(props: { connectionId?: string; templateId?: string }) {
  windowsStore.open('connectionEdit', props)
}

/** テンプレートから新規作成。 */
function startFromTemplate(templateId: string) {
  openEdit({ templateId })
}

/** 貼り付けられた URL からテンプレートを推論して新規作成。 */
function startFromUrl() {
  pasteError.value = ''
  const raw = pasteUrl.value.trim()
  if (!raw) return
  const template = matchTemplateByUrl(raw)
  if (template) {
    openEdit({ templateId: template.id })
    pasteUrl.value = ''
    return
  }
  // テンプレ未一致でも、URL が妥当なら手動追加に進める。
  try {
    // host を持つ URL かどうかだけ確認する。
    const u = new URL(raw)
    if (!u.host) throw new Error('no host')
    openEdit({})
    pasteUrl.value = ''
  } catch {
    pasteError.value = 'URL を認識できませんでした。手動で追加してください。'
  }
}

/** AI 開示バッジの種別を返す。 */
function aiBadge(conn: {
  aiVisible?: boolean
  slots?: string[]
}): 'visible' | 'pending' | 'hidden' {
  if (!conn.aiVisible) return 'hidden'
  return (conn.slots?.length ?? 0) > 0 ? 'visible' : 'pending'
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}
</script>

<template>
  <div :class="$style.content">
    <!-- 空状態: テンプレートグリッド + URL ペースト -->
    <div v-if="isEmpty" :class="$style.empty">
      <p :class="$style.emptyTitle">接続したいサービスを選んでください</p>
      <div :class="$style.templateGrid">
        <button
          v-for="tpl in BUILTIN_TEMPLATES"
          :key="tpl.id"
          class="_button"
          :class="$style.templateBtn"
          @click="startFromTemplate(tpl.id)"
        >
          <img
            v-if="faviconUrl(tpl.baseUrl) && !failedIcons.has(tpl.id)"
            :src="faviconUrl(tpl.baseUrl)!"
            :class="$style.logo"
            alt=""
            @error="failedIcons.add(tpl.id)"
          />
          <i v-else class="ti" :class="`ti-${tpl.icon}`" />
          <span>{{ tpl.name }}</span>
        </button>
      </div>

      <div :class="$style.pasteRow">
        <p :class="$style.hint">または接続先の URL を貼り付け:</p>
        <div :class="$style.pasteInputRow">
          <input
            v-model="pasteUrl"
            type="url"
            placeholder="https://..."
            :class="$style.input"
            @keydown.enter="startFromUrl"
          />
          <button class="_button" :class="$style.pasteBtn" @click="startFromUrl">
            次へ
          </button>
        </div>
        <p v-if="pasteError" :class="$style.error">{{ pasteError }}</p>
      </div>

      <button class="_button" :class="$style.manualBtn" @click="openEdit({})">
        <i class="ti ti-plus" />
        手動で追加
      </button>
    </div>

    <!-- 一覧 -->
    <template v-else>
      <button class="_button" :class="$style.addBtn" @click="openEdit({})">
        <i class="ti ti-plus" />
        新しい接続を追加
      </button>

      <div :class="$style.list">
        <button
          v-for="conn in connections"
          :key="conn.id"
          class="_button"
          :class="$style.row"
          @click="openEdit({ connectionId: conn.id })"
        >
          <img
            v-if="faviconUrl(conn.baseUrl) && !failedIcons.has(conn.id)"
            :src="faviconUrl(conn.baseUrl)!"
            :class="$style.rowLogo"
            alt=""
            @error="failedIcons.add(conn.id)"
          />
          <i v-else class="ti ti-plug-connected" :class="$style.rowLogoFallback" />
          <div :class="$style.rowMain">
            <span :class="$style.rowName">{{ conn.name }}</span>
            <span :class="$style.rowMeta">
              {{ hostOf(conn.baseUrl) }} · {{ describeAuthType(conn.authType) }}
            </span>
          </div>
          <span
            :class="[$style.aiBadge, $style[`ai_${aiBadge(conn)}`]]"
            :title="
              aiBadge(conn) === 'visible'
                ? 'AI から利用可能'
                : aiBadge(conn) === 'pending'
                  ? 'AI に開示中だが secret 未設定'
                  : 'AI には非開示'
            "
          >
            <i
              class="ti"
              :class="
                aiBadge(conn) === 'hidden' ? 'ti-robot-off' : 'ti-robot'
              "
            />
          </span>
          <i class="ti ti-chevron-right" :class="$style.chevron" />
        </button>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: stretch;
}

.emptyTitle {
  margin: 0;
  text-align: center;
  font-size: 0.95em;
  color: var(--nd-fg);
}

.templateGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.templateBtn {
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

  i {
    font-size: 22px;
    color: var(--nd-fgMuted);
  }
}

.logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.rowLogo {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: 4px;
  flex-shrink: 0;
}

.rowLogoFallback {
  font-size: 18px;
  color: var(--nd-fgMuted);
  flex-shrink: 0;
}

.pasteRow {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pasteInputRow {
  display: flex;
  gap: 6px;
}

.pasteBtn {
  @include btn-action;
  white-space: nowrap;
}

.manualBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.85em;
  cursor: pointer;
}

.addBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.85em;
  cursor: pointer;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panelBg, var(--nd-bgTransparentWeak));
  cursor: pointer;
  text-align: left;
}

.rowMain {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.rowName {
  font-size: 0.9em;
  font-weight: bold;
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowMeta {
  font-size: 0.75em;
  color: var(--nd-fgMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aiBadge {
  display: flex;
  align-items: center;
  font-size: 14px;
}

.ai_visible {
  color: var(--nd-success, var(--nd-link));
}

.ai_pending {
  color: var(--nd-warn, #d99a00);
}

.ai_hidden {
  color: var(--nd-fgMuted);
  opacity: 0.5;
}

.chevron {
  font-size: 14px;
  color: var(--nd-fgMuted);
}

.hint {
  font-size: 0.8em;
  color: var(--nd-fgMuted);
  margin: 0;
}

.input {
  flex: 1;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
}

.error {
  margin: 0;
  font-size: 0.8em;
  color: var(--nd-love);
}
</style>
