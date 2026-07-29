<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useBackButton } from '@/composables/useBackButton'
import { useMenuKeyboard } from '@/composables/useMenuKeyboard'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNativePopover } from '@/composables/useNativePopover'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { useIsCompactLayout } from '@/stores/ui'
import { COLUMN_SELECTOR, extractThemeVars } from '@/utils/themeVars'

const emit = defineEmits<{
  close: []
}>()

const isCompact = useIsCompactLayout()

const showMenu = ref(false)
const menuPos = ref({ x: 0, y: 0 })
// 押下点アンカー (右クリック) か、トリガー要素アンカー (ボタン押下) か
const pointAnchored = ref(false)
const menuTheme = ref<Record<string, string>>({})
// desktop: popover 要素 = メニュー本体 / compact: シート本体 (dialog の子)
const menuRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLDialogElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

const { visible, entering, leaving } = useVaporTransition(showMenu, {
  enterDuration: 200,
  leaveDuration: 200,
})

const { activate: activateKeyboard, deactivate: deactivateKeyboard } =
  useMenuKeyboard({
    containerRef: menuRef,
    itemSelector: 'button',
    onClose: () => close(),
  })

watch(visible, (v) => {
  if (v) nextTick(activateKeyboard)
  else deactivateKeyboard()
})

useNativePopover(
  menuRef,
  computed(() => visible.value && !isCompact.value),
  {
    onClose: () => close(),
    leaveDuration: 200,
    dismissOnOutsideClick: true,
    ignoreOutsideClickFor: triggerRef,
  },
)

// compact のボトムシートは設定メニュー等と同じ dialog ホスト
// (::backdrop の暗転 + navMenu.scss のスライドをそのまま共有)
useNativeDialog(
  dialogRef,
  computed(() => visible.value && isCompact.value),
  {
    onCancel: () => close(),
    leaveDuration: 200,
  },
)

// Android back button / gesture でシートを閉じる
useBackButton(showMenu, () => close())

function open(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement | null
  triggerRef.value = el
  // 同じトリガー再押下はトグル (close)
  if (showMenu.value) {
    close()
    return
  }
  const column = (el ?? (e.target as HTMLElement))?.closest(
    COLUMN_SELECTOR,
  ) as HTMLElement | null
  if (column) menuTheme.value = extractThemeVars(column)

  showMenu.value = true

  // ボトムシート (compact) は下端固定なので位置計算不要
  if (isCompact.value) return

  // Misskey 本家と同じ 2 方式で配置する。
  // 右クリック (MkContextMenu): 押下点をメニューの左上頂点にする
  // ボタン押下 (MkModal の anchor x=center/y=bottom): ボタンの水平中央に
  //   メニューの中央を合わせ、ボタン直下に出す
  const anchorEl = e.type === 'contextmenu' ? null : el
  // 拡大アニメーションの起点も本家に合わせる (押下点なら左上、ボタンなら上辺中央)
  pointAnchored.value = anchorEl == null
  // 押下点に被ると最初のメニュー項目を誤タップしやすいので少し下にずらす
  menuPos.value = { x: e.clientX + 4, y: e.clientY + 10 }

  nextTick(() => {
    // popover は showPopover() されるまで display:none で寸法が取れないため、
    // 表示後の次フレーム (描画前) に測って位置を確定する
    requestAnimationFrame(() => {
      const menu = menuRef.value
      if (!menu) return
      const rect = menu.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      let { x, y } = menuPos.value
      if (anchorEl) {
        const anchorRect = anchorEl.getBoundingClientRect()
        x = anchorRect.left + anchorRect.width / 2 - rect.width / 2
        y = anchorRect.bottom
      }
      if (x + rect.width > vw) x = vw - rect.width - 8
      if (y + rect.height > vh) y = vh - rect.height - 8
      menuPos.value = { x: Math.max(8, x), y: Math.max(8, y) }
    })
  })
}

function close() {
  showMenu.value = false
  emit('close')
}

defineExpose({ open, close, activateKeyboard })
</script>

<template>
    <!-- compact: 画面下からスライドするボトムシート (設定メニュー等と同じ dialog + navMenu.scss パターン) -->
    <dialog
      v-if="visible && isCompact"
      ref="dialogRef"
      class="_nativeDialog"
      :class="[$style.mobileBackdrop, leaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
    >
      <div
        ref="menuRef"
        :class="[$style.sheet, leaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
        class="_popup nd-popup-content popup-menu"
        :style="menuTheme"
        @pointerdown.stop
      >
        <slot />
      </div>
    </dialog>
    <!-- desktop: 押下点アンカーのポップアップ -->
    <div
      v-else-if="visible"
      ref="menuRef"
      popover="manual"
      :class="[$style.popupMenu, pointAnchored && $style.pointAnchored, entering && $style.contentEnter, leaving && $style.contentLeave]"
      class="_popup nd-popup-content popup-menu"
      :style="{ ...menuTheme, top: menuPos.y + 'px', left: menuPos.x + 'px' }"
    >
      <slot />
    </div>
</template>

<style lang="scss" module>
@use '@/styles/popup';
@use '@/styles/navMenu';

.popupMenu {
  position: fixed;
  min-width: 200px;
  max-width: 300px;
  padding: 6px 0;
  // ボタン直下に中央揃えで出るので上辺中央から開く (本家 MkModal と同じ)
  transform-origin: center top;

  // 押下点アンカー時は本家 MkContextMenu と同じく左上から開く
  &.pointAnchored {
    transform-origin: left top;
  }
}

.sheet {
  width: 100%;
  max-height: 70vh;
  max-height: 70dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 16px 16px 0 0;
  padding: 8px 0 calc(8px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));
}

</style>
