/**
 * デッキプロファイルのファイル I/O 層 (#782)。themeFileSync と同役割。
 * 形式変換は deckProfileCodec、読込時のマイグレーション副作用の適用は
 * store 側の責務。
 */

import JSON5 from 'json5'
import { toFileFormat } from '@/services/deckProfileCodec'
import type { DeckProfile } from '@/stores/deck'
import * as settingsFs from '@/utils/settingsFs'

export interface ProfileFileEntry {
  filename: string
  data: Record<string, unknown>
}

/** 全プロファイルファイルを読み込む。パース失敗ファイルは warn してスキップ。 */
export async function loadProfileFileEntries(): Promise<ProfileFileEntry[]> {
  const filenames = await settingsFs.listProfiles()
  if (filenames.length === 0) return []

  const results = await Promise.all(
    filenames.map(async (filename) => {
      try {
        const content = await settingsFs.readProfile(filename)
        return {
          filename,
          data: JSON5.parse(content) as Record<string, unknown>,
        }
      } catch (e) {
        console.warn(`[deckProfile] failed to parse ${filename}:`, e)
        return null
      }
    }),
  )
  return results.filter((entry): entry is ProfileFileEntry => entry !== null)
}

/** Write only the given profile to its file. */
export async function persistProfileFile(profile: DeckProfile): Promise<void> {
  const filename = settingsFs.profileFilename(profile.name)
  const content = JSON5.stringify(toFileFormat(profile), null, 2)
  await settingsFs.writeProfile(filename, content)
}

/** Write all profiles to files. */
export async function persistAllProfileFiles(
  profiles: readonly DeckProfile[],
): Promise<void> {
  await Promise.all(profiles.map((p) => persistProfileFile(p)))
}
