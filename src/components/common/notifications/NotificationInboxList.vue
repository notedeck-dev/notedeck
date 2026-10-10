<script setup lang="ts">
// 受信トレイの中身 (見出し + 一覧)。デスクトップのパネルとモバイルの
// ボトムシートで共有する。開くたびにマウントされるので、マウント時に一覧へ
// フォーカスを移し、閉じるときは開く前の場所へ返す (VS Code の通知センターと同じ)
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppTime from '@/components/common/AppTime.vue'
import { i18n } from '@/i18n'
import { type ToastItem, useToast } from '@/stores/toast'

const emit = defineEmits<{ close: [] }>()

const {
  inbox,
  freshIds,
  recentStatus,
  runAction,
  open,
  removeFromInbox,
  clearInbox,
} = useToast()

const ICONS: Record<ToastItem['type'], string> = {
  success: 'ti ti-circle-check',
  info: 'ti ti-info-circle',
  warning: 'ti ti-alert-triangle',
  error: 'ti ti-circle-x',
}

// --- 長い本文の折りたたみ (2 行を超えるもの) ---
const expanded = ref<ReadonlySet<number>>(new Set())
const overflowing = ref<ReadonlySet<number>>(new Set())

function toggleExpanded(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

/** 畳んだ状態で本文がはみ出しているかを測る (展開中は前回の結果を保つ) */
function measure(id: number, el: unknown) {
  if (!(el instanceof HTMLElement) || expanded.value.has(id)) return
  const over = el.scrollHeight > el.clientHeight + 1
  if (over === overflowing.value.has(id)) return
  const next = new Set(overflowing.value)
  if (over) next.add(id)
  else next.delete(id)
  overflowing.value = next
}

function onItemClick(item: ToastItem) {
  // 本文を選択しているときは押したことにしない (コピーのための選択を邪魔しない)
  if (window.getSelection()?.toString()) return
  if (item.onClick) open(item.id)
  else if (overflowing.value.has(item.id)) toggleExpanded(item.id)
}

// --- キーボード: 矢印で移動 / Delete で消す / Enter で開く / Esc で閉じる ---
const rootRef = ref<HTMLElement | null>(null)
const focusIndex = ref(0)

function itemElements(): HTMLElement[] {
  return [
    ...(rootRef.value?.querySelectorAll<HTMLElement>('[data-inbox-item]') ??
      []),
  ]
}

function focusItem(index: number) {
  const els = itemElements()
  if (els.length === 0) {
    rootRef.value?.querySelector<HTMLElement>('[data-inbox-list]')?.focus()
    return
  }
  const i = Math.max(0, Math.min(index, els.length - 1))
  focusIndex.value = i
  els[i]?.focus()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  const els = itemElements()
  const target = e.target as HTMLElement
  const index = els.indexOf(target)
  // 行の中のボタンにフォーカスがあるときは矢印だけ受ける
  const rowIndex =
    index >= 0 ? index : els.findIndex((el) => el.contains(target))
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      focusItem(rowIndex + 1)
      return
    case 'ArrowUp':
      e.preventDefault()
      focusItem(rowIndex < 0 ? 0 : rowIndex - 1)
      return
    case 'Home':
      if (index < 0) return
      e.preventDefault()
      focusItem(0)
      return
    case 'End':
      if (index < 0) return
      e.preventDefault()
      focusItem(els.length - 1)
      return
  }
  if (index < 0) return
  const item = inbox.value[index]
  if (!item) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    removeFromInbox(item.id)
    void nextTick(() => focusItem(index))
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (item.onClick) open(item.id)
    else if (overflowing.value.has(item.id)) toggleExpanded(item.id)
  }
}

let returnFocus: HTMLElement | null = null
onMounted(() => {
  returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  // popover / dialog が開き終わってから移す (開く前はフォーカスできず、
  // 本文の高さも測れない)
  requestAnimationFrame(() => {
    for (const el of rootRef.value?.querySelectorAll<HTMLElement>(
      '[data-inbox-text]',
    ) ?? []) {
      measure(Number(el.dataset.inboxText), el)
    }
    focusItem(0)
  })
})
onBeforeUnmount(() => {
  const active = document.activeElement
  // 一覧の中に居た (または外れて body に落ちた) ときだけ返す。
  // 外を押して閉じたときは押した先のフォーカスを奪わない
  const inside =
    !active ||
    active === document.body ||
    (rootRef.value?.contains(active) ?? false)
  if (inside && returnFocus?.isConnected) returnFocus.focus()
})
</script>

<template>
  <div ref="rootRef" :class="$style.root" @keydown="onKeydown">
    <div :class="$style.header">
      <span :class="$style.title">{{ i18n.ts._notificationCenter.title }}</span>
      <button
        class="_button"
        :class="$style.headerBtn"
        :disabled="inbox.length === 0 && !recentStatus"
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
    <div
      data-inbox-list
      :class="$style.list"
      role="list"
      :aria-label="i18n.ts._notificationCenter.title"
      tabindex="-1"
    >
      <!-- ステータス表示から開いたときだけ添える直前の軽い通知 (#1218)。
           受信トレイには残らないので、矢印キーの移動や消すボタンの対象にしない -->
      <div v-if="recentStatus" :class="[$style.item, $style.recent]">
        <i :class="[ICONS[recentStatus.type], $style.icon, $style[recentStatus.type]]" />
        <div :class="$style.main">
          <span :class="[$style.text, $style.clamped]">{{ recentStatus.text }}</span>
          <div :class="$style.meta">
            <span v-if="recentStatus.source" :class="$style.source">{{ recentStatus.source }}</span>
            <span :class="$style.time"><AppTime :at="recentStatus.time" /></span>
            <span :class="$style.time">{{ i18n.ts._notificationCenter.recentStatus }}</span>
          </div>
        </div>
      </div>
      <div v-if="inbox.length === 0 && !recentStatus" :class="$style.empty">
        {{ i18n.ts._notificationCenter.empty }}
      </div>
      <div
        v-for="(item, index) in inbox"
        :key="item.id"
        data-inbox-item
        role="listitem"
        :tabindex="index === focusIndex ? 0 : -1"
        :class="[$style.item, freshIds.has(item.id) && $style.fresh]"
        @focus="focusIndex = index"
      >
        <i :class="[ICONS[item.type], $style.icon, $style[item.type]]" />
        <div
          :class="[$style.main, item.onClick && $style.clickable]"
          @click="onItemClick(item)"
        >
          <span
            :ref="(el) => measure(item.id, el)"
            :data-inbox-text="item.id"
            :class="[$style.text, !expanded.has(item.id) && $style.clamped]"
          ><span v-if="freshIds.has(item.id)" :class="$style.srOnly">{{ i18n.ts._notificationCenter.fresh }}: </span>{{ item.text }}</span>
          <div :class="$style.meta">
            <span v-if="item.source" :class="$style.source">{{ item.source }}</span>
            <span :class="$style.time"><AppTime :at="item.time" /></span>
            <span
              v-if="item.count > 1"
              :class="$style.count"
              :title="i18n.tsx._notificationCenter.countTitle({ count: item.count })"
            >{{ i18n.tsx._notificationCenter.count({ count: item.count }) }}</span>
            <button
              v-if="item.action"
              class="_button"
              :class="$style.actionBtn"
              @click.stop="runAction(item)"
            >
              {{ item.action.label }}
            </button>
            <button
              v-if="overflowing.has(item.id)"
              class="_button"
              :class="$style.expandBtn"
              tabindex="-1"
              :aria-expanded="expanded.has(item.id)"
              :title="expanded.has(item.id) ? i18n.ts._notificationCenter.collapse : i18n.ts._notificationCenter.expand"
              @click.stop="toggleExpanded(item.id)"
            >
              <i :class="expanded.has(item.id) ? 'ti ti-chevron-up' : 'ti ti-chevron-down'" />
            </button>
          </div>
        </div>
        <button
          class="_button"
          :class="$style.remove"
          tabindex="-1"
          :title="i18n.ts._notificationCenter.remove"
          @click="removeFromInbox(item.id)"
        >
          <i class="ti ti-x" />
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.root {
  display: contents;
}

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
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
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

  &:focus {
    outline: none;
  }
}

.empty {
  padding: 28px 16px;
  text-align: center;
  font-size: var(--nd-font-md);
  opacity: 0.5;
}

.item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px 10px 14px;
  border-bottom: 1px solid var(--nd-divider);

  &:last-child {
    border-bottom: none;
  }

  &:focus {
    outline: none;
  }

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: -2px;
  }

  &:hover .remove,
  &:focus-within .remove {
    opacity: 0.6;
  }

  .remove:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

/* ステータス表示から添えた直前の軽い通知。一覧の行より控えめに見せる */
.recent {
  opacity: 0.6;
}

/* 今回開いた時点で未読だったもの。左端の帯と薄い下地で見分ける */
.fresh {
  background: color-mix(in srgb, var(--nd-accent) 6%, transparent);
  box-shadow: inset 2px 0 0 var(--nd-accent);
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

.clickable {
  cursor: pointer;
}

.text {
  font-size: var(--nd-font-body);
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
}

.clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--nd-font-xs);
}

.source {
  opacity: 0.7;
  font-weight: var(--nd-weight-bold);
}

.time {
  opacity: 0.5;
}

.count {
  padding: 0 6px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

.actionBtn {
  font-size: var(--nd-font-sm);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-accent);

  &:hover {
    text-decoration: underline;
  }
}

.expandBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  border-radius: var(--nd-radius-sm);
  font-size: 14px;
  opacity: 0.6;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
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
