<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef, watch } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import MkNote from '@/components/common/MkNote.vue'
import MkUserListItem from '@/components/common/MkUserListItem.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import ReadMarkerDivider from '@/components/common/ReadMarkerDivider.vue'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

import { useNoteColumn } from '@/composables/useNoteColumn'
import { usePortal } from '@/composables/usePortal'
import { useTabSlide } from '@/composables/useTabSlide'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { AppError } from '@/utils/errors'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

// --- Tab ---
type Tab = 'notes' | 'users' | 'roles'
const ALL_TAB_DEFS: ColumnTabDef[] = [
  { value: 'notes', label: 'ノート' },
  { value: 'users', label: 'ユーザー' },
  { value: 'roles', label: 'ロール' },
]
const activeTab = ref<Tab>('notes')
const columnContentRef = ref<HTMLElement | null>(null)

// --- Notes tab (useNoteColumn) ---
const {
  account,
  columnThemeVars,
  serverIconUrl,
  serverInfoImageUrl,
  serverNotFoundImageUrl,
  serverErrorImageUrl,
  isLoading,
  viewMarkerId,
  error,
  notes,
  focusedNoteId,
  postForm,
  handlers,
  noteScrollerRef,
  scrollToTop,
  handleScroll,
  handlePosted,
  removeNote,
  refresh: refreshNotes,
  isPulling,
  isPulledEnough,
  isRefreshing,
  pullDistance,
  displayHeight,
  loadMore,
} = useNoteColumn({
  getColumn: () => props.column,
  fetch: async (adapter, opts) => {
    if (opts.untilId) return []
    return adapter.api.getFeaturedNotes({ limit: 30 })
  },
  cache: {
    getKey: () => 'explore',
  },
})

// roles/list は本家 Misskey で認証必須。ログアウト/ゲスト時はロールタブを出さない
// (TL カラムでホーム/ソーシャルを隠すのと同じ方針。ログアウト中である旨はカラム
//  共通のテロップで示されるため、ここで個別の案内は出さない)。
const tabDefs = computed<ColumnTabDef[]>(() =>
  account.value?.hasToken
    ? ALL_TAB_DEFS
    : ALL_TAB_DEFS.filter((t) => t.value !== 'roles'),
)
// タブが消えたとき (ログアウト等) は notes に戻す
watch(tabDefs, (defs) => {
  if (!defs.some((t) => t.value === activeTab.value)) activeTab.value = 'notes'
})

// --- Users tab ---
interface UserSummary {
  id: string
  username: string
  host: string | null
  name: string | null
  avatarUrl: string | null
  followersCount: number
  description: string | null
  emojis?: Record<string, string>
}

const users = ref<UserSummary[]>([])
const usersLoading = ref(false)
const usersError = ref<AppError | null>(null)
const usersFetched = ref(false)

async function fetchUsers() {
  if (!props.column.accountId) return
  usersLoading.value = true
  usersError.value = null
  try {
    users.value = unwrap(
      await commands.apiSearchUsers(
        props.column.accountId,
        null,
        'combined',
        '+follower',
        'alive',
        30,
        null,
      ),
    ) as unknown as UserSummary[]
    usersFetched.value = true
  } catch (e) {
    usersError.value = AppError.from(e)
  } finally {
    usersLoading.value = false
  }
}

// --- Roles tab ---
interface RoleSummary {
  id: string
  name: string
  description: string | null
  color: string | null
  iconUrl: string | null
  usersCount: number
  target: string
  displayOrder: number
}

const roles = ref<RoleSummary[]>([])
const rolesLoading = ref(false)
const rolesError = ref<AppError | null>(null)
const rolesFetched = ref(false)

// Role users
const roleUsers = ref<UserSummary[]>([])
const roleUsersLoading = ref(false)
const roleUsersError = ref<AppError | null>(null)
const selectedRole = ref<RoleSummary | null>(null)

async function fetchRoles() {
  if (!props.column.accountId) return
  rolesLoading.value = true
  rolesError.value = null
  try {
    const allRoles = unwrap(
      await commands.apiGetRoles(props.column.accountId),
    ) as unknown as RoleSummary[]
    roles.value = allRoles
      .filter((r) => r.target === 'manual')
      .sort((a, b) => b.displayOrder - a.displayOrder)
    rolesFetched.value = true
  } catch (e) {
    rolesError.value = AppError.from(e)
  } finally {
    rolesLoading.value = false
  }
}

async function openRole(role: RoleSummary) {
  if (!props.column.accountId) return
  selectedRole.value = role
  roleUsersLoading.value = true
  roleUsersError.value = null
  roleUsers.value = []
  try {
    const result = unwrap(
      await commands.apiGetRoleUsers(props.column.accountId, role.id, 30, null),
    ) as unknown as { id: string; user: UserSummary }[]
    roleUsers.value = result.map((entry) => entry.user)
  } catch (e) {
    roleUsersError.value = AppError.from(e)
  } finally {
    roleUsersLoading.value = false
  }
}

function closeRole() {
  selectedRole.value = null
  roleUsers.value = []
}

// --- Tab switching ---
function switchTab(tab: string) {
  const t = tab as Tab
  activeTab.value = t
  if (t === 'users' && !usersFetched.value) fetchUsers()
  if (t === 'roles' && !rolesFetched.value) fetchRoles()
}

// Tab slide animation
const exploreTabIndex = computed(() =>
  tabDefs.value.findIndex((t) => t.value === activeTab.value),
)
useTabSlide(exploreTabIndex, columnContentRef)

function refresh() {
  if (activeTab.value === 'notes') {
    refreshNotes()
  } else if (activeTab.value === 'users') {
    usersFetched.value = false
    fetchUsers()
  } else {
    rolesFetched.value = false
    selectedRole.value = null
    fetchRoles()
  }
}

const currentLoading = computed(() => {
  if (activeTab.value === 'notes') return isLoading.value
  if (activeTab.value === 'users') return usersLoading.value
  return rolesLoading.value
})

const postPortalRef = useTemplateRef<HTMLElement>('postPortalRef')
usePortal(postPortalRef)
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || 'みつける'"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="activeTab === 'notes' ? scrollToTop() : undefined"
    @refresh="refresh"
  >
    <template #header-icon>
      <i class="ti ti-compass" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <button v-if="selectedRole" class="_button" :class="$style.headerRefresh" title="戻る" @click.stop="closeRole">
        <i class="ti ti-arrow-left" />
      </button>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <div ref="columnContentRef" :class="$style.exploreContent">
      <ColumnTabs
        :tabs="tabDefs"
        :model-value="activeTab"
        :swipe-target="columnContentRef"
        @update:model-value="switchTab"
      />

      <!-- Notes tab -->
      <template v-if="activeTab === 'notes'">
        <ColumnEmptyState
          v-if="error"
          :error="error"
          :account-id="column.accountId"
          :image-url="serverErrorImageUrl"
          is-error
          cta-label="再試行"
          cta-icon="ti-refresh"
          @cta="refreshNotes"
        />

        <div v-else :class="$style.tlBody">
          <div
            v-if="isPulling"
            :class="$style.pullFrame"
            :style="`--frame-min-height: ${displayHeight()}px`"
          >
            <div :class="$style.pullFrameContent">
              <i v-if="isRefreshing" class="ti ti-loader-2 nd-spin" />
              <i v-else class="ti ti-arrow-bar-to-down" :class="{ refresh: isPulledEnough }" />
              <div :class="$style.pullText">
                <template v-if="isPulledEnough">離してリフレッシュ</template>
                <template v-else-if="isRefreshing">リフレッシュ中…</template>
                <template v-else>下に引いてリフレッシュ</template>
              </div>
            </div>
          </div>
          <div v-if="isLoading && notes.length === 0" :class="$style.columnLoading">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="notes.length === 0"
            message="ノートが見つかりません"
            :image-url="serverInfoImageUrl"
          />
          <template v-else>
            <NoteScroller ref="noteScrollerRef" :items="notes" :focused-id="focusedNoteId" :class="$style.tlScroller" @scroll="handleScroll" @near-end="loadMore">
              <template #default="{ item, index }">
                <div>
                  <ReadMarkerDivider
                    v-if="viewMarkerId && index > 0 && item.id === viewMarkerId"
                  />
                  <MkNote
                    :note="item"
                    :focused="item.id === focusedNoteId"
                    @react="handlers.reaction"
                    @reply="handlers.reply"
                    @renote="handlers.renote"
                    @quote="handlers.quote"
                    @delete="removeNote"
                    @edit="handlers.edit"
                    @bookmark="handlers.bookmark"
                    @delete-and-edit="handlers.deleteAndEdit"
                    @vote="handlers.vote"
                  />
                </div>
              </template>
            </NoteScroller>
          </template>
        </div>
      </template>

      <!-- Users tab -->
      <template v-else-if="activeTab === 'users'">
        <div v-if="usersLoading" :class="$style.columnLoading"><LoadingSpinner /></div>
        <ColumnEmptyState
          v-else-if="usersError"
          :error="usersError"
          :account-id="column.accountId"
          subject="ユーザー情報"
          :has-token="!!account?.hasToken"
          :image-url="serverErrorImageUrl"
          :info-image-url="serverInfoImageUrl"
          cta-label="再試行"
          cta-icon="ti-refresh"
          @cta="fetchUsers"
        />
        <ColumnEmptyState v-else-if="users.length === 0" message="ユーザーが見つかりません" :image-url="serverInfoImageUrl" />
        <div v-else :class="$style.exploreList">
          <MkUserListItem
            v-for="user in users"
            :key="user.id"
            :user="user"
            :account-id="column.accountId ?? undefined"
            :server-host="account?.host"
          >
            <template #meta>
              <div v-if="user.description" :class="$style.exploreUserDesc">
                <MkMfm
                  :text="user.description"
                  :emojis="user.emojis"
                  :server-host="account?.host ?? undefined"
                  plain
                />
              </div>
              <div class="user-stats" :class="$style.exploreUserMeta" :data-own="account?.userId === user.id">
                <i class="ti ti-users" /> <span class="user-stat-count">{{ user.followersCount }}</span>
              </div>
            </template>
          </MkUserListItem>
        </div>
      </template>

      <!-- Roles tab -->
      <template v-else>
        <!-- Role users detail -->
        <template v-if="selectedRole">
          <div :class="$style.exploreRoleHeader">
            <span v-if="selectedRole.iconUrl" :class="$style.exploreRoleIcon">
              <img :src="selectedRole.iconUrl" />
            </span>
            <span>{{ selectedRole.name }}</span>
          </div>
          <div v-if="roleUsersLoading" :class="$style.columnLoading"><LoadingSpinner /></div>
          <ColumnEmptyState
            v-else-if="roleUsersError"
            :error="roleUsersError"
            :account-id="column.accountId"
            :image-url="serverErrorImageUrl"
            is-error
            cta-label="再試行"
            cta-icon="ti-refresh"
            @cta="selectedRole && openRole(selectedRole)"
          />
          <ColumnEmptyState v-else-if="roleUsers.length === 0" message="ユーザーがいません" :image-url="serverInfoImageUrl" />
          <div v-else :class="$style.exploreList">
            <MkUserListItem
              v-for="user in roleUsers"
              :key="user.id"
              :user="user"
              :account-id="column.accountId ?? undefined"
              :server-host="account?.host"
            />
          </div>
        </template>

        <!-- Roles list -->
        <template v-else>
          <div v-if="rolesLoading" :class="$style.columnLoading"><LoadingSpinner /></div>
          <ColumnEmptyState
            v-else-if="rolesError"
            :error="rolesError"
            :account-id="column.accountId"
            :image-url="serverErrorImageUrl"
            is-error
            cta-label="再試行"
            cta-icon="ti-refresh"
            @cta="fetchRoles"
          />
          <ColumnEmptyState v-else-if="roles.length === 0" message="ロールが見つかりません" :image-url="serverInfoImageUrl" />
          <div v-else :class="$style.exploreList">
            <button
              v-for="role in roles"
              :key="role.id"
              class="_button"
              :class="$style.exploreRoleCard"
              @click="openRole(role)"
            >
              <span v-if="role.iconUrl" :class="$style.exploreRoleIcon">
                <img :src="role.iconUrl" />
              </span>
              <div :class="$style.exploreRoleInfo">
                <div :class="$style.exploreRoleName" :style="role.color ? { color: role.color } : undefined">{{ role.name }}</div>
                <div v-if="role.description" :class="$style.exploreRoleDesc">{{ role.description }}</div>
                <div :class="$style.exploreRoleMeta">
                  <i class="ti ti-users" /> {{ role.usersCount }}
                </div>
              </div>
            </button>
          </div>
        </template>
      </template>
      </div>
  </DeckColumn>

  <div v-if="postForm.show.value && column.accountId && account?.hasToken" ref="postPortalRef">
    <MkPostForm
      :account-id="column.accountId"
      :reply-to="postForm.replyTo.value"
      :renote-id="postForm.renoteId.value"
      :edit-note="postForm.editNote.value"
      :initial-text="postForm.initialText.value"
      :initial-cw="postForm.initialCw.value"
      :initial-visibility="postForm.initialVisibility.value"
      @close="postForm.close"
      @posted="handlePosted"
    />
  </div>
</template>

<style lang="scss" module>
@use './column-common.module.scss';
.exploreContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* --- List --- */
.exploreList {
  composes: columnScroller from './column-common.module.scss';
}

.exploreUserDesc {
  margin-top: 4px;
  font-size: 0.8em;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.exploreUserMeta {
  margin-top: 4px;
  font-size: 0.75em;
  opacity: 0.5;
  display: flex;
  align-items: center;
  gap: 3px;
}

/* --- Role card --- */
/* Self-chained for specificity 0,2,0 to beat ._button (0,1,0)
   regardless of CSS chunk load order (Windows WebView2). */
.exploreRoleCard.exploreRoleCard {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--nd-divider);
  transition: background var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 65px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.exploreRoleIcon img {
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
}

.exploreRoleInfo {
  flex: 1;
  min-width: 0;
}

.exploreRoleName {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.exploreRoleDesc {
  margin-top: 2px;
  font-size: 0.8em;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.exploreRoleMeta {
  margin-top: 4px;
  font-size: 0.75em;
  opacity: 0.5;
  display: flex;
  align-items: center;
  gap: 3px;
}

.exploreRoleHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;

  img {
    width: 20px;
    height: 20px;
    border-radius: 4px;
  }
}
</style>
