<script setup lang="ts">
import { computed, toRef, useCssModule, useTemplateRef } from 'vue'
import { COLUMN_COMPONENTS } from '@/columns/registry'
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

defineEmits<{
  mousedown: [event: MouseEvent]
  pointerdown: [event: PointerEvent]
}>()

const $style = useCssModule()
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
</script>

<template>
  <div
    ref="cellRef"
    class="stack-cell"
    :class="[$style.stackCell, { [$style.dragSource]: isDragSource }]"
    :data-column-id="colId"
    :data-drop-zone="dropZone"
    @mousedown="$emit('mousedown', $event)"
    @pointerdown="$emit('pointerdown', $event)"
  >
    <component
      :is="columnComponent"
      v-if="shouldMount && column && columnComponent"
      :key="colId"
      :column="column"
    />
    <div v-else :class="$style.columnShell" aria-hidden="true">
      <div :class="$style.columnShellHeader" />
      <div :class="$style.columnShellBody">
        <template v-if="shellPreview.length > 0">
          <div
            v-for="(line, i) in shellPreview"
            :key="i"
            :class="$style.columnShellPreview"
          >{{ line || '\u00A0' }}</div>
        </template>
        <template v-else>
          <div :class="$style.columnShellLine" />
          <div :class="[$style.columnShellLine, $style.columnShellLineWide]" />
          <div :class="$style.columnShellCard" />
          <div :class="$style.columnShellCard" />
        </template>
      </div>
    </div>
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

.columnShell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--nd-panel) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--nd-divider, currentColor) 30%, transparent);
}

.columnShellHeader {
  height: 38px;
  flex-shrink: 0;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--nd-panelHeaderBg, var(--nd-panel)) 85%, transparent),
      color-mix(in srgb, var(--nd-panelHeaderBg, var(--nd-panel)) 60%, transparent),
      color-mix(in srgb, var(--nd-panelHeaderBg, var(--nd-panel)) 85%, transparent)
    );
  background-size: 200% 100%;
  animation: nd-shell-shimmer 1.6s linear infinite;
}

.columnShellBody {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.columnShellLine,
.columnShellCard {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--nd-panel) 75%, transparent),
      color-mix(in srgb, var(--nd-panel) 55%, transparent),
      color-mix(in srgb, var(--nd-panel) 75%, transparent)
    );
  background-size: 200% 100%;
  animation: nd-shell-shimmer 1.6s linear infinite;
}

.columnShellLine {
  height: 10px;
  border-radius: 999px;
  width: 58%;
}

.columnShellLineWide {
  width: 82%;
}

.columnShellCard {
  height: 96px;
  border-radius: 12px;
}

@keyframes nd-shell-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.columnShellPreview {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--nd-fg);
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid color-mix(in srgb, var(--nd-divider, currentColor) 15%, transparent);
}
</style>
