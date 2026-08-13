<script setup lang="ts">
/**
 * アカウント選択のボトムシート (#1018)。コンパクト表示専用。
 *
 * ナビバーのアカウント一覧が唯一まともなアカウント選択 UI だったので、それを
 * 共通化した。中央ダイアログやコマンドパレットで選ばせていた面も、コンパクト
 * 表示ではこのシートに寄せる。
 *
 * 2 段選択 (アカウント → 操作) は `stage` で切り替える。段が変わってもシートは
 * 開いたままなので、開き直しのアニメーションが挟まらない。
 */
import { computed, ref, toRef } from 'vue'
import AccountAvatar from '@/components/common/AccountAvatar.vue'
import AccountPickerRow from '@/components/common/AccountPickerRow.vue'
import { useBackButton } from '@/composables/useBackButton'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import {
  type Account,
  getAccountAvatarUrl,
  getAccountLabel,
} from '@/stores/accounts'

const props = defineProps<{
  show: boolean
  accounts: Account[]
  /** シート見出し。省略すると見出し行を出さない (ナビバーの一覧など) */
  title?: string
  /** 何のために選ぶのか。title の下に小さく出す */
  description?: string
  /** 展開中のアカウント (ナビバーのように行から次のメニューを開く面で使う) */
  activeId?: string | null
  /** 行に chevron を出す (選ぶと次の段がある) */
  hasNext?: boolean
  /** 行ごとの追加クラス (ナビバーの AI Spotlight リングなど) */
  rowClass?: (accountId: string) => unknown
  /** 'detail' なら一覧の代わりに #detail を出す (2 段選択の 2 段目) */
  stage?: 'accounts' | 'detail'
}>()

const emit = defineEmits<{
  select: [accountId: string]
  close: []
}>()

const { visible, leaving } = useVaporTransition(toRef(props, 'show'), {
  enterDuration: 200,
  leaveDuration: 200,
})

const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => visible.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 200,
  },
)

useBackButton(
  computed(() => props.show),
  () => emit('close'),
)
</script>

<template>
  <dialog
    v-if="visible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, leaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <!-- シート内のクリックは外に漏らさない (ナビバーの document click ハンドラ
         のような「外側クリックで閉じる」処理に拾われないように) -->
    <div
      autofocus
      tabindex="-1"
      :class="[$style.sheet, leaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
      @click.stop
    >
      <div v-if="title || description" :class="$style.header">
        <div v-if="title" :class="$style.title">{{ title }}</div>
        <div v-if="description" :class="$style.description">{{ description }}</div>
      </div>

      <slot v-if="stage === 'detail'" name="detail" />
      <template v-else>
        <AccountPickerRow
          v-for="account in accounts"
          :key="account.id"
          :class="rowClass?.(account.id)"
          :label="getAccountLabel(account)"
          :active="activeId === account.id"
          :has-next="hasNext"
          @click="emit('select', account.id)"
        >
          <template #avatar>
            <slot name="avatar" :account="account">
              <AccountAvatar
                :src="getAccountAvatarUrl(account)"
                :host="account.host"
                :size="32"
                show-server
                badge-background="var(--nd-navBg)"
              />
            </slot>
          </template>
        </AccountPickerRow>
        <slot name="footer" />
      </template>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.sheet {
  width: 100%;
  margin: 0;
  padding: 8px 0 calc(8px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));
  border-radius: 16px 16px 0 0;
  background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
  max-height: 80vh;
  overflow-y: auto;
  overscroll-behavior: contain;

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.header {
  padding: 6px 16px 8px;
}

.title {
  font-size: 0.9em;
  font-weight: bold;
  color: var(--nd-fg);
}

.description {
  margin-top: 2px;
  font-size: 0.78em;
  color: var(--nd-fg);
  opacity: 0.7;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
