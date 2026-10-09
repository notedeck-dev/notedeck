<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { i18n } from '@/i18n'
import { char2twemojiUrl } from '@/services/twemoji'
import { failedTwemojiUrls } from '@/utils/renderedMemo'

const props = defineProps<{ emoji: string; ignoreMuted?: boolean }>()
const { isEmojiMuted } = useEmojiMute()
// ミュート絵文字はプレースホルダー置換 (#612)。ignoreMuted は設定 UI の一覧など
// 実体を見せたい文脈用
const isMuted = computed(() => !props.ignoreMuted && isEmojiMuted(props.emoji))
// 未解決のカスタム絵文字 (":name:" / ":name@host:") を twemoji URL に変換すると
// 存在しない CDN パスへの 404 を量産するため、unknown 表示に落とす (#844)
const isUnresolvedCustom = computed(() => props.emoji.startsWith(':'))
// 同梱アセットのローカルパスなのでプロキシ不要
const url = computed(() =>
  isUnresolvedCustom.value ? undefined : char2twemojiUrl(props.emoji),
)
// 失敗した URL はアプリ全体で覚え、作り直した行で同じ 404 を繰り返さない (#1219)
const failedUrl = ref<string | null>(null)
const failed = computed(
  () =>
    url.value !== undefined &&
    (failedUrl.value === url.value || failedTwemojiUrls.has(url.value)),
)
function onError() {
  if (url.value === undefined) return
  failedTwemojiUrls.add(url.value)
  failedUrl.value = url.value
}
</script>

<template>
  <span v-if="isMuted" class="twemoji _emojiMuted" :class="$style.twemoji" role="img" :aria-label="emoji" :title="i18n.tsx._common.mutedEmoji({ emoji })" />
  <img v-else-if="isUnresolvedCustom" class="twemoji" :class="$style.twemoji" src="/emoji-unknown.svg" :alt="emoji" :title="emoji" width="20" height="20" decoding="async" loading="lazy" />
  <img v-else-if="!failed" class="twemoji" :class="$style.twemoji" :src="url" :alt="emoji" width="20" height="20" decoding="async" loading="lazy" @error="onError" />
  <span v-else :class="$style.nativeEmoji">{{ emoji }}</span>
</template>

<style lang="scss" module>
.twemoji {
  height: 1.25em;
  vertical-align: -0.25em;
  object-fit: contain;
}

.nativeEmoji {
  font-size: 1.25em;
  line-height: 1;
  vertical-align: -0.15em;
}
</style>
