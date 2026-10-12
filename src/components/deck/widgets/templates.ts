/**
 * AiScript App ウィジェットテンプレート
 *
 * テンプレート一覧とソースコードは misstore (https://store.notedeck.io) から配信される。
 * 実体は useMisStoreStore が持ち、ここはビュー向けの薄い整形層。
 */

import { computed } from 'vue'
import { type StoreWidgetEntry, useMisStoreStore } from '@/stores/misstore'

export interface WidgetTemplate {
  id: string
  label: string
  icon: string
  description: string
  autoRun: boolean
  capabilities: string[]
  entry: StoreWidgetEntry
}

function toTemplate(entry: StoreWidgetEntry): WidgetTemplate {
  return {
    id: entry.id,
    label: entry.name,
    icon: entry.icon,
    description: entry.description,
    autoRun: entry.autoRun,
    capabilities: entry.capabilities ?? [],
    entry,
  }
}

export function useWidgetTemplates() {
  const feed = useMisStoreStore().feed('widget')
  if (feed.entries.length === 0 && !feed.loading) {
    feed.fetch()
  }
  const templates = computed(() => feed.entries.map(toTemplate))
  const loaded = computed(() => feed.entries.length > 0 || feed.error !== null)
  const loading = computed(() => feed.loading)
  const error = computed(() => feed.error)
  return { templates, loaded, loading, error }
}

export function fetchWidgetCode(template: WidgetTemplate): Promise<string> {
  return useMisStoreStore().fetchWidgetSource(template.entry)
}
