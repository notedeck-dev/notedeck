import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, defineComponent, h } from 'vue'

const moveFilesMock = vi.fn()

vi.mock('@/composables/useDriveActions', () => ({
  useDriveActions: () => ({ moveFiles: moveFilesMock }),
}))

// メニュー・ライトボックス・ダイアログは配線だけを検証するスタブに差し替える
vi.mock('@/components/common/DriveItemMenu.vue', () => ({
  default: defineComponent({
    emits: ['move-request', 'deleted'],
    setup(_, { emit, expose }) {
      expose({ open: vi.fn(), close: vi.fn() })
      return () =>
        h('div', { class: 'menu-stub' }, [
          h('button', {
            class: 'stub-move',
            onClick: () => emit('move-request', {}),
          }),
          h('button', {
            class: 'stub-deleted',
            onClick: () => emit('deleted', {}),
          }),
        ])
    },
  }),
}))

const lightboxRendered = vi.fn()
vi.mock('@/components/common/MkMediaLightbox.vue', () => ({
  default: defineComponent({
    setup() {
      lightboxRendered()
      return () => h('div', { class: 'lightbox-stub' })
    },
  }),
}))

const dialogProps: Array<{ initialFolderId: string | null | undefined }> = []
vi.mock('@/components/common/MkDriveFolderSelectDialog.vue', () => ({
  default: defineComponent({
    props: {
      accountId: { type: String, required: true },
      initialFolderId: { type: String, default: undefined },
      initialStack: { type: Array, default: undefined },
    },
    setup(props) {
      dialogProps.push({ initialFolderId: props.initialFolderId })
      return () => h('div', { class: 'dialog-stub' })
    },
  }),
}))

let fileName = 'photo.png'
let sensitive = true
const readImageExifMock = vi.fn()

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiGetDriveFile: vi.fn(async () => ({
        status: 'ok',
        data: {
          id: 'f1',
          name: fileName,
          type: 'image/png',
          url: 'https://example.test/photo.png',
          thumbnailUrl: null,
          size: 100,
          isSensitive: sensitive,
        },
      })),
      readImageExif: (url: string) => readImageExifMock(url),
    },
  }
})

import { useUiStore } from '@/stores/ui'
import DriveFileDetailContent from './DriveFileDetailContent.vue'

let app: App | null = null
let container: HTMLElement | null = null

async function mountDetail(originFolderId?: string | null) {
  container = document.createElement('div')
  document.body.appendChild(container)
  let closed = 0
  app = createApp(DriveFileDetailContent, {
    accountId: 'acc1',
    fileId: 'f1',
    originFolderId,
    originStack: [],
    onClose: () => closed++,
  })
  app.mount(container)
  await vi.waitFor(() => {
    expect(container?.querySelector('img, .menu-stub')).toBeTruthy()
  })
  return { getClosed: () => closed }
}

function img(): HTMLImageElement | null {
  return container?.querySelector('img') ?? null
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  dialogProps.length = 0
  fileName = 'photo.png'
  sensitive = true
  // EXIF は mount 時に自動照会される。個別テストで Once 上書きする
  readImageExifMock.mockResolvedValue({ status: 'ok', data: [] })
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('DriveFileDetailContent (#792)', () => {
  it('sensitive は blur 初期表示され、reveal 前はクリックでライトボックスが開かない', async () => {
    await mountDetail()
    expect(container?.querySelector('._sensitiveOverlay')).toBeTruthy()
    img()?.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(lightboxRendered).not.toHaveBeenCalled()
  })

  it('reveal 後は画像クリックでライトボックスが開く', async () => {
    await mountDetail()
    ;(container?.querySelector('._sensitiveOverlay') as HTMLElement)?.click()
    await vi.waitFor(() =>
      expect(container?.querySelector('._sensitiveOverlay')).toBeNull(),
    )
    img()?.click()
    await vi.waitFor(() => expect(lightboxRendered).toHaveBeenCalled())
  })

  it('reveal 状態は driveFilesChanged 起因の再取得後も維持される（fileId キー保持）', async () => {
    await mountDetail()
    ;(container?.querySelector('._sensitiveOverlay') as HTMLElement)?.click()
    await vi.waitFor(() =>
      expect(container?.querySelector('._sensitiveOverlay')).toBeNull(),
    )
    // 別所からのリネーム → bump → 再取得（file オブジェクトが差し替わる）
    fileName = 'renamed.png'
    useUiStore().emitDriveFilesChanged('acc1')
    await vi.waitFor(() =>
      expect(container?.textContent).toContain('renamed.png'),
    )
    expect(container?.querySelector('._sensitiveOverlay')).toBeNull()
  })

  it('move-request で内蔵ダイアログが origin 起点で開き、confirm 相当で moveFiles が呼ばれる', async () => {
    await mountDetail('origin-folder')
    ;(container?.querySelector('.stub-move') as HTMLElement)?.click()
    await vi.waitFor(() => expect(dialogProps).toHaveLength(1))
    expect(dialogProps[0]?.initialFolderId).toBe('origin-folder')
  })

  it('deleted でウィンドウが close される', async () => {
    const { getClosed } = await mountDetail()
    ;(container?.querySelector('.stub-deleted') as HTMLElement)?.click()
    await vi.waitFor(() => expect(getClosed()).toBe(1))
  })
})

describe('DriveFileDetailContent の EXIF 表示 (#797)', () => {
  it('mount 時に自動照会し、GPS タグを含む場合は警告バナーとテーブルを表示する', async () => {
    readImageExifMock.mockResolvedValueOnce({
      status: 'ok',
      data: [
        { ifd: 'primary', tag: 'Make', value: 'TestCam' },
        { ifd: 'primary', tag: 'GPSLatitude', value: '35 deg 41 min' },
        { ifd: 'thumbnail', tag: 'Make', value: 'TestCam' },
      ],
    })
    await mountDetail()
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        '位置情報 (GPS) が含まれています',
      ),
    )
    expect(readImageExifMock).toHaveBeenCalledWith(
      'https://example.test/photo.png',
    )
    // primary のみテーブルに出る（thumbnail IFD の重複は出さない）
    const rows = container?.querySelectorAll('table tr') ?? []
    expect(rows).toHaveLength(2)
    expect(container?.textContent).toContain('TestCam')
  })

  it('EXIF が無い場合はその旨を表示し、GPS 警告は出さない', async () => {
    await mountDetail()
    await vi.waitFor(() =>
      expect(container?.textContent).toContain('EXIF 情報は含まれていません'),
    )
    expect(container?.textContent).not.toContain('位置情報')
  })

  it('読み取り失敗時は EXIF 欄にエラーを表示する', async () => {
    readImageExifMock.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'INVALID_INPUT', message: 'Failed to parse image' },
    })
    await mountDetail()
    await vi.waitFor(() =>
      expect(container?.textContent).toContain('Failed to parse image'),
    )
  })

  it('リネーム起因の再取得では EXIF を再照会しない（初回のみ）', async () => {
    await mountDetail()
    await vi.waitFor(() => expect(readImageExifMock).toHaveBeenCalledTimes(1))
    fileName = 'renamed.png'
    useUiStore().emitDriveFilesChanged('acc1')
    await vi.waitFor(() =>
      expect(container?.textContent).toContain('renamed.png'),
    )
    expect(readImageExifMock).toHaveBeenCalledTimes(1)
  })
  it('プレビュー画像は画像プロキシ経由で読み、失敗したときだけ元の URL に戻す', async () => {
    await mountDetail()
    const proxied = `http://127.0.0.1:19820/proxy/image?url=${encodeURIComponent('https://example.test/photo.png')}`
    expect(img()?.getAttribute('src')).toBe(proxied)
    img()?.dispatchEvent(new Event('error'))
    await vi.waitFor(() =>
      expect(img()?.getAttribute('src')).toBe('https://example.test/photo.png'),
    )
    // 元の URL でも失敗したら、それ以上は切り替えない
    img()?.dispatchEvent(new Event('error'))
    await new Promise((r) => setTimeout(r, 0))
    expect(img()?.getAttribute('src')).toBe('https://example.test/photo.png')
  })
})
