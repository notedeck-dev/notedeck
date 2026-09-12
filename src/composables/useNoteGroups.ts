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

  /** 未フィルタの variant 列を畳み、可視な group だけを返す */
  function groupsOf(notes: readonly NormalizedNote[]): NoteGroup[] {
    const ctx = context.value
    return buildNoteGroups(notes, ctx).filter((g) => !isGroupHidden(g, ctx))
  }

  return { context, groupsOf }
}
