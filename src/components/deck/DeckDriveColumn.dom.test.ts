// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useColumnSetup } from '@/composables/useColumnSetup'
import {
  bindings,
  flush,
  makeAccount,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckDriveColumn from './DeckDriveColumn.vue'

vi.mock('@/bindings', async () =>
  (await import('./columnTestKit.bindings')).bindingsMock(),
)
vi.mock('@/composables/useColumnSetup', async (orig) => {
  const actual = await orig<typeof import('@/composables/useColumnSetup')>()
  return { useColumnSetup: vi.fn(actual.useColumnSetup) }
})
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))

const stubs = {
  MkFolderGrid: {
    props: ['folders'],
    template: '<div data-folders :data-count="folders.length" />',
  },
  MkFileGrid: {
    props: ['files'],
    template: '<div data-files :data-count="files.length" />',
  },
  DriveItemMenu: true,
  MkDriveFolderSelectDialog: true,
}

beforeEach(() => {
  bindings.reset()
  vi.mocked(useColumnSetup).mockClear()
})

describe('DeckDriveColumn (共通基盤)', () => {
  it('mount でカラムのアカウントのルートフォルダとファイルを取る (読み込みは useDriveFolder)', async () => {
    setupStores()
    bindings.responses.apiGetDriveFolders = [
      {
        id: 'f1',
        name: 'photos',
        parentId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    bindings.responses.apiGetDriveFiles = []
    const column = makeColumn({ type: 'drive' })
    const wrapper = await mountColumn(DeckDriveColumn, column, stubs)

    expect(vi.mocked(useColumnSetup).mock.calls[0]?.[0]()).toMatchObject({
      id: 'col-1',
      type: 'drive',
    })
    expect(bindings.callsOf('apiGetDriveFolders').map((c) => c.args)).toEqual([
      ['acc-1', null, 50],
    ])
    expect(bindings.callsOf('apiGetDriveFiles').map((c) => c.args)).toEqual([
      ['acc-1', null, 50, null],
    ])
    expect(wrapper.get('[data-folders]').attributes('data-count')).toBe('1')
    expect(
      wrapper.get('[data-deck-column]').attributes('data-pull-refresh'),
    ).toBe('1')
  })

  it('ログアウト中のアカウント (基盤の isLoggedOut) では本体を描画しない', async () => {
    setupStores([makeAccount({ hasToken: false })])
    const wrapper = await mountColumn(
      DeckDriveColumn,
      makeColumn({ type: 'drive' }),
      stubs,
    )
    await flush()

    expect(wrapper.find('[data-folders]').exists()).toBe(false)
    expect(wrapper.find('[data-loading-spinner]').exists()).toBe(false)
  })
})
