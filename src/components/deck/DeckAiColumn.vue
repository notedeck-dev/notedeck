<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { listCapabilities } from '@/capabilities/registry'
import { toAnthropicTool, toOpenAiTool } from '@/capabilities/toolSchema'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import {
  type ChatMessage,
  type ToolUseEvent,
  useAiChat,
} from '@/composables/useAiChat'
import {
  reloadAiConfig,
  resolveAiConnection,
  useAiConfig,
} from '@/composables/useAiConfig'
import { useAiConversation } from '@/composables/useAiConversation'
import {
  buildAiContextBlock,
  joinSystemPrompt,
  projectMemos,
  projectRecentConversation,
  projectVisibleItems,
} from '@/composables/useAiSystemContext'
import { ensureMemosLoaded, loadAllMemos } from '@/composables/useMemos'
import { isSlashCommand, runSlashCommand } from '@/composables/useSlashCommand'
import { describeAuthType, useVault } from '@/composables/useVault'
import { useAccountsStore } from '@/stores/accounts'
import { type AiSessionMeta, useAiSessionsStore } from '@/stores/aiSessions'
import { useConfirm } from '@/stores/confirm'
import {
  type DeckColumn,
  TIMELINE_LIKE_COLUMN_TYPES,
  useDeckStore,
} from '@/stores/deck'
import { usePrompt } from '@/stores/prompt'
import { useSkillsStore } from '@/stores/skills'
import { useToast } from '@/stores/toast'
import { timestampTitle } from '@/utils/aiSessionTitle'
import { highlightCode, highlighterLoaded } from '@/utils/highlight'
import { resolveIdentity } from '@/utils/identity'
import { renderSimpleMarkdown } from '@/utils/simpleMarkdown'
import DeckColumnComponent from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumn
}>()

const input = ref('')
// `ref="inputRef"` を template で利用しているが、現状 script からの read 利用は無し。
// 将来 focus 制御を再導入したくなった時のため shape は残しておく。
const _inputRef = useTemplateRef<HTMLTextAreaElement>('inputRef')
void _inputRef
const messagesEndRef = ref<HTMLElement | null>(null)
const providerStatus = ref<'connected' | 'disconnected' | 'checking'>(
  'checking',
)

const skillsStore = useSkillsStore()
skillsStore.ensureLoaded()

const sessionsStore = useAiSessionsStore()
const deckStore = useDeckStore()
const accountsStore = useAccountsStore()
const vault = useVault()

void sessionsStore.loadAllMeta()
// メモは <memos> データソースとして AI context に注入し得るので、
// AI カラムが mount された時点で in-memory cache をウォームアップしておく
// (sendMessage は同期 cache 取得しか行わないため)。
void ensureMemosLoaded()

const { config: aiConfig } = useAiConfig()
const aiChat = useAiChat()
// 初回応答後にバックグラウンドでタイトルを AI 生成するための独立インスタンス。
// `aiChat` の isStreaming や activeStreamId と干渉しないよう別 composable 化。
const titleGen = useAiChat()

// `column.aiCurrentSessionId` を reactive に橋渡し。useAiConversation は
// この ref の変化を購読してメッセージ参照を切り替える。
const currentSessionId = computed(() => props.column.aiCurrentSessionId ?? null)

// Persona (#491) — session 作成時に snapshot された session.personaSkillId
// から解決。aiConfig.personaSkillId は新規 session のデフォルトに過ぎず、
// 過去 session の persona 表示を上書きしない (= Git commit Author 型 immutable)。
// dangling (skill 削除 / isPersona OFF) のときは null。
const currentSession = computed(() =>
  currentSessionId.value
    ? (sessionsStore.get(currentSessionId.value) ?? null)
    : null,
)
const currentPersona = computed(() => {
  const id = currentSession.value?.personaSkillId
  return id ? resolveIdentity(`skill:${id}`) : null
})

const conversation = useAiConversation(currentSessionId)
const messages = conversation.messages
const isGenerating = aiChat.isStreaming

// HEARTBEAT (#411): App-level singleton daemon が tick / runner を担当する。
// AI カラムからは何も呼ばない (heartbeat session を見たければ session 一覧の
// 「💓 HEARTBEAT」section pin から開く / manual trigger は AI 設定で叩く)。

// view mode は currentSessionId の有無で決まる:
// - sessions = アイコンの一覧 + 「新しいチャット」 (Misskey の DM 一覧と同じ役割)
// - chat = 選択中セッションのメッセージ + 入力欄
const viewMode = computed<'sessions' | 'chat'>(() =>
  currentSessionId.value ? 'chat' : 'sessions',
)

// --- セッション一覧グルーピング ---
interface SessionGroup {
  label: string
  items: AiSessionMeta[]
}

function startOfDay(dt: Date): number {
  const d = new Date(dt)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// kind 別 icon (session 一覧で各 row に表示、OpenClaw 風の統一見た目)。
// 未知の kind は ti-message-circle (chat) にフォールバック。
const SESSION_KIND_ICON: Record<string, string> = {
  chat: 'ti-message-circle',
  heartbeat: 'ti-activity-heartbeat',
  command: 'ti-terminal-2',
  // タスクカラムの各タスク行 runIcon (default 'ti-player-play') と統一
  task: 'ti-player-play',
}

function sessionKindIcon(kind: string): string {
  return SESSION_KIND_ICON[kind] ?? 'ti-message-circle'
}

const groupedSessions = computed<SessionGroup[]>(() => {
  const sessions = sessionsStore.listSorted()
  const today = startOfDay(new Date())
  const yesterday = today - 24 * 60 * 60 * 1000
  const last7 = today - 7 * 24 * 60 * 60 * 1000

  // HEARTBEAT session は専用 section として最上位 pin (OpenClaw 流)。
  // chat / その他は updatedAt で日付別グルーピング。
  const heartbeatItems: AiSessionMeta[] = []
  const todayItems: AiSessionMeta[] = []
  const yesterdayItems: AiSessionMeta[] = []
  const lastWeekItems: AiSessionMeta[] = []
  const olderItems: AiSessionMeta[] = []

  for (const s of sessions) {
    if (s.kind === 'heartbeat') {
      heartbeatItems.push(s)
      continue
    }
    if (s.updatedAt >= today) todayItems.push(s)
    else if (s.updatedAt >= yesterday) yesterdayItems.push(s)
    else if (s.updatedAt >= last7) lastWeekItems.push(s)
    else olderItems.push(s)
  }

  const groups: SessionGroup[] = []
  if (heartbeatItems.length)
    groups.push({ label: '💓 HEARTBEAT', items: heartbeatItems })
  if (todayItems.length) groups.push({ label: '今日', items: todayItems })
  if (yesterdayItems.length)
    groups.push({ label: '昨日', items: yesterdayItems })
  if (lastWeekItems.length)
    groups.push({ label: '過去 7 日', items: lastWeekItems })
  if (olderItems.length) groups.push({ label: 'それ以前', items: olderItems })
  return groups
})

const totalSessions = computed(() => sessionsStore.listSorted().length)
const searchQuery = ref('')

const filteredGroupedSessions = computed<SessionGroup[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return groupedSessions.value
  return groupedSessions.value
    .map((g) => ({
      label: g.label,
      items: g.items.filter((s) =>
        (s.title || '無題のチャット').toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.items.length > 0)
})

const hasNoSearchHits = computed(
  () =>
    searchQuery.value.trim().length > 0 &&
    filteredGroupedSessions.value.length === 0,
)

function relativeTime(epoch: number): string {
  const diff = Date.now() - epoch
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'たった今'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 時間前`
  const d = new Date(epoch)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const currentSessionTitle = computed(() => {
  const id = currentSessionId.value
  if (!id) return null
  return sessionsStore.get(id)?.title || '無題のチャット'
})

const headerTitle = computed(() => {
  if (viewMode.value === 'chat' && currentSessionTitle.value) {
    return currentSessionTitle.value
  }
  return props.column.name || 'AI'
})

// --- ナビゲーション ---

function openSession(sessionId: string): void {
  if (aiChat.isStreaming.value) {
    void aiChat.cancel()
  }
  deckStore.updateColumn(props.column.id, { aiCurrentSessionId: sessionId })
}

function backToSessions(): void {
  if (aiChat.isStreaming.value) {
    void aiChat.cancel()
  }
  deckStore.updateColumn(props.column.id, { aiCurrentSessionId: null })
  input.value = ''
}

// --- セッション操作 (rename / delete) ---

const { prompt } = usePrompt()
const { confirm } = useConfirm()
const toast = useToast()

async function onRenameSession(
  e: MouseEvent,
  sessionId: string,
): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  const cur = sessionsStore.get(sessionId)
  if (!cur) return
  const next = await prompt({
    title: 'セッション名を変更',
    defaultValue: cur.title,
    placeholder: 'セッション名',
  })
  if (next == null) return
  sessionsStore.setTitle(sessionId, next.trim())
  toast.show('セッション名を変更しました')
}

async function onDeleteSession(
  e: MouseEvent,
  sessionId: string,
): Promise<void> {
  e.preventDefault()
  e.stopPropagation()
  const cur = sessionsStore.get(sessionId)
  if (!cur) return
  const ok = await confirm({
    title: 'セッションを削除',
    message: `「${cur.title || '無題のチャット'}」を削除しますか？この操作は取り消せません。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  // 削除対象が現在開いているセッションなら一覧画面に戻す
  if (currentSessionId.value === sessionId) {
    if (aiChat.isStreaming.value) {
      void aiChat.cancel()
    }
    deckStore.updateColumn(props.column.id, { aiCurrentSessionId: null })
  }
  await sessionsStore.deleteSession(sessionId)
  toast.show('セッションを削除しました')
}

// --- プロバイダー接続チェック ---
//
// AI プロバイダーは Vault 接続 (#564) に統合済み。activeConnectionId が指す
// 接続が存在し、protocol が設定され、secret が登録され、model が指定済みなら
// 'connected'。

async function checkProvider(): Promise<void> {
  providerStatus.value = 'checking'
  try {
    await vault.refresh()
    const resolved = resolveAiConnection(
      aiConfig.value,
      vault.connections.value,
    )
    const ready =
      resolved !== null &&
      resolved.model.length > 0 &&
      (resolved.connection.slots?.length ?? 0) > 0
    providerStatus.value = ready ? 'connected' : 'disconnected'
  } catch {
    providerStatus.value = 'disconnected'
  }
}

watch(
  () => [
    aiConfig.value.activeConnectionId,
    aiConfig.value.models[aiConfig.value.activeConnectionId],
    vault.connections.value,
  ],
  () => {
    void checkProvider()
  },
  { immediate: true, deep: true },
)

// --- スクロール ---

function scrollToBottom() {
  nextTick(() => {
    messagesEndRef.value?.scrollIntoView({ behavior: 'smooth' })
  })
}

watch(currentSessionId, () => {
  scrollToBottom()
})

// 進行中ストリームのセッション ID。currentSessionId の reactive 反映を
// 待たずに watch から直接 store を更新するために保持する。
const activeStreamSessionId = ref<string | null>(null)

// Stream deltas → update last assistant message in-place
watch(aiChat.currentText, (text) => {
  if (!aiChat.isStreaming.value || !text) return
  const sid = activeStreamSessionId.value
  if (!sid) return
  const cur = sessionsStore.get(sid)
  if (!cur) return
  const last = cur.messages[cur.messages.length - 1]
  if (last?.role !== 'assistant') return
  const updated = [...cur.messages.slice(0, -1), { ...last, content: text }]
  sessionsStore.updateMessages(sid, updated)
  scrollToBottom()
})

// --- 送信 ---

/**
 * 初回 round 完了後にバックグラウンドで AI にタイトルを生成させる。
 * - 会話 (user + assistant) を 1 つの user メッセージにまとめて送る。
 *   Anthropic は last message が assistant だと assistant 応答の続きとして
 *   扱うため、history には絶対に assistant role を置かない。
 * - 失敗は silent (best-effort)
 * - ユーザーが手動 rename したら上書きしない (titleBefore で race 対策)
 * - LLM 応答に余計な引用符や改行が混じる場合があるので軽く整形する
 */
const TITLE_SYSTEM_PROMPT =
  'あなたは会話セッションのタイトル生成アシスタントです。与えられた会話の内容を端的に表す短い日本語のタイトルを 1 行で出力してください。20 文字程度 (最大 40 文字) に収めること。引用符、前置き、改行、絵文字、文末句点は付けないでください。タイトルのみを返してください。'

async function generateAiTitleAsync(
  sessionId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  // 初期プレースホルダー (timestampTitle) は sendMessage 側で既にセット済み。
  // AI 生成に失敗した場合は何もせず、プレースホルダーがそのまま残る。
  if (providerStatus.value !== 'connected') return
  const before = sessionsStore.get(sessionId)
  if (!before) return
  const titleBefore = before.title
  const resolved = resolveAiConnection(aiConfig.value, vault.connections.value)
  if (!resolved || !resolved.model) return

  // 会話を 1 つの user メッセージに集約する。assistant role を history に
  // 置くと Anthropic 側が「続きを書く」モードになりタイトルが取れない。
  const conversationPrompt =
    `次の会話に短いタイトルを付けてください。タイトルだけを 1 行で出力。\n\n` +
    `ユーザー:\n${userText}\n\nアシスタント:\n${assistantText}`

  try {
    const raw = await titleGen.sendMessage({
      connectionId: resolved.connection.id,
      model: resolved.model,
      history: [
        { id: 'u', role: 'user', content: conversationPrompt, timestamp: 0 },
      ],
      system: TITLE_SYSTEM_PROMPT,
      maxTokens: 80,
    })
    const cleaned = raw
      .replace(/[\r\n]+/g, ' ')
      .replace(/^[\s「『"'“”]+|[\s」』"'“”。．、]+$/g, '')
      .trim()
      .slice(0, 40)
    if (!cleaned) return
    // ユーザーが間に手動 rename していたら触らない
    const cur = sessionsStore.get(sessionId)
    if (cur && cur.title === titleBefore) {
      sessionsStore.setTitle(sessionId, cleaned)
    }
  } catch (e) {
    console.warn('[ai-title-gen] failed:', e)
  }
}

/** 必要なら新規セッションを作って ID を返す。 */
function ensureSession(): string {
  if (currentSessionId.value) return currentSessionId.value
  // Persona (#491): 新規 session 作成時に aiConfig.personaSkillId を snapshot。
  // 後で global 設定を変更しても過去 session の persona は固定されたまま
  // (= Git commit の Author header と同じ immutable semantic)。
  const resolved = resolveAiConnection(aiConfig.value, vault.connections.value)
  const session = sessionsStore.createNew({
    model: resolved?.model ?? '',
    connectionId: aiConfig.value.activeConnectionId,
    personaSkillId: aiConfig.value.personaSkillId || undefined,
  })
  deckStore.updateColumn(props.column.id, {
    aiCurrentSessionId: session.id,
  })
  return session.id
}

async function sendMessage() {
  const text = input.value.trim()
  if (!text || aiChat.isStreaming.value) return

  // Slash コマンドは AI を経由せず capability を直接実行する経路。
  // provider 未接続でも動くので、provider check より先に分岐する。
  if (isSlashCommand(text)) {
    input.value = ''
    await runSlashAndAppend(text)
    return
  }

  if (providerStatus.value !== 'connected') return

  // ensureSession の戻り値 (sessionId) を以降のすべての store 更新に直接使う。
  // currentSessionId は computed(props.column.aiCurrentSessionId) で、
  // updateColumn 直後の再評価タイミングに依存したくないため。
  const sessionId = ensureSession()

  const resolved = resolveAiConnection(aiConfig.value, vault.connections.value)
  if (!resolved) return

  const now = Date.now()
  const userMsg: ChatMessage = {
    id: `msg-${now}-u`,
    role: 'user',
    content: text,
    timestamp: now,
  }

  const before = sessionsStore.get(sessionId)
  if (!before) return
  sessionsStore.updateMessages(sessionId, [...before.messages, userMsg])
  input.value = ''
  scrollToBottom()

  // この round が assistant 応答のない初回かどうかを記録 (AI 生成タイトル用)。
  const wasFirstRound = !before.messages.some((m) => m.role === 'assistant')

  // 初期プレースホルダーは Zettelkasten 形式の日時タイトル。
  // 初回応答完了後に AI 生成タイトルが届けば上書きされる (失敗時は残る)。
  if (!before.title) {
    sessionsStore.setTitle(sessionId, timestampTitle(new Date(now)))
  }

  // Pre-add empty assistant placeholder so streaming has a target slot
  const assistantMsg: ChatMessage = {
    id: `msg-${now}-a`,
    role: 'assistant',
    content: '',
    timestamp: now,
  }
  const afterUser = sessionsStore.get(sessionId)
  if (!afterUser) return
  sessionsStore.updateMessages(sessionId, [...afterUser.messages, assistantMsg])
  scrollToBottom()

  activeStreamSessionId.value = sessionId

  // Persona (#491) — session 作成時 snapshot された personaSkillId を読む
  // (= 過去 session は当時の persona、新規 session は aiConfig 由来のデフォルト)。
  // skill body を skillsPrompt に session-only で含め、<persona> block を
  // system prompt に注入。dangling 時は通常チャット動作。
  const personaSkillId =
    sessionsStore.get(sessionId)?.personaSkillId || undefined
  const personaIdentity = personaSkillId
    ? resolveIdentity(`skill:${personaSkillId}`)
    : null
  // identity が解決できない (= 該当 skill 不在 or isPersona=false) なら扱わない
  const effectivePersonaSkillId = personaIdentity ? personaSkillId : undefined
  const skillsPrompt =
    skillsStore.composedSystemPrompt(
      effectivePersonaSkillId ? [effectivePersonaSkillId] : [],
      effectivePersonaSkillId,
    ) || ''
  // ユーザーが Timeline をクリックしていないケースに備えて、fallback として
  // 画面上に存在する最初の TIMELINE_LIKE カラムを使う。
  const focusedColumnId =
    deckStore.lastFocusedTimelineColumnId ??
    deckStore.columns.find((c) => TIMELINE_LIKE_COLUMN_TYPES.has(c.type))?.id ??
    null
  const focusedColumn = focusedColumnId
    ? deckStore.getColumn(focusedColumnId)
    : null
  const visibleNotesRaw = focusedColumnId
    ? deckStore.visibleNotesByColumn[focusedColumnId]
    : undefined

  // Tool calling に使う tools 配列を provider に応じて組み立て。
  // 登録済み capability のうち aiTool: true なものを変換。
  const eligibleCaps = listCapabilities().filter((c) => c.aiTool && c.signature)
  const toolsForProvider: unknown[] | undefined =
    eligibleCaps.length === 0
      ? undefined
      : resolved.protocol === 'anthropic'
        ? eligibleCaps.map(toAnthropicTool)
        : eligibleCaps.map(toOpenAiTool)

  // tool_use ループで暴走しないための上限。1 ターン中に AI が連続で tool を
  // 呼び続けるケースを抑える (普通は 1〜2 回で止まる)。
  const MAX_TOOL_ROUNDS = 5
  let toolRound = 0
  let placeholderId = assistantMsg.id
  let finalAssistantText = ''

  try {
    while (true) {
      // 現セッションから wire history を組み立て (placeholder のみ除外)。
      // system role の中間メッセージは入らない設計だが、念のため除外する。
      const history = (sessionsStore.get(sessionId)?.messages ?? []).filter(
        (m) =>
          m.role !== 'system' &&
          m.id !== placeholderId &&
          // heartbeat 由来 message は AI history から除外 (#411)
          // ユーザーは見えるが AI には見せない (= 文脈を汚さない)
          !m.heartbeat,
      )

      // memos は active account のものだけを context に含める。AI カラム自体は
      // cross-account だが、メモは per-account 設計なので「いま操作中の account
      // の draft / Zettelkasten」が一番文脈として明確。
      const activeAccountId = accountsStore.activeAccount?.id ?? null
      const memoEntries = activeAccountId
        ? Object.entries(loadAllMemos(activeAccountId))
        : []

      // memosConfig.excludeTags があれば AI 注入から該当 tag メモを除外 (#492)。
      // expandLinks / includeBacklinks (#494) も同 config で制御 (default true)。
      const memosCfg = aiConfig.value.dataSources.memosConfig
      const allMemosByAccount = activeAccountId
        ? new Map([[activeAccountId, loadAllMemos(activeAccountId)]])
        : new Map()

      // Secret Vault (#564): aiVisible な接続を AI に開示する。
      // secret / id は渡さず name / baseUrl / auth のみ projection する。
      await vault.refresh()
      const availableConnections = vault.connections.value
        .filter((c) => c.aiVisible)
        .map((c) => ({
          name: c.name,
          baseUrl: c.baseUrl,
          auth: describeAuthType(c.authType),
        }))

      const contextBlock = buildAiContextBlock(aiConfig.value, {
        activeAccount: accountsStore.activeAccount,
        currentColumn: focusedColumn ?? props.column,
        visibleNotes: projectVisibleItems(visibleNotesRaw, focusedColumn?.type),
        recentConversation: projectRecentConversation(history),
        memos: projectMemos(memoEntries, {
          excludeTags: memosCfg?.excludeTags,
          expandLinks: memosCfg?.expandLinks !== false,
          includeBacklinks: memosCfg?.includeBacklinks !== false,
          allMemosByAccount,
        }),
        accounts: accountsStore.accounts,
        persona: personaIdentity
          ? {
              id: personaIdentity.id,
              displayName: personaIdentity.displayName,
              bio: personaIdentity.bio,
            }
          : undefined,
        availableConnections,
      })
      const system = joinSystemPrompt(skillsPrompt, contextBlock)

      let pendingToolUse: ToolUseEvent | null = null
      const turnText = await aiChat.sendMessage({
        connectionId: resolved.connection.id,
        model: resolved.model,
        history,
        system,
        tools: toolsForProvider,
        onToolUse: (e) => {
          pendingToolUse = e
        },
      })

      if (turnText) finalAssistantText = turnText

      if (!pendingToolUse) break

      if (toolRound >= MAX_TOOL_ROUNDS) {
        finalAssistantText =
          (turnText || finalAssistantText) +
          `\n\n⚠️ tool 呼び出しが上限 (${MAX_TOOL_ROUNDS} 回) に達しました。`
        break
      }
      toolRound++

      // pendingToolUse を非 null として明示 (TS narrowing)
      const toolUse: ToolUseEvent = pendingToolUse

      // 外部エディタで ai.json5 を変更した直後でも最新の permission で
      // 判定したいので、tool 実行直前に再読込する (= 再起動不要)。失敗しても
      // 既存 cache で続行。
      try {
        await reloadAiConfig()
      } catch (e) {
        console.warn('[ai-column] reloadAiConfig before dispatch failed:', e)
      }

      // capability dispatch (permissions チェック込み)
      const dispatch = await dispatchCapability(
        toolUse.name,
        toolUse.input,
        aiConfig.value,
      )
      const resultText = dispatch.ok
        ? typeof dispatch.result === 'string'
          ? dispatch.result
          : JSON.stringify(dispatch.result)
        : `Error (${dispatch.code}): ${dispatch.error}`

      // session 更新: placeholder を「中間テキスト + tool_use」として確定し、
      // tool_result + 新しい placeholder を追加する。
      const cur = sessionsStore.get(sessionId)
      if (!cur) break
      const ts = Date.now()
      const messagesWithoutPlaceholder = cur.messages.filter(
        (m) => m.id !== placeholderId,
      )
      const assistantWithToolUse: ChatMessage = {
        id: placeholderId,
        role: 'assistant',
        content: turnText,
        timestamp: ts,
        toolUseId: toolUse.toolUseId,
        toolUseName: toolUse.name,
        toolUseInput: toolUse.input,
      }
      const toolResultMsg: ChatMessage = {
        id: `msg-${ts}-r${toolRound}`,
        role: 'user',
        content: resultText,
        timestamp: ts,
        toolResultFor: toolUse.toolUseId,
      }
      const nextPlaceholderId = `msg-${ts}-a${toolRound}`
      const nextAssistant: ChatMessage = {
        id: nextPlaceholderId,
        role: 'assistant',
        content: '',
        timestamp: ts,
      }
      sessionsStore.updateMessages(sessionId, [
        ...messagesWithoutPlaceholder,
        assistantWithToolUse,
        toolResultMsg,
        nextAssistant,
      ])
      placeholderId = nextPlaceholderId
      scrollToBottom()
    }

    // 最終 assistant テキストを placeholder に書き戻す。
    const cur = sessionsStore.get(sessionId)
    if (cur) {
      const last = cur.messages[cur.messages.length - 1]
      if (
        last?.role === 'assistant' &&
        last.id === placeholderId &&
        last.content !== finalAssistantText
      ) {
        sessionsStore.updateMessages(sessionId, [
          ...cur.messages.slice(0, -1),
          { ...last, content: finalAssistantText },
        ])
      }
    }
    // 初回 round 完了後にバックグラウンドで AI にタイトルを再生成させる
    if (wasFirstRound && finalAssistantText) {
      void generateAiTitleAsync(sessionId, text, finalAssistantText)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const cur = sessionsStore.get(sessionId)
    if (cur) {
      const last = cur.messages[cur.messages.length - 1]
      if (last?.role === 'assistant' && last.id === placeholderId) {
        sessionsStore.updateMessages(sessionId, [
          ...cur.messages.slice(0, -1),
          { ...last, content: `⚠️ ${message}` },
        ])
      }
    }
  }
  activeStreamSessionId.value = null
  scrollToBottom()
}

/**
 * `/cmd ...` を AI を経由せず直接実行し、tool_use 風の 2 メッセージで履歴に残す。
 * - user message: 入力文字列そのまま
 * - assistant message: toolUseId/toolUseName/toolUseInput を埋めて UI で展開可能に
 * - user (tool_result) message: dispatch 結果 / エラー文字列
 */
async function runSlashAndAppend(text: string): Promise<void> {
  const sessionId = ensureSession()
  const before = sessionsStore.get(sessionId)
  if (!before) return

  const now = Date.now()
  const userMsg: ChatMessage = {
    id: `msg-${now}-u`,
    role: 'user',
    content: text,
    timestamp: now,
  }
  sessionsStore.updateMessages(sessionId, [...before.messages, userMsg])
  if (!before.title) {
    sessionsStore.setTitle(sessionId, timestampTitle(new Date(now)))
  }
  scrollToBottom()

  const result = await runSlashCommand(text, aiConfig.value)

  const ts = Date.now()
  const params = 'params' in result && result.params ? result.params : undefined
  const resultText = result.ok
    ? typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result, null, 2)
    : `Error (${result.kind}): ${result.error}`

  const assistantToolUse: ChatMessage = {
    id: `msg-${ts}-a`,
    role: 'assistant',
    content: '',
    timestamp: ts,
    toolUseId: result.slashUseId,
    toolUseName: result.displayName,
    toolUseInput: params,
  }
  const toolResultMsg: ChatMessage = {
    id: `msg-${ts}-r`,
    role: 'user',
    content: resultText,
    timestamp: ts,
    toolResultFor: result.slashUseId,
  }

  const cur = sessionsStore.get(sessionId)
  if (!cur) return
  sessionsStore.updateMessages(sessionId, [
    ...cur.messages,
    assistantToolUse,
    toolResultMsg,
  ])
  scrollToBottom()
}

// --- Tool message UI ---
// 折りたたみ状態: msg.id → 展開中か。明示的に展開されたものだけが詳細を見せる。
const expandedToolDetails = ref<Record<string, boolean>>({})

function toggleToolDetail(msgId: string) {
  expandedToolDetails.value = {
    ...expandedToolDetails.value,
    [msgId]: !expandedToolDetails.value[msgId],
  }
}

function isToolUseMessage(msg: ChatMessage): boolean {
  return msg.role === 'assistant' && Boolean(msg.toolUseId && msg.toolUseName)
}

function isToolResultMessage(msg: ChatMessage): boolean {
  return msg.role === 'user' && Boolean(msg.toolResultFor)
}

const TOOL_RESULT_PREVIEW_LIMIT = 120

function truncateToolPreview(s: string): string {
  if (s.length <= TOOL_RESULT_PREVIEW_LIMIT) return s
  return `${s.slice(0, TOOL_RESULT_PREVIEW_LIMIT)}…`
}

function formatToolInput(input: Record<string, unknown> | undefined): string {
  if (!input || Object.keys(input).length === 0) return '(no arguments)'
  return JSON.stringify(input, null, 2)
}

/** tool 結果文字列が JSON-shaped か判定 (`{` / `[` 始まりなら highlight 対象) */
function looksLikeJson(s: string): boolean {
  if (!s) return false
  const t = s.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

// --- コピー ---

const copiedMessageId = ref<string | null>(null)

async function copyMessage(msg: ChatMessage) {
  try {
    await navigator.clipboard.writeText(msg.content)
    copiedMessageId.value = msg.id
    setTimeout(() => {
      if (copiedMessageId.value === msg.id) copiedMessageId.value = null
    }, 1500)
  } catch (e) {
    console.warn('[ai-chat] copy failed:', e)
  }
}

function renderAssistant(content: string): string {
  return renderSimpleMarkdown(content)
}

function onAssistantContentClick(e: MouseEvent) {
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  const btn = target.closest('button[data-md-copy]')
  if (!(btn instanceof HTMLButtonElement)) return
  const pre = btn.closest('pre')
  const code = pre?.querySelector('code')
  if (!code) return
  const text = code.textContent ?? ''
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const original = btn.textContent
      btn.textContent = 'コピー済み'
      window.setTimeout(() => {
        btn.textContent = original
      }, 1500)
    })
    .catch((err) => {
      console.warn('[ai-chat] code copy failed:', err)
    })
}

// 入力欄の自動高さ調整は textarea の `field-sizing: content` (CSS) に委ねる。

/** slash コマンド入力中か (= AI provider 接続有無に関わらず送信可) */
const inputIsSlash = computed(() => isSlashCommand(input.value.trim()))

/** 送信ボタンを押せる条件: 入力非空 + (slash か provider 接続済み) */
const canSubmit = computed(
  () =>
    input.value.trim().length > 0 &&
    (inputIsSlash.value || providerStatus.value === 'connected'),
)

/** textarea を有効化する条件: provider 接続済み or slash モード */
const inputEnabled = computed(
  () => providerStatus.value === 'connected' || inputIsSlash.value,
)

const aiMessagesRef = useTemplateRef<HTMLElement>('aiMessagesRef')

const sessionsListRef = useTemplateRef<HTMLElement>('sessionsListRef')

function scrollToTop() {
  if (viewMode.value === 'chat') {
    aiMessagesRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    sessionsListRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <DeckColumnComponent
    :column-id="column.id"
    :title="headerTitle"
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i class="ti ti-brain" />
    </template>

    <template v-if="viewMode === 'chat'" #header-meta>
      <div
        v-if="currentPersona"
        :class="[$style.headerAction, $style.personaIndicator]"
        :title="`Persona: ${currentPersona.displayName} (AI 設定で変更)`"
      >
        <span
          v-if="currentPersona.avatarUrl"
          :class="$style.personaIndicatorAvatar"
          :style="{ '--icon-url': `url('${currentPersona.avatarUrl}')` }"
          aria-hidden="true"
        />
        <i v-else class="ti ti-user-circle" />
      </div>
      <button
        class="_button"
        :class="$style.headerAction"
        title="セッション一覧へ戻る"
        @click="backToSessions"
      >
        <i class="ti ti-arrow-left" />
      </button>
    </template>

    <template v-if="viewMode === 'sessions'" #header-extra>
      <div :class="$style.searchBar">
        <i :class="$style.searchIcon" class="ti ti-search" />
        <input
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          placeholder="セッションを検索..."
        />
      </div>
    </template>

    <!-- View: sessions list (master) -->
    <div v-if="viewMode === 'sessions'" :class="$style.sessionsBody">
      <ColumnEmptyState
        v-if="totalSessions === 0"
        message="セッションはまだありません"
        fallback-kind="info"
      />
      <ColumnEmptyState
        v-else-if="hasNoSearchHits"
        message="一致するセッションがありません"
        fallback-kind="info"
      />
      <div v-else ref="sessionsListRef" :class="$style.sessionsList">
        <div
          v-for="group in filteredGroupedSessions"
          :key="group.label"
          :class="$style.group"
        >
          <div :class="$style.groupLabel">{{ group.label }}</div>
          <div
            v-for="session in group.items"
            :key="session.id"
            :class="[
              $style.row,
              {
                [$style.rowActive]: session.id === currentSessionId,
                [$style.rowHeartbeat]: session.kind === 'heartbeat',
              },
            ]"
            role="button"
            tabindex="0"
            @click="openSession(session.id)"
            @keydown.enter="openSession(session.id)"
          >
            <div :class="$style.rowAvatar">
              <i
                :class="['ti', sessionKindIcon(session.kind)]"
                aria-hidden="true"
              />
            </div>
            <div :class="$style.rowMain">
              <div :class="$style.rowTitle">
                {{ session.title || '無題のチャット' }}
              </div>
              <div v-if="session.lastMessagePreview" :class="$style.rowPreview">
                {{ session.lastMessagePreview }}
              </div>
            </div>
            <div :class="$style.rowActions">
              <button
                class="_button"
                :class="$style.rowActionBtn"
                title="名前を変更"
                @click="onRenameSession($event, session.id)"
              >
                <i class="ti ti-pencil" />
              </button>
              <button
                class="_button"
                :class="[$style.rowActionBtn, $style.rowActionBtnDanger]"
                title="削除"
                @click="onDeleteSession($event, session.id)"
              >
                <i class="ti ti-trash" />
              </button>
            </div>
            <div :class="$style.rowTime">
              {{ relativeTime(session.updatedAt) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Quick-start input: 一覧から直接送信すると新規セッション自動生成 -->
      <div :class="$style.chatInput">
        <div :class="$style.chatInputRow">
          <textarea
            ref="inputRef"
            v-model="input"
            :class="$style.chatTextarea"
            :placeholder="providerStatus === 'connected'
              ? '質問するか /help でコマンド一覧'
              : '/help でコマンド一覧 (AI は API キー未設定)'"
            rows="1"
            :disabled="!inputEnabled"
            @keydown="onKeydown"
          />
          <button
            :class="$style.chatSend"
            :disabled="!canSubmit"
            @click="sendMessage"
          >
            <i class="ti ti-send" />
          </button>
        </div>
      </div>
    </div>

    <!-- View: chat (detail) -->
    <div v-else :class="$style.aiColumnBody">
      <ColumnEmptyState
        v-if="messages.length === 0 && providerStatus !== 'connected'"
        message="AI 設定で API キーを設定してください"
        :is-error="true"
        fallback-kind="error"
      />

      <div v-else-if="messages.length > 0" ref="aiMessagesRef" :class="$style.aiMessages">
        <template v-for="msg in messages" :key="msg.id">
          <!-- AI が呼び出した tool (assistant + tool_use) -->
          <div
            v-if="isToolUseMessage(msg)"
            :class="$style.toolEvent"
          >
            <button
              class="_button"
              :class="$style.toolEventHeader"
              :title="expandedToolDetails[msg.id] ? '詳細を閉じる' : '詳細を開く'"
              @click="toggleToolDetail(msg.id)"
            >
              <i class="ti ti-tool" :class="$style.toolIcon" />
              <span :class="$style.toolEventLabel">ツール呼び出し</span>
              <code :class="$style.toolEventName">{{ msg.toolUseName }}</code>
              <i
                class="ti"
                :class="[
                  $style.toolEventChevron,
                  expandedToolDetails[msg.id] ? 'ti-chevron-up' : 'ti-chevron-down',
                ]"
              />
            </button>
            <div v-if="msg.content" :class="$style.toolEventCommentary">{{ msg.content }}</div>
            <div
              v-if="expandedToolDetails[msg.id]"
              :key="`tool-input-${msg.id}-${highlighterLoaded}`"
              :class="$style.toolEventBody"
              v-html="highlightCode(formatToolInput(msg.toolUseInput), 'json')"
            />
          </div>

          <!-- ツール実行結果 (user + tool_result) -->
          <div
            v-else-if="isToolResultMessage(msg)"
            :class="$style.toolEvent"
          >
            <button
              class="_button"
              :class="$style.toolEventHeader"
              :title="expandedToolDetails[msg.id] ? '詳細を閉じる' : '詳細を開く'"
              @click="toggleToolDetail(msg.id)"
            >
              <i class="ti ti-arrow-back-up" :class="$style.toolIcon" />
              <span :class="$style.toolEventLabel">結果</span>
              <span v-if="!expandedToolDetails[msg.id]" :class="$style.toolEventPreview">{{ truncateToolPreview(msg.content) }}</span>
              <i
                class="ti"
                :class="[
                  $style.toolEventChevron,
                  expandedToolDetails[msg.id] ? 'ti-chevron-up' : 'ti-chevron-down',
                ]"
              />
            </button>
            <template v-if="expandedToolDetails[msg.id]">
              <div
                v-if="looksLikeJson(msg.content)"
                :key="`tool-result-${msg.id}-${highlighterLoaded}`"
                :class="$style.toolEventBody"
                v-html="highlightCode(msg.content, 'json')"
              />
              <pre v-else :class="$style.toolEventBody">{{ msg.content }}</pre>
            </template>
          </div>

          <!-- 通常メッセージ -->
          <div
            v-else
            :class="[
              $style.chatMsg,
              { [$style.mine]: msg.role === 'user', [$style.heartbeat]: msg.heartbeat },
            ]"
          >
            <div :class="$style.chatBubbleWrapper">
              <div v-if="msg.heartbeat" :class="$style.heartbeatLabel">
                <i class="ti ti-activity-heartbeat" />
                <span>Heartbeat</span>
              </div>
              <div :class="$style.chatBubble">
                <div
                  v-if="msg.role === 'assistant' && !msg.content && isGenerating"
                  :class="$style.messageTyping"
                >
                  <span :class="$style.typingDot" />
                  <span :class="$style.typingDot" />
                  <span :class="$style.typingDot" />
                </div>
                <div
                  v-else-if="msg.role === 'assistant'"
                  :class="$style.markdownContent"
                  v-html="renderAssistant(msg.content)"
                  @click="onAssistantContentClick"
                />
                <div v-else :class="$style.chatText">{{ msg.content }}</div>
              </div>
              <button
                v-if="msg.content && (msg.role === 'user' || (msg.role === 'assistant' && !isGenerating))"
                class="_button"
                :class="$style.copyBtn"
                :title="copiedMessageId === msg.id ? 'コピーしました' : 'コピー'"
                @click="copyMessage(msg)"
              >
                <i :class="copiedMessageId === msg.id ? 'ti ti-check' : 'ti ti-copy'" />
              </button>
            </div>
          </div>
        </template>

        <div ref="messagesEndRef" />
      </div>

      <div :class="$style.chatInput">
        <div :class="$style.chatInputRow">
          <textarea
            ref="inputRef"
            v-model="input"
            :class="$style.chatTextarea"
            :placeholder="providerStatus === 'connected'
              ? '質問するか /help でコマンド一覧'
              : '/help でコマンド一覧 (AI は API キー未設定)'"
            rows="1"
            :disabled="!inputEnabled"
            @keydown="onKeydown"
          />
          <button
            v-if="isGenerating"
            :class="[$style.chatSend, $style.chatStop]"
            title="停止"
            @click="aiChat.cancel()"
          >
            <i class="ti ti-player-stop" />
          </button>
          <button
            v-else
            :class="$style.chatSend"
            :disabled="!canSubmit"
            title="送信"
            @click="sendMessage"
          >
            <i class="ti ti-send" />
          </button>
        </div>
      </div>
    </div>

  </DeckColumnComponent>
</template>

<style lang="scss" module>
.headerAction {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  border-radius: var(--nd-radius-sm);
  opacity: 0.45;
  font-size: 0.9em;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

// Persona indicator — チャットヘッダに「現在の persona」を表示する read-only
// バッジ。スキルカラムのアイテムアイコンと同型の `mask + currentColor` パターン
// で SVG をテーマアクセント色で着色する。
//
// hover 時はプロファイル切替インディケーターの UI 慣例に従い、背景にアクセント色を
// 敷いて SVG 側を「抜く」形に反転 (= color: var(--nd-bg) に切り替え、SVG 部分が
// 背景色で打ち抜かれて見える)。
.personaIndicator {
  overflow: hidden;
  padding: 0;
  opacity: 1;
  cursor: default;
  color: var(--nd-accent);
  background: transparent;
  transition: background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    background: var(--nd-accent);
    color: var(--nd-bg);
  }
}

.personaIndicatorAvatar {
  width: 100%;
  height: 100%;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

// --- セッション一覧ビュー ---

.searchBar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
}

.searchIcon {
  flex-shrink: 0;
  opacity: 0.4;
}

.searchInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 6px 10px;
  font-size: 0.85em;
  color: var(--nd-fg);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.sessionsBody {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.sessionsList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.group {
  padding: 4px 0;
}

.groupLabel {
  padding: 6px 12px 4px;
  font-size: 0.7em;
  font-weight: 700;
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

// 通常チャットカラム (DeckChatColumn.vue の .historyItem) と揃えた行レイアウト:
// 36px circular avatar (kind icon 入り) / name + sub-label / 右に time
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-base);
  border-bottom: 1px solid var(--nd-divider, rgba(255, 255, 255, 0.05));

  &:hover,
  &:focus-visible {
    background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.03));

    .rowActions {
      opacity: 1;
    }
  }
}

.rowActive {
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 22%, transparent);
  }
}

// HEARTBEAT (#411): kind 別 icon を avatar 風 36px 円で統一表示
// (chat / heartbeat / command / task のすべて同じ shape)
.rowAvatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--nd-buttonBg, rgba(255, 255, 255, 0.1));
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 1.1em;
}

// kind=heartbeat は accent カラーで強調 (avatar 背景 + アイコン + 左 border)
.rowHeartbeat {
  border-left: 2px solid var(--nd-accent, #f06292);

  .rowAvatar {
    background: color-mix(in srgb, var(--nd-accent, #f06292) 20%, transparent);
    color: var(--nd-accent, #f06292);
    opacity: 1;
  }
}

.rowMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.rowTitle {
  font-size: 0.9em;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowPreview {
  font-size: 0.8em;
  opacity: 0.5;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowTime {
  font-size: 0.75em;
  opacity: 0.5;
  flex-shrink: 0;
  align-self: flex-start;
  margin-top: 2px;
}

// スキルカラムの行アクションと同じパターン: hover で出現するインラインボタン群。
.rowActions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;

  // タッチ環境では常時表示（hover が無いため）
  @media (hover: none) {
    opacity: 1;
  }
}

.rowActionBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 4px;
  color: var(--nd-fg);
  font-size: 0.95em;
  opacity: 0.7;
  transition: background 0.1s, opacity 0.1s, color 0.1s;

  &:hover {
    opacity: 1;
    background: var(--nd-overlay);
  }
}

// 危険操作（削除）— hover で赤くする。`--nd-love` / `--nd-love-hover` は
// global.css で定義されたシステムカラー。
.rowActionBtnDanger:hover {
  color: var(--nd-love);
  background: var(--nd-love-hover);
}

// --- チャットビュー (旧来) ---

.aiColumnBody {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.aiMessages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

// MkChatMessage.vue (DM チャット) のバブルレイアウトに揃える。
.chatMsg {
  display: flex;
  align-items: flex-start;
  padding: 4px 12px;

  &.mine {
    flex-direction: row-reverse;

    .chatBubble {
      background: var(--nd-accentedBg, rgba(134, 179, 0, 0.15));
      border-bottom-right-radius: 4px;
    }
  }

  &:not(.mine) .chatBubble {
    border-bottom-left-radius: 4px;
  }

  // HEARTBEAT (#411): chat bubble ではなく full-width card として描画する。
  // OpenClaw WebUI に近い「自律応答 = システム由来の節 / カード」表現で、
  // ユーザー対話の bubble と視覚的に明確に区別する。
  &.heartbeat {
    padding: 6px 12px;

    .chatBubbleWrapper {
      max-width: 100%;
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      gap: 0;
    }

    .chatBubble {
      width: 100%;
      max-width: 100%;
      padding: 8px 12px 10px;
      border-radius: var(--nd-radius-sm, 4px);
      background: color-mix(in srgb, var(--nd-accent, #f06292) 5%, transparent);
      border: 1px solid color-mix(in srgb, var(--nd-accent, #f06292) 20%, transparent);
      border-left: 3px solid var(--nd-accent, #f06292);
      opacity: 1;
    }

    .copyBtn {
      position: absolute;
      top: 4px;
      right: 4px;
    }
  }
}

.heartbeatLabel {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 2px 4px;
  font-size: 0.72em;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nd-accent, #f06292);

  i {
    font-size: 1em;
  }
}

.chatBubbleWrapper {
  max-width: 85%;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;

  &:hover .copyBtn {
    opacity: 0.5;
  }
}

.chatBubble {
  padding: 8px 12px;
  border-radius: 14px;
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  font-size: 0.95em;
  line-height: 1.5;
  word-break: break-word;
  min-width: 0;
}

.chatText {
  white-space: pre-wrap;
}

.copyBtn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  opacity: 0;
  font-size: 0.85em;
  transition: opacity var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1 !important;
  }
}

// --- Tool call / result event (中央寄せの控えめバブル) ---

.toolEvent {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 12px;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-fg) 4%, transparent);
  font-size: 0.78em;
  opacity: 0.8;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.toolEventHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.toolIcon {
  flex-shrink: 0;
  color: var(--nd-accent);
  opacity: 0.9;
}

.toolEventLabel {
  flex-shrink: 0;
  opacity: 0.7;
  font-weight: 500;
}

.toolEventName {
  flex-shrink: 0;
  font-family: var(--nd-monoFont, 'Fira Code', monospace);
  font-size: 0.92em;
  padding: 1px 6px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  color: var(--nd-accent);
}

.toolEventPreview {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.6;
  font-family: var(--nd-monoFont, 'Fira Code', monospace);
  font-size: 0.92em;
}

.toolEventChevron {
  flex-shrink: 0;
  margin-left: auto;
  opacity: 0.5;
  font-size: 0.95em;
}

.toolEventCommentary {
  padding-left: 22px;
  white-space: pre-wrap;
  opacity: 0.85;
}

.toolEventBody {
  margin: 0;
  padding: 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-family: var(--nd-monoFont, 'Fira Code', monospace);
  font-size: 0.9em;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
  scrollbar-width: thin;

  // shiki が <pre class="shiki"><code>...</code></pre> を埋め込むので、
  // 内側 pre の browser default margin / padding を打ち消して toolEventBody の
  // padding にだけ依存させる。background は親 (toolEventBody) の var(--nd-bg) を
  // そのまま使うため透過に。
  :global(pre.shiki) {
    margin: 0;
    padding: 0;
    background: transparent;
    white-space: pre-wrap;
    word-break: break-all;
  }
  :global(pre.shiki code) {
    font-family: inherit;
  }
}

.markdownContent {
  white-space: normal;

  :global(p) {
    margin: 0;
  }
  :global(p + p) {
    margin-top: 0.4em;
  }
  :global(pre) {
    position: relative;
    margin: 0.5em 0;
    padding: 8px 10px;
    padding-right: 28px;
    background: var(--nd-base);
    border-radius: var(--nd-radius-sm);
    overflow-x: auto;
    font-size: 0.85em;
  }
  :global(pre code) {
    font-family: var(--nd-font-mono, monospace);
  }
  :global(pre button[data-md-copy]) {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.3;
    border-radius: var(--nd-radius-sm);
    cursor: pointer;
    font-size: 0.7em;
  }
  :global(pre:hover button[data-md-copy]) {
    opacity: 0.7;
  }
  :global(pre button[data-md-copy]:hover) {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
  :global(code) {
    font-family: var(--nd-font-mono, monospace);
    background: var(--nd-base);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.85em;
  }
  :global(pre code) {
    background: transparent;
    padding: 0;
  }
  :global(ul),
  :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.4em;
  }
  :global(li) {
    margin: 0.15em 0;
  }
  :global(strong) {
    font-weight: 700;
  }
  :global(em) {
    font-style: italic;
  }
  :global(a) {
    color: var(--nd-accent);
    text-decoration: underline;
  }
}

.messageTyping {
  display: flex;
  gap: 4px;
  padding: 10px 12px;
  background: var(--nd-buttonBg);
  border-radius: var(--nd-radius);
}

.typingDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
  animation: typing 1.4s infinite;
}
.typingDot:nth-child(2) {
  animation-delay: 0.2s;
}
.typingDot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

// Chat カラム (DeckChatColumn.vue) の入力欄スタイルに揃える。
.chatInput {
  display: flex;
  flex-direction: column;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--nd-divider, rgba(255, 255, 255, 0.05));
  background: var(--nd-panel);
  position: relative;
  flex-shrink: 0;
}

.chatInputRow {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.chatTextarea {
  flex: 1;
  resize: none;
  border: none;
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  color: var(--nd-fg);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 0.9em;
  font-family: inherit;
  line-height: 1.4;
  max-height: 120px;
  outline: none;
  field-sizing: content;

  &::placeholder {
    opacity: 0.4;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.chatSend {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 1em;
  transition: filter var(--nd-duration-base);

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }

  &:not(:disabled):hover {
    filter: brightness(1.1);
  }
}
</style>
