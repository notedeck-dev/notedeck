import type { Command } from '@/commands/registry'

/**
 * Clipboard 系 capability — ユーザーがコピーしたテキストを AI / プラグイン
 * パイプラインに供給する経路。Mk:dialog にテキスト入力 prompt が無い問題を
 * 回避し、「コピー → コマンドパレットで実行 → 結果通知」フローを成立させる。
 *
 * 既存 PermissionKey `clipboard` を使う (safe preset で true)。
 * `navigator.clipboard.*` への薄いラッパだが、permission gate を通すことで
 * AI / プラグインが勝手にクリップボード内容を盗む経路を防ぐ。
 */

export const clipboardReadCapability: Command = {
  id: 'clipboard.read',
  label: 'クリップボードを読む',
  icon: 'ti-clipboard',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['clipboard'],
  signature: {
    description:
      'OS クリップボードのテキストを返す。プラグインが「コピーしたテキストを' +
      ' AI で処理」のような flow を実現するために使う。',
    params: {},
    returns: {
      type: 'object',
      description: '{ text: string }',
    },
    cheap: true,
  },
  visible: false,
  execute: async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('clipboard.read: navigator.clipboard is not available')
    }
    const text = await navigator.clipboard.readText()
    return { text }
  },
}

export const clipboardWriteCapability: Command = {
  id: 'clipboard.write',
  label: 'クリップボードに書き込む',
  icon: 'ti-clipboard-copy',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['clipboard'],
  signature: {
    description:
      'OS クリップボードに文字列を書き込む。AI が生成した訳文・要約を' +
      'ユーザーが他アプリへ貼り付けやすくするための出力経路。',
    params: {
      text: { type: 'string', description: 'クリップボードに書く文字列' },
    },
    returns: {
      type: 'object',
      description: '{ written: boolean, length: number }',
    },
  },
  visible: false,
  execute: async (params) => {
    const text = typeof params?.text === 'string' ? params.text : ''
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      throw new Error('clipboard.write: navigator.clipboard is not available')
    }
    await navigator.clipboard.writeText(text)
    return { written: true, length: text.length }
  },
}

export const CLIPBOARD_BUILTIN_CAPABILITIES: readonly Command[] = [
  clipboardReadCapability,
  clipboardWriteCapability,
]
