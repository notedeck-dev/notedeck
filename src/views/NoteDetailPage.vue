<script setup lang="ts">
import { useRouter } from 'vue-router'
import NoteDetailContent from '@/components/window/NoteDetailContent.vue'
import { i18n } from '@/i18n'

const props = defineProps<{
  accountId: string
  noteId: string
}>()

const router = useRouter()

function onClose() {
  router.back()
}
</script>

<template>
  <div :class="$style.noteDetailPage">
    <header :class="$style.detailHeader">
      <router-link to="/" class="_button" :class="$style.backBtn">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
      </router-link>
      <h1 :class="$style.detailTitle">{{ i18n.ts._windows.noteDetail }}</h1>
    </header>

    <NoteDetailContent
      :account-id="props.accountId"
      :note-id="props.noteId"
      @close="onClose"
    />
  </div>
</template>

<style lang="scss" module>
.noteDetailPage {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--nd-bg);
}

.detailHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 50px;
  padding: 0 16px;
  border-bottom: 1px solid var(--nd-divider);
  position: sticky;
  top: 0;
  background: var(--nd-windowHeader);
  z-index: 10;
}

.backBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  text-decoration: none;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    text-decoration: none;
  }
}

.detailTitle {
  font-size: 0.9em;
  font-weight: bold;
  margin: 0;
  color: var(--nd-fgHighlighted);
}
</style>
