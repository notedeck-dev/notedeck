<script setup lang="ts">
import type { Interpreter } from '@syuilo/aiscript'
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  useTemplateRef,
} from 'vue'
import { aiscriptLanguage } from '@/aiscript/codemirror/language'
import AiScriptDialog from '@/components/common/AiScriptDialog.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import AiScriptUiRenderer, {
  type PostFormRequest,
} from '@/components/deck/widgets/AiScriptUiRenderer.vue'
import { useAiScriptRunner } from '@/composables/useAiScriptRunner'
import { usePortal } from '@/composables/usePortal'
import { useWindowEditAction } from '@/composables/useWindowEditAction'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { webUiUrl } from '@/utils/url'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)
const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const aisLang = aiscriptLanguage

const props = defineProps<{
  accountId: string
  flashId: string
}>()

const accountsStore = useAccountsStore()
const windowsStore = useWindowsStore()
const account = computed(
  () => accountsStore.accounts.find((a) => a.id === props.accountId) ?? null,
)
const serverUrl = computed(() =>
  account.value ? webUiUrl(account.value.host) : '',
)

interface FlashDetail {
  id: string
  title: string
  summary: string
  script: string
  userId: string
  user: {
    username: string
    host: string | null
    name: string | null
    avatarUrl: string | null
  }
  likedCount: number
  isLiked: boolean
  createdAt: string
  updatedAt: string
}

type Mode = 'ready' | 'started'
const mode = ref<Mode>('ready')
const showSource = ref(false)
const flash = ref<FlashDetail | null>(null)
const fetchError = ref<string | null>(null)
const fetching = ref(false)

const dialogRef = ref<InstanceType<typeof AiScriptDialog> | null>(null)
const {
  interpreter,
  consoleOutput,
  uiComponents,
  runError,
  running,
  run: runScript,
  reset: resetRun,
} = useAiScriptRunner()

const postPortalRef = useTemplateRef<HTMLElement>('postPortalRef')
usePortal(postPortalRef)

const showPostForm = ref(false)
const postFormData = ref<PostFormRequest>({})

function handlePost(form: PostFormRequest) {
  postFormData.value = form
  showPostForm.value = true
}

function closePostForm() {
  showPostForm.value = false
  postFormData.value = {}
}

const flashCreatedDate = computed(() =>
  flash.value ? new Date(flash.value.createdAt).toLocaleDateString() : '',
)
const flashUpdatedDate = computed(() =>
  flash.value ? new Date(flash.value.updatedAt).toLocaleDateString() : '',
)

const isOwnPlay = computed(
  () =>
    flash.value && account.value && flash.value.userId === account.value.userId,
)

const playWebUrl = computed(() => {
  if (!flash.value || !serverUrl.value) return undefined
  return `${serverUrl.value}/play/${flash.value.id}`
})

useWindowExternalLink(() =>
  playWebUrl.value ? { url: playWebUrl.value } : null,
)

function openEditWindow() {
  if (!isOwnPlay.value || !flash.value) return
  windowsStore.open('play-edit', {
    accountId: props.accountId,
    flashId: flash.value.id,
  })
}

useWindowEditAction(() =>
  isOwnPlay.value && flash.value
    ? { onClick: openEditWindow, title: '編集' }
    : null,
)

async function loadFlash() {
  resetRun()
  flash.value = null
  fetchError.value = null
  fetching.value = true
  mode.value = 'ready'
  try {
    flash.value = unwrap(
      await commands.apiGetFlash(props.accountId, props.flashId),
    ) as unknown as FlashDetail
  } catch (e) {
    fetchError.value = AppError.from(e).message
  } finally {
    fetching.value = false
  }
}

async function startPlay() {
  if (!flash.value) return
  mode.value = 'started'
  await runScript(flash.value.script, {
    // Misskey Play はサーバー由来の第三者コード → plugin principal (#712)
    principal: {
      kind: 'plugin',
      pluginId: `play:${flash.value.id}`,
      name: flash.value.title,
    },
    accountId: props.accountId,
    storagePrefix: `play-${flash.value.id}`,
    globals: {
      THIS_ID: flash.value.id,
      THIS_URL: `${serverUrl.value}/play/${flash.value.id}`,
      USER_ID: account.value?.userId ?? '',
      USER_NAME: account.value?.displayName ?? '',
      USER_USERNAME: account.value?.username ?? '',
      LOCALE: navigator.language,
      SERVER_URL: serverUrl.value,
    },
    dialog: () => dialogRef.value,
  })
}

async function toggleLike() {
  if (!flash.value) return
  try {
    if (flash.value.isLiked) {
      unwrap(await commands.apiUnlikeFlash(props.accountId, flash.value.id))
    } else {
      unwrap(await commands.apiLikeFlash(props.accountId, flash.value.id))
    }
    flash.value.isLiked = !flash.value.isLiked
    flash.value.likedCount += flash.value.isLiked ? 1 : -1
  } catch {
    // ignore
  }
}

function reload() {
  resetRun()
  mode.value = 'ready'
}

onMounted(loadFlash)
</script>

<template>
  <div :class="$style.root">
    <AiScriptDialog ref="dialogRef" />

    <!-- Ready mode -->
    <template v-if="mode === 'ready'">
      <div :class="$style.scroll">
        <div v-if="fetching" :class="$style.loading"><LoadingSpinner /></div>
        <div v-else-if="fetchError" :class="$style.error">{{ fetchError }}</div>
        <template v-else-if="flash">
          <div :class="$style.ready">
            <div :class="$style.readyTitle">{{ flash.title }}</div>
            <div v-if="flash.summary" :class="$style.readySummary">{{ flash.summary }}</div>
            <button class="_button" :class="$style.startBtn" @click="startPlay">
              <i class="ti ti-player-play" /> Play
            </button>
            <div :class="$style.readyInfo">
              <i class="ti ti-heart" /> {{ flash.likedCount }}
            </div>
          </div>

          <div :class="$style.sourceSection">
            <button
              class="_button"
              :class="$style.sourceToggle"
              @click="showSource = !showSource"
            >
              <i class="ti ti-code" :class="$style.sourceToggleLeadIcon" />
              <span :class="$style.sourceToggleLabel">ソースを表示</span>
              <i :class="showSource ? 'ti ti-chevron-down' : 'ti ti-chevron-right'" />
            </button>
            <div v-if="showSource" :class="$style.sourceWrap">
              <CodeEditor
                :model-value="flash.script"
                :language="aisLang"
                read-only
                auto-height
                @update:model-value="() => {}"
              />
            </div>
          </div>

          <div :class="$style.footer">
            <div :class="$style.author">
              <img :src="flash.user.avatarUrl || '/avatar-default.svg'" :class="$style.authorAvatar" @error="(e: Event) => (e.target as HTMLImageElement).src = '/avatar-error.svg'" />
              By @{{ flash.user.username }}
            </div>
            <div :class="$style.dates">
              <div v-if="flash.createdAt !== flash.updatedAt">
                <i class="ti ti-clock" /> Updated: {{ flashUpdatedDate }}
              </div>
              <div>
                <i class="ti ti-clock" /> Created: {{ flashCreatedDate }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- Started mode -->
    <template v-else>
      <div :class="$style.scroll">
        <div v-if="uiComponents.length" :class="$style.ui">
          <AiScriptUiRenderer
            :components="uiComponents"
            :interpreter="(interpreter as Interpreter | null)"
            :server-url="serverUrl"
            @post="handlePost"
          />
        </div>

        <div v-if="consoleOutput.length" :class="$style.console">
          <div
            v-for="(line, i) in consoleOutput"
            :key="i"
            :class="[$style.consoleLine, { [$style.errorLine]: line.isError }]"
          >
            {{ line.text }}
          </div>
        </div>

        <div v-if="runError" :class="$style.runError">{{ runError }}</div>

        <div v-if="running && !uiComponents.length && !runError" :class="$style.empty">
          Running...
        </div>

        <div v-if="!running" :class="$style.startedActions">
          <div :class="$style.actionsRow">
            <button class="_button" :class="$style.actionBtn" title="リロード" @click="reload">
              <i class="ti ti-reload" />
            </button>
          </div>
          <div v-if="flash" :class="$style.actionsRow">
            <button
              class="_button"
              :class="[$style.actionBtn, { [$style.liked]: flash.isLiked }]"
              @click="toggleLike"
            >
              <i class="ti ti-heart" />
              {{ flash.likedCount }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>

  <div v-if="showPostForm" ref="postPortalRef">
    <MkPostForm
      :account-id="accountId"
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
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.loading,
.empty {
  padding: 24px;
  text-align: center;
  opacity: 0.7;
}

.error,
.runError {
  margin: 12px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-love-subtle);
  color: var(--nd-love);
  font-size: 0.85em;
  white-space: pre-wrap;
}

.ready {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 20px;
  margin: 12px;
  border-radius: 10px;
  background: var(--nd-panel);
}

.readyTitle {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  text-align: center;
}

.readySummary {
  font-size: 0.9em;
  text-align: center;
  opacity: 0.8;
  white-space: pre-wrap;
  line-height: 1.5;
}

.startBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0;
  padding: 10px 32px;
  border-radius: var(--nd-radius-full);
  background: linear-gradient(90deg, var(--nd-accent), color-mix(in srgb, var(--nd-accent), #fff 20%));
  color: #fff;
  font-size: 1em;
  font-weight: bold;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
  }
}

.readyInfo {
  font-size: 0.85em;
  opacity: 0.6;
}

.sourceSection {
  margin: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sourceToggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  color: var(--nd-fg);
  font-size: 0.85em;
  align-self: center;
  width: min(360px, 90%);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.sourceToggleLeadIcon {
  flex-shrink: 0;
  opacity: 0.7;
}

.sourceToggleLabel {
  flex: 1;
  text-align: left;
}

.sourceWrap {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px;
  margin: 0 12px 12px;
}

.author {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  opacity: 0.7;
}

.authorAvatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
}

.dates {
  font-size: 0.75em;
  opacity: 0.5;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ui {
  padding: 16px 12px;
}

.console {
  padding: 8px 10px;
  margin: 0 12px 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8em;
  line-height: 1.6;
}

.consoleLine {
  white-space: pre-wrap;
  word-break: break-all;

  &.errorLine {
    color: var(--nd-love);
  }
}

.errorLine {
  /* used as modifier */
}

.startedActions {
  margin-top: auto;
  border-top: 1px solid var(--nd-divider);
}

.actionsRow {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--nd-divider);

  &:last-child {
    border-bottom: none;
  }
}

.actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

.actionBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.8em;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.liked {
    color: var(--nd-love);
  }
}

.liked {
  /* used as modifier */
}
</style>
