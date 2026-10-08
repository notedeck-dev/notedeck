<script setup lang="ts">
import { computed } from 'vue'
import MkFollowButton from '@/components/common/MkFollowButton.vue'
import MkUserListItem from '@/components/common/MkUserListItem.vue'
import { i18n } from '@/i18n'
import type { FollowApi, FollowState } from '@/services/followTransition'
import type { UserLookupHit, UserLookupMiss } from '@/services/userLookupResult'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'

/**
 * 全アカウントのユーザー照会の結果 (#1185): 解決できたアカウントごとに 1 行。
 * 行はそのアカウントの文脈 (クリック / ホバー / フォロー) で、アバターの右上に
 * 取得元アカウントのサーバーアイコンを出して「どのアカウント経由か」を示す
 * (全アカウント面の右上バッジはサーバーのアイコンだけ)。
 */

const props = defineProps<{
  hits: UserLookupHit[]
  misses: UserLookupMiss[]
  /** 行のフォローボタンに渡す、その行のアカウントの API */
  followApiFor: (accountId: string) => FollowApi | null
}>()

const accountsStore = useAccountsStore()

function accountLabel(accountId: string, fallback: string): string {
  const a = accountsStore.accountMap.get(accountId)
  return a ? getAccountLabel(a) : fallback
}

/** 全アカウント面ではローカルユーザーの acct にも取得元のサーバーを補う (#1059) */
function userFor(hit: UserLookupHit) {
  return hit.user.host ? hit.user : { ...hit.user, host: hit.accountHost }
}

function isSelf(hit: UserLookupHit): boolean {
  return accountsStore.accountMap.get(hit.accountId)?.userId === hit.user.id
}

/** 押したらその行の関係を即反映して二度押しを塞ぐ */
function applyFollowState(hit: UserLookupHit, state: FollowState) {
  hit.relation = {
    ...(hit.relation ?? {
      id: hit.user.id,
      isFollowed: false,
      isBlocking: false,
      isBlocked: false,
      isMuted: false,
      isRenoteMuted: false,
      isFollowing: false,
    }),
    isFollowing: state.isFollowing,
    hasPendingFollowRequestFromYou: state.hasPendingFollowRequestFromYou,
  }
}

const notFoundCount = computed(
  () => props.misses.filter((m) => m.kind === 'notFound').length,
)
const listedMisses = computed(() =>
  props.misses.filter((m) => m.kind !== 'notFound'),
)
</script>

<template>
  <div>
    <MkUserListItem
      v-for="hit in hits"
      :key="hit.accountId"
      :user="userFor(hit)"
      :account-id="hit.accountId"
      :server-host="hit.accountHost"
      :server-badge-host="hit.accountHost"
      :server-badge-title="accountLabel(hit.accountId, hit.accountHost)"
      :relation="hit.relation"
    >
      <template #actions>
        <MkFollowButton
          v-if="!isSelf(hit) && hit.relation"
          data-mk-uli-action
          :user-id="hit.user.id"
          :username="hit.user.username"
          :is-following="hit.relation.isFollowing"
          :has-pending-request="hit.relation.hasPendingFollowRequestFromYou ?? false"
          :is-followed="hit.relation.isFollowed"
          :api="followApiFor(hit.accountId)"
          @update="applyFollowState(hit, $event)"
        />
      </template>
    </MkUserListItem>

    <div v-if="notFoundCount > 0 || listedMisses.length > 0" :class="$style.misses">
      <div v-if="notFoundCount > 0">
        {{ i18n.tsx._deckLookupColumn.userNotFoundCount_plural({ count: notFoundCount }) }}
      </div>
      <div v-for="m in listedMisses" :key="m.accountId">
        {{ m.kind === 'unresolved'
          ? i18n.tsx._deckLookupColumn.userUnresolved({ account: accountLabel(m.accountId, m.accountHost) })
          : i18n.tsx._deckLookupColumn.userFailed({ account: accountLabel(m.accountId, m.accountHost) }) }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.misses {
  padding: 6px 12px;
  font-size: 0.75em;
  opacity: 0.6;
}
</style>
