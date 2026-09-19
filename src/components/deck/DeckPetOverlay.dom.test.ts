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

const MASK = {
  cols: 48,
  rows: 52,
  runs: [
    [12, 24, 2],
    [0, 0, 48],
  ],
}

function mountPet(hitMask: typeof MASK | null = null) {
  const pet = usePetStore()
  pet.hitMask = hitMask
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
    // happy-dom には CSS.supports が無い。clip-path 対応環境として振る舞わせる
    vi.stubGlobal('CSS', { supports: () => true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('初回からコンパクトでも、後から決まるナビ高で位置を収める', async () => {
    // ナビは DeckPetOverlay より後にマウントされて高さを公開する。
    // 初期化時の clamp はナビ高 0 で走るので、そのままだと上にはみ出す
    isCompact.value = true
    useSettingsStore().set('pet.bottom', 10000)
    const wrapper = mountPet()
    document.body.style.setProperty('--nd-mobileNavHeight', '60px')
    await nextTick()
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    // happy-dom の innerHeight 768 − ナビ 60 − ペット 156
    expect(style).toMatch(/--pet-bottom:\s*552px/)
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

describe('DeckPetOverlay — 当たり判定の切り抜き (clip-path)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    isCompact.value = false
    vi.stubGlobal('CSS', { supports: () => true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('マスクがあれば表示中の状態 (idle = 行 0) の clip-path を当てる', async () => {
    const wrapper = mountPet(MASK)
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    // 既定倍率 0.75 → 144×156、ブロック 3px: (24,12) 幅 2 → x=72 y=36 w=6 h=3
    expect(style).toContain('--pet-clip: path("M72 36h6v3h-6z")')
  })

  it('表示中の状態が全部透明ならクリックを一切受けない', async () => {
    // 表示中の idle (行 0) にランが無いマスク
    const wrapper = mountPet({ cols: 48, rows: 52, runs: [[], [12, 24, 2]] })
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    expect(style).toContain('--pet-clip: inset(50%)')
  })

  it('マスクが無ければ clip-path を付けない (矩形のまま)', async () => {
    const wrapper = mountPet(null)
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    expect(style).not.toContain('--pet-clip')
  })

  it('clip-path: path() に対応しない環境では付けない', async () => {
    vi.stubGlobal('CSS', { supports: () => false })
    const wrapper = mountPet(MASK)
    await nextTick()
    const style = petEl(wrapper)?.getAttribute('style') ?? ''
    expect(style).not.toContain('--pet-clip')
  })
})
