<script setup lang="ts">
import { computed } from 'vue'
import ThemePreview from '@/components/ThemePreview.vue'
import type { MisskeyTheme } from '@/theme/types'

type Mode = 'installed' | 'store'
type Source = 'builtin' | 'local' | 'misstore' | 'server'

const props = defineProps<{
  mode: Mode
  theme: MisskeyTheme
  source: Source
  // 状態
  installing?: boolean
  alreadyInstalled?: boolean
  isAppliedAccount?: boolean
  isAppliedGlobal?: boolean
  // per-account / cross-account モード
  perAccount?: boolean
  // 削除可能か (builtin は不可)
  removable?: boolean
}>()

const emit = defineEmits<{
  (e: 'apply-account'): void
  (e: 'apply-global'): void
  (e: 'clear-account'): void
  (e: 'edit'): void
  (e: 'remove'): void
  (e: 'install'): void
  (e: 'open-detail'): void
}>()

const isApplied = computed(
  () => props.isAppliedAccount || props.isAppliedGlobal,
)

function handleClick() {
  if (props.mode === 'store') {
    if (!props.alreadyInstalled && !props.installing) emit('install')
    return
  }
  // installed mode
  if (props.perAccount) {
    if (!props.isAppliedAccount) emit('apply-account')
  } else {
    if (!props.isAppliedGlobal) emit('apply-global')
  }
}
</script>

<template>
  <button
    type="button"
    :class="[
      $style.item,
      isAppliedAccount && $style.appliedAccount,
      isAppliedGlobal && !isAppliedAccount && $style.appliedGlobal,
    ]"
    @click="handleClick"
  >
    <div :class="$style.previewWrap">
      <ThemePreview :theme="theme" :class="$style.preview" />

      <!-- Hover actions -->
      <!-- サーバー由来テーマは read-only (NoteDeck から削除/編集/解除すると
           Misskey 側の registry や meta を改変してしまうため hide)。
           ストアタブのカードは外部リンクボタンのみ表示。 -->
      <div
        v-if="mode === 'installed' && source !== 'server'"
        :class="$style.previewActions"
      >
        <button
          v-if="perAccount && isAppliedAccount"
          class="_button"
          :class="$style.clearBtn"
          title="このアカウントの設定を解除"
          @click.stop="emit('clear-account')"
        >
          <i class="ti ti-user-x" />
        </button>
        <button
          v-if="source === 'local'"
          class="_button"
          :class="$style.editBtn"
          title="編集"
          @click.stop="emit('edit')"
        >
          <i class="ti ti-pencil" />
        </button>
        <button
          v-if="removable"
          class="_button"
          :class="$style.removeBtn"
          title="削除"
          @click.stop="emit('remove')"
        >
          <i class="ti ti-x" />
        </button>
      </div>
      <div v-else-if="mode === 'store'" :class="$style.previewActions">
        <button
          class="_button"
          :class="$style.detailBtn"
          title="MisStore で詳細を見る"
          @click.stop="emit('open-detail')"
        >
          <i class="ti ti-external-link" />
        </button>
      </div>

      <!-- 適用中 / インストール状態はカード自体の border 色で表現する。
           UI ノイズ低減のため左上バッジは表示しない。 -->
      <span
        v-if="mode === 'store' && installing"
        :class="$style.installingOverlay"
        title="インストール中"
      >
        <i class="ti ti-loader-2 nd-spin" />
      </span>
    </div>
    <div :class="$style.name" :title="theme.name">{{ theme.name }}</div>
  </button>
</template>

<style module lang="scss">
.item {
  display: flex;
  flex-direction: column;
  cursor: pointer;
  padding: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  border: 2px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
  min-width: 0;
  transition: border-color var(--nd-duration-base);

  &:hover,
  &:focus-within {
    border-color: color-mix(in srgb, var(--nd-accent) 50%, var(--nd-divider));
  }

  // overflow: hidden があるので外側リングは欠ける。内側に引く
  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: -2px;
  }
}

.appliedAccount {
  border-color: var(--nd-accent);
}

.appliedGlobal {
  border-color: var(--nd-success);
}

.previewWrap {
  position: relative;
  display: block;
  border-bottom: 1px solid var(--nd-divider);
}

.preview {
  display: block;
  width: 100%;
  height: auto;
}

.previewActions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
  z-index: 1;
  opacity: 0;
  transition: opacity var(--nd-duration-fast);

  .item:hover &,
  .item:focus-within & {
    opacity: 1;
  }

  @media (hover: none) {
    opacity: 1;
  }
}

.editBtn,
.removeBtn,
.clearBtn,
.detailBtn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: filter var(--nd-duration-base);

  &:hover {
    filter: brightness(0.85);
  }
}

.editBtn {
  background: var(--nd-accent);
}

.removeBtn {
  background: var(--nd-error);
}

.clearBtn {
  background: var(--nd-fg);
  color: var(--nd-bg);
  opacity: 0.7;
}

.detailBtn {
  background: var(--nd-fg);
  color: var(--nd-bg);
  opacity: 0.7;
}

.installingOverlay {
  position: absolute;
  top: 4px;
  left: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--nd-fg);
  color: var(--nd-bg);
  font-size: 10px;
  opacity: 0.7;
  z-index: 1;
}

.name {
  padding: 4px 6px;
  text-align: center;
  font-size: 0.75em;
  color: var(--nd-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
