<script setup lang="ts">
// 通知カード (VS Code の Notifications のトースト)。右下に積み、受信トレイ
// (NotificationCenter) と同じ内容を一時的に見せる。軽い成功・情報は
// ステータス表示の場所があればそちらに出るので、ここには来ない (stores/toast)
import { useTemplateRef, watch } from 'vue'
import { usePortal } from '@/composables/usePortal'
import { useVaporTransitionGroup } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'
import { type ToastItem, useToast } from '@/stores/toast'
import { useIsCompactLayout } from '@/stores/ui'

const { toasts, runAction, dismiss, pause, resume } = useToast()
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
    role="status"
    aria-live="polite"
  >
    <div
      v-for="toast in rendered"
      :key="toast.id"
      class="_popup"
      :class="[
        $style.card,
        enteringIds.has(toast.id) && $style.cardEnter,
        leavingIds.has(toast.id) && $style.cardLeave,
      ]"
      @mouseenter="pause(toast.id)"
      @mouseleave="resume(toast.id)"
    >
      <div :class="$style.body">
        <i :class="[ICONS[toast.type], $style.icon, $style[toast.type]]" />
        <span :class="$style.text">{{ toast.text }}</span>
        <button
          class="_button"
          :class="$style.close"
          :title="i18n.ts._common.close"
          @click="dismiss(toast.id)"
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

.text {
  flex: 1;
  min-width: 0;
  font-size: 0.9em;
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
  padding: 5px 12px;
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
