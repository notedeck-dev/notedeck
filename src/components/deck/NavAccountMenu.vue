<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useNavigation } from '@/composables/useNavigation'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'
import { webUiUrl } from '@/services/safeUrl'
import { modeIcon } from '@/services/timelinePolicy'
import { type Account, isGuestAccount } from '@/stores/accounts'
import { modeLabel } from '@/utils/customTimelines'
import { hapticSelection } from '@/utils/haptics'
import { openSafeUrl } from '@/utils/url'

const props = defineProps<{
  show: boolean
  account: Account
  modes: Record<string, boolean>
  togglingMode: boolean
  modeError: string | null
  isAdmin: boolean
}>()

const { visible: menuVisible, leaving: menuLeaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 180, leaveDuration: 200 },
)

const emit = defineEmits<{
  'toggle-mode': [key: string]
  logout: []
  relogin: [host: string]
  'clear-cache': []
  close: []
}>()

const { navigateToUser } = useNavigation()
const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => menuVisible.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 200,
  },
)

const hasUpperSection = computed(
  () =>
    (props.account.hasToken && Object.keys(props.modes).length > 0) ||
    !isGuestAccount(props.account) ||
    props.isAdmin,
)
</script>

<template>
  <dialog
    v-if="menuVisible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, menuLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <div
      autofocus
      tabindex="-1"
      class="_popupMenu"
      :class="[$style.navAccountMenu, menuLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
      @click.stop
    >
      <template v-if="account.hasToken && Object.keys(modes).length > 0">
        <button
          v-for="(val, key) in modes"
          :key="key"
          class="_button"
          :class="[$style.navAccountMenuItem, { [$style.modeActive]: val }]"
          :disabled="togglingMode"
          @click="hapticSelection(); emit('toggle-mode', key as string)"
          @keydown.enter="emit('toggle-mode', key as string)"
        >
          <span :class="$style.navAccountMenuLabel">{{ modeLabel(key as string) }}</span>
          <i :class="['ti', `ti-${modeIcon(key as string, val)}`]" />
        </button>
      </template>
      <div v-if="modeError" :class="$style.navAccountMenuError">{{ modeError }}</div>
      <template v-if="!isGuestAccount(account)">
        <div v-if="account.hasToken && Object.keys(modes).length > 0" :class="$style.navAccountMenuDivider" />
        <button class="_button" :class="$style.navAccountMenuItem" @click="navigateToUser(account.id, account.userId)">
          <span>{{ i18n.ts._windows.userProfile }}</span>
          <i class="ti ti-user" />
        </button>
        <div :class="$style.navAccountMenuDivider" />
        <button class="_button" :class="$style.navAccountMenuItem" @click="openSafeUrl(webUiUrl(account.host, '/settings'))">
          <span>{{ i18n.ts._common.settings }}</span>
          <i class="ti ti-external-link" />
        </button>
      </template>
      <button v-if="isAdmin" class="_button" :class="$style.navAccountMenuItem" @click="openSafeUrl(webUiUrl(account.host, '/admin'))">
        <span>{{ i18n.ts._navAccountMenu.controlPanel }}</span>
        <i class="ti ti-external-link" />
      </button>

      <div v-if="hasUpperSection" :class="$style.navAccountMenuDivider" />
      <button class="_button" :class="$style.navAccountMenuItem" @click="emit('clear-cache')">
        <span>{{ i18n.ts._common.clearCache }}</span>
        <i class="ti ti-eraser" />
      </button>
      <template v-if="account.hasToken">
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountLogout]" @click="emit('logout')">
          <span>{{ i18n.ts._common.logout }}</span>
          <i class="ti ti-logout" />
        </button>
      </template>
      <template v-else-if="isGuestAccount(account)">
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountLogout]" @click="emit('logout')">
          <span>{{ i18n.ts._common.deleteData }}</span>
          <i class="ti ti-trash" />
        </button>
      </template>
      <template v-else>
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountRelogin]" @click="emit('relogin', account.host)">
          <span>{{ i18n.ts._common.relogin }}</span>
          <i class="ti ti-login" />
        </button>
        <button class="_button" :class="[$style.navAccountMenuItem, $style.navAccountLogout]" @click="emit('logout')">
          <span>{{ i18n.ts._common.deleteData }}</span>
          <i class="ti ti-trash" />
        </button>
      </template>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.navAccountMenu {
  width: 100%;
  margin: 0;
  padding: 8px 0 calc(8px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));
  min-width: 0;
  border-radius: var(--nd-radius-sheet) var(--nd-radius-sheet) 0 0;
  background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
  box-shadow: var(--nd-shadow-sheet);
  max-height: 80vh;
  overflow-y: auto;

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.navAccountMenuItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px;
  min-height: 44px;
  cursor: pointer;
  transition: background var(--nd-duration-fast);
  font-size: var(--nd-font-body);
  color: var(--nd-fg);
  width: 100%;
  text-align: left;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.modeActive {
  color: var(--nd-accentText);
}

.navAccountMenuLabel {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.navAccountMenuDivider {
  height: 1px;
  background: var(--nd-divider);
  margin: 4px 0;
}

.navAccountMenuError {
  padding: 6px 14px;
  font-size: var(--nd-font-xs);
  color: var(--nd-love);
  word-break: break-word;
}

.navAccountLogout {
  color: var(--nd-love);
  gap: 8px;

  .ti {
    flex-shrink: 0;
    opacity: 0.8;
  }
}

.navAccountRelogin {
  color: var(--nd-accentText);
  gap: 8px;

  .ti {
    flex-shrink: 0;
  }
}
</style>
