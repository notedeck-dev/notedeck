<script setup lang="ts">
import { type Ast, Interpreter, Parser } from '@syuilo/aiscript'
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import { createAiScriptEnv } from '@/aiscript/api'
import { createInterpreterOptions } from '@/aiscript/common'
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
import { useAiConfig } from '@/composables/useAiConfig'
import { usePortal } from '@/composables/usePortal'
import { useToast } from '@/stores/toast'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

import { useAccountsStore } from '@/stores/accounts'
import { useWidgetsStore, type WidgetMeta } from '@/stores/widgets'
import AiScriptEditor from './AiScriptEditor.vue'
import type { PostFormRequest } from './AiScriptUiRenderer.vue'
import AiScriptUiRenderer from './AiScriptUiRenderer.vue'

const props = defineProps<{
  widget: WidgetMeta
  columnId: string
  accountId: string | null
  isSidebar?: boolean
}>()

const emit = defineEmits<{
  remove: []
  'drag-start': [event: PointerEvent]
}>()

const widgetsStore = useWidgetsStore()

const displayName = computed(() => {
  const name = props.widget.name?.trim()
  if (!name || /^Widget [0-9a-z]{4,}$/i.test(name)) return 'AiScript'
  return name
})
const commandStore = useCommandStore()
const { config: aiConfig } = useAiConfig()
const accountsStore = useAccountsStore()
const serverUrl = computed(() => {
  if (!props.accountId) return ''
  const account = accountsStore.accounts.find((a) => a.id === props.accountId)
  return account ? `https://${account.host}` : ''
})
const code = ref(props.widget.src ?? '')
const uiComponents = ref<UiComponent[]>([])
const output = ref<{ text: string; isError: boolean }[]>([])
const error = ref<string | null>(null)
const running = ref(false)
/** カラム内エディタ表示フラグ。新規作成は widget-edit window で行う前提のため、
 *  既存 widget の src 確認/微修正用に on/off できるが、初期は閉じておく。 */
const showEditor = ref(false)
const interpreter = ref<Interpreter | null>(null)
const { show: showToast } = useToast()
const dialogRef = ref<InstanceType<typeof AiScriptDialog> | null>(null)
let currentNdCtx: Parameters<typeof cleanupNoteDeckEnv>[0] | null = null

const postFormPortalRef = useTemplateRef<HTMLElement>('postFormPortalRef')
usePortal(postFormPortalRef)

const showPostForm = ref(false)
const postFormData = ref<PostFormRequest>({})

function handlePost(form: PostFormRequest) {
  if (!props.accountId) return
  postFormData.value = form
  showPostForm.value = true
}

function closePostForm() {
  showPostForm.value = false
  postFormData.value = {}
}

// Persist code on change (debounce + アンマウント時 flush で取りこぼし防止)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function flushPendingSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    widgetsStore.updateSrc(props.widget.installId, code.value)
  }
}
watch(code, (val) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    widgetsStore.updateSrc(props.widget.installId, val)
  }, 500)
})

onBeforeUnmount(flushPendingSave)

async function run() {
  if (running.value) return
  running.value = true
  error.value = null
  uiComponents.value = []
  output.value = []

  const accId = props.accountId
  const apiOption = accId
    ? async (endpoint: string, params: Record<string, unknown>) => {
        return unwrap(
          await commands.apiRequest(accId, endpoint, params as JsonValue),
        )
      }
    : undefined

  const parser = new Parser()
  let ast: Ast.Node[]
  try {
    ast = parser.parse(sanitizeCode(code.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    running.value = false
    return
  }

  const env = createAiScriptEnv(
    {
      api: apiOption,
      storagePrefix: `app-${props.widget.installId}`,
      onDialog: (title, text, type) =>
        dialogRef.value?.showDialog(title, text, type) ?? Promise.resolve(),
      onConfirm: (title, text) =>
        dialogRef.value?.showConfirm(title, text) ?? Promise.resolve(false),
      onToast: (text, type) => showToast(text, type),
    },
    {
      THIS_ID: props.widget.installId,
      THIS_URL: '',
      USER_ID:
        accountsStore.accounts.find((a) => a.id === props.accountId)?.userId ??
        '',
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
    },
    onError: (err) => {
      error.value = err.message
      output.value.push({ text: err.message, isError: true })
    },
  })

  if (currentNdCtx) cleanupNoteDeckEnv(currentNdCtx)
  const ndCtx: NoteDeckEnvContext = {
    commandStore,
    getAiConfig: () => aiConfig.value,
    registeredCommandIds: [] as string[],
    subscriptions: [],
  }
  const ndEnv = createNoteDeckEnv(ndCtx)
  currentNdCtx = ndCtx

  const interp = new Interpreter({ ...env, ...ndEnv, ...ui }, ioOpts)
  ndCtx.interpreter = interp
  interpreter.value = interp

  try {
    await interp.exec(ast)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  running.value = false
}

// autoRun=true な widget は mount のたびに自動実行する。
// (フラグを下げない: カラム再表示・ナビバートグル・他カラム参照のたびに UI を出すため)
onMounted(() => {
  if (props.widget.autoRun && code.value) {
    run()
  }
})
</script>

<template>
  <div :class="$style.widgetApp">
    <div :class="$style.widgetHeader">
      <span :class="$style.widgetLabel" :title="displayName">
        <i class="ti ti-layout-dashboard" />
        <span :class="$style.widgetLabelText">{{ displayName }}</span>
      </span>
      <div :class="$style.headerActions">
        <button
          :class="$style.toolBtn"
          :title="showEditor ? 'エディタを閉じる' : 'コードを編集'"
          @click="showEditor = !showEditor"
        >
          <i :class="showEditor ? 'ti ti-chevron-up' : 'ti ti-code'" />
        </button>
        <button
          :class="[$style.toolBtn, $style.run]"
          :disabled="running"
          :title="running ? '実行中...' : '実行'"
          @click="run"
        >
          <i class="ti ti-player-play" />
        </button>
      </div>
      <div
        :class="$style.dragHandle"
        title="ドラッグして並び替え"
        @pointerdown="emit('drag-start', $event)"
      >
        <i class="ti ti-grip-vertical" />
      </div>
      <button
        :class="$style.widgetRemove"
        :title="isSidebar ? 'widget を削除 (コードも消えます)' : 'このカラムから外す (widget 本体は保持)'"
        @click="emit('remove')"
      >
        <i class="ti ti-x" />
      </button>
    </div>

    <div :class="$style.widgetBody">
      <AiScriptDialog ref="dialogRef" />

      <AiScriptEditor
        v-if="showEditor"
        v-model="code"
        placeholder="AiScript App code..."
      />

      <template v-else>
        <div v-if="error" :class="$style.appError">{{ error }}</div>

        <AiScriptUiRenderer
          v-if="uiComponents.length"
          :components="uiComponents"
          :interpreter="(interpreter as Interpreter | null)"
          :server-url="serverUrl"
          @post="handlePost"
        />

        <details v-if="output.length" :class="$style.outputPanel">
          <summary>出力 ({{ output.length }})</summary>
          <div
            v-for="(line, i) in output"
            :key="i"
            :class="[$style.outputLine, { [$style.error]: line.isError }]"
          >
            {{ line.text }}
          </div>
        </details>
      </template>
    </div>
  </div>

  <div v-if="showPostForm && props.accountId" ref="postFormPortalRef">
    <MkPostForm
      :account-id="props.accountId"
      :initial-text="postFormData.text"
      :initial-cw="postFormData.cw"
      :initial-visibility="postFormData.visibility"
      :initial-local-only="postFormData.localOnly"
      @close="closePostForm"
      @posted="closePostForm"
    />
  </div>
</template>

<style lang="scss" module>
.widgetApp {
  display: flex;
  flex-direction: column;
}

.widgetHeader {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--nd-divider);
  font-size: 0.85em;
  background: var(--nd-panelHeaderBg);
  color: var(--nd-panelHeaderFg);
}

.widgetLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  min-width: 0;
  font-weight: 500;
  opacity: 0.8;
}

.widgetLabelText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.widgetRemove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--nd-fg);
  cursor: pointer;
  border-radius: var(--nd-radius-sm);
  opacity: 0.35;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    color: var(--nd-love);
    background: var(--nd-love-subtle);
  }
}

.dragHandle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  color: var(--nd-fg);
  border-radius: var(--nd-radius-sm);
  cursor: grab;
  opacity: 0.35;
  touch-action: none;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
    background: var(--nd-buttonHoverBg);
  }

  &:active {
    cursor: grabbing;
  }
}

.widgetBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.toolBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  cursor: pointer;
  font-size: 0.85em;
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }

  &.run {
    background: var(--nd-accent);
    color: var(--nd-fgOnAccent);
    opacity: 1;

    &:hover:not(:disabled) {
      background: var(--nd-accentDarken);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
}

.appError {
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-love-subtle);
  color: var(--nd-love);
  font-size: 0.8em;
  white-space: pre-wrap;
}

// Keep for dynamic binding
.run {}

.outputPanel {
  padding: 6px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8em;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;

  summary {
    cursor: pointer;
    opacity: 0.6;
    font-size: 0.9em;
    user-select: none;
  }
}

.outputLine {
  white-space: pre-wrap;
  word-break: break-all;

  &.error {
    color: var(--nd-love);
  }
}

// Keep for dynamic binding
.error {}
</style>
