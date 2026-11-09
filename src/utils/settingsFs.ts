import type { SettingsChange, VersionedText } from '@/bindings'
import { emitTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

export const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

/**
 * この WebView の Tauri window label。Tauri 外 (ブラウザの Dev Dashboard /
 * vitest) では null。`@tauri-apps/api` の `getCurrentWindow()` と同じ場所を
 * 同期で読む (import を増やさない)。
 */
export function currentWindowLabel(): string | null {
  if (!isTauri) return null
  const internals = (
    window as {
      __TAURI_INTERNALS__?: {
        metadata?: { currentWindow?: { label?: string } }
      }
    }
  ).__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label ?? null
}

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

/** このウィンドウの印。自分の書込通知を自分で受け取らないために payload に載せる */
export const SETTINGS_FS_SOURCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * デバイス発の設定ファイル書込を他ウィンドウへ知らせる (#1042)。notecore 発の
 * 書込は Rust が `nd:settings-file-changed` を全ウィンドウへ流すが、デバイス発
 * (store 自身の永続化) は Rust が通知しない (自分の写しは自分で更新している)。
 * 代わりに書いたウィンドウが JS → JS で流し、受け手 (`useSettingsFileSync`) は
 * 自分の sourceId を捨てて残りを notecore 発と同じ配線表に配る。これが
 * ウィンドウ間同期の唯一の経路で、localStorage のミラーはもう使わない
 */
function announce(
  subdir: string | null,
  name: string,
  op: SettingsChange['op'],
) {
  emitTauri('nd:settings-file-written', {
    sourceId: SETTINGS_FS_SOURCE_ID,
    change: { subdir, name, op },
  }).catch(() => {
    // 通知の失敗で書込自体を失敗にはしない
  })
}

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
  unwrap(await commands.writeSettingsFile(subdir, name, content, null))
  announce(subdir, name, 'write')
}

/**
 * 条件付き書込 (#1106): `expected` は読んだときの版で、その間に別の書き手
 * (notecore の AI / 別のデバイス) が変えていれば CONFLICT で拒まれる。
 * 戻り値は書いた後の版
 */
export async function writeSettingsFileIf(
  subdir: string,
  name: string,
  content: string,
  expected: string | null,
): Promise<string> {
  if (!isTauri) return ''
  const version = unwrap(
    await commands.writeSettingsFile(subdir, name, content, expected),
  )
  announce(subdir, name, 'write')
  return version
}

export async function deleteSettingsFile(
  subdir: string,
  name: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.deleteSettingsFile(subdir, name))
  announce(subdir, name, 'delete')
}

export async function renameSettingsFile(
  subdir: string,
  oldName: string,
  newName: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(await commands.renameSettingsFile(subdir, oldName, newName))
  // 新名の write → 旧名の delete の順。受け手は対応表 (fileBase) で個体を
  // 引くので、先に新名へ移してから旧名を消せば同じ個体を消してしまわない
  announce(subdir, newName, 'write')
  announce(subdir, oldName, 'delete')
}

export async function getSettingsDir(): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.getSettingsDir())
}

export async function getLogDir(): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.getLogDir())
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
export const PROFILE_EXT = '.ndprofile.json5'

/** profiles/ の実列挙 (履歴 .history.json5 を含む。#913 の占有判定・sweep 用)。 */
export async function listProfileDirFiles(): Promise<string[]> {
  return listSettingsFiles(PROFILES_DIR)
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

// --- この機械の状態 (#1333 §3) ---

/** デッキプロファイルの状態 `state/deck/` (論理 subdir `deck-state`) */
const DECK_STATE_DIR = 'deck-state'

export async function listDeckStateFiles(): Promise<string[]> {
  return listSettingsFiles(DECK_STATE_DIR)
}

export async function readDeckState(filename: string): Promise<string> {
  return readSettingsFile(DECK_STATE_DIR, filename)
}

export async function writeDeckState(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(DECK_STATE_DIR, filename, content)
}

export async function deleteDeckState(filename: string): Promise<void> {
  return deleteSettingsFile(DECK_STATE_DIR, filename)
}

/** UI の状態 `state/ui.json5`。root 配下だが、状態は窓間で揃えるので書込を知らせる */
const UI_STATE_FILE = 'ui.json5'

export async function readUiState(): Promise<string> {
  return readRootSettingsFile(UI_STATE_FILE)
}

export async function writeUiState(content: string): Promise<void> {
  await writeRootSettingsFile(UI_STATE_FILE, content)
  announce(null, UI_STATE_FILE, 'write')
}

// --- Root-level file operations ---

async function readRootSettingsFile(name: string): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.readRootSettingsFile(name))
}

/** 版つきで読む (丸ごと書き戻す store は次の書込にこの版を添える, #1106) */
async function readRootSettingsFileVersioned(
  name: string,
): Promise<VersionedText> {
  if (!isTauri) return { content: '', version: '' }
  return unwrap(await commands.readRootSettingsFileVersioned(name))
}

/** `expected` があれば条件付き。戻り値は書いた後の版 */
async function writeRootSettingsFile(
  name: string,
  content: string,
  expected: string | null = null,
): Promise<string> {
  if (!isTauri) return ''
  return unwrap(await commands.writeRootSettingsFile(name, content, expected))
}

// --- Theme-specific helpers ---

const THEMES_DIR = 'themes'
export const THEME_EXT = '.ndtheme.json5'

/** themes/ の実列挙 (履歴 .history.json5 を含む。#913 の占有判定・sweep 用)。 */
export async function listThemeDirFiles(): Promise<string[]> {
  return listSettingsFiles(THEMES_DIR)
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
  await writeRootSettingsFile('custom.css', css)
}

// --- Keybinds helpers ---

export async function readKeybinds(): Promise<string> {
  return readRootSettingsFile('keybinds.json5')
}

export async function writeKeybinds(content: string): Promise<void> {
  await writeRootSettingsFile('keybinds.json5', content)
}

// --- AI settings helpers ---

export async function readAiSettings(): Promise<string> {
  return readRootSettingsFile('ai.json5')
}

export async function readAiSettingsVersioned(): Promise<VersionedText> {
  return readRootSettingsFileVersioned('ai.json5')
}

export async function writeAiSettings(
  content: string,
  expected: string | null = null,
): Promise<string> {
  return writeRootSettingsFile('ai.json5', content, expected)
}

// --- Permissions helpers (#712) ---

export async function readPermissionsSettingsVersioned(): Promise<VersionedText> {
  return readRootSettingsFileVersioned('permissions.json5')
}

export async function writePermissionsSettings(
  content: string,
  expected: string | null = null,
): Promise<string> {
  return writeRootSettingsFile('permissions.json5', content, expected)
}

/** この機械の権限の状態 (`state/permissions-meta.json5`、#1333 §4) */
export async function readPermissionsMeta(): Promise<string> {
  return readRootSettingsFile('permissions-meta.json5')
}

export async function writePermissionsMeta(content: string): Promise<void> {
  await writeRootSettingsFile('permissions-meta.json5', content)
}

// --- Tasks helpers ---

export async function readTasks(): Promise<string> {
  return readRootSettingsFile('tasks.json5')
}

export async function readTasksVersioned(): Promise<VersionedText> {
  return readRootSettingsFileVersioned('tasks.json5')
}

export async function writeTasks(
  content: string,
  expected: string | null = null,
): Promise<string> {
  return writeRootSettingsFile('tasks.json5', content, expected)
}

// --- Theme drop-in adoption record (#1041) ---

export async function readThemeDropInRecordVersioned(): Promise<VersionedText> {
  return readRootSettingsFileVersioned('theme-dropins.json5')
}

export async function writeThemeDropInRecord(
  content: string,
  expected: string | null = null,
): Promise<string> {
  return writeRootSettingsFile('theme-dropins.json5', content, expected)
}

// --- Locale helpers (#135) ---

export async function readLocaleSettingFile(): Promise<string> {
  return readRootSettingsFile('locale.json5')
}

export async function writeLocaleSettingFile(content: string): Promise<void> {
  await writeRootSettingsFile('locale.json5', content)
}

// --- Client config helpers (#1106 段階 3a) ---

export async function readClientConfigFile(): Promise<string> {
  return readRootSettingsFile('client.json5')
}

export async function writeClientConfigFile(content: string): Promise<void> {
  await writeRootSettingsFile('client.json5', content)
}

// --- Tutorial helpers (#1029) ---

export async function readTutorialProgress(): Promise<string> {
  return readRootSettingsFile('tutorial.json5')
}

export async function writeTutorialProgress(content: string): Promise<void> {
  await writeRootSettingsFile('tutorial.json5', content)
}

// --- Navbar helpers ---

export async function readNavbar(): Promise<string> {
  return readRootSettingsFile('navbar.json5')
}

export async function writeNavbar(content: string): Promise<void> {
  await writeRootSettingsFile('navbar.json5', content)
}

// --- Post form button order helpers ---

export async function readPostForm(): Promise<string> {
  return readRootSettingsFile('postform.json5')
}

export async function writePostForm(content: string): Promise<void> {
  await writeRootSettingsFile('postform.json5', content)
}

// --- Performance helpers ---

export async function readPerformance(): Promise<string> {
  return readRootSettingsFile('performance.json5')
}

export async function writePerformance(content: string): Promise<void> {
  await writeRootSettingsFile('performance.json5', content)
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
export const SKILL_EXT = '.md'

/** skills/ の実列挙 (履歴 .history.json5 を含む。#913 の占有判定・sweep 用)。 */
export async function listSkillDirFiles(): Promise<string[]> {
  return listSettingsFiles(SKILLS_DIR)
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

// --- Edit history sidecar helpers (skill / widget / plugin / theme) ---
//
// 各 kind の編集前 snapshot をリングで `state/history/<subdir|root>/<basename>.history.json5`
// に保存する (#1334 段階 2。設定の隣ではなく、この機械の状態)。置き場を知るのは Rust の
// `settings_store::history_path` だけで、ここは scope (論理 subdir) と basename を渡す。
// Tauri 外 (ブラウザ) では呼んでも no-op。

export type HistoryKind =
  | 'skill'
  | 'widget'
  | 'plugin'
  | 'theme'
  | 'css'
  | 'memo'
  | 'query'

// css は root 直下の単一ファイル (custom.css) なので subdir を持たない。
// 他 kind と異なり historyDirFor の対象外 (sidecar も root に置く)。
function historyDirFor(kind: Exclude<HistoryKind, 'css'>): string {
  switch (kind) {
    case 'skill':
      return SKILLS_DIR
    case 'widget':
      return WIDGETS_DIR
    case 'plugin':
      return PLUGINS_DIR
    case 'theme':
      return THEMES_DIR
    case 'memo':
      return MEMOS_DIR
    case 'query':
      return QUERIES_DIR
  }
}

/** 履歴の scope (論理 subdir)。css は root 直下の単一ファイルなので null */
function historyScopeFor(kind: HistoryKind): string | null {
  return kind === 'css' ? null : historyDirFor(kind)
}

export async function readHistorySidecar(
  kind: HistoryKind,
  basename: string,
): Promise<string | null> {
  if (!isTauri) return null
  try {
    const text = unwrap(
      await commands.readHistorySidecar(historyScopeFor(kind), basename),
    )
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/** 履歴の書込。他のウィンドウには知らせない (履歴の表示は都度読む、#1334 段階 2) */
export async function writeHistorySidecar(
  kind: HistoryKind,
  basename: string,
  content: string,
): Promise<void> {
  if (!isTauri) return
  unwrap(
    await commands.writeHistorySidecar(
      historyScopeFor(kind),
      basename,
      content,
    ),
  )
}

export async function deleteHistorySidecar(
  kind: HistoryKind,
  basename: string,
): Promise<void> {
  if (!isTauri) return
  try {
    unwrap(await commands.deleteHistorySidecar(historyScopeFor(kind), basename))
  } catch {
    // 存在しないだけのときは無視
  }
}

// --- Widget helpers ---

const WIDGETS_DIR = 'widgets'

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

// --- Column query helpers (#783 Phase 1.5) ---

const QUERIES_DIR = 'queries'

export async function listQueryFiles(): Promise<string[]> {
  return listSettingsFiles(QUERIES_DIR)
}

export async function readQueryFile(filename: string): Promise<string> {
  return readSettingsFile(QUERIES_DIR, filename)
}

export async function writeQueryFile(
  filename: string,
  content: string,
): Promise<void> {
  return writeSettingsFile(QUERIES_DIR, filename, content)
}

export async function deleteQueryFile(filename: string): Promise<void> {
  return deleteSettingsFile(QUERIES_DIR, filename)
}

export async function renameQueryFile(
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  return renameSettingsFile(QUERIES_DIR, oldFilename, newFilename)
}
