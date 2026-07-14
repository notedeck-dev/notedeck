<script setup lang="ts">
import { computed } from 'vue'
import { type AppError, AUTH_ERROR_MESSAGE } from '@/utils/errors'
import { proxyUrl } from '@/utils/imageProxy'
import { restrictedAccessNotice } from '@/utils/restrictedAccess'
import SystemIcon from './SystemIcon.vue'

const props = withDefaults(
  defineProps<{
    /** メッセージテキスト。error 指定時は省略可（error から導出）。 */
    message?: string
    /** Misskey サーバーのカスタム画像 URL（infoImageUrl / notFoundImageUrl / serverErrorImageUrl） */
    imageUrl?: string
    /** エラー状態かどうか */
    isError?: boolean
    /**
     * imageUrl が解決できない場合に表示するフォールバック SVG 種別。
     * 未指定なら isError から自動判定（true → 'error', false → 'info'）。
     */
    fallbackKind?: 'info' | 'notFound' | 'error'
    /** CTA ボタンのラベル */
    ctaLabel?: string
    /** CTA ボタンのアイコン（Tabler icon クラス名、例: 'ti-pencil'） */
    ctaIcon?: string
    /**
     * API エラー。指定すると CREDENTIAL_REQUIRED / ACCESS_DENIED を
     * 「このサーバーは○○を公開していません」等の案内に出し分ける
     * （本家は匿名公開だが一部フォークが認証必須に絞っているエンドポイント向け）。
     * 該当しないエラーは message 同様そのまま表示する。
     */
    error?: AppError | null
    /** error の案内で使う対象名詞（例: '連合情報' / 'ユーザー情報'）。 */
    subject?: string
    /** ログイン済みか。未ログイン時のみ「公開していません」案内にする。 */
    hasToken?: boolean
    /** info 状態（CREDENTIAL_REQUIRED 未ログイン等）で使う画像。未指定なら imageUrl。 */
    infoImageUrl?: string
  }>(),
  {
    isError: false,
  },
)

const emit = defineEmits<{
  cta: []
}>()

/** 生の error.message を出さないフレンドリー文言。コードは括弧で残す */
function friendlyErrorMessage(err: AppError): string {
  if (err.isAuth) return AUTH_ERROR_MESSAGE
  if (err.isNetwork)
    return 'サーバーに接続できません。ネットワークを確認してください。'
  return `読み込みに失敗しました（${err.displayCode}）`
}

/** error 指定時、CREDENTIAL_REQUIRED 等を案内文に変換（該当しなければフレンドリー文言）。 */
const notice = computed(() => {
  if (!props.error) return null
  return (
    restrictedAccessNotice(
      props.error,
      props.subject ?? '情報',
      props.hasToken ?? false,
    ) ?? { message: friendlyErrorMessage(props.error), info: false }
  )
})

const effectiveMessage = computed(
  () => notice.value?.message ?? props.message ?? '',
)
const effectiveIsError = computed(() =>
  notice.value ? !notice.value.info : props.isError,
)

const resolvedImageUrl = computed(() =>
  proxyUrl(
    notice.value?.info
      ? (props.infoImageUrl ?? props.imageUrl)
      : props.imageUrl,
  ),
)

const resolvedFallbackType = computed<'info' | 'question' | 'error'>(() => {
  if (props.fallbackKind === 'notFound') return 'question'
  if (props.fallbackKind) return props.fallbackKind
  return effectiveIsError.value ? 'error' : 'info'
})
</script>

<template>
  <div :class="[$style.root, effectiveIsError && $style.error]">
    <img
      v-if="resolvedImageUrl"
      :src="resolvedImageUrl"
      :class="$style.image"
      alt=""
      loading="lazy"
      draggable="false"
    />
    <SystemIcon
      v-else
      :type="resolvedFallbackType"
      :class="$style.fallbackIcon"
    />
    <div :class="$style.message">{{ effectiveMessage }}</div>
    <button
      v-if="ctaLabel"
      :class="$style.cta"
      class="_button"
      @click="emit('cta')"
    >
      <i v-if="ctaIcon" :class="['ti', ctaIcon]" />
      {{ ctaLabel }}
    </button>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 2rem 1rem;
  flex: 1;
  min-height: 0;
  animation: empty-fade-in var(--nd-duration-slow) ease;
}

@keyframes empty-fade-in {
  from {
    opacity: 0;
    translate: 0 8px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}

.image {
  width: auto;
  height: auto;
  max-width: min(200px, 60%);
  max-height: 160px;
  object-fit: contain;
  opacity: 0.8;
  user-select: none;
  pointer-events: none;
}

.fallbackIcon {
  width: 64px;
  height: 64px;
  opacity: 0.85;
  user-select: none;
  pointer-events: none;
}

.message {
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 0.85em;
  text-align: center;
  line-height: 1.5;
  padding: 0 1rem;
}

.error {
  .message {
    color: var(--nd-love);
    opacity: 1;
  }
}

.cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--nd-radius-full);
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fgOnAccent);
  background: color-mix(in srgb, var(--nd-accent) 80%, transparent);
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
  }
}
</style>
