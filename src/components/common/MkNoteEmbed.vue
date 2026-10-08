<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { createMisskeyApi } from '@/adapters/misskey/api'
import type { NormalizedNote } from '@/adapters/types'
import { useNoteAccountId } from '@/composables/useNoteContext'
import { parseNoteUrl } from '@/services/noteUrl'
import { useAccountsStore } from '@/stores/accounts'
import { usePerformanceStore } from '@/stores/performance'
import { commands, unwrap } from '@/utils/tauriInvoke'

const perfStore = usePerformanceStore()

const props = defineProps<{
  url: string
}>()

const accountId = useNoteAccountId()

// 取得済みならここで同期的に描く (作り直すたびに空 → スケルトン → 本文と
// 伸びない)。未取得で取得できる見込みがあるものは、最初からスケルトンで
// 高さを予約しておく
const parsedUrl = parseNoteUrl(props.url)
const initialKey = accountId ? `${accountId}:${props.url}` : null
const initialCached =
  initialKey && embedCache.has(initialKey)
    ? embedCache.get(initialKey)
    : undefined
const note = ref<NormalizedNote | null>(initialCached ?? null)
const failed = ref(initialCached === null || !parsedUrl || !accountId)
const loading = ref(initialCached === undefined && !failed.value)
const el = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

async function fetchNote() {
  const parsed = parseNoteUrl(props.url)
  if (!parsed || !accountId) {
    failed.value = true
    return
  }

  const cacheKey = `${accountId}:${props.url}`

  if (embedCache.has(cacheKey)) {
    const cached = embedCache.get(cacheKey) ?? null
    if (cached) {
      note.value = cached
    } else {
      failed.value = true
    }
    return
  }

  loading.value = true
  try {
    let promise = pendingEmbeds.get(cacheKey)
    if (!promise) {
      promise = (async () => {
        const accountsStore = useAccountsStore()
        const account = accountsStore.accountMap.get(accountId)
        const api = createMisskeyApi(
          accountId,
          account?.host ?? parsed.host,
          account?.hasToken ?? true,
        )

        if (account && account.host === parsed.host) {
          return await api.getNote(parsed.noteId)
        }
        const result = unwrap(
          await commands.apiApShow(accountId, props.url),
        ) as unknown as { type: string; object?: { id: string } }
        if (result.type === 'Note' && result.object?.id) {
          return await api.getNote(result.object.id)
        }
        return null
      })()
      pendingEmbeds.set(cacheKey, promise)
    }

    const result = await promise
    if (embedCache.size >= perfStore.get('embedCacheMax')) {
      const oldest = embedCache.keys().next().value
      if (oldest !== undefined) embedCache.delete(oldest)
    }
    embedCache.set(cacheKey, result)
    pendingEmbeds.delete(cacheKey)

    if (result) {
      note.value = result
    } else {
      failed.value = true
    }
  } catch {
    pendingEmbeds.delete(cacheKey)
    embedCache.set(cacheKey, null)
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (!el.value || !loading.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        observer?.disconnect()
        observer = null
        fetchNote()
      }
    },
    { rootMargin: `${perfStore.get('lazyLoadMargin')}px` },
  )
  observer.observe(el.value)
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div ref="el" :class="$style.noteEmbed">
    <div v-if="loading" :class="$style.noteEmbedSkeleton">
      <div :class="$style.skeletonLine" style="width: 40%" />
      <div :class="$style.skeletonLine" style="width: 70%" />
    </div>
    <div v-else-if="note" :class="[$style.noteEmbedContent, initialCached === undefined && 'nd-content-appear']">
      <MkNote :note="note" embedded />
    </div>
    <!-- failed: render nothing, let parent fall back to OGP -->
  </div>
</template>

<script lang="ts">
import type { NormalizedNote as EmbedNote } from '@/adapters/types'
import MkNote from './MkNote.vue'

// 全インスタンスで共有する (<script setup> の中に置くとインスタンスごとに
// 作り直され、キャッシュとして働かない)
const embedCache = new Map<string, EmbedNote | null>()
const pendingEmbeds = new Map<string, Promise<EmbedNote | null>>()
</script>

<style lang="scss" module>
.noteEmbed {
  margin-top: 8px;
}

.noteEmbedContent > :global(.note-root) {
  padding: 12px 16px;
  border: dashed 1px var(--nd-renote);
  border-radius: var(--nd-radius-md);
}

.noteEmbedSkeleton {
  padding: 12px 16px;
  border: dashed 1px var(--nd-divider);
  border-radius: var(--nd-radius-md);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skeletonLine {
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--nd-buttonBg) 25%,
    var(--nd-panelHighlight) 50%,
    var(--nd-buttonBg) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
</style>
