<script setup lang="ts">
import DOMPurify from 'dompurify'
import { computed, onMounted, ref } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { AppError } from '@/utils/errors'
import { proxyUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

interface ServerMeta {
  uri: string
  name: string | null
  description: string | null
  version: string
  maintainerName: string | null
  maintainerEmail: string | null
  inquiryUrl: string | null
  iconUrl: string | null
  bannerUrl: string | null
  tosUrl: string | null
  repositoryUrl: string | null
  impressumUrl: string | null
  privacyPolicyUrl: string | null
  feedbackUrl: string | null
  langs: string[]
  serverRules: string[]
}

interface ServerStats {
  notesCount: number
  originalNotesCount: number
  usersCount: number
  originalUsersCount: number
  instances: number
  reactionsCount?: number
}

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()

const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.column.accountId),
)

const { columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)

const serverIconUrl = ref<string | undefined>()
const isLoading = ref(false)
const error = ref<AppError | null>(null)
const meta = ref<ServerMeta | null>(null)
const stats = ref<ServerStats | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
useColumnPullScroller(scrollContainer)
const rulesOpen = ref(false)

type ServerTab = 'info' | 'meta' | 'stats'
const TAB_DEFS: { value: ServerTab; icon: string; label: string }[] = [
  { value: 'info', icon: 'info-circle', label: '情報' },
  { value: 'meta', icon: 'code', label: 'meta' },
  { value: 'stats', icon: 'chart-bar', label: 'stats' },
]
const tab = ref<ServerTab>('info')

const metaJson = computed(() =>
  meta.value ? JSON.stringify(meta.value, null, 2) : '',
)
const statsJson = computed(() =>
  stats.value ? JSON.stringify(stats.value, null, 2) : '',
)
const currentRawJson = computed(() =>
  tab.value === 'meta' ? metaJson.value : statsJson.value,
)

function scrollToTop() {
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function formatNumber(n: number | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString()
}

const sanitizedDescription = computed(() => {
  if (!meta.value?.description) return null
  return DOMPurify.sanitize(meta.value.description, {
    ALLOWED_TAGS: [
      'b',
      'i',
      'em',
      'strong',
      'a',
      'br',
      'p',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'img',
      'span',
      'div',
      'small',
      'center',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'style'],
  })
})

async function fetchServerInfo() {
  const acc = account.value
  if (!acc) return

  isLoading.value = true
  error.value = null

  try {
    const info = await serversStore.getServerInfo(acc.host)
    serverIconUrl.value = info.iconUrl

    const [metaResult, statsResult] = await Promise.all([
      commands.apiGetMetaDetail(acc.id),
      commands.apiGetServerStats(acc.id),
    ])

    meta.value = unwrap(metaResult) as unknown as ServerMeta
    stats.value = unwrap(statsResult) as unknown as ServerStats
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  fetchServerInfo()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'サーバー情報'"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="fetchServerInfo"
    @refresh="fetchServerInfo"
  >
    <template #header-icon>
      <i class="ti ti-server" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      is-error
      :image-url="serverErrorImageUrl"
      cta-label="再試行"
      cta-icon="ti-refresh"
      @cta="fetchServerInfo"
    />

    <div v-else-if="meta && account" :class="$style.tabWrapper">
      <EditorTabs
        :tabs="TAB_DEFS"
        :model-value="tab"
        @update:model-value="(v) => (tab = v as ServerTab)"
      />

      <div v-if="tab === 'info'" ref="scrollContainer" :class="$style.serverInfoBody">
      <!-- Banner (Misskey style: bg image + icon overlay + gradient name) -->
      <div
        :class="$style.banner"
        :style="meta.bannerUrl ? { backgroundImage: `url(${proxyUrl(meta.bannerUrl)})` } : undefined"
      >
        <div :class="$style.bannerInner">
          <img
            :src="meta.iconUrl || serverIconUrl || `https://${account.host}/favicon.ico`"
            alt=""
            :class="$style.bannerIcon"
          />
          <div :class="$style.bannerName">
            <b>{{ meta.name || account.host }}</b>
          </div>
        </div>
      </div>

      <!-- Description -->
      <div :class="$style.formSection">
        <div :class="$style.formKvRow">
          <div :class="$style.formKvKey">概要</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="sanitizedDescription" :class="$style.description" v-html="sanitizedDescription" />
          <div v-else :class="$style.muted">（説明なし）</div>
        </div>
      </div>

      <!-- Server info -->
      <div :class="$style.formSection">
        <div :class="$style.sectionContent">
          <div :class="$style.formKvRow">
            <div :class="$style.formKvKey">Misskey</div>
            <div :class="$style.formKvValue">{{ meta.version }}</div>
          </div>
          <a
            v-if="meta.repositoryUrl"
            :href="meta.repositoryUrl"
            target="_blank"
            rel="noopener"
            :class="$style.formLink"
          >
            <i class="ti ti-code" :class="$style.formLinkIcon" />
            <span>ソースコード</span>
            <span :class="$style.formLinkSuffix">
              <i class="ti ti-external-link" />
            </span>
          </a>
        </div>
      </div>

      <!-- Administrator -->
      <div :class="$style.formSection">
        <div :class="$style.sectionContent">
          <div :class="$style.formSplit">
            <div :class="$style.formKvRow">
              <div :class="$style.formKvKey">管理者</div>
              <div :class="$style.formKvValue">
                <template v-if="meta.maintainerName">{{ meta.maintainerName }}</template>
                <span v-else :class="$style.muted">（なし）</span>
              </div>
            </div>
            <div :class="$style.formKvRow">
              <div :class="$style.formKvKey">連絡先</div>
              <div :class="$style.formKvValue">
                <template v-if="meta.maintainerEmail">{{ meta.maintainerEmail }}</template>
                <span v-else :class="$style.muted">（なし）</span>
              </div>
            </div>
            <div :class="$style.formKvRow">
              <div :class="$style.formKvKey">問い合わせ</div>
              <div :class="$style.formKvValue">
                <a v-if="meta.inquiryUrl" :href="meta.inquiryUrl" target="_blank" rel="noopener" :class="$style.kvLink">{{ meta.inquiryUrl }}</a>
                <span v-else :class="$style.muted">（なし）</span>
              </div>
            </div>
          </div>
          <a
            v-if="meta.impressumUrl"
            :href="meta.impressumUrl"
            target="_blank"
            rel="noopener"
            :class="$style.formLink"
          >
            <i class="ti ti-user-shield" :class="$style.formLinkIcon" />
            <span>運営情報</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>

          <!-- Server Rules -->
          <div v-if="meta.serverRules && meta.serverRules.length > 0" :class="[$style.rulesContainer, { [$style.rulesOpen]: rulesOpen }]">
            <div :class="[$style.formLink, $style.rulesToggle]" @click="rulesOpen = !rulesOpen">
              <i class="ti ti-checkup-list" :class="$style.formLinkIcon" />
              <span>サーバールール</span>
              <span :class="$style.formLinkSuffix"><i class="ti ti-chevron-down" :class="$style.rulesChevron" /></span>
            </div>
            <ol :class="$style.rulesList">
              <li v-for="(rule, i) in meta.serverRules" :key="i" :class="$style.ruleItem">
                <span :class="$style.ruleNumber">{{ i + 1 }}</span>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div :class="$style.ruleText" v-html="DOMPurify.sanitize(rule, {
                  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br', 'p', 'ul', 'ol', 'li', 'code'],
                  ALLOWED_ATTR: ['href', 'target', 'rel'],
                })" />
              </li>
            </ol>
          </div>

          <a
            v-if="meta.tosUrl"
            :href="meta.tosUrl"
            target="_blank"
            rel="noopener"
            :class="$style.formLink"
          >
            <i class="ti ti-license" :class="$style.formLinkIcon" />
            <span>利用規約</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
          <a
            v-if="meta.privacyPolicyUrl"
            :href="meta.privacyPolicyUrl"
            target="_blank"
            rel="noopener"
            :class="$style.formLink"
          >
            <i class="ti ti-shield-lock" :class="$style.formLinkIcon" />
            <span>プライバシーポリシー</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
          <a
            v-if="meta.feedbackUrl"
            :href="meta.feedbackUrl"
            target="_blank"
            rel="noopener"
            :class="$style.formLink"
          >
            <i class="ti ti-message" :class="$style.formLinkIcon" />
            <span>フィードバック</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
        </div>
      </div>

      <!-- Statistics -->
      <div v-if="stats" :class="$style.formSection">
        <div :class="$style.formSectionLabel">統計</div>
        <div :class="$style.sectionContent">
          <div :class="$style.statsSplit">
            <div :class="$style.formKvRow">
              <div :class="$style.formKvKey">ユーザー</div>
              <div :class="$style.formKvValue">{{ formatNumber(stats.originalUsersCount) }}</div>
            </div>
            <div :class="$style.formKvRow">
              <div :class="$style.formKvKey">ノート</div>
              <div :class="$style.formKvValue">{{ formatNumber(stats.originalNotesCount) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Well-known resources -->
      <div :class="$style.formSection">
        <div :class="$style.formSectionLabel">Well-known resources</div>
        <div :class="$style.sectionContent">
          <a :href="`https://${account.host}/.well-known/host-meta`" target="_blank" rel="noopener" :class="$style.formLink">
            <span>host-meta</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
          <a :href="`https://${account.host}/.well-known/host-meta.json`" target="_blank" rel="noopener" :class="$style.formLink">
            <span>host-meta.json</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
          <a :href="`https://${account.host}/.well-known/nodeinfo`" target="_blank" rel="noopener" :class="$style.formLink">
            <span>nodeinfo</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
          <a :href="`https://${account.host}/robots.txt`" target="_blank" rel="noopener" :class="$style.formLink">
            <span>robots.txt</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
          <a :href="`https://${account.host}/manifest.json`" target="_blank" rel="noopener" :class="$style.formLink">
            <span>manifest.json</span>
            <span :class="$style.formLinkSuffix"><i class="ti ti-external-link" /></span>
          </a>
        </div>
      </div>
      </div>

      <RawJsonView
        v-else
        :json="currentRawJson"
        :loading="false"
        :error="null"
      >
        <template #hint>
          <i class="ti ti-info-circle" />
          <template v-if="tab === 'meta'">
            <code>/api/meta</code> の生レスポンス
          </template>
          <template v-else>
            <code>/api/stats</code> の生レスポンス
          </template>
        </template>
      </RawJsonView>
    </div>

    <ColumnEmptyState v-else message="サーバー情報を取得できませんでした" :image-url="serverInfoImageUrl" />
  </DeckColumn>
</template>

<style lang="scss" module>
@use "./column-common.module.scss";

.tabWrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.serverInfoBody {
  composes: columnScroller from './column-common.module.scss';
}

/* ---- Banner (Misskey style) ---- */
.banner {
  text-align: center;
  border-radius: 10px;
  overflow: clip;
  background-color: var(--nd-panelBg, var(--nd-bg));
  background-size: cover;
  background-position: center center;
  margin: 12px;
}

.bannerInner {
  overflow: clip;
}

.bannerIcon {
  display: block;
  margin: 16px auto 0 auto;
  height: 48px;
  border-radius: var(--nd-radius-md);
}

.bannerName {
  display: block;
  padding: 12px 16px;
  color: #fff;
  text-shadow: 0 0 8px #000;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  font-size: 1.05em;
}

/* ---- Form sections (Misskey FormSection style) ---- */
.formSection {
  border-top: solid 0.5px var(--nd-divider);

  &:first-child {
    border-top: none;
  }
}

.formSectionLabel {
  font-weight: bold;
  padding: 1.5em 16px 0;
  margin-bottom: 8px;
  font-size: 0.85em;
}

.sectionContent {
  margin-top: 1em;
  padding-bottom: 4px;
}

/* ---- Key-Value rows (Misskey MkKeyValue style) ---- */
.formKvRow {
  padding: 12px 16px;

  & + & {
    border-top: 1px solid var(--nd-divider);
  }
}

.formKvKey {
  font-size: 0.85em;
  opacity: 0.75;
  padding-bottom: 0.25em;
}

.formKvValue {
  color: var(--nd-fgHighlighted);
  word-break: break-word;
}

.muted {
  opacity: 0.7;
}

.kvLink {
  color: var(--nd-accent);
  text-decoration: none;
  word-break: break-all;

  &:hover {
    text-decoration: underline;
  }
}

/* ---- FormSplit (Misskey style side by side grid) ---- */
.formSplit {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  padding: 0 16px 12px;

  > .formKvRow {
    padding: 0;

    & + .formKvRow {
      border-top: none;
    }
  }
}

.statsSplit {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 0 16px 12px;

  > .formKvRow {
    padding: 0;

    & + .formKvRow {
      border-top: none;
    }
  }
}

/* ---- FormLink (Misskey style) ---- */
.formLink {
  display: flex;
  align-items: center;
  width: calc(100% - 32px);
  box-sizing: border-box;
  padding: 10px 14px;
  margin: 0 16px 8px;
  background: var(--nd-buttonBg);
  border-radius: var(--nd-radius-sm);
  font-size: 0.9em;
  color: var(--nd-fg);
  text-decoration: none;
  transition: background var(--nd-duration-base);
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonHoverBg);
    text-decoration: none;
  }
}

.formLinkIcon {
  margin-right: 0.75em;
  flex-shrink: 0;
  opacity: 0.75;
}

.formLinkSuffix {
  margin-left: auto;
  opacity: 0.7;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ---- Description ---- */
.description {
  font-size: 0.9em;
  line-height: 1.7;
  color: var(--nd-fg);
  word-break: break-word;

  :deep(a) {
    color: var(--nd-accent);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(img) {
    max-width: 100%;
    border-radius: var(--nd-radius-md);
  }

  :deep(h1),
  :deep(h2),
  :deep(h3) {
    color: var(--nd-fgHighlighted);
    margin: 0.8em 0 0.4em;
    font-size: 1.1em;
  }

  :deep(p) {
    margin: 0.5em 0;
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  :deep(blockquote) {
    border-left: 3px solid var(--nd-accent);
    padding-left: 12px;
    margin: 0.5em 0;
    opacity: 0.8;
  }
}

/* ---- Server Rules (Misskey MkFolder style) ---- */
.rulesContainer {
  margin: 0 16px 8px;

  .rulesList {
    display: none;
  }

  &.rulesOpen .rulesList {
    display: block;
  }

  &.rulesOpen .rulesChevron {
    transform: rotate(180deg);
  }
}

.rulesToggle {
  margin: 0;
  width: 100%;
  border-radius: var(--nd-radius-sm);
}

.rulesChevron {
  transition: transform var(--nd-duration-slow);
}

.rulesList {
  list-style: none;
  padding: 8px 0 4px;
  margin: 0;
}

.ruleItem {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  word-break: break-word;
}

.ruleNumber {
  flex-shrink: 0;
  display: flex;
  position: sticky;
  top: 8px;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
  font-size: 13px;
  font-weight: bold;
}

.ruleText {
  padding-top: 6px;
  font-size: 0.9em;
  line-height: 1.5;
  color: var(--nd-fg);
}
</style>
