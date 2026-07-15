<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { JsonValue } from '@/bindings'
import EditorTabs, {
  type EditorTabDef,
} from '@/components/common/EditorTabs.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { webUiUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  pageId: string
}>()

const accountsStore = useAccountsStore()
const account = computed(
  () => accountsStore.accounts.find((a) => a.id === props.accountId) ?? null,
)
const serverUrl = computed(() =>
  account.value ? webUiUrl(account.value.host) : '',
)
const toast = useToast()

interface PageBlock {
  id: string
  type: string
  text?: string
  // biome-ignore lint: AiScript page block varies
  [key: string]: any
}

interface PageDetail {
  id: string
  title: string
  name: string
  summary: string | null
  content: PageBlock[]
  variables: unknown[]
  script: string
  alignCenter?: boolean
  hideTitleWhenPinned?: boolean
  font?: string
  eyeCatchingImageId?: string | null
}

function extractMfm(blocks: PageBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n\n')
}

const original = ref<PageDetail | null>(null)
const editingTitle = ref('')
const editingSummary = ref('')
const editingBody = ref('')

const fetching = ref(false)
const fetchError = ref<string | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)

const { tab, containerRef: editorRef } = useEditorTabs(
  ['meta', 'code'] as const,
  'meta',
)

const tabDefs: EditorTabDef[] = [
  { value: 'meta', icon: 'info-circle', label: '概要' },
  { value: 'code', icon: 'code', label: 'コード' },
]

const dirty = computed(() => {
  if (!original.value) return false
  return (
    editingTitle.value !== original.value.title ||
    editingSummary.value !== (original.value.summary ?? '') ||
    editingBody.value !== extractMfm(original.value.content)
  )
})

const pageEditWebUrl = computed(() => {
  if (!serverUrl.value) return undefined
  return `${serverUrl.value}/pages/edit/${props.pageId}`
})

useWindowExternalLink(() =>
  pageEditWebUrl.value ? { url: pageEditWebUrl.value } : null,
)

async function load() {
  fetching.value = true
  fetchError.value = null
  try {
    const detail = unwrap(
      await commands.apiGetPage(props.accountId, props.pageId),
    ) as unknown as PageDetail
    original.value = detail
    editingTitle.value = detail.title
    editingSummary.value = detail.summary ?? ''
    editingBody.value = extractMfm(detail.content)
  } catch (e) {
    fetchError.value = AppError.from(e).message
  } finally {
    fetching.value = false
  }
}

async function save() {
  if (!original.value || saving.value || !dirty.value) return
  saving.value = true
  saveError.value = null
  saved.value = false

  // 既存の text block の id を流用 (なければ新規生成) して 1 ブロックに統合
  const firstTextBlock = original.value.content.find((b) => b.type === 'text')
  const blockId =
    firstTextBlock?.id ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const newContent: PageBlock[] = [
    { id: blockId, type: 'text', text: editingBody.value },
  ]

  try {
    unwrap(
      await commands.apiUpdatePage(props.accountId, {
        pageId: original.value.id,
        title: editingTitle.value,
        name: original.value.name,
        summary: editingSummary.value || null,
        content: newContent,
        variables: original.value.variables,
        script: original.value.script,
        alignCenter: original.value.alignCenter ?? false,
        hideTitleWhenPinned: original.value.hideTitleWhenPinned ?? false,
        font: original.value.font ?? 'sans-serif',
        eyeCatchingImageId: original.value.eyeCatchingImageId ?? null,
      } as never),
    )
    original.value.title = editingTitle.value
    original.value.summary = editingSummary.value || null
    original.value.content = newContent
    saved.value = true
    toast.show('保存しました', 'success')
    setTimeout(() => {
      saved.value = false
    }, 2000)
  } catch (e) {
    saveError.value = AppError.from(e).message
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div ref="editorRef" :class="$style.root">
    <div v-if="fetching" :class="$style.loading"><LoadingSpinner /></div>
    <div v-else-if="fetchError" :class="$style.error">{{ fetchError }}</div>
    <template v-else-if="original">
      <EditorTabs v-model="tab" :tabs="tabDefs" />

      <div v-show="tab === 'meta'" :class="$style.metaPanel">
        <div :class="$style.field">
          <label :class="$style.label">タイトル</label>
          <input v-model="editingTitle" :class="$style.input" type="text" />
        </div>
        <div :class="$style.field">
          <label :class="$style.label">概要</label>
          <textarea v-model="editingSummary" :class="$style.textarea" />
        </div>
      </div>

      <div v-show="tab === 'code'" :class="$style.codePanel">
        <textarea v-model="editingBody" :class="$style.body" />
      </div>

      <div v-if="saveError" :class="$style.error">{{ saveError }}</div>

      <div :class="$style.actions">
        <button
          class="_button"
          :class="$style.saveBtn"
          :disabled="!dirty || saving"
          @click="save"
        >
          <i class="ti ti-device-floppy" />
          {{ saving ? '保存中...' : saved ? '保存しました' : '保存' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.loading {
  padding: 24px;
  text-align: center;
  opacity: 0.7;
}

.error {
  margin: 12px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-love-subtle);
  color: var(--nd-love);
  font-size: 0.85em;
  white-space: pre-wrap;
}

.metaPanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.codePanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 0.8em;
  opacity: 0.7;
  font-weight: 600;
}

.input,
.textarea {
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.9em;
  font-family: inherit;
}

.textarea {
  min-height: 80px;
  resize: vertical;
}

.body {
  flex: 1;
  min-height: 320px;
  padding: 10px 12px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.95em;
  line-height: 1.6;
  font-family: inherit;
  resize: none;
}

.actions {
  margin-top: auto;
  padding: 12px 16px;
  border-top: 1px solid var(--nd-divider);
  display: flex;
  justify-content: flex-end;
}

.saveBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-accent);
  color: #fff;
  font-size: 0.9em;
  font-weight: 600;
  transition: opacity var(--nd-duration-base);

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  &:not(:disabled):hover {
    opacity: 0.85;
  }
}
</style>
