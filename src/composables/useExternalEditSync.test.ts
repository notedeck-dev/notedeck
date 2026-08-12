import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useExternalEditSync } from './useExternalEditSync'

/**
 * 編集バッファを持つエディタが「外部からの変更を取り込む」ときの規則を
 * 検証する。手作業で確かめるのが難しく (未保存の編集を守れているかは
 * 目視では分からない)、壊れるとユーザーの編集が消える方向のバグになる。
 */
function setup(opts: { external: string; buffer: string; dirty?: boolean }) {
  const external = ref<string | undefined>(opts.external)
  const buffer = ref(opts.buffer)
  const dirty = ref(opts.dirty ?? false)
  const applied: string[] = []
  const scope = effectScope()
  let isSyncing = () => false
  scope.run(() => {
    const sync = useExternalEditSync({
      source: () => external.value,
      current: () => buffer.value,
      isDirty: () => dirty.value,
      apply: (v) => {
        applied.push(v)
        buffer.value = v
      },
    })
    isSyncing = sync.isSyncing
  })
  return { external, buffer, dirty, applied, isSyncing, scope }
}

describe('useExternalEditSync', () => {
  it('外部の変更を編集バッファへ取り込む', async () => {
    const t = setup({ external: 'v1', buffer: 'v1' })
    t.external.value = 'v2'
    await nextTick()
    expect(t.applied).toEqual(['v2'])
    expect(t.buffer.value).toBe('v2')
  })

  it('未保存の編集があるときは取り込まない (ユーザーのバッファを守る)', async () => {
    const t = setup({ external: 'v1', buffer: '編集中', dirty: true })
    t.external.value = 'v2'
    await nextTick()
    expect(t.applied).toEqual([])
    expect(t.buffer.value).toBe('編集中')
  })

  it('自分の書込みで戻ってきた値 (バッファと同じ) では何もしない', async () => {
    const t = setup({ external: 'v1', buffer: 'v1' })
    t.buffer.value = 'v2'
    t.external.value = 'v2'
    await nextTick()
    expect(t.applied).toEqual([])
  })

  it('対象が消えたら (undefined) 何もしない', async () => {
    const t = setup({ external: 'v1', buffer: 'v1' })
    t.external.value = undefined
    await nextTick()
    expect(t.applied).toEqual([])
    expect(t.buffer.value).toBe('v1')
  })

  it('取り込み中だけ isSyncing が true になる (書込み側の watch を止められる)', async () => {
    const external = ref<string | undefined>('v1')
    const buffer = ref('v1')
    const seen: boolean[] = []
    const scope = effectScope()
    let isSyncing = () => false
    scope.run(() => {
      const sync = useExternalEditSync({
        source: () => external.value,
        current: () => buffer.value,
        isDirty: () => false,
        apply: (v) => {
          buffer.value = v
          seen.push(sync.isSyncing())
        },
      })
      isSyncing = sync.isSyncing
    })
    external.value = 'v2'
    await nextTick()
    expect(seen).toEqual([true])
    // 取り込みが終わったら解除される (以後のユーザー編集は通常どおり保存される)
    await nextTick()
    expect(isSyncing()).toBe(false)
  })

  it('未保存の編集を保存して dirty が解けたあとは、次の外部変更を取り込む', async () => {
    const t = setup({ external: 'v1', buffer: '編集中', dirty: true })
    t.external.value = 'v2'
    await nextTick()
    expect(t.applied).toEqual([])
    // 保存された = バッファが store に反映され dirty が解ける
    t.dirty.value = false
    t.external.value = 'v3'
    await nextTick()
    expect(t.applied).toEqual(['v3'])
  })
})
