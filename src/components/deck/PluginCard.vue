<script setup lang="ts">
import { computed } from 'vue'

type Mode = 'installed' | 'store'

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
  confirmingUninstall?: boolean
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
  (e: 'settings'): void
  (e: 'open-detail'): void
  (e: 'denied-click'): void
}>()

const disabled = computed(
  () => props.mode === 'installed' && props.active === false,
)
</script>

<template>
  <div
    :class="[$style.card, disabled && $style.cardDisabled]"
    @click="emit('click')"
  >
    <div :class="$style.accentBar" />
    <div :class="$style.icon">
      <span
        v-if="iconUrl"
        :class="$style.iconImg"
        :style="{ '--icon-url': `url('${iconUrl}')` }"
        aria-hidden="true"
      />
      <i v-else class="ti ti-puzzle" />
    </div>
    <div :class="$style.body">
      <div :class="$style.row1">
        <span :class="$style.name">{{ name }}</span>
        <span v-if="disabled" :class="$style.disabledBadge">無効</span>
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
              :title="confirmingUninstall ? 'もう一度クリックで削除' : 'アンインストール'"
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
              v-if="alreadyInstalled"
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
              :disabled="installing"
              @click.stop="emit('install')"
            >
              <i v-if="installing" class="ti ti-loader-2 nd-spin" />
              <i v-else class="ti ti-download" />
              {{ installing ? '...' : 'インストール' }}
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
  transition: background 0.1s;

  &:hover {
    background: var(--nd-buttonHoverBg);

    .accentBar {
      opacity: 1;
    }
  }

  & + & {
    border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
  }
}

.cardDisabled {
  opacity: 0.6;
}

.accentBar {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 2px;
  background: var(--nd-accent);
  border-radius: 0 2px 2px 0;
  opacity: 0;
  transition: opacity 0.1s;
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

.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
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
  transition: opacity 0.15s;

  .card:hover & {
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
    background 0.1s,
    color 0.1s,
    opacity 0.1s;

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
    filter 0.1s,
    opacity 0.1s;

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
