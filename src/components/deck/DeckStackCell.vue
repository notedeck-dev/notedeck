<script setup lang="ts">
import { computed, provide, toRef, useCssModule, useTemplateRef } from 'vue'
import ColumnErrorBoundary from '@/components/deck/ColumnErrorBoundary.vue'
import ColumnShell, {
  COLUMN_SHELL_PREVIEW,
} from '@/components/deck/ColumnShell.vue'
import ColumnTombstone from '@/components/deck/ColumnTombstone.vue'
import { COLUMN_COMPONENTS } from '@/components/deck/columnComponents'
import { useColumnMount } from '@/composables/useColumnMount'
import type { DeckColumn } from '@/stores/deck'
import { useStreamInspectorStore } from '@/stores/streamInspector'

const props = defineProps<{
  colId: string
  column: DeckColumn | undefined
  isActive: boolean
  isCompact: boolean
  isDragSource: boolean
  dropZone: string | undefined
  shellPreview: string[]
}>()

const emit = defineEmits<{
  mousedown: [event: MouseEvent]
  pointerdown: [event: PointerEvent]
}>()

const $style = useCssModule()
// カラムのチャンク読み込み中に出す ColumnShell (defineAsyncComponent の
// loadingComponent) は props を受け取れないので inject で渡す
provide(COLUMN_SHELL_PREVIEW, toRef(props, 'shellPreview'))
const cellRef = useTemplateRef<HTMLElement>('cellRef')

// Stream Inspector が存在する間は画面外カラムも mount 維持し、購読を生かして
// 観測可能にする（モバイルの自動 unload 対策）。
const inspectorStore = useStreamInspectorStore()
const { shouldMount } = useColumnMount(props.colId, cellRef, {
  isCompact: toRef(props, 'isCompact'),
  isActive: toRef(props, 'isActive'),
  keepMounted: computed(() => inspectorStore.capturing),
})

const columnComponent = computed(() =>
  props.column ? COLUMN_COMPONENTS[props.column.type] : null,
)

// 種別が registry に無い = 提供元プラグインが未起動 / 無効 / 削除 (#794)。
// mount 判定 (shouldMount) とは独立に判断する — 画面外で mount されていない
// だけの通常カラムを墓標にしてはいけない
const isUnknownType = computed(
  () => !!props.column && !COLUMN_COMPONENTS[props.column.type],
)
</script>

<template>
  <div
    ref="cellRef"
    class="stack-cell"
    :class="[$style.stackCell, { [$style.dragSource]: isDragSource }]"
    :data-column-id="colId"
    :data-drop-zone="dropZone"
    @mousedown="emit('mousedown', $event)"
    @pointerdown="emit('pointerdown', $event)"
  >
    <ColumnErrorBoundary v-if="shouldMount && column && columnComponent">
      <component
        :is="columnComponent"
        :key="colId"
        :column="column"
      />
    </ColumnErrorBoundary>
    <ColumnTombstone
      v-else-if="isUnknownType && column"
      :col-id="colId"
      :type="column.type"
    />
    <ColumnShell v-else />
  </div>
</template>

<style lang="scss" module>
.stackCell {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;

  &[data-drop-zone]::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: none;
    z-index: 10;
    border-radius: 10px;
  }

  &[data-drop-zone="swap"]::after {
    inset: 0;
    background: color-mix(in srgb, var(--nd-accent) 20%, transparent);
    border: 2px solid var(--nd-accent);
  }

  &[data-drop-zone="above"]::after {
    top: 0;
    height: 50%;
    background: var(--nd-accent-hover);
    border-bottom: 3px solid var(--nd-accent);
    border-radius: 10px 10px 0 0;
  }

  &[data-drop-zone="below"]::after {
    bottom: 0;
    height: 50%;
    background: var(--nd-accent-hover);
    border-top: 3px solid var(--nd-accent);
    border-radius: 0 0 10px 10px;
  }
}

.dragSource {
  opacity: 0.4;
}

</style>
