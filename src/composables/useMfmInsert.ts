import { nextTick, type Ref, ref } from 'vue'
import { i18n } from '@/i18n'

export interface MfmFunction {
  label: string
  insert: string
  suffix: string
}

export const mfmFunctions: MfmFunction[] = [
  {
    get label() {
      return i18n.ts._useMfmInsert.flipHorizontal
    },
    insert: '$[flip ',
    suffix: ']',
  },
  {
    get label() {
      return i18n.ts._useMfmInsert.flipVertical
    },
    insert: '$[flip.v ',
    suffix: ']',
  },
  { label: 'Spin', insert: '$[spin ', suffix: ']' },
  { label: 'Shake', insert: '$[shake ', suffix: ']' },
  { label: 'Jump', insert: '$[jump ', suffix: ']' },
  { label: 'Bounce', insert: '$[bounce ', suffix: ']' },
  { label: 'Rainbow', insert: '$[rainbow ', suffix: ']' },
  { label: 'Sparkle', insert: '$[sparkle ', suffix: ']' },
  { label: 'Rotate', insert: '$[rotate ', suffix: ']' },
  { label: 'Tada', insert: '$[tada ', suffix: ']' },
  { label: 'Bold', insert: '**', suffix: '**' },
  { label: 'Italic', insert: '<i>', suffix: '</i>' },
  { label: 'Strike', insert: '~~', suffix: '~~' },
  { label: 'Code', insert: '`', suffix: '`' },
  { label: 'Center', insert: '<center>', suffix: '</center>' },
  { label: 'Small', insert: '<small>', suffix: '</small>' },
]

export function useMfmInsert(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  text: Ref<string>,
) {
  const showMfmMenu = ref(false)

  function toggleMfmMenu() {
    showMfmMenu.value = !showMfmMenu.value
  }

  function pickMfm(fn: MfmFunction) {
    const textarea = textareaRef.value
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = text.value.slice(start, end)
    const insert = fn.insert + selected + fn.suffix
    text.value = text.value.slice(0, start) + insert + text.value.slice(end)
    nextTick(() => {
      const cursorPos = selected
        ? start + insert.length
        : start + fn.insert.length
      textarea.setSelectionRange(cursorPos, cursorPos)
      textarea.focus()
    })
    showMfmMenu.value = false
  }

  return {
    showMfmMenu,
    mfmFunctions,
    toggleMfmMenu,
    pickMfm,
  }
}
