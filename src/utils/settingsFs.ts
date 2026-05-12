import { commands, unwrap } from '@/utils/tauriInvoke'

export const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

/** Characters not allowed in filenames (Windows + Unix safety). */
const INVALID_CHARS = /[<>:"/\\|?*]/g

/** Sanitize a string for use as a filename. */
export function sanitizeFilename(name: string): string {
  let safe = name.replace(INVALID_CHARS, '_').trim()
  // Collapse consecutive underscores
  safe = safe.replace(/_+/g, '_')
  // Limit length
  if (safe.length > 64) safe = safe.slice(0, 64)
  return safe || 'untitled'
}

// --- Generic settings file operations ---

export async function listSettingsFiles(subdir: string): Promise<string[]> {
  if (!isTauri) return []
  return unwrap(await commands.listSettingsFiles(subdir))
}

export async function readSettingsFile(
  subdir: string,
  name: string,
): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.readSettingsFile(subdir, name))
}

export async function writeSettingsFile(
  subdir: string,
  name: string,
  content: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.writeSettingsFile(subdir, name, content))
}

export async function deleteSettingsFile(
  subdir: string,
  name: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.deleteSettingsFile(subdir, name))
}

export async function renameSettingsFile(
  subdir: string,
  oldName: string,
  newName: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.renameSettingsFile(subdir, oldName, newName))
}

export async function getSettingsDir(): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.getSettingsDir())
}

/**
 * OS 既定アプリ (通常はユーザーが登録したテキストエディタ) で設定ファイルを開く。
 * WSL2 環境では xdg-open が GUI エディタへ届かないため、Rust 側で
 * wslpath + cmd.exe start に委譲する。
 */
export async function openSettingsFileInEditor(
  name: string,
  subdir?: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.openSettingsFileInEditor(subdir ?? null, name))
}

// --- Profile-specific helpers ---

const PROFILES_DIR = 'profiles'
const PROFILE_EXT = '.ndprofile.json5'

export function profileFilename(name: string): string {
  return sanitizeFilename(name) + PROFILE_EXT
}

export async function listProfiles(): Promise<string[]> {
  const files = await listSettingsFiles(PROFILES_DIR)
  return files.filter((f) => f.endsWith(PROFILE_EXT))
}

export async function readProfile(filename: string): Promise<string> {
  return readSettingsFile(PROFILES_DIR, filename)
}

export async function writeProfile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(PROFILES_DIR, filename, content)
}

export async function deleteProfile(filename: string): Promise<void> {
  return deleteSettingsFile(PROFILES_DIR, filename)
}

export async function renameProfile(
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  return renameSettingsFile(PROFILES_DIR, oldFilename, newFilename)
}

// --- Root-level file operations ---

async function readRootSettingsFile(name: string): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.readRootSettingsFile(name))
}

async function writeRootSettingsFile(
  name: string,
  content: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.writeRootSettingsFile(name, content))
}

// --- Theme-specific helpers ---

const THEMES_DIR = 'themes'
const THEME_EXT = '.ndtheme.json5'

export function themeFilename(name: string): string {
  return sanitizeFilename(name) + THEME_EXT
}

export async function listThemes(): Promise<string[]> {
  const files = await listSettingsFiles(THEMES_DIR)
  return files.filter((f) => f.endsWith(THEME_EXT))
}

export async function readTheme(filename: string): Promise<string> {
  return readSettingsFile(THEMES_DIR, filename)
}

export async function writeTheme(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(THEMES_DIR, filename, content)
}

export async function deleteTheme(filename: string): Promise<void> {
  return deleteSettingsFile(THEMES_DIR, filename)
}

export async function renameTheme(
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  return renameSettingsFile(THEMES_DIR, oldFilename, newFilename)
}

// --- Custom CSS helpers ---

export async function readCustomCss(): Promise<string> {
  return readRootSettingsFile('custom.css')
}

export async function writeCustomCss(css: string): Promise<void> {
  return writeRootSettingsFile('custom.css', css)
}

// --- Keybinds helpers ---

export async function readKeybinds(): Promise<string> {
  return readRootSettingsFile('keybinds.json5')
}

export async function writeKeybinds(content: string): Promise<void> {
  return writeRootSettingsFile('keybinds.json5', content)
}

// --- AI settings helpers ---

export async function readAiSettings(): Promise<string> {
  return readRootSettingsFile('ai.json5')
}

export async function writeAiSettings(content: string): Promise<void> {
  return writeRootSettingsFile('ai.json5', content)
}

// --- Tasks helpers ---

export async function readTasks(): Promise<string> {
  return readRootSettingsFile('tasks.json5')
}

export async function writeTasks(content: string): Promise<void> {
  return writeRootSettingsFile('tasks.json5', content)
}

// --- Navbar helpers ---

export async function readNavbar(): Promise<string> {
  return readRootSettingsFile('navbar.json5')
}

export async function writeNavbar(content: string): Promise<void> {
  return writeRootSettingsFile('navbar.json5', content)
}

// --- Post form button order helpers ---

export async function readPostForm(): Promise<string> {
  return readRootSettingsFile('postform.json5')
}

export async function writePostForm(content: string): Promise<void> {
  return writeRootSettingsFile('postform.json5', content)
}

// --- Performance helpers ---

export async function readPerformance(): Promise<string> {
  return readRootSettingsFile('performance.json5')
}

export async function writePerformance(content: string): Promise<void> {
  return writeRootSettingsFile('performance.json5', content)
}

// --- Snippet helpers ---

const SNIPPETS_DIR = 'snippets'
const SNIPPET_EXT = /\.(json5?|code-snippets|jsonc)$/i

export async function listSnippetFiles(): Promise<string[]> {
  const files = await listSettingsFiles(SNIPPETS_DIR)
  return files.filter((f) => SNIPPET_EXT.test(f))
}

export async function readSnippetFile(filename: string): Promise<string> {
  return readSettingsFile(SNIPPETS_DIR, filename)
}

export async function writeSnippetFile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(SNIPPETS_DIR, filename, content)
}

export async function deleteSnippetFile(filename: string): Promise<void> {
  return deleteSettingsFile(SNIPPETS_DIR, filename)
}

// --- Memo helpers (flat Markdown vault under memos/{key}.md) ---

const MEMOS_DIR = 'memos'
const MEMO_EXT = '.md'

export async function listMemoFiles(): Promise<string[]> {
  const files = await listSettingsFiles(MEMOS_DIR)
  return files.filter((f) => f.endsWith(MEMO_EXT))
}

export async function readMemoFile(name: string): Promise<string> {
  return readSettingsFile(MEMOS_DIR, name)
}

export async function writeMemoFile(
  name: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(MEMOS_DIR, name, content)
}

export async function deleteMemoFile(name: string): Promise<void> {
  return deleteSettingsFile(MEMOS_DIR, name)
}

export async function openMemoFileInEditor(name: string): Promise<void> {
  return openSettingsFileInEditor(name, MEMOS_DIR)
}

// --- Plugin helpers ---

const PLUGINS_DIR = 'plugins'
const PLUGIN_SRC_EXT = '.is'
const PLUGIN_META_EXT = '.meta.json5'

export function pluginSrcFilename(name: string): string {
  return sanitizeFilename(name) + PLUGIN_SRC_EXT
}

export function pluginMetaFilename(name: string): string {
  return sanitizeFilename(name) + PLUGIN_META_EXT
}

export async function listPluginFiles(): Promise<string[]> {
  return listSettingsFiles(PLUGINS_DIR)
}

export async function readPluginFile(filename: string): Promise<string> {
  return readSettingsFile(PLUGINS_DIR, filename)
}

export async function writePluginFile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(PLUGINS_DIR, filename, content)
}

export async function deletePluginFile(filename: string): Promise<void> {
  return deleteSettingsFile(PLUGINS_DIR, filename)
}

export async function renamePluginFile(
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  return renameSettingsFile(PLUGINS_DIR, oldFilename, newFilename)
}

// --- Skill helpers ---

const SKILLS_DIR = 'skills'
const SKILL_EXT = '.md'

export function skillFilename(name: string): string {
  return sanitizeFilename(name) + SKILL_EXT
}

export async function listSkillFiles(): Promise<string[]> {
  const files = await listSettingsFiles(SKILLS_DIR)
  return files.filter((f) => f.endsWith(SKILL_EXT))
}

export async function readSkillFile(filename: string): Promise<string> {
  return readSettingsFile(SKILLS_DIR, filename)
}

export async function writeSkillFile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(SKILLS_DIR, filename, content)
}

export async function deleteSkillFile(filename: string): Promise<void> {
  return deleteSettingsFile(SKILLS_DIR, filename)
}

export async function renameSkillFile(
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  return renameSettingsFile(SKILLS_DIR, oldFilename, newFilename)
}

// --- AI session helpers (sessions/<sessionId>.json5) ---
//
// AI セッション（chat / 将来の command/task/HEARTBEAT）の永続化。
// コード側の抽象は `AiSession` だが、on-disk のディレクトリ名は他トップレベル
// 項目と深度を揃えるため `sessions/`。

const SESSIONS_DIR = 'sessions'
const AI_SESSION_EXT = '.json5'

export function aiSessionFilename(sessionId: string): string {
  return sanitizeFilename(sessionId) + AI_SESSION_EXT
}

export async function listAiSessionFiles(): Promise<string[]> {
  const files = await listSettingsFiles(SESSIONS_DIR)
  return files.filter((f) => f.endsWith(AI_SESSION_EXT))
}

export async function readAiSessionFile(filename: string): Promise<string> {
  return readSettingsFile(SESSIONS_DIR, filename)
}

export async function writeAiSessionFile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(SESSIONS_DIR, filename, content)
}

// --- Edit history sidecar helpers (skill / widget / plugin / theme) ---
//
// 各 kind の編集前 snapshot をリング 10 件で `<basename>.history.json5` に
// サイドカー保存する。実装は対応する dir (skills/widgets/plugins/themes) に
// 隣接する別ファイル。Tauri 外 (ブラウザ) では呼んでも no-op (上位で
// localStorage fallback)。

const HISTORY_EXT = '.history.json5'

export type HistoryKind = 'skill' | 'widget' | 'plugin' | 'theme'

function historyDirFor(kind: HistoryKind): string {
  switch (kind) {
    case 'skill':
      return SKILLS_DIR
    case 'widget':
      return WIDGETS_DIR
    case 'plugin':
      return PLUGINS_DIR
    case 'theme':
      return THEMES_DIR
  }
}

export function historyFilename(basename: string): string {
  return sanitizeFilename(basename) + HISTORY_EXT
}

export async function readHistorySidecar(
  kind: HistoryKind,
  basename: string,
): Promise<string | null> {
  if (!isTauri) return null
  try {
    return await readSettingsFile(
      historyDirFor(kind),
      historyFilename(basename),
    )
  } catch {
    return null
  }
}

export async function writeHistorySidecar(
  kind: HistoryKind,
  basename: string,
  content: string,
): Promise<void> {
  if (!isTauri) return
  return writeSettingsFile(
    historyDirFor(kind),
    historyFilename(basename),
    content,
  )
}

export async function deleteHistorySidecar(
  kind: HistoryKind,
  basename: string,
): Promise<void> {
  if (!isTauri) return
  try {
    await deleteSettingsFile(historyDirFor(kind), historyFilename(basename))
  } catch {
    // 存在しないだけのときは無視
  }
}

export async function deleteAiSessionFile(filename: string): Promise<void> {
  return deleteSettingsFile(SESSIONS_DIR, filename)
}

// --- Widget helpers ---

const WIDGETS_DIR = 'widgets'
const WIDGET_SRC_EXT = '.is'
const WIDGET_META_EXT = '.meta.json5'

export function widgetSrcFilename(name: string): string {
  return sanitizeFilename(name) + WIDGET_SRC_EXT
}

export function widgetMetaFilename(name: string): string {
  return sanitizeFilename(name) + WIDGET_META_EXT
}

export async function listWidgetFiles(): Promise<string[]> {
  return listSettingsFiles(WIDGETS_DIR)
}

export async function readWidgetFile(filename: string): Promise<string> {
  return readSettingsFile(WIDGETS_DIR, filename)
}

export async function writeWidgetFile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(WIDGETS_DIR, filename, content)
}

export async function deleteWidgetFile(filename: string): Promise<void> {
  return deleteSettingsFile(WIDGETS_DIR, filename)
}

export async function renameWidgetFile(
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  return renameSettingsFile(WIDGETS_DIR, oldFilename, newFilename)
}
