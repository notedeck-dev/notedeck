// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { usePetStore } from '@/stores/pet'
import { useSettingsStore } from '@/stores/settings'
import DeckPetOverlay from './DeckPetOverlay.vue'

/** コンパクト (スマホ幅) でもペットを出す (#1080 残件「モバイルでの表示」) */

const isCompact = ref(false)
vi.mock('@/stores/ui', () => ({
  useIsCompactLayout: () => isCompact,
}))
// 省電力扱いにしてコマ送りタイマーを止める
vi.mock('@/stores/systemState', () => ({
  useSystemStateStore: () => ({ adaptation: { staticEmoji: true } }),
}))

function mountPet() {
  const pet = usePetStore()
  pet.info = {
    slug: 'cat',
    displayName: 'Cat',
    spriteVersion: 1,
    rows: 9,
    width: 1536,
    height: 1872,
    spriteExt: 'webp',
  }
  pet.spriteUrl = 'blob:mock'
  return mount(DeckPetOverlay, { attachTo: document.body })
}

function petEl(wrapper: ReturnType<typeof mountPet>): HTMLElement | null {
  return wrapper.find('[role="img"]').element as HTMLElement | null
}

describe('DeckPetOverlay — コンパクトレイアウト', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    isCompact.value = false
    document.body.style.removeProperty('--nd-mobileNavHeight')
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('コンパクトでもペットを表示する', async () => {
    isCompact.value = true
    const wrapper = mountPet()
    await nextTick()
    expect(wrapper.find('[role="img"]').exists()).toBe(true)
  })

  it('コンパクトでは位置をモバイルナビの上端基準にし、既定は FAB の上に置く', async () => {
    isCompact.value = true
    const wrapper = mountPet()
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    expect(style).toMatch(/--pet-bottom:\s*80px/)
  })

  it('デスクトップでは既定位置 (右下 16px) のまま', async () => {
    const wrapper = mountPet()
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    expect(style).toMatch(/--pet-bottom:\s*16px/)
    expect(style).toMatch(/right:\s*16px/)
  })

  it('保存済みの位置はコンパクトでもそのまま使う (ナビ上端基準に載せるだけ)', async () => {
    isCompact.value = true
    useSettingsStore().set('pet.bottom', 40)
    const wrapper = mountPet()
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    expect(style).toMatch(/--pet-bottom:\s*40px/)
  })
})
