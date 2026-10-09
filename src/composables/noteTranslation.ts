/**
 * ノートの翻訳 (#704)。本家のノートメニューの「翻訳」と同じく、サーバーの
 * `notes/translate` (サーバーが持つ DeepL 等) に頼む。端末側で訳すことはしない。
 *
 * 出せるかどうかは本家と同じ条件 (meta の translatorAvailable と、ロールの
 * canUseTranslator)。アカウントごとに一度だけ問い合わせて覚える。
 */
import { commands, unwrap } from '@/utils/tauriInvoke'

export interface NoteTranslation {
  sourceLang: string
  text: string
}

const availability = new Map<string, Promise<boolean>>()

async function fetchTranslatorAvailable(accountId: string): Promise<boolean> {
  try {
    const [meta, policies] = await Promise.all([
      commands.apiGetMetaDetail(accountId).then(unwrap),
      commands.apiGetUserPolicies(accountId).then(unwrap),
    ])
    return (
      (meta as { translatorAvailable?: unknown } | null)
        ?.translatorAvailable === true &&
      (policies as { canUseTranslator?: unknown } | null)?.canUseTranslator ===
        true
    )
  } catch {
    return false
  }
}

export function loadTranslatorAvailable(accountId: string): Promise<boolean> {
  let p = availability.get(accountId)
  if (!p) {
    p = fetchTranslatorAvailable(accountId)
    availability.set(accountId, p)
  }
  return p
}

/** テスト用: キャッシュを捨てる */
export function resetTranslatorAvailabilityCache(): void {
  availability.clear()
}

export async function translateNote(
  accountId: string,
  noteId: string,
  targetLang: string,
): Promise<NoteTranslation> {
  const res = unwrap(
    await commands.apiRequest(accountId, 'notes/translate', {
      noteId,
      targetLang,
    }),
  ) as Partial<NoteTranslation> | null
  if (typeof res?.text !== 'string' || typeof res.sourceLang !== 'string') {
    throw new Error('notes/translate returned no translation')
  }
  return { sourceLang: res.sourceLang, text: res.text }
}
