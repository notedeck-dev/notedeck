// 全テストの前に原文 (ja-JP) の辞書を読んでおく (#135)。実行時は main.ts が
// 起動待ちの中で読むので、テストでも「読んだ後」の状態から始める
import ja from 'virtual:nd-locale/ja-JP'
import { setLocale } from '@/i18n'

setLocale('ja-JP', ja)
