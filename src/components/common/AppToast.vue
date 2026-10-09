<script setup lang="ts">
// 通知カード (VS Code の Notifications のトースト)。右下に積み、受信トレイ
// (NotificationCenter) と同じ内容を一時的に見せる。軽い成功・情報は
// ステータス表示の場所があればそちらに出るので、ここには来ない (stores/toast)
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { usePortal } from '@/composables/usePortal'
import { useVaporTransitionGroup } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'
import { type ToastItem, useToast } from '@/stores/toast'
import { useIsCompactLayout } from '@/stores/ui'
import { captureFlip, type FlipSnapshot, playFlip } from '@/utils/flip'

const { toasts, runAction, open, dismiss, pause, resume } = useToast()
const isCompact = useIsCompactLayout()
const { rendered, enteringIds, leavingIds } = useVaporTransitionGroup(toasts, {
  enterDuration: 280,
  // CSS の cardOut (--nd-duration-base) と揃える。短いと途中で消える
  leaveDuration: 150,
})

const toastPortalRef = useTemplateRef<HTMLElement>('toastPortalRef')
usePortal(toastPortalRef)

// showModal() 中の <dialog> (AddColumnDialog 等) は top layer に入るため、
// body 直下のカードは z-index をいくら上げても上に出られない。
// 表示時に開いている modal dialog があればコンテナをその中へ移動し、
// dialog と同じ top layer 内で描画させる (position:fixed なので表示位置は
// 従来どおりビューポート基準)。dialog が無ければ body へ戻す。
watch(
  () => rendered.value.length,
  (len) => {
    const el = toastPortalRef.value
    if (!el || len === 0) return
    let host: HTMLElement = document.body
    try {
      host =
        document.querySelector<HTMLElement>('dialog:modal') ?? document.body
    } catch {
      // :modal セレクタ未対応環境は body のまま (従来挙動)
    }
    if (el.parentNode !== host) host.appendChild(el)
  },
)

// 退場したカードが外れた / 新しいカードが積まれたとき、残りのカードを
// 新しい位置へ滑らせる (瞬間移動させない)。縦に積むだけなので y だけ補間
const cardKey = (el: HTMLElement) => el.dataset.toastId
function cardElements() {
  return (
    toastPortalRef.value?.querySelectorAll<HTMLElement>('[data-toast-id]') ?? []
  )
}
let flipSnapshot: FlipSnapshot | null = null
watch(
  () => rendered.value.map((t) => t.id).join(','),
  () => {
    flipSnapshot = captureFlip(cardElements(), cardKey)
  },
  { flush: 'pre' },
)
watch(
  () => rendered.value.map((t) => t.id).join(','),
  () => {
    const snap = flipSnapshot
    flipSnapshot = null
    if (snap) playFlip(snap, cardElements(), cardKey, null, 'y')
  },
  { flush: 'post' },
)

// 読み上げ。エラーは割り込み (assertive)、それ以外は手が空いたとき (polite)。
// カードそのものを live region にすると種類で分けられないので、文言だけを
// 隠しの 2 つの領域に流す。同じ通知の繰り返しも回数が増えたら読み直す
const politeText = ref('')
const alertText = ref('')
const announced = new Map<number, number>()
watch(
  toasts,
  (list) => {
    const live = new Set<number>()
    let latest: ToastItem | null = null
    for (const t of list) {
      live.add(t.id)
      if (announced.get(t.id) !== t.count) latest = t
      announced.set(t.id, t.count)
    }
    for (const id of announced.keys()) if (!live.has(id)) announced.delete(id)
    if (!latest) return
    const target = latest.type === 'error' ? alertText : politeText
    const text = latest.source
      ? `${latest.source}: ${latest.text}`
      : latest.text
    // 同じ文言でも読み直させるため一度空にする
    target.value = ''
    void nextTick(() => {
      target.value = text
    })
  },
  { flush: 'post' },
)

function onCardClick(toast: ToastItem) {
  if (!toast.onClick) return
  if (window.getSelection()?.toString()) return
  open(toast.id)
}

const ICONS: Record<ToastItem['type'], string> = {
  success: 'ti ti-circle-check',
  info: 'ti ti-info-circle',
  warning: 'ti ti-alert-triangle',
  error: 'ti ti-circle-x',
}
</script>

<template>
  <div
    ref="toastPortalRef"
    :class="[$style.container, isCompact && $style.compact]"
  >
    <div :class="$style.srOnly" role="status" aria-live="polite" aria-atomic="true">{{ politeText }}</div>
    <div :class="$style.srOnly" role="alert" aria-live="assertive" aria-atomic="true">{{ alertText }}</div>
    <div
      v-for="toast in rendered"
      :key="toast.id"
      :data-toast-id="toast.id"
      class="_popup"
      :class="[
        $style.card,
        enteringIds.has(toast.id) && $style.cardEnter,
        leavingIds.has(toast.id) && $style.cardLeave,
      ]"
      @mouseenter="pause(toast.id)"
      @mouseleave="resume(toast.id)"
    >
      <div
        :class="[$style.body, toast.onClick && $style.clickable]"
        @click="onCardClick(toast)"
      >
        <i :class="[ICONS[toast.type], $style.icon, $style[toast.type]]" />
        <span :class="$style.text">
          <span v-if="toast.source" :class="$style.source">{{ toast.source }}</span>
          {{ toast.text }}
        </span>
        <span
          v-if="toast.count > 1"
          :class="$style.count"
          :title="i18n.tsx._notificationCenter.countTitle({ count: toast.count })"
        >{{ i18n.tsx._notificationCenter.count({ count: toast.count }) }}</span>
        <button
          class="_button"
          :class="$style.close"
          :title="i18n.ts._common.close"
          @click.stop="dismiss(toast.id)"
        >
          <i class="ti ti-x" />
        </button>
      </div>
      <div v-if="toast.action" :class="$style.actions">
        <button
          class="_button"
          :class="$style.actionBtn"
          @click="runAction(toast)"
        >
          {{ toast.action.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.container {
  position: fixed;
  right: 12px;
  /* デスクトップはボトムバー (42px) の上 */
  bottom: 54px;
  z-index: var(--nd-z-toast);
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 8px;
  width: min(400px, calc(100vw - 24px));
  pointer-events: none;

  &.compact {
    right: 8px;
    left: 8px;
    width: auto;
    bottom: calc(var(--nd-mobileNavHeight, 0px) + 8px);
  }
}

.card {
  width: 100%;
  color: var(--nd-fg);
  pointer-events: auto;
  overflow: hidden;
}

.body {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 8px 10px 12px;
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

.clickable {
  cursor: pointer;
}

.source {
  display: block;
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
  opacity: 0.7;
}

.count {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  font-size: var(--nd-font-xs);
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
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

.text {
  flex: 1;
  min-width: 0;
  font-size: var(--nd-font-body);
  line-height: 1.45;
  overflow-wrap: anywhere;
  user-select: text;
}

.close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  font-size: 14px;
  opacity: 0.5;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 12px 10px;
}

.actionBtn {
  @include btn-primary;
  padding: 6px 12px;
}

.cardEnter {
  animation: cardIn var(--nd-duration-slow) var(--nd-ease-decel) both;
}

.cardLeave {
  animation: cardOut var(--nd-duration-base) var(--nd-ease-decel) both;
  pointer-events: none;
}

@keyframes cardIn {
  from { opacity: 0; translate: 0 12px; }
}

@keyframes cardOut {
  to { opacity: 0; translate: 16px 0; }
}
</style>
