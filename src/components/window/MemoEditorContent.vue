<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import MemoCard from '@/components/common/MemoCard.vue'
import PopupMenu from '@/components/common/PopupMenu.vue'
import { saveDraft } from '@/composables/useDrafts'
import { useEditorTabs } from '@/composables/useEditorTabs'
import {
  deleteMemo,
  ensureMemosLoaded,
  loadMemo,
  type MemoData,
  memosVersion,
  saveMemo,
} from '@/composables/useMemos'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useServersStore } from '@/stores/servers'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const props = defineProps<{
  accountId: string
  memoKey: string
  initialTab?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { confirm } = useConfirm()
const toast = useToast()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()

const lang = markdown()

// ── Tab management (shared with keybinds / tasks editors) ──
const { tab, containerRef: contentRef } = useEditorTabs(
  ['visual', 'code'] as const,
  (props.initialTab as 'visual' | 'code') ?? 'visual',
)

const loaded = ref(false)
const localText = ref('')
/** Ignore the next `memo` change we triggered ourselves to avoid a save echo loop. */
let pendingEcho = 0

const memo = computed(() => {
  void memosVersion.value
  return loadMemo(props.accountId, props.memoKey)
})

const account = computed<Account | undefined>(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)

const serverNotFoundImageUrl = computed(() => {
  const host = account.value?.host
  if (!host) return undefined
  return serversStore.getServer(host)?.notFoundImageUrl
})

const author = computed(() => {
  // memo.data.author 埋め込み (#493) があれば persona の身元を表示
  // (例: `唯 (@yui)`)。なければ保存先 account の `@user@host`。
  const embedded = memo.value?.data.author
  if (embedded) {
    const handle = embedded.id.replace(/^skill:/, '')
    return `${embedded.displayName} (@${handle})`
  }
  const acc = account.value
  if (!acc) return null
  return `@${acc.username}@${acc.host}`
})

const updatedAt = computed(() => {
  const iso = memo.value?.updatedAt
  if (!iso) return null
  return new Date(iso).toLocaleString()
})

const notFound = computed(() => loaded.value && !memo.value)

// Expose this memo's file to the window header's "外部エディタで開く" button
// (only meaningful in the code tab — but harmless in visual).
useWindowExternalFile(() => ({
  name: `${props.memoKey}.md`,
  subdir: 'memos',
}))

// Initial load: populate the editor once memos are available.
watch(
  () => [props.accountId, props.memoKey],
  async () => {
    loaded.value = false
    await ensureMemosLoaded()
    const m = loadMemo(props.accountId, props.memoKey)
    localText.value = m?.data.text ?? ''
    loaded.value = true
  },
  { immediate: true },
)

// Pull in external mutations to this memo (e.g., external editor save).
watch(memo, (m) => {
  if (!loaded.value || !m) return
  if (pendingEcho > 0) {
    pendingEcho--
    return
  }
  if (m.data.text !== localText.value) {
    localText.value = m.data.text
  }
})

// Debounced write-back to the store.
let saveTimer: ReturnType<typeof setTimeout> | null = null
function onTextUpdate(next: string) {
  localText.value = next
  if (!loaded.value) return
  if (!memo.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const current = memo.value
    if (!current) return
    const data: MemoData = { ...current.data, text: localText.value }
    pendingEcho++
    saveMemo(props.accountId, props.memoKey, data)
  }, 200)
}

// ── Context menu on the visual preview (mirrors DeckMemoColumn's menu) ──
const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()

function onContextMenu(e: MouseEvent) {
  if (!memo.value) return
  e.preventDefault()
  e.stopPropagation()
  popupMenuRef.value?.open(e)
}

function closeMenu() {
  popupMenuRef.value?.close()
}

async function onPromoteToDraft() {
  closeMenu()
  const m = memo.value
  if (!m) return
  try {
    await saveDraft(props.accountId, null, { ...m.data })
  } catch (e) {
    toast.show(`下書き化に失敗しました: ${AppError.from(e).message}`, 'error')
    return
  }
  deleteMemo(props.accountId, props.memoKey)
  toast.show('下書きに変換しました', 'info')
  emit('close')
}

async function onDelete() {
  closeMenu()
  const ok = await confirm({
    title: 'メモを削除',
    message: '選択したメモを削除しますか？',
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  deleteMemo(props.accountId, props.memoKey)
  toast.show('メモを削除しました', 'info')
  emit('close')
}
</script>

<template>
  <div ref="contentRef" :class="$style.memoEditor">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'eye', label: 'ビジュアル' },
        { value: 'code', icon: 'code', label: 'コード' },
      ]"
    />

    <div v-if="tab === 'code'" :class="$style.meta">
      <div :class="$style.metaRow">
        <span :class="$style.metaKey">id</span>
        <span :class="$style.metaValue">{{ memoKey }}.md</span>
      </div>
      <div v-if="author" :class="$style.metaRow">
        <span :class="$style.metaKey">author</span>
        <span :class="$style.metaValue">{{ author }}</span>
      </div>
      <div v-if="updatedAt" :class="$style.metaRow">
        <span :class="$style.metaKey">updated</span>
        <span :class="$style.metaValue">{{ updatedAt }}</span>
      </div>
    </div>

    <!-- Visual tab: rendered preview -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <div v-if="!loaded" :class="$style.placeholder">読み込み中…</div>
      <ColumnEmptyState
        v-else-if="notFound"
        message="このメモは見つかりません"
        :image-url="serverNotFoundImageUrl"
        fallback-kind="notFound"
      />
      <!-- 右クリックでメモメニューを開く。click は MemoCard 内 (avatar /
           もっと見る等) の handler に委ねる。 -->
      <div
        v-else-if="memo && account"
        :class="$style.previewWrap"
        @contextmenu.capture="onContextMenu"
      >
        <MemoCard :account="account" :memo="memo" />
      </div>
    </div>

    <!-- Code tab: raw Markdown editor -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div v-if="!loaded" :class="$style.placeholder">読み込み中…</div>
      <ColumnEmptyState
        v-else-if="notFound"
        message="このメモは見つかりません"
        :image-url="serverNotFoundImageUrl"
        fallback-kind="notFound"
      />
      <CodeEditor
        v-else
        :model-value="localText"
        :language="lang"
        :class="$style.editor"
        @update:model-value="onTextUpdate"
      />
    </div>

    <PopupMenu ref="popupMenuRef">
      <button class="_popupItem" @click="onPromoteToDraft">
        <i class="ti ti-send" />
        下書きにする
      </button>
      <div class="_popupDivider" />
      <button class="_popupItem _popupItemDanger" @click="onDelete">
        <i class="ti ti-trash" />
        削除
      </button>
    </PopupMenu>
  </div>
</template>

<style lang="scss" module>
.memoEditor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--nd-bg);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--nd-divider);
  font-size: 0.78em;
  background: var(--nd-panelBg, var(--nd-bg));
}

.metaRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.metaKey {
  width: 64px;
  flex-shrink: 0;
  opacity: 0.55;
  font-family: var(--nd-font-mono, monospace);
}

.metaValue {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--nd-font-mono, monospace);
}

.visualPanel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

// NoteDetailContent.focalNote 風の装飾だが border-top は EditorTabs の
// border-bottom と二重になるので省略 (= EditorTabs の divider が
// focal 上端の役割を兼ねる)。
.previewWrap {
  background: var(--nd-panelHighlight);
}

.codePanel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor {
  flex: 1;
  min-width: 0;
}

.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0.7;
  font-size: 0.9em;
  padding: 24px;
  text-align: center;
}

</style>
