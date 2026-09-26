<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import type { JsonValue } from '@/bindings'
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
  noteId: string
  /** Known note URI (federated note `uri`, or local `url`). Optional. */
  noteUri?: string
  /** Server host — used to derive a URI when noteUri is absent. */
  serverHost?: string
  /**
   * 束ねたノートの各ビュー (#1058 §7 開発者モード)。サーバーごとの生データの
   * 差分を見る唯一の面。identity は束ねのキーで、逆プロキシ構成の自己診断にも使う
   */
  variants?: {
    accountId: string
    noteId: string
    serverHost: string
    identity: string
  }[]
}>()

const activeVariant = ref(0)
const variantList = computed(() =>
  props.variants && props.variants.length > 1 ? props.variants : null,
)
const active = computed(() => {
  const v = variantList.value?.[activeVariant.value]
  return v
    ? { accountId: v.accountId, noteId: v.noteId, serverHost: v.serverHost }
    : {
        accountId: props.accountId,
        noteId: props.noteId,
        serverHost: props.serverHost,
      }
})
const identity = computed(
  () => variantList.value?.[activeVariant.value]?.identity ?? null,
)

// Notes themselves are mostly public, but DMs carry `visibleUserIds` and
// `myReaction` leaks the viewer's interaction state. Mask by default.
const SENSITIVE_RAW_KEYS = new Set<string>(['visibleUserIds', 'myReaction'])
const { showSensitive, formatJson } = useSensitiveMask(SENSITIVE_RAW_KEYS)

type InspectorTab = 'misskey' | 'activitypub'
const TAB_DEFS: { value: InspectorTab; icon: string; label: string }[] = [
  { value: 'misskey', icon: 'code', label: 'Misskey API' },
  { value: 'activitypub', icon: 'world-www', label: 'ActivityPub' },
]
const TAB_VALUES: readonly InspectorTab[] = TAB_DEFS.map((t) => t.value)
const { tab, containerRef } = useEditorTabs<InspectorTab>(TAB_VALUES, 'misskey')

const misskeyRaw = shallowRef<unknown>(null)
const isLoadingMisskey = ref(false)
const misskeyError = ref<string | null>(null)

const apRaw = shallowRef<unknown>(null)
const isLoadingAp = ref(false)
const apError = ref<string | null>(null)

const derivedUri = computed(() => {
  if (identity.value) return identity.value
  if (props.noteUri) return props.noteUri
  if (active.value.serverHost)
    return `https://${active.value.serverHost}/notes/${active.value.noteId}`
  return null
})

const misskeyJson = computed(() => formatJson(misskeyRaw.value))
const apJson = computed(() => formatJson(apRaw.value))

const currentJson = computed(() =>
  tab.value === 'misskey' ? misskeyJson.value : apJson.value,
)
const currentLoading = computed(() =>
  tab.value === 'misskey' ? isLoadingMisskey.value : isLoadingAp.value,
)
const currentError = computed(() =>
  tab.value === 'misskey' ? misskeyError.value : apError.value,
)

/** ビュー切替のたびに進める。切替前に投げた取得の結果は捨てる */
let viewGeneration = 0

async function loadMisskey() {
  if (misskeyRaw.value != null || isLoadingMisskey.value) return
  const gen = viewGeneration
  isLoadingMisskey.value = true
  misskeyError.value = null
  try {
    const raw = unwrap(
      await commands.apiGetNoteRaw(active.value.accountId, {
        noteId: active.value.noteId,
      } as never),
    )
    if (gen === viewGeneration) misskeyRaw.value = raw
  } catch (e) {
    if (gen === viewGeneration) misskeyError.value = AppError.from(e).message
  } finally {
    if (gen === viewGeneration) isLoadingMisskey.value = false
  }
}

async function loadActivityPub() {
  if (apRaw.value != null || isLoadingAp.value) return
  const uri = derivedUri.value
  if (!uri) {
    apError.value = 'URI を特定できませんでした'
    return
  }
  const gen = viewGeneration
  isLoadingAp.value = true
  apError.value = null
  try {
    const raw = unwrap(await commands.apiApShow(active.value.accountId, uri))
    if (gen === viewGeneration) apRaw.value = raw
  } catch (e) {
    if (gen === viewGeneration) apError.value = AppError.from(e).message
  } finally {
    if (gen === viewGeneration) isLoadingAp.value = false
  }
}

onMounted(() => {
  loadMisskey()
})

// ビューを切り替えたら両タブとも取り直す
watch(activeVariant, () => {
  viewGeneration++
  misskeyRaw.value = null
  apRaw.value = null
  // 進行中の取得は結果を捨てるので、ここで新しい取得を始められる
  isLoadingMisskey.value = false
  isLoadingAp.value = false
  loadMisskey()
  if (tab.value === 'activitypub') loadActivityPub()
})

// AP tab is lazy-loaded on first activation so opening the inspector doesn't
// trigger an extra round-trip the user may not need.
watch(tab, (t) => {
  if (t === 'activitypub') loadActivityPub()
})
</script>

<template>
  <div :class="$style.wrapper">
    <EditorTabs
      :tabs="TAB_DEFS"
      :model-value="tab"
      @update:model-value="(v) => (tab = v as InspectorTab)"
    />

    <div v-if="variantList" :class="$style.variantBar">
      <label :class="$style.variantLabel">
        {{ i18n.ts._noteInspectorContent.view }}
        <select v-model="activeVariant" :class="$style.variantSelect">
          <option v-for="(v, i) in variantList" :key="`${v.accountId}:${v.noteId}`" :value="i">
            {{ v.serverHost }} / {{ v.noteId }}
          </option>
        </select>
      </label>
      <code v-if="identity" :class="$style.identity" :title="identity">{{ identity }}</code>
    </div>

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
          <I18n :src="i18n.ts._noteInspectorContent.rawResponse"><template #endpoint><code>/api/notes/show</code></template></I18n>
        </template>
        <template v-else>
          <I18n :src="i18n.ts._noteInspectorContent.activityPubObject"><template #endpoint><code>/api/ap/show</code></template></I18n>
        </template>
      </template>
    </RawJsonView>
  </div>
</template>

<style module lang="scss">
.variantBar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  font-size: 0.85em;
  border-bottom: 1px solid var(--nd-divider);
  min-width: 0;
}

.variantLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.variantSelect {
  font: inherit;
}

.identity {
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
</style>
