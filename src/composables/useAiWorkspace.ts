/**
 * 人格と記憶のファイル (SOUL / USER / MEMORY / BOOTSTRAP) の写し (#1162 段階 4 UI)。
 *
 * 正本と書込は notemaid で、ここは RPC の写しと読み直しだけ。項目単位の編集は
 * 写しの本文を手元で編んで (`services/aiWorkspaceEdit`) 全文を書き戻す。
 * 変更通知 (`subdir: 'notemaid'`) で一覧を読み直す (AI の `memory.update` や
 * 外部エディタの変更もここで追従する)。
 */
import { computed, ref } from 'vue'
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
