<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import type { NormalizedNotification } from '@/adapters/types'
import EditorTabs from '@/components/common/EditorTabs.vue'
import I18n from '@/components/common/I18n.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useSensitiveMask } from '@/composables/useSensitiveMask'
import { i18n } from '@/i18n'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

const props = defineProps<{
  accountId: string
  notification: NormalizedNotification
}>()

// Notifications may contain `token` in web-push payloads
const SENSITIVE_RAW_KEYS = new Set<string>(['token'])
const { showSensitive, formatJson } = useSensitiveMask(SENSITIVE_RAW_KEYS)

type InspectorTab = 'misskey' | 'activitypub'
const TAB_DEFS: { value: InspectorTab; icon: string; label: string }[] = [
  { value: 'misskey', icon: 'code', label: 'Misskey' },
  { value: 'activitypub', icon: 'world-www', label: 'ActivityPub' },
]
const TAB_VALUES: readonly InspectorTab[] = TAB_DEFS.map((t) => t.value)
const { tab, containerRef } = useEditorTabs<InspectorTab>(TAB_VALUES, 'misskey')

// Misskey tab: the notification object is already in memory
const misskeyJson = computed(() => formatJson(props.notification))

// ActivityPub tab: resolve the note's URI via ap/show (if available)
const noteUri = computed(() => {
  const note = props.notification.note
  if (!note) return null
  return note.uri ?? note.url ?? null
})

const apRaw = shallowRef<unknown>(null)
const isLoadingAp = ref(false)
const apError = ref<string | null>(null)

const apJson = computed(() => formatJson(apRaw.value))

const hasApTab = computed(() => noteUri.value != null)

async function loadActivityPub() {
  if (apRaw.value != null || isLoadingAp.value) return
  const uri = noteUri.value
  if (!uri) {
    apError.value = i18n.ts._notificationInspectorContent.noApUri
    return
  }
  isLoadingAp.value = true
  apError.value = null
  try {
    apRaw.value = unwrap(await commands.apiApShow(props.accountId, uri))
  } catch (e) {
    apError.value = AppError.from(e).message
  } finally {
    isLoadingAp.value = false
  }
}

// AP tab is lazy-loaded on first activation
watch(tab, (t) => {
  if (t === 'activitypub') loadActivityPub()
})

const currentJson = computed(() =>
  tab.value === 'misskey' ? misskeyJson.value : apJson.value,
)
const currentLoading = computed(() =>
  tab.value === 'misskey' ? false : isLoadingAp.value,
)
const currentError = computed(() => {
  if (tab.value === 'misskey') return null
  if (!hasApTab.value) return i18n.ts._notificationInspectorContent.noNote
  return apError.value
})
</script>

<template>
  <div :class="$style.wrapper">
    <EditorTabs
      :tabs="TAB_DEFS"
      :model-value="tab"
      @update:model-value="(v) => (tab = v as InspectorTab)"
    />

    <RawJsonView
      ref="containerRef"
      v-model:show-sensitive="showSensitive"
      :json="currentJson"
      :loading="currentLoading"
      :error="currentError"
      :can-reveal="true"
    >
      <template #hint>
        <i class="ti ti-info-circle" />
        <template v-if="tab === 'misskey'">
          {{ i18n.ts._notificationInspectorContent.inMemoryObject }}
        </template>
        <template v-else>
          <I18n :src="i18n.ts._notificationInspectorContent.activityPubObject"><template #endpoint><code>/api/ap/show</code></template></I18n>
        </template>
      </template>
    </RawJsonView>
  </div>
</template>

<style module lang="scss">
.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
