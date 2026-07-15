<script setup lang="ts">
import DOMPurify from 'dompurify'
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { FederationInstance } from '@/adapters/types'
import EditorTabs from '@/components/common/EditorTabs.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { AppError } from '@/utils/errors'
import { formatCount, formatDate } from '@/utils/format'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { safeCssUrl, webUiUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  host: string
  /** 呼び出し元が既に持っているインスタンス情報 (即時表示用)。 */
  initialInstance?: FederationInstance
}>()

const accountsStore = useAccountsStore()

type Tab = 'overview' | 'raw'
const TAB_DEFS = [
  { value: 'overview', icon: 'home', label: '概要' },
  { value: 'raw', icon: 'code', label: 'Raw' },
]
const { tab, containerRef } = useEditorTabs<Tab>(
  ['overview', 'raw'] as const,
  'overview',
)

const instance = shallowRef<FederationInstance | null>(
  props.initialInstance ?? null,
)
const isLoading = ref(!props.initialInstance)
const error = ref<string | null>(null)

/**
 * リモートサーバーの /api/meta から取れるバナー/ヘッダー画像 URL 等を保持。
 * federation/show-instance には含まれないので別途フェッチする。
 */
const remoteMeta = shallowRef<Record<string, unknown> | null>(null)

async function loadRemoteMeta() {
  try {
    const data = unwrap(await commands.fetchServerMeta(props.host))
    remoteMeta.value = data as unknown as Record<string, unknown>
  } catch {
    // 古い/応答しないサーバーでは失敗するが、致命的ではないので握りつぶす。
  }
}

async function loadInstance() {
  const acc = accountsStore.accounts.find((a) => a.id === props.accountId)
  if (!acc) {
    error.value = 'アカウントが見つかりません'
    isLoading.value = false
    return
  }
  if (!props.initialInstance) isLoading.value = true
  error.value = null
  try {
    const { adapter } = await initAdapterFor(acc.host, acc.id, {
      hasToken: acc.hasToken,
    })
    instance.value = await adapter.api.getFederationInstance(props.host)
  } catch (e) {
    error.value = AppError.from(e).message
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadInstance()
  loadRemoteMeta()
})

// DeckWindow ヘッダーに「Web UIで開く」ボタンを登録 (UserProfile と同じ導線)。
useWindowExternalLink(() => ({ url: webUiUrl(props.host) }))

const rawJson = computed(() =>
  instance.value ? JSON.stringify(instance.value, null, 2) : '',
)

const displayName = computed(() => instance.value?.name || props.host)

// ソフトウェア種別のデフォルトアイコン (column と同じ mapping)。
// サーバーが独自アイコンを持たない、または取得失敗した際のフォールバック。
const SOFTWARE_DEFAULT_ICON: Record<string, string> = {
  misskey: '/misskey-icon.png',
  mastodon: '/mastodon-icon.svg',
  pleroma: '/pleroma-icon.svg',
}
const ACTIVITYPUB_ICON = '/activitypub-icon.svg'

const failedIcons = reactive(new Set<string>())
function onIconError(src: string | null | undefined) {
  if (src) failedIcons.add(src)
}

const customIconSrc = computed(() => {
  const inst = instance.value
  if (!inst) return null
  const src = inst.faviconUrl || inst.iconUrl
  if (!src || failedIcons.has(src)) return null
  return src
})

const softwareFallbackSrc = computed(() => {
  const key = instance.value?.softwareName?.toLowerCase()
  if (key && SOFTWARE_DEFAULT_ICON[key]) return SOFTWARE_DEFAULT_ICON[key]
  return ACTIVITYPUB_ICON
})

/** /api/meta から取得できた場合のみバナー画像 URL を返す。 */
const bannerImageUrl = computed(() => {
  const meta = remoteMeta.value
  if (!meta) return null
  const raw = (meta.bannerUrl ?? meta.backgroundImageUrl) as unknown
  if (typeof raw !== 'string' || !raw) return null
  return raw.startsWith('http') ? raw : `https://${props.host}${raw}`
})

const bannerStyle = computed(() => {
  const url = bannerImageUrl.value
  if (url) {
    return { backgroundImage: safeCssUrl(url) }
  }
  const theme = instance.value?.themeColor
  if (theme) {
    return {
      background: `linear-gradient(135deg, ${theme}, color-mix(in srgb, ${theme} 50%, #000))`,
    }
  }
  return undefined
})

function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'たった今'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}時間前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}日前`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}ヶ月前`
  const year = Math.floor(day / 365)
  return `${year}年前`
}

/**
 * Misskey の description は HTML を含む (b/em/a/br/span style="color:..." など)。
 * DOMPurify で安全なサブセットに絞って v-html 描画する (DeckServerInfoColumn と同じ方針)。
 */
const sanitizedDescription = computed(() => {
  const desc = instance.value?.description
  if (!desc) return null
  return DOMPurify.sanitize(desc, {
    ALLOWED_TAGS: [
      'b',
      'i',
      'em',
      'strong',
      'u',
      's',
      'a',
      'br',
      'p',
      'ul',
      'ol',
      'li',
      'code',
      'pre',
      'blockquote',
      'span',
      'small',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
    ADD_ATTR: ['target'],
  })
})

const statusBadges = computed(() => {
  const inst = instance.value
  if (!inst) return []
  const list: { label: string; kind: 'error' | 'warn' }[] = []
  if (inst.isSuspended) list.push({ label: '停止中', kind: 'error' })
  if (inst.isBlocked) list.push({ label: 'ブロック', kind: 'error' })
  if (inst.isNotResponding) list.push({ label: '無応答', kind: 'warn' })
  if (inst.isSilenced) list.push({ label: 'サイレンス', kind: 'warn' })
  if (inst.isMediaSilenced)
    list.push({ label: 'メディアサイレンス', kind: 'warn' })
  return list
})
</script>

<template>
  <div :class="$style.content">
    <div v-if="isLoading && !instance" :class="$style.stateMessage">
      <LoadingSpinner />
    </div>

    <div v-else-if="error && !instance" :class="[$style.stateMessage, $style.stateError]">
      <p>{{ error }}</p>
    </div>

    <template v-else-if="instance">
      <EditorTabs v-model="tab" :tabs="TAB_DEFS" />

      <div ref="containerRef" :class="$style.tabContent">
        <!-- Overview -->
        <div v-show="tab === 'overview'">
          <div :class="$style.profileContainer">
            <!-- Banner with icon & name overlay (UserProfile と同じ構成) -->
            <div :class="$style.bannerArea">
              <div
                :class="[
                  $style.banner,
                  !bannerImageUrl && !instance.themeColor && $style.bannerEmpty,
                ]"
                :style="bannerStyle"
              />
              <div :class="$style.bannerFade" />

              <div :class="$style.bannerTitle">
                <div :class="$style.bannerName">{{ displayName }}</div>
                <div :class="$style.bannerBottom">
                  <span :class="$style.bannerUsername">{{ instance.host }}</span>
                  <span v-if="instance.softwareName" :class="$style.bannerBadge">
                    {{ instance.softwareName }}
                  </span>
                </div>
              </div>

              <div :class="$style.serverIconWrap">
                <img
                  v-if="customIconSrc"
                  :src="customIconSrc"
                  :alt="instance.host"
                  :class="$style.serverIcon"
                  referrerpolicy="no-referrer"
                  @error="onIconError(customIconSrc)"
                />
                <img
                  v-else
                  :src="softwareFallbackSrc"
                  :alt="instance.host"
                  :class="$style.serverIcon"
                />
              </div>
            </div>

            <!-- Status badges (roles と同じスタイル) -->
            <div v-if="statusBadges.length" :class="$style.roles">
              <span
                v-for="b in statusBadges"
                :key="b.label"
                :class="[
                  $style.role,
                  b.kind === 'error' && $style.roleError,
                  b.kind === 'warn' && $style.roleWarn,
                ]"
              >
                {{ b.label }}
              </span>
            </div>

            <!-- Description (sanitized HTML) -->
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              v-if="sanitizedDescription"
              :class="$style.description"
              v-html="sanitizedDescription"
            />

            <!-- Profile info items -->
            <div :class="$style.profileInfo">
              <div :class="$style.profileInfoItem">
                <i class="ti ti-server-2" />
                <span>
                  {{ instance.softwareName || '不明' }}
                  <span v-if="instance.softwareVersion" :class="$style.dim">
                    / {{ instance.softwareVersion }}
                  </span>
                </span>
              </div>
              <div v-if="instance.maintainerName || instance.maintainerEmail" :class="$style.profileInfoItem">
                <i class="ti ti-user-shield" />
                <span>
                  {{ instance.maintainerName || '—' }}
                  <span v-if="instance.maintainerEmail" :class="$style.dim">
                    ({{ instance.maintainerEmail }})
                  </span>
                </span>
              </div>
              <div :class="$style.profileInfoItem" :title="formatAbsolute(instance.firstRetrievedAt)">
                <i class="ti ti-calendar-plus" />
                <span>
                  初観測 {{ formatDate(instance.firstRetrievedAt) }}
                  <span :class="$style.dim">({{ formatRelative(instance.firstRetrievedAt) }})</span>
                </span>
              </div>
              <div v-if="instance.infoUpdatedAt" :class="$style.profileInfoItem" :title="formatAbsolute(instance.infoUpdatedAt)">
                <i class="ti ti-refresh" />
                <span>
                  更新 {{ formatRelative(instance.infoUpdatedAt) }}
                </span>
              </div>
              <div v-if="instance.latestRequestReceivedAt" :class="$style.profileInfoItem" :title="formatAbsolute(instance.latestRequestReceivedAt)">
                <i class="ti ti-arrow-down-to-arc" />
                <span>直近リクエスト受信 {{ formatRelative(instance.latestRequestReceivedAt) }}</span>
              </div>
              <div v-if="instance.latestRequestSentAt" :class="$style.profileInfoItem" :title="formatAbsolute(instance.latestRequestSentAt)">
                <i class="ti ti-arrow-up-from-arc" />
                <span>直近リクエスト送信 {{ formatRelative(instance.latestRequestSentAt) }}</span>
              </div>
              <div v-if="instance.openRegistrations !== null" :class="$style.profileInfoItem">
                <i :class="instance.openRegistrations ? 'ti ti-door-enter' : 'ti ti-lock'" />
                <span>
                  {{ instance.openRegistrations ? '新規登録オープン' : '新規登録クローズ' }}
                </span>
              </div>
            </div>

            <!-- Stats -->
            <div :class="$style.stats">
              <div :class="$style.stat">
                <b>{{ formatCount(instance.usersCount) }}</b>
                <span>ユーザー</span>
              </div>
              <div :class="$style.stat">
                <b>{{ formatCount(instance.notesCount) }}</b>
                <span>ノート</span>
              </div>
              <div :class="$style.stat">
                <b>{{ formatCount(instance.followingCount) }}</b>
                <span>Pub</span>
              </div>
              <div :class="$style.stat">
                <b>{{ formatCount(instance.followersCount) }}</b>
                <span>Sub</span>
              </div>
            </div>

            <!-- Well-known resources section -->
            <div :class="$style.wellKnownSection">
              <div :class="$style.sectionHeader">
                <i class="ti ti-link" />
                Well-known resources
              </div>
              <div :class="$style.linkList">
                <a
                  :href="`https://${instance.host}/.well-known/nodeinfo`"
                  target="_blank"
                  rel="noopener"
                  :class="$style.linkBtn"
                >
                  <span :class="$style.linkPath">/.well-known/nodeinfo</span>
                  <i class="ti ti-external-link" />
                </a>
                <a
                  :href="`https://${instance.host}/.well-known/host-meta`"
                  target="_blank"
                  rel="noopener"
                  :class="$style.linkBtn"
                >
                  <span :class="$style.linkPath">/.well-known/host-meta</span>
                  <i class="ti ti-external-link" />
                </a>
                <a
                  :href="`https://${instance.host}/.well-known/host-meta.json`"
                  target="_blank"
                  rel="noopener"
                  :class="$style.linkBtn"
                >
                  <span :class="$style.linkPath">/.well-known/host-meta.json</span>
                  <i class="ti ti-external-link" />
                </a>
                <a
                  :href="`https://${instance.host}/nodeinfo/2.0`"
                  target="_blank"
                  rel="noopener"
                  :class="$style.linkBtn"
                >
                  <span :class="$style.linkPath">/nodeinfo/2.0</span>
                  <i class="ti ti-external-link" />
                </a>
                <a
                  :href="`https://${instance.host}/robots.txt`"
                  target="_blank"
                  rel="noopener"
                  :class="$style.linkBtn"
                >
                  <span :class="$style.linkPath">/robots.txt</span>
                  <i class="ti ti-external-link" />
                </a>
                <a
                  :href="`https://${instance.host}/manifest.json`"
                  target="_blank"
                  rel="noopener"
                  :class="$style.linkBtn"
                >
                  <span :class="$style.linkPath">/manifest.json</span>
                  <i class="ti ti-external-link" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Raw JSON -->
        <div v-show="tab === 'raw'" :class="$style.rawPane">
          <RawJsonView :json="rawJson" :loading="isLoading" :error="error">
            <template #hint>
              <i class="ti ti-info-circle" />
              <code>/api/federation/show-instance</code> の生レスポンス
            </template>
          </RawJsonView>
        </div>
      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--nd-bg);
}

.stateMessage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

.stateError {
  color: var(--nd-love);
  font-size: 0.9em;
}

.tabContent {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.profileContainer {
  max-width: 800px;
  margin: 0 auto;
  container-type: inline-size;
}

.bannerArea {
  position: relative;
  --bannerHeight: 180px;
}

.banner {
  width: 100%;
  height: var(--bannerHeight);
  background-color: #4c5e6d;
  background-size: cover;
  background-position: center 50%;
}

.bannerEmpty {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--nd-accent) 40%, var(--nd-panel)),
    color-mix(in srgb, var(--nd-accent) 20%, var(--nd-panel))
  );
}

.bannerFade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 78px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  pointer-events: none;
}

.bannerTitle {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 0 16px 10px 132px;
  color: #fff;
  pointer-events: none;
}

.bannerName {
  line-height: 32px;
  font-weight: bold;
  font-size: 1.5em;
  filter: drop-shadow(0 0 4px #000);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bannerBottom {
  line-height: 20px;
  opacity: 0.9;
  filter: drop-shadow(0 0 4px #000);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bannerUsername {
  font-weight: bold;
  font-family: var(--nd-font-mono, monospace);
  font-size: 0.95em;
}

.bannerBadge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--nd-radius-full);
  font-size: 0.75em;
  background: rgba(255, 255, 255, 0.22);
  text-transform: lowercase;
}

.serverIconWrap {
  position: absolute;
  top: 110px;
  left: 16px;
  z-index: 2;
  width: 96px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  // 背景無し・透過。アイコン自体に透明部分があればそのまま透過する。
  background: transparent;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.35));
}

.serverIcon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.roles {
  padding: 12px 24px 0 132px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.85em;
}

.role {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: solid 1px var(--nd-divider);
  border-radius: var(--nd-radius-full);
  font-weight: 500;
}

.roleError {
  border-color: var(--nd-love);
  color: var(--nd-love);
}

.roleWarn {
  border-color: var(--nd-warn, #e8a530);
  color: var(--nd-warn, #e8a530);
}

.description {
  padding: 24px 24px 0 132px;
  margin: 0;
  font-size: 0.95em;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;

  a {
    color: var(--nd-accent);

    &:hover {
      text-decoration: underline;
    }
  }

  // Misskey description は段落区切りに連続 <br> を使うことが多い。
  // 素のままだと空行が詰まって見づらいので pre-wrap と合わせて改行を尊重。
  p {
    margin: 0 0 0.5em;
  }

  ul,
  ol {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }
}

.profileInfo {
  padding: 16px 24px 0 132px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  font-size: 0.85em;
  opacity: 0.85;
}

.profileInfoItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  i {
    opacity: 0.7;
  }
}

.dim {
  opacity: 0.6;
}

.stats {
  display: flex;
  padding: 24px;
  border-top: solid 0.5px var(--nd-divider);
  margin-top: 20px;
}

.stat {
  flex: 1;
  text-align: center;

  > b {
    display: block;
    line-height: 16px;
    font-size: 1.1em;
    color: var(--nd-fgHighlighted);
  }

  > span {
    font-size: 70%;
    opacity: 0.6;
  }
}

.wellKnownSection {
  border-top: solid 0.5px var(--nd-divider);
  padding: 16px 24px 24px;
}

.sectionHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0 12px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.7;

  i {
    font-size: 1em;
  }
}

.linkList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.linkBtn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  font-size: 0.85em;
  color: var(--nd-fg);
  background: var(--nd-panel);
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);
  // <a> タグのデフォルト下線を消して button 風に見せる
  text-decoration: none;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  i {
    opacity: 0.6;
    font-size: 0.9em;
  }
}

.linkPath {
  font-family: var(--nd-font-mono, monospace);
}

.rawPane {
  height: 100%;
  display: flex;
  flex-direction: column;
}

// Narrow container (container query): 132px オフセットだと狭い窓で潰れるため
// モバイル風レイアウトに切り替え。
@container (max-width: 480px) {
  .bannerTitle {
    padding-left: 16px;
    padding-bottom: 48px;
  }
  .serverIconWrap {
    top: 124px;
    left: 50%;
    transform: translateX(-50%);
    width: 80px;
    height: 80px;
  }
  .description,
  .profileInfo,
  .roles {
    padding-left: 24px;
    padding-top: 56px;
  }
  .roles {
    justify-content: center;
  }
}
</style>
