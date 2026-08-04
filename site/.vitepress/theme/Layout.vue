<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import HubFooter from './components/HubFooter.vue'
import HubNav from './components/HubNav.vue'

const { Layout: DefaultLayout } = DefaultTheme
</script>

<template>
  <DefaultLayout>
    <!-- ナビとフッターは Hub 由来の自前実装を使う。
         VitePress の VPNav / VPFooter は site.css で隠している -->
    <template #layout-top>
      <HubNav />
    </template>
    <template #layout-bottom>
      <HubFooter />
    </template>
  </DefaultLayout>
</template>
