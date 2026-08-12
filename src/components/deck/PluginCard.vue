<script setup lang="ts">
import { computed } from 'vue'
import { formatDate } from '@/utils/format'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'

type Mode = 'installed' | 'store' | 'library'

const props = defineProps<{
  mode: Mode
  name: string
  description?: string
  author?: string
  version: string
  category?: string
  categoryLabel?: string
  active?: boolean
  installing?: boolean
  alreadyInstalled?: boolean
  /** store mode: インストール済みかつストア側が更新されている (#1040) */
  hasUpdate?: boolean
  /** store mode: レジストリの updatedAt (更新バッジの tooltip 用) */
  updatedAt?: string
  /** store mode: MisStore 宣言の capabilities (バッジ表示用) */
  capabilities?: readonly string[]
  capabilityOk?: boolean
  /** 非互換理由の短いラベル (要アップデート 等) */
  capabilityBadge?: string | null
  capabilityReason?: string | null
  confirmingUninstall?: boolean
  /** installed mode: trash ボタンの title (スコープ文脈で言い換える) */
  uninstallTitle?: string
  iconUrl?: string
  /**
   * 権限拒否バッジ (#712 §8.4)。plugin principal の permission_denied が
   * 記録されているとき表示し、クリックで権限編集 UI へ誘導する。
   */
  deniedBadge?: { lastTarget: string; lastKeys: string[]; count: number } | null
}>()

const emit = defineEmits<{
  (e: 'click'): void
  (e: 'toggle'): void
  (e: 'uninstall'): void
  (e: 'install'): void
  (e: 'update'): void
  (e: 'settings'): void
  (e: 'open-detail'): void
  (e: 'denied-click'): void
  (e: 'place'): void
  (e: 'delete'): void
}>()

const incompatible = computed(
  () => props.mode === 'store' && props.capabilityOk === false,
)
const disabled = computed(
  () =>
    (props.mode === 'installed' && props.active === false) ||
    incompatible.value,
)
// 非互換時のみ tooltip で理由 + 必要 capability を開示する
const incompatTitle = computed(() => {
  if (!incompatible.value) return ''
  const caps = props.capabilities?.length
    ? `Requires: ${props.capabilities.join(', ')}`
    : ''
  return [props.capabilityReason ?? '', caps].filter(Boolean).join('\n')
})
// 更新の主表示は updatedAt、version は補助 (#1040)
const updateTitle = computed(() => {
  if (!props.updatedAt) return ''
  const date = formatDate(props.updatedAt)
  return props.version
    ? `ストア更新日: ${date} / v${props.version}`
    : `ストア更新日: ${date}`
})
</script>

<template>
  <div
    :class="[$style.card, disabled && $style.cardDisabled]"
    :title="incompatTitle"
    @click="emit('click')"
  >
    <div :class="$style.icon">
      <span
        v-if="isProxiable(iconUrl)"
        :class="$style.iconImg"
        :style="{ '--icon-url': proxyCssUrl(iconUrl, 48) }"
        aria-hidden="true"
      />
      <i v-else class="ti ti-puzzle" />
    </div>
    <div :class="$style.body">
      <div :class="$style.row1">
        <button type="button" :class="$style.name" @click.stop="emit('click')">{{ name }}</button>
        <span v-if="incompatible" :class="$style.incompatBadge">{{ capabilityBadge ?? '非対応' }}</span>
        <span v-else-if="disabled" :class="$style.disabledBadge">無効</span>
        <span
          v-if="mode === 'store' && alreadyInstalled && hasUpdate"
          :class="$style.updateBadge"
          :title="updateTitle"
        >更新あり</span>
        <button
          v-if="deniedBadge"
          class="_button"
          :class="$style.deniedBadge"
          :title="`権限がないため拒否されました: ${deniedBadge.lastTarget} (要求: ${deniedBadge.lastKeys.join(', ')} / ${deniedBadge.count} 回)。クリックでプラグイン権限を開く`"
          @click.stop="emit('denied-click')"
        >
          <i class="ti ti-shield-x" />
        </button>
        <span :class="$style.spacer" />
        <span :class="$style.version">v{{ version }}</span>
      </div>
      <div :class="$style.row2">
        {{ description || 'No description' }}
      </div>
      <div :class="$style.row3">
        <span v-if="author" :class="$style.author">{{ author }}</span>
        <span v-if="category" :class="$style.category">
          {{ categoryLabel || category }}
        </span>
        <span :class="$style.spacer" />
        <div :class="$style.actions">
          <!-- Installed mode -->
          <template v-if="mode === 'installed'">
            <button
              class="_button"
              :class="[$style.iconBtn, confirmingUninstall && $style.iconBtnDanger]"
              :title="confirmingUninstall ? 'もう一度クリックで実行' : (uninstallTitle ?? 'アンインストール')"
              @click.stop="emit('uninstall')"
            >
              <i class="ti ti-trash" />
            </button>
            <button
              class="_button"
              :class="$style.iconBtn"
              title="設定"
              @click.stop="emit('settings')"
            >
              <i class="ti ti-settings" />
            </button>
            <button
              class="_button"
              :class="[$style.primaryBtn, active ? $style.secondaryBtn : '']"
              @click.stop="emit('toggle')"
            >
              {{ active ? '無効にする' : '有効にする' }}
            </button>
          </template>

          <!-- Library mode: スコープ未参加のライブラリ本体 (place / 本体削除) -->
          <template v-else-if="mode === 'library'">
            <button
              class="_button"
              :class="$style.iconBtn"
              title="ライブラリから削除 (コードも消える)"
              @click.stop="emit('delete')"
            >
              <i class="ti ti-trash" />
            </button>
            <button
              class="_button"
              :class="$style.primaryBtn"
              @click.stop="emit('place')"
            >
              <i class="ti ti-plus" />
              追加
            </button>
          </template>

          <!-- Store mode -->
          <template v-else>
            <button
              class="_button"
              :class="$style.iconBtn"
              title="MisStore で詳細を開く"
              @click.stop="emit('open-detail')"
            >
              <i class="ti ti-external-link" />
            </button>
            <button
              v-if="alreadyInstalled && hasUpdate"
              class="_button"
              :class="$style.primaryBtn"
              :disabled="installing"
              :title="updateTitle"
              @click.stop="emit('update')"
            >
              <i v-if="installing" class="ti ti-loader-2 nd-spin" />
              <i v-else class="ti ti-refresh" />
              更新
            </button>
            <button
              v-else-if="alreadyInstalled"
              class="_button"
              :class="$style.installedBadge"
              disabled
            >
              インストール済み
            </button>
            <button
              v-else
              class="_button"
              :class="$style.primaryBtn"
              :disabled="installing || capabilityOk === false"
              @click.stop="emit('install')"
            >
              <i v-if="installing" class="ti ti-loader-2 nd-spin" />
              <i v-else class="ti ti-download" />
              インストール
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.card {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 12px 14px 12px 16px;
  cursor: pointer;
  transition: background var(--nd-duration-fast);

  // ホバーの signal は背景ティント 1 つ。以前は 2px の左アクセントバーと
  // 同時発火していたが、同じ意味を 2 つの手段で伝えていた
  &:hover,
  &:focus-within {
    background: var(--nd-buttonHoverBg);
  }

  & + & {
    border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
  }
}

.cardDisabled {
  opacity: 0.6;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  color: var(--nd-accent);
  font-size: 32px;
}

.iconImg {
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row1 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

// 行の主アクションはこの button が入口。カード自体を role="button" にすると
// 中のアクションボタンが子孫として presentational 扱いになり、支援技術から
// 個別のアクションとして読めなくなる
.name {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: 2px;
    border-radius: 3px;
  }
}

.disabledBadge {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  height: 14px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--nd-fg) 15%, transparent);
  color: var(--nd-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}

// 権限拒否バッジ (#712): 朱色系で「権限で止まっている」ことを受動表示
.deniedBadge {
  display: inline-flex;
  align-items: center;
  padding: 0 4px;
  color: #e0475b;
  font-size: 0.9em;
  cursor: pointer;

  &:hover {
    opacity: 0.8;
  }
}

.version {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.45;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.row2 {
  font-size: 12px;
  color: var(--nd-fg);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
  margin-top: 1px;
}

.row3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  min-width: 0;
  min-height: 20px;
}

.author {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.55;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
}

.category {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-fg) 8%, transparent);
  color: var(--nd-fg);
  opacity: 0.6;
  flex-shrink: 0;
  line-height: 1.3;
}

.incompatBadge {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  height: 14px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--nd-love) 15%, transparent);
  color: var(--nd-love);
  letter-spacing: 0.02em;
}

/* 更新ありバッジ (#1040)。他カードの originBadge と同型の accent チップ */
.updateBadge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  line-height: 1.3;
}

.spacer {
  flex: 1;
  min-width: 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--nd-duration-base);

  // focus-within を外すとキーボードでは「見えないボタン」に Tab することになる
  .card:hover &,
  .card:focus-within & {
    opacity: 1;
  }

  @media (hover: none) {
    opacity: 1;
  }
}

.iconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 3px;
  color: var(--nd-fg);
  font-size: 13px;
  opacity: 0.7;
  transition:
    background var(--nd-duration-fast),
    color var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.iconBtnDanger {
  opacity: 1;
  color: var(--nd-love);
  background: color-mix(in srgb, var(--nd-love) 14%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--nd-love) 22%, transparent);
  }
}

.primaryBtn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  height: 22px;
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  transition:
    filter var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.secondaryBtn {
  background: transparent;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);

  &:hover:not(:disabled) {
    filter: none;
    background: var(--nd-buttonHoverBg);
  }
}

.installedBadge {
  flex-shrink: 0;
  padding: 2px 8px;
  height: 22px;
  display: flex;
  align-items: center;
  font-size: 10px;
  border-radius: 2px;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);
  opacity: 0.5;
  cursor: default;
}
</style>
