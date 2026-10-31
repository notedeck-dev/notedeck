/**
 * 子窓 (ポップアウト / ミラー / PiP) を Rust に頼む (#1131 段 4)。
 *
 * 窓を作るのは Rust (`sub_window_create`)。URL と label は Rust が組み、親子・上限・
 * ジオメトリの記録も Rust が持つ。JS が渡すのは kind ごとの payload と描画知識
 * (サイズ) と、人の操作か自動かの `origin` だけ。上限に達していれば自動は拒まれ、
 * 人の操作は開いた上で枚数を警告する (人の操作は止めない)。
 */
import type {
  SubWindowOrigin,
  SubWindowRequest,
  SubWindowSize,
} from '@/bindings'
import { commands } from '@/bindings'
import { i18n } from '@/i18n'
import { useToast } from '@/stores/toast'
import { unwrap } from '@/utils/tauriInvoke'

export type { SubWindowOrigin }

/** 開いた窓の label。自動の経路で上限に達していたか、生成に失敗したら null */
export async function createSubWindow(
  request: SubWindowRequest,
  origin: SubWindowOrigin,
  size: SubWindowSize,
): Promise<string | null> {
  try {
    const result = unwrap(await commands.subWindowCreate(request, origin, size))
    if (result.status === 'rejected') {
      console.info('[sub-window] limit reached, not opened:', result.openCount)
      return null
    }
    if (result.overLimit) {
      useToast().show(
        i18n.tsx._deckWindow.tooManyWindows({ count: result.openCount }),
        'warning',
      )
    }
    return result.label
  } catch (e) {
    console.warn('[sub-window] failed to open:', e)
    return null
  }
}
