import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'

const MAX_RECENT = 32

export const useRecentEmojisStore = defineStore('recentEmojis', () => {
  // host → emoji list. shallowRef avoids deep reactivity over nested arrays —
  // updates go through whole-object replacement in add().
  const map = shallowRef<Record<string, string[]>>(
    getStorageJson<Record<string, string[]>>(STORAGE_KEYS.recentEmojis, {}),
  )

  const { schedule: scheduleSave } = createDebouncedPersist(() =>
    setStorageJson(STORAGE_KEYS.recentEmojis, map.value),
  )

  function get(host: string): string[] {
    return map.value[host] ?? []
  }

  function add(host: string, emoji: string, pinnedList: string[]) {
    if (pinnedList.includes(emoji)) return
    const prev = map.value[host] ?? []
    const next = prev.filter((e) => e !== emoji)
    next.unshift(emoji)
    map.value = { ...map.value, [host]: next.slice(0, MAX_RECENT) }
    scheduleSave()
  }

  return { get, add }
})
