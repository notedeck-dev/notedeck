<script setup lang="ts">
// 受信トレイの中身 (見出し + 一覧)。デスクトップのパネルとモバイルの
// ボトムシートで共有する
import { i18n } from '@/i18n'
import { type ToastItem, useToast } from '@/stores/toast'
import { formatTime } from '@/utils/formatTime'

const emit = defineEmits<{ close: [] }>()

const { inbox, runAction, removeFromInbox, clearInbox } = useToast()

const ICONS: Record<ToastItem['type'], string> = {
  success: 'ti ti-circle-check',
  info: 'ti ti-info-circle',
  warning: 'ti ti-alert-triangle',
  error: 'ti ti-circle-x',
}
</script>

<template>
  <div :class="$style.header">
    <span :class="$style.title">{{ i18n.ts._notificationCenter.title }}</span>
    <button
      class="_button"
      :class="$style.headerBtn"
      :disabled="inbox.length === 0"
      :title="i18n.ts._notificationCenter.clearAll"
      @click="clearInbox()"
    >
      <i class="ti ti-clear-all" />
    </button>
    <button
      class="_button"
      :class="$style.headerBtn"
      :title="i18n.ts._common.close"
      @click="emit('close')"
    >
      <i class="ti ti-chevron-down" />
    </button>
  </div>
  <div :class="$style.list">
    <div v-if="inbox.length === 0" :class="$style.empty">
      {{ i18n.ts._notificationCenter.empty }}
    </div>
    <div
      v-for="item in inbox"
      :key="item.id"
      :class="$style.item"
    >
      <i :class="[ICONS[item.type], $style.icon, $style[item.type]]" />
      <div :class="$style.main">
        <span :class="$style.text">{{ item.text }}</span>
        <div :class="$style.meta">
          <time :datetime="new Date(item.time).toISOString()" :class="$style.time">{{ formatTime(item.time) }}</time>
          <button
            v-if="item.action"
            class="_button"
            :class="$style.actionBtn"
            @click="runAction(item)"
          >
            {{ item.action.label }}
          </button>
        </div>
      </div>
      <button
        class="_button"
        :class="$style.remove"
        :title="i18n.ts._common.close"
        @click="removeFromInbox(item.id)"
      >
        <i class="ti ti-x" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 6px 6px 14px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.title {
  flex: 1;
  font-size: 0.75em;
  font-weight: bold;
  letter-spacing: 0.04em;
  opacity: 0.7;
}

.headerBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  font-size: 16px;
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover:not(:disabled) {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.25;
    cursor: default;
  }
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 0.85em;
  opacity: 0.5;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px 10px 14px;
  border-bottom: 1px solid var(--nd-divider);

  &:last-child {
    border-bottom: none;
  }

  &:hover .remove {
    opacity: 0.6;
  }

  .remove:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.icon {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 16px;
}

.success { color: var(--nd-success); }
.info { color: var(--nd-link); }
.warning { color: var(--nd-warn); }
.error { color: var(--nd-error); }

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.text {
  font-size: 0.9em;
  line-height: 1.45;
  overflow-wrap: anywhere;
  user-select: text;
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  font-size: 0.75em;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.actionBtn {
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-accent);

  &:hover {
    text-decoration: underline;
  }
}

.remove {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  font-size: 14px;
  opacity: 0;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:focus-visible {
    opacity: 1;
  }
}

/* タッチ環境は hover が無いので常に見せる */
@media (hover: none) {
  .remove {
    opacity: 0.5;
  }
}
</style>
