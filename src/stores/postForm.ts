import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import defaultPostFormJson5 from '@/defaults/postform.json5?raw'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { isTauri, readPostForm, writePostForm } from '@/utils/settingsFs'

export type PostFormButtonId =
  | 'attach'
  | 'poll'
  | 'cw'
  | 'hashtag'
  | 'mention'
  | 'mfm'
  | 'draft'
  | 'clear'
  | 'emoji'

export const POST_FORM_BUTTON_META: Record<
  PostFormButtonId,
  { icon: string; label: string }
> = {
  emoji: { icon: 'mood-happy', label: '絵文字' },
  attach: { icon: 'photo-plus', label: '添付' },
  poll: { icon: 'chart-arrows', label: '投票' },
  cw: { icon: 'eye-off', label: '閲覧注意' },
  hashtag: { icon: 'hash', label: 'ハッシュタグ' },
  mention: { icon: 'at', label: 'メンション' },
  mfm: { icon: 'palette', label: 'MFM' },
  draft: { icon: 'notes', label: '下書き' },
  clear: { icon: 'trash', label: 'クリア' },
}

export const ALL_POST_FORM_BUTTONS = Object.keys(
  POST_FORM_BUTTON_META,
) as PostFormButtonId[]

export const DEFAULT_POST_FORM_BUTTONS: PostFormButtonId[] =
  JSON5.parse(defaultPostFormJson5)

function sanitize(items: unknown): PostFormButtonId[] {
  if (!Array.isArray(items)) return [...DEFAULT_POST_FORM_BUTTONS]
  const seen = new Set<PostFormButtonId>()
  const out: PostFormButtonId[] = []
  for (const raw of items) {
    if (typeof raw !== 'string') continue
    if (!ALL_POST_FORM_BUTTONS.includes(raw as PostFormButtonId)) continue
    const id = raw as PostFormButtonId
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export const usePostFormStore = defineStore('postForm', () => {
  const buttons = ref<PostFormButtonId[]>([...DEFAULT_POST_FORM_BUTTONS])
  const isCustomized = ref(false)

  const { schedule: schedulePersist, cancel: cancelPersist } =
    createDebouncedPersist(persistNow)

  function persistNow() {
    if (!isTauri) return
    const content = JSON5.stringify(buttons.value, null, 2)
    writePostForm(content).catch((e) =>
      console.warn('[postForm] failed to persist:', e),
    )
  }

  /** debounce を待たず即時書き込み (ペンディングは破棄) */
  function flushPersist() {
    cancelPersist()
    persistNow()
  }

  function setButtons(items: PostFormButtonId[] | undefined) {
    if (items == null) {
      buttons.value = [...DEFAULT_POST_FORM_BUTTONS]
      isCustomized.value = false
      if (isTauri) {
        writePostForm('').catch((e) =>
          console.warn('[postForm] failed to clear:', e),
        )
      }
    } else {
      buttons.value = sanitize(items)
      isCustomized.value = true
      schedulePersist()
    }
  }

  async function init() {
    if (!isTauri) return
    try {
      const content = await readPostForm()
      if (content?.trim()) {
        const parsed = JSON5.parse(content)
        const clean = sanitize(parsed)
        if (clean.length > 0) {
          buttons.value = clean
          isCustomized.value = true
        }
      }
    } catch (e) {
      console.warn('[postForm] failed to init:', e)
    }
  }

  return {
    buttons,
    isCustomized,
    setButtons,
    flushPersist,
    init,
  }
})
