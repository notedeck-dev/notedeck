<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import type { PlatformKey } from '../../composables/useLatestRelease'

const props = defineProps<{
  version: string
  downloadUrls: Partial<Record<PlatformKey, string>>
  releasesLatest: string
}>()

/** リリースアセットが引けていればその直リンク、駄目なら /releases/latest へ。 */
function hrefFor(platform: PlatformKey) {
  return props.downloadUrls[platform] ?? props.releasesLatest
}

const copied = ref('')
let resetTimer: ReturnType<typeof setTimeout> | undefined

function copy(command: string) {
  navigator.clipboard.writeText(command)
  copied.value = command
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = ''
  }, 1500)
}

onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <!-- Hub の dots 背景の上に -->
  <section id="download" class="dots-section">
    <div class="w-secondary">
      <div class="section-head" data-fade>
        <h2 class="section-title"><b class="u-line">ダウンロード</b></h2>
        <p class="section-desc">
          お使いの環境に合わせてインストール<br />
          <span class="chip version-chip">{{ version }}</span>
        </p>
      </div>

      <div class="platforms" data-fade>
        <a :href="hrefFor('windows')" class="platform acrylic punched">
          <svg viewBox="0 0 24 24"><path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5l-8-1.25V12.5zM11.5 5.34l9.5-1.34v8h-9.5V5.34zM11.5 12.5H21v7.5l-9.5-1.34V12.5z" /></svg>
          <div class="os">Windows</div>
          <div class="format">.exe</div>
        </a>
        <a :href="hrefFor('macos')" class="platform acrylic punched">
          <svg viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg>
          <div class="os">macOS</div>
          <div class="format">.dmg (Universal)</div>
        </a>
        <a :href="hrefFor('linux')" class="platform acrylic punched">
          <svg viewBox="0 0 24 24"><path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.868.07 1.723-.467 2.395-.722.67-.26 1.203-.394 1.587-.848.192-.227.313-.525.313-.847 0-.233-.063-.466-.194-.661-.12-.18-.255-.394-.32-.608-.065-.225.01-.393.13-.592.18-.275.39-.597.305-1.103-.012-.064-.03-.132-.05-.192.36-.36.59-.833.665-1.284a2.634 2.634 0 00-.04-1.14c-.053-.209-.158-.393-.193-.672a1.905 1.905 0 01.03-.574 3.824 3.824 0 00-.127-1.795c-.283-.717-.754-1.333-1.322-1.868-.283-.263-.588-.508-.898-.727-1.15-.871-2.21-1.778-2.634-3.237-.186-.605-.32-1.22-.47-1.867-.085-.347-.2-.7-.364-1.017a4.152 4.152 0 00-.655-.915c-.876-.97-2.22-1.38-3.559-1.4zm-.01 1.07c1.14.017 2.24.378 2.99 1.22.21.227.39.482.55.78.14.28.24.59.32.9.15.63.28 1.24.47 1.87.48 1.63 1.67 2.63 2.87 3.54.29.21.57.44.83.68.51.48.93 1.03 1.17 1.65.12.31.16.67.13 1.02-.03.37-.09.74.01 1.12.06.36.2.62.27.91.03.12.06.25.06.38 0 .27-.12.5-.26.69a2.725 2.725 0 00-.46.96c-.02.1-.03.2-.03.32 0 .08.01.15.02.22-.13.24-.32.44-.54.73-.12.18-.23.39-.28.64-.05.26-.03.5.02.73.06.21.18.42.31.61.09.13.15.27.18.38a.37.37 0 010 .17c-.02.12-.15.25-.32.39-.16.14-.39.28-.67.42-.57.27-1.3.48-1.82.51-.54.05-1.14-.38-1.42-.74a.8.8 0 01-.1-.2l-.01-.03c-.22-.39-.18-.78-.03-1.27.16-.53-.04-1-.11-1.33a3.384 3.384 0 00-.05-.15c-.11-.38-.3-.74-.62-.94-.33-.2-.69-.2-1.01-.12-.62.17-1.39-.02-2.14-.37-.38-.18-.76-.33-1.16-.41-.4-.08-.84-.1-1.28.05-.22.08-.39.21-.52.37-.13.18-.21.37-.27.56-.12.37-.15.78-.18 1.04-.02.19-.02.37-.06.52-.03.15-.09.24-.16.31a.698.698 0 01-.43.2c-.37.03-1.02-.13-1.73-.38-.35-.13-.56-.21-.7-.29a.458.458 0 01-.16-.15c-.07-.13-.06-.38.18-.89.1-.21.09-.45.04-.67-.05-.23-.13-.43-.19-.62-.12-.4-.17-.65-.12-.8.04-.14.17-.38.54-.6.36-.21.76-.34 1.08-.49.32-.14.6-.3.82-.55.24-.26.4-.54.55-.82.31-.57.46-1.15.45-1.6-.03-.92.16-1.76.47-2.61.54-1.55 1.68-3.13 2.55-4.17.82-1.07 1.16-2.19 1.24-3.3.07-1.28-.01-2.66.47-3.73.24-.54.58-.93 1.07-1.17a2.6 2.6 0 011.48-.33z" /></svg>
          <div class="os">Linux</div>
          <div class="format">.deb / .AppImage</div>
        </a>
        <a :href="hrefFor('android')" class="platform acrylic punched">
          <svg viewBox="0 0 24 24"><path d="M17.523 15.341a.96.96 0 100-1.922.96.96 0 000 1.922zm-11.046 0a.96.96 0 100-1.922.96.96 0 000 1.922zm11.4-6.028l1.996-3.458a.413.413 0 00-.151-.563.413.413 0 00-.563.151l-2.022 3.5A12.22 12.22 0 0012 8.072a12.22 12.22 0 00-5.137.871L4.841 5.443a.413.413 0 00-.563-.151.413.413 0 00-.151.563l1.996 3.458C2.691 11.283.342 14.59 0 18.5h24c-.342-3.91-2.691-7.217-6.123-9.187z" /></svg>
          <div class="os">Android</div>
          <div class="format">.apk</div>
        </a>
        <a href="#store-distribution" class="platform platform-soon acrylic punched">
          <svg viewBox="0 0 24 24"><path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.198l2.807 1.626a1 1 0 010 1.73l-2.808 1.626L15.39 12l2.308-2.491zM5.864 2.658L16.802 8.99l-2.303 2.303-8.635-8.635z" /></svg>
          <div class="os">Google Play</div>
          <div class="format">Coming soon</div>
        </a>
        <a href="#store-distribution" class="platform platform-soon acrylic punched">
          <svg viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg>
          <div class="os">App Store</div>
          <div class="format">Coming soon</div>
        </a>
      </div>

      <div class="install-alt acrylic" data-fade>
        <h3>パッケージマネージャー</h3>
        <button
          type="button"
          class="install-cmd"
          :class="{ copied: copied === 'winget install NotedeckDev.NoteDeck' }"
          @click="copy('winget install NotedeckDev.NoteDeck')"
        >
          <div class="label">winget</div>
          <code><span class="sh-prompt">$</span> <span class="sh-cmd">winget</span> <span class="sh-sub">install</span> <span class="sh-arg">NotedeckDev.NoteDeck</span></code>
          <span class="copy-hint">
            {{ copied === 'winget install NotedeckDev.NoteDeck' ? 'copied!' : 'click to copy' }}
          </span>
        </button>
        <button
          type="button"
          class="install-cmd"
          :class="{ copied: copied === 'yay -S misskey-notedeck-bin' }"
          @click="copy('yay -S misskey-notedeck-bin')"
        >
          <div class="label">AUR</div>
          <code><span class="sh-prompt">$</span> <span class="sh-cmd">yay</span> <span class="sh-flag">-S</span> <span class="sh-arg">misskey-notedeck-bin</span></code>
          <span class="copy-hint">
            {{ copied === 'yay -S misskey-notedeck-bin' ? 'copied!' : 'click to copy' }}
          </span>
        </button>
        <button
          type="button"
          class="install-cmd"
          :class="{ copied: copied === 'nix run github:notedeck-dev/notedeck' }"
          @click="copy('nix run github:notedeck-dev/notedeck')"
        >
          <div class="label">Nix</div>
          <code><span class="sh-prompt">$</span> <span class="sh-cmd">nix</span> <span class="sh-sub">run</span> <span class="sh-arg">github:notedeck-dev/notedeck</span></code>
          <span class="copy-hint">
            {{ copied === 'nix run github:notedeck-dev/notedeck' ? 'copied!' : 'click to copy' }}
          </span>
        </button>
      </div>

      <!-- Mobile Store Distribution -->
      <div id="store-distribution" class="store-distribution" data-fade>
        <h3 class="store-distribution-title">
          <b class="u-line">スマホ版を、ストアで届けるために</b>
        </h3>
        <p class="store-distribution-lead">
          Google Play / App Store
          への正式配布には、開発者アカウントの登録費とクローズドテストの参加者が必要です。需要があれば、コミュニティの皆さんと一緒に進めたいと思っています。
        </p>
        <div class="store-cta-grid">
          <div class="store-cta">
            <h4>ベータテスター募集</h4>
            <p>
              Google Play は、2023 年 11 月 13
              日以降に作成した個人開発者アカウントに製品版アクセスを与える条件として、12 名以上が 14
              日間続けて参加するクローズドテストを求めています。実機での動作確認やフィードバックにご協力いただける方を募集しています。
            </p>
            <a
              href="https://github.com/notedeck-dev/notedeck/issues/new?template=beta_tester.yml"
              class="btn btn-plain shadow"
            >
              テスターに応募
            </a>
          </div>
          <div class="store-cta">
            <h4>開発を支援する</h4>
            <p>
              Google Play（登録費 $25）/ Apple Developer Program（$99/年）のアカウント費用、テスト機材の調達、継続的な配布作業の維持にあてさせていただきます。
            </p>
            <a href="https://github.com/sponsors/hitalin" class="btn btn-accent shadow">
              GitHub Sponsor
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
