<script setup lang="ts">
/**
 * アカウントアバター + 右上のサーバーバッジ。
 *
 * アカウントのアイコンを出す面はすべてこれを通す。どのサーバーのアカウントかは
 * アバターだけでは分からず、アバターとサーバーアイコンを横に並べると狭い面
 * (カラムヘッダー・コマンドパレット) で場所を取るため、投稿フォームのアカウント
 * 選択と同じ「右上にサーバーバッジ」に揃える。
 *
 * バッジは中身の情報量が増える場合だけ出す — 単一サーバーしか使っていない
 * ユーザーには意味がないので、既定では 2 アカウント以上ログイン中のときだけ。
 */
import { computed } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import { proxyThumbUrl } from '@/utils/mediaProxy'

const props = withDefaults(
  defineProps<{
    /** アバター画像 URL (未解決なら空文字) */
    src: string
    /** バッジに使うサーバーのホスト。無ければバッジは出ない */
    host?: string | null
    size?: number
    /**
     * バッジを出すか。既定 (未指定) は「2 アカウント以上ログイン中なら出す」。
     * アカウント選択のように常に出したい面では true を明示する。
     */
    showServer?: boolean
    /** バッジの縁取り色 = これが置かれる面の背景 */
    badgeBackground?: string
    /**
     * アバター自体の縁取り色。重ねて並べる (AvatarStack) ときに境界を出すため
     * のもので、単体表示では不要。
     */
    ring?: string
    title?: string
  }>(),
  {
    host: null,
    size: 28,
    showServer: undefined,
    badgeBackground: 'var(--nd-panel)',
    ring: undefined,
    title: undefined,
  },
)

const accountsStore = useAccountsStore()
const serversStore = useServersStore()

const showBadge = computed(() => {
  if (!props.host) return false
  return props.showServer ?? accountsStore.accounts.length >= 2
})

const badgeSize = computed(() => Math.max(8, Math.round(props.size * 0.5)))

/** サーバー登録済みならそのアイコン、無ければ favicon にフォールバック */
const serverIconUrl = computed(() => {
  const host = props.host
  if (!host) return ''
  const iconUrl = serversStore.servers.get(host)?.iconUrl
  // プロキシ経由にしてディスクキャッシュとサーキットブレーカーに載せる
  return proxyThumbUrl(
    iconUrl || `https://${host}/favicon.ico`,
    badgeSize.value * 2,
  )
})
/** バッジがアバターの角に半分掛かる位置 */
const badgeOffset = computed(() => -Math.round(badgeSize.value * 0.25))
/** 小さいアバターで縁取りが太く見えないように寸法へ追随させる */
const badgeRing = computed(() => (props.size >= 24 ? 2 : 1.5))
</script>

<template>
  <span :class="$style.wrap" :style="{ width: `${size}px`, height: `${size}px` }" :title="title">
    <img
      :src="proxyThumbUrl(src, size * 2)"
      :class="$style.avatar"
      :style="{
        width: `${size}px`,
        height: `${size}px`,
        boxShadow: ring ? `0 0 0 1.5px ${ring}` : undefined,
      }"
    />
    <img
      v-if="showBadge"
      :src="serverIconUrl"
      :class="$style.serverBadge"
      :style="{
        width: `${badgeSize}px`,
        height: `${badgeSize}px`,
        top: `${badgeOffset}px`,
        right: `${badgeOffset}px`,
        background: badgeBackground,
        boxShadow: `0 0 0 ${badgeRing}px ${badgeBackground}`,
      }"
      @error="($event.target as HTMLImageElement).src = '/server-icon-error.svg'"
    />
  </span>
</template>

<style lang="scss" module>
.wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.avatar {
  border-radius: 50%;
  object-fit: cover;
}

.serverBadge {
  position: absolute;
  border-radius: 50%;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
}
</style>
