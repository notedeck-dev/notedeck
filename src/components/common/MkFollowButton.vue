<script setup lang="ts">
import { computed, ref } from 'vue'
import { useConfirm } from '@/stores/confirm'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import {
  executeFollowAction,
  type FollowApi,
  type FollowState,
} from '@/utils/followAction'

/**
 * 正準フォローボタン (#752)。hover での解除表示・解除/取消の確認ダイアログ・
 * 鍵アカウントの承認待ち遷移までを内包する。状態は props で受け、成功時の
 * 遷移後状態を update で返す (反映は呼び出し側)。
 * UserProfileHero / FollowListContent / MkUserPopup で共用。
 */
const props = withDefaults(
  defineProps<{
    userId: string
    /** 確認ダイアログの表示用 */
    username: string
    isFollowing: boolean
    hasPendingRequest?: boolean
    /** 相互フォローのラベル表示用 */
    isFollowed?: boolean
    /** 鍵アカウントか。undefined = 不明 (resolvePending で確定する) */
    isLocked?: boolean
    api: FollowApi | null
    /** isLocked 不明時、follow 後に承認待ちか確定する (getUserRelations 等) */
    resolvePending?: (() => Promise<boolean>) | null
    disabled?: boolean
    /** md = プロフィールヒーロー、sm = 一覧行・ポップアップ */
    size?: 'sm' | 'md'
  }>(),
  {
    hasPendingRequest: false,
    isFollowed: false,
    isLocked: undefined,
    resolvePending: null,
    disabled: false,
    size: 'sm',
  },
)

const emit = defineEmits<{
  update: [state: FollowState]
}>()

const hover = ref(false)
const loading = ref(false)
const { confirm } = useConfirm()
const toast = useToast()

const label = computed(() => {
  if (props.hasPendingRequest) {
    return hover.value ? 'リクエスト取消' : 'フォロー許可待ち'
  }
  if (props.isFollowing) {
    if (hover.value) return 'フォロー解除'
    return props.isFollowed ? '相互フォロー' : 'フォロー中'
  }
  return 'フォロー'
})

async function onClick() {
  if (!props.api || loading.value) return
  // フォロー解除だけは誤タップに備えて確認を挟む (リクエスト取消は再申請可能)
  if (props.isFollowing && !props.hasPendingRequest) {
    const ok = await confirm({
      title: 'フォロー解除',
      message: `@${props.username} のフォローを解除しますか？`,
      okLabel: '解除',
      type: 'danger',
    })
    if (!ok) return
  }
  loading.value = true
  try {
    const next = await executeFollowAction(
      props.api,
      props.userId,
      {
        isFollowing: props.isFollowing,
        hasPendingFollowRequestFromYou: props.hasPendingRequest,
      },
      {
        isLocked: props.isLocked,
        resolvePending: props.resolvePending ?? undefined,
      },
    )
    emit('update', next)
  } catch (e) {
    const err = AppError.from(e)
    console.error('[follow:toggle]', err.code, err.message)
    toast.show(`操作に失敗しました（${err.displayCode}）`, 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <button
    class="_button"
    :class="[
      $style.followBtn,
      $style[size],
      { [$style.following]: isFollowing || hasPendingRequest },
    ]"
    :disabled="disabled || loading || !api"
    @click.stop="onClick"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <i v-if="loading" class="ti ti-loader-2 nd-spin" />
    <template v-else>{{ label }}</template>
  </button>
</template>

<style lang="scss" module>
.followBtn {
  border-radius: 32px;
  font-weight: bold;
  color: #fff;
  background: var(--nd-accent);
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
  }

  /* フォロー済み・許可待ちは塗りを外して未フォロー (accent 塗り) と区別。
     hover でラベルが「フォロー解除」に変わるのに合わせ danger 色に寄せる */
  &.following {
    background: var(--nd-buttonBg);
    color: var(--nd-fg);

    &:hover {
      background: color-mix(in srgb, var(--nd-love) 20%, var(--nd-buttonBg));
      color: var(--nd-love);
      opacity: 1;
    }
  }
}

.md {
  height: 31px;
  padding: 0 12px;
  font-size: 14px;
}

.sm {
  padding: 5px 12px;
  font-size: 0.75em;
}
</style>
