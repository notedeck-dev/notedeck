<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '@/i18n'
import type { SkillMode } from '@/stores/skills'
import { formatDate } from '@/utils/format'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'

/**
 * スキルのカード。他の配布物カード (PluginCard 等) と同型の 2 モード。
 * - `installed`: 導入済み。有効 / 無効、HEARTBEAT 対象、削除、編集
 * - `store`: MisStore 配布物。インストール / 更新 / 詳細
 * 予約 skill は配布物ではないのでここには来ない (AI 設定が入口)
 */
type Mode = 'installed' | 'store'

const props = withDefaults(
  defineProps<{
    mode: Mode
    name: string
    description?: string
    author?: string
    version: string
    iconUrl?: string
    /** installed: 実行モード */
    skillMode?: SkillMode
    /** installed: 実効の有効 (mode=always は印が無くても有効) */
    active?: boolean
    /** installed: 編集の入口を出す (開発者モード #1034) */
    canEdit?: boolean
    /** store: カテゴリ表示 */
    categoryLabel?: string
    installing?: boolean
    alreadyInstalled?: boolean
    hasUpdate?: boolean
    updatedAt?: string
  }>(),
  { active: false, canEdit: false },
)

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'toggle'): void
  (e: 'heartbeat'): void
  (e: 'delete'): void
  (e: 'install'): void
  (e: 'update'): void
  (e: 'open-detail'): void
}>()

const modeLabel = computed(() => {
  switch (props.skillMode) {
    case 'always':
      return i18n.ts._deckSkillColumn.modeAlways
    case 'manual':
      return i18n.ts._deckSkillColumn.modeManual
    case 'trigger':
      return i18n.ts._deckSkillColumn.modeTrigger
    case 'heartbeat':
      return 'HEARTBEAT'
    default:
      return ''
  }
})

const toggleable = computed(() => props.skillMode !== 'always')
const toggleTitle = computed(() => {
  if (!toggleable.value) return i18n.ts._deckSkillColumn.alwaysActive
  return props.active
    ? i18n.ts._deckSkillColumn.deactivate
    : i18n.ts._deckSkillColumn.activate
})

/** 更新の主表示は updatedAt、version は補助 (#1040) */
const updateTitle = computed(() =>
  props.updatedAt
    ? i18n.tsx._common.storeUpdatedWithVersion({
        date: formatDate(props.updatedAt),
        version: props.version,
      })
    : undefined,
)
</script>

<template>
  <div
    :class="[
      $style.card,
      mode === 'installed' && !active && $style.cardDisabled,
      mode === 'installed' && !canEdit && $style.cardStatic,
    ]"
    @click="mode === 'installed' && canEdit && emit('edit')"
  >
    <div :class="$style.icon">
      <span
        v-if="isProxiable(iconUrl)"
        :class="$style.iconImg"
        :style="{ '--icon-url': proxyCssUrl(iconUrl, 48) }"
        aria-hidden="true"
      />
      <i v-else class="ti ti-sparkles" />
    </div>
    <div :class="$style.body">
      <div :class="$style.row1">
        <button
          v-if="mode === 'installed' && canEdit"
          type="button"
          :class="$style.name"
          @click.stop="emit('edit')"
        >{{ name }}</button>
        <span
          v-else
          :class="[$style.name, mode === 'installed' && !canEdit && $style.cardStatic]"
        >{{ name }}</span>
        <template v-if="mode === 'installed'">
          <span :class="$style.modeBadge" :data-mode="skillMode">
            <i v-if="skillMode === 'heartbeat'" class="ti ti-activity-heartbeat" />
            {{ modeLabel }}
          </span>
          <span v-if="!active" :class="$style.disabledBadge">{{ i18n.ts._common.disabled }}</span>
        </template>
        <template v-else>
          <span
            v-if="alreadyInstalled && hasUpdate"
            :class="$style.updateBadge"
            :title="updateTitle"
          >{{ i18n.ts._common.updateAvailable }}</span>
          <i
            v-else-if="alreadyInstalled"
            class="ti ti-circle-check"
            :class="$style.installedMark"
            :title="i18n.ts._deckSkillColumn.installedMark"
          />
        </template>
        <span :class="$style.spacer" />
        <span :class="$style.version">v{{ version }}</span>
      </div>
      <div :class="$style.row2">
        {{ description || 'No description' }}
      </div>
      <div :class="$style.row3">
        <span v-if="author" :class="$style.author">{{ author }}</span>
        <span v-if="mode === 'store' && categoryLabel" :class="$style.category">{{ categoryLabel }}</span>
        <span :class="$style.spacer" />
        <div :class="$style.actions">
          <template v-if="mode === 'installed'">
            <button
              class="_button"
              :class="[$style.iconBtn, skillMode === 'heartbeat' && $style.heartbeatActive]"
              :title="skillMode === 'heartbeat' ? i18n.ts._deckSkillColumn.removeFromHeartbeat : i18n.ts._deckSkillColumn.addToHeartbeat"
              @click.stop="emit('heartbeat')"
            >
              <i class="ti ti-activity-heartbeat" />
            </button>
            <button
              class="_button"
              :class="[$style.iconBtn, $style.iconBtnDanger]"
              :title="i18n.ts._deckSkillColumn.deleteFromLibrary"
              @click.stop="emit('delete')"
            >
              <i class="ti ti-trash" />
            </button>
            <button
              v-if="canEdit"
              class="_button"
              :class="$style.iconBtn"
              :title="i18n.ts._common.edit"
              @click.stop="emit('edit')"
            >
              <i class="ti ti-edit" />
            </button>
            <button
              class="_button"
              :class="[
                $style.primaryBtn,
                active ? $style.secondaryBtn : '',
                !toggleable && $style.btnLocked,
              ]"
              :disabled="!toggleable"
              :title="toggleTitle"
              @click.stop="emit('toggle')"
            >
              {{ active ? i18n.ts._common.disable : i18n.ts._common.enable }}
            </button>
          </template>
          <template v-else>
            <button
              class="_button"
              :class="$style.iconBtn"
              :title="i18n.ts._common.openInMisStore"
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
              {{ i18n.ts._common.update }}
            </button>
            <button
              v-else-if="alreadyInstalled"
              class="_button"
              :class="$style.installedBadge"
              disabled
            >
              {{ i18n.ts._common.installed }}
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
              {{ installing ? '...' : i18n.ts._common.install }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
@use '@/styles/buttons' as *;

.card {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 12px 14px 12px 16px;
  cursor: pointer;
  transition: background var(--nd-duration-fast);

  // ホバーの signal は背景ティント 1 つ (PluginCard と同型)
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

// 開発者モード off ではカードも名前も編集を開かないので、押せる見た目にしない
.cardStatic {
  cursor: default;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  color: var(--nd-accentText);
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
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: 2px;
    border-radius: var(--nd-radius-xs);
  }
}

.modeBadge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  font-size: 9px;
  padding: 0 6px;
  line-height: 14px;
  height: 14px;
  border-radius: var(--nd-radius-xs);
  background: color-mix(in srgb, var(--nd-fg) 12%, transparent);
  color: var(--nd-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;

  i {
    font-size: 10px;
  }

  &[data-mode='always'],
  &[data-mode='heartbeat'] {
    background: color-mix(in srgb, var(--nd-accent) 22%, transparent);
    color: var(--nd-accentText);
    opacity: 1;
  }
}

.disabledBadge {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 9px;
  font-weight: var(--nd-weight-bold);
  line-height: 14px;
  height: 14px;
  border-radius: var(--nd-radius-xs);
  background: color-mix(in srgb, var(--nd-fg) 15%, transparent);
  color: var(--nd-fg);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}

.installedMark {
  flex-shrink: 0;
  color: var(--nd-accentText);
  font-size: 14px;
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
  border-radius: var(--nd-radius-md);
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
  transition: opacity var(--nd-duration-base);

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
  border-radius: var(--nd-radius-xs);
  color: var(--nd-fg);
  font-size: 13px;
  opacity: 0.7;
  transition: background var(--nd-duration-fast), opacity var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

// 本体削除 (ti-trash) 用。他の配布物カードと同じ hover で朱に寄る表現 (#1048)
.iconBtnDanger {
  &:hover {
    color: var(--nd-love);
    background: color-mix(in srgb, var(--nd-love) 14%, transparent);
  }
}

// HEARTBEAT 対象のときは常時 accent で見せる (hover で消える .actions を打ち消す)
.heartbeatActive {
  color: var(--nd-accentText);
  opacity: 1 !important;
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
}

.primaryBtn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  height: 22px;
  font-size: 11px;
  font-weight: var(--nd-weight-bold);
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  transition: filter var(--nd-duration-fast), opacity var(--nd-duration-fast);

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  &:disabled {
    opacity: 0.5;
  }
}

.secondaryBtn {
  @include nd-interactive;
  background: transparent;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);

  &:hover:not(:disabled) {
    filter: none;
    background: var(--nd-buttonHoverBg);
  }
}

.btnLocked {
  opacity: 0.5;
  cursor: default;
}

.installedBadge {
  flex-shrink: 0;
  padding: 2px 8px;
  height: 22px;
  display: flex;
  align-items: center;
  font-size: 10px;
  border-radius: var(--nd-radius-xs);
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: default;
}

/* 更新ありバッジ (#1040)。他ストアカードの originBadge と同型の accent チップ */
.updateBadge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--nd-radius-md);
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accentText);
  line-height: 1.3;
}
</style>
