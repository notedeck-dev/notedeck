<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  useTemplateRef,
} from 'vue'
import { i18n } from '@/i18n'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { usePortal } from '@/composables/usePortal'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { openSafeUrl } from '@/utils/url'
import DeckColumn from './DeckColumn.vue'

interface ServerMeta {
  version: string
  repositoryUrl: string | null
  providesTarball?: boolean
  name: string | null
}

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars, error, withLoading, scroller, scrollToTop } =
  useColumnSetup(() => props.column)
useColumnPullScroller(scroller)

const meta = ref<ServerMeta | null>(null)
const postPortalRef = useTemplateRef<HTMLElement>('postPortalRef')
usePortal(postPortalRef)

const showPostForm = ref(false)

const isModifiedVersion = computed(() => {
  if (!meta.value?.repositoryUrl) return false
  return meta.value.repositoryUrl !== 'https://github.com/misskey-dev/misskey'
})

function iLoveMisskey() {
  if (!account.value?.hasToken) return
  showPostForm.value = true
}

function closePostForm() {
  showPostForm.value = false
}

// プロジェクトメンバー（本家準拠）
const members = [
  {
    username: 'syuilo',
    avatar: 'https://avatars.githubusercontent.com/u/4439005?v=4',
    github: 'https://github.com/syuilo',
  },
  {
    username: 'acid-chicken',
    avatar: 'https://avatars.githubusercontent.com/u/20679825?v=4',
    github: 'https://github.com/acid-chicken',
  },
  {
    username: 'kakkokari-gtyih',
    avatar: 'https://avatars.githubusercontent.com/u/67428053?v=4',
    github: 'https://github.com/kakkokari-gtyih',
  },
  {
    username: 'tai-cha',
    avatar: 'https://avatars.githubusercontent.com/u/40626578?v=4',
    github: 'https://github.com/tai-cha',
  },
  {
    username: 'samunohito',
    avatar: 'https://avatars.githubusercontent.com/u/46447427?v=4',
    github: 'https://github.com/samunohito',
  },
  {
    username: 'anatawa12',
    avatar: 'https://avatars.githubusercontent.com/u/22656849?v=4',
    github: 'https://github.com/anatawa12',
  },
]

// スポンサー（本家準拠）
const sponsors = [
  {
    name: 'Mask Network',
    url: 'https://mask.io/',
    logo: 'https://assets.misskey-hub.net/sponsors/masknetwork.png',
  },
  {
    name: 'XServer',
    url: 'https://www.xserver.ne.jp/',
    logo: 'https://assets.misskey-hub.net/sponsors/xserver.png',
  },
  {
    name: 'Skeb',
    url: 'https://skeb.jp/',
    logo: 'https://assets.misskey-hub.net/sponsors/skeb.svg',
  },
  {
    name: 'GMO Pepabo',
    url: 'https://pepabo.com/',
    logo: 'https://assets.misskey-hub.net/sponsors/gmo_pepabo.svg',
  },
  {
    name: 'Purple Dot Digital',
    url: 'https://purpledotdigital.com/',
    logo: 'https://assets.misskey-hub.net/sponsors/purple-dot-digital.jpg',
  },
  {
    name: '合同会社サッズ', // i18n-ignore: data
    url: 'https://sads-llc.co.jp/',
    logo: 'https://assets.misskey-hub.net/sponsors/sads-llc.png',
  },
]

function openLink(url: string) {
  openSafeUrl(url)
}

async function fetchMeta() {
  const acc = account.value
  if (!acc) return
  await withLoading(async () => {
    meta.value = unwrap(
      await commands.apiGetMetaDetail(acc.id),
    ) as unknown as ServerMeta
  })
}

onMounted(() => {
  fetchMeta()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? i18n.ts._columns.aboutMisskey"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="fetchMeta"
    @refresh="fetchMeta"
  >
    <template #header-icon>
      <i class="ti ti-info-circle" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
    </template>

    <div v-if="error" :class="[$style.columnEmpty, $style.columnError]">
      {{ error.message }}
    </div>

    <div v-else-if="meta" ref="scroller" :class="$style.aboutBody">
      <!-- Hero -->
      <div :class="$style.aboutHero">
        <img
          src="/misskey-icon.png"
          alt="Misskey"
          :class="$style.aboutIcon"
        />
        <div :class="$style.aboutTitle">Misskey</div>
        <div :class="$style.aboutVersion">v{{ meta.version }}</div>
      </div>

      <!-- Description -->
      <div :class="$style.aboutDesc">
        {{ i18n.ts._deckAboutMisskeyColumn.description }}
        <button class="_button" :class="$style.aboutLearnMore" @click="openLink('https://misskey-hub.net/docs/about-misskey/')">
          {{ i18n.ts._deckAboutMisskeyColumn.learnMore }}
        </button>
      </div>

      <!-- I love Misskey -->
      <div :class="$style.aboutLove">
        <button class="_button" :class="$style.loveButton" @click="iLoveMisskey">
          I <span :class="$style.loveHeart">&#10084;&#65039;</span> #Misskey
        </button>
      </div>

      <!-- Links -->
      <div :class="$style.aboutSection">
        <div :class="$style.aboutLinks">
          <button class="_button" :class="$style.aboutLink" @click="openLink('https://github.com/misskey-dev/misskey')">
            <i class="ti ti-code" :class="$style.aboutLinkIcon" />
            <span>{{ i18n.ts._deckAboutMisskeyColumn.sourceCodeOriginal }}</span>
            <span :class="$style.aboutLinkSuffix">GitHub</span>
          </button>
          <button class="_button" :class="$style.aboutLink" @click="openLink('https://crowdin.com/project/misskey')">
            <i class="ti ti-language-hiragana" :class="$style.aboutLinkIcon" />
            <span>{{ i18n.ts._deckAboutMisskeyColumn.translation }}</span>
            <span :class="$style.aboutLinkSuffix">Crowdin</span>
          </button>
          <button class="_button" :class="$style.aboutLink" @click="openLink('https://www.patreon.com/syuilo')">
            <i class="ti ti-pig-money" :class="$style.aboutLinkIcon" />
            <span>{{ i18n.ts._deckAboutMisskeyColumn.donate }}</span>
            <span :class="$style.aboutLinkSuffix">Patreon</span>
          </button>
        </div>
      </div>

      <!-- Modified version notice -->
      <div v-if="isModifiedVersion" :class="$style.aboutSection">
        <div :class="$style.modifiedNotice">
          <i class="ti ti-info-circle" />
          <span>{{ i18n.ts._deckAboutMisskeyColumn.modifiedNotice }}</span>
        </div>
        <div :class="$style.aboutLinks">
          <button v-if="meta.repositoryUrl" class="_button" :class="$style.aboutLink" @click="openLink(meta.repositoryUrl!)">
            <i class="ti ti-code" :class="$style.aboutLinkIcon" />
            <span>{{ i18n.ts._deckAboutMisskeyColumn.sourceCode }}</span>
            <i class="ti ti-external-link" :class="$style.aboutLinkSuffix" />
          </button>
        </div>
      </div>

      <!-- Project members -->
      <div :class="$style.aboutSection">
        <div :class="$style.aboutSectionLabel">{{ i18n.ts._deckAboutMisskeyColumn.projectMembers }}</div>
        <div :class="$style.membersGrid">
          <button
            v-for="m in members"
            :key="m.username"
            class="_button"
            :class="$style.memberCard"
            @click="openLink(m.github)"
          >
            <img :src="proxyThumbUrl(m.avatar, 56)" :alt="m.username" :class="$style.memberAvatar" loading="lazy" />
            <span :class="$style.memberName">@{{ m.username }}</span>
          </button>
        </div>
      </div>

      <!-- Sponsors -->
      <div :class="$style.aboutSection">
        <div :class="$style.aboutSectionLabel">Special thanks</div>
        <div :class="$style.sponsorsGrid">
          <button
            v-for="s in sponsors"
            :key="s.name"
            class="_button"
            :class="$style.sponsorCard"
            :title="s.name"
            @click="openLink(s.url)"
          >
            <img :src="s.logo" :alt="s.name" :class="$style.sponsorLogo" loading="lazy" />
          </button>
        </div>
      </div>
    </div>

    <div v-else :class="$style.columnEmpty">
      {{ i18n.ts._deckAboutMisskeyColumn.fetchFailed }}
    </div>
  </DeckColumn>

  <div v-if="showPostForm && column.accountId" ref="postPortalRef">
    <MkPostForm
      :account-id="column.accountId"
      initial-text="I ❤ #Misskey"
      @close="closePostForm"
    />
  </div>
</template>

<style lang="scss" module>
@use "./column-common.module.scss";

.aboutBody {
  composes: columnScroller from './column-common.module.scss';
}

/* Hero */
.aboutHero {
  text-align: center;
  padding: 24px 16px 16px;
}

.aboutIcon {
  display: block;
  width: 80px;
  height: 80px;
  margin: 0 auto;
  border-radius: var(--nd-radius-sheet);
  object-fit: contain;
}

.aboutTitle {
  margin-top: 12px;
  font-size: var(--nd-font-xl);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fgHighlighted);
}

.aboutVersion {
  margin-top: 2px;
  font-size: var(--nd-font-md);
  opacity: 0.5;
}

/* Description */
.aboutDesc {
  text-align: center;
  padding: 0 16px 16px;
  font-size: var(--nd-font-body);
  line-height: 1.6;
  color: var(--nd-fg);
}

.aboutLearnMore {
  color: var(--nd-accentText);
  font-size: inherit;

  &:hover {
    text-decoration: underline;
  }
}

/* I love Misskey */
.aboutLove {
  text-align: center;
  padding: 0 16px 16px;
}

.loveButton {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 10px 24px;
  border-radius: var(--nd-radius-full);
  background: linear-gradient(90deg, var(--nd-buttonGradateA), var(--nd-buttonGradateB));
  color: var(--nd-fgOnAccent);
  font-weight: var(--nd-weight-bold);
  font-size: var(--nd-font-body);
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
  }
}

.loveHeart {
  display: inline-block;
  font-size: var(--nd-font-lg);
  transform-origin: center;
  animation: heartbeat 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes heartbeat {
  0%, 55%, 100% { transform: scale(1); }
  10% { transform: scale(1.25); }
  22% { transform: scale(1); }
  32% { transform: scale(1.15); }
  44% { transform: scale(1); }
}

/* Sections */
.aboutSection {
  border-top: solid 0.5px var(--nd-divider);
}

.aboutSectionLabel {
  font-weight: var(--nd-weight-bold);
  padding: 1.5em 16px 0;
  margin-bottom: 8px;
  font-size: var(--nd-font-md);
}

/* Links */
.aboutLinks {
  padding: 8px 16px 12px;
}

.aboutLink {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 10px 14px;
  margin-bottom: 6px;
  background: var(--nd-buttonBg);
  border-radius: var(--nd-radius-sm);
  font-size: var(--nd-font-body);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.aboutLinkIcon {
  margin-right: 0.75em;
  flex-shrink: 0;
  opacity: 0.75;
}

.aboutLinkSuffix {
  margin-left: auto;
  opacity: 0.5;
  flex-shrink: 0;
}

/* Modified version notice */
.modifiedNotice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 12px 16px 8px;
  padding: 12px;
  border-radius: var(--nd-radius-md);
  background: var(--nd-infoWarnBg, var(--nd-accentedBg));
  font-size: var(--nd-font-md);
  color: var(--nd-infoWarnFg);
  line-height: 1.5;

  > .ti {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--nd-warn);
  }
}

/* Members */
.membersGrid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 0 16px 12px;
}

.memberCard {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: var(--nd-buttonBg);
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.memberAvatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
}

.memberName {
  font-size: var(--nd-font-md);
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sponsors */
.sponsorsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 16px;
  padding: 0 16px 16px;
  align-items: center;
}

.sponsorCard {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.sponsorLogo {
  width: 100%;
  max-height: 40px;
  object-fit: contain;
}
</style>
