/**
 * 接続で使えるモデルの候補 (#880 / #1020 / #1321)。疎通テストが `/models` の応答から読んだ
 * `data[].id`。取れないプロバイダーや失敗時は自由入力だけになる。接続を引数に取るので、
 * チャットの接続 (接続セクション) と巡回の接続 (HEARTBEAT セクション) の両方から使える
 */

import { type Ref, ref, watch } from 'vue'
import type { Connection } from '@/bindings'
import { useVault } from '@/composables/useVault'
import { BUILTIN_TEMPLATES } from '@/data/connectionTemplates'
import { modelsPathFor } from '@/services/localConnection'

export type ModelCandidatesState = 'idle' | 'loading' | 'failed'

export function useAiModelCandidates(connection: Ref<Connection | null>) {
  const vault = useVault()
  const candidates = ref<string[] | null>(null)
  const state = ref<ModelCandidatesState>('idle')
  /** 最後に出した問い合わせの番号。古い問い合わせが後から返っても捨てる */
  let seq = 0

  async function load(conn: Connection): Promise<void> {
    const mine = ++seq
    state.value = 'loading'
    candidates.value = null
    try {
      const tpl = conn.templateId
        ? BUILTIN_TEMPLATES.find((t) => t.id === conn.templateId)
        : undefined
      const r = await vault.testConnection(
        conn.id,
        tpl?.testPath ?? modelsPathFor(conn.protocol ?? null),
      )
      // 選択や接続先が切り替わっていたら捨てる
      if (mine !== seq) return
      if (r.ok && r.models) {
        candidates.value = r.models
        state.value = 'idle'
      } else {
        state.value = 'failed'
      }
    } catch {
      if (mine === seq) state.value = 'failed'
    }
  }

  // 接続の id だけでなく宛先 (baseUrl / protocol) が変わっても引き直す (「接続」ウィンドウで
  // URL を書き換えた直後に古いサーバーの候補が残らないように)
  watch(
    () => {
      const c = connection.value
      return c ? `${c.id}\n${c.baseUrl}\n${c.protocol ?? ''}` : ''
    },
    () => {
      const conn = connection.value
      if (conn) void load(conn)
      else {
        candidates.value = null
        state.value = 'idle'
      }
    },
    { immediate: true },
  )

  return { candidates, state }
}
