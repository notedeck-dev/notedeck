import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Principal } from '@/permissions/principal'

/**
 * AiScript 実行ログ集約 (#710)。
 *
 * 全実行文脈 (プラグイン / ウィジェット / Play / Page / スクラッチパッド) の
 * print 出力・実行時エラー・ライフサイクルイベントを source 別の in-memory
 * リングに集約する (永続化しない)。capability `aiscript.logs` から AI が
 * 読み取り、「書く → 保存で実行 → 結果を読んで修正」のループを閉じる。
 * プラグイン管理 UI の Logs タブもここを読む (読み口の一本化)。
 */

export type AiScriptSourceKind =
  | 'plugin'
  | 'widget'
  | 'play'
  | 'page'
  | 'playground'

export type AiScriptLogLevel = 'print' | 'error' | 'system'

export interface AiScriptLogEntry {
  /** Unix ms */
  at: number
  /** 全 source 横断の単調増加連番 (recent のマージ順序に使う) */
  seq: number
  source: AiScriptSourceKind
  /** installId / Play・Page の id / スクラッチパッドのカラム id */
  sourceId: string
  /** 表示名 (プラグイン名等、分かる範囲で) */
  name?: string
  /** 実行ごとの通し番号 (beginRun で採番) */
  runId: number
  level: AiScriptLogLevel
  message: string
}

/** 1 実行分の書き込み口。配線側は onOutput/onError からこれに tee する */
export interface AiScriptRunLogger {
  runId: number
  print: (text: string) => void
  error: (text: string) => void
  system: (text: string) => void
}

export interface AiScriptLogFilter {
  source?: AiScriptSourceKind | 'all'
  sourceId?: string
  level?: AiScriptLogLevel | 'all'
  limit?: number
}

/** source 別リング上限。超えたら古い方から破棄する */
const RING_SIZE = 200
const MAX_MESSAGE_LENGTH = 1000

/**
 * principal から log source を導出する。principal の pluginId は
 * `widget:<id>` / `play:<id>` / `page:<id>` / 素の installId (プラグイン)
 * という既存規約 (principal.ts) をそのまま流用する。
 */
export function logSourceOfPrincipal(principal: Principal): {
  source: AiScriptSourceKind
  sourceId: string
  name?: string
} {
  if (principal.kind !== 'plugin') return { source: 'playground', sourceId: '' }
  const { pluginId, name } = principal
  const m = pluginId.match(/^(widget|play|page):(.*)$/)
  if (m)
    return {
      source: m[1] as AiScriptSourceKind,
      sourceId: m[2] ?? '',
      ...(name ? { name } : {}),
    }
  return { source: 'plugin', sourceId: pluginId, ...(name ? { name } : {}) }
}

export const useAiScriptLogsStore = defineStore('aiscriptLogs', () => {
  const rings = ref<Map<string, AiScriptLogEntry[]>>(new Map())
  let seqCounter = 0
  let runCounter = 0

  function record(
    source: AiScriptSourceKind,
    sourceId: string,
    name: string | undefined,
    runId: number,
    level: AiScriptLogLevel,
    message: string,
  ) {
    const key = `${source}:${sourceId}`
    let ring = rings.value.get(key)
    if (!ring) {
      ring = []
      rings.value.set(key, ring)
    }
    ring.push({
      at: Date.now(),
      seq: ++seqCounter,
      source,
      sourceId,
      runId,
      level,
      message:
        message.length > MAX_MESSAGE_LENGTH
          ? `${message.slice(0, MAX_MESSAGE_LENGTH)}… (truncated)`
          : message,
      ...(name ? { name } : {}),
    })
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE)
  }

  /** 実行開始を宣言して runId を採番し、system "started" を記録する */
  function beginRun(
    source: AiScriptSourceKind,
    sourceId: string,
    name?: string,
  ): AiScriptRunLogger {
    const runId = ++runCounter
    const logger: AiScriptRunLogger = {
      runId,
      print: (text) => record(source, sourceId, name, runId, 'print', text),
      error: (text) => record(source, sourceId, name, runId, 'error', text),
      system: (text) => record(source, sourceId, name, runId, 'system', text),
    }
    logger.system('started')
    return logger
  }

  /** UI 表示用: 指定 source の全エントリ (古い順) */
  function entriesFor(
    source: AiScriptSourceKind,
    sourceId: string,
  ): AiScriptLogEntry[] {
    return rings.value.get(`${source}:${sourceId}`) ?? []
  }

  /** capability 用: フィルタして新しい順に返す */
  function recent(filter: AiScriptLogFilter = {}): AiScriptLogEntry[] {
    const source = filter.source ?? 'all'
    const level = filter.level ?? 'all'
    const limit = Math.max(1, Math.min(filter.limit ?? 50, RING_SIZE))
    const matched: AiScriptLogEntry[] = []
    for (const ring of rings.value.values()) {
      for (const e of ring) {
        if (source !== 'all' && e.source !== source) continue
        if (filter.sourceId && e.sourceId !== filter.sourceId) continue
        if (level !== 'all' && e.level !== level) continue
        matched.push(e)
      }
    }
    matched.sort((a, b) => b.seq - a.seq)
    return matched.slice(0, limit)
  }

  function clear() {
    rings.value = new Map()
  }

  return { beginRun, entriesFor, recent, clear }
})
