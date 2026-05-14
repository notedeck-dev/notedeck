<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { dispatchCapability } from '@/capabilities/dispatcher'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import type { ChatMessage } from '@/composables/useAiChat'
import { resolveAiConnection, useAiConfig } from '@/composables/useAiConfig'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useSensitiveMask } from '@/composables/useSensitiveMask'
import { useServerImages } from '@/composables/useServerImages'
import { useVault } from '@/composables/useVault'
import { useVerticalResize } from '@/composables/useVerticalResize'
import { useAiSessionsStore } from '@/stores/aiSessions'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useKeybindsStore } from '@/stores/keybinds'
import { useTaskRunnerStore } from '@/stores/taskRunner'
import { useTasksStore } from '@/stores/tasks'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import type { TaskDefinition, TaskRun } from '@/tasks/types'
import { shortcutLabel } from '@/utils/shortcutLabel'
import DeckColumn from './DeckColumn.vue'

const UNGROUPED_KEY = '__ungrouped__'
const PINNED_KEY = '__pinned__'

const props = defineProps<{
  column: DeckColumnType
}>()

const { columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl } = useServerImages(() => props.column)
const tasksStore = useTasksStore()
const runnerStore = useTaskRunnerStore()
const windowsStore = useWindowsStore()
const keybindsStore = useKeybindsStore()
const sessionsStore = useAiSessionsStore()
const { config: aiConfig } = useAiConfig()
const vault = useVault()

const SENSITIVE_RAW_KEYS = new Set<string>([
  'i',
  'token',
  'password',
  'apiKey',
  'secret',
])
const { showSensitive, formatJson } = useSensitiveMask(SENSITIVE_RAW_KEYS)

const query = ref('')
const selectedId = ref<number | null>(null)

const now = ref(Date.now())
const tickTimer = setInterval(() => {
  now.value = Date.now()
}, 15_000)
onUnmounted(() => clearInterval(tickTimer))

// presentation.revealOnRun の反映: runner が run を実行したらこのカラムで
// 自動的にその行を選択して詳細パネルを開く。
watch(
  () => runnerStore.autoSelectedRunId,
  (id) => {
    if (id != null) selectedId.value = id
  },
)

const filteredDefinitions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return tasksStore.definitions
  return tasksStore.definitions.filter(
    (d) =>
      d.id.includes(q) ||
      d.label.toLowerCase().includes(q) ||
      (d.detail?.toLowerCase().includes(q) ?? false) ||
      (d.description?.toLowerCase().includes(q) ?? false) ||
      (d.group?.toLowerCase().includes(q) ?? false),
  )
})

interface TaskSection {
  key: string
  title: string
  pinned: boolean
  items: TaskDefinition[]
}

const groupedDefinitions = computed<TaskSection[]>(() => {
  const items = filteredDefinitions.value
  const pinned = items.filter((d) => d.pinned)
  const rest = items.filter((d) => !d.pinned)

  const groups = new Map<string, TaskDefinition[]>()
  for (const d of rest) {
    const key = d.group ?? UNGROUPED_KEY
    const arr = groups.get(key)
    if (arr) arr.push(d)
    else groups.set(key, [d])
  }

  const sections: TaskSection[] = []
  if (pinned.length > 0) {
    sections.push({
      key: PINNED_KEY,
      title: 'Pinned',
      pinned: true,
      items: pinned,
    })
  }
  // グループ未指定は最下段の "General" に送る（VSCode の none に相当）
  const keys = [...groups.keys()].filter((k) => k !== UNGROUPED_KEY)
  if (groups.has(UNGROUPED_KEY)) keys.push(UNGROUPED_KEY)
  for (const k of keys) {
    sections.push({
      key: k,
      title: k === UNGROUPED_KEY ? 'General' : k,
      pinned: false,
      items: groups.get(k) ?? [],
    })
  }
  return sections
})

function iconClass(def: TaskDefinition): string {
  return `ti ti-${def.icon ?? 'player-play'}`
}

// runnerStore.runs は新しい順 (taskRunner L40: [run, ...runs.value])。
// 先頭から走査して taskId ごとの最初の出現 = 最新実行。
const latestRunByTaskId = computed<Map<string, TaskRun>>(() => {
  const map = new Map<string, TaskRun>()
  for (const r of runnerStore.runs) {
    if (!map.has(r.taskId)) map.set(r.taskId, r)
  }
  return map
})

const selectedRun = computed(() =>
  selectedId.value == null
    ? null
    : (runnerStore.runs.find((r) => r.id === selectedId.value) ?? null),
)

const runningCount = computed(
  () => runnerStore.runs.filter((r) => r.status === 'running').length,
)

const previewJson = computed(() => {
  const r = selectedRun.value
  if (!r) return ''
  return formatJson({
    method: r.method,
    accountId: r.accountId,
    params: r.params,
    ...(r.status === 'ok' ? { response: r.response } : {}),
    ...(r.status === 'error' ? { error: r.error } : {}),
  })
})

function statusIcon(status: string): string {
  if (status === 'running') return 'ti-loader-2 nd-spin'
  if (status === 'ok') return 'ti-check'
  return 'ti-alert-triangle'
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

function formatAgo(ts: number): string {
  const diff = Math.max(0, now.value - ts)
  if (diff < 60_000) return 'さっき'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`
  return `${Math.floor(diff / 86_400_000)}日前`
}

function runDuration(run: { startedAt: number; finishedAt?: number }): string {
  const end = run.finishedAt ?? now.value
  return formatElapsed(end - run.startedAt)
}

function runFromList(taskId: string) {
  void runnerStore.runTask(taskId)
}

/**
 * AI 経由でタスクを実行する。
 *
 * 直列構造: TaskDefinition の中身 (API 直叩き) は変更せず、AI が
 * `tasks.run` capability を 1-shot dispatch して既存 runTask() を kick する。
 * 結果は kind='task' な AiSession に tool_use / tool_result として記録され、
 * AI カラムの session 一覧から後で再確認できる。
 *
 * AI による「判断」は介在しない (= 確実な 1-shot 実行)。AI が動的に inputs を
 * 決めるパターンは AI Chat カラム経由で `tasks.run` を tool として呼ばせる。
 */
async function runWithAi(def: TaskDefinition): Promise<void> {
  const resolved = resolveAiConnection(aiConfig.value, vault.connections.value)
  if (!resolved || !resolved.model) {
    useToast().show(
      'AI 接続が未選択、または model が未設定のため AI 実行できません',
      'error',
    )
    return
  }

  const session = sessionsStore.createNew({
    kind: 'task',
    title: def.label,
    model: resolved.model,
    connectionId: resolved.connection.id,
  })

  const now = Date.now()
  const userMsg: ChatMessage = {
    id: `msg-${now}-u`,
    role: 'user',
    content: `Run task: ${def.label}`,
    timestamp: now,
  }
  sessionsStore.updateMessages(session.id, [userMsg])

  const result = await dispatchCapability(
    'tasks.run',
    { taskId: def.id },
    aiConfig.value,
  )

  const ts = Date.now()
  const toolUseId = `task-${ts}`
  const resultText = result.ok
    ? typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result, null, 2)
    : `Error (${result.code}): ${result.error}`

  const assistantToolUse: ChatMessage = {
    id: `msg-${ts}-a`,
    role: 'assistant',
    content: '',
    timestamp: ts,
    toolUseId,
    toolUseName: 'tasks_run',
    toolUseInput: { taskId: def.id },
  }
  const toolResultMsg: ChatMessage = {
    id: `msg-${ts}-r`,
    role: 'user',
    content: resultText,
    timestamp: ts,
    toolResultFor: toolUseId,
  }

  const cur = sessionsStore.get(session.id)
  if (!cur) return
  sessionsStore.updateMessages(session.id, [
    ...cur.messages,
    assistantToolUse,
    toolResultMsg,
  ])
}

const defaultTask = computed<TaskDefinition | null>(
  () => tasksStore.definitions.find((d) => d.isDefault) ?? null,
)

const defaultShortcutLabel = computed(() => {
  const shortcut = keybindsStore.getShortcuts('tasks.run-default')[0]
  return shortcut ? shortcutLabel(shortcut) : ''
})

function runDefault() {
  void runnerStore.runDefault()
}

function clearHistory() {
  runnerStore.clear()
  selectedId.value = null
}

function openEditor() {
  windowsStore.open('tasksEditor')
}

const wrapperRef = ref<HTMLElement | null>(null)
const { value: detailHeight, start: onDividerPointerDown } = useVerticalResize({
  containerRef: wrapperRef,
  mode: 'bottom-px',
  initial: 320,
  min: 80,
  topMargin: 120,
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    title="タスク"
    :theme-vars="columnThemeVars"
  >
    <template #header-icon>
      <i class="ti ti-list-check" :class="$style.headerIcon" />
    </template>

    <template #header-meta>
      <button
        v-if="runnerStore.runs.length > 0"
        class="_button"
        :class="$style.headerBtn"
        title="履歴をクリア"
        @click.stop="clearHistory()"
      >
        <i class="ti ti-trash" />
      </button>
      <button
        class="_button"
        :class="$style.headerBtn"
        title="tasks.json5 を編集"
        @click.stop="openEditor()"
      >
        <i class="ti ti-pencil" />
      </button>
    </template>

    <div ref="wrapperRef" :class="$style.wrapper">
      <button
        v-if="defaultTask"
        class="_button"
        :class="$style.defaultBar"
        :title="`${defaultTask.label} を実行`"
        @click="runDefault()"
      >
        <i :class="[iconClass(defaultTask), $style.defaultBarIcon]" />
        <span :class="$style.defaultBarText">
          <span :class="$style.defaultBarKicker">デフォルト実行</span>
          <span :class="$style.defaultBarLabel">{{ defaultTask.label }}</span>
        </span>
        <span
          v-if="defaultShortcutLabel"
          :class="$style.defaultBarShortcut"
        >{{ defaultShortcutLabel }}</span>
      </button>

      <div :class="$style.toolbar">
        <div :class="$style.searchWrap">
          <i class="ti ti-search" :class="$style.searchIcon" />
          <input
            v-model="query"
            type="text"
            :class="$style.search"
            placeholder="タスクを検索"
          />
          <button
            v-if="query"
            class="_button"
            :class="$style.searchClear"
            @click="query = ''"
          >
            <i class="ti ti-x" />
          </button>
        </div>
      </div>

      <div :class="$style.scroll">
        <ColumnEmptyState
          v-if="tasksStore.definitions.length === 0"
          message="tasks.json5 を編集してタスクを定義すると、ここから 1-click で実行できます。"
          :image-url="serverInfoImageUrl"
          cta-label="tasks.json5 を編集"
          cta-icon="ti-pencil"
          @cta="openEditor()"
        />
        <ColumnEmptyState
          v-else-if="filteredDefinitions.length === 0"
          :message="`&quot;${query}&quot; に一致するタスクはありません`"
        />
        <template v-else>
          <section
            v-for="section in groupedDefinitions"
            :key="section.key"
            :class="$style.section"
          >
            <div :class="$style.sectionHeader">
              <span :class="$style.sectionTitle">
                <i
                  v-if="section.pinned"
                  class="ti ti-pin-filled"
                  :class="$style.sectionLeadIcon"
                />
                {{ section.title }}
                <span :class="$style.countSub">{{ section.items.length }}</span>
              </span>
              <span
                v-if="section.key === groupedDefinitions[0]?.key && tasksStore.lastError"
                :class="$style.errorBadge"
                :title="tasksStore.lastError"
              >
                <i class="ti ti-alert-triangle" /> エラー
              </span>
            </div>
            <div
              v-for="def in section.items"
              :key="def.id"
              :class="$style.runRow"
            >
              <button
                class="_button"
                :class="$style.runBtn"
                :title="def.description || def.detail || def.label"
                @click="runFromList(def.id)"
              >
                <i :class="[iconClass(def), $style.runIcon]" />
                <div :class="$style.runBody">
                  <span :class="$style.runLabel">{{ def.label }}</span>
                  <span
                    v-if="def.detail || def.description"
                    :class="$style.runDesc"
                  >{{ def.detail || def.description }}</span>
                </div>
                <span
                  v-if="latestRunByTaskId.get(def.id)"
                  :class="[$style.statusBadge, {
                    [$style.statusOk]: latestRunByTaskId.get(def.id)!.status === 'ok',
                    [$style.statusError]: latestRunByTaskId.get(def.id)!.status === 'error',
                    [$style.statusRunning]: latestRunByTaskId.get(def.id)!.status === 'running',
                  }]"
                  :title="`最終実行: ${latestRunByTaskId.get(def.id)!.status} · ${runDuration(latestRunByTaskId.get(def.id)!)}`"
                >
                  <i :class="['ti', statusIcon(latestRunByTaskId.get(def.id)!.status)]" />
                  <span>{{ formatAgo(latestRunByTaskId.get(def.id)!.startedAt) }}</span>
                </span>
                <span v-if="def.inputs?.length" :class="$style.runBadge" title="入力を求める">
                  <i class="ti ti-keyboard" />{{ def.inputs.length }}
                </span>
              </button>
              <button
                class="_button"
                :class="$style.aiTrigger"
                title="AI セッションで実行 (kind=task の新規セッションを作成し、即 1 回実行)"
                @click="runWithAi(def)"
              >
                <i class="ti ti-brain" />
              </button>
            </div>
          </section>

          <section :class="$style.section">
            <div :class="$style.sectionHeader">
              <span :class="$style.sectionTitle">
                履歴
                <span :class="$style.countSub">{{ runnerStore.runs.length }}</span>
                <span v-if="runningCount > 0" :class="$style.runningPill">
                  <i class="ti ti-loader-2 nd-spin" />{{ runningCount }} 実行中
                </span>
              </span>
            </div>
            <div v-if="runnerStore.runs.length === 0" :class="$style.emptyHint">
              実行履歴はまだありません
            </div>
            <button
              v-for="run in runnerStore.runs"
              :key="run.id"
              class="_button"
              :class="[$style.runItem, {
                [$style.selected]: run.id === selectedId,
                [$style.statusOk]: run.status === 'ok',
                [$style.statusError]: run.status === 'error',
                [$style.statusRunning]: run.status === 'running',
              }]"
              @click="selectedId = run.id === selectedId ? null : run.id"
            >
              <i :class="['ti', statusIcon(run.status), $style.runItemIcon]" />
              <div :class="$style.runItemBody">
                <span :class="$style.runItemLabel">{{ run.label }}</span>
                <span :class="$style.runItemMeta">
                  <code :class="$style.method">{{ run.method }}</code>
                  <span>{{ runDuration(run) }}</span>
                </span>
              </div>
              <span :class="$style.runItemTime">{{ formatAgo(run.startedAt) }}</span>
            </button>
          </section>
        </template>
      </div>

      <div
        v-if="selectedRun"
        :class="$style.divider"
        @pointerdown="onDividerPointerDown"
      />
      <div
        v-if="selectedRun"
        :class="$style.detail"
        :style="{ height: detailHeight + 'px' }"
      >
        <RawJsonView
          :json="previewJson"
          :can-reveal="true"
          v-model:show-sensitive="showSensitive"
        >
          <template #hint>
            <code :class="$style.method">{{ selectedRun.method }}</code>
            <span :class="[$style.statusTag, {
              [$style.statusOk]: selectedRun.status === 'ok',
              [$style.statusError]: selectedRun.status === 'error',
              [$style.statusRunning]: selectedRun.status === 'running',
            }]">{{ selectedRun.status }}</span>
            <span>{{ runDuration(selectedRun) }}</span>
          </template>
        </RawJsonView>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.headerIcon {
  font-size: 1em;
}

.headerBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition:
    background var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.defaultBar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  border-bottom: 1px solid var(--nd-divider);
  background: color-mix(in srgb, var(--nd-accent) 8%, transparent);
  color: var(--nd-fgHighlighted);
  text-align: left;
  transition: background var(--nd-duration-base);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 16%, transparent);
  }
}

.defaultBarIcon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--nd-accent);
  color: var(--nd-bg);
  font-size: 13px;
}

.defaultBarText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.defaultBarKicker {
  font-size: 0.65em;
  font-weight: bold;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.7;
  color: var(--nd-accent);
}

.defaultBarLabel {
  font-size: 0.85em;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.defaultBarShortcut {
  flex-shrink: 0;
  font-size: 0.7em;
  font-family: var(--nd-font-mono, monospace);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--nd-bg);
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);
  opacity: 0.7;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.searchWrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: 999px;
  background: var(--nd-bg);
  transition: border-color var(--nd-duration-base);

  &:focus-within { border-color: var(--nd-accent); }
}

.searchIcon { opacity: 0.45; flex-shrink: 0; }

.search {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--nd-fg);
  font-size: 0.85em;
}

.searchClear {
  opacity: 0.5;
  &:hover { opacity: 1; }
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.section { flex-shrink: 0; }

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 6px;
  font-size: 0.75em;
  font-weight: bold;
  color: var(--nd-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.sectionTitle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sectionLeadIcon {
  font-size: 0.95em;
  color: var(--nd-accent);
  opacity: 0.9;
}

.countSub {
  font-weight: normal;
  opacity: 0.7;
  margin-left: 4px;
}

.runningPill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  font-size: 0.75em;
  font-weight: normal;
  border-radius: 999px;
  background: color-mix(in srgb, var(--nd-accent) 18%, transparent);
  color: var(--nd-accent);
  text-transform: none;
  letter-spacing: 0;
}

.errorBadge {
  color: var(--nd-love, #c66);
  text-transform: none;
  letter-spacing: 0;
  font-weight: normal;
  opacity: 1;
}

.emptyHint {
  padding: 10px 14px 14px;
  color: var(--nd-fg);
  opacity: 0.55;
  font-size: 0.8em;
  text-align: center;
}

// 各タスクは「実行」ボタン (runBtn) と「AI セッションで実行」trigger
// (aiTrigger) を兄弟関係で並べる。HTML 仕様で button in button は不可
// (内側の click target が外側 button に奪われる) ため、runRow 単位で
// flex 並列にしている。
.runRow {
  display: flex;
  align-items: stretch;
  width: 100%;

  & + & {
    border-top: 1px solid color-mix(in srgb, var(--nd-divider) 40%, transparent);
  }

  &:hover .aiTrigger {
    opacity: 0.7;
  }
}

.runBtn {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  font-size: 0.9em;
  text-align: left;
  color: var(--nd-fgHighlighted);
  transition: background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
}

.runIcon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  font-size: 14px;
}

.runBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.runLabel {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runDesc {
  opacity: 0.55;
  font-size: 0.8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runBadge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  font-size: 0.7em;
  border-radius: 999px;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  opacity: 0.65;
}

// 「AI セッションで実行」trigger。runRow の hover で出現する独立 button。
// 押すとその場で kind='task' な AiSession を新規作成し `tasks.run`
// capability を 1-shot dispatch する (= トグル設定ではなく即実行)。
.aiTrigger {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  border-left: 1px solid color-mix(in srgb, var(--nd-divider) 40%, transparent);
  color: var(--nd-accent);
  font-size: 14px;
  opacity: 0;
  transition:
    background var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:focus-visible {
    opacity: 1;
    outline: 2px solid var(--nd-accent);
    outline-offset: -2px;
  }

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
    opacity: 1;
  }
}

.statusBadge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  font-size: 0.7em;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--nd-fg) 8%, transparent);
  color: var(--nd-fg);
  opacity: 0.75;

  &.statusOk {
    background: color-mix(in srgb, var(--nd-mfmSuccess, #4a8) 14%, transparent);
    color: var(--nd-mfmSuccess, #4a8);
    opacity: 1;
  }
  &.statusError {
    background: color-mix(in srgb, var(--nd-love, #c66) 14%, transparent);
    color: var(--nd-love, #c66);
    opacity: 1;
  }
  &.statusRunning {
    background: color-mix(in srgb, var(--nd-accent) 14%, transparent);
    color: var(--nd-accent);
    opacity: 1;
  }
}

.runItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  font-size: 0.85em;
  text-align: left;
  color: var(--nd-fg);
  transition: background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
  &.selected { background: var(--nd-accent-subtle, var(--nd-buttonHoverBg)); }
  & + & { border-top: 1px solid color-mix(in srgb, var(--nd-divider) 40%, transparent); }
}

.runItemIcon { flex-shrink: 0; }
.statusRunning .runItemIcon { color: var(--nd-accent); }
.statusOk .runItemIcon { color: var(--nd-mfmSuccess, #4a8); }
.statusError .runItemIcon { color: var(--nd-love, #c66); }

.runItemBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.runItemLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runItemMeta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

.method {
  font-family: var(--nd-font-mono, monospace);
  font-size: 0.95em;
}

.runItemTime {
  flex-shrink: 0;
  opacity: 0.55;
  font-size: 0.8em;
}

.statusTag {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.85em;

  &.statusRunning { background: color-mix(in srgb, var(--nd-accent) 18%, transparent); color: var(--nd-accent); }
  &.statusOk { background: color-mix(in srgb, var(--nd-mfmSuccess, #4a8) 18%, transparent); color: var(--nd-mfmSuccess, #4a8); }
  &.statusError { background: color-mix(in srgb, var(--nd-love, #c66) 18%, transparent); color: var(--nd-love, #c66); }
}

.selected { /* modifier */ }

.divider {
  height: 5px;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--nd-divider);
  transition: background var(--nd-duration-fast);

  &:hover,
  &:active {
    background: var(--nd-accent);
  }
}

.detail {
  flex-shrink: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
</style>
