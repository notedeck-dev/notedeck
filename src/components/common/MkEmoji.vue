<script setup lang="ts">
import { computed, ref } from 'vue'
import { proxyUrl } from '@/utils/imageProxy'
import { char2twemojiUrl } from '@/utils/twemoji'

const props = defineProps<{ emoji: string }>()
// 未解決のカスタム絵文字 (":name:" / ":name@host:") を twemoji URL に変換すると
// 存在しない CDN パスへの 404 を量産するため、unknown 表示に落とす (#844)
const isUnresolvedCustom = computed(() => props.emoji.startsWith(':'))
const url = computed(() =>
  isUnresolvedCustom.value ? undefined : proxyUrl(char2twemojiUrl(props.emoji)),
)
const failed = ref(false)
</script>

<template>
  <img v-if="isUnresolvedCustom" class="twemoji" :class="$style.twemoji" src="/emoji-unknown.svg" :alt="emoji" :title="emoji" width="20" height="20" decoding="async" loading="lazy" />
  <img v-else-if="!failed" class="twemoji" :class="$style.twemoji" :src="url" :alt="emoji" width="20" height="20" decoding="async" loading="lazy" @error="failed = true" />
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
