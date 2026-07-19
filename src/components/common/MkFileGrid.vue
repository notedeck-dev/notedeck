<script setup lang="ts">
import type { NormalizedDriveFile } from '@/adapters/types'
import {
  isAudio,
  isImage,
  isVideo,
  safeUrl,
} from '@/composables/useDriveFolder'

const props = withDefaults(
  defineProps<{
    files: readonly NormalizedDriveFile[]
    selectMode?: boolean
    selectedIds?: Set<string> | null
    showLabel?: boolean
    showItemMenu?: boolean
  }>(),
  {
    selectMode: false,
    selectedIds: null,
    showLabel: true,
    showItemMenu: false,
  },
)

const emit = defineEmits<{
  'file-click': [file: NormalizedDriveFile]
  /** 右クリック / 「…」ボタン共通のメニュー要求 */
  'file-menu': [file: NormalizedDriveFile, event: MouseEvent]
}>()

// ゲート時は preventDefault しない = ネイティブ右クリックメニューを潰さない
// （showItemMenu を使わない既存利用箇所の挙動を変えないため）
function onContextMenu(file: NormalizedDriveFile, e: MouseEvent) {
  if (!props.showItemMenu || props.selectMode) return
  e.preventDefault()
  e.stopPropagation()
  emit('file-menu', file, e)
}
</script>

<template>
  <div :class="$style.driveGrid">
    <slot />
    <div v-for="file in files" :key="file.id" :class="$style.cellWrap">
      <button
        class="_button"
        :class="[$style.driveGridCell, { [$style.selected]: selectMode && selectedIds?.has(file.id) }]"
        @click="emit('file-click', file)"
        @contextmenu="onContextMenu(file, $event)"
      >
        <div :class="$style.driveGridThumb">
          <img
            v-if="isImage(file) && !file.isSensitive"
            :src="safeUrl(file.thumbnailUrl) || safeUrl(file.url)"
            :alt="file.name"
            :class="$style.driveGridImg"
            loading="lazy"
          />
          <img
            v-else-if="isVideo(file) && !file.isSensitive && file.thumbnailUrl"
            :src="safeUrl(file.thumbnailUrl)"
            :alt="file.name"
            :class="$style.driveGridImg"
            loading="lazy"
          />
          <div v-else-if="file.isSensitive" :class="$style.driveGridPlaceholder">
            <i class="ti ti-eye-off" />
          </div>
          <div v-else :class="$style.driveGridPlaceholder">
            <i :class="isVideo(file) ? 'ti ti-video' : isAudio(file) ? 'ti ti-music' : 'ti ti-file'" />
          </div>
          <div v-if="isVideo(file) && !file.isSensitive" :class="$style.driveGridBadge">
            <i class="ti ti-player-play" />
          </div>
          <div v-if="selectMode" :class="[$style.driveSelectCheck, { [$style.checked]: selectedIds?.has(file.id) }]">
            <i class="ti ti-check" />
          </div>
        </div>
        <div v-if="showLabel" :class="$style.driveGridLabel">{{ file.name }}</div>
      </button>
      <button
        v-if="showItemMenu && !selectMode"
        class="_button"
        :class="$style.cellMenuBtn"
        :aria-label="`「${file.name}」のメニュー`"
        title="メニュー"
        @click.stop="emit('file-menu', file, $event)"
      >
        <i class="ti ti-dots" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.driveGrid {
  composes: gridContainer from './drive-grid.module.scss';
}

.cellWrap {
  position: relative;
}

.driveGridCell {
  display: flex;
  flex-direction: column;
  width: 100%;
  overflow: hidden;
  transition: opacity var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;

  &:hover {
    opacity: 0.8;
  }
}

.driveGridThumb {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--nd-bg);
}

.driveGridImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.driveGridPlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  opacity: 0.3;
}

.driveGridBadge {
  position: absolute;
  bottom: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--nd-overlayDark);
  color: #fff;
  font-size: 12px;
}

.driveGridLabel {
  composes: cellLabel from './drive-grid.module.scss';
}

/* self-chain で WebView2 の _button 特異度衝突に備える。
   当たり判定はサムネイル右上 40px（誤タップ防止）。 */
.cellMenuBtn.cellMenuBtn {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: #fff;
  font-size: 14px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity var(--nd-duration-base);
}

/* hover 環境のみ hover-reveal。タッチ環境ではファイルはタップ → 詳細
   ウィンドウ → 「…」で同一アクションに到達できるため表示しない (§8-28)。 */
@media (hover: hover) {
  .cellWrap:hover .cellMenuBtn,
  .cellMenuBtn.cellMenuBtn:focus-visible {
    opacity: 0.8;

    &:hover {
      opacity: 1;
    }
  }
}

@media (hover: none) {
  .cellMenuBtn.cellMenuBtn {
    display: none;
  }
}

.driveSelectCheck {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  font-size: 12px;
  transition: background var(--nd-duration-base), border-color var(--nd-duration-base), color var(--nd-duration-base);

  &.checked {
    background: var(--nd-accent);
    border-color: var(--nd-accent);
    color: #fff;
  }
}

.selected .driveGridThumb {
  outline: 3px solid var(--nd-accent);
  outline-offset: -3px;
}
</style>
