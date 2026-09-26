<script setup lang="ts">
import { useRouter } from 'vue-router'
import UserProfileContent from '@/components/window/UserProfileContent.vue'
import { i18n } from '@/i18n'

const props = defineProps<{
  accountId: string
  userId: string
}>()

const router = useRouter()
</script>

<template>
  <div :class="$style.userProfilePage">
    <header :class="$style.profileHeader">
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
      <h1 :class="$style.profileTitle">{{ i18n.ts._windows.userProfile }}</h1>
    </header>

    <UserProfileContent
      :account-id="props.accountId"
      :user-id="props.userId"
    />
  </div>
</template>

<style lang="scss" module>
.userProfilePage {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--nd-bg);
}

.profileHeader {
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

.profileTitle {
  font-size: 0.9em;
  font-weight: bold;
  margin: 0;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
