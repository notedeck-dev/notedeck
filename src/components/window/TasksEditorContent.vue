<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { type Diagnostic, linter } from '@codemirror/lint'
import JSON5 from 'json5'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import defaultTasksJson5 from '@/defaults/tasks.json5?raw'
import { useTasksStore } from '@/stores/tasks'
import { useToast } from '@/stores/toast'
import { parseTasks, TasksParseError } from '@/tasks/schema'
import {
  TASKS_FILE_VERSION,
  type TaskDefinition,
  type TaskInput,
  type TaskPresentation,
} from '@/tasks/types'
import { isTauri, readTasks, writeTasks } from '@/utils/settingsFs'

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const props = defineProps<{
  initialTab?: string
}>()

const lang = jsonLang()

const tasksLinter = linter(
  (view) => {
    const diagnostics: Diagnostic[] = []
    const src = view.state.doc.toString()
    if (!src.trim()) return diagnostics
    try {
      parseTasks(src)
    } catch (e) {
      if (e instanceof TasksParseError) {
        diagnostics.push({
          from: 0,
          to: src.length,
          severity: 'error',
          message: e.message,
        })
      }
    }
    return diagnostics
  },
  { delay: 400 },
)

const tasksStore = useTasksStore()

// ── Tab management ──
const { tab, containerRef: contentRef } = useEditorTabs(
  ['visual', 'code'] as const,
  (props.initialTab as 'visual' | 'code') ?? 'visual',
)

useWindowExternalFile(() =>
  tab.value === 'code' ? { name: 'tasks.json5' } : null,
)

// ── State ──
const code = ref('')
const codeError = ref<string | null>(null)
const visualTasks = ref<TaskDefinition[]>([])
const expanded = reactive<Record<string, boolean>>({})
const loaded = ref(false)
const saving = ref(false)
let suppressSync = false

function tasksToJson(tasks: TaskDefinition[]): string {
  return JSON5.stringify({ version: TASKS_FILE_VERSION, tasks }, null, 2)
}

function syncVisualFromCode(): boolean {
  try {
    const parsed = parseTasks(code.value)
    suppressSync = true
    visualTasks.value = parsed.tasks
    nextTick(() => {
      suppressSync = false
    })
    codeError.value = null
    return true
  } catch (e) {
    codeError.value = e instanceof TasksParseError ? e.message : String(e)
    return false
  }
}

onMounted(async () => {
  const initial = isTauri
    ? await readTasks().catch((e) => {
        useToast().show(
          `tasks.json5 読込失敗: ${(e as Error).message}`,
          'error',
        )
        return ''
      })
    : ''
  code.value = initial || defaultTasksJson5
  syncVisualFromCode()
  loaded.value = true
})

// ── Code → Visual: live validation ──
let validateTimer: ReturnType<typeof setTimeout> | null = null
watch(code, (v) => {
  if (validateTimer) clearTimeout(validateTimer)
  validateTimer = setTimeout(() => {
    if (!v.trim()) {
      codeError.value = null
      return
    }
    try {
      parseTasks(v)
      codeError.value = null
    } catch (e) {
      codeError.value = e instanceof TasksParseError ? e.message : String(e)
    }
  }, 400)
})

// ── Visual → Code + persist (debounced) ──
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  visualTasks,
  (v) => {
    if (suppressSync || !loaded.value) return
    const next = tasksToJson(v)
    if (next !== code.value) code.value = next
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void persist()
    }, 600)
  },
  { deep: true },
)

async function persist() {
  if (codeError.value) return
  saving.value = true
  try {
    if (isTauri) await writeTasks(code.value)
    tasksStore.setFromRaw(code.value)
  } catch (e) {
    useToast().show(`保存失敗: ${(e as Error).message}`, 'error')
  } finally {
    saving.value = false
  }
}

const taskCount = computed(() => visualTasks.value.length)

// ── Visual edit helpers ──
function uniqueId(base: string): string {
  const ids = new Set(visualTasks.value.map((t) => t.id))
  if (!ids.has(base)) return base
  let i = 2
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function addTask() {
  const id = uniqueId('new-task')
  visualTasks.value.push({
    id,
    label: '新しいタスク',
    action: { type: 'api', method: 'i' },
  })
  expanded[id] = true
}

function removeTask(index: number) {
  const t = visualTasks.value[index]
  if (!t) return
  visualTasks.value.splice(index, 1)
  delete expanded[t.id]
}

const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'task-idx',
  onReorder(fromIdx, toIdx) {
    const arr = [...visualTasks.value]
    const [moved] = arr.splice(fromIdx, 1)
    if (moved) {
      arr.splice(toIdx, 0, moved)
      visualTasks.value = arr
    }
  },
})

function toggleExpanded(id: string) {
  expanded[id] = !expanded[id]
}

function paramsToText(t: TaskDefinition): string {
  return t.action.params ? JSON5.stringify(t.action.params, null, 2) : ''
}

function setParamsFromText(t: TaskDefinition, text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    delete t.action.params
    return
  }
  try {
    const parsed = JSON5.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      t.action.params = parsed as Record<string, unknown>
    }
  } catch {
    /* ignore parse error during edit */
  }
}

function paramsErrorOf(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON5.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'オブジェクト ({}) が必要です'
    }
    return null
  } catch (e) {
    return (e as Error).message
  }
}

function addInput(t: TaskDefinition) {
  if (!t.inputs) t.inputs = []
  t.inputs.push({
    id: `input${t.inputs.length + 1}`,
    type: 'text',
    prompt: '入力してください',
  })
}

function removeInput(t: TaskDefinition, idx: number) {
  if (!t.inputs) return
  t.inputs.splice(idx, 1)
  if (t.inputs.length === 0) delete t.inputs
}

function changeInputType(
  t: TaskDefinition,
  idx: number,
  type: 'text' | 'pick',
) {
  if (!t.inputs) return
  const cur = t.inputs[idx]
  if (!cur || cur.type === type) return
  const base = { id: cur.id, prompt: cur.prompt, default: cur.default }
  t.inputs[idx] =
    type === 'text'
      ? ({ ...base, type: 'text' } as TaskInput)
      : ({ ...base, type: 'pick', options: [] } as TaskInput)
}

function pickOptionsToText(input: TaskInput): string {
  if (input.type !== 'pick') return ''
  return input.options.join('\n')
}

function setPickOptions(input: TaskInput, text: string) {
  if (input.type !== 'pick') return
  input.options = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function accountIdMode(t: TaskDefinition): 'active' | 'first' | 'specific' {
  if (t.accountId === undefined) return 'active'
  if (t.accountId === null) return 'first'
  return 'specific'
}

function setAccountIdMode(
  t: TaskDefinition,
  mode: 'active' | 'first' | 'specific',
) {
  if (mode === 'active') delete t.accountId
  else if (mode === 'first') t.accountId = null
  else if (typeof t.accountId !== 'string') t.accountId = ''
}

function setOptionalString<K extends 'detail' | 'icon' | 'group'>(
  t: TaskDefinition,
  key: K,
  value: string,
) {
  const v = value.trim()
  if (v) t[key] = v
  else delete t[key]
}

function setFlag<K extends 'pinned' | 'isDefault'>(
  t: TaskDefinition,
  key: K,
  value: boolean,
) {
  if (value) t[key] = true
  else delete t[key]
}

function setIsDefault(t: TaskDefinition, value: boolean) {
  if (value) {
    for (const other of visualTasks.value) {
      if (other !== t) delete other.isDefault
    }
    t.isDefault = true
  } else {
    delete t.isDefault
  }
}

function setPresentation<K extends keyof TaskPresentation>(
  t: TaskDefinition,
  key: K,
  value: TaskPresentation[K] | null,
) {
  if (value === null) {
    if (!t.presentation) return
    delete t.presentation[key]
    if (Object.keys(t.presentation).length === 0) delete t.presentation
    return
  }
  if (!t.presentation) t.presentation = {}
  t.presentation[key] = value
}

const groupSuggestions = computed<string[]>(() => {
  const s = new Set<string>()
  for (const t of visualTasks.value) {
    if (t.group) s.add(t.group)
  }
  return [...s].sort()
})

// ── Code tab actions ──
function applyFromCode() {
  if (syncVisualFromCode()) {
    tab.value = 'visual'
  }
}

// ── Footer actions ──
const {
  copied: copiedMessage,
  imported: importedMessage,
  importError,
  showCopied,
  showImported,
  showImportError,
} = useClipboardFeedback()

async function exportTasks() {
  try {
    await navigator.clipboard.writeText(code.value)
    showCopied()
  } catch {
    /* clipboard denied */
  }
}

async function importTasks() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      showImportError()
      return
    }
    parseTasks(text)
    code.value = text
    syncVisualFromCode()
    showImported()
  } catch {
    showImportError()
  }
}

const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()

function handleReset() {
  triggerReset(async () => {
    code.value = defaultTasksJson5
    syncVisualFromCode()
    try {
      if (isTauri) await writeTasks(defaultTasksJson5)
      tasksStore.setFromRaw(defaultTasksJson5)
    } catch (e) {
      useToast().show(`リセット失敗: ${(e as Error).message}`, 'error')
    }
  })
}
</script>

<template>
  <div ref="contentRef" :class="$style.editor">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'list-check', label: 'ビジュアル' },
        { value: 'code', icon: 'code', label: 'コード' },
      ]"
    />

    <!-- Visual tab -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <div :class="$style.visualHint">
        宣言したタスクはコマンドパレットと Task Runner カラムから実行できます。
      </div>

      <datalist id="nd-task-groups">
        <option v-for="g in groupSuggestions" :key="g" :value="g" />
      </datalist>

      <div :class="$style.taskList">
        <div
          v-for="(t, i) in visualTasks"
          :key="t.id + i"
          :data-task-idx="i"
          :class="[$style.taskCard, {
            [$style.expanded]: expanded[t.id],
            [$style.dragging]: dragFromIndex === i,
            [$style.dragOver]: dragOverIndex === i,
          }]"
        >
          <div :class="$style.taskHeader" @click="toggleExpanded(t.id)">
            <i
              class="ti ti-grip-vertical"
              :class="$style.grip"
              title="ドラッグで並び替え"
              @pointerdown="startDrag(i, $event)"
              @click.stop
            />
            <i class="ti ti-chevron-right" :class="$style.chevron" />
            <div :class="$style.taskHeaderBody">
              <span :class="$style.taskLabel">
                <i v-if="t.pinned" class="ti ti-pin-filled" :class="$style.pinIcon" title="Pinned" />
                <i v-if="t.isDefault" class="ti ti-player-play-filled" :class="$style.defaultIcon" title="デフォルト実行対象" />
                {{ t.label || '(無題)' }}
              </span>
              <span :class="$style.taskMeta">
                <code :class="$style.method">{{ t.action.method }}</code>
                <span v-if="t.group" :class="$style.groupBadge">{{ t.group }}</span>
                <span v-if="t.inputs?.length" :class="$style.inputsBadge" title="入力を求める">
                  <i class="ti ti-keyboard" />{{ t.inputs.length }}
                </span>
              </span>
            </div>
            <div :class="$style.taskActions" @click.stop>
              <button
                class="_button"
                :class="[$style.iconBtn, $style.dangerBtn]"
                title="削除"
                @click="removeTask(i)"
              >
                <i class="ti ti-trash" />
              </button>
            </div>
          </div>

          <div v-if="expanded[t.id]" :class="$style.taskBody">
            <label :class="$style.field">
              <span :class="$style.fieldLabel">ID</span>
              <input
                v-model="t.id"
                type="text"
                :class="$style.input"
                pattern="[\w-]+"
                placeholder="my-task"
              />
            </label>
            <label :class="$style.field">
              <span :class="$style.fieldLabel">ラベル</span>
              <input
                v-model="t.label"
                type="text"
                :class="$style.input"
                placeholder="UI 表示名"
              />
            </label>
            <label :class="$style.field">
              <span :class="$style.fieldLabel">説明</span>
              <input
                :value="t.description ?? ''"
                type="text"
                :class="$style.input"
                placeholder="任意 (ツールチップ用の長文)"
                @input="(e) => {
                  const v = (e.target as HTMLInputElement).value
                  if (v) t.description = v
                  else delete t.description
                }"
              />
            </label>
            <label :class="$style.field">
              <span :class="$style.fieldLabel">detail</span>
              <input
                :value="t.detail ?? ''"
                type="text"
                :class="$style.input"
                placeholder="ラベル下の 1 行補足 (任意)"
                @input="(e) => setOptionalString(t, 'detail', (e.target as HTMLInputElement).value)"
              />
            </label>

            <div :class="$style.row">
              <label :class="[$style.field, $style.grow]">
                <span :class="$style.fieldLabel">group</span>
                <input
                  :value="t.group ?? ''"
                  type="text"
                  :class="$style.input"
                  list="nd-task-groups"
                  placeholder="自由文字列 (任意)"
                  @input="(e) => setOptionalString(t, 'group', (e.target as HTMLInputElement).value)"
                />
              </label>
              <label :class="[$style.field, $style.grow]">
                <span :class="$style.fieldLabel">icon</span>
                <input
                  :value="t.icon ?? ''"
                  type="text"
                  :class="[$style.input, $style.mono]"
                  placeholder="player-play"
                  pattern="[a-z0-9][a-z0-9-]*"
                  @input="(e) => setOptionalString(t, 'icon', (e.target as HTMLInputElement).value)"
                />
              </label>
            </div>

            <div :class="$style.row">
              <label :class="$style.checkboxRow">
                <input
                  type="checkbox"
                  :checked="t.pinned === true"
                  @change="(e) => setFlag(t, 'pinned', (e.target as HTMLInputElement).checked)"
                />
                <i class="ti ti-pin-filled" :class="$style.inlineIcon" />
                Pinned
              </label>
              <label :class="$style.checkboxRow">
                <input
                  type="checkbox"
                  :checked="t.isDefault === true"
                  @change="(e) => setIsDefault(t, (e.target as HTMLInputElement).checked)"
                />
                <i class="ti ti-player-play-filled" :class="$style.inlineIcon" />
                デフォルト実行対象 (1 件のみ)
              </label>
            </div>

            <fieldset :class="$style.fieldset">
              <legend :class="$style.legend">アカウント</legend>
              <label :class="$style.radioRow">
                <input
                  type="radio"
                  :checked="accountIdMode(t) === 'active'"
                  @change="setAccountIdMode(t, 'active')"
                />
                現在アクティブ
              </label>
              <label :class="$style.radioRow">
                <input
                  type="radio"
                  :checked="accountIdMode(t) === 'first'"
                  @change="setAccountIdMode(t, 'first')"
                />
                最初のログイン済み
              </label>
              <label :class="$style.radioRow">
                <input
                  type="radio"
                  :checked="accountIdMode(t) === 'specific'"
                  @change="setAccountIdMode(t, 'specific')"
                />
                指定 ID
                <input
                  v-if="accountIdMode(t) === 'specific'"
                  v-model="t.accountId as string"
                  type="text"
                  :class="[$style.input, $style.inlineInput]"
                  placeholder="accountId"
                />
              </label>
            </fieldset>

            <fieldset :class="$style.fieldset">
              <legend :class="$style.legend">アクション (api)</legend>
              <label :class="$style.field">
                <span :class="$style.fieldLabel">method</span>
                <input
                  v-model="t.action.method"
                  type="text"
                  :class="[$style.input, $style.mono]"
                  placeholder="notes/create"
                />
              </label>
              <label :class="$style.field">
                <span :class="$style.fieldLabel">params (JSON5)</span>
                <textarea
                  :value="paramsToText(t)"
                  :class="[$style.input, $style.textarea, $style.mono, { [$style.hasError]: paramsErrorOf(paramsToText(t)) }]"
                  rows="4"
                  placeholder="{ visibility: 'home' }"
                  @input="(e) => setParamsFromText(t, (e.target as HTMLTextAreaElement).value)"
                />
              </label>
            </fieldset>

            <fieldset :class="$style.fieldset">
              <legend :class="$style.legend">表示オプション (presentation)</legend>
              <label :class="$style.checkboxRow">
                <input
                  type="checkbox"
                  :checked="t.presentation?.revealOnRun !== false"
                  @change="(e) => setPresentation(t, 'revealOnRun', (e.target as HTMLInputElement).checked ? null : false)"
                />
                実行時に履歴で自動選択する (revealOnRun)
              </label>
              <label :class="$style.checkboxRow">
                <input
                  type="checkbox"
                  :checked="t.presentation?.clearHistoryOnRun === true"
                  @change="(e) => setPresentation(t, 'clearHistoryOnRun', (e.target as HTMLInputElement).checked ? true : null)"
                />
                実行時に過去履歴をクリア (clearHistoryOnRun)
              </label>
            </fieldset>

            <fieldset :class="$style.fieldset">
              <legend :class="$style.legend">
                入力フィールド
                <button
                  class="_button"
                  :class="$style.smallBtn"
                  @click="addInput(t)"
                >
                  <i class="ti ti-plus" /> 追加
                </button>
              </legend>
              <div
                v-for="(input, ii) in t.inputs ?? []"
                :key="ii"
                :class="$style.inputItem"
              >
                <div :class="$style.inputItemRow">
                  <select
                    :value="input.type"
                    :class="$style.input"
                    @change="(e) => changeInputType(t, ii, (e.target as HTMLSelectElement).value as 'text' | 'pick')"
                  >
                    <option value="text">text</option>
                    <option value="pick">pick</option>
                  </select>
                  <input
                    v-model="input.id"
                    type="text"
                    :class="$style.input"
                    placeholder="id"
                  />
                  <button
                    class="_button"
                    :class="[$style.iconBtn, $style.dangerBtn]"
                    title="削除"
                    @click="removeInput(t, ii)"
                  >
                    <i class="ti ti-x" />
                  </button>
                </div>
                <input
                  v-model="input.prompt"
                  type="text"
                  :class="$style.input"
                  placeholder="プロンプト"
                />
                <textarea
                  v-if="input.type === 'pick'"
                  :value="pickOptionsToText(input)"
                  :class="[$style.input, $style.textarea]"
                  rows="3"
                  placeholder="選択肢 (1行に1つ)"
                  @input="(e) => setPickOptions(input, (e.target as HTMLTextAreaElement).value)"
                />
                <input
                  :value="input.default ?? ''"
                  type="text"
                  :class="$style.input"
                  placeholder="default (任意)"
                  @input="(e) => {
                    const v = (e.target as HTMLInputElement).value
                    if (v) input.default = v
                    else delete input.default
                  }"
                />
              </div>
              <div v-if="!t.inputs?.length" :class="$style.inputsEmpty">
                入力なし — タスクは即座に実行されます
              </div>
            </fieldset>
          </div>
        </div>

        <div v-if="visualTasks.length === 0" :class="$style.emptyState">
          タスクがまだありません
        </div>

        <button class="_button" :class="$style.addBtn" @click="addTask">
          <i class="ti ti-plus" />
          タスクを追加
        </button>
      </div>
    </div>

    <!-- Code tab -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        変数: <code>${'$'}{input:&lt;id&gt;}</code>
        <code>${'$'}{account.id}</code>
        <code>${'$'}{account.host}</code>
      </div>
      <CodeEditor
        v-model="code"
        :language="lang"
        :linter="tasksLinter"
        :class="[$style.codeEditorWrap, { [$style.hasError]: codeError }]"
        auto-height
      />
      <div v-if="codeError" :class="$style.errorMessage">
        <i class="ti ti-alert-triangle" />
        {{ codeError }}
      </div>
      <div v-else-if="loaded && code.trim()" :class="$style.codeSuccess">
        <i class="ti ti-check" />
        {{ taskCount }} タスクを解析済み{{ saving ? ' · 保存中…' : '' }}
      </div>
      <button
        class="_button"
        :class="$style.codeApplyBtn"
        :disabled="!!codeError"
        @click="applyFromCode"
      >
        <i class="ti ti-refresh" />
        ビジュアルに同期
      </button>
    </div>

    <!-- Actions (footer) -->
    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: importedMessage || importError }]"
          @click="importTasks"
        >
          <i class="ti" :class="importError ? 'ti-alert-circle' : 'ti-clipboard-text'" />
          {{ importError ? '無効' : importedMessage ? '読込済み' : 'インポート' }}
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportTasks"
        >
          <i class="ti ti-clipboard-copy" />
          {{ copiedMessage ? 'コピー済み' : 'エクスポート' }}
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.danger, { [$style.confirming]: confirmingReset }]"
        @click="handleReset"
      >
        <i class="ti ti-trash" />
        {{ confirmingReset ? '本当にリセット？' : 'サンプルに戻す' }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

// ── Visual tab ──

.visualPanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.visualHint {
  padding: 10px 12px 4px;
  font-size: 0.75em;
  opacity: 0.55;
}

.taskList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 12px;
}

.taskCard {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  overflow: hidden;
  transition:
    border-color var(--nd-duration-base),
    opacity var(--nd-duration-base);

  &.expanded {
    border-color: var(--nd-accent);
  }

  &.dragging {
    opacity: 0.3;
  }

  &.dragOver {
    outline: 2px solid var(--nd-accent);
    outline-offset: 1px;
  }
}

.grip {
  flex-shrink: 0;
  opacity: 0.35;
  cursor: grab;
  touch-action: none;
  padding: 2px;
  transition: opacity var(--nd-duration-fast);

  &:hover {
    opacity: 0.8;
  }

  &:active {
    cursor: grabbing;
  }
}

.taskHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.chevron {
  flex-shrink: 0;
  opacity: 0.5;
  transition: transform var(--nd-duration-base);

  .expanded & {
    transform: rotate(90deg);
  }
}

.taskHeaderBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.taskLabel {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  font-size: 0.9em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pinIcon {
  font-size: 0.85em;
  color: var(--nd-accent);
}

.defaultIcon {
  font-size: 0.85em;
  color: var(--nd-mfmSuccess, #4a8);
}

.taskMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  opacity: 0.6;
}

.groupBadge {
  padding: 0 6px;
  border-radius: var(--nd-radius-full);
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  opacity: 0.9;
}

.method {
  font-family: var(--nd-font-mono);
}

.inputsBadge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
}

.taskActions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.iconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.55;
  transition:
    opacity var(--nd-duration-fast),
    background var(--nd-duration-fast);

  &:hover:not(:disabled) {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }
}

.dangerBtn:hover:not(:disabled) {
  color: var(--nd-love, #ec4137);
}

.taskBody {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--nd-divider);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.fieldLabel {
  font-size: 0.7em;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.input {
  width: 100%;
  padding: 5px 8px;
  font-size: 0.85em;
  background: var(--nd-bg);
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }

  &.hasError {
    border-color: var(--nd-love, #ec4137);
  }
}

.inlineInput {
  margin-left: 6px;
  width: auto;
  flex: 1;
}

.textarea {
  resize: vertical;
  min-height: 60px;
  font-family: inherit;
}

.mono {
  font-family: var(--nd-font-mono);
}

.fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
}

.legend {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  font-size: 0.7em;
  font-weight: bold;
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.smallBtn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  font-size: 0.75em;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.7;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.radioRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  cursor: pointer;
}

.checkboxRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  cursor: pointer;
}

.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.grow {
  flex: 1;
  min-width: 120px;
}

.inlineIcon {
  font-size: 0.9em;
  opacity: 0.7;
}

.inputItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
}

.inputItemRow {
  display: flex;
  gap: 6px;
  align-items: center;

  & > select.input {
    width: auto;
    flex-shrink: 0;
  }
}

.inputsEmpty {
  font-size: 0.75em;
  opacity: 0.5;
  text-align: center;
  padding: 6px;
}

.emptyState {
  padding: 18px;
  text-align: center;
  font-size: 0.8em;
  opacity: 0.55;
}

.addBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  margin-top: 4px;
  border: 1px dashed var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.7;
  transition:
    border-color var(--nd-duration-base),
    opacity var(--nd-duration-base);

  &:hover {
    border-color: var(--nd-accent);
    color: var(--nd-accent);
    opacity: 1;
  }
}

.expanded { /* modifier */ }

// ── Code tab ──

.codePanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.codeHint {
  font-size: 0.75em;
  line-height: 1.55;
  opacity: 0.5;

  code {
    font-family: var(--nd-font-mono);
    background: var(--nd-buttonBg);
    padding: 1px 4px;
    margin: 0 2px;
    border-radius: 3px;
    white-space: nowrap;
  }
}

.codeEditorWrap {
  &.hasError {
    box-shadow: 0 0 0 2px var(--nd-love);
    border-radius: var(--nd-radius-sm);
  }
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-love) 10%, var(--nd-bg));
  color: var(--nd-love);
  font-size: 0.75em;
  word-break: break-all;
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-accent);
  opacity: 0.7;
}

.codeApplyBtn { @include btn-secondary; }

// ── Actions (footer) ──

.actions { @include action-bar; }
.actionGroup { @include action-group; }

.actionBtn {
  &.secondary { @include btn-action; }
  &.danger { @include btn-danger-ghost; }
}

.secondary { /* modifier */ }
.feedback { /* modifier */ }
.danger { /* modifier */ }
.confirming { /* modifier */ }
.hasError { /* modifier */ }
</style>
