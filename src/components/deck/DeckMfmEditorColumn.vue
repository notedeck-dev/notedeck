<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import MfmPlayground from '@/components/common/MfmPlayground.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useUiStore } from '@/stores/ui'
import DeckColumn from './DeckColumn.vue'

/**
 * MFM エディターカラム。共通部品 MfmPlayground (Dev Dashboard の MFM プレビューと同じ) を
 * デッキに置き、本文をカラム設定 (`mfmText`) に持つ。書けたら投稿フォームへ送る。
 * アカウントに紐づかないので、絵文字の解決とメンションの強調は予備のアカウントで行う
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

    <div ref="scroller" :class="$style.body">
      <MfmPlayground
        v-model="text"
        :server-host="account?.host"
        :my-username="account?.username"
      >
        <template #editorActions>
          <button
            type="button"
            :class="$style.sendBtn"
            :disabled="!text.trim()"
            :title="i18n.ts._deckMfmEditorColumn.sendToPostFormTitle"
            @click="sendToPostForm"
          >
            <i class="ti ti-send" /> {{ i18n.ts._deckMfmEditorColumn.sendToPostForm }}
          </button>
        </template>
      </MfmPlayground>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.sendBtn {
  @include btn-primary;
  flex: none;
  padding: 4px 10px;
  font-size: var(--nd-font-sm);
}
</style>
