import type { ExifField } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** リモート画像を手元で扱う口 (#1258)。取得は Rust 側の SSRF ポリシーを通る */
export function saveImageToFile(url: string): Promise<boolean> {
  return commands.saveImageToFile(url).then(unwrap)
}

export function readImageExif(url: string): Promise<ExifField[]> {
  return commands.readImageExif(url).then(unwrap)
}

/** data URL 用の base64。取れなければ null */
export function fetchImageBase64(url: string): Promise<string | null> {
  return commands.fetchImageBase64(url).then(unwrap)
}
