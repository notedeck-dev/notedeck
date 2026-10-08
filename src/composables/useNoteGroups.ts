import { computed } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import type { VisibilityOpts } from '@/composables/useNoteVisibility'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import {
  buildNoteGroups,
  isGroupHidden,
  type NoteGroup,
  type NoteGroupContext,
} from '@/services/noteGroup'
import { useAccountsStore } from '@/stores/accounts'
import { useNoteStore } from '@/stores/notes'

/**
 * 束ね (#1058) の文脈をストアから組み立てる。純関数 `noteGroup` はストアに
 * 依存しないので、ここが唯一の接続点。
 */
export function useNoteGroupContext(opts?: VisibilityOpts) {
  const accountsStore = useAccountsStore()
  const noteStore = useNoteStore()
  const visibility = useNoteVisibility()

  const context = computed<NoteGroupContext>(() => ({
    accountOrder: accountsStore.accounts.map((a) => a.id),
    hasToken: (id) => accountsStore.accountMap.get(id)?.hasToken ?? false,
    userIdOf: (id) => accountsStore.accountMap.get(id)?.userId,
    isDeletedAtOrigin: (identity) => noteStore.isDeletedAtOrigin(identity),
    isDeleted: (key) => noteStore.isDeleted(key),
    isSuspended: (note) =>
      opts?.ignoreSuspension ? false : visibility.isSuspendedNote(note),
    isUserHidden: (note) => visibility.isUserHidden(note, opts),
  }))

  // 前回の group を行キーごとに覚え、variants が同じ参照の並びなら同じ
  // オブジェクトを返す。毎回作り直すと、どのノートの更新でも全行の `group`
  // prop が変わり、表示中の MkNote がすべて再描画される
  let prevByRowKey = new Map<string, NoteGroup>()

  function reuse(group: NoteGroup): NoteGroup {
    const prev = prevByRowKey.get(group.rowKey)
    if (
      prev &&
      prev.variants.length === group.variants.length &&
      prev.variants.every((v, i) => v === group.variants[i])
    ) {
      return prev
    }
    return group
  }

  /** 未フィルタの variant 列を畳み、可視な group だけを返す */
  function groupsOf(notes: readonly NormalizedNote[]): NoteGroup[] {
    const ctx = context.value
    const groups = buildNoteGroups(notes, ctx).map(reuse)
    prevByRowKey = new Map(groups.map((g) => [g.rowKey, g]))
    return groups.filter((g) => !isGroupHidden(g, ctx))
  }

  return { context, groupsOf }
}
