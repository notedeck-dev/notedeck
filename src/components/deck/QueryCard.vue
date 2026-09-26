<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '@/i18n'
import { readOnlyHint } from '@/services/sidecarFileCollection'
import { formatDate } from '@/utils/format'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'
import { isWindowExposed } from '@/windows/exposure'

/**
 * カラムクエリのアイテムカード (#783)。
 * PluginCard と同型の 3 モード構成で、他のストア配布管理カラム
 * (プラグイン・ウィジェット・スキル・テーマ) と UI/UX を揃える。
 *
 * - `installed`: カラムのスコープに参加中 (#1018)。外す / 削除 / 編集
 * - `library`: スコープ未参加のライブラリ本体。追加 / 削除
 * - `store`: MisStore 配布物
 */

type Mode = 'store' | 'library' | 'installed'

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
    /** store mode: インストール済みかつストア側が更新されている (#1040) */
    hasUpdate?: boolean
    /** store mode: レジストリの updatedAt (更新バッジの tooltip 用) */
    updatedAt?: string
    /** library mode: storeId 有無で「ストア由来」/「ローカル保存」バッジ表示 */
    storeId?: string
    /**
     * library mode: クエリの実行形態 (#783)。
     * fast = QIR で高速評価 / degraded = 逐次適用 (🐢) / invalid = 保存されているが評価不能
     */
    execution?: 'fast' | 'degraded' | 'invalid'
    /** library mode: 適用中のカラム数 */
    refCount?: number
    /** installed mode: 「外す」ボタンの tooltip (#1018) */
    detachTitle?: string
    /** installed / library mode: 本体が無効 (#1043)。評価されず、適用先では効いていない */
    disabled?: boolean
    /** ソース欠損の読取専用個体。有効/無効の切替は保存できないので受け付けない (#1111) */
    readOnly?: boolean
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
  (e: 'update'): void
  (e: 'open-detail'): void
  // installed / library
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'detach'): void
  (e: 'place'): void
  (e: 'toggle'): void
}>()

const isStore = computed(() => props.mode === 'store')
const isDisabled = computed(() => !isStore.value && props.disabled === true)
const toggleTitle = computed(() =>
  props.readOnly ? i18n.ts._queryCard.readOnlyHint : '',
)

/** 編集はクエリを「作る」面なので開発者モードに従う (#1034)。導入・実行は一般側 */
const canEdit = computed(() => isWindowExposed('column-query-editor'))

// 更新の主表示は updatedAt、version は補助 (#1040)
const updateTitle = computed(() => {
  if (!props.updatedAt) return ''
  const date = formatDate(props.updatedAt)
  return props.version
    ? i18n.tsx._common.storeUpdatedWithVersion({
        date,
        version: props.version,
      })
    : i18n.tsx._common.storeUpdated({ date })
})

function handlePrimaryClick() {
  if (isStore.value) {
    if (props.alreadyInstalled || props.installing) return
    emit('install')
  } else if (props.mode === 'library') {
    // ピッカーのカードは「このカラムに追加」が主動作
    emit('place')
  } else if (canEdit.value) {
    emit('edit')
  }
}
</script>

<template>
  <div
    :class="[$style.card, isDisabled && $style.cardDisabled]"
    @click="handlePrimaryClick"
  >
    <div :class="$style.icon">
      <span
        v-if="isProxiable(iconUrl)"
        :class="$style.iconImg"
        :style="{ '--icon-url': proxyCssUrl(iconUrl, 48) }"
        aria-hidden="true"
      />
      <i v-else class="ti ti-filter" />
    </div>
    <div :class="$style.body">
      <div :class="$style.row1">
        <button
          v-if="isStore || canEdit"
          type="button"
          :class="$style.name"
          @click.stop="handlePrimaryClick"
        >{{ name }}</button>
        <span v-else :class="$style.name">{{ name }}</span>
        <!-- ソース欠損 (#913 / #1111): 評価不能の原因と復旧導線を先に見せる -->
        <span
          v-if="!isStore && readOnly"
          :class="$style.incompatBadge"
          :title="readOnlyHint()"
        >{{ i18n.ts._common.sourceMissing }}</span>
        <!-- 無効は実行形態より前に出す: 止まっているものの実行形態は二の次 (#1043) -->
        <span
          v-else-if="isDisabled"
          :class="$style.disabledBadge"
          :title="i18n.ts._queryCard.disabledHint"
        >{{ i18n.ts._common.disabled }}</span>
        <span
          v-else-if="!isStore && execution === 'degraded'"
          :class="$style.degradedBadge"
          :title="i18n.ts._queryCard.degradedHint"
        >{{ i18n.ts._queryCard.degraded }}</span>
        <span
          v-else-if="!isStore && execution === 'invalid'"
          :class="$style.incompatBadge"
          :title="i18n.ts._queryCard.invalidHint"
        >{{ i18n.ts._queryCard.invalid }}</span>
        <span
          v-if="isStore && alreadyInstalled && hasUpdate"
          :class="$style.updateBadge"
          :title="updateTitle"
        >{{ i18n.ts._common.updateAvailable }}</span>
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
          <span v-if="storeId" :class="$style.originBadge">{{ i18n.ts._common.store }}</span>
          <span v-else :class="[$style.originBadge, $style.originBadgeLocal]">{{ i18n.ts._common.local }}</span>
          <span v-if="refCount > 0" :class="$style.originBadge">
            {{ i18n.tsx._queryCard.appliedInColumns_plural({ count: refCount }) }}
          </span>
        </template>
        <span :class="$style.spacer" />
        <div :class="$style.actions">
          <!-- store mode -->
          <template v-if="isStore">
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
              {{ i18n.ts._common.install }}
            </button>
          </template>
          <!-- library mode (スコープ未参加のライブラリ本体) -->
          <template v-else-if="mode === 'library'">
            <button
              class="_button"
              :class="[$style.iconBtn, $style.iconBtnDanger]"
              :title="i18n.ts._queryCard.deleteFromLibrary"
              @click.stop="emit('delete')"
            >
              <i class="ti ti-trash" />
            </button>
            <!--
              スコープ未参加でも適用済みカラムがあれば評価され続けるので、
              適用中のものだけここで止められる (#1043)。未適用ならプラグインの
              ライブラリと同じく「追加」だけ (走っていないものに有効/無効は無意味)
            -->
            <button
              v-if="refCount > 0 || isDisabled"
              class="_button"
              :class="[$style.primaryBtn, !isDisabled && $style.secondaryBtn]"
              :disabled="readOnly"
              :title="toggleTitle"
              @click.stop="emit('toggle')"
            >
              {{ isDisabled ? i18n.ts._common.enable : i18n.ts._common.disable }}
            </button>
            <button
              class="_button"
              :class="$style.primaryBtn"
              @click.stop="emit('place')"
            >
              <i class="ti ti-plus" />
              {{ i18n.ts._common.add }}
            </button>
          </template>

          <!-- installed mode (カラムのスコープに参加中) -->
          <template v-else>
            <!-- 可逆な「外す」なので ti-trash (= 本体削除) とは別アイコン (#1048) -->
            <button
              v-if="detachTitle"
              class="_button"
              :class="$style.iconBtn"
              :title="detachTitle"
              @click.stop="emit('detach')"
            >
              <i class="ti ti-circle-minus" />
            </button>
            <button
              class="_button"
              :class="[$style.iconBtn, $style.iconBtnDanger]"
              :title="i18n.ts._queryCard.deleteFromLibrary"
              @click.stop="emit('delete')"
            >
              <i class="ti ti-trash" />
            </button>
            <button
              class="_button"
              :class="[$style.primaryBtn, !isDisabled && $style.secondaryBtn]"
              :disabled="readOnly"
              :title="toggleTitle"
              @click.stop="emit('toggle')"
            >
              {{ isDisabled ? i18n.ts._common.enable : i18n.ts._common.disable }}
            </button>
            <button
              v-if="canEdit"
              class="_button"
              :class="$style.primaryBtn"
              @click.stop="emit('edit')"
            >
              <i class="ti ti-pencil" />
              {{ i18n.ts._common.edit }}
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

/* 本体が無効 (#1043)。PluginCard の disabledBadge と同型 */
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
  letter-spacing: 0.04em;
  opacity: 0.75;
}

.cardDisabled {
  opacity: 0.6;
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

/* 更新ありバッジ (#1040)。originBadge と同型の accent チップ */
.updateBadge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  line-height: 1.3;
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
