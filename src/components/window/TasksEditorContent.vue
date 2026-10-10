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
  toRaw,
  watch,
} from 'vue'
import CollapseBox from '@/components/common/CollapseBox.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import FormInput from '@/components/common/form/FormInput.vue'
import FormSelect from '@/components/common/form/FormSelect.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import defaultTasksJson5 from '@/defaults/tasks.json5?raw'
import { i18n } from '@/i18n'
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
// カードの鍵と開閉状態はタスクの ID ではなくオブジェクトに結び付ける。ID は入力欄で
// 書き換わるので、ID を鍵にすると 1 文字ごとにカードが作り直されて閉じる (#1215)
let nextCardKey = 0
const cardKeys = new WeakMap<TaskDefinition, number>()
function cardKey(t: TaskDefinition): number {
  const raw = toRaw(t)
  let k = cardKeys.get(raw)
  if (k === undefined) {
    k = nextCardKey++
    cardKeys.set(raw, k)
  }
  return k
}
const expanded = reactive<Record<number, boolean>>({})
const loaded = ref(false)
const saving = ref(false)
let suppressSync = false

function tasksToJson(tasks: TaskDefinition[]): string {
  return JSON5.stringify({ version: TASKS_FILE_VERSION, tasks }, null, 2)
}

function syncVisualFromCode(): boolean {
  try {
    const parsed = parseTasks(code.value)
    // コードから読み直すとオブジェクトが入れ替わるので、開閉と打ちかけの params は
    // 同じ ID のタスクへ引き継ぐ
    const openIds = new Set<string>()
    const drafts = new Map<string, { base: string; text: string }>()
    for (const t of visualTasks.value) {
      const k = cardKey(t)
      if (expanded[k]) openIds.add(t.id)
      const d = paramsDraft[k]
      if (d) drafts.set(t.id, d)
      delete expanded[k]
      delete paramsDraft[k]
    }
    for (const t of parsed.tasks) {
      const k = cardKey(t)
      if (openIds.has(t.id)) expanded[k] = true
      const d = drafts.get(t.id)
      if (d) paramsDraft[k] = d
    }
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
          i18n.tsx._tasksEditorContent.loadFailed({
            error: (e as Error).message,
          }),
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
  // ID の重複はコードの検証 (parseTasks) でも弾くが、そちらは別の debounce で
  // 走るので、見えている重複はここでも直接見る
  if (codeError.value || duplicateIds.value.size > 0) return
  saving.value = true
  try {
    if (isTauri) await writeTasks(code.value)
    tasksStore.setFromRaw(code.value)
  } catch (e) {
    useToast().show(
      i18n.tsx._tasksEditorContent.saveFailed({ error: (e as Error).message }),
      'error',
    )
  } finally {
    saving.value = false
  }
}

const taskCount = computed(() => visualTasks.value.length)

// 2 つ以上のタスクが使っている ID。該当する欄の直下にエラーを出す
const duplicateIds = computed(() => {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const t of visualTasks.value) {
    if (seen.has(t.id)) dup.add(t.id)
    seen.add(t.id)
  }
  return dup
})

// ── Visual edit helpers ──
function uniqueId(base: string): string {
  const ids = new Set(visualTasks.value.map((t) => t.id))
  if (!ids.has(base)) return base
  let i = 2
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function addTask() {
  const task: TaskDefinition = {
    id: uniqueId('new-task'),
    label: i18n.ts._tasksEditorContent.newTaskLabel,
    action: { type: 'api', method: 'i' },
  }
  visualTasks.value.push(task)
  expanded[cardKey(task)] = true
}

function removeTask(index: number) {
  const t = visualTasks.value[index]
  if (!t) return
  visualTasks.value.splice(index, 1)
  delete expanded[cardKey(t)]
  delete paramsDraft[cardKey(t)]
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

function toggleExpanded(t: TaskDefinition) {
  const k = cardKey(t)
  expanded[k] = !expanded[k]
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

// 打ちかけの params。正しい JSON5 になるまで params は変わらないので、
// 保存値から描き直すと打った文字が消え、誤りも表示できない。
// 外 (コードタブ等) で params が変わったら下書きは捨てる
const paramsDraft = reactive<Record<number, { base: string; text: string }>>({})

function paramsText(t: TaskDefinition): string {
  const d = paramsDraft[cardKey(t)]
  const base = paramsToText(t)
  return d && d.base === base ? d.text : base
}

function onParamsInput(t: TaskDefinition, text: string) {
  setParamsFromText(t, text)
  paramsDraft[cardKey(t)] = { base: paramsToText(t), text }
}

function paramsErrorOf(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON5.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return i18n.ts._tasksEditorContent.objectRequired
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
    prompt: i18n.ts._tasksEditorContent.newInputPrompt,
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
// 誤りがあってもボタンは押せるままにし、押されたら誤りの文 (エディタの直下) を
// 出したままエディタへフォーカスを戻す (DEVELOPMENT.md のフォームの方針)
function applyFromCode() {
  if (syncVisualFromCode()) {
    tab.value = 'visual'
    return
  }
  contentRef.value?.querySelector<HTMLElement>('.cm-content')?.focus()
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
      useToast().show(
        i18n.tsx._tasksEditorContent.resetFailed({
          error: (e as Error).message,
        }),
        'error',
      )
    }
  })
}
</script>

<template>
  <div ref="contentRef" :class="$style.editor">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'list-check', label: i18n.ts._common.visual },
        { value: 'code', icon: 'code', label: i18n.ts._common.code },
      ]"
    />

    <!-- Visual tab -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <div :class="$style.visualHint">
        {{ i18n.ts._tasksEditorContent.visualHint }}
      </div>

      <datalist id="nd-task-groups">
        <option v-for="g in groupSuggestions" :key="g" :value="g" />
      </datalist>

      <div :class="$style.taskList">
        <div
          v-for="(t, i) in visualTasks"
          :key="cardKey(t)"
          :data-task-idx="i"
          :class="[$style.taskCard, {
            [$style.expanded]: expanded[cardKey(t)],
            [$style.dragging]: dragFromIndex === i,
            [$style.dragOver]: dragOverIndex === i,
          }]"
        >
          <!-- 行全体をボタンにすると取っ手と削除ボタンが入れ子になるので、開閉のボタンは
               見出しの中に分けて置く。行の余白のクリックでも開閉できるよう、クリックは行が受ける
               (ボタンの Enter / Space もここへ泡立つ) -->
          <div :class="$style.taskHeader" @click="toggleExpanded(t)">
            <i
              class="ti ti-grip-vertical"
              :class="$style.grip"
              :title="i18n.ts._tasksEditorContent.dragToReorder"
              @pointerdown="startDrag(i, $event)"
              @click.stop
            />
            <button
              type="button"
              class="_button"
              :class="$style.taskToggle"
              :aria-expanded="!!expanded[cardKey(t)]"
            >
              <i class="ti ti-chevron-down nd-chevron" :class="[$style.chevron, { 'nd-chevron-closed': !expanded[cardKey(t)] }]" />
              <span :class="$style.taskHeaderBody">
                <span :class="$style.taskLabel">
                  <i v-if="t.pinned" class="ti ti-pin" :class="$style.pinIcon" title="Pinned" />
                  <i v-if="t.isDefault" class="ti ti-player-play" :class="$style.defaultIcon" :title="i18n.ts._tasksEditorContent.defaultTask" />
                  {{ t.label || i18n.ts._tasksEditorContent.untitled }}
                </span>
                <span :class="$style.taskMeta">
                  <code :class="$style.method">{{ t.action.method }}</code>
                  <span v-if="t.group" :class="$style.groupBadge">{{ t.group }}</span>
                  <span v-if="t.inputs?.length" :class="$style.inputsBadge" :title="i18n.ts._tasksEditorContent.promptsForInput">
                    <i class="ti ti-keyboard" />{{ t.inputs.length }}
                  </span>
                </span>
              </span>
            </button>
            <div :class="$style.taskActions" @click.stop>
              <button
                class="_button"
                :class="[$style.iconBtn, $style.dangerBtn]"
                :title="i18n.ts._common.delete"
                @click="removeTask(i)"
              >
                <i class="ti ti-trash" />
              </button>
            </div>
          </div>

          <CollapseBox :open="!!expanded[cardKey(t)]">
            <div :class="$style.taskBody">
              <label :class="$style.field">
                <span :class="$style.fieldLabel">ID</span>
                <FormInput
                  v-model="t.id"
                  :class="$style.idInput"
                  pattern="[\w-]+"
                  placeholder="my-task"
                  :error="duplicateIds.has(t.id) ? i18n.ts._tasksEditorContent.duplicateId : ''"
                />
              </label>
              <label :class="$style.field">
                <span :class="$style.fieldLabel">{{ i18n.ts._tasksEditorContent.label }}</span>
                <input
                  v-model="t.label"
                  type="text"
                  :class="$style.input"
                  :placeholder="i18n.ts._tasksEditorContent.labelPlaceholder"
                />
              </label>
              <label :class="$style.field">
                <span :class="$style.fieldLabel">{{ i18n.ts._tasksEditorContent.description }}</span>
                <input
                  :value="t.description ?? ''"
                  type="text"
                  :class="$style.input"
                  :placeholder="i18n.ts._tasksEditorContent.descriptionPlaceholder"
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
                  :placeholder="i18n.ts._tasksEditorContent.detailPlaceholder"
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
                    :placeholder="i18n.ts._tasksEditorContent.groupPlaceholder"
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
                  <i class="ti ti-pin" :class="$style.inlineIcon" />
                  Pinned
                </label>
                <label :class="$style.checkboxRow">
                  <input
                    type="checkbox"
                    :checked="t.isDefault === true"
                    @change="(e) => setIsDefault(t, (e.target as HTMLInputElement).checked)"
                  />
                  <i class="ti ti-player-play" :class="$style.inlineIcon" />
                  {{ i18n.ts._tasksEditorContent.defaultTaskOnlyOne }}
                </label>
              </div>

              <fieldset :class="$style.fieldset">
                <legend :class="$style.legend">{{ i18n.ts._common.account }}</legend>
                <label :class="$style.radioRow">
                  <input
                    type="radio"
                    :checked="accountIdMode(t) === 'active'"
                    @change="setAccountIdMode(t, 'active')"
                  />
                  {{ i18n.ts._tasksEditorContent.accountActive }}
                </label>
                <label :class="$style.radioRow">
                  <input
                    type="radio"
                    :checked="accountIdMode(t) === 'first'"
                    @change="setAccountIdMode(t, 'first')"
                  />
                  {{ i18n.ts._tasksEditorContent.accountFirst }}
                </label>
                <label :class="$style.radioRow">
                  <input
                    type="radio"
                    :checked="accountIdMode(t) === 'specific'"
                    @change="setAccountIdMode(t, 'specific')"
                  />
                  {{ i18n.ts._tasksEditorContent.accountSpecific }}
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
                <legend :class="$style.legend">{{ i18n.ts._tasksEditorContent.action }}</legend>
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
                  <FormInput
                    multiline
                    :model-value="paramsText(t)"
                    :class="$style.paramsInput"
                    rows="4"
                    placeholder="{ visibility: 'home' }"
                    :error="paramsErrorOf(paramsText(t)) ?? ''"
                    @update:model-value="(v) => onParamsInput(t, v)"
                  />
                </label>
              </fieldset>

              <fieldset :class="$style.fieldset">
                <legend :class="$style.legend">{{ i18n.ts._tasksEditorContent.presentation }}</legend>
                <label :class="$style.checkboxRow">
                  <input
                    type="checkbox"
                    :checked="t.presentation?.revealOnRun !== false"
                    @change="(e) => setPresentation(t, 'revealOnRun', (e.target as HTMLInputElement).checked ? null : false)"
                  />
                  {{ i18n.ts._tasksEditorContent.revealOnRun }}
                </label>
                <label :class="$style.checkboxRow">
                  <input
                    type="checkbox"
                    :checked="t.presentation?.clearHistoryOnRun === true"
                    @change="(e) => setPresentation(t, 'clearHistoryOnRun', (e.target as HTMLInputElement).checked ? true : null)"
                  />
                  {{ i18n.ts._tasksEditorContent.clearHistoryOnRun }}
                </label>
              </fieldset>

              <fieldset :class="$style.fieldset">
                <legend :class="$style.legend">
                  {{ i18n.ts._tasksEditorContent.inputFields }}
                  <button
                    class="_button"
                    :class="$style.smallBtn"
                    @click="addInput(t)"
                  >
                    <i class="ti ti-plus" /> {{ i18n.ts._common.add }}
                  </button>
                </legend>
                <div
                  v-for="(input, ii) in t.inputs ?? []"
                  :key="ii"
                  :class="$style.inputItem"
                >
                  <div :class="$style.inputItemRow">
                    <FormSelect
                      :model-value="input.type"
                      :class="$style.select"
                      @update:model-value="(v) => changeInputType(t, ii, v)"
                    >
                      <option value="text">text</option>
                      <option value="pick">pick</option>
                    </FormSelect>
                    <input
                      v-model="input.id"
                      type="text"
                      :class="$style.input"
                      placeholder="id"
                    />
                    <button
                      class="_button"
                      :class="[$style.iconBtn, $style.dangerBtn]"
                      :title="i18n.ts._common.delete"
                      @click="removeInput(t, ii)"
                    >
                      <i class="ti ti-x" />
                    </button>
                  </div>
                  <input
                    v-model="input.prompt"
                    type="text"
                    :class="$style.input"
                    :placeholder="i18n.ts._tasksEditorContent.prompt"
                  />
                  <textarea
                    v-if="input.type === 'pick'"
                    :value="pickOptionsToText(input)"
                    :class="[$style.input, $style.textarea]"
                    rows="3"
                    :placeholder="i18n.ts._tasksEditorContent.pickOptionsPlaceholder"
                    @input="(e) => setPickOptions(input, (e.target as HTMLTextAreaElement).value)"
                  />
                  <input
                    :value="input.default ?? ''"
                    type="text"
                    :class="$style.input"
                    :placeholder="i18n.ts._tasksEditorContent.defaultPlaceholder"
                    @input="(e) => {
                      const v = (e.target as HTMLInputElement).value
                      if (v) input.default = v
                      else delete input.default
                    }"
                  />
                </div>
                <div v-if="!t.inputs?.length" :class="$style.inputsEmpty">
                  {{ i18n.ts._tasksEditorContent.noInputs }}
                </div>
              </fieldset>
            </div>
          </CollapseBox>
        </div>

        <div v-if="visualTasks.length === 0" :class="$style.emptyState">
          {{ i18n.ts._tasksEditorContent.empty }}
        </div>

        <button class="_button" :class="$style.addBtn" @click="addTask">
          <i class="ti ti-plus" />
          {{ i18n.ts._tasksEditorContent.addTask }}
        </button>
      </div>
    </div>

    <!-- Code tab -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        {{ i18n.ts._tasksEditorContent.variables }} <code>${'$'}{input:&lt;id&gt;}</code>
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
        {{ i18n.tsx._tasksEditorContent.parsedTasks_plural({ count: taskCount }) }}{{ saving ? i18n.ts._tasksEditorContent.savingSuffix : '' }}
      </div>
      <button
        class="_button"
        :class="$style.codeApplyBtn"
        @click="applyFromCode"
      >
        <i class="ti ti-refresh" />
        {{ i18n.ts._common.syncToVisual }}
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
          {{ importError ? i18n.ts._common.invalid : importedMessage ? i18n.ts._common.loaded : i18n.ts._common.import }}
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportTasks"
        >
          <i class="ti ti-clipboard-copy" />
          {{ copiedMessage ? i18n.ts._common.copied : i18n.ts._common.export }}
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.danger, { [$style.confirming]: confirmingReset }]"
        @click="handleReset"
      >
        <i class="ti ti-trash" />
        {{ confirmingReset ? i18n.ts._common.confirmReset : i18n.ts._tasksEditorContent.resetToSample }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/inputs' as *;

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
  font-size: var(--nd-font-xs);
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

.taskToggle {
  @include nd-interactive;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--nd-radius-sm);
  color: inherit;
  text-align: start;
}

.chevron {
  flex-shrink: 0;
  opacity: 0.5;
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
  gap: 6px;
  font-weight: var(--nd-weight-bold);
  font-size: var(--nd-font-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pinIcon {
  font-size: var(--nd-font-md);
  color: var(--nd-accent);
}

.defaultIcon {
  font-size: var(--nd-font-md);
  color: var(--nd-mfmSuccess, #4a8);
}

.taskMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--nd-font-xs);
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
  color: var(--nd-love);
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
  gap: 4px;
}

.fieldLabel {
  font-size: var(--nd-font-2xs);
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.select {
  width: 100%;
}

.input {
  @include input-base;
  width: 100%;
  padding: 6px 8px;

}

.idInput input {
  padding: 6px 8px;
}

.paramsInput textarea {
  min-height: 60px;
  padding: 6px 8px;
  font-family: var(--nd-font-mono);
}

.inlineInput {
  margin-left: 6px;
  width: auto;
  flex: 1;
}

.textarea {
  resize: vertical;
  min-height: 60px;
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
  font-size: var(--nd-font-2xs);
  font-weight: var(--nd-weight-bold);
  opacity: 0.65;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.smallBtn {
  @include nd-interactive;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  font-size: var(--nd-font-xs);
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
  font-size: var(--nd-font-md);
  cursor: pointer;
}

.checkboxRow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--nd-font-md);
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
  font-size: var(--nd-font-body);
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
  font-size: var(--nd-font-xs);
  opacity: 0.5;
  text-align: center;
  padding: 6px;
}

.emptyState {
  padding: 18px;
  text-align: center;
  font-size: var(--nd-font-sm);
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
  font-size: var(--nd-font-md);
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
  font-size: var(--nd-font-xs);
  line-height: 1.55;
  opacity: 0.5;

  code {
    font-family: var(--nd-font-mono);
    background: var(--nd-buttonBg);
    padding: 1px 4px;
    margin: 0 2px;
    border-radius: var(--nd-radius-xs);
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
  font-size: var(--nd-font-xs);
  word-break: break-all;
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--nd-font-xs);
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
