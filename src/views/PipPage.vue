<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import { COLUMN_COMPONENTS } from '@/columns/registry'
import AppToast from '@/components/common/AppToast.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import AddColumnDialog from '@/components/deck/AddColumnDialog.vue'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { useThemeStore } from '@/stores/theme'
import type { WindowType } from '@/stores/windows'

type WindowPayload = { type: WindowType; props: Record<string, unknown> }

const WINDOW_TITLES: Partial<Record<WindowType, string>> = {
  'note-detail': 'ノート',
  'note-inspector': 'ノート Inspector',
  'notification-inspector': '通知 Inspector',
  'user-profile': 'プロフィール',
  'federation-instance': 'サーバー',
  'follow-list': 'フォロー / フォロワー',
  login: 'ログイン',
  plugins: 'プラグイン',
  keybinds: 'キーバインド',
  cssEditor: 'カスタム CSS',
  themeEditor: 'テーマ',
  profileEditor: 'プロファイル',
  aiSettings: 'エージェント',
  permissions: '権限',
  about: 'NoteDeck について',
  navEditor: 'ナビバー',
  performanceEditor: 'パフォーマンス',
  appearanceEditor: '外観',
  backup: 'バックアップ',
  cacheEditor: 'キャッシュ',
  tasksEditor: 'タスク',
  snippetsEditor: 'スニペット',
  memoEditor: 'メモ',
  'page-detail': 'ページ',
  'play-detail': 'Play',
  'gallery-detail': 'ギャラリー',
  'list-detail': 'リスト',
  'clip-detail': 'クリップ',
  'page-edit': 'ページ編集',
  'play-edit': 'Play 編集',
  'widget-edit': 'ウィジット編集',
  'skill-edit': 'スキル編集',
}

// Lazy-loaded window content components (same set as DeckWindowLayer uses).
const NoteDetailContent = defineAsyncComponent(
  () => import('@/components/window/NoteDetailContent.vue'),
)
const NoteInspectorContent = defineAsyncComponent(
  () => import('@/components/window/NoteInspectorContent.vue'),
)
const NotificationInspectorContent = defineAsyncComponent(
  () => import('@/components/window/NotificationInspectorContent.vue'),
)
const UserProfileContent = defineAsyncComponent(
  () => import('@/components/window/UserProfileContent.vue'),
)
const InstanceProfileContent = defineAsyncComponent(
  () => import('@/components/window/InstanceProfileContent.vue'),
)
const FollowListContent = defineAsyncComponent(
  () => import('@/components/window/FollowListContent.vue'),
)
const LoginContent = defineAsyncComponent(
  () => import('@/components/window/LoginContent.vue'),
)
const PluginsContent = defineAsyncComponent(
  () => import('@/components/window/PluginsContent.vue'),
)
const KeybindsContent = defineAsyncComponent(
  () => import('@/components/window/KeybindsContent.vue'),
)
const CssEditorContent = defineAsyncComponent(
  () => import('@/components/window/CssEditorContent.vue'),
)
const ThemeEditorContent = defineAsyncComponent(
  () => import('@/components/window/ThemeEditorContent.vue'),
)
const ProfileEditorContent = defineAsyncComponent(
  () => import('@/components/window/ProfileEditorContent.vue'),
)
const AiSettingsContent = defineAsyncComponent(
  () => import('@/components/window/AiSettingsContent.vue'),
)
const PermissionsContent = defineAsyncComponent(
  () => import('@/components/window/PermissionsContent.vue'),
)
const AboutContent = defineAsyncComponent(
  () => import('@/components/window/AboutContent.vue'),
)
const NavEditorContent = defineAsyncComponent(
  () => import('@/components/window/NavEditorContent.vue'),
)
const PerformanceEditorContent = defineAsyncComponent(
  () => import('@/components/window/PerformanceEditorContent.vue'),
)
const AppearanceEditorContent = defineAsyncComponent(
  () => import('@/components/window/AppearanceEditorContent.vue'),
)
const BackupContent = defineAsyncComponent(
  () => import('@/components/window/BackupContent.vue'),
)
const CacheEditorContent = defineAsyncComponent(
  () => import('@/components/window/CacheEditorContent.vue'),
)
const TasksEditorContent = defineAsyncComponent(
  () => import('@/components/window/TasksEditorContent.vue'),
)
const SnippetsEditorContent = defineAsyncComponent(
  () => import('@/components/window/SnippetsEditorContent.vue'),
)
const MemoEditorContent = defineAsyncComponent(
  () => import('@/components/window/MemoEditorContent.vue'),
)
const PageDetailContent = defineAsyncComponent(
  () => import('@/components/window/PageDetailContent.vue'),
)
const PlayDetailContent = defineAsyncComponent(
  () => import('@/components/window/PlayDetailContent.vue'),
)
const GalleryDetailContent = defineAsyncComponent(
  () => import('@/components/window/GalleryDetailContent.vue'),
)
const ListDetailContent = defineAsyncComponent(
  () => import('@/components/window/ListDetailContent.vue'),
)
const ClipDetailContent = defineAsyncComponent(
  () => import('@/components/window/ClipDetailContent.vue'),
)
const PageEditContent = defineAsyncComponent(
  () => import('@/components/window/PageEditContent.vue'),
)
const PlayEditContent = defineAsyncComponent(
  () => import('@/components/window/PlayEditContent.vue'),
)
const WidgetEditContent = defineAsyncComponent(
  () => import('@/components/window/WidgetEditContent.vue'),
)
const SkillEditContent = defineAsyncComponent(
  () => import('@/components/window/SkillEditContent.vue'),
)

const route = useRoute()
const accountsStore = useAccountsStore()
const themeStore = useThemeStore()

let pipColumnCounter = 0
function genPipColumnId(): string {
  return `pip-${Date.now()}-${++pipColumnCounter}`
}

const selectedColumn = ref<DeckColumn | null>(null)
const windowPayload = ref<WindowPayload | null>(null)

const themeVars = computed(() => {
  const accountId =
    selectedColumn.value?.accountId ??
    (windowPayload.value?.props.accountId as string | undefined)
  if (!accountId) return undefined
  return themeStore.getStyleVarsForAccount(accountId)
})

const windowTitle = computed(() => {
  const t = windowPayload.value?.type
  if (!t) return ''
  return WINDOW_TITLES[t] ?? t
})

function onColumnSelected(config: Omit<DeckColumn, 'id'>) {
  const column: DeckColumn = { ...config, id: genPipColumnId() }
  selectedColumn.value = column
}

// Provide column config getter for DeckColumn's "return to deck" feature
provide('pipColumnConfig', () => selectedColumn.value)

async function closeWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}

/** Parse column config from URL query param (base64-encoded JSON) */
function parseColumnFromUrl(): Omit<DeckColumn, 'id'> | null {
  const encoded = route.query.col as string | undefined
  if (!encoded) return null
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)))
  } catch {
    return null
  }
}

/** Parse window payload from URL query param (base64-encoded JSON) */
function parseWindowFromUrl(): WindowPayload | null {
  const encoded = route.query.win as string | undefined
  if (!encoded) return null
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)))
  } catch {
    return null
  }
}

onMounted(async () => {
  if (!accountsStore.isLoaded) {
    await accountsStore.loadAccounts()
  }

  const winPayload = parseWindowFromUrl()
  if (winPayload) {
    windowPayload.value = winPayload
    return
  }

  const urlConfig = parseColumnFromUrl()
  if (urlConfig) {
    onColumnSelected(urlConfig)
  }
})
</script>

<template>
  <div :class="$style.pipRoot" :style="themeVars">
    <!-- Window mode: single window-type component -->
    <template v-if="windowPayload">
      <div :class="$style.pipDragBar" data-tauri-drag-region>
        <span :class="$style.pipDragTitle" data-tauri-drag-region>{{ windowTitle }}</span>
        <button :class="$style.pipDragClose" @click="closeWindow">
          <i class="ti ti-x" />
        </button>
      </div>
      <div :class="$style.pipWindowBody">
        <NoteDetailContent
          v-if="windowPayload.type === 'note-detail'"
          :account-id="(windowPayload.props.accountId as string)"
          :note-id="(windowPayload.props.noteId as string)"
          @close="closeWindow"
        />
        <NoteInspectorContent
          v-else-if="windowPayload.type === 'note-inspector'"
          :account-id="(windowPayload.props.accountId as string)"
          :note-id="(windowPayload.props.noteId as string)"
          :note-uri="(windowPayload.props.noteUri as string | undefined)"
          :server-host="(windowPayload.props.serverHost as string | undefined)"
        />
        <NotificationInspectorContent
          v-else-if="windowPayload.type === 'notification-inspector'"
          :account-id="(windowPayload.props.accountId as string)"
          :notification="(windowPayload.props.notification as any)"
        />
        <UserProfileContent
          v-else-if="windowPayload.type === 'user-profile'"
          :account-id="(windowPayload.props.accountId as string)"
          :user-id="(windowPayload.props.userId as string)"
        />
        <InstanceProfileContent
          v-else-if="windowPayload.type === 'federation-instance'"
          :account-id="(windowPayload.props.accountId as string)"
          :host="(windowPayload.props.host as string)"
          :initial-instance="(windowPayload.props.initialInstance as any)"
        />
        <FollowListContent
          v-else-if="windowPayload.type === 'follow-list'"
          :account-id="(windowPayload.props.accountId as string)"
          :user-id="(windowPayload.props.userId as string)"
          :initial-tab="(windowPayload.props.initialTab as 'following' | 'followers' | undefined)"
        />
        <LoginContent
          v-else-if="windowPayload.type === 'login'"
          :initial-host="(windowPayload.props.initialHost as string | undefined)"
          @close="closeWindow"
          @success="closeWindow"
        />
        <PluginsContent
          v-else-if="windowPayload.type === 'plugins'"
          :initial-plugin-id="(windowPayload.props.initialPluginId as string | undefined)"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <KeybindsContent
          v-else-if="windowPayload.type === 'keybinds'"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <CssEditorContent
          v-else-if="windowPayload.type === 'cssEditor'"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <ThemeEditorContent
          v-else-if="windowPayload.type === 'themeEditor'"
          :initial-theme-id="(windowPayload.props.initialThemeId as string | undefined)"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <ProfileEditorContent
          v-else-if="windowPayload.type === 'profileEditor'"
          :profile-id="(windowPayload.props.profileId as string)"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <AiSettingsContent
          v-else-if="windowPayload.type === 'aiSettings'"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <PermissionsContent v-else-if="windowPayload.type === 'permissions'" />
        <AboutContent v-else-if="windowPayload.type === 'about'" />
        <NavEditorContent
          v-else-if="windowPayload.type === 'navEditor'"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <PerformanceEditorContent
          v-else-if="windowPayload.type === 'performanceEditor'"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <AppearanceEditorContent
          v-else-if="windowPayload.type === 'appearanceEditor'"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <BackupContent
          v-else-if="windowPayload.type === 'backup'"
          :initial-tab="(windowPayload.props.initialTab as 'notedeck' | 'db' | undefined)"
        />
        <CacheEditorContent v-else-if="windowPayload.type === 'cacheEditor'" />
        <TasksEditorContent v-else-if="windowPayload.type === 'tasksEditor'" />
        <SnippetsEditorContent v-else-if="windowPayload.type === 'snippetsEditor'" />
        <MemoEditorContent
          v-else-if="windowPayload.type === 'memoEditor'"
          :account-id="(windowPayload.props.accountId as string)"
          :memo-key="(windowPayload.props.memoKey as string)"
          :initial-tab="(windowPayload.props.initialTab as string | undefined)"
        />
        <PageDetailContent
          v-else-if="windowPayload.type === 'page-detail'"
          :account-id="(windowPayload.props.accountId as string)"
          :page-id="(windowPayload.props.pageId as string)"
        />
        <PlayDetailContent
          v-else-if="windowPayload.type === 'play-detail'"
          :account-id="(windowPayload.props.accountId as string)"
          :flash-id="(windowPayload.props.flashId as string)"
        />
        <GalleryDetailContent
          v-else-if="windowPayload.type === 'gallery-detail'"
          :account-id="(windowPayload.props.accountId as string)"
          :post-id="(windowPayload.props.postId as string)"
          :post="(windowPayload.props.post as any)"
        />
        <ListDetailContent
          v-else-if="windowPayload.type === 'list-detail'"
          :account-id="(windowPayload.props.accountId as string)"
          :list-id="(windowPayload.props.listId as string)"
          :owner-user-id="(windowPayload.props.ownerUserId as string | undefined)"
        />
        <ClipDetailContent
          v-else-if="windowPayload.type === 'clip-detail'"
          :account-id="(windowPayload.props.accountId as string)"
          :clip-id="(windowPayload.props.clipId as string)"
        />
        <PageEditContent
          v-else-if="windowPayload.type === 'page-edit'"
          :account-id="(windowPayload.props.accountId as string)"
          :page-id="(windowPayload.props.pageId as string)"
        />
        <PlayEditContent
          v-else-if="windowPayload.type === 'play-edit'"
          :account-id="(windowPayload.props.accountId as string)"
          :flash-id="(windowPayload.props.flashId as string)"
        />
        <WidgetEditContent
          v-else-if="windowPayload.type === 'widget-edit'"
          :widget-id="(windowPayload.props.widgetId as string)"
          :account-id="(windowPayload.props.accountId as string | null | undefined)"
          @close="closeWindow"
        />
        <SkillEditContent
          v-else-if="windowPayload.type === 'skill-edit'"
          :skill-id="(windowPayload.props.skillId as string)"
          @close="closeWindow"
        />
      </div>
    </template>

    <!-- Column selector -->
    <template v-else-if="!selectedColumn">
      <!-- Drag bar for selector state -->
      <div :class="$style.pipDragBar" data-tauri-drag-region>
        <span :class="$style.pipDragTitle" data-tauri-drag-region>カラムを追加</span>
        <button :class="$style.pipDragClose" @click="closeWindow">
          <i class="ti ti-x" />
        </button>
      </div>
      <div :class="$style.pipSelectorBody">
        <AddColumnDialog
          mode="pip"
          @column-selected="onColumnSelected"
          @close="closeWindow"
        />
      </div>
    </template>

    <!-- Render the selected column -->
    <template v-else>
      <component
        :is="COLUMN_COMPONENTS[selectedColumn.type]"
        :column="selectedColumn"
      />
    </template>

    <AppToast />
    <AppTooltip />
  </div>
</template>

<style lang="scss" module>
.pipRoot {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--nd-panel);
  color: var(--nd-fg);
  overflow: hidden;
  border-radius: 10px;
}

.pipDragBar {
  display: flex;
  align-items: center;
  height: 38px;
  padding: 0 8px 0 16px;
  background: color(from var(--nd-panelHeaderBg) srgb r g b / var(--nd-header-opacity));
  backdrop-filter: var(--nd-vibrancy);
  -webkit-backdrop-filter: var(--nd-vibrancy);
  color: var(--nd-panelHeaderFg);
  user-select: none;
  flex-shrink: 0;
  border-radius: 10px 10px 0 0;
  box-shadow: 0 0.5px 0 0 var(--nd-hairline);
}

.pipDragTitle {
  flex: 1;
  font-size: 0.9em;
  font-weight: bold;
}

.pipDragClose {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--nd-panelHeaderFg);
  border-radius: var(--nd-radius-sm);
  opacity: 0.35;
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 0.8;
  }
}

.pipSelectorBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pipWindowBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  background: var(--nd-panel);
}
</style>
