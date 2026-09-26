<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { UserList } from '@/adapters/types'
import type { JsonValue } from '@/bindings'
import { i18n } from '@/i18n'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ProfileItemCards from './ProfileItemCards.vue'

const props = defineProps<{
  accountId: string
  userId: string
  isOwnProfile: boolean
  active: boolean
  infoImageUrl?: string
  errorImageUrl?: string
}>()

const windowsStore = useWindowsStore()

// リストは users/lists/list をページングなしで一括取得。userId 指定時は
// Misskey 側で isPublic=true にフィルタされるため、自プロフィール時のみ
// userId を省略して非公開リストも含めて表示する。
const profileLists = shallowRef<UserList[]>([])
const isLoading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)

async function load() {
  if (loaded.value) return
  loaded.value = true
  isLoading.value = true
  error.value = null
  try {
    const params: Record<string, JsonValue> = {}
    if (!props.isOwnProfile) {
      params.userId = props.userId
    }
    profileLists.value = unwrap(
      await commands.apiGetUserListsBy(props.accountId, params),
    )
  } catch (e) {
    error.value = AppError.from(e).message
    loaded.value = false
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)

const cards = computed(() =>
  profileLists.value.map((l) => ({ id: l.id, title: l.name })),
)

function openList(listId: string) {
  windowsStore.open('list-detail', {
    accountId: props.accountId,
    listId,
    ownerUserId: props.userId,
  })
}
</script>

<template>
  <div v-show="active" :class="$style.pane">
    <ProfileItemCards
      :cards="cards"
      :is-loading="isLoading"
      :error="error"
      :empty-message="i18n.ts._userProfileListsPane.empty"
      :info-image-url="infoImageUrl"
      :error-image-url="errorImageUrl"
      @select="openList"
    />
  </div>
</template>

<style lang="scss" module>
.pane {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
</style>
