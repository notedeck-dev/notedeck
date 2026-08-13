<script setup lang="ts">
import { computed } from 'vue'
import AccountAvatar from '@/components/common/AccountAvatar.vue'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'

const props = withDefaults(
  defineProps<{
    /**
     * 表示する最大数。既定は無制限 — 「全アカウント」を示す面では、一部しか
     * 出さないと残りが含まれていないように見えるため。溢れは maxWidth 側で
     * 重なりを詰めて吸収する。
     */
    max?: number
    /** Avatar size in px */
    size?: number
    /** Custom users to display (overrides accounts) */
    users?: Array<{ avatarUrl: string | null; username: string; host?: string }>
    /**
     * 収める幅の上限 (px)。全員を出すと溢れる場合、この幅に収まるところまで
     * 重なりを深くする。未指定なら重なりは既定値のまま。
     */
    maxWidth?: number
    /** バッジの縁取り色 = これが置かれる面の背景 */
    badgeBackground?: string
  }>(),
  {
    max: undefined,
    size: 20,
    users: undefined,
    maxWidth: undefined,
    badgeBackground: 'var(--nd-panel)',
  },
)

const accountsStore = useAccountsStore()

interface DisplayItem {
  key: string
  src: string
  host: string | null
}

const displayItems = computed<DisplayItem[]>(() => {
  const limit = props.max ?? Number.POSITIVE_INFINITY
  if (props.users) {
    return props.users.slice(0, limit).map((u, i) => ({
      key: `${u.username}-${i}`,
      src: u.avatarUrl ?? '',
      host: u.host ?? null,
    }))
  }
  return accountsStore.accounts.slice(0, limit).map((a) => ({
    key: a.id,
    src: getAccountAvatarUrl(a),
    host: a.host,
  }))
})

/**
 * 隣のアバターに重ねる量。既定は size の 3 割で、maxWidth を与えられていて
 * それでも溢れる場合だけ深くする。重ねすぎて何枚あるか分からなくならないよう、
 * 1 枚あたり最低限の見え幅は残す。
 */
const overlapPx = computed(() => {
  // 重なりは「連なり」が分かる程度に留める。詰めるのは幅に収まらないときだけ
  const base = Math.round(props.size * 0.15)
  const count = displayItems.value.length
  if (!props.maxWidth || count <= 1) return base
  const needed = (props.size * count - props.maxWidth) / (count - 1)
  const minVisible = Math.max(4, Math.round(props.size * 0.25))
  return Math.min(Math.max(base, Math.ceil(needed)), props.size - minVisible)
})

const stackWidth = computed(() => {
  const count = displayItems.value.length
  if (count === 0) return 0
  return props.size + (count - 1) * (props.size - overlapPx.value)
})
</script>

<template>
  <div
    :class="$style.stack"
    :style="{ width: `${stackWidth}px`, height: `${size}px` }"
  >
    <!-- 位置指定はラッパー側に持たせる。AccountAvatar のルートはバッジの
         基準として position: relative を持つので、同じ要素に absolute を
         重ねると CSS Modules の適用順で勝敗が変わり、並びが崩れる -->
    <span
      v-for="(item, i) in displayItems"
      :key="item.key"
      :class="$style.avatarSlot"
      :style="{
        left: `${i * (size - overlapPx)}px`,
        zIndex: displayItems.length - i,
      }"
    >
      <AccountAvatar
        :src="item.src"
        :host="item.host"
        :size="size"
        :badge-background="badgeBackground"
        :ring="badgeBackground"
      />
    </span>
  </div>
</template>

<style lang="scss" module>
.stack {
  position: relative;
  display: inline-flex;
  /* 子はすべて absolute。幅は stackWidth が決めるので、ここが縮んだり
     伸びたりして隣のボタンを押し出さないようにする */
  flex: 0 0 auto;
}

.avatarSlot {
  position: absolute;
  top: 0;
  display: inline-flex;
}
</style>
