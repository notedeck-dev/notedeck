/**
 * 人格と記憶のファイル (SOUL / USER / MEMORY / BOOTSTRAP) の写し (#1162 段階 4 UI)。
 *
 * 正本と書込は notemaid で、ここは RPC の写しと読み直しだけ。項目単位の編集は
 * 写しの本文を手元で編んで (`services/aiWorkspaceEdit`) 全文を書き戻す。
 * 変更通知 (`subdir: 'notemaid'`) で一覧を読み直す (AI の `memory.update` や
 * 外部エディタの変更もここで追従する)。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { WorkspaceFile, Kind as WorkspaceKind } from '@/bindings'
import {
  type EditableWorkspaceKind,
  forgetAll as forgetAllBody,
  removeEntry as removeEntryBody,
  replaceEntry as replaceEntryBody,
} from '@/services/aiWorkspaceEdit'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import { isTauri } from '@/utils/settingsFs'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { useAiConfig } from './useAiConfig'

export type { WorkspaceKind }

const files = ref<WorkspaceFile[]>([])
const loaded = ref(false)
let subscribed = false

async function refresh(): Promise<void> {
  try {
    files.value = unwrap(await commands.maidWorkspaceList())
    loaded.value = true
  } catch (e) {
    console.warn('[ai-workspace] list failed:', e)
  }
}

function fileOf(kind: WorkspaceKind): WorkspaceFile | undefined {
  return files.value.find((f) => f.kind === kind)
}

/** 全文を書く。notemaid が上限 / 不可視 Unicode を検査し、通れば写しを揃える */
async function write(
  kind: WorkspaceKind,
  body: string,
): Promise<WorkspaceFile> {
  const next = unwrap(await commands.maidWorkspaceWrite(kind, body))
  files.value = files.value.some((f) => f.kind === kind)
    ? files.value.map((f) => (f.kind === kind ? next : f))
    : [...files.value, next]
  return next
}

/**
 * 「あなたのことを覚える」。ai.json5 は notemaid が書き、デバイスは変更通知で
 * 追従するが、トグルの見た目だけ先に揃える
 */
async function setUserMemory(enabled: boolean): Promise<void> {
  const { config } = useAiConfig()
  const prev = config.value.userMemory
  config.value.userMemory = enabled
  try {
    unwrap(await commands.maidUserMemorySet(enabled))
  } catch (e) {
    config.value.userMemory = prev
    throw e
  }
  // OFF で BOOTSTRAP が消えるので一覧を揃える
  await refresh()
}

/** 写しが古くて項目が見つからなければ読み直すだけ (次の描画で消える / 揃う) */
async function editEntries(
  kind: EditableWorkspaceKind,
  edit: (body: string) => string | null,
): Promise<void> {
  const file = fileOf(kind)
  if (!file) return
  const next = edit(file.body)
  if (next === null) {
    await refresh()
    return
  }
  await write(kind, next)
}

function removeEntry(kind: EditableWorkspaceKind, entryText: string) {
  return editEntries(kind, (body) => removeEntryBody(kind, body, entryText))
}

function replaceEntry(
  kind: EditableWorkspaceKind,
  oldText: string,
  newText: string,
) {
  return editEntries(kind, (body) =>
    replaceEntryBody(kind, body, oldText, newText),
  )
}

async function forgetAll(kind: EditableWorkspaceKind): Promise<void> {
  const file = fileOf(kind)
  if (!file) return
  await write(kind, forgetAllBody(file.body))
}

export function useAiWorkspace() {
  if (!subscribed) {
    subscribed = true
    if (isTauri) {
      void refresh()
      registerSettingsFileHandler('notemaid', () => refresh())
    }
  }
  return {
    files: computed(() => files.value),
    loaded: computed(() => loaded.value),
    refresh,
    fileOf,
    write,
    setUserMemory,
    removeEntry,
    replaceEntry,
    forgetAll,
  }
}

/**
 * 新品のワークスペースに notemaid が置く BOOTSTRAP.md (first-run ritual) が
 * まだあるか (AI カラムの初回の挨拶に使う)。人格か記憶が変わるか「あなたのことを覚える」が
 * OFF になると notemaid が消すので、`notemaid` 配下の変更通知で読み直す。
 * notemaid に届かない (起動直後 / sidecar 停止中) ときは false
 */
export function useBootstrapPending() {
  const pending = ref(false)

  async function refreshPending(): Promise<void> {
    try {
      const list = unwrap(await commands.maidWorkspaceList())
      pending.value = list.some((f) => f.kind === 'bootstrap' && f.exists)
    } catch {
      pending.value = false
    }
  }

  let unregister: (() => void) | null = null
  onMounted(() => {
    void refreshPending()
    unregister = registerSettingsFileHandler('notemaid', () => refreshPending())
  })
  onUnmounted(() => {
    unregister?.()
    unregister = null
  })

  return { pending, refresh: refreshPending }
}

/**
 * そのターンで notemaid が送った system prompt (開発者モードの「この応答に送った指示」)。
 * notemaid は直近の数ターン分しかメモリに残さないので、消えていれば null。ここでも保存しない
 */
export async function fetchTurnSystem(turnId: string): Promise<string | null> {
  const v = unwrap(await commands.maidTurnSystem(turnId))
  return typeof v === 'string' ? v : null
}
