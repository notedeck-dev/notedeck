import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef } from 'vue'
import {
  registerCapability,
  unregisterCapability,
} from '@/capabilities/registry'
import type {
  CapabilitySignature,
  DispatchContext,
  PermissionKey,
} from '@/capabilities/types'
import type { ConfirmOptions } from '@/stores/confirm'
import type { QuickPickStep } from './quickPick'

export interface Shortcut {
  /** KeyboardEvent.key の値 ('k', 'p', 'Escape' 等) */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /**
   * 'global' - 修飾キー付き、常に有効 (Ctrl+K 等)
   * 'body' - テキスト入力中は無効 (単キー: p, n 等)
   */
  scope: 'global' | 'body'
}

/**
 * Command (= Capability) は NoteDeck で実行できる操作の単位。
 *
 * 5 つの呼び出し口で共通利用される Single Source of Truth:
 *   UI (コマンドパレット) / CLI (notecli) / HTTP API (port 19820) /
 *   AiScript (Nd:register_command) / AI Tool calling
 *
 * Phase 1 では UI 専用。Phase 2 以降で `aiTool: true` & `signature` & `permissions`
 * を宣言した command が AI から呼べるようになる。すべて optional なので既存
 * コマンドはそのまま (= UI のみ扱い) で動く。
 */
export interface Command {
  id: string
  label: string
  /** Tabler icon 名 ('pencil', 'search' 等) */
  icon: string
  category: 'general' | 'navigation' | 'column' | 'account' | 'note' | 'window'
  shortcuts: Shortcut[]
  /**
   * 実行関数。
   * - `params`: UI 経由は引数なし、AI tool / Nd:call / dispatcher 経由は params 付き
   * - `ctx`: dispatcher が組み立てる実行コンテキスト (例: 現在の AiConfig)。
   *   UI 直接呼び出しでは渡されない。多くの capability は不要なので optional
   * 戻り値は AI tool への応答として使われるため `unknown` を返せる。
   */
  execute: (params?: Record<string, unknown>, ctx?: DispatchContext) => unknown
  /** false を返すとパレットでグレー表示＋実行不可 */
  enabled?: () => boolean
  /** false にするとパレットに非表示 (ショートカットのみ) */
  visible?: boolean
  /**
   * この command を実行するのに必要な権限 (Phase 1 の `ai.json5` permissions と
   * 同じスキーマ)。AI tool / HTTP API / プラグインから呼ぶときに照合される。
   * UI のみで使う command は省略可。
   */
  permissions?: PermissionKey[]
  /**
   * AI tool として公開するか。true & signature 付き & permissions が満たされる
   * とき、AI tool schema に自動変換されて Anthropic / OpenAI の tools[] に乗る。
   * 未指定 / false なら UI のみ。
   */
  aiTool?: boolean
  /**
   * params / returns の型。AI tool schema / OpenAPI spec の自動生成に使う。
   * UI のみの command は省略可 (引数なし扱い)。
   */
  signature?: CapabilitySignature
  /**
   * 実行前にユーザー確認モーダルを出すか。AI / slash 経由 (= dispatchCapability
   * から呼ばれる経路) でだけ enforce される。UI からの直接実行は対象外。
   *
   * - `false` / 未指定 (default) — 確認なしで execute
   * - `true` — `cap.label` + signature.description + 引数 JSON で汎用モーダル
   *   を出す (write 系はこれで十分)
   * - 関数 — params を見て動的に `ConfirmOptions` を返す。`null` を返すと
   *   その回はスキップ可能 (= no-op エッジケース)。snapshot 取得など I/O が
   *   必要なケースのため async (= `Promise` 返却) もサポート。
   */
  requiresConfirmation?:
    | boolean
    | ((
        params: Record<string, unknown> | undefined,
      ) => ConfirmOptions | null | Promise<ConfirmOptions | null>)
}

export const useCommandStore = defineStore('commands', () => {
  const commands = shallowRef(new Map<string, Command>())
  const isOpen = ref(false)
  const initialInput = ref<string | null>(null)
  /** When set, only commands matching this predicate are shown */
  const commandFilter = ref<((cmd: Command) => boolean) | null>(null)
  const quickPickStack = ref<QuickPickStep[]>([])
  /** Query text for the current Quick Pick step (reset on push/pop) */
  const quickPickQuery = ref('')

  function register(command: Command) {
    commands.value.set(command.id, command)
    triggerRef(commands)
    // `aiTool: true` & `signature` 宣言済みの command は AI tool calling
    // からも呼べるよう capability registry にミラー登録する。
    // (Phase 2 A-4: Command と Capability を Single Source of Truth で扱う)
    if (command.aiTool && command.signature) {
      registerCapability(command)
    }
  }

  function unregister(id: string) {
    const existing = commands.value.get(id)
    commands.value.delete(id)
    triggerRef(commands)
    if (existing?.aiTool) {
      unregisterCapability(id)
    }
  }

  function getEnabled(): Command[] {
    return [...commands.value.values()].filter(
      (cmd) => cmd.enabled?.() !== false,
    )
  }

  function execute(id: string) {
    const cmd = commands.value.get(id)
    if (cmd && cmd.enabled?.() !== false) {
      cmd.execute()
    }
  }

  function open() {
    isOpen.value = true
  }

  function openWithInput(text: string) {
    if (isOpen.value) {
      close()
      return
    }
    initialInput.value = text
    isOpen.value = true
  }

  function openWithFilter(filter: (cmd: Command) => boolean, input?: string) {
    commandFilter.value = filter
    initialInput.value = input ?? null
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
    commandFilter.value = null
    clearQuickPick()
  }

  function pushQuickPick(step: QuickPickStep) {
    quickPickStack.value.push(step)
    quickPickQuery.value = ''
  }

  function popQuickPick() {
    quickPickStack.value.pop()
    quickPickQuery.value = ''
  }

  function clearQuickPick() {
    quickPickStack.value.length = 0
    quickPickQuery.value = ''
  }

  function toggle() {
    if (isOpen.value) {
      close()
    } else {
      open()
    }
  }

  return {
    commands,
    isOpen,
    initialInput,
    commandFilter,
    quickPickStack,
    quickPickQuery,
    register,
    unregister,
    getEnabled,
    execute,
    open,
    openWithInput,
    openWithFilter,
    close,
    toggle,
    pushQuickPick,
    popQuickPick,
    clearQuickPick,
  }
})
