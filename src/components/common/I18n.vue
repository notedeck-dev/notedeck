<script setup lang="ts">
/**
 * 文の途中にリンクやタグを差し込む文言 (#135)。
 *
 *   <I18n :src="i18n.ts._foo.bar">
 *     <template #name><b>{{ user.name }}</b></template>
 *   </I18n>
 *
 * `{name}` の位置に同名の slot を描く。本家の I18n.vue は h() で組むが、
 * Vapor 制約 (h() 禁止) があるので template で書く。文言はテキストとして
 * 描くので HTML として解釈されない。
 */
import { computed } from 'vue'
import type { ParameterizedString } from '@/i18n/types'

const props = defineProps<{
  src: string | ParameterizedString
}>()

type Segment = { text: string } | { slot: string }

const segments = computed<Segment[]>(() => {
  const out: Segment[] = []
  let cursor = 0
  for (const match of props.src.matchAll(/\{(\w+)\}/g)) {
    if (match.index > cursor)
      out.push({ text: props.src.slice(cursor, match.index) })
    out.push({ slot: match[1] ?? '' })
    cursor = match.index + match[0].length
  }
  if (cursor < props.src.length) out.push({ text: props.src.slice(cursor) })
  return out
})
</script>

<template>
  <span>
    <template v-for="(segment, i) in segments" :key="i">
      <template v-if="'text' in segment">{{ segment.text }}</template>
      <slot v-else :name="segment.slot" />
    </template>
  </span>
</template>
