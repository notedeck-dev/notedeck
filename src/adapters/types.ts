/**
 * Misskey 系フォークの識別子。owner/repo 形式で一意に特定する。
 * nodeinfo の software.name から resolveSoftware() で解決されるが、
 * "misskey" と名乗りつつ独自改変しているフォークは自動検出できないため、
 * デフォルトは 'misskey-dev/misskey' にフォールバックする。
 *
 * 新しいフォークを追加する場合:
 * 1. ここにリテラルを追加
 * 2. registry.ts の resolveSoftware() に検出ルールを追加
 * 3. server.ts の detectFeatures() にフォーク固有の capability を設定
 */
export type ServerSoftware =
  | 'misskey-dev/misskey'
  | 'yamisskey-dev/yamisskey'
  | 'lqvp/misskey-tepura'
  | 'unknown'

export interface ServerInfo {
  host: string
  software: ServerSoftware
  version: string
  features: ServerFeatures
  iconUrl?: string
  themeColor?: string | null
  /** Misskey /api/meta から取得するカスタム画像 URL（サーバーごとに異なる） */
  infoImageUrl?: string
  notFoundImageUrl?: string
  serverErrorImageUrl?: string
}

export interface ServerFeatures {
  mastodonApi: boolean
  reactions: boolean
  customEmoji: boolean
  drive: boolean
  channels: boolean
  antennas: boolean
  quotes: boolean
  groupedNotifications: boolean
  [key: string]: boolean
}

export type NoteVisibility = 'public' | 'home' | 'followers' | 'specified'

/** Standard timeline types. Custom forks may add more (e.g., 'bubble', 'recommended'). */
export type TimelineType =
  | 'home'
  | 'local'
  | 'social'
  | 'global'
  | (string & {})

export interface TimelineFilter {
  withRenotes?: boolean
  withReplies?: boolean
  withFiles?: boolean
  withBots?: boolean
  withSensitive?: boolean
}

/** Standard Misskey filter keys per timeline type */
export const TIMELINE_FILTER_KEYS: Record<
  TimelineType,
  (keyof TimelineFilter)[]
> = {
  home: ['withRenotes', 'withFiles'],
  local: ['withRenotes', 'withReplies', 'withFiles'],
  social: ['withRenotes', 'withReplies', 'withFiles'],
  global: ['withRenotes', 'withFiles'],
}

/** Fork-specific extra filter keys (merged with standard keys) */
export const FORK_EXTRA_FILTERS: Partial<
  Record<ServerSoftware, (keyof TimelineFilter)[]>
> = {}

export interface TimelineOptions {
  limit?: number
  sinceId?: string
  untilId?: string
  filters?: TimelineFilter
  listId?: string
}

export interface PaginationOptions {
  limit?: number
  sinceId?: string
  untilId?: string
}

export interface UserNotesOptions extends PaginationOptions {
  withReplies?: boolean
  withFiles?: boolean
  withChannelNotes?: boolean
}

export interface SearchOptions {
  limit?: number
  sinceId?: string
  untilId?: string
  sinceDate?: number
  untilDate?: number
  /** 指定ユーザーのノートのみに絞る (notes/search の userId) */
  userId?: string
}

// `UserList` は specta 経由で Rust 側から自動生成される正規化型 (notecli の
// notecli::models::UserList)。重複定義を避けるため bindings から re-export。
import type { UserList } from '@/bindings'

export type { UserList }

// `Antenna` は specta 経由で Rust 側から自動生成される正規化型 (notecli の
// notecli::models::Antenna)。src/users/keywords 等の full entity を扱うため
// bindings から re-export する。
import type { Antenna } from '@/bindings'

export type { Antenna }

// `Clip` は specta 経由で Rust 側から自動生成される正規化型 (notecli の
// notecli::models::Clip)。重複定義を避けるため bindings から re-export。
import type { Clip } from '@/bindings'

export type { Clip }

export interface CreateAntennaParams {
  name: string
  src?: string
  keywords?: string[][]
  excludeKeywords?: string[][]
  users?: string[]
  caseSensitive?: boolean
  withReplies?: boolean
  withFile?: boolean
}

export interface Channel {
  id: string
  name: string
  color?: string | null
}

export interface ServerAd {
  id: string
  url: string
  imageUrl: string
  ratio: number
  place: string
  memo: string
  dayOfWeek: number
  startsAt: string | null
  expiresAt: string | null
}

export interface ChatMessageReaction {
  user?: {
    id: string
    name?: string
    username: string
    host?: string
    avatarUrl?: string
  } | null
  reaction: string
}

export interface ChatMessage {
  id: string
  createdAt: string
  fromUserId: string
  fromUser?: ChatUser
  toUserId?: string
  toUser?: ChatUser
  toRoomId?: string
  toRoom?: ChatRoom
  text?: string
  fileId?: string
  file?: NormalizedDriveFile
  isRead?: boolean
  reactions?: ChatMessageReaction[]
}

export interface ChatUser {
  id: string
  name?: string
  username: string
  host?: string
  avatarUrl?: string
  isCat?: boolean
  avatarDecorations?: AvatarDecoration[]
  emojis?: Record<string, string>
}

export interface ChatRoom {
  id: string
  name?: string
  description?: string
}

export interface NormalizedNote {
  id: string
  _accountId: string
  _serverHost: string
  createdAt: string
  text: string | null
  cw: string | null
  user: NormalizedUser
  visibility: NoteVisibility
  emojis: Record<string, string>
  reactionEmojis: Record<string, string>
  reactions: Record<string, number>
  myReaction?: string | null
  renoteCount: number
  repliesCount: number
  files: NormalizedDriveFile[]
  poll?: NormalizedPoll
  replyId?: string | null
  renoteId?: string | null
  channelId?: string | null
  channel?: Channel | null
  reactionAcceptance?: string | null
  uri?: string
  url?: string
  updatedAt?: string
  localOnly?: boolean
  visibleUserIds?: string[]
  isFavorited?: boolean
  /** Fork-specific mode flags (e.g., isNoteInYamiMode) */
  modeFlags?: Record<string, boolean>
  reply?: NormalizedNote
  renote?: NormalizedNote
}

export interface AvatarDecoration {
  id: string
  url: string
  angle?: number
  flipH?: boolean
  offsetX?: number
  offsetY?: number
}

export interface UserInstance {
  name: string | null
  faviconUrl: string | null
  iconUrl: string | null
  themeColor: string | null
}

export interface NormalizedUser {
  id: string
  username: string
  host: string | null
  name: string | null
  avatarUrl: string | null
  isBot?: boolean
  isCat?: boolean
  avatarDecorations?: AvatarDecoration[]
  emojis?: Record<string, string>
  instance?: UserInstance
}

export interface UserRole {
  id: string
  name: string
  color?: string | null
  iconUrl?: string | null
  description?: string | null
  displayOrder: number
}

export interface UserField {
  name: string
  value: string
}

export interface NormalizedUserDetail extends NormalizedUser {
  bannerUrl: string | null
  description: string | null
  followersCount: number
  followingCount: number
  notesCount: number
  isBot: boolean
  isCat: boolean
  isFollowing: boolean
  isFollowed: boolean
  /** 鍵アカウント (フォローに承認が必要) かどうか */
  isLocked?: boolean
  /** 鍵アカウントへフォローリクエスト送信済みで未承認の状態 */
  hasPendingFollowRequestFromYou?: boolean
  createdAt: string
  roles: UserRole[]
  fields: UserField[]
  url?: string | null
  birthday?: string | null
  location?: string | null
  onlineStatus?: 'online' | 'active' | 'offline' | 'unknown' | null
  pinnedNoteIds?: string[]
  followingVisibility?: 'public' | 'followers' | 'private'
  followersVisibility?: 'public' | 'followers' | 'private'
  followedMessage?: string | null
  /** このユーザーに対する自分用メモ (users/update-memo) */
  memo?: string | null
  /** フォロー中のみ意味を持つ: 'normal' | 'none' (投稿通知) */
  notify?: 'normal' | 'none' | null
  /** フォロー中のみ意味を持つ: TL に他者宛て返信を含めるか */
  withReplies?: boolean | null
}

export interface NormalizedPoll {
  choices: NormalizedPollChoice[]
  multiple: boolean
  expiresAt: string | null
}

export interface NormalizedPollChoice {
  text: string
  votes: number
  isVoted: boolean
}

export interface DriveFolder {
  id: string
  name: string
  parentId: string | null
}

export interface NormalizedDriveFile {
  id: string
  name: string
  type: string
  url: string
  thumbnailUrl: string | null
  size: number
  isSensitive: boolean
  comment?: string | null
}

export interface NoteReaction {
  id: string
  createdAt: string
  user: NormalizedUser
  type: string
}

export interface NoteUpdateEvent {
  noteId: string
  type: 'reacted' | 'unreacted' | 'deleted' | 'pollVoted'
  body: {
    reaction?: string
    emoji?: { name: string; url: string } | string | null
    userId?: string
    deletedAt?: string
    choice?: number
  }
}

export interface ReactionInfo {
  user: NormalizedUser
  reaction: string
}

export interface NormalizedNotification {
  id: string
  _accountId: string
  _serverHost: string
  createdAt: string
  type: string
  user?: NormalizedUser
  note?: NormalizedNote
  reaction?: string
  message?: string
  achievement?: string
  /** Grouped reactions (for reaction:grouped type) */
  reactions?: ReactionInfo[]
  /** Grouped users (for renote:grouped type) */
  users?: NormalizedUser[]
}

export interface CreateNoteParams {
  text?: string
  cw?: string | null
  visibility?: NoteVisibility
  localOnly?: boolean
  modeFlags?: Record<string, boolean>
  replyId?: string
  renoteId?: string
  channelId?: string
  fileIds?: string[]
  poll?: { choices: string[]; multiple?: boolean; expiresAt?: number | null }
  scheduledAt?: string
}

export interface AuthSession {
  sessionId: string
  url: string
  host: string
}

export interface AuthAdapter {
  startAuth(host: string, permissions: string[]): Promise<AuthSession>
}

export interface ServerEmoji {
  name: string
  url: string
  category: string | null
  aliases: string[]
}

// 9 種類の chart 型は specta 経由で Rust 側から自動生成される。
// 重複定義を避けるため bindings から re-export。
import type {
  ActiveUsersChart,
  ApRequestChart,
  FederationChart,
  ServerDriveChart,
  ServerNotesChart,
  ServerUsersChart,
  UserFollowingChart,
  UserNotesChart,
  UserPvChart,
} from '@/bindings'

export type {
  ActiveUsersChart,
  ApRequestChart,
  FederationChart,
  ServerDriveChart,
  ServerNotesChart,
  ServerUsersChart,
  UserFollowingChart,
  UserNotesChart,
  UserPvChart,
}

// `FederationInstance` は specta 経由で Rust 側から自動生成される正規化型。
// クエリパラメタ補助 (FederationInstanceSort / FederationInstancesParams) のみ
// TS 側に残す。
import type { FederationInstance } from '@/bindings'

export type { FederationInstance }

// Pages / Gallery / Flash 型も specta 経由で Rust 側から自動生成される。
import type { Flash, GalleryPost, Page } from '@/bindings'

export type { Flash, GalleryPost, Page }

// ワードミュート（#610）。mutedWords / hardMutedWords は notecli が `i` から取得。
import type { MutedWord, MutedWordsResult } from '@/bindings'

export type { MutedWord, MutedWordsResult }

/** Misskey Pages の取得対象 endpoint (Rust 側で allowlist チェック)。 */
export type PagesEndpoint = 'pages/featured' | 'i/pages' | 'i/page-likes'

/** Misskey Flash の取得対象 endpoint (Rust 側で allowlist チェック)。 */
export type FlashesEndpoint = 'flash/featured' | 'flash/my' | 'flash/my-likes'

/** サーバーアナウンス。Misskey 側の型定義が緩いので生 JSON。 */
export type Announcement = Record<string, unknown>

export type FederationInstanceSort =
  | '+pubSub'
  | '-pubSub'
  | '+notes'
  | '-notes'
  | '+users'
  | '-users'
  | '+following'
  | '-following'
  | '+followers'
  | '-followers'
  | '+firstRetrievedAt'
  | '-firstRetrievedAt'
  | '+latestRequestSentAt'
  | '-latestRequestSentAt'

export interface FederationInstancesParams {
  limit?: number
  offset?: number
  sort?: FederationInstanceSort
  host?: string | null
  blocked?: boolean | null
  notResponding?: boolean | null
  suspended?: boolean | null
  federating?: boolean | null
  subscribing?: boolean | null
  publishing?: boolean | null
}

export interface ApiAdapter {
  getTimeline(
    type: TimelineType,
    options?: TimelineOptions,
  ): Promise<NormalizedNote[]>
  getNote(noteId: string): Promise<NormalizedNote>
  createReaction(noteId: string, reaction: string): Promise<void>
  deleteReaction(noteId: string): Promise<void>
  votePoll(noteId: string, choice: number): Promise<void>
  getNoteReactions(
    noteId: string,
    reactionType?: string,
    limit?: number,
    untilId?: string,
  ): Promise<NoteReaction[]>
  updateNote(noteId: string, params: CreateNoteParams): Promise<void>
  deleteNote(noteId: string): Promise<void>
  createFavorite(noteId: string): Promise<void>
  deleteFavorite(noteId: string): Promise<void>
  pinNote(noteId: string): Promise<void>
  unpinNote(noteId: string): Promise<void>
  getUserPinnedNoteIds(userId: string): Promise<string[]>
  uploadFile(
    fileName: string,
    fileData: number[],
    contentType: string,
    isSensitive?: boolean,
    folderId?: string | null,
  ): Promise<NormalizedDriveFile>
  uploadFileFromPath(
    filePath: string,
    isSensitive?: boolean,
    folderId?: string | null,
  ): Promise<NormalizedDriveFile>
  getServerEmojis(): Promise<ServerEmoji[]>
  getPinnedReactions(): Promise<string[]>
  getUser(userId: string): Promise<NormalizedUser>
  getUserDetail(userId: string): Promise<NormalizedUserDetail>
  getUserNotes(
    userId: string,
    options?: UserNotesOptions,
  ): Promise<NormalizedNote[]>
  getUserFeaturedNotes(
    userId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getUserNotesChart(
    userId: string,
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<UserNotesChart>
  getUserFollowingChart(
    userId: string,
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<UserFollowingChart>
  getUserPvChart(
    userId: string,
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<UserPvChart>
  getActiveUsersChart(
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<ActiveUsersChart>
  getServerNotesChart(
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<ServerNotesChart>
  getServerUsersChart(
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<ServerUsersChart>
  getFederationChart(
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<FederationChart>
  getApRequestChart(
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<ApRequestChart>
  getServerDriveChart(
    span?: 'day' | 'hour',
    limit?: number,
  ): Promise<ServerDriveChart>
  getFederationInstances(
    params?: FederationInstancesParams,
  ): Promise<FederationInstance[]>
  getFederationInstance(host: string): Promise<FederationInstance>
  createNote(params: CreateNoteParams): Promise<NormalizedNote>
  getNotifications(
    options?: PaginationOptions,
  ): Promise<NormalizedNotification[]>
  getNotificationsGrouped(
    options?: PaginationOptions,
  ): Promise<NormalizedNotification[]>
  searchNotes(query: string, options?: SearchOptions): Promise<NormalizedNote[]>
  getNoteChildren(
    noteId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getNoteRenotes(
    noteId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getNoteConversation(
    noteId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  lookupUser(username: string, host?: string | null): Promise<NormalizedUser>
  followUser(userId: string): Promise<void>
  unfollowUser(userId: string): Promise<void>
  invalidateFollower(userId: string): Promise<void>
  /** フォロー設定を更新する (following/update)。notify / withReplies はフォロー中のみ有効 */
  updateFollowing(
    userId: string,
    options: { notify?: 'normal' | 'none'; withReplies?: boolean },
  ): Promise<void>
  /** このユーザーへの自分用メモを更新する (users/update-memo)。空文字で削除 */
  updateUserMemo(userId: string, memo: string): Promise<void>
  acceptFollowRequest(userId: string): Promise<void>
  rejectFollowRequest(userId: string): Promise<void>
  /** 自分が送ったフォローリクエストを取り消す (following/requests/cancel) */
  cancelFollowRequest(userId: string): Promise<void>
  getUserLists(): Promise<UserList[]>
  getAntennas(): Promise<Antenna[]>
  /** 単一アンテナの設定を取得する (antennas/show) */
  getAntenna(antennaId: string): Promise<Antenna>
  /** アンテナ設定を更新する (antennas/update) */
  updateAntenna(antenna: Antenna): Promise<Antenna>
  getAntennaNotes(
    antennaId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getMentions(
    options?: PaginationOptions & { visibility?: NoteVisibility },
  ): Promise<NormalizedNote[]>
  getFavorites(options?: PaginationOptions): Promise<NormalizedNote[]>
  getFeaturedNotes(options?: { limit?: number }): Promise<NormalizedNote[]>
  getClips(): Promise<Clip[]>
  getClipNotes(
    clipId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getChannels(): Promise<Channel[]>
  getChannelNotes(
    channelId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getRoleNotes(
    roleId: string,
    options?: PaginationOptions,
  ): Promise<NormalizedNote[]>
  getChatHistory(limit?: number, cache?: boolean | null): Promise<ChatMessage[]>
  getChatUserMessages(
    userId: string,
    options?: PaginationOptions & { cache?: boolean | null },
  ): Promise<ChatMessage[]>
  getChatRoomMessages(
    roomId: string,
    options?: PaginationOptions & { cache?: boolean | null },
  ): Promise<ChatMessage[]>
  createChatMessage(params: {
    userId?: string
    roomId?: string
    text: string
  }): Promise<ChatMessage>
  muteUser(userId: string): Promise<void>
  unmuteUser(userId: string): Promise<void>
  /** 自分がミュート中のユーザー ID 一覧（#574: 起動時の mute store hydrate 用）。 */
  getMutedUsers(): Promise<string[]>
  /** 自分の mutedWords / hardMutedWords / mutedInstances（#610/#613: 起動時 hydrate 用、read のみ）。 */
  getMutedWords(): Promise<MutedWordsResult>
  /** 自分が renote mute 中のユーザー ID 一覧（#614: 起動時の renote mute store hydrate 用）。 */
  getRenoteMutedUsers(): Promise<string[]>
  renoteMuteUser(userId: string): Promise<void>
  unrenoteMuteUser(userId: string): Promise<void>
  blockUser(userId: string): Promise<void>
  unblockUser(userId: string): Promise<void>
  reportUser(userId: string, comment: string): Promise<void>
  addNoteToClip(clipId: string, noteId: string): Promise<void>
  removeNoteFromClip(clipId: string, noteId: string): Promise<void>
  addUserToList(listId: string, userId: string): Promise<void>
  removeUserFromList(listId: string, userId: string): Promise<void>
  getFollowing(
    userId: string,
    options?: { limit?: number; untilId?: string },
  ): Promise<FollowRelation[]>
  getFollowers(
    userId: string,
    options?: { limit?: number; untilId?: string },
  ): Promise<FollowRelation[]>
  getUserRelations(userIds: string[]): Promise<UserRelation[]>
  // --- Announcements / Pages / Gallery / Flash (read-only) ---
  getAnnouncements(options?: {
    limit?: number
    isActive?: boolean
  }): Promise<Announcement[]>
  getPages(endpoint: PagesEndpoint, limit?: number): Promise<Page[]>
  getPage(pageId: string): Promise<unknown>
  getGalleryPosts(options?: {
    limit?: number
    untilId?: string
  }): Promise<GalleryPost[]>
  getFlashes(endpoint: FlashesEndpoint, limit?: number): Promise<Flash[]>
  getFlash(flashId: string): Promise<unknown>
}

export interface FollowRelation {
  id: string
  followee?: NormalizedUser
  follower?: NormalizedUser
}

export interface UserRelation {
  id: string
  isFollowing: boolean
  isFollowed: boolean
  isBlocking: boolean
  isBlocked: boolean
  isMuted: boolean
  isRenoteMuted: boolean
}

export type StreamConnectionState =
  | 'initializing'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

export interface ChannelSubscription {
  dispose(): void
}

export type SubscriptionRuntimeState = 'live' | 'warm' | 'suspended'

export interface ManagedChannelSubscription extends ChannelSubscription {
  setRuntimeState(state: SubscriptionRuntimeState): void
  /**
   * Underlying channel subscription id — matches the `subscriptionId` field on
   * stream event payloads. Null until the subscription has opened.
   */
  readonly subscriptionId: string | null
  /** Resolves once the underlying subscription is open (subscriptionId set). */
  whenReady(): Promise<void>
}

export type MainChannelEvent = {
  type: string
  body: unknown
}

/** Raw stream event envelope as emitted by the Tauri bridge. */
export interface RawStreamEvent {
  kind: string
  payload: Record<string, unknown>
}

export interface StreamAdapter {
  connect(): void
  /** Re-register event listeners and ensure the connection is alive (idempotent). */
  reconnect(): void
  disconnect(): void
  /** Clean up local listeners/handlers without killing the shared WebSocket connection. */
  cleanup(): void
  /** Subscribe to per-note updates (Misskey Note Capture). */
  subNote(noteId: string, handler: (event: NoteUpdateEvent) => void): void
  unsubNote(noteId: string): void
  readonly state: StreamConnectionState
  on(
    event: 'connected' | 'disconnected' | 'reconnecting',
    handler: () => void,
  ): void
  off(event: string, handler: () => void): void
  /** Subscribe to raw stream event envelopes (for inspector / debugging). */
  onRawEvent(handler: (event: RawStreamEvent) => void): void
  offRawEvent(handler: (event: RawStreamEvent) => void): void
}

export interface ServerAdapter {
  readonly serverInfo: ServerInfo
  readonly auth: AuthAdapter
  readonly api: ApiAdapter
  readonly stream: StreamAdapter
}
