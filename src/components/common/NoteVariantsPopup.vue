<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import AccountAvatar from '@/components/common/AccountAvatar.vue'
import { useNativePopover } from '@/composables/useNativePopover'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'
import type { NoteGroup } from '@/services/noteGroup'
import { canonicalReactionKey } from '@/services/reactionKey'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  useAccountsStore,
} from '@/stores/accounts'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { COLUMN_SELECTOR, extractThemeVars } from '@/utils/themeVars'

/**
 * 束ねたノートの内訳 (#1058 §7)。役割は「どこで見えているか・どれが主か」に
 * 限定し、サーバー別の数字は出さない (並べるとユーザーが足し算する。Like は
 * 複数サーバーに重複配送されるので合算は二重計上になる)。情報のみで、操作は
 * ノートメニューに任せる (ポップアップ = プレビュー / メニュー = アクション)。
 */
const props = defineProps<{
  group: NoteGroup
}>()

const accountsStore = useAccountsStore()
const show = ref(false)
const pos = ref({ x: 0, y: 0 })
const maxWidth = ref(360)
const theme = ref<Record<string, string>>({})
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

const { visible, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  // 退場アニメ (.leave = --nd-duration-base) と同じ時間
  leaveDuration: 150,
})

useNativePopover(rootRef, visible, {
  onClose: () => close(),
  leaveDuration: 150,
  dismissOnOutsideClick: true,
  ignoreOutsideClickFor: triggerRef,
})

const rows = computed(() =>
  props.group.variants.map((v) => {
    const account = accountsStore.accountMap.get(v._accountId)
    const my = (v.renote && v.text == null ? v.renote : v).myReaction
    const reacted = my
      ? props.group.reactedBy.has(canonicalReactionKey(my, v._serverHost))
      : false
    return {
      key: `${v._accountId}:${v.id}`,
      label: account ? getAccountLabel(account) : v._accountId,
      avatarUrl: account ? getAccountAvatarUrl(account) : '',
      host: v._serverHost,
      isOrigin: v._isOrigin,
      isPrimary: v === props.group.primary,
      contentHidden: v.contentHidden,
      reacted,
    }
  }),
)

const MARGIN = 8

function open(anchor: MouseEvent | HTMLElement) {
  const el =
    anchor instanceof HTMLElement
      ? anchor
      : (anchor.currentTarget as HTMLElement)
  triggerRef.value = el
  const column = el.closest(COLUMN_SELECTOR) as HTMLElement | null
  if (column) theme.value = extractThemeVars(column)
  const rect = el.getBoundingClientRect()
  const bounds = column?.getBoundingClientRect() ?? null
  // 狭いカラム (最小 180px) でも横にはみ出さないよう、幅の上限をカラム幅に合わせる
  maxWidth.value = Math.min(360, (bounds?.width ?? Infinity) - MARGIN * 2)
  // 仮置き。popover は showPopover() されるまで寸法が取れないので、
  // 表示後の次フレーム (描画前) に測って位置を確定する (PopupMenu と同じ)
  pos.value = {
    x: rect.right - Math.min(240, maxWidth.value),
    y: rect.bottom + 4,
  }
  show.value = !show.value
  if (!show.value) return
  nextTick(() => requestAnimationFrame(() => place(rect, bounds)))
}

/**
 * バッジはヘッダー右端にあるので、ポップの右端をバッジの右端に揃えて左へ開く。
 * 置き場はカラムの内側 (カラム外なら画面の内側)。下に入らなければ上に出す
 */
function place(anchor: DOMRect, bounds: DOMRect | null) {
  const el = rootRef.value
  if (!el) return
  // 入場アニメの scale を含めないよう offset 寸法で測る
  const width = el.offsetWidth
  const height = el.offsetHeight
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const minX = Math.max(MARGIN, (bounds?.left ?? 0) + MARGIN)
  const maxX = Math.min(vw, bounds?.right ?? vw) - MARGIN
  let x = anchor.right - width
  if (x + width > maxX) x = maxX - width
  if (x < minX) x = minX
  let y = anchor.bottom + 4
  if (y + height > vh - MARGIN) y = anchor.top - height - 4
  pos.value = { x, y: Math.max(MARGIN, y) }
}

function close() {
  show.value = false
}

defineExpose({ open, close })
</script>

<template>
  <div
    v-if="visible"
    ref="rootRef"
    popover="manual"
    class="_popup"
    :class="[$style.root, leaving ? $style.leave : $style.enter]"
    :style="{ ...theme, left: `${pos.x}px`, top: `${pos.y}px`, minWidth: `${Math.min(240, maxWidth)}px`, maxWidth: `${maxWidth}px` }"
    role="dialog"
    :aria-label="i18n.ts._noteVariantsPopup.ariaLabel"
  >
    <div :class="$style.title">{{ i18n.ts._noteVariantsPopup.title }}</div>
    <ul :class="$style.list">
      <li v-for="row in rows" :key="row.key" :class="$style.row">
        <AccountAvatar
          :src="proxyThumbUrl(row.avatarUrl, 40) ?? ''"
          :host="row.host"
          :size="24"
          :show-server="false"
        />
        <span :class="$style.label">{{ row.label }}</span>
        <span :class="$style.host">{{ row.host }}</span>
        <span :class="$style.marks">
          <span v-if="row.isPrimary" :class="$style.mark" :title="i18n.ts._noteVariantsPopup.primaryTitle">{{ i18n.ts._noteVariantsPopup.primary }}</span>
          <span v-if="row.isOrigin" :class="$style.mark" :title="i18n.ts._noteVariantsPopup.originTitle">origin</span>
          <span v-if="row.contentHidden" :class="[$style.mark, $style.muted]" :title="i18n.ts._noteVariantsPopup.contentHiddenTitle">{{ i18n.ts._common.private }}</span>
          <i v-if="row.reacted" class="ti ti-mood-smile" :class="$style.reacted" :title="i18n.ts._noteVariantsPopup.reactedTitle" />
        </span>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" module>
.root {
  position: fixed;
  z-index: calc(var(--nd-z-popup) + 1);
  padding: 8px 0;
  font-size: var(--nd-font-md);
  /* 右端をバッジに揃えて左へ開くので、拡大の起点も右上 */
  transform-origin: top right;
}

.enter { animation: variantsIn var(--nd-duration-medium) var(--nd-ease-menu); }
.leave { animation: variantsOut var(--nd-duration-base) var(--nd-ease-decel) forwards; }
@keyframes variantsIn { from { opacity: 0; transform: scale(0.95); } }
@keyframes variantsOut { to { opacity: 0; transform: scale(0.97); } }

.title {
  padding: 2px 12px 6px;
  font-size: var(--nd-font-sm);
  opacity: 0.7;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  min-width: 0;
}

.label {
  font-weight: var(--nd-weight-bold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.host {
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.marks {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.mark {
  font-size: var(--nd-font-xs);
  padding: 0 6px;
  border-radius: var(--nd-radius-full);
  border: 1px solid var(--nd-divider);
  opacity: 0.85;
}

.muted {
  border-style: dashed;
}

.reacted {
  color: var(--nd-accentText);
}
</style>
