<script setup lang="ts">
import { computed } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import { proxyThumbUrl } from '@/utils/mediaProxy'

const props = withDefaults(
  defineProps<{
    accountId: string | null | undefined
    /** Badge size in px */
    size?: number
  }>(),
  {
    size: 14,
  },
)

const accountsStore = useAccountsStore()
const serversStore = useServersStore()

const hasMultipleAccounts = computed(() => accountsStore.accounts.length > 1)

const account = computed(() => {
  if (!props.accountId || !hasMultipleAccounts.value) return null
  return accountsStore.accountMap.get(props.accountId) ?? null
})

const serverIcon = computed(() => {
  if (!account.value) return null
  const url = serversStore.getServer(account.value.host)?.iconUrl ?? null
  return url ? (proxyThumbUrl(url, 28) ?? null) : null
})

const avatarThumbUrl = computed(() => {
  if (!account.value?.avatarUrl) return null
  return proxyThumbUrl(account.value.avatarUrl, 28) ?? null
})

const hostInitial = computed(
  () => account.value?.host.charAt(0).toUpperCase() ?? '',
)

const usernameInitial = computed(
  () => account.value?.username.charAt(0).toUpperCase() ?? '',
)
</script>

<template>
  <template v-if="account">
    <span
      :class="$style.serverBadge"
      :style="{ width: `${size}px`, height: `${size}px` }"
    >
      <img
        v-if="serverIcon"
        :src="serverIcon"
        :class="$style.badgeImg"
        :width="size - 4"
        :height="size - 4"
      />
      <span v-else :class="$style.badgeInitial">{{ hostInitial }}</span>
    </span>
    <span
      :class="$style.accountBadge"
      :style="{ width: `${size}px`, height: `${size}px` }"
    >
      <img
        v-if="avatarThumbUrl"
        :src="avatarThumbUrl"
        :class="$style.badgeImg"
        :width="size - 4"
        :height="size - 4"
      />
      <span v-else :class="$style.badgeInitial">{{ usernameInitial }}</span>
    </span>
  </template>
</template>

<style lang="scss" module>
.serverBadge,
.accountBadge {
  position: absolute;
  border-radius: 50%;
  overflow: hidden;
  border: 1.5px solid var(--column-badge-border, var(--nd-panel));
  background: var(--column-badge-border, var(--nd-panel));
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.serverBadge {
  top: var(--column-badge-server-top, -4px);
  right: var(--column-badge-server-right, -4px);
}

.accountBadge {
  bottom: var(--column-badge-account-bottom, -4px);
  left: var(--column-badge-account-left, -4px);
}

.badgeImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.badgeInitial {
  font-size: 7px;
  font-weight: bold;
  line-height: 1;
  color: var(--nd-fg);
  opacity: 0.7;
}
</style>
