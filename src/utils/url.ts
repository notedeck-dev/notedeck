import { isSafeUrl } from '@/services/safeUrl'

/** 安全な URL だけ Tauri の opener で開く (判定は services/safeUrl)。 */
export async function openSafeUrl(
  url: string | null | undefined,
): Promise<void> {
  if (!url || !isSafeUrl(url)) return
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}
