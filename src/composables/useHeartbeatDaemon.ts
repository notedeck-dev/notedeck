/**
 * HEARTBEAT (#411) — App-level global daemon.
 *
 * OpenClaw HEARTBEAT 仕様 (single scheduler / target routing) に揃えた
 * バックグラウンド実行エンジン。`useHeartbeatScheduler` (per-column) と
 * `useHeartbeatRunner` (per-column) の責務を 1 つに統合し、Tauri アプリ
 * 起動中に 1 つだけ動く singleton として App.vue で mount される。
 *
 * 流れ:
 *   1. `aiConfig.heartbeat.enabled / intervalMinutes` を watch して Rust
 *      scheduler に push (configure / unconfigure)
 *   2. `nd:ai-heartbeat-tick` を 1 度だけ listen (App-level)
 *   3. tick: heartbeat skill bodies + system prompt → AI inference
 *   4. OpenClaw 流 suppression (HEARTBEAT_OK / ackMaxChars)
 *   5. drop されなかった内容を target session に append
 *      - target='auto' (default): kind='heartbeat' の専用 session を auto-create
 *      - target='none'           : append しない (silent log)
 *      - target=<session id>     : 明示 pin
 *
 * 担当アカウント (`heartbeat.accountId`) は server-pulse 等のサーバー API を
 * どの account context で叩くか pin できる。null = 最初の active account。
 *
 * 並行実行ガード: `running` flag で同時実行 (= API call 暴発) を防ぐ。
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { getCapability, listCapabilities } from '@/capabilities/registry'
import { toAnthropicTool, toOpenAiTool } from '@/capabilities/toolSchema'
import { useAccountsStore } from '@/stores/accounts'
import { type AiSession, useAiSessionsStore } from '@/stores/aiSessions'
import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { useToast } from '@/stores/toast'
import { timestampTitle } from '@/utils/aiSessionTitle'
import { sendDesktopNotification } from '@/utils/desktopNotification'
import { isTauri } from '@/utils/settingsFs'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { type ChatMessage, type ToolUseEvent, useAiChat } from './useAiChat'
import {
  type AiConfig,
  HEARTBEAT_ACK_MAX_CHARS,
  type HeartbeatTarget,
  type ProviderKey,
  resolvePermissions,
  useAiConfig,
} from './useAiConfig'
import {
  buildAiContextBlock,
  composeHeartbeatSystemPrompt,
  projectMemos,
} from './useAiSystemContext'
import { ensureMemosLoaded, loadAllMemos } from './useMemos'

/**
 * Rust scheduler (`commands/heartbeat.rs`) が `nd:ai-heartbeat-tick` event で
 * emit する payload と一致させる。specta は raw event payload を export しない
 * ので、こちら側で local 定義する (Rust 側の `HeartbeatTickPayload` と shape を
 * 合わせ続ける必要あり、変更時は両方更新)。
 */
export interface HeartbeatTickPayload {
  triggered_at_ms: number
  source: string
}

/** AI 応答が「何も報告すべきことがない」ことを示す sentinel token。 */
export const HEARTBEAT_OK_TOKEN = 'HEARTBEAT_OK'

/**
 * OpenClaw 流 suppression の純関数。
 *
 * - 先頭 / 末尾の `HEARTBEAT_OK` トークンを 1 つずつ剥がす (中間位置は触らない)
 * - 剥がした残り (trim 後) が 0 文字 or `ackMaxChars` 以下なら全体 null を返す
 *   (= 抑制 = 履歴に残さない)
 * - 上記に該当しなければ trim 済み残りを返す (= 表示する)
 *
 * @returns 表示すべきテキスト or null (= 抑制)
 */
export function applyHeartbeatSuppression(
  text: string | null | undefined,
  ackMaxChars: number = HEARTBEAT_ACK_MAX_CHARS,
): string | null {
  if (text == null) return null
  let body = text.trim()
  if (body.length === 0) return null
  if (body.startsWith(HEARTBEAT_OK_TOKEN)) {
    body = body.slice(HEARTBEAT_OK_TOKEN.length).trimStart()
  }
  if (body.endsWith(HEARTBEAT_OK_TOKEN)) {
    body = body.slice(0, body.length - HEARTBEAT_OK_TOKEN.length).trimEnd()
  }
  if (body.length === 0) return null
  if (
    body.length <= ackMaxChars &&
    body.includes(HEARTBEAT_OK_TOKEN) === false
  ) {
    return null
  }
  return body
}

const MAX_TOOL_ROUNDS = 5

/**
 * AI 推論の連続失敗がこの回数に達したら daemon を自動 disable + warning toast。
 * provider key 切れ / 429 rate limit / network 切断などで永遠に空振りするのを
 * 防ぐ「サーキットブレーカー」相当。
 */
const MAX_CONSECUTIVE_FAILURES = 3

/** 1 日 = 86400000 ms。epoch days への変換に使う。 */
const MS_PER_DAY = 86_400_000

// ---------------------------------------------------------------------------
// Cheap Check First (#411) — persist state
// ---------------------------------------------------------------------------

/**
 * skill id 単位で前回 tick の cheap check 結果と最後の AI 起動時刻を保持。
 * - lastResultsHash: cheap capability 結果配列を JSON.stringify した文字列
 * - lastAiRunAt: 最後に AI 推論を走らせた epoch ms (maxSkipHours の起点)
 *
 * localStorage に persist し、再起動跨ぎでも前回値を保持する。
 */
interface CheapCheckPersistedState {
  lastResultsHash: Record<string, string>
  lastAiRunAt: Record<string, number>
}

function loadCheapCheckState(): CheapCheckPersistedState {
  return getStorageJson<CheapCheckPersistedState>(
    STORAGE_KEYS.heartbeatCheapCheckState,
    { lastResultsHash: {}, lastAiRunAt: {} },
  )
}

function saveCheapCheckState(state: CheapCheckPersistedState): void {
  setStorageJson(STORAGE_KEYS.heartbeatCheapCheckState, state)
}

interface DailyCounterState {
  /** 今日の epoch days (日付境界で count を reset) */
  date: number
  /** 今日の AI 起動回数 (cheap check で skip された tick はカウントしない) */
  count: number
}

function loadDailyCounter(): DailyCounterState {
  const today = Math.floor(Date.now() / MS_PER_DAY)
  const stored = getStorageJson<DailyCounterState>(
    STORAGE_KEYS.heartbeatDailyCounter,
    { date: today, count: 0 },
  )
  // 日付境界跨ぎ → reset
  return stored.date === today ? stored : { date: today, count: 0 }
}

function saveDailyCounter(state: DailyCounterState): void {
  setStorageJson(STORAGE_KEYS.heartbeatDailyCounter, state)
}

// ---------------------------------------------------------------------------
// Cheap Check First — 純関数 helpers (テスト容易性のため module-scope)
// ---------------------------------------------------------------------------

export interface CheapCheckOutcome {
  /** AI 起動するか (true=起動 / false=skip して HEARTBEAT_OK 扱い) */
  shouldRunAi: boolean
  /** 起動 / skip の理由 (debug log 用) */
  reason: string
  /** 今回の results hash (skill id → hash)。state 更新に使う */
  newHashes: Record<string, string>
}

/**
 * skill ごとに `cheapCheckCapabilities` を実行 → 結果 hash を作って返す。
 * cheap=true & permission OK な capability のみ受け入れる。
 *
 * @returns skill id → 結果 hash の map (該当 skill の cheap check が成立した分のみ)
 */
async function collectCheapResults(
  heartbeatSkills: SkillMeta[],
  aiConfig: AiConfig,
): Promise<Record<string, string>> {
  const granted = resolvePermissions(aiConfig.heartbeat.permissions)
  const out: Record<string, string> = {}

  for (const skill of heartbeatSkills) {
    const capIds = skill.cheapCheckCapabilities
    if (!capIds || capIds.length === 0) continue

    const results: unknown[] = []
    let valid = false
    for (const capId of capIds) {
      const cap = getCapability(capId)
      if (!cap || cap.signature?.cheap !== true) {
        // cheap=false / 未登録 / signature なし は無視 (重い API を tick ごとに
        // 連発するのを防ぐ)
        continue
      }
      // permission チェック
      const required = cap.permissions ?? []
      if (!required.every((p) => granted[p])) continue

      try {
        const res = await dispatchCapability(capId, undefined, aiConfig)
        results.push(res.ok ? res.result : { error: res.code })
        valid = true
      } catch (e) {
        results.push({ error: e instanceof Error ? e.message : String(e) })
        valid = true
      }
    }
    if (valid) out[skill.id] = JSON.stringify(results)
  }
  return out
}

/**
 * Cheap check の結果と前回値を比較して「AI 起動すべきか」を判定する純関数。
 *
 * 判定ロジック:
 * 1. cheap check が global で disabled → 常に AI 起動
 * 2. どの skill も cheap check 宣言なし (newHashes 空) → 常に AI 起動 (= 既存挙動)
 * 3. 1 つでも skill の hash が変化していれば AI 起動
 * 4. 全 skill 一致だが maxSkipHours 経過 → 強制 AI 起動 (cheap check 壊れ防止)
 * 5. 全 skill 一致 + maxSkipHours 内 → skip (HEARTBEAT_OK 扱い)
 */
export function decideCheapCheck(
  newHashes: Record<string, string>,
  prevState: CheapCheckPersistedState,
  aiConfig: AiConfig,
  now: number,
): CheapCheckOutcome {
  if (!aiConfig.heartbeat.cheapCheck.enabled) {
    return {
      shouldRunAi: true,
      reason: 'cheap-check-disabled',
      newHashes,
    }
  }
  const skillIds = Object.keys(newHashes)
  if (skillIds.length === 0) {
    return {
      shouldRunAi: true,
      reason: 'no-cheap-check-declared',
      newHashes,
    }
  }
  const changed = skillIds.find(
    (id) => prevState.lastResultsHash[id] !== newHashes[id],
  )
  if (changed) {
    return {
      shouldRunAi: true,
      reason: `changed:${changed}`,
      newHashes,
    }
  }
  // 全一致 — maxSkipHours 経過してたら強制起動
  const maxSkipMs = aiConfig.heartbeat.cheapCheck.maxSkipHours * 60 * 60 * 1000
  const oldestRunAt = skillIds.reduce<number>((min, id) => {
    const t = prevState.lastAiRunAt[id] ?? 0
    return t < min ? t : min
  }, Number.POSITIVE_INFINITY)
  if (
    oldestRunAt === Number.POSITIVE_INFINITY ||
    now - oldestRunAt >= maxSkipMs
  ) {
    return {
      shouldRunAi: true,
      reason: 'max-skip-hours-elapsed',
      newHashes,
    }
  }
  return {
    shouldRunAi: false,
    reason: 'no-change-within-skip-window',
    newHashes,
  }
}

/**
 * heartbeat 用の system prompt 末尾に必ず付ける指示文。
 * OpenClaw の "Read HEARTBEAT.md if it exists. Follow it strictly." と同じ意図。
 */
const HEARTBEAT_INSTRUCTION = `
あなたは HEARTBEAT (定期チェック) として呼ばれています。
上に記載された HEARTBEAT skill の指示に厳密に従ってください。
過去の会話や前回の tick は参照しないでください。
何も報告すべきことが無い場合は "${HEARTBEAT_OK_TOKEN}" の 1 行だけを返してください。
重要な発見がある場合のみ、簡潔に (200 字以内推奨) まとめて報告してください。
`.trim()

/**
 * target に従って出力先 session を解決する。`'auto'` の場合、kind='heartbeat'
 * の既存 session があれば再利用、なければ新規作成。`'none'` は null を返す。
 * 任意の session id 指定は実在しなければ null。
 */
async function resolveTargetSession(
  target: HeartbeatTarget,
  sessionsStore: ReturnType<typeof useAiSessionsStore>,
  defaultModel: string,
  defaultProvider: string,
): Promise<AiSession | null> {
  if (target === 'none') return null
  if (target === 'auto') {
    for (const sess of sessionsStore.sessions.values()) {
      if (sess.kind === 'heartbeat') return sess
    }
    // チャット session と同じ Zettelkasten 風命名:
    // "2026-05-01 17:43 のHEARTBEAT" 形式。kind バッジで heartbeat 判別できるので
    // 絵文字 prefix は付けない (= タイトル列が他 session と揃う)。
    return sessionsStore.createNew({
      kind: 'heartbeat',
      title: timestampTitle(new Date(), 'のHEARTBEAT'),
      model: defaultModel,
      provider: defaultProvider,
    })
  }
  return sessionsStore.get(target) ?? null
}

/**
 * HEARTBEAT session 専用 AI タイトル生成 system prompt。
 * (DeckAiColumn.vue の chat session 用 prompt と同じ shape、文脈だけ heartbeat 向け)
 */
const HEARTBEAT_TITLE_SYSTEM_PROMPT =
  'あなたは HEARTBEAT 通知の要約タイトル生成アシスタントです。与えられた通知内容を端的に表す短い日本語のタイトルを 1 行で出力してください。20 文字程度 (最大 40 文字) に収めること。引用符、前置き、改行、絵文字、文末句点は付けないでください。タイトルのみを返してください。'

export function useHeartbeatDaemon() {
  const { config } = useAiConfig()
  const sessionsStore = useAiSessionsStore()
  const accountsStore = useAccountsStore()
  const skillsStore = useSkillsStore()
  const aiChat = useAiChat()
  // タイトル生成は本体 AI inference と並行実行されるため独立 instance。
  // (chat session で同じパターンを採用している)
  const titleGen = useAiChat()
  const toast = useToast()

  const isRunning = ref(false)
  /**
   * AI 推論の連続失敗カウンタ。1 回成功するたび 0 リセット。
   * MAX_CONSECUTIVE_FAILURES 到達で daemon 自動 disable + warning toast。
   */
  let consecutiveFailures = 0
  let unlisten: UnlistenFn | null = null

  /**
   * AI 起動回数を 1 inc。日付境界を跨いでいたら reset → 1 にする。
   * @returns inc 後の today / count
   */
  function tickDailyCounter(now: number): DailyCounterState {
    const today = Math.floor(now / MS_PER_DAY)
    const cur = loadDailyCounter()
    const next: DailyCounterState =
      cur.date === today
        ? { date: today, count: cur.count + 1 }
        : { date: today, count: 1 }
    saveDailyCounter(next)
    return next
  }

  /**
   * AI 推論失敗時、target session に「⚠ HEARTBEAT 失敗」message として
   * 残す。silent fail を避けるためのフォロー。target='none' / target が
   * 解決できない場合は console.warn だけで return (履歴を作らない)。
   */
  async function appendErrorMessage(
    errMsg: string,
    payload: HeartbeatTickPayload,
  ): Promise<void> {
    const cfg = config.value.heartbeat
    if (cfg.target === 'none') return
    const provider: ProviderKey = config.value.provider
    const settings = config.value[provider]
    const target = await resolveTargetSession(
      cfg.target,
      sessionsStore,
      settings.model,
      provider,
    )
    if (!target) return
    const ts = Date.now()
    const message: ChatMessage = {
      id: `msg-${ts}-hb-err`,
      role: 'assistant',
      content: `⚠ HEARTBEAT 失敗 (source=${payload.source}): ${errMsg}`,
      timestamp: ts,
      heartbeat: true,
    }
    sessionsStore.updateMessages(target.id, [...target.messages, message])
  }

  /**
   * 新規 heartbeat session のタイトルを AI で要約して上書きする。失敗時は
   * 何もしない (= timestampTitle がそのまま残る)。ユーザーが間に手動 rename
   * していたら触らない。
   */
  async function generateHeartbeatTitleAsync(
    sessionId: string,
    initialTitle: string,
    reportText: string,
  ): Promise<void> {
    const provider: ProviderKey = config.value.provider
    const settings = config.value[provider]
    if (!settings.endpoint || !settings.model) return
    try {
      const raw = await titleGen.sendMessage({
        provider,
        endpoint: settings.endpoint,
        model: settings.model,
        history: [
          {
            id: 'u',
            role: 'user',
            content: `次の HEARTBEAT 通知の主題を端的に表す短いタイトルを付けてください。タイトルだけを 1 行で出力。\n\n${reportText}`,
            timestamp: 0,
          },
        ],
        system: HEARTBEAT_TITLE_SYSTEM_PROMPT,
        maxTokens: 80,
      })
      const cleaned = raw
        .replace(/[\r\n]+/g, ' ')
        .replace(/^[\s「『"'“”]+|[\s」』"'“”。．、]+$/g, '')
        .trim()
        .slice(0, 40)
      if (!cleaned) return
      const cur = sessionsStore.get(sessionId)
      if (cur && cur.title === initialTitle) {
        sessionsStore.setTitle(sessionId, cleaned)
      }
    } catch (e) {
      console.warn('[heartbeat-title-gen] failed:', e)
    }
  }

  // --- Rust scheduler 制御 ---

  async function configureScheduler(intervalMinutes: number): Promise<void> {
    if (!isTauri) return
    try {
      unwrap(await commands.heartbeatConfigure(intervalMinutes))
    } catch (e) {
      console.warn('[heartbeat] configure failed:', e)
    }
  }

  async function unconfigureScheduler(): Promise<void> {
    if (!isTauri) return
    try {
      unwrap(await commands.heartbeatUnconfigure())
    } catch (e) {
      console.warn('[heartbeat] unconfigure failed:', e)
    }
  }

  /**
   * Manual trigger は AI 設定の「今すぐ実行」ボタンが
   * `commands.heartbeatTriggerNow()` を直接叩くため、daemon 側からは export
   * しない。tick event はこの daemon の listener で拾われる。
   */

  watch(
    () => ({
      enabled: config.value.heartbeat.enabled,
      interval: config.value.heartbeat.intervalMinutes,
    }),
    async (next) => {
      if (next.enabled) {
        await configureScheduler(next.interval)
      } else {
        await unconfigureScheduler()
      }
    },
    { immediate: true, deep: true },
  )

  // --- tick listener (App lifecycle で 1 度だけ) ---
  ;(async () => {
    unlisten = await listen<HeartbeatTickPayload>(
      'nd:ai-heartbeat-tick',
      (event) => {
        if (isRunning.value) {
          console.debug(
            `[heartbeat] skip (already running) source=${event.payload.source}`,
          )
          return
        }
        isRunning.value = true
        runOnce(event.payload)
          .catch((e) => {
            console.warn('[heartbeat] daemon error:', e)
          })
          .finally(() => {
            isRunning.value = false
          })
      },
    )
  })()

  onScopeDispose(() => {
    if (unlisten) unlisten()
    void unconfigureScheduler()
  })

  // --- 1 tick 本処理 ---

  async function runOnce(payload: HeartbeatTickPayload): Promise<void> {
    const cfg = config.value.heartbeat
    if (!cfg.enabled) return

    // active account がいない (= 未ログイン) なら skip。アカウント context
    // 自体は capability 側で必要なものだけ参照する。
    if (!accountsStore.activeAccountId) {
      console.debug('[heartbeat] no active account, skip')
      return
    }

    // heartbeat 対象 skill 取得
    skillsStore.ensureLoaded()
    const heartbeatSkills = skillsStore.heartbeatSkills
    if (heartbeatSkills.length === 0) {
      console.debug('[heartbeat] no skills tagged as heartbeat, skip')
      return
    }
    const skillBodies: string[] = []
    for (const skill of heartbeatSkills) {
      const trimmed = skill.body.trim()
      if (trimmed.length === 0) continue
      skillBodies.push(`# Skill: ${skill.name}\n\n${trimmed}`)
    }
    if (skillBodies.length === 0) {
      console.debug('[heartbeat] heartbeat-tagged skills have empty body, skip')
      return
    }

    // ----- Cheap Check First (#411) -----
    // skill 側 frontmatter で `cheapCheckCapabilities: [...]` を宣言した
    // skill のみ機構が発動する。global toggle (cheapCheck.enabled=false) で
    // 完全停止可能。
    const now = Date.now()
    const newHashes = await collectCheapResults(heartbeatSkills, config.value)
    const prevState = loadCheapCheckState()
    const decision = decideCheapCheck(newHashes, prevState, config.value, now)
    if (!decision.shouldRunAi) {
      console.debug(
        `[heartbeat] cheap-check skip AI (reason=${decision.reason}, source=${payload.source})`,
      )
      // skip 時も hash は最新化 (= 次 tick で「変化あり」を検知できるように)。
      // lastAiRunAt は更新しない (= maxSkipHours は AI 起動時のみ更新)。
      saveCheapCheckState({
        lastResultsHash: {
          ...prevState.lastResultsHash,
          ...decision.newHashes,
        },
        lastAiRunAt: prevState.lastAiRunAt,
      })
      return
    }

    // ----- Daily AI runs limit (#411 安全装置) -----
    // 上限到達時の動作:
    //   'warn'    = toast 出して継続 (= AI 呼んで進める)
    //   'disable' = toast + heartbeat.enabled=false で daemon 停止
    const counter = tickDailyCounter(now)
    if (counter.count > cfg.dailyMaxAiRuns) {
      if (cfg.onDailyLimit === 'disable') {
        config.value.heartbeat.enabled = false
        toast.show(
          `HEARTBEAT を停止しました (本日 ${cfg.dailyMaxAiRuns} 回の AI 起動上限に到達)`,
          'warning',
        )
        return
      }
      // warn: toast を 1 日 1 回だけ出す (= count == limit+1 のときのみ)
      if (counter.count === cfg.dailyMaxAiRuns + 1) {
        toast.show(
          `HEARTBEAT: 本日の AI 起動上限 (${cfg.dailyMaxAiRuns} 回) を超えました (継続中)`,
          'warning',
        )
      }
    }

    // AI inference (HEARTBEAT 用 permissions で capabilities を絞り込んでから渡す)
    // 失敗は silent fail にせず error message を heartbeat session に残す。
    // 連続失敗で auto-disable してユーザー通知する。
    let responseText: string | null = null
    try {
      responseText = await runAiInference(skillBodies, payload)
      consecutiveFailures = 0
      // AI 起動成功 → cheap check state の hash + lastAiRunAt を全 skill 分更新
      const updatedAt: Record<string, number> = { ...prevState.lastAiRunAt }
      for (const skillId of Object.keys(decision.newHashes)) {
        updatedAt[skillId] = now
      }
      saveCheapCheckState({
        lastResultsHash: {
          ...prevState.lastResultsHash,
          ...decision.newHashes,
        },
        lastAiRunAt: updatedAt,
      })
    } catch (e) {
      consecutiveFailures += 1
      const errMsg = e instanceof Error ? e.message : String(e)
      console.warn(
        `[heartbeat] inference failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
        e,
      )
      await appendErrorMessage(errMsg, payload)
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        config.value.heartbeat.enabled = false
        consecutiveFailures = 0
        toast.show(
          `HEARTBEAT を停止しました (${MAX_CONSECUTIVE_FAILURES} 回連続失敗)`,
          'warning',
        )
      }
      return
    }
    if (responseText === null) return

    const visible = applyHeartbeatSuppression(responseText)
    if (visible === null) {
      console.debug(
        `[heartbeat] AI returned OK / short-ack, suppress (source=${payload.source})`,
      )
      return
    }

    // target session に append (target='none' なら log のみ)
    const provider: ProviderKey = config.value.provider
    const settings = config.value[provider]
    // session が新規作成されるかを resolveTargetSession 呼び出し前に判定。
    // target='auto' で既存 heartbeat session が無い場合だけ新規作成される。
    const willCreateNew =
      cfg.target === 'auto' &&
      !Array.from(sessionsStore.sessions.values()).some(
        (s) => s.kind === 'heartbeat',
      )
    const target = await resolveTargetSession(
      cfg.target,
      sessionsStore,
      settings.model,
      provider,
    )
    if (!target) {
      console.debug(
        `[heartbeat] target='${cfg.target}' resolved to null, log only: ${visible.slice(0, 80)}`,
      )
      return
    }
    const ts = Date.now()
    const message: ChatMessage = {
      id: `msg-${ts}-hb`,
      role: 'assistant',
      content: visible,
      timestamp: ts,
      heartbeat: true,
    }
    sessionsStore.updateMessages(target.id, [...target.messages, message])

    // OS デスクトップ通知 (#411 0.19.0): 「重要発見」を即気付ける。
    // - cfg.desktopNotification=false なら出さない (= ユーザー opt-out)
    // - sendDesktopNotification 内で document.hasFocus() を見て、アプリに
    //   フォーカスあれば自動抑制 (= ユーザーが既にアプリを見ている)
    // - 通知 body は長文をブラウザ側で切り詰められるので 200 文字 trim
    if (cfg.desktopNotification) {
      const body = visible.length > 200 ? `${visible.slice(0, 200)}…` : visible
      sendDesktopNotification('HEARTBEAT', body)
    }

    // 新規 session のときだけ AI でタイトル要約を試す。失敗したら
    // timestampTitle ('YYYY-MM-DD HH:mm のHEARTBEAT') がそのまま残る。
    if (willCreateNew) {
      void generateHeartbeatTitleAsync(target.id, target.title, visible)
    }
  }

  /**
   * AI inference 本体。tool_use loop で最終 assistant text を返す。
   * UI streaming 表示は省略 (heartbeat は背景処理なので live 更新不要)。
   *
   * Capabilities は HEARTBEAT 用 permissions (`config.heartbeat.permissions`)
   * で resolve した permission map と照合し、required permissions を満たす
   * ものだけを AI に渡す (= 暴走防止 / chat 側の permissions とは独立)。
   */
  async function runAiInference(
    skillBodies: string[],
    payload: HeartbeatTickPayload,
  ): Promise<string | null> {
    const provider: ProviderKey = config.value.provider
    const settings = config.value[provider]
    if (!settings.endpoint || !settings.model) {
      console.debug('[heartbeat] AI provider not configured, skip')
      return null
    }

    const initialUser: ChatMessage = {
      id: `msg-${Date.now()}-hb-u`,
      role: 'user',
      content: `Heartbeat tick at ${new Date(payload.triggered_at_ms).toISOString()}`,
      timestamp: Date.now(),
    }
    const history: ChatMessage[] = [initialUser]

    const granted = resolvePermissions(config.value.heartbeat.permissions)
    const eligibleCaps = listCapabilities().filter((c) => {
      if (!c.aiTool || !c.signature) return false
      // 全 required permission が granted か (= 1 つでも欠けたら除外)
      return (c.permissions ?? []).every((p) => granted[p])
    })
    const tools: unknown[] | undefined =
      eligibleCaps.length === 0
        ? undefined
        : provider === 'anthropic'
          ? eligibleCaps.map(toAnthropicTool)
          : eligibleCaps.map(toOpenAiTool)

    // memos は active account のものだけを context に含める (#464)。
    // heartbeat は currentColumn=null だが memos は column 非依存なので
    // ds.memos が ON なら自律 tick からも参照される。
    await ensureMemosLoaded()
    const heartbeatActiveAccountId = accountsStore.activeAccount?.id ?? null
    const heartbeatMemoEntries = heartbeatActiveAccountId
      ? Object.entries(loadAllMemos(heartbeatActiveAccountId))
      : []

    // chat と同じく memosConfig.excludeTags / expandLinks / includeBacklinks を
    // 尊重 (#492 / #494)
    const heartbeatMemosCfg = config.value.dataSources.memosConfig
    const heartbeatAllMemos = heartbeatActiveAccountId
      ? new Map([
          [heartbeatActiveAccountId, loadAllMemos(heartbeatActiveAccountId)],
        ])
      : new Map()
    const notedeckContext = buildAiContextBlock(config.value, {
      activeAccount: accountsStore.activeAccount,
      currentColumn: null,
      memos: projectMemos(heartbeatMemoEntries, {
        excludeTags: heartbeatMemosCfg?.excludeTags,
        expandLinks: heartbeatMemosCfg?.expandLinks !== false,
        includeBacklinks: heartbeatMemosCfg?.includeBacklinks !== false,
        allMemosByAccount: heartbeatAllMemos,
      }),
      accounts: accountsStore.accounts,
    })
    const heartbeatContext = `<heartbeat-skills>\n${skillBodies.join('\n\n---\n\n')}\n</heartbeat-skills>`
    const system = composeHeartbeatSystemPrompt(
      '', // skills の always prompt は heartbeat 中は使わない
      notedeckContext,
      heartbeatContext,
      HEARTBEAT_INSTRUCTION,
    )

    let finalText = ''
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let pendingToolUse: ToolUseEvent | null = null
      const turnText = await aiChat.sendMessage({
        provider,
        endpoint: settings.endpoint,
        model: settings.model,
        history,
        system,
        tools,
        onToolUse: (e) => {
          pendingToolUse = e
        },
      })

      if (!pendingToolUse) {
        finalText = turnText
        break
      }
      const toolUse: ToolUseEvent = pendingToolUse
      const dispatch = await dispatchCapability(
        toolUse.name,
        toolUse.input,
        config.value,
      )
      const resultText = dispatch.ok
        ? typeof dispatch.result === 'string'
          ? dispatch.result
          : JSON.stringify(dispatch.result)
        : `Error (${dispatch.code}): ${dispatch.error}`
      const ts = Date.now()
      history.push({
        id: `msg-${ts}-hb-a${round}`,
        role: 'assistant',
        content: turnText,
        timestamp: ts,
        toolUseId: toolUse.toolUseId,
        toolUseName: toolUse.name,
        toolUseInput: toolUse.input,
      })
      history.push({
        id: `msg-${ts}-hb-r${round}`,
        role: 'user',
        content: resultText,
        timestamp: ts,
        toolResultFor: toolUse.toolUseId,
      })
    }

    return finalText
  }

  // App.vue が daemon を mount するだけで使う (provide/inject なし)。
  // 今後 daemon の状態 (isRunning 等) を UI に出したくなったら return に
  // 追加する。
  return {
    isRunning: computed(() => isRunning.value),
  }
}

/** test 用に export */
export const _internal = {
  HEARTBEAT_OK_TOKEN,
  HEARTBEAT_INSTRUCTION,
  resolveTargetSession,
}
