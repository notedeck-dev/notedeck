import type { Command } from '@/commands/registry'
import { type LogLevel, useLogsStore } from '@/stores/logs'
import { implement } from '../declare'

/**
 * `logs.recent` — アプリ内 console.warn / console.error の最近のログを返す。
 * AI が自己修正・診断に使う (= 「最近のエラー教えて」が動く)。
 */
export const logsRecentCapability = implement('logs.recent', {
  execute: (params) => {
    const levelParam =
      typeof params?.level === 'string' ? params.level : 'error'
    const level: LogLevel | 'all' =
      levelParam === 'warn' || levelParam === 'all'
        ? (levelParam as LogLevel | 'all')
        : 'error'
    const limit = typeof params?.limit === 'number' ? params.limit : 20
    const store = useLogsStore()
    return store.recent(level, limit)
  },
})

export const LOGS_BUILTIN_CAPABILITIES: readonly Command[] = [
  logsRecentCapability,
]
