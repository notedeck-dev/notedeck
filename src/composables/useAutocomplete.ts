import { nextTick, type Ref, ref } from 'vue'
import type { NormalizedUser, ServerEmoji } from '@/adapters/types'
import { useEmojisStore } from '@/stores/emojis'
import { getCaretCoordinates } from '@/utils/caretPosition'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** ポップアップの想定幅 (px)。テキストエリア右端でのはみ出しクランプに使う */
const POPUP_WIDTH = 280

/** MFM function names supported by the renderer */
const mfmFunctionNames = [
  'flip',
  'jelly',
  'tada',
  'jump',
  'bounce',
  'spin',
  'shake',
  'twitch',
  'rainbow',
  'sparkle',
  'blur',
  'rotate',
  'scale',
  'position',
  'fg',
  'bg',
  'border',
  'font',
  'x2',
  'x3',
  'x4',
]

export type TriggerType = ':' | '@' | '#' | '$['

export interface AutocompleteState {
  type: TriggerType
  query: string
  triggerStart: number
  selectedIndex: number
}

export type AutocompleteCandidate = ServerEmoji | NormalizedUser | string

export function useAutocomplete(
  text: Ref<string>,
  textareaRef: Ref<HTMLTextAreaElement | null>,
  activeAccountId: Ref<string>,
  serverHost: Ref<string>,
) {
  const emojisStore = useEmojisStore()
  const autocompleteState = ref<AutocompleteState | null>(null)
  const candidates = ref<AutocompleteCandidate[]>([])
  const isSearching = ref(false)
  // ポップアップの表示位置 (textarea の親要素座標系)。caret 追従 (#753)
  const popupPosition = ref<{ left: number; top: number } | null>(null)
  let isComposing = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function onCompositionStart() {
    isComposing = true
  }

  function onCompositionEnd() {
    isComposing = false
    onTextInput()
  }

  function detectTrigger(
    value: string,
    cursorPos: number,
  ): { type: TriggerType; query: string; start: number } | null {
    // Scan backwards from cursor to find trigger character
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = value[i]

      // Space or newline means no trigger in this segment
      if (ch === ' ' || ch === '\n' || ch === '\t') return null

      // Check for $[ (2-char trigger)
      if (ch === '[' && i > 0 && value[i - 1] === '$') {
        const before = i - 1
        if (before > 0) {
          const prev = value[before - 1]
          if (prev !== ' ' && prev !== '\n' && prev !== '\t') return null
        }
        const query = value.slice(i + 1, cursorPos)
        return { type: '$[', start: before, query }
      }

      if (ch === ':' || ch === '@' || ch === '#') {
        // Validate: trigger must be at start of text, or preceded by whitespace/newline
        if (i > 0) {
          const prev = value[i - 1]
          if (prev !== ' ' && prev !== '\n' && prev !== '\t') return null
        }
        const query = value.slice(i + 1, cursorPos)
        return { type: ch as TriggerType, start: i, query }
      }
    }
    return null
  }

  function searchEmoji(query: string) {
    const q = query.toLowerCase()
    const allEmojis = emojisStore.getEmojiList(serverHost.value)
    const results: ServerEmoji[] = []
    const seen = new Set<string>()

    // Stage 1: exact match
    for (const e of allEmojis) {
      if (e.name === q) {
        seen.add(e.name)
        results.push(e)
      }
    }

    // Stage 2: startsWith
    if (results.length < 10) {
      for (const e of allEmojis) {
        if (seen.has(e.name)) continue
        if (e.name.startsWith(q) || e.aliases.some((a) => a.startsWith(q))) {
          seen.add(e.name)
          results.push(e)
          if (results.length >= 10) break
        }
      }
    }

    // Stage 3: includes
    if (results.length < 10) {
      for (const e of allEmojis) {
        if (seen.has(e.name)) continue
        if (e.name.includes(q) || e.aliases.some((a) => a.includes(q))) {
          seen.add(e.name)
          results.push(e)
          if (results.length >= 10) break
        }
      }
    }

    return results
  }

  function searchMfm(query: string): string[] {
    const q = query.toLowerCase()
    if (q.length === 0) return mfmFunctionNames.slice(0, 10)
    return mfmFunctionNames.filter((name) => name.startsWith(q)).slice(0, 10)
  }

  async function searchMention(query: string) {
    if (!activeAccountId.value) return []
    try {
      return unwrap(
        await commands.apiSearchUsersByQuery(activeAccountId.value, query, 10),
      ) as unknown as NormalizedUser[]
    } catch {
      return []
    }
  }

  async function searchHashtag(query: string) {
    if (!activeAccountId.value) return []
    try {
      return unwrap(
        await commands.apiSearchHashtags(activeAccountId.value, query, 10),
      )
    } catch {
      return []
    }
  }

  function onTextInput() {
    if (isComposing) return
    const textarea = textareaRef.value
    if (!textarea) return

    const trigger = detectTrigger(text.value, textarea.selectionStart)
    // $[ triggers with empty query (show all MFM functions), others need at least 1 char
    if (!trigger || (trigger.type !== '$[' && trigger.query.length === 0)) {
      autocompleteState.value = null
      candidates.value = []
      popupPosition.value = null
      return
    }

    autocompleteState.value = {
      type: trigger.type,
      query: trigger.query,
      triggerStart: trigger.start,
      selectedIndex: 0,
    }

    // caret (トリガー文字) の直下にポップアップを出す。右端でははみ出さない
    // よう左にクランプ。スクロール中の textarea では scrollTop を差し引く
    const caret = getCaretCoordinates(textarea, trigger.start)
    popupPosition.value = {
      left: Math.max(
        0,
        Math.min(
          textarea.offsetLeft + caret.left,
          textarea.offsetLeft + textarea.clientWidth - POPUP_WIDTH,
        ),
      ),
      top:
        textarea.offsetTop + caret.top + caret.height - textarea.scrollTop + 2,
    }

    if (debounceTimer) clearTimeout(debounceTimer)

    if (trigger.type === ':') {
      // Local search, no debounce needed
      candidates.value = searchEmoji(trigger.query)
      if (candidates.value.length === 0) {
        autocompleteState.value = null
      }
    } else if (trigger.type === '$[') {
      // Local search for MFM functions
      candidates.value = searchMfm(trigger.query)
      if (candidates.value.length === 0) {
        autocompleteState.value = null
      }
    } else {
      // API search with debounce
      isSearching.value = true
      debounceTimer = setTimeout(async () => {
        const results =
          trigger.type === '@'
            ? await searchMention(trigger.query)
            : await searchHashtag(trigger.query)
        // Check state is still active and query hasn't changed
        if (
          autocompleteState.value &&
          autocompleteState.value.query === trigger.query
        ) {
          candidates.value = results
          if (results.length === 0) {
            autocompleteState.value = null
          }
        }
        isSearching.value = false
      }, 300)
    }
  }

  function confirmSelection(index?: number) {
    const state = autocompleteState.value
    const textarea = textareaRef.value
    if (!state || !textarea) return

    const idx = index ?? state.selectedIndex
    const candidate = candidates.value[idx]
    if (!candidate) return

    let replacement: string
    switch (state.type) {
      case ':': {
        const emoji = candidate as ServerEmoji
        replacement = `:${emoji.name}: `
        break
      }
      case '@': {
        const user = candidate as NormalizedUser
        replacement = user.host
          ? `@${user.username}@${user.host} `
          : `@${user.username} `
        break
      }
      case '#': {
        replacement = `#${candidate as string} `
        break
      }
      case '$[': {
        replacement = `$[${candidate as string} `
        break
      }
    }

    const before = text.value.slice(0, state.triggerStart)
    const after = text.value.slice(textarea.selectionStart)
    text.value = before + replacement + after

    const newPos = state.triggerStart + replacement.length
    autocompleteState.value = null
    candidates.value = []
    popupPosition.value = null

    nextTick(() => {
      textarea.setSelectionRange(newPos, newPos)
      textarea.focus()
    })
  }

  function handleKeydown(e: KeyboardEvent): boolean {
    if (!autocompleteState.value || candidates.value.length === 0) return false

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        autocompleteState.value.selectedIndex = Math.min(
          autocompleteState.value.selectedIndex + 1,
          candidates.value.length - 1,
        )
        return true
      case 'ArrowUp':
        e.preventDefault()
        autocompleteState.value.selectedIndex = Math.max(
          autocompleteState.value.selectedIndex - 1,
          0,
        )
        return true
      case 'Enter':
      case 'Tab':
        e.preventDefault()
        confirmSelection()
        return true
      case 'Escape':
        e.preventDefault()
        autocompleteState.value = null
        candidates.value = []
        popupPosition.value = null
        return true
      default:
        return false
    }
  }

  function dismiss() {
    autocompleteState.value = null
    candidates.value = []
    popupPosition.value = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  return {
    autocompleteState,
    candidates,
    isSearching,
    popupPosition,
    onTextInput,
    onCompositionStart,
    onCompositionEnd,
    handleKeydown,
    confirmSelection,
    dismiss,
  }
}
