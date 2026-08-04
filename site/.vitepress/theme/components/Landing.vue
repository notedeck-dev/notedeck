<script setup lang="ts">
import { useLatestRelease } from '../composables/useLatestRelease'
import { useScrollReveal } from '../composables/useScrollReveal'
import LandingDevelopers from './landing/LandingDevelopers.vue'
import LandingDownload from './landing/LandingDownload.vue'
import LandingFeatures from './landing/LandingFeatures.vue'
import LandingGuest from './landing/LandingGuest.vue'
import LandingHero from './landing/LandingHero.vue'
import LandingIde from './landing/LandingIde.vue'
import LandingKeyFeatures from './landing/LandingKeyFeatures.vue'
import LandingMore from './landing/LandingMore.vue'

// リリース情報の取得はここ 1 回だけ。ヒーローの告知とダウンロードカードで使い回す
const { version, noticeText, noticeHref, downloadUrls, RELEASES_LATEST } =
  useLatestRelease()

useScrollReveal()
</script>

<template>
  <div class="landing">
    <LandingHero :notice-text="noticeText" :notice-href="noticeHref" />
    <LandingKeyFeatures />

    <div class="scroll-label" aria-hidden="true">Scroll</div>

    <LandingGuest />
    <LandingFeatures />
    <LandingMore />
    <LandingIde />
    <LandingDevelopers />
    <LandingDownload
      :version="version"
      :download-urls="downloadUrls"
      :releases-latest="RELEASES_LATEST"
    />
  </div>
</template>
