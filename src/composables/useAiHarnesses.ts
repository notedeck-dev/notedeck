/**
 * 手元の CLI (Claude Code / Codex / OpenCode / Gemini CLI / Hermes Agent / Grok Build) の一覧 (#1104)。
 *
 * ACP (Agent Client Protocol) を話す CLI を AI の接続の 1 種 (`harness:<id>`) として
 * 扱う。検出は Rust 側 (PATH を見る) で、ここは写しと読み直しだけ。
 */
import { computed, ref } from 'vue'
import type { HarnessInfo } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

export const HARNESS_ID_PREFIX = 'harness:'

const harnesses = ref<HarnessInfo[]>([])
const loaded = ref(false)

/** 接続 id が手元の CLI を指すか */
export function isHarnessConnectionId(id: string): boolean {
  return id.startsWith(HARNESS_ID_PREFIX)
}

export function harnessConnectionId(h: Pick<HarnessInfo, 'id'>): string {
  return `${HARNESS_ID_PREFIX}${h.id}`
}

async function refresh(): Promise<void> {
  try {
    harnesses.value = unwrap(await commands.aiHarnessList())
    loaded.value = true
  } catch (e) {
    console.warn('[ai-harness] list failed:', e)
  }
}

export function useAiHarnesses() {
  return {
    harnesses: computed(() => harnesses.value),
    loaded: computed(() => loaded.value),
    refresh,
  }
}
