// Android の back button / gesture でオーバーレイ UI を閉じるための履歴スタック
// (モジュールレベルのシングルトン)。Vue に依存しないので store からも使う (#1098)。

interface OverlayEntry {
  id: string
  close: () => void
}

const MARKER = 'nd-overlay'
const stack: OverlayEntry[] = []
let historyActive = false
let ignoringPop = false

function handlePopState() {
  if (ignoringPop) {
    ignoringPop = false
    return
  }
  historyActive = false
  const top = stack.pop()
  if (top) top.close()
  // 残りがあれば再 push
  if (stack.length > 0) {
    history.pushState(MARKER, '')
    historyActive = true
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', handlePopState)
}

/**
 * Overlay を登録し、Android back button で閉じられるようにする。
 * 戻り値は解除関数（冪等）。
 */
export function pushOverlay(close: () => void): () => void {
  const id = `nd-${Math.random().toString(36).slice(2, 8)}`
  stack.push({ id, close })
  if (!historyActive) {
    history.pushState(MARKER, '')
    historyActive = true
  }
  let removed = false
  return () => {
    if (removed) return
    removed = true
    const idx = stack.findIndex((e) => e.id === id)
    if (idx === -1) return // back 操作で既に pop 済み
    stack.splice(idx, 1)
    if (stack.length === 0 && historyActive) {
      ignoringPop = true
      historyActive = false
      history.back()
    }
  }
}
