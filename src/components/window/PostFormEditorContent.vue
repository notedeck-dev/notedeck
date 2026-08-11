<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import JSON5 from 'json5'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  ref,
  toRaw,
  watch,
} from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import type { ReorderableItem } from '@/components/common/ReorderableList.vue'
import ReorderableList from '@/components/common/ReorderableList.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { usePointerReorder } from '@/composables/usePointerReorder'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { isExposed } from '@/settings/exposure'
import {
  ALL_POST_FORM_BUTTONS,
  DEFAULT_POST_FORM_BUTTONS,
  POST_FORM_BUTTON_META,
  type PostFormButtonId,
  usePostFormStore,
} from '@/stores/postForm'
import { useIsCompactLayout } from '@/stores/ui'

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const postFormStore = usePostFormStore()
const isCompact = useIsCompactLayout()
const jsonLang = json()

const props = defineProps<{
  initialTab?: string
}>()

// 生ファイルを直接編集する code タブは開発者向けの面 (#1034)。アピアランス /
// キーバインド / テーマ / 権限と同じ宣言的 opt-in
const editorTabs = computed(() =>
  isExposed('developer')
    ? (['visual', 'code'] as const)
    : (['visual'] as const),
)

const { tab, containerRef: contentRef } = useEditorTabs<'visual' | 'code'>(
  editorTabs,
  props.initialTab === 'code' && !isExposed('developer')
    ? 'visual'
    : ((props.initialTab as 'visual' | 'code') ?? 'visual'),
)

useWindowExternalFile(() =>
  tab.value === 'code' ? { name: 'postform.json5' } : null,
)

const items = ref<PostFormButtonId[]>([
  ...structuredClone(toRaw(postFormStore.buttons)),
])

let skipSave = false

watch(
  items,
  (v) => {
    if (skipSave) return
    postFormStore.setButtons([...v])
  },
  { deep: true },
)

const availableButtons = computed(() =>
  ALL_POST_FORM_BUTTONS.filter((id) => !items.value.includes(id)),
)

function removeItem(index: number) {
  items.value.splice(index, 1)
}

function addItem(id: PostFormButtonId) {
  if (items.value.includes(id)) return
  items.value.push(id)
}

function onReorder(fromIdx: number, toIdx: number) {
  const arr = [...items.value]
  const [moved] = arr.splice(fromIdx, 1)
  if (moved !== undefined) {
    arr.splice(toIdx, 0, moved)
    items.value = arr
  }
}

const reorderableItems = computed<ReorderableItem[]>(() =>
  items.value.map((id) => ({
    icon: POST_FORM_BUTTON_META[id].icon,
    label: POST_FORM_BUTTON_META[id].label,
  })),
)

const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: 'pf-idx',
  onReorder,
})

// ── Code tab ──
function itemsToJson(): string {
  if (!postFormStore.isCustomized) return 'null'
  return JSON5.stringify(items.value, null, 2)
}

const jsonCode = ref(itemsToJson())
const codeError = ref<string | null>(null)

watch(tab, (t) => {
  if (t === 'code') {
    jsonCode.value = itemsToJson()
    codeError.value = null
  }
})

watch(items, () => {
  if (tab.value === 'code') {
    const current = itemsToJson()
    if (current !== jsonCode.value) jsonCode.value = current
  }
})

function applyFromCode() {
  try {
    const parsed = JSON5.parse(jsonCode.value)
    if (parsed === null) {
      skipSave = true
      items.value = [...DEFAULT_POST_FORM_BUTTONS]
      postFormStore.setButtons(undefined)
      nextTick(() => {
        skipSave = false
      })
      codeError.value = null
      return
    }
    if (!Array.isArray(parsed)) {
      codeError.value = '配列または null が必要です'
      return
    }
    const filtered = parsed.filter(
      (x): x is PostFormButtonId =>
        typeof x === 'string' &&
        (ALL_POST_FORM_BUTTONS as string[]).includes(x),
    )
    items.value = [...new Set(filtered)]
    codeError.value = null
  } catch (e) {
    codeError.value = e instanceof Error ? e.message : '無効な JSON5'
  }
}

// ── Actions ──
const { copied: copiedMessage, showCopied } = useClipboardFeedback()
const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()

function handleReset() {
  triggerReset(() => {
    skipSave = true
    items.value = [...DEFAULT_POST_FORM_BUTTONS]
    postFormStore.setButtons(undefined)
    nextTick(() => {
      skipSave = false
    })
  })
}

async function exportList() {
  try {
    await navigator.clipboard.writeText(itemsToJson())
    showCopied()
  } catch {
    /* clipboard access denied */
  }
}

async function importList() {
  try {
    const text = await navigator.clipboard.readText()
    const parsed = JSON5.parse(text)
    if (!Array.isArray(parsed)) return
    const filtered = parsed.filter(
      (x): x is PostFormButtonId =>
        typeof x === 'string' &&
        (ALL_POST_FORM_BUTTONS as string[]).includes(x),
    )
    items.value = [...new Set(filtered)]
  } catch {
    /* clipboard access denied or invalid */
  }
}
</script>

<template>
  <div ref="contentRef" :class="$style.editor">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'adjustments', label: 'ビジュアル' },
        ...(isExposed('developer')
          ? [{ value: 'code', icon: 'code', label: 'コード' }]
          : []),
      ]"
    />

    <!-- Visual tab -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <div :class="$style.sectionHeader">
        <i class="ti ti-list" />
        現在の並び
        <span :class="$style.sectionBadge">{{ items.length }}</span>
      </div>

      <!-- Mobile: row list -->
      <ReorderableList
        v-if="isCompact"
        :items="reorderableItems"
        data-attr="pf-idx"
        empty-text="ボタンなし"
        @reorder="onReorder"
        @remove="removeItem"
      />

      <!-- Desktop: horizontal preview with drag -->
      <div v-else :class="$style.rowPreview">
        <div
          v-for="(id, i) in items"
          :key="id"
          :data-pf-idx="i"
          :class="[
            $style.btn,
            {
              [$style.dragging]: dragFromIndex === i,
              [$style.dragOver]: dragOverIndex === i,
            },
          ]"
          :title="POST_FORM_BUTTON_META[id].label"
          @pointerdown="startDrag(i, $event)"
        >
          <i :class="['ti', `ti-${POST_FORM_BUTTON_META[id].icon}`]" />
          <button class="_button" :class="$style.removeBtn" @click.stop="removeItem(i)">
            <i class="ti ti-x" />
          </button>
        </div>
        <div v-if="items.length === 0" :class="$style.empty">ボタンなし</div>
      </div>

      <div :class="$style.sectionHeader">
        <i class="ti ti-plus" />
        追加できるボタン
      </div>

      <div :class="$style.addGrid">
        <button
          v-for="id in availableButtons"
          :key="id"
          class="_button"
          :class="$style.addBtn"
          @click="addItem(id)"
        >
          <i :class="['ti', `ti-${POST_FORM_BUTTON_META[id].icon}`]" />
          <span>{{ POST_FORM_BUTTON_META[id].label }}</span>
        </button>
        <div v-if="availableButtons.length === 0" :class="$style.empty">
          すべてのボタンが追加済み
        </div>
      </div>
    </div>

    <!-- Code tab -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        デフォルト値からの差分 — null はデフォルト設定を使用
      </div>
      <CodeEditor
        v-model="jsonCode"
        :language="jsonLang"
        :class="[$style.codeEditorWrap, { [$style.hasError]: codeError }]"
        auto-height
      />
      <div v-if="codeError" :class="$style.errorMessage">
        <i class="ti ti-alert-triangle" />
        {{ codeError }}
      </div>
      <div
        v-if="!codeError && jsonCode.trim() && jsonCode.trim() !== '[]' && jsonCode.trim() !== 'null'"
        :class="$style.codeSuccess"
      >
        <i class="ti ti-check" />
        適用中
      </div>
      <button class="_button" :class="$style.codeApplyBtn" @click="applyFromCode">
        <i class="ti ti-refresh" />
        ビジュアルに同期
      </button>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary]"
          @click="importList"
        >
          <i class="ti ti-clipboard-text" />
          インポート
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportList"
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
        {{ confirmingReset ? '本当にリセット？' : 'デフォルトに戻す' }}
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

.visualPanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px 6px;
  font-size: 0.75em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.sectionBadge {
  margin-left: auto;
  font-weight: normal;
  opacity: 0.8;
}

.rowPreview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 12px 12px;
}

.btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  color: var(--nd-fg);
  cursor: grab;
  user-select: none;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.dragging {
    opacity: 0.3;
    cursor: grabbing;
  }

  &.dragOver {
    outline: 2px solid var(--nd-accent);
    outline-offset: 1px;
  }
}

.removeBtn {
  position: absolute;
  top: -4px;
  right: -4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--nd-panel);
  font-size: 9px;
  color: var(--nd-fg);
  opacity: 0;
  transition: opacity var(--nd-duration-fast);

  .btn:hover & {
    opacity: 1;
  }

  &:hover {
    color: var(--nd-love, #ec4137);
  }
}

.addGrid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 12px 12px;
}

.addBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--nd-panel);
  border-radius: var(--nd-radius-sm);
  font-size: 0.85em;
  color: var(--nd-fg);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.empty {
  padding: 8px 12px;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.75em;
}

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
  opacity: 0.5;
}

.codeEditorWrap {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);

  &.hasError {
    border-color: var(--nd-love, #ec4137);
  }
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-love, #ec4137);
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-accent);
  opacity: 0.7;
}

.codeApplyBtn {
  @include btn-secondary;
}

.actions {
  @include action-bar;
}

.actionGroup {
  @include action-group;
}

.actionBtn {
  &.secondary {
    @include btn-action;
  }

  &.danger {
    @include btn-danger-ghost;
  }
}

.secondary {
  /* modifier */
}

.feedback {
  /* modifier */
}

.danger {
  /* modifier */
}

.confirming {
  /* modifier */
}
</style>
