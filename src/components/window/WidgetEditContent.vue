<script setup lang="ts">
import { type Ast, type Interpreter, Parser } from '@syuilo/aiscript'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import { createAiScriptEnv } from '@/aiscript/api'
import {
  createAiScriptInterpreter,
  createInterpreterOptions,
} from '@/aiscript/common'
import {
  cleanupNoteDeckEnv,
  createNoteDeckEnv,
  type NoteDeckEnvContext,
} from '@/aiscript/notedeck-api'
import { sanitizeCode } from '@/aiscript/sanitize'
import { createAiScriptUiLib, type UiComponent } from '@/aiscript/ui'
import type { JsonValue } from '@/bindings'
import { useCommandStore } from '@/commands/registry'
import AiScriptDialog from '@/components/common/AiScriptDialog.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import AiScriptEditor from '@/components/deck/widgets/AiScriptEditor.vue'
import AiScriptUiRenderer, {
  type PostFormRequest,
} from '@/components/deck/widgets/AiScriptUiRenderer.vue'
import type { EditorActionStatus } from '@/components/window/EditorActionBar.vue'
import EditorActionBar from '@/components/window/EditorActionBar.vue'
import {
  historyBasename,
  openEditHistoryWindow,
} from '@/composables/useEditHistoryWindow'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { usePortal } from '@/composables/usePortal'
import { useWindowEditAction } from '@/composables/useWindowEditAction'
import { providerFromPrincipal } from '@/plugins/registrationId'
import { useAccountsStore } from '@/stores/accounts'
import { useAiScriptLogsStore } from '@/stores/aiscriptLogs'
import { useToast } from '@/stores/toast'
import { useWidgetsStore } from '@/stores/widgets'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

const props = defineProps<{
  widgetId: string
  accountId?: string | null
}>()

defineEmits<{
  close: []
}>()

const widgetsStore = useWidgetsStore()
widgetsStore.ensureLoaded()
const accountsStore = useAccountsStore()
const commandStore = useCommandStore()
const { show: showToast } = useToast()

const widget = computed(() => widgetsStore.getWidget(props.widgetId))

const activeAccountId = computed(() => props.accountId ?? null)
const serverUrl = computed(() => {
  const id = activeAccountId.value
  if (!id) return ''
  const a = accountsStore.accounts.find((acc) => acc.id === id)
  return a ? `https://${a.host}` : ''
})

const code = ref(widget.value?.src ?? '')

// debounce save (= WidgetAiScript と同じ仕組み)
let saveTimer: ReturnType<typeof setTimeout> | null = null
const dirty = ref(false)
const saved = ref(false)

function commitSave(src: string) {
  if (!widget.value) return
  widgetsStore.updateSrc(widget.value.installId, src)
  dirty.value = false
  saved.value = true
  setTimeout(() => {
    saved.value = false
  }, 1500)
}

function flushPendingSave() {
  if (saveTimer && widget.value) {
    clearTimeout(saveTimer)
    saveTimer = null
    commitSave(code.value)
  }
}
watch(code, (val) => {
  if (!widget.value) return
  if (syncingFromStore) return
  dirty.value = true
  saved.value = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    commitSave(val)
  }, 500)
})
onBeforeUnmount(flushPendingSave)

/**
 * 外部からの src 変更 (履歴からの revert / AI 編集 / 外部エディタ) を編集
 * バッファへ取り込む。無いと表示が開いた瞬間のままで、次の打鍵で古い内容が
 * 書き戻される。未保存の編集があるときはユーザーのバッファを優先する。
 */
let syncingFromStore = false
watch(
  () => widget.value?.src,
  (src) => {
    if (src === undefined || src === code.value) return
    if (dirty.value) return
    syncingFromStore = true
    code.value = src
    void nextTick(() => {
      syncingFromStore = false
    })
  },
)

/**
 * 自動保存の状態。デバウンス保存なので「いま保存されているか」が
 * 見えないと不安になる。明示保存ボタンは同じバーの右端に置く。
 */
/** AI が過去に何を変えたかを diff で追う (#981)。 */
function openHistory() {
  const w = widget.value
  if (!w) return
  openEditHistoryWindow({
    kind: 'widget',
    basename: historyBasename(w.fileBase, w.name, w.installId),
    itemId: w.installId,
    name: w.name,
  })
}

const barStatus = computed<EditorActionStatus | null>(() => {
  if (saved.value) return { text: '保存しました', icon: 'check', tone: 'ok' }
  if (dirty.value) return { text: '未保存の変更', icon: 'pencil' }
  return null
})

// --- Tabs ---
const tabs = ['code', 'visual'] as const
const { tab, containerRef } = useEditorTabs(tabs, 'code')
const tabDefs = computed(() => [
  { value: 'code', icon: 'code', label: 'コード' },
  { value: 'visual', icon: 'eye', label: 'ビジュアル' },
])

// --- Run ---
const interpreter = ref<Interpreter | null>(null)
const uiComponents = ref<UiComponent[]>([])
const output = ref<{ text: string; isError: boolean }[]>([])
const error = ref<string | null>(null)
const running = ref(false)
const dialogRef = ref<InstanceType<typeof AiScriptDialog> | null>(null)
let currentNdCtx: Parameters<typeof cleanupNoteDeckEnv>[0] | null = null

const postFormPortalRef = useTemplateRef<HTMLElement>('postFormPortalRef')
usePortal(postFormPortalRef)
const showPostForm = ref(false)
const postFormData = ref<PostFormRequest>({})

function handlePost(form: PostFormRequest) {
  if (!activeAccountId.value) return
  postFormData.value = form
  showPostForm.value = true
}

function closePostForm() {
  showPostForm.value = false
  postFormData.value = {}
}

async function run() {
  if (running.value || !widget.value) return
  flushPendingSave()
  running.value = true
  error.value = null
  uiComponents.value = []
  output.value = []
  tab.value = 'visual'

  const accId = activeAccountId.value
  const apiOption = accId
    ? async (endpoint: string, params: Record<string, unknown>) =>
        unwrap(await commands.apiRequest(accId, endpoint, params as JsonValue))
    : undefined

  const runLog = useAiScriptLogsStore().beginRun(
    'widget',
    props.widgetId,
    widget.value.name,
  )

  const parser = new Parser()
  let ast: Ast.Node[]
  try {
    ast = parser.parse(sanitizeCode(code.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    runLog.system(`parse error: ${error.value}`)
    running.value = false
    return
  }

  const env = createAiScriptEnv(
    {
      principal: {
        kind: 'plugin',
        pluginId: `widget:${props.widgetId}`,
        name: widget.value.name,
      } as const,
      api: apiOption,
      storagePrefix: `app-${widget.value.installId}`,
      onDialog: (title, text, type) =>
        dialogRef.value?.showDialog(title, text, type) ?? Promise.resolve(),
      onConfirm: (title, text) =>
        dialogRef.value?.showConfirm(title, text) ?? Promise.resolve(false),
      onToast: (text, type) => showToast(text, type),
    },
    {
      THIS_ID: widget.value.installId,
      THIS_URL: '',
      USER_ID:
        accountsStore.accounts.find((a) => a.id === activeAccountId.value)
          ?.userId ?? '',
      USER_NAME: '',
      USER_USERNAME: '',
      LOCALE: navigator.language,
      SERVER_URL: serverUrl.value,
    },
  )

  const ui = createAiScriptUiLib({
    onRender: (components) => {
      uiComponents.value = components
    },
  })

  const ioOpts = createInterpreterOptions({
    onOutput: (text) => {
      output.value.push({ text, isError: false })
      runLog.print(text)
    },
    onError: (err) => {
      error.value = err.message
      output.value.push({ text: err.message, isError: true })
      runLog.error(err.message)
    },
  })

  if (currentNdCtx) cleanupNoteDeckEnv(currentNdCtx)
  const ndCtx: NoteDeckEnvContext = {
    commandStore,
    // 編集プレビューも実行するコードは同一なので widget と同じ principal
    principal: {
      kind: 'plugin',
      pluginId: `widget:${props.widgetId}`,
      name: widget.value.name,
    },
    provider: providerFromPrincipal(
      { kind: 'plugin', pluginId: `widget:${props.widgetId}` },
      widget.value.storeId,
    ),
    disposers: [],
    getAccountId: () => activeAccountId.value,
  }
  const ndEnv = createNoteDeckEnv(ndCtx)
  currentNdCtx = ndCtx

  const interp = createAiScriptInterpreter(
    { ...env, ...ndEnv, ...ui },
    ioOpts,
    false,
  )
  ndCtx.interpreter = interp
  interpreter.value = interp

  try {
    await interp.exec(ast)
    runLog.system('run completed')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    runLog.system(`run aborted: ${error.value}`)
  }

  running.value = false
}

onBeforeUnmount(() => {
  if (currentNdCtx) cleanupNoteDeckEnv(currentNdCtx)
})

onMounted(() => {
  if (widget.value?.autoRun && code.value) run()
})

// --- Window header の「実行」ボタン (= editAction として登録) ---
useWindowEditAction(() =>
  widget.value
    ? {
        onClick: () => run(),
        title: '実行',
        icon: 'player-play',
        disabled: running.value,
      }
    : null,
)

// --- Rename ---
const isRenaming = ref(false)
const renamingValue = ref('')
function startRename() {
  if (!widget.value) return
  renamingValue.value = widget.value.name
  isRenaming.value = true
}
function commitRename() {
  if (!widget.value) return
  const v = renamingValue.value.trim()
  if (v && v !== widget.value.name) {
    widgetsStore.renameWidget(widget.value.installId, v)
  }
  isRenaming.value = false
}
function cancelRename() {
  isRenaming.value = false
}

function toggleAutoRun() {
  if (!widget.value) return
  widgetsStore.setAutoRun(widget.value.installId, !widget.value.autoRun)
}
</script>

<template>
  <div ref="containerRef" :class="$style.root">
    <!-- Header (= PluginsContent と同型) -->
    <div v-if="widget" :class="$style.header">
      <div :class="$style.headerIcon">
        <span
          v-if="isProxiable(widget.iconUrl)"
          :class="$style.headerIconImg"
          :style="{ '--icon-url': proxyCssUrl(widget.iconUrl, 48) }"
          aria-hidden="true"
        />
        <i v-else class="ti ti-layout-dashboard" />
      </div>
      <div :class="$style.headerMeta">
        <div v-if="isRenaming" :class="$style.renameRow">
          <input
            v-model="renamingValue"
            :class="$style.renameInput"
            type="text"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
            @blur="commitRename"
          />
        </div>
        <div v-else :class="$style.nameRow">
          <span :class="$style.headerName">{{ widget.name }}</span>
          <button class="_button" :class="$style.renameBtn" title="名前を変更" @click="startRename">
            <i class="ti ti-pencil" />
          </button>
        </div>
        <div :class="$style.headerSub">
          <span v-if="widget.storeId" :class="$style.statusBadge">ストア</span>
          <span v-else :class="[$style.statusBadge, $style.statusBadgeLocal]">ローカル</span>
          <button
            class="_button"
            :class="[$style.autoRunBtn, widget.autoRun && $style.autoRunBtnActive]"
            :title="widget.autoRun ? '自動実行: 有効 (クリックで切替)' : '自動実行: 無効 (クリックで切替)'"
            @click="toggleAutoRun"
          >
            <i :class="widget.autoRun ? 'ti ti-clock-play' : 'ti ti-clock-off'" />
            <span>{{ widget.autoRun ? '自動実行 ON' : '自動実行 OFF' }}</span>
          </button>
        </div>
      </div>
    </div>
    <div v-else :class="$style.notFound">
      <i class="ti ti-alert-circle" />
      ウィジットが見つかりません
    </div>

    <EditorTabs v-if="widget" v-model="tab" :tabs="tabDefs" />

    <AiScriptDialog ref="dialogRef" />

    <div v-if="widget" :class="$style.tabBody">
      <template v-if="tab === 'code'">
        <AiScriptEditor v-model="code" placeholder="AiScript App code..." :class="$style.codeEditor" />
      </template>
      <template v-else>
        <div v-if="error" :class="$style.appError">{{ error }}</div>
        <AiScriptUiRenderer
          v-if="uiComponents.length"
          :components="uiComponents"
          :interpreter="(interpreter as Interpreter | null)"
          :server-url="serverUrl"
          @post="handlePost"
        />
        <div v-else-if="!error" :class="$style.visualEmpty">
          <i class="ti ti-player-play" :class="$style.visualEmptyIcon" />
          <span>右上の実行ボタンでウィジットを実行</span>
        </div>
        <details v-if="output.length" :class="$style.outputPanel">
          <summary>出力 ({{ output.length }})</summary>
          <div
            v-for="(line, i) in output"
            :key="i"
            :class="[$style.outputLine, { [$style.outputError]: line.isError }]"
          >
            {{ line.text }}
          </div>
        </details>
      </template>
    </div>

    <EditorActionBar
      v-if="widget"
      :status="barStatus"
      :actions="[{ key: 'history', label: '履歴', icon: 'history' }]"
      :primary="{
        key: 'save',
        label: '保存',
        icon: 'device-floppy',
        disabled: !dirty,
      }"
      @action="(key) => (key === 'history' ? openHistory() : flushPendingSave())"
    />

    <div v-if="showPostForm && activeAccountId" ref="postFormPortalRef">
      <MkPostForm
        :account-id="activeAccountId"
        :initial-text="postFormData.text"
        :initial-cw="postFormData.cw"
        :initial-visibility="postFormData.visibility"
        :initial-local-only="postFormData.localOnly"
        @close="closePostForm"
        @posted="closePostForm"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--nd-panel);
  color: var(--nd-fg);
}

.notFound {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 13px;
}

// --- Header (PluginsContent 模倣) ---
.header {
  display: flex;
  gap: 12px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.headerIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  color: var(--nd-accent);
  font-size: 24px;
}

.headerIconImg {
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.headerMeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nameRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.headerName {
  font-size: 1.05em;
  font-weight: 700;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.renameBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0;
  font-size: 0.85em;
  transition:
    opacity var(--nd-duration-fast),
    background var(--nd-duration-fast);

  .nameRow:hover & {
    opacity: 0.5;
  }

  // hover だけだとキーボードでは「見えないボタン」に Tab することになる
  &:hover,
  &:focus-visible {
    opacity: 1 !important;
    background: var(--nd-buttonHoverBg);
  }
}

.renameRow {
  display: flex;
}

.renameInput {
  flex: 1;
  padding: 2px 6px;
  border: 1px solid var(--nd-accent);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-inputBg, var(--nd-bg));
  color: var(--nd-fgHighlighted);
  font-size: 1.05em;
  font-weight: 700;

  &:focus {
    outline: none;
  }
}

.headerSub {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: 6px;
}

.statusBadge {
  font-size: 0.85em;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  line-height: 1.6;
}

.statusBadgeLocal {
  background: color-mix(in srgb, var(--nd-fg) 12%, transparent);
  color: var(--nd-fg);
  opacity: 0.85;
}

.autoRunBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 18px;
  border-radius: 8px;
  border: 1px solid var(--nd-divider);
  background: transparent;
  color: var(--nd-fg);
  font-size: 0.85em;
  opacity: 0.7;
  transition: opacity 0.1s, background 0.1s;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.autoRunBtnActive {
  opacity: 1;
  border-color: var(--nd-accent);
  color: var(--nd-accent);
  background: color-mix(in srgb, var(--nd-accent) 10%, transparent);
}

// --- Body ---
.tabBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.codeEditor {
  flex: 1;
  min-width: 0;
}

.appError {
  margin: 8px 12px;
  padding: 8px 10px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  color: var(--nd-love);
  font-size: 12px;
  white-space: pre-wrap;
}

.visualEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  color: var(--nd-fg);
  opacity: 0.45;
  font-size: 12px;
  text-align: center;
}

.visualEmptyIcon {
  font-size: 28px;
  opacity: 0.4;
}

.outputPanel {
  margin: 8px 12px;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: 4px;
  background: var(--nd-bg);
  font-size: 11px;

  summary {
    cursor: pointer;
    opacity: 0.7;
  }
}

.outputLine {
  font-family: var(--nd-font-mono);
  white-space: pre-wrap;
  padding: 2px 4px;
}

.outputError {
  color: var(--nd-love);
}
</style>
