<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { computed, defineAsyncComponent, onUnmounted, ref, watch } from 'vue'
import MfmFunctionTable from '@/components/common/MfmFunctionTable.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import {
  MFM_PLAYGROUND_SAMPLES,
  type MfmPlaygroundSample,
} from '@/components/common/mfmPlaygroundSamples'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useVerticalResize } from '@/composables/useVerticalResize'
import { i18n } from '@/i18n'
import { isExposed } from '@/settings/exposure'
import { useAccountsStore } from '@/stores/accounts'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import { parseTokens } from '@/utils/mfm'
import DeckColumn from './DeckColumn.vue'

/**
 * MFM エディターカラム。スクラッチパッドと同じ骨格 (上に編集欄、仕切り、下にタブ) で、
 * デッキと同じ MkMfm で確かめながら書き、ヘッダーのボタンで投稿フォームへ送る。
 * 本文はカラム設定 (`mfmText`) に持つ。表示の切り替えとサンプルはカラムメニュー。
 * アカウントに紐づかないので、絵文字の解決とメンションの強調は予備のアカウントで行う。
 * 関数一覧は Dev Dashboard の MFM プレビューと共通 (MfmFunctionTable)
 */

const props = defineProps<{
  column: DeckColumnType
}>()

const { columnThemeVars, scroller, scrollToTop } = useColumnSetup(
  () => props.column,
)
const deckStore = useDeckStore()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)
const jsonLanguage = jsonLang()

// 本文はカラム設定に持つ。スクラッチパッドと同じく入力を 500ms まとめて書く
const text = ref(props.column.mfmText ?? '')
let saveTimer: ReturnType<typeof setTimeout> | null = null
function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if ((props.column.mfmText ?? '') !== text.value) {
    deckStore.updateColumn(props.column.id, { mfmText: text.value })
  }
}
watch(text, () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 500)
})
onUnmounted(persist)

const account = computed(
  () => accountsStore.fallbackAccount ?? accountsStore.accounts[0],
)

function sendToPostForm() {
  uiStore.requestCompose({ text: text.value })
}

// 編集欄と下段の割合 (スクラッチパッドと同じ)
const {
  value: editorRatio,
  start: startResize,
  stop: stopResize,
} = useVerticalResize({
  containerRef: scroller,
  mode: 'ratio',
  initial: 0.45,
  min: 0.15,
  max: 0.85,
})
onUnmounted(stopResize)

// 下段のタブ。AST と停止状態は開発者向け (#1034)
const devTools = computed(() => isExposed('developer'))
type Tab = 'preview' | 'functions' | 'ast'
const tab = ref<Tab>('preview')
const tabs = computed<{ id: Tab; icon: string; label: string }[]>(() => [
  {
    id: 'preview',
    icon: 'ti ti-eye',
    label: i18n.ts._mfmPlayground.tabPreview,
  },
  {
    id: 'functions',
    icon: 'ti ti-list-details',
    label: i18n.ts._mfmPlayground.tabFunctions,
  },
  ...(devTools.value
    ? [
        {
          id: 'ast' as const,
          icon: 'ti ti-binary-tree',
          label: i18n.ts._mfmPlayground.tabAst,
        },
      ]
    : []),
])
watch(devTools, (on) => {
  if (!on && tab.value === 'ast') tab.value = 'preview'
})

// 表示の切り替え (カラムメニュー)。カラムの幅と文字の大きさはデッキのものを使う
const noteFrame = ref(true)
const plain = ref(false)
const nowrap = ref(false)
const nyaize = ref(false)
const paused = ref(false)

const astJson = computed(() =>
  JSON.stringify(parseTokens(text.value, { simple: plain.value }), null, 2),
)

function loadSample(id: MfmPlaygroundSample['id'], closeMenu: () => void) {
  const sample = MFM_PLAYGROUND_SAMPLES.find((s) => s.id === id)
  if (sample) text.value = sample.text
  closeMenu()
}
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
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? i18n.ts._columns.mfmEditor"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i class="ti ti-text-caption tl-header-icon" />
    </template>

    <template #header-meta>
      <button
        class="_button"
        :class="$style.headerSendBtn"
        :disabled="!text.trim()"
        :title="i18n.ts._deckMfmEditorColumn.sendToPostFormTitle"
        @click.stop="sendToPostForm"
      >
        <i class="ti ti-send" />
      </button>
    </template>

    <template #menu-items="{ closeMenu }">
      <button class="_popupItem" @click="noteFrame = !noteFrame">
        <i :class="noteFrame ? 'ti ti-square-check' : 'ti ti-square'" />
        <span>{{ i18n.ts._mfmPlayground.noteFrame }}</span>
      </button>
      <button class="_popupItem" @click="plain = !plain">
        <i :class="plain ? 'ti ti-square-check' : 'ti ti-square'" />
        <span>plain</span>
      </button>
      <button class="_popupItem" @click="nowrap = !nowrap">
        <i :class="nowrap ? 'ti ti-square-check' : 'ti ti-square'" />
        <span>nowrap</span>
      </button>
      <button class="_popupItem" @click="nyaize = !nyaize">
        <i :class="nyaize ? 'ti ti-square-check' : 'ti ti-square'" />
        <span>{{ i18n.ts._mfmPlayground.nyaize }}</span>
      </button>
      <button v-if="devTools" class="_popupItem" @click="paused = !paused">
        <i :class="paused ? 'ti ti-square-check' : 'ti ti-square'" />
        <span>{{ i18n.ts._mfmPlayground.paused }}</span>
      </button>
      <div class="_popupDivider" />
      <button
        v-for="s in MFM_PLAYGROUND_SAMPLES"
        :key="s.id"
        class="_popupItem"
        @click="loadSample(s.id, closeMenu)"
      >
        <i class="ti ti-file-text" />
        <span>{{ i18n.ts._mfmPlayground.sample }}: {{ sampleLabels[s.id] }}</span>
      </button>
    </template>

    <div ref="scroller" :class="$style.colBody">
      <div :class="$style.editorPanel" :style="{ flex: `${editorRatio} 0 0` }">
        <textarea
          v-model="text"
          :class="$style.editor"
          :aria-label="i18n.ts._mfmPlayground.editorLabel"
          placeholder="MFM..."
          spellcheck="false"
        />
      </div>

      <div :class="$style.resizeHandle" @pointerdown="startResize">
        <div :class="$style.resizeGrip" />
      </div>

      <div :class="$style.lowerSection" :style="{ flex: `${1 - editorRatio} 0 0` }">
        <div :class="$style.tabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            class="_button"
            :class="[$style.tab, { [$style.active]: tab === t.id }]"
            @click="tab = t.id"
          >
            <i :class="t.icon" />
            {{ t.label }}
          </button>
        </div>

        <div v-if="tab === 'preview'" :class="$style.panel">
          <div
            :class="[$style.frame, noteFrame && $style.noteFrame]"
            :style="{ '--nd-mfm-play-state': paused ? 'paused' : 'running' }"
          >
            <MkMfm
              :text="text"
              :server-host="account?.host"
              :my-username="account?.username"
              :plain="plain"
              :nowrap="nowrap"
              :nyaize="nyaize"
            />
          </div>
        </div>
        <div v-else-if="tab === 'functions'" :class="[$style.panel, $style.panelFlush]">
          <MfmFunctionTable :server-host="account?.host" :paused="paused" />
        </div>
        <div v-else :class="[$style.panel, $style.panelFlush]">
          <CodeEditor :model-value="astJson" :language="jsonLanguage" read-only auto-height />
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
/* ヘッダーの送信ボタン: スクラッチパッドの実行ボタンと同じ寸法と塗り */
.headerSendBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  font-size: var(--nd-font-md);
  transition: background var(--nd-duration-base), opacity var(--nd-duration-base);

  &:hover:not(:disabled) {
    background: var(--nd-accentDarken);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.colBody {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editorPanel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.editor {
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--nd-fg);
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-sm);
  line-height: 1.6;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.resizeHandle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 8px;
  cursor: row-resize;
  background: var(--nd-bg);
  border-top: 1px solid var(--nd-divider);
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;

  &:hover .resizeGrip {
    background: var(--nd-accent);
  }
}

.resizeGrip {
  width: 32px;
  height: 3px;
  border-radius: var(--nd-radius-xs);
  background: var(--nd-divider);
  transition: background var(--nd-duration-base);
}

.lowerSection {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fg);
  opacity: 0.5;
  border-bottom: 2px solid transparent;
  transition: opacity var(--nd-duration-base), border-color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }

  &.active {
    opacity: 1;
    border-bottom-color: var(--nd-accent);
    color: var(--nd-accentText);
  }
}

.active {
  /* used as modifier */
}

.panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.panelFlush {
  padding: 0;
}

/* ノートと同じ切り取り (MkNote の .noteRoot と同じ contain / clip)。はみ出す
   MFM アートがデッキでどう見えるかをここで確かめる。枠線は付けず、ノートの文字の大きさ */
.frame {
  font-size: var(--nd-font-lg);
  color: var(--nd-fg);
}

.noteFrame {
  contain: content;
  overflow: clip;
}
</style>
