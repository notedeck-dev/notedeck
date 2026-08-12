<script setup lang="ts">
import { computed } from 'vue'
import { formatDate } from '@/utils/format'
import { isProxiable, proxyCssUrl } from '@/utils/mediaProxy'
import { isWindowExposed } from '@/windows/exposure'

type Mode = 'store' | 'library'

const props = withDefaults(
  defineProps<{
    mode?: Mode
    name: string
    description?: string
    author?: string
    version?: string
    capabilities?: readonly string[]
    capabilityOk?: boolean
    /** 非互換理由の短いラベル (要アップデート / 要アカウント 等) */
    capabilityBadge?: string | null
    capabilityReason?: string | null
    /** store mode: インストール処理中 */
    installing?: boolean
    /** store mode: 既にライブラリにある */
    alreadyInstalled?: boolean
    /** store mode: インストール済みかつストア側が更新されている (#1040) */
    hasUpdate?: boolean
    /** store mode: レジストリの updatedAt (更新バッジの tooltip 用) */
    updatedAt?: string
    /** library mode: storeId 有無で「ストア由来」/「ローカル保存」バッジ表示 */
    storeId?: string
    iconUrl?: string
  }>(),
  {
    mode: 'store',
  },
)

const emit = defineEmits<{
  // store
  (e: 'install'): void
  (e: 'update'): void
  (e: 'open-detail'): void
  // library
  (e: 'place'): void
  (e: 'edit'): void
  (e: 'delete'): void
}>()

const isStore = computed(() => props.mode === 'store')
const isLibrary = computed(() => props.mode === 'library')
const cardDisabled = computed(
  () => isStore.value && props.capabilityOk === false,
)
// 非互換時のみ tooltip で理由 + 必要 capability を開示する
const incompatTitle = computed(() => {
  if (!cardDisabled.value) return ''
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

function handlePrimaryClick() {
  if (cardDisabled.value) return
  if (isStore.value) {
    if (props.alreadyInstalled || props.installing) return
    emit('install')
  } else {
    emit('place')
  }
}
</script>

<template>
  <div
    :class="[$style.card, cardDisabled && $style.cardDisabled]"
    :title="incompatTitle"
    @click="handlePrimaryClick"
  >
    <div :class="$style.icon">
      <span
        v-if="isProxiable(iconUrl)"
        :class="$style.iconImg"
        :style="{ '--icon-url': proxyCssUrl(iconUrl, 48) }"
        aria-hidden="true"
      />
      <i v-else class="ti ti-layout-dashboard" />
    </div>
    <div :class="$style.body">
      <div :class="$style.row1">
        <button
          type="button"
          :class="$style.name"
          :aria-disabled="cardDisabled || (isStore && (alreadyInstalled || installing))"
          @click.stop="handlePrimaryClick"
        >{{ name }}</button>
        <span v-if="cardDisabled" :class="$style.incompatBadge">{{ capabilityBadge ?? '非対応' }}</span>
        <span
          v-if="isStore && alreadyInstalled && hasUpdate"
          :class="$style.updateBadge"
          :title="updateTitle"
        >更新あり</span>
        <span :class="$style.spacer" />
        <span v-if="version" :class="$style.version">v{{ version }}</span>
      </div>
      <div v-if="description" :class="$style.row2">
        {{ description }}
      </div>
      <div :class="$style.row3">
        <span v-if="author" :class="$style.author">{{ author }}</span>
        <!-- library mode: ストア/ローカル バッジ -->
        <template v-if="isLibrary">
          <span v-if="storeId" :class="$style.originBadge">ストア</span>
          <span v-else :class="[$style.originBadge, $style.originBadgeLocal]">ローカル</span>
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
          <!-- library mode -->
          <template v-else>
            <button
              class="_button"
              :class="[$style.iconBtn, $style.iconBtnDanger]"
              title="ライブラリから削除 (コードも消えます)"
              @click.stop="emit('delete')"
            >
              <i class="ti ti-trash" />
            </button>
            <button
              v-if="isWindowExposed('widget-edit')"
              class="_button"
              :class="$style.iconBtn"
              title="ウィジットを編集"
              @click.stop="emit('edit')"
            >
              <i class="ti ti-pencil" />
            </button>
            <button
              class="_button"
              :class="$style.primaryBtn"
              @click.stop="emit('place')"
            >
              <i class="ti ti-plus" />
              配置
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

.cardDisabled {
  opacity: 0.55;
  cursor: not-allowed;

  &:hover {
    background: transparent;
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
