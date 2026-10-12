<script setup lang="ts">
import { useI18n } from '../i18n'
import { useLatestRelease } from '../composables/useLatestRelease'
import { useScrollReveal } from '../composables/useScrollReveal'
import LandingDevelopers from './landing/LandingDevelopers.vue'
import LandingDownload from './landing/LandingDownload.vue'
import LandingFeatures from './landing/LandingFeatures.vue'
import LandingFree from './landing/LandingFree.vue'
import LandingGetStarted from './landing/LandingGetStarted.vue'
import LandingGuest from './landing/LandingGuest.vue'
import LandingHero from './landing/LandingHero.vue'
import LandingIde from './landing/LandingIde.vue'
import LandingIntro from './landing/LandingIntro.vue'
import LandingKeyFeatures from './landing/LandingKeyFeatures.vue'
import LandingServers from './landing/LandingServers.vue'
import LandingStats from './landing/LandingStats.vue'
import LandingUseCases from './landing/LandingUseCases.vue'

// リリース情報の取得はここ 1 回だけ。ヒーローの告知とダウンロードカードで使い回す
const { t } = useI18n()
const { version, noticeText, noticeHref, downloadUrls, RELEASES_LATEST } =
  useLatestRelease(t)

useScrollReveal()
</script>

<template>
  <!-- セクションの並びは misskey-hub-next の pages/index (desktop.vue) に合わせている:
       hero → keyFeatures → stats → scroll → getStarted → introduction + TIP →
       (guest) → decentralized (servers) → useCases → free → features × 3 → download -->
  <div class="landing">
    <LandingHero :notice-text="noticeText" :notice-href="noticeHref" />
    <LandingKeyFeatures />
    <LandingStats />

    <div class="scroll-label" aria-hidden="true">Scroll</div>

    <LandingGetStarted />
    <LandingIntro />
    <LandingGuest />
    <LandingServers />
    <LandingUseCases />
    <LandingFree />
    <LandingFeatures />
    <LandingIde />
    <LandingDevelopers />
    <LandingDownload
      :version="version"
      :download-urls="downloadUrls"
      :releases-latest="RELEASES_LATEST"
    />
  </div>
</template>
