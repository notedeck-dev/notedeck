import type { Command } from '@/commands/registry'
import { implement } from '../declare'

/**
 * Clipboard 系 capability — ユーザーがコピーしたテキストを AI / プラグイン
 * パイプラインに供給する経路。Mk:dialog にテキスト入力 prompt が無い問題を
 * 回避し、「コピー → コマンドパレットで実行 → 結果通知」フローを成立させる。
 *
 * 既存 PermissionKey `clipboard` を使う (safe preset で true)。
 * `navigator.clipboard.*` への薄いラッパだが、permission gate を通すことで
 * AI / プラグインが勝手にクリップボード内容を盗む経路を防ぐ。
 */

export const clipboardReadCapability = implement('clipboard.read', {
  execute: async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('clipboard.read: navigator.clipboard is not available')
    }
    const text = await navigator.clipboard.readText()
    return { text }
  },
})

export const clipboardWriteCapability = implement('clipboard.write', {
  execute: async (params) => {
    const text = typeof params?.text === 'string' ? params.text : ''
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('clipboard.write: navigator.clipboard is not available')
    }
    await navigator.clipboard.writeText(text)
    return { written: true, length: text.length }
  },
})

export const CLIPBOARD_BUILTIN_CAPABILITIES: readonly Command[] = [
  clipboardReadCapability,
  clipboardWriteCapability,
]
