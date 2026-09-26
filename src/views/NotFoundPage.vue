<script setup lang="ts">
import { useRouter } from 'vue-router'
import { i18n } from '@/i18n'

const router = useRouter()
</script>

<template>
  <div :class="$style.notFound">
    <h1>404</h1>
    <p>{{ i18n.ts._notFoundPage.message }}</p>
    <button class="_buttonPrimary" :class="$style.backBtn" @click="router.push('/')">
      {{ i18n.ts._notFoundPage.backToHome }}
    </button>
  </div>
</template>

<style lang="scss" module>
.notFound {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--nd-fg);
  gap: 8px;

  h1 {
    font-size: 3em;
    margin: 0;
    opacity: 0.3;
  }

  p {
    margin: 0;
    opacity: 0.5;
  }
}

.backBtn {
  margin-top: 16px;
  padding: 8px 24px;
  border-radius: var(--nd-radius-md);
}
</style>
