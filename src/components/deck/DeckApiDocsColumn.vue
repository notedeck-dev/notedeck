<script setup lang="ts">
import { ApiReference } from '@scalar/api-reference'
import '@scalar/api-reference/style.css'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useThemeStore } from '@/stores/theme'
import { commands } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { columnThemeVars } = useColumnTheme(() => props.column)
const themeStore = useThemeStore()

const spec = ref<string | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const data = await commands.getOpenapiSpec()
    spec.value = JSON.stringify(data)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

const docsContainerRef = useTemplateRef<HTMLElement>('docsContainerRef')

function scrollToTop() {
  docsContainerRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

const isDark = computed(() => !themeStore.currentSource?.kind.includes('light'))

const config = computed(() => ({
  content: spec.value,
  forceDarkModeState: (isDark.value ? 'dark' : 'light') as 'dark' | 'light',
  hideDarkModeToggle: true,
  documentDownloadType: 'none' as const,
}))
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'APIドキュメント'"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i class="ti ti-book tl-header-icon" />
    </template>

    <div ref="docsContainerRef" :class="$style.docsContainer">
      <div v-if="error" :class="$style.docsError">{{ error }}</div>
      <div v-else-if="!spec" :class="$style.docsLoading"><LoadingSpinner /></div>
      <ApiReference v-else :key="isDark ? 'dark' : 'light'" :configuration="config" />
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
.docsContainer {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/*
 * Scalar はビューポート幅 (1000px) でしかナビサイドバーを畳まないため、
 * 狭いカラムでも 288px 固定のサイドバーが居座り本文が窮屈になる (#708)。
 * カラム幅 (DeckColumn の container) 基準で畳んで本文に全幅を渡す。
 * !important は Scalar 側の `lg:flex` (media query + .scalar-app スコープ) に勝つため。
 */
@container (max-width: 768px) {
  .docsContainer :global(.t-doc__sidebar) {
    display: none !important;
  }
}

.docsError {
  padding: 16px;
  color: var(--nd-love);
  font-size: 0.85em;
}

.docsLoading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
