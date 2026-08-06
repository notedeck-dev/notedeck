<script setup lang="ts">
import { computed } from 'vue'
import { proxyCssUrl } from '@/utils/mediaProxy'

/**
 * カラムクエリのアイテムカード (#783)。
 * WidgetCard と同型の 2 モード (store / library) 構成で、他のストア配布
 * 管理カラム (プラグイン・ウィジェット・スキル・テーマ) と UI/UX を揃える。
 */

type Mode = 'store' | 'library'

const props = withDefaults(
  defineProps<{
    mode?: Mode
    name: string
    description?: string
    author?: string
    version?: string
    iconUrl?: string
    /** カテゴリ表示ラベル (Hide / Focus / Watch) */
    categoryLabel?: string
    /** store mode: インストール処理中 */
    installing?: boolean
    /** store mode: 既にプールにある */
    alreadyInstalled?: boolean
    /** library mode: storeId 有無で「ストア由来」/「ローカル保存」バッジ表示 */
    storeId?: string
    /**
     * library mode: クエリの実行形態 (#783)。
     * fast = QIR で高速評価 / degraded = 逐次適用 (🐢) / invalid = 保存されているが評価不能
     */
    execution?: 'fast' | 'degraded' | 'invalid'
    /** library mode: 適用中のカラム数 */
    refCount?: number
  }>(),
  {
    mode: 'store',
    execution: 'fast',
    refCount: 0,
  },
)

const emit = defineEmits<{
  // store
  (e: 'install'): void
  (e: 'open-detail'): void
  // library
  (e: 'edit'): void
  (e: 'delete'): void
}>()

const isStore = computed(() => props.mode === 'store')

function handlePrimaryClick() {
  if (isStore.value) {
    if (props.alreadyInstalled || props.installing) return
    emit('install')
  } else {
    emit('edit')
  }
}
</script>

<template>
  <div
    :class="$style.card"
    @click="handlePrimaryClick"
  >
    <div :class="$style.icon">
      <span
        v-if="iconUrl"
        :class="$style.iconImg"
        :style="{ '--icon-url': proxyCssUrl(iconUrl, 48) }"
        aria-hidden="true"
      />
      <i v-else class="ti ti-filter" />
    </div>
    <div :class="$style.body">
      <div :class="$style.row1">
        <button type="button" :class="$style.name" @click.stop="handlePrimaryClick">{{ name }}</button>
        <span
          v-if="!isStore && execution === 'degraded'"
          :class="$style.degradedBadge"
          title="1 件ずつ判定します。絞り込みは効きますが、キャッシュ検索には使えません"
        >逐次適用</span>
        <span
          v-else-if="!isStore && execution === 'invalid'"
          :class="$style.incompatBadge"
          title="解釈できないため適用中のカラムは新着を停止します (編集して修正してください)"
        >評価不能</span>
        <span :class="$style.spacer" />
        <span v-if="version" :class="$style.version">v{{ version }}</span>
      </div>
      <div v-if="description" :class="$style.row2">
        {{ description }}
      </div>
      <div :class="$style.row3">
        <span v-if="author" :class="$style.author">{{ author }}</span>
        <span v-if="categoryLabel" :class="$style.categoryBadge">{{ categoryLabel }}</span>
        <!-- library mode: ストア/ローカル + 適用数 バッジ -->
        <template v-if="!isStore">
          <span v-if="storeId" :class="$style.originBadge">ストア</span>
          <span v-else :class="[$style.originBadge, $style.originBadgeLocal]">ローカル</span>
          <span v-if="refCount > 0" :class="$style.originBadge">
            {{ refCount }} カラムで使用中
          </span>
        </template>
        <span :class="$style.spacer" />
        <div :class="$style.actions">
          <!-- store mode -->
          <template v-if="isStore">
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
              インストール
            </button>
          </template>
          <!-- library mode -->
          <template v-else>
            <button
              class="_button"
              :class="[$style.iconBtn, $style.iconBtnDanger]"
              title="削除"
              @click.stop="emit('delete')"
            >
              <i class="ti ti-trash" />
            </button>
            <button
              class="_button"
              :class="$style.primaryBtn"
              @click.stop="emit('edit')"
            >
              <i class="ti ti-pencil" />
              編集
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

  // ホバーの signal は背景ティント 1 つ (PluginCard と同型)
  &:hover,
  &:focus-within {
    background: var(--nd-buttonHoverBg);
  }

  & + & {
    border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
  }
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

// 行の主アクションはこの button が入口 (PluginCard と同型)
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
  flex-shrink: 0;
  min-width: 0;
}

.categoryBadge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, currentcolor 10%, transparent);
  opacity: 0.8;
  flex-shrink: 0;
  line-height: 1.3;
}

.originBadge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  flex-shrink: 0;
  line-height: 1.3;
}

.originBadgeLocal {
  background: color-mix(in srgb, var(--nd-fg) 12%, transparent);
  color: var(--nd-fg);
  opacity: 0.85;
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

/* 逐次適用 (#783 Phase 2)。効いてはいるので警告色にとどめる */
.degradedBadge {
  composes: incompatBadge;
  background: color-mix(in srgb, var(--nd-warn) 15%, transparent);
  color: var(--nd-warn);
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
  &:hover {
    color: var(--nd-love);
    background: color-mix(in srgb, var(--nd-love) 14%, transparent);
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
