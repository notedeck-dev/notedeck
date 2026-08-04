<script setup lang="ts">
const REPO = 'https://github.com/notedeck-dev/notedeck'

const FOOTER_LINKS = [
  { text: 'GitHub', href: REPO },
  { text: 'Issues', href: `${REPO}/issues` },
  { text: 'Roadmap', href: `${REPO}/blob/main/ROADMAP.md` },
  { text: 'Store', href: 'https://store.notedeck.io' },
  { text: 'Sponsor', href: 'https://github.com/sponsors/hitalin' },
]
</script>

<template>
  <!-- Hub GFooter 相当 -->
  <footer class="hub-footer">
    <div class="footer-links">
      <a v-for="link in FOOTER_LINKS" :key="link.href" :href="link.href">{{ link.text }}</a>
    </div>
    <p class="footer-copyright">
      © 2026 NoteDeck — <a :href="`${REPO}/blob/main/LICENSE`">AGPL-3.0</a>
    </p>
  </footer>
</template>
