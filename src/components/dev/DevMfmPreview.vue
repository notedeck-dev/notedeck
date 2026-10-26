<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import FormInput from '@/components/common/form/FormInput.vue'
import FormSelect from '@/components/common/form/FormSelect.vue'
import FormSwitchRow from '@/components/common/form/FormSwitchRow.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { i18n } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { formatTime } from '@/utils/formatTime'
import { type MfmNode, parseTokens } from '@/utils/mfm'
import {
  DEV_MFM_FUNCTION_ROWS,
  DEV_MFM_SAMPLES,
  type DevMfmSample,
} from './devMfmSamples'

/**
 * Dev Dashboard (#977) の MFM プレビュー。デッキと同じ MkMfm (同じ CSS) で描くので、
 * ここで動かなければ本体でも動かない。mfm-vue のプレイグラウンドに
 * ある要素 (編集 / サンプル / 表示設定 / 絵文字の取得 / イベントログ) に加えて、
 * ノートの枠での切り取り、画面外と同じ停止状態、AST、関数一覧、実行中アプリの
 * HTTP API からの実ノートの読み込みを持つ。
 */

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)
const lang = jsonLang()
const settingsStore = useSettingsStore()

// --- 入力 ---
const sampleId = ref<DevMfmSample['id']>('basic')
const text = ref(DEV_MFM_SAMPLES[0]?.text ?? '')
watch(sampleId, (id) => {
  const sample = DEV_MFM_SAMPLES.find((s) => s.id === id)
  if (sample) text.value = sample.text
})

const sampleLabels = computed<Record<DevMfmSample['id'], string>>(() => ({
  basic: i18n.ts._devMfm.sampleBasic,
  syntax: i18n.ts._devMfm.sampleSyntax,
  functions: i18n.ts._devMfm.sampleFunctions,
  animations: i18n.ts._devMfm.sampleAnimations,
  art: i18n.ts._devMfm.sampleArt,
  edge: i18n.ts._devMfm.sampleEdge,
}))

// --- 表示設定 ---
const advanced = computed(() => settingsStore.get('mfm.advanced') !== false)
const animated = computed(() => settingsStore.get('mfm.animated') !== false)
const plain = ref(false)
const nowrap = ref(false)
const nyaize = ref(false)
const paused = ref(false)
const noteFrame = ref(true)
const width = ref<'360' | '420' | '560' | 'auto'>('360')
const fontSize = ref<'14' | '15' | '16' | '17'>('15')
const me = ref('')
const tab = ref<'preview' | 'ast' | 'functions'>('preview')

const frameStyle = computed(() => ({
  width: width.value === 'auto' ? undefined : `${width.value}px`,
  fontSize: `${fontSize.value}px`,
  '--nd-mfm-play-state': paused.value ? 'paused' : 'running',
}))

// --- 解析の統計 (キャッシュを通さず毎回測る) ---
const stats = computed(() => {
  const start = performance.now()
  const nodes = parseTokens(text.value, { simple: plain.value })
  const ms = performance.now() - start
  let count = 0
  let depth = 0
  const walk = (list: MfmNode[], d: number) => {
    for (const n of list) {
      count++
      if (d > depth) depth = d
      if ('children' in n && Array.isArray(n.children)) walk(n.children, d + 1)
    }
  }
  walk(nodes, 1)
  return { nodes, count, depth, ms: Math.round(ms * 100) / 100 }
})
const astJson = computed(() => JSON.stringify(stats.value.nodes, null, 2))

// --- 絵文字 (サーバーの /api/emojis を直接引く。ブラウザからでも CORS で読める) ---
const host = ref('misskey.io')
const emojis = shallowRef<Record<string, string>>({})
const emojiStatus = ref('')
const emojiBusy = ref(false)
async function fetchEmojis() {
  const h = host.value
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (!h) return
  emojiBusy.value = true
  emojiStatus.value = ''
  try {
    const res = await fetch(`https://${h}/api/emojis`, { method: 'POST' })
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as {
      emojis?: { name: string; url: string }[]
    }
    const map: Record<string, string> = {}
    for (const e of body.emojis ?? []) map[e.name] = e.url
    emojis.value = map
    host.value = h
    emojiStatus.value = i18n.tsx._devMfm.emojisLoaded({
      count: Object.keys(map).length,
    })
  } catch (e) {
    emojiStatus.value = `${i18n.ts._devMfm.emojisFailed}: ${String(e)}`
  } finally {
    emojiBusy.value = false
  }
}

// --- 実ノートの読み込み (実行中アプリの内蔵 HTTP サーバー経由) ---
const noteRef = ref('')
const noteStatus = ref('')
const noteBusy = ref(false)
async function loadNote() {
  const m = noteRef.value
    .trim()
    .match(/^(?:https?:\/\/)?([^/\s]+)\/notes\/([A-Za-z0-9]+)/)
  if (!m) {
    noteStatus.value = i18n.ts._devMfm.noteRefInvalid
    return
  }
  const [, h, id] = m
  noteBusy.value = true
  noteStatus.value = ''
  try {
    const res = await fetch(
      `/api/${encodeURIComponent(h ?? '')}/notes/${encodeURIComponent(id ?? '')}`,
    )
    if (!res.ok) throw new Error(String(res.status))
    const note = (await res.json()) as {
      text?: string | null
      cw?: string | null
      emojis?: Record<string, string>
      _serverHost?: string
      user?: { isCat?: boolean }
    }
    text.value = note.text ?? note.cw ?? ''
    if (note._serverHost) host.value = note._serverHost
    emojis.value = { ...emojis.value, ...(note.emojis ?? {}) }
    nyaize.value = note.user?.isCat === true
    noteStatus.value = i18n.ts._devMfm.noteLoaded
  } catch (e) {
    noteStatus.value = `${i18n.ts._devMfm.noteLoadFailed}: ${String(e)}`
  } finally {
    noteBusy.value = false
  }
}

// --- イベントログ ---
interface LogEntry {
  id: number
  time: string
  kind: string
  detail: string
}
const log = ref<LogEntry[]>([])
let logSeq = 0
function addLog(kind: string, detail: string) {
  log.value.unshift({
    id: ++logSeq,
    time: formatTime(Date.now()),
    kind,
    detail,
  })
  if (log.value.length > 50) log.value.length = 50
}

/** ハッシュタグはルーターで遷移してダッシュボードを離れるので、記録だけして止める */
function onPreviewClick(e: MouseEvent) {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
    '[class*="mfmHashtag"]',
  )
  if (!el) return
  e.stopPropagation()
  e.preventDefault()
  addLog('hashtag', el.textContent ?? '')
}
</script>

<template>
  <div :class="$style.root">
    <section :class="$style.editor">
      <div :class="$style.paneHead">
        <span :class="$style.paneTitle">MFM</span>
        <FormSelect v-model="sampleId" :label="i18n.ts._devMfm.sample" filled>
          <option v-for="s in DEV_MFM_SAMPLES" :key="s.id" :value="s.id">
            {{ sampleLabels[s.id] }}
          </option>
        </FormSelect>
      </div>
      <FormInput
        v-model="text"
        multiline
        spellcheck="false"
        :class="$style.textarea"
        :aria-label="i18n.ts._devMfm.editorLabel"
      />
      <div :class="$style.paneFoot">
        {{ i18n.tsx._devMfm.stats({ chars: text.length, nodes: stats.count, depth: stats.depth, ms: stats.ms }) }}
      </div>
    </section>

    <section :class="$style.center">
      <div :class="$style.preview">
        <div :class="$style.paneHead">
          <div :class="$style.tabs" role="tablist">
            <button
              v-for="t in (['preview', 'ast', 'functions'] as const)"
              :key="t"
              type="button"
              role="tab"
              :aria-selected="tab === t"
              :class="[$style.tab, tab === t && $style.tabActive]"
              @click="tab = t"
            >
              {{ t === 'preview' ? i18n.ts._devMfm.tabPreview : t === 'ast' ? i18n.ts._devMfm.tabAst : i18n.ts._devMfm.tabFunctions }}
            </button>
          </div>
          <span :class="$style.paneMeta">{{ fontSize }}px · {{ width === 'auto' ? '100%' : `${width}px` }}</span>
        </div>
        <div v-if="tab === 'preview'" :class="$style.previewBody">
          <div
            :class="[$style.frame, noteFrame && $style.noteFrame]"
            :style="frameStyle"
            @click.capture="onPreviewClick"
          >
            <MkMfm
              :text="text"
              :emojis="emojis"
              :server-host="host"
              :plain="plain"
              :nowrap="nowrap"
              :nyaize="nyaize"
              :my-username="me || undefined"
              @mention-click="(u, h) => addLog('mention', h ? `@${u}@${h}` : `@${u}`)"
              @memo-link-click="(id) => addLog('memo', id)"
              @click-ev="(ev) => addLog('clickEv', ev)"
            />
          </div>
        </div>
        <div v-else-if="tab === 'ast'" :class="$style.astBody">
          <CodeEditor :model-value="astJson" :language="lang" read-only auto-height />
        </div>
        <div v-else :class="$style.fnBody" :style="{ fontSize: `${fontSize}px` }">
          <table :class="$style.fnTable">
            <thead>
              <tr>
                <th>{{ i18n.ts._devMfm.fnSyntax }}</th>
                <th>{{ i18n.ts._devMfm.fnRender }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in DEV_MFM_FUNCTION_ROWS" :key="row">
                <td><code :class="$style.code">{{ row }}</code></td>
                <td :style="{ '--nd-mfm-play-state': paused ? 'paused' : 'running' }">
                  <MkMfm :text="row" :emojis="emojis" :server-host="host" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div :class="$style.log">
        <div :class="$style.paneHead">
          <span :class="$style.paneTitle">{{ i18n.ts._devMfm.events }}</span>
          <button v-if="log.length" type="button" :class="$style.linkBtn" @click="log = []">
            {{ i18n.ts._common.clear }}
          </button>
        </div>
        <p v-if="log.length === 0" :class="$style.empty">{{ i18n.ts._devMfm.eventsEmpty }}</p>
        <ul v-else :class="$style.logList">
          <li v-for="entry in log" :key="entry.id" :class="$style.logRow">
            <span :class="$style.logTime">{{ entry.time }}</span>
            <span :class="$style.logKind">{{ entry.kind }}</span>
            <span :class="$style.logDetail">{{ entry.detail }}</span>
          </li>
        </ul>
      </div>
    </section>

    <aside :class="$style.settings">
      <div :class="$style.group">
        <p :class="$style.groupTitle">{{ i18n.ts._devMfm.display }}</p>
        <FormSwitchRow
          :label="i18n.ts._appearanceEditorContent.advancedMfm"
          :on="advanced"
          @toggle="settingsStore.set('mfm.advanced', !advanced)"
        />
        <FormSwitchRow
          :label="i18n.ts._appearanceEditorContent.animatedMfm"
          :on="animated"
          :disabled="!advanced"
          @toggle="settingsStore.set('mfm.animated', !animated)"
        />
        <FormSwitchRow
          :label="i18n.ts._devMfm.paused"
          :sub-label="i18n.ts._devMfm.pausedDesc"
          :on="paused"
          @toggle="paused = !paused"
        />
        <FormSwitchRow
          :label="i18n.ts._devMfm.noteFrame"
          :sub-label="i18n.ts._devMfm.noteFrameDesc"
          :on="noteFrame"
          @toggle="noteFrame = !noteFrame"
        />
        <FormSwitchRow label="plain" :sub-label="i18n.ts._devMfm.plainDesc" :on="plain" @toggle="plain = !plain" />
        <FormSwitchRow label="nowrap" :sub-label="i18n.ts._devMfm.nowrapDesc" :on="nowrap" @toggle="nowrap = !nowrap" />
        <FormSwitchRow :label="i18n.ts._devMfm.nyaize" :on="nyaize" @toggle="nyaize = !nyaize" />
        <label :class="$style.field">
          <span>{{ i18n.ts._devMfm.width }}</span>
          <FormSelect v-model="width" filled>
            <option value="360">360px</option>
            <option value="420">420px</option>
            <option value="560">560px</option>
            <option value="auto">100%</option>
          </FormSelect>
        </label>
        <label :class="$style.field">
          <span>{{ i18n.ts._devMfm.fontSize }}</span>
          <FormSelect v-model="fontSize" filled>
            <option value="14">14px</option>
            <option value="15">15px</option>
            <option value="16">16px</option>
            <option value="17">17px</option>
          </FormSelect>
        </label>
      </div>

      <div :class="$style.group">
        <p :class="$style.groupTitle">{{ i18n.ts._devMfm.server }}</p>
        <label :class="$style.field">
          <span>{{ i18n.ts._devMfm.host }}</span>
          <FormInput v-model="host" placeholder="misskey.io" />
        </label>
        <div :class="$style.actionRow">
          <button type="button" :class="$style.btn" :disabled="emojiBusy" @click="fetchEmojis">
            <i class="ti ti-mood-smile" /> {{ i18n.ts._devMfm.fetchEmojis }}
          </button>
          <span :class="$style.status">{{ emojiStatus }}</span>
        </div>
        <label :class="$style.field">
          <span>{{ i18n.ts._devMfm.me }}</span>
          <FormInput v-model="me" placeholder="username" />
        </label>
      </div>

      <div :class="$style.group">
        <p :class="$style.groupTitle">{{ i18n.ts._devMfm.loadNote }}</p>
        <p :class="$style.groupDesc">{{ i18n.ts._devMfm.loadNoteDesc }}</p>
        <FormInput v-model="noteRef" placeholder="https://misskey.io/notes/xxxx" @keydown.enter="loadNote" />
        <div :class="$style.actionRow">
          <button type="button" :class="$style.btn" :disabled="noteBusy" @click="loadNote">
            <i class="ti ti-download" /> {{ i18n.ts._devMfm.loadNote }}
          </button>
          <span :class="$style.status">{{ noteStatus }}</span>
        </div>
      </div>
    </aside>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.root {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) 300px;
  gap: 12px;
  align-items: start;

  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
  }
}

.editor,
.preview,
.log,
.settings {
  display: flex;
  flex-direction: column;
  background: var(--nd-panel);
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-md);
  overflow: hidden;
}

.center {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.paneHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.paneTitle {
  font-size: var(--nd-font-sm);
  font-weight: var(--nd-weight-bold);
}

.paneMeta,
.paneFoot {
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-xs);
  opacity: 0.6;
}

.paneFoot {
  padding: 6px 12px;
  border-top: 1px solid var(--nd-divider);
}

.textarea {
  flex: 1;
  min-height: 420px;

  textarea {
    min-height: 420px;
    height: 100%;
    border: none;
    border-radius: 0;
    background: transparent;
    font-family: var(--nd-font-mono);
    font-size: var(--nd-font-sm);
    line-height: 1.6;
    resize: vertical;
  }
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  @include btn-base;
  padding: 4px 10px;
  font-size: var(--nd-font-sm);
  background: transparent;
  color: var(--nd-fg);
  opacity: 0.7;
}

.tabActive {
  background: var(--nd-buttonBg);
  opacity: 1;
}

.previewBody {
  min-height: 480px;
  padding: 16px;
  overflow: auto;
}

/* ノートと同じ切り取り (MkNote の .noteRoot と同じ contain / clip)。はみ出す
   MFM アートがデッキでどう見えるかをここで確かめる */
.frame {
  max-width: 100%;
  color: var(--nd-fg);
}

.noteFrame {
  contain: content;
  overflow: clip;
  padding: 16px;
  background: var(--nd-bg);
  border: 1px dashed var(--nd-divider);
  border-radius: var(--nd-radius-md);
}

.astBody {
  min-height: 480px;
}

.fnBody {
  padding: 8px 12px;
  overflow: auto;
}

.fnTable {
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: 8px;
    border-bottom: 1px solid var(--nd-divider);
    text-align: left;
    vertical-align: middle;
  }

  th {
    font-size: var(--nd-font-xs);
    opacity: 0.6;
  }

  td:first-child {
    width: 45%;
  }
}

.code {
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-xs);
}

.linkBtn {
  @include btn-base;
  padding: 2px 8px;
  font-size: var(--nd-font-xs);
  background: transparent;
  color: var(--nd-accentText);
}

.empty {
  margin: 0;
  padding: 10px 12px;
  font-size: var(--nd-font-xs);
  opacity: 0.6;
}

.logList {
  margin: 0;
  padding: 6px 12px;
  list-style: none;
  max-height: 200px;
  overflow: auto;
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-xs);
}

.logRow {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}

.logTime {
  opacity: 0.5;
}

.logKind {
  font-weight: var(--nd-weight-bold);
  color: var(--nd-accentText);
}

.logDetail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings {
  padding: 4px 0;
}

.group {
  padding: 8px 12px;

  & + & {
    border-top: 1px solid var(--nd-divider);
  }
}

.groupTitle {
  margin: 0 0 6px;
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.groupDesc {
  margin: 0 0 8px;
  font-size: var(--nd-font-xs);
  opacity: 0.7;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--nd-font-sm);

  > span {
    flex: none;
  }

  > :last-child {
    width: 150px;
  }
}

.actionRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.btn {
  @include btn-secondary;
  flex: none;
  padding: 4px 10px;
  font-size: var(--nd-font-sm);
}

.status {
  font-size: var(--nd-font-xs);
  opacity: 0.7;
  overflow-wrap: anywhere;
}
</style>
