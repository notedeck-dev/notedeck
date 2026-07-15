<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
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

const AiScriptEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/AiScriptEditor.vue'),
)

const props = defineProps<{
  accountId: string
  flashId: string
}>()

const accountsStore = useAccountsStore()
const account = computed(
  () => accountsStore.accounts.find((a) => a.id === props.accountId) ?? null,
)
const serverUrl = computed(() =>
  account.value ? webUiUrl(account.value.host) : '',
)
const toast = useToast()

interface FlashDetail {
  id: string
  title: string
  summary: string
  script: string
  permissions: string[]
  visibility?: string
}

const original = ref<FlashDetail | null>(null)
const editingTitle = ref('')
const editingSummary = ref('')
const editingScript = ref('')

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
    editingSummary.value !== original.value.summary ||
    editingScript.value !== original.value.script
  )
})

const playEditWebUrl = computed(() => {
  if (!serverUrl.value) return undefined
  return `${serverUrl.value}/play/${props.flashId}/edit`
})

useWindowExternalLink(() =>
  playEditWebUrl.value ? { url: playEditWebUrl.value } : null,
)

async function load() {
  fetching.value = true
  fetchError.value = null
  try {
    const detail = unwrap(
      await commands.apiGetFlash(props.accountId, props.flashId),
    ) as unknown as FlashDetail
    original.value = detail
    editingTitle.value = detail.title
    editingSummary.value = detail.summary
    editingScript.value = detail.script
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
  try {
    unwrap(
      await commands.apiUpdateFlash(props.accountId, {
        flashId: original.value.id,
        title: editingTitle.value,
        summary: editingSummary.value,
        script: editingScript.value,
        permissions: original.value.permissions ?? [],
      } as never),
    )
    original.value.title = editingTitle.value
    original.value.summary = editingSummary.value
    original.value.script = editingScript.value
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
        <AiScriptEditor v-model="editingScript" auto-height />
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

.metaPanel,
.codePanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
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
