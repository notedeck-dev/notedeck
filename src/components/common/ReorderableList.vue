<script setup lang="ts">
import { usePointerReorder } from '@/composables/usePointerReorder'
import { proxyThumbUrl } from '@/utils/mediaProxy'

export interface ReorderableItem {
  icon: string
  label: string
  avatarUrl?: string | null
  serverIconUrl?: string | null
  stackCount?: number
  dimmed?: boolean
}

const props = defineProps<{
  items: ReorderableItem[]
  dataAttr: string
  emptyText?: string
}>()

const emit = defineEmits<{
  reorder: [fromIndex: number, toIndex: number]
  remove: [index: number]
}>()

const { dragFromIndex, dragOverIndex, startDrag } = usePointerReorder({
  dataAttr: props.dataAttr,
  onReorder(fromIdx, toIdx) {
    emit('reorder', fromIdx, toIdx)
  },
})
</script>

<template>
  <div :class="$style.list">
    <div
      v-for="(item, i) in props.items"
      :key="i"
      :[`data-${props.dataAttr}`]="i"
      :class="[$style.row, { [$style.rowDimmed]: item.dimmed, [$style.rowDragging]: dragFromIndex === i, [$style.rowDragOver]: dragOverIndex === i }]"
    >
      <i class="ti ti-grip-vertical" :class="$style.grip" @pointerdown="startDrag(i, $event)" />
      <span :class="$style.icon">
        <i :class="['ti', 'ti-' + item.icon]" />
      </span>
      <span :class="$style.label">{{ item.label }}</span>
      <span v-if="item.stackCount && item.stackCount > 1" :class="$style.stackBadge">{{ item.stackCount }}</span>
      <span v-if="item.serverIconUrl || item.avatarUrl" :class="$style.badges">
        <img v-if="item.avatarUrl" :src="proxyThumbUrl(item.avatarUrl, 56)" :class="$style.badgeImg" />
        <img v-if="item.serverIconUrl" :src="item.serverIconUrl" :class="$style.badgeImg" />
      </span>
      <button class="_button" :class="$style.removeBtn" @click="emit('remove', i)">
        <i class="ti ti-x" />
      </button>
    </div>
    <div v-if="props.items.length === 0" :class="$style.empty">
      {{ props.emptyText ?? '項目なし' }}
    </div>
  </div>
</template>

<style lang="scss" module>
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--nd-panel);
  border-radius: var(--nd-radius-sm);
  min-height: 44px;

  &.rowDimmed {
    opacity: 0.6;
  }

  &.rowDragging {
    opacity: 0.3;
  }

  &.rowDragOver {
    outline: 2px solid var(--nd-accent);
    outline-offset: -2px;
  }
}

.grip {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--nd-fg);
  opacity: 0.25;
  cursor: grab;
  touch-action: none;
  padding: 8px 4px;
  margin: -8px -4px;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  font-size: 1em;
  color: var(--nd-fg);
}

.label {
  flex: 1;
  min-width: 0;
  font-size: 0.85em;
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stackBadge {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--nd-accent);
  color: var(--nd-bg);
  font-size: 10px;
  font-weight: bold;
  line-height: 18px;
  text-align: center;
  flex-shrink: 0;
}

.badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.badgeImg {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
}

.removeBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  margin-left: 4px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.35;
  transition: opacity var(--nd-duration-fast), color var(--nd-duration-fast), background var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    color: var(--nd-love, #ec4137);
    background: color-mix(in srgb, var(--nd-love, #ec4137) 10%, transparent);
  }
}

.empty {
  padding: 8px;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.75em;
}
</style>
