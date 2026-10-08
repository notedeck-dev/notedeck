import type { NormalizedNote } from '@/adapters/types'
import {
  type BuildPreviewNoteOptions,
  buildPreviewNote as buildPreviewNoteCore,
} from '@/services/previewNote'
import { getAccountAvatarUrl } from '@/stores/accounts'

/** accounts store の規則でアバターを埋める既定 deps つきの buildPreviewNote */
export function buildPreviewNote(
  opts: BuildPreviewNoteOptions,
): NormalizedNote {
  return buildPreviewNoteCore(opts, { accountAvatarUrl: getAccountAvatarUrl })
}
