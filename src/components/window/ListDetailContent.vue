<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { JsonValue, UserList } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkUserListItem from '@/components/common/MkUserListItem.vue'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { webUiUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  listId: string
  /**
   * リスト所有者の userId。呼び出し元（プロフィールタブ等）が分かっていれば
   * 渡す。他ユーザーのリストの場合 users/lists/show に forPublic: true を付
   * ける判定に使う。省略時は自分のリスト扱いで fetch する（失敗したら
   * NO_SUCH_LIST で listError になる）。
   */
  ownerUserId?: string
}>()

const accountsStore = useAccountsStore()
const settingsStore = useSettingsStore()
const toast = useToast()

const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)

interface UserSummary {
  id: string
  username: string
  host: string | null
  name: string | null
  avatarUrl: string | null
  isCat?: boolean
  emojis?: Record<string, string>
}

const list = ref<UserList | null>(null)
const listError = ref<string | null>(null)
const listLoading = ref(true)

const members = shallowRef<UserSummary[]>([])
const membersLoading = ref(false)
const membersError = ref<string | null>(null)

const isOwnList = computed(
  () => !!list.value && list.value.userId === account.value?.userId,
)

const listWebUrl = computed(() => {
  if (!list.value || !account.value?.host) return undefined
  return webUiUrl(account.value.host, `/my/lists/${list.value.id}`)
})

useWindowExternalLink(() =>
  listWebUrl.value ? { url: listWebUrl.value } : null,
)

async function loadList() {
  listLoading.value = true
  listError.value = null
  try {
    // 他ユーザーの公開リストを取るには forPublic: true が必須
    // (Misskey 本家 users/lists/show 実装)。自分のリストの場合は逆に
    // 省略する必要がある (省略時は userId=me.id で filter される)。
    const isOtherUsersList =
      !!props.ownerUserId && props.ownerUserId !== account.value?.userId
    const params: Record<string, JsonValue> = { listId: props.listId }
    if (isOtherUsersList) params.forPublic = true
    const fetched = unwrap(await commands.apiGetList(props.accountId, params))
    list.value = fetched
    if (fetched.userIds && fetched.userIds.length > 0) {
      await loadMembers(fetched.userIds)
    }
  } catch (e) {
    listError.value = AppError.from(e).message
  } finally {
    listLoading.value = false
  }
}

async function loadMembers(userIds: string[]) {
  membersLoading.value = true
  membersError.value = null
  try {
    const raw = unwrap(
      await commands.apiGetUserRaw(props.accountId, { userIds }),
    ) as unknown
    if (Array.isArray(raw)) {
      members.value = raw as UserSummary[]
    }
  } catch (e) {
    membersError.value = AppError.from(e).message
  } finally {
    membersLoading.value = false
  }
}

/**
 * Picker 向けに「自分がお気に入りしたリスト ID」を settings.json にキャッシュ。
 * Misskey 本家に一覧取得 API が無いためクライアント側で管理する。他クライア
 * ント（Misskey Web 等）でトグルした分はここに反映されない既知の制限あり。
 */
function syncFavoriteCache(accountId: string, listId: string, fav: boolean) {
  const key = 'lists.favoritedIdsByAccount' as const
  const current = settingsStore.get(key) ?? {}
  const existing = current[accountId] ?? []
  const next = fav
    ? existing.includes(listId)
      ? existing
      : [...existing, listId]
    : existing.filter((id) => id !== listId)
  if (next === existing) return
  settingsStore.set(key, { ...current, [accountId]: next })
}

const togglingFavorite = ref(false)
async function toggleFavorite() {
  if (!list.value || isOwnList.value || togglingFavorite.value) return
  togglingFavorite.value = true
  const wasFav = list.value.isLiked === true
  try {
    const params = { listId: list.value.id }
    unwrap(
      wasFav
        ? await commands.apiUnfavoriteList(props.accountId, params)
        : await commands.apiFavoriteList(props.accountId, params),
    )
    list.value.isLiked = !wasFav
    if (typeof list.value.likedCount === 'number') {
      list.value.likedCount += wasFav ? -1 : 1
    }
    syncFavoriteCache(props.accountId, list.value.id, !wasFav)
  } catch (e) {
    toast.show(
      `お気に入り操作に失敗しました（${AppError.from(e).displayCode}）`,
      'error',
    )
  } finally {
    togglingFavorite.value = false
  }
}

onMounted(loadList)
</script>

<template>
  <div :class="$style.root">
    <div v-if="listLoading" :class="$style.loading"><LoadingSpinner /></div>
    <ColumnEmptyState v-else-if="listError" :message="listError" is-error />
    <template v-else-if="list">
      <div :class="$style.header">
        <div :class="$style.titleRow">
          <i
            v-if="!list.isPublic"
            class="ti ti-lock"
            :class="$style.privateIcon"
            title="非公開"
          />
          <div :class="$style.title">{{ list.name }}</div>
        </div>
        <div :class="$style.meta">
          <span>
            <i class="ti ti-users" />
            {{ list.userIds?.length ?? 0 }} メンバー
          </span>
          <button
            v-if="!isOwnList"
            class="_button"
            :class="[$style.favBtn, { [$style.favActive]: list.isLiked }]"
            :disabled="togglingFavorite"
            @click="toggleFavorite"
          >
            <i :class="list.isLiked ? 'ti ti-star-filled' : 'ti ti-star'" />
            <span v-if="typeof list.likedCount === 'number'">{{ list.likedCount }}</span>
          </button>
          <span
            v-else-if="typeof list.likedCount === 'number'"
            :class="$style.favCount"
          >
            <i class="ti ti-star" />
            {{ list.likedCount }}
          </span>
        </div>
      </div>

      <div :class="$style.members">
        <div v-if="membersLoading" :class="$style.loading">
          <LoadingSpinner />
        </div>
        <ColumnEmptyState
          v-else-if="membersError"
          :message="membersError"
          is-error
        />
        <ColumnEmptyState
          v-else-if="members.length === 0"
          message="メンバーがいません"
        />
        <template v-else>
          <MkUserListItem
            v-for="user in members"
            :key="user.id"
            :user="user"
            :account-id="accountId"
            :avatar-size="40"
            :server-host="account?.host"
          />
        </template>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}

.loading {
  padding: 24px;
  text-align: center;
  opacity: 0.7;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 16px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.privateIcon {
  font-size: 0.95em;
  opacity: 0.7;
}

.title {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
}

.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8em;
  opacity: 0.7;
}

.favBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.95em;
  transition: background var(--nd-duration-base);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.favActive {
  color: var(--nd-warn, #f0a020);
}

.favCount {
  display: flex;
  align-items: center;
  gap: 4px;
}

.members {
  display: flex;
  flex-direction: column;
}

</style>
