import { commands } from '@/utils/tauriInvoke'
import type { DriveApi, NormalizedDriveFile } from '../../types'
import { type MisskeyApiContext, unwrapAny } from './context'

/** Misskey `drive/files/show` 等の生レスポンス（NormalizedDriveFile の superset）。 */
export interface DriveFileRaw {
  id: string
  name: string
  type: string
  url: string
  thumbnailUrl: string | null
  size: number
  isSensitive: boolean
  comment?: string | null
  properties?: { width?: number | null; height?: number | null } | null
  blurhash?: string | null
}

export function normalizeDriveFile(raw: DriveFileRaw): NormalizedDriveFile {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    url: raw.url,
    thumbnailUrl: raw.thumbnailUrl ?? null,
    size: raw.size,
    isSensitive: raw.isSensitive,
    comment: raw.comment ?? null,
    width: raw.properties?.width ?? null,
    height: raw.properties?.height ?? null,
    blurhash: raw.blurhash ?? null,
  }
}

export function createDriveApi(ctx: MisskeyApiContext): DriveApi {
  return {
    async uploadFile(
      fileName: string,
      fileData: number[],
      contentType: string,
      isSensitive = false,
      folderId: string | null = null,
    ): Promise<NormalizedDriveFile> {
      ctx.requireAuth()
      return unwrapAny(
        await commands.apiUploadFile(
          ctx.accountId,
          fileName,
          fileData,
          contentType,
          isSensitive,
          folderId,
        ),
      )
    },

    async uploadFileFromPath(
      filePath: string,
      isSensitive = false,
      folderId: string | null = null,
    ): Promise<NormalizedDriveFile> {
      ctx.requireAuth()
      return unwrapAny(
        await commands.apiUploadFileFromPath(
          ctx.accountId,
          filePath,
          isSensitive,
          folderId,
        ),
      )
    },
  }
}
