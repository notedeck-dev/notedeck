import { computed, type InjectionKey, inject, provide, type Ref } from 'vue'

/**
 * ノート表示の基準サーバー (#1059、規則は `services/noteFrame`)。全アカウント面の
 * カラムが `provideNoteFrame(isCrossAccount)` で絶対表示を宣言し、配下の MkNote
 * (埋め込み・ツリー含む) が継承する。宣言が無ければ相対表示 (per-account 面)
 */
const NOTE_FRAME_KEY: InjectionKey<{ absolute: Ref<boolean> }> =
  Symbol('noteFrame')

export function provideNoteFrame(absolute: Ref<boolean>): void {
  provide(NOTE_FRAME_KEY, { absolute })
}

export function useNoteFrame(): { absolute: Ref<boolean> } {
  return inject(NOTE_FRAME_KEY, null) ?? { absolute: computed(() => false) }
}
