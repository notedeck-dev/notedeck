<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { type SkillMode, useSkillsStore } from '@/stores/skills'
import { skillFilename } from '@/utils/settingsFs'

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const lang = markdown()

const props = defineProps<{
  skillId: string
}>()

defineEmits<{
  close: []
}>()

const skillsStore = useSkillsStore()
skillsStore.ensureLoaded()

const skill = computed(() => skillsStore.get(props.skillId))

useWindowExternalFile(() =>
  skill.value ? { name: skillFilename(props.skillId), subdir: 'skills' } : null,
)

const name = ref('')
const description = ref('')
const author = ref('')
const version = ref('')
const mode = ref<SkillMode>('manual')
const isPersona = ref(false)
const body = ref('')

const dirty = ref(false)
const saved = ref(false)
let suppressDirty = true
let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(
  skill,
  (s) => {
    if (!s) return
    suppressDirty = true
    name.value = s.name
    description.value = s.description ?? ''
    author.value = s.author ?? ''
    version.value = s.version
    mode.value = s.mode
    isPersona.value = !!s.isPersona
    body.value = s.body
    dirty.value = false
    suppressDirty = false
  },
  { immediate: true },
)

function scheduleSave() {
  if (suppressDirty) return
  dirty.value = true
  saved.value = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, 500)
}

watch([name, description, author, version, mode, isPersona, body], scheduleSave)

function save() {
  if (!skill.value) return
  skillsStore.update(props.skillId, {
    name: name.value.trim() || skill.value.name,
    description: description.value || undefined,
    author: author.value || undefined,
    version: version.value || skill.value.version,
    mode: mode.value,
    isPersona: isPersona.value,
    body: body.value,
  })
  dirty.value = false
  saved.value = true
  setTimeout(() => {
    saved.value = false
  }, 1500)
}

const isBuiltIn = computed(() => skill.value?.builtIn ?? false)
const isFromStore = computed(() => !!skill.value?.storeId)

const statusText = computed(() => {
  if (saved.value) return '保存しました'
  if (dirty.value) return '編集中...'
  return ''
})
</script>

<template>
  <div :class="$style.content">
    <div v-if="!skill" :class="$style.empty">
      <i class="ti ti-sparkles" />
      <span>スキルが見つかりません</span>
    </div>
    <template v-else>
      <div :class="$style.metaForm">
        <div :class="$style.row">
          <label :class="$style.label">名前</label>
          <input
            v-model="name"
            type="text"
            :class="$style.input"
            placeholder="スキル名"
          />
        </div>
        <div :class="$style.row">
          <label :class="$style.label">説明</label>
          <input
            v-model="description"
            type="text"
            :class="$style.input"
            placeholder="どんな時に使うか"
          />
        </div>
        <div :class="$style.rowGroup">
          <div :class="[$style.row, $style.flex2]">
            <label :class="$style.label">作者</label>
            <input
              v-model="author"
              type="text"
              :class="$style.input"
              placeholder="任意"
            />
          </div>
          <div :class="[$style.row, $style.flex1]">
            <label :class="$style.label">バージョン</label>
            <input
              v-model="version"
              type="text"
              :class="$style.input"
              placeholder="0.1.0"
            />
          </div>
          <div :class="[$style.row, $style.flex1]">
            <label :class="$style.label">モード</label>
            <select v-model="mode" :class="$style.input">
              <option value="always">常時</option>
              <option value="manual">手動</option>
              <option value="trigger">自動</option>
              <option value="heartbeat">HEARTBEAT (定期実行)</option>
            </select>
          </div>
        </div>
        <div v-if="mode === 'heartbeat'" :class="$style.modeHint">
          <i class="ti ti-activity-heartbeat" />
          <span>
            HEARTBEAT 有効時、tick ごとにこの skill body を AI に読ませます
            (#411 / OpenClaw HEARTBEAT.md 相当)。
          </span>
        </div>
        <div :class="$style.row">
          <label :class="$style.label">Persona</label>
          <label :class="$style.toggleRow">
            <input v-model="isPersona" type="checkbox" />
            <span>このスキルを AI セッションの persona 候補にする</span>
          </label>
        </div>
        <div v-if="isPersona" :class="$style.modeHint">
          <i class="ti ti-user-circle" />
          <span>
            ON にすると、AI セッションヘッダの persona セレクタにこのスキルが
            表示されます。選択中のセッションで AI はこの persona として振る舞い、
            memo の作者として記録されます (#491)。
          </span>
        </div>
        <div v-if="isBuiltIn || isFromStore" :class="$style.note">
          <i class="ti ti-info-circle" />
          <span v-if="isBuiltIn">内蔵スキル — 編集内容はローカルファイルに保存されます</span>
          <span v-else>ストア由来のスキル — 編集内容はローカルファイルに保存されます (再インストールで上書きされる可能性あり)</span>
        </div>
      </div>

      <div :class="$style.bodyLabel">
        指示文 (Markdown)
      </div>
      <CodeEditor
        v-model="body"
        :language="lang"
        :class="$style.editor"
        auto-height
      />

      <div v-if="statusText" :class="[$style.status, saved && $style.statusSaved]">
        <i :class="['ti', saved ? 'ti-check' : 'ti-loader-2']" />
        {{ statusText }}
      </div>
    </template>
  </div>
</template>

<style module lang="scss">
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
  min-height: 0;
  overflow-y: auto;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 20px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 13px;
}

.metaForm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.rowGroup {
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
}

.flex1 {
  flex: 1;
  min-width: 90px;
}

.flex2 {
  flex: 2;
  min-width: 140px;
}

.label {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.6;
  letter-spacing: 0.02em;
}

.modeHint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--nd-accent, #f06292);
  background: color-mix(in srgb, var(--nd-accent, #f06292) 8%, transparent);
  border-radius: 3px;
  line-height: 1.4;

  i {
    font-size: 13px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  span {
    color: var(--nd-fg);
    opacity: 0.75;
  }
}

.toggleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--nd-fg);
  cursor: pointer;
  user-select: none;

  input {
    margin: 0;
  }
}

.input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  background: var(--nd-inputBg, var(--nd-bg));
  border: 1px solid var(--nd-divider);
  border-radius: 3px;
  color: var(--nd-fg);
  font-size: 12px;

  &:focus {
    outline: none;
    border-color: var(--nd-accent);
  }
}

.note {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.65;
  background: color-mix(in srgb, var(--nd-fg) 6%, transparent);
  border-radius: 3px;
  line-height: 1.4;
}

.bodyLabel {
  font-size: 11px;
  font-weight: 600;
  color: var(--nd-fg);
  opacity: 0.6;
  letter-spacing: 0.02em;
  margin-top: 4px;
}

.editor {
  border: 1px solid var(--nd-divider);
  border-radius: 3px;
  overflow: hidden;
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.7;
}

.statusSaved {
  color: var(--nd-accent);
  opacity: 1;
}
</style>
