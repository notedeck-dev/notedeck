<script setup lang="ts">
/**
 * 編集ウィンドウ下部の共通アクションバー。
 *
 * テーマ / ウィジット / プラグイン / カラムクエリ / スキルの編集ウィンドウは
 * それぞれ別の footer を持っていて、主アクションの位置 (テーマは上、
 * プラグインは下)、ボタンのスタイル (カラムクエリだけ独自)、自動保存系に
 * バーが無い、と揃っていなかった。並びと見た目をここ 1 箇所に固定する。
 *
 * 並びは常に `[補助アクション …] [保存状態] ―― [主アクション]`。
 * 主アクションは常に末尾 (右端 / 折返し時は最下段) に来る。
 */

export interface EditorAction {
  key: string
  /** 省略するとアイコンのみのボタンになる (title 必須) */
  label?: string
  /** Tabler アイコン名 (`ti-` は除いた部分) */
  icon?: string
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  title?: string
}

/** 自動保存ウィンドウの状態表示。明示保存のウィンドウでは使わない */
export interface EditorActionStatus {
  text: string
  icon?: string
  /** ok = 保存完了 (accent) / pending = 保存待ち (既定色) */
  tone?: 'ok' | 'pending'
}

withDefaults(
  defineProps<{
    actions?: readonly EditorAction[]
    primary?: EditorAction | null
    status?: EditorActionStatus | null
  }>(),
  {
    actions: () => [],
    primary: null,
    status: null,
  },
)

const emit = defineEmits<(e: 'action', key: string) => void>()
</script>

<template>
  <div :class="$style.bar">
    <button
      v-for="a in actions"
      :key="a.key"
      type="button"
      class="_button"
      :class="[
        $style.btn,
        a.variant === 'danger' ? $style.danger : $style.secondary,
        !a.label && $style.iconOnly,
      ]"
      :disabled="a.disabled"
      :title="a.title"
      @click="emit('action', a.key)"
    >
      <i v-if="a.icon" :class="`ti ti-${a.icon}`" />
      <span v-if="a.label">{{ a.label }}</span>
    </button>

    <div
      v-if="status"
      :class="[$style.status, status.tone === 'ok' && $style.statusOk]"
    >
      <i v-if="status.icon" :class="`ti ti-${status.icon}`" />
      <span>{{ status.text }}</span>
    </div>

    <span :class="$style.spacer" />

    <button
      v-if="primary"
      type="button"
      class="_button"
      :class="[
        $style.btn,
        primary.variant === 'danger' ? $style.danger : $style.primary,
      ]"
      :disabled="primary.disabled"
      :title="primary.title"
      @click="emit('action', primary.key)"
    >
      <i v-if="primary.icon" :class="`ti ti-${primary.icon}`" />
      <span v-if="primary.label">{{ primary.label }}</span>
    </button>
  </div>
</template>

<style module lang="scss">
@use '@/styles/buttons' as *;

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border-top: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

/* 折返しが起きるまでは主アクションを右端に押し出す */
.spacer {
  flex: 1 1 0;
  min-width: 0;
}

.btn {
  @include btn-base;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// 配色は `.btn` と複合させて特異度 (0,2,0) にする。
// 単一クラスだと WebView2 で global の `._button` (0,1,0) と衝突順が読めない
.btn.secondary {
  background: var(--nd-buttonBg);
  color: var(--nd-fg);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
  }
}

.btn.primary {
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);

  &:hover:not(:disabled) {
    background: var(--nd-accentDarken);
  }
}

.btn.danger {
  background: var(--nd-love);
  color: #fff;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--nd-love) 80%, black);
  }
}

.btn.iconOnly {
  padding: 8px;
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
  min-width: 0;
}

.statusOk {
  color: var(--nd-accent);
  opacity: 1;
}
</style>
