<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import FormInput from '@/components/common/form/FormInput.vue'
import FormSelect from '@/components/common/form/FormSelect.vue'
import FormSwitchRow from '@/components/common/form/FormSwitchRow.vue'
import MfmFunctionTable from '@/components/common/MfmFunctionTable.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { i18n } from '@/i18n'
import { isExposed } from '@/settings/exposure'
import { formatTime } from '@/utils/formatTime'
import { type MfmNode, parseTokens } from '@/utils/mfm'
import {
  MFM_PLAYGROUND_SAMPLES,
  type MfmPlaygroundSample,
} from './mfmPlaygroundSamples'

/**
 * MFM プレイグラウンド: 編集欄 + デッキと同じ MkMfm (同じ CSS) のプレビュー + 表示設定。
 * Dev Dashboard の MFM プレビュー (#977) と MFM エディタカラムの共通部品で、本文は
 * v-model で持ち主 (ダッシュボードはメモリ、カラムはカラム設定) が持つ。
 * プレビューは mfm-vue のプレイグラウンドにある要素 (サンプル / plain / nowrap /
 * にゃ化 / 文字サイズ / イベントログ) に加えて、ノートの枠での切り取り、画面外と
 * 同じ停止状態、AST、関数一覧を持つ。置き場の幅に応じて 3 列 / 縦積みに変わる
 * (コンテナクエリ)。
 */

const text = defineModel<string>({ required: true })

const props = defineProps<{
  /** カスタム絵文字 (name → url)。無ければ emoji store (サーバーの辞書) で解決する */
  emojis?: Record<string, string>
  /** 絵文字の解決に使うサーバー */
  serverHost?: string
  /** 自分のユーザー名 (メンションの強調) */
  myUsername?: string
  /**
   * 開発者向けの要素 (AST タブ / 画面外と同じ停止状態) を常に出す。省略時は
   * 開発者モード (#1034) のときだけ出す。Dev Dashboard は常に出す
   */
  devTools?: boolean
}>()

const showDevTools = computed(() => props.devTools || isExposed('developer'))

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)
const lang = jsonLang()

// --- サンプル ---
const sampleId = ref<MfmPlaygroundSample['id'] | ''>('')
watch(sampleId, (id) => {
  const sample = MFM_PLAYGROUND_SAMPLES.find((s) => s.id === id)
  if (!sample) return
  text.value = sample.text
  // 選択を戻しておかないと、同じサンプルを選び直しても watch が発火しない
  sampleId.value = ''
})
const sampleLabels = computed<Record<MfmPlaygroundSample['id'], string>>(
  () => ({
    basic: i18n.ts._mfmPlayground.sampleBasic,
    syntax: i18n.ts._mfmPlayground.sampleSyntax,
    functions: i18n.ts._mfmPlayground.sampleFunctions,
    animations: i18n.ts._mfmPlayground.sampleAnimations,
    art: i18n.ts._mfmPlayground.sampleArt,
    edge: i18n.ts._mfmPlayground.sampleEdge,
  }),
)

// --- 表示設定 (この部品の中だけ。アプリの設定は触らない) ---
const plain = ref(false)
const nowrap = ref(false)
const nyaize = ref(false)
const paused = ref(false)
const noteFrame = ref(true)
const width = ref<'360' | '420' | '560' | 'auto'>('360')
const fontSize = ref<'14' | '15' | '16' | '17'>('15')
const tab = ref<'preview' | 'ast' | 'functions'>('preview')
const tabs = computed(() =>
  showDevTools.value
    ? (['preview', 'ast', 'functions'] as const)
    : (['preview', 'functions'] as const),
)

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

/** ハッシュタグはルーターで遷移して画面を離れるので、記録だけして止める */
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
  <div :class="$style.host"><div :class="$style.root">
    <section :class="$style.editor">
      <div :class="$style.paneHead">
        <span :class="$style.paneTitle">MFM</span>
        <div :class="$style.headActions">
          <FormSelect v-model="sampleId" :label="i18n.ts._mfmPlayground.sample" filled>
            <option value="">{{ i18n.ts._mfmPlayground.sample }}</option>
            <option v-for="s in MFM_PLAYGROUND_SAMPLES" :key="s.id" :value="s.id">
              {{ sampleLabels[s.id] }}
            </option>
          </FormSelect>
        </div>
      </div>
      <FormInput
        v-model="text"
        multiline
        spellcheck="false"
        :class="$style.textarea"
        :aria-label="i18n.ts._mfmPlayground.editorLabel"
      />
      <div :class="$style.paneFoot">
        {{ i18n.tsx._mfmPlayground.stats({ chars: text.length, nodes: stats.count, depth: stats.depth, ms: stats.ms }) }}
      </div>
    </section>

    <section :class="$style.center">
      <div :class="$style.preview">
        <div :class="$style.paneHead">
          <div :class="$style.tabs" role="tablist">
            <button
              v-for="t in tabs"
              :key="t"
              type="button"
              role="tab"
              :aria-selected="tab === t"
              :class="[$style.tab, tab === t && $style.tabActive]"
              @click="tab = t"
            >
              {{ t === 'preview' ? i18n.ts._mfmPlayground.tabPreview : t === 'ast' ? i18n.ts._mfmPlayground.tabAst : i18n.ts._mfmPlayground.tabFunctions }}
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
              :emojis="props.emojis"
              :server-host="props.serverHost"
              :plain="plain"
              :nowrap="nowrap"
              :nyaize="nyaize"
              :my-username="props.myUsername"
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
          <MfmFunctionTable :emojis="props.emojis" :server-host="props.serverHost" :paused="paused" />
        </div>
      </div>

      <div :class="$style.log">
        <div :class="$style.paneHead">
          <span :class="$style.paneTitle">{{ i18n.ts._mfmPlayground.events }}</span>
          <button v-if="log.length" type="button" :class="$style.linkBtn" @click="log = []">
            {{ i18n.ts._common.clear }}
          </button>
        </div>
        <p v-if="log.length === 0" :class="$style.empty">{{ i18n.ts._mfmPlayground.eventsEmpty }}</p>
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
        <p :class="$style.groupTitle">{{ i18n.ts._mfmPlayground.display }}</p>
        <FormSwitchRow
          v-if="showDevTools"
          :label="i18n.ts._mfmPlayground.paused"
          :sub-label="i18n.ts._mfmPlayground.pausedDesc"
          :on="paused"
          @toggle="paused = !paused"
        />
        <FormSwitchRow
          :label="i18n.ts._mfmPlayground.noteFrame"
          :sub-label="i18n.ts._mfmPlayground.noteFrameDesc"
          :on="noteFrame"
          @toggle="noteFrame = !noteFrame"
        />
        <FormSwitchRow label="plain" :sub-label="i18n.ts._mfmPlayground.plainDesc" :on="plain" @toggle="plain = !plain" />
        <FormSwitchRow label="nowrap" :sub-label="i18n.ts._mfmPlayground.nowrapDesc" :on="nowrap" @toggle="nowrap = !nowrap" />
        <FormSwitchRow :label="i18n.ts._mfmPlayground.nyaize" :on="nyaize" @toggle="nyaize = !nyaize" />
        <label :class="$style.field">
          <span>{{ i18n.ts._mfmPlayground.width }}</span>
          <FormSelect v-model="width" filled>
            <option value="360">360px</option>
            <option value="420">420px</option>
            <option value="560">560px</option>
            <option value="auto">100%</option>
          </FormSelect>
        </label>
        <label :class="$style.field">
          <span>{{ i18n.ts._mfmPlayground.fontSize }}</span>
          <FormSelect v-model="fontSize" filled>
            <option value="14">14px</option>
            <option value="15">15px</option>
            <option value="16">16px</option>
            <option value="17">17px</option>
          </FormSelect>
        </label>
      </div>
      <slot name="settings" />
    </aside>
  </div></div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

/* コンテナクエリは祖先のコンテナを見るので、グリッド自身ではなく外側を
   コンテナにする */
.host {
  container-type: inline-size;
}

.root {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) 300px;
  gap: 12px;
  align-items: start;
}

/* カラム (〜560px) や狭い窓では縦に積む */
@container (max-width: 1100px) {
  .root {
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

.headActions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
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
  min-height: 240px;

  textarea {
    min-height: 240px;
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
  min-height: 240px;
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
  min-height: 240px;
}

.fnBody {
  padding: 8px 12px;
  overflow: auto;
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
</style>
