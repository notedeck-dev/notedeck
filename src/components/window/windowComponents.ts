// ウィンドウ種別 → Vue コンポーネントの対応表 (#1098)。
//
// columns/registry.ts と同じ理由で、windows/registry.ts (メタデータ) から描画の
// 配線を切り離した。`Record<WindowType, _>` なので種別の足し忘れは
// コンパイルエラーになる。

import { type Component, defineAsyncComponent } from 'vue'
import type { WindowType } from '@/stores/windows'

type Loader = () => Promise<{ default: Component }>

const WINDOW_LOADERS: Record<WindowType, Loader> = {
  'note-detail': () => import('@/components/window/NoteDetailContent.vue'),
  'note-inspector': () =>
    import('@/components/window/NoteInspectorContent.vue'),
  'notification-inspector': () =>
    import('@/components/window/NotificationInspectorContent.vue'),
  'user-profile': () => import('@/components/window/UserProfileContent.vue'),
  'federation-instance': () =>
    import('@/components/window/InstanceProfileContent.vue'),
  'follow-list': () => import('@/components/window/FollowListContent.vue'),
  aiSettings: () => import('@/components/window/AiSettingsContent.vue'),
  permissions: () => import('@/components/window/PermissionsContent.vue'),
  plugins: () => import('@/components/window/PluginsContent.vue'),
  keybinds: () => import('@/components/window/KeybindsContent.vue'),
  cssEditor: () => import('@/components/window/CssEditorContent.vue'),
  themeEditor: () => import('@/components/window/ThemeEditorContent.vue'),
  profileEditor: () => import('@/components/window/ProfileEditorContent.vue'),
  login: () => import('@/components/window/LoginContent.vue'),
  about: () => import('@/components/window/AboutContent.vue'),
  navEditor: () => import('@/components/window/NavEditorContent.vue'),
  performanceEditor: () =>
    import('@/components/window/PerformanceEditorContent.vue'),
  appearanceEditor: () =>
    import('@/components/window/AppearanceEditorContent.vue'),
  backup: () => import('@/components/window/BackupContent.vue'),
  cacheEditor: () => import('@/components/window/CacheEditorContent.vue'),
  tasksEditor: () => import('@/components/window/TasksEditorContent.vue'),
  snippetsEditor: () => import('@/components/window/SnippetsEditorContent.vue'),
  memoEditor: () => import('@/components/window/MemoEditorContent.vue'),
  'column-query-editor': () =>
    import('@/components/window/ColumnQueryEditorContent.vue'),
  'page-detail': () => import('@/components/window/PageDetailContent.vue'),
  'play-detail': () => import('@/components/window/PlayDetailContent.vue'),
  'gallery-detail': () =>
    import('@/components/window/GalleryDetailContent.vue'),
  'list-detail': () => import('@/components/window/ListDetailContent.vue'),
  'clip-detail': () => import('@/components/window/ClipDetailContent.vue'),
  'drive-file-detail': () =>
    import('@/components/window/DriveFileDetailContent.vue'),
  'page-edit': () => import('@/components/window/PageEditContent.vue'),
  'play-edit': () => import('@/components/window/PlayEditContent.vue'),
  'widget-edit': () => import('@/components/window/WidgetEditContent.vue'),
  'skill-edit': () => import('@/components/window/SkillEditContent.vue'),
  'edit-history': () => import('@/components/window/EditHistoryContent.vue'),
  connections: () => import('@/components/window/ConnectionsContent.vue'),
  connectionEdit: () => import('@/components/window/ConnectionEditContent.vue'),
  tutorial: () => import('@/components/tutorial/TutorialContent.vue'),
  tutorialEditor: () => import('@/components/window/TutorialEditorContent.vue'),
}

/** DeckWindowLayer が `<component :is>` で描くためのマップ */
export const WINDOW_COMPONENTS: Record<string, Component> = Object.fromEntries(
  Object.entries(WINDOW_LOADERS).map(([type, load]) => [
    type,
    defineAsyncComponent(load),
  ]),
)
