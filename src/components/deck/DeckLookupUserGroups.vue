<script setup lang="ts">
import { computed } from 'vue'
import AccountAvatar from '@/components/common/AccountAvatar.vue'
import AccountPickerSheet from '@/components/common/AccountPickerSheet.vue'
import MkFollowButton from '@/components/common/MkFollowButton.vue'
import MkUserListItem from '@/components/common/MkUserListItem.vue'
import { useAccountPicker } from '@/composables/useAccountPicker'
import { useNavigation } from '@/composables/useNavigation'
import { i18n } from '@/i18n'
import type {
  UserLookupGroup,
  UserLookupHit,
  UserLookupMiss,
} from '@/services/userLookupResult'
import {
  type Account,
  getAccountAvatarUrl,
  getAccountLabel,
  useAccountsStore,
} from '@/stores/accounts'
import type { FollowApi, FollowState } from '@/utils/followAction'

/**
 * 全アカウントのユーザー照会の結果 (#1185): acct ごとにカード 1 枚、その下に
 * アカウントごとの行 (そのアカウントから見た関係 + フォローボタン)。関係は
 * アカウント固有なのでカードには集約しない。カードのクリックは解決できた
 * アカウントから選ばせる (暗黙の代表アカウントを作らない)。
 */

const props = defineProps<{
  groups: UserLookupGroup[]
  misses: UserLookupMiss[]
  /** 行のフォローボタンに渡す、その行のアカウントの API */
  followApiFor: (accountId: string) => FollowApi | null
}>()

const accountsStore = useAccountsStore()
const { navigateToUser } = useNavigation()
const { pickAccount, sheetPurpose, sheetAccounts, resolveSheet } =
  useAccountPicker()

function accountOf(accountId: string): Account | undefined {
  return accountsStore.accountMap.get(accountId)
}

const notFoundCount = computed(
  () => props.misses.filter((m) => m.kind === 'notFound').length,
)
const listedMisses = computed(() =>
  props.misses.filter((m) => m.kind !== 'notFound'),
)

async function openProfile(group: UserLookupGroup) {
  const candidates = group.hits
    .map((h) => accountOf(h.accountId))
    .filter((a): a is Account => Boolean(a))
  const accountId = await pickAccount(
    i18n.ts._deckLookupColumn.pickAccountForProfile,
    candidates,
  )
  if (!accountId) return
  const hit = group.hits.find((h) => h.accountId === accountId)
  if (hit) navigateToUser(accountId, hit.user.id)
}

function isSelf(hit: UserLookupHit): boolean {
  return accountOf(hit.accountId)?.userId === hit.user.id
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
</script>

<template>
  <div :class="$style.wrap">
    <section v-for="group in groups" :key="group.key" :class="$style.group">
      <MkUserListItem
        :user="group.primary.user"
        :server-host="group.primary.accountHost"
        :click-to-navigate="false"
        :hover-popup="false"
        @click="openProfile(group)"
      />
      <div
        v-for="hit in group.hits"
        :key="hit.accountId"
        :class="$style.row"
        role="button"
        tabindex="0"
        @click="navigateToUser(hit.accountId, hit.user.id)"
        @keydown.enter="navigateToUser(hit.accountId, hit.user.id)"
      >
        <AccountAvatar
          :src="accountOf(hit.accountId) ? getAccountAvatarUrl(accountOf(hit.accountId)!) : ''"
          :host="hit.accountHost"
          :size="24"
        />
        <span :class="$style.rowLabel">
          {{ accountOf(hit.accountId) ? getAccountLabel(accountOf(hit.accountId)!) : hit.accountHost }}
        </span>
        <span :class="$style.badges">
          <span v-if="hit.relation?.isFollowing" :class="$style.badge">{{ i18n.ts._deckLookupColumn.following }}</span>
          <span v-if="hit.relation?.isFollowed" :class="$style.badge">{{ i18n.ts._common.followsYou }}</span>
          <span v-if="hit.relation?.isBlocking" :class="[$style.badge, $style.badgeDanger]">{{ i18n.ts._mkUserListItem.blocking }}</span>
          <span v-if="hit.relation?.isMuted" :class="$style.badge">{{ i18n.ts._mkUserListItem.muted }}</span>
        </span>
        <MkFollowButton
          v-if="!isSelf(hit) && hit.relation"
          data-mk-uli-action
          :user-id="hit.user.id"
          :username="hit.user.username"
          :is-following="hit.relation.isFollowing"
          :has-pending-request="hit.relation.hasPendingFollowRequestFromYou ?? false"
          :is-followed="hit.relation.isFollowed"
          :api="followApiFor(hit.accountId)"
          @click.stop
          @update="applyFollowState(hit, $event)"
        />
      </div>
    </section>

    <div v-if="notFoundCount > 0 || listedMisses.length > 0" :class="$style.misses">
      <div v-if="notFoundCount > 0">
        {{ i18n.tsx._deckLookupColumn.userNotFoundCount_plural({ count: notFoundCount }) }}
      </div>
      <div v-for="m in listedMisses" :key="m.accountId">
        {{ m.kind === 'unresolved'
          ? i18n.tsx._deckLookupColumn.userUnresolved({ account: accountOf(m.accountId) ? getAccountLabel(accountOf(m.accountId)!) : m.accountHost })
          : i18n.tsx._deckLookupColumn.userFailed({ account: accountOf(m.accountId) ? getAccountLabel(accountOf(m.accountId)!) : m.accountHost }) }}
      </div>
    </div>

    <AccountPickerSheet
      :show="sheetPurpose !== null"
      :accounts="[...(sheetAccounts ?? [])]"
      :title="i18n.ts._useAccountPicker.title"
      :description="sheetPurpose ?? undefined"
      @select="resolveSheet($event)"
      @close="resolveSheet(null)"
    />
  </div>
</template>

<style lang="scss" module>
.wrap {
  display: flex;
  flex-direction: column;
}

.group {
  border-bottom: 1px solid var(--nd-divider);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 24px;
  font-size: 0.85em;
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.rowLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}

.badges {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
}

.badge {
  display: inline-block;
  font-size: 0.75em;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  opacity: 0.7;
}

.badgeDanger {
  color: var(--nd-error, #e5484d);
}

.misses {
  padding: 6px 12px;
  font-size: 0.75em;
  opacity: 0.6;
}
</style>
