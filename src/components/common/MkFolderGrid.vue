<script setup lang="ts">
import type { DriveFolder } from '@/adapters/types'

const props = withDefaults(
  defineProps<{
    folders: readonly DriveFolder[]
    showItemMenu?: boolean
    showCreateCell?: boolean
    selectMode?: boolean
  }>(),
  {
    showItemMenu: false,
    showCreateCell: false,
    selectMode: false,
  },
)

const emit = defineEmits<{
  'folder-click': [folder: DriveFolder]
  /** 右クリック / 「…」ボタン共通のメニュー要求 */
  'folder-menu': [folder: DriveFolder, event: MouseEvent]
  'create-click': []
}>()

// ゲート時は preventDefault しない = ネイティブ右クリックメニューを潰さない
function onContextMenu(folder: DriveFolder, e: MouseEvent) {
  if (!props.showItemMenu || props.selectMode) return
  e.preventDefault()
  e.stopPropagation()
  emit('folder-menu', folder, e)
}
</script>

<template>
  <div :class="$style.folderGrid">
    <div v-for="folder in folders" :key="folder.id" :class="$style.cellWrap">
      <button
        class="_button"
        :class="$style.folderCell"
        :title="folder.name"
        @click="emit('folder-click', folder)"
        @contextmenu="onContextMenu(folder, $event)"
      >
        <i class="ti ti-folder" :class="$style.folderIcon" />
        <span :class="$style.folderName">{{ folder.name }}</span>
      </button>
      <button
        v-if="showItemMenu && !selectMode"
        class="_button"
        :class="$style.cellMenuBtn"
        :aria-label="`「${folder.name}」のメニュー`"
        title="メニュー"
        @click.stop="emit('folder-menu', folder, $event)"
      >
        <i class="ti ti-dots" />
      </button>
    </div>
    <button
      v-if="showCreateCell && !selectMode"
      class="_button"
      :class="$style.createCell"
      aria-label="新規フォルダ"
      title="新規フォルダ"
      @click="emit('create-click')"
    >
      <i class="ti ti-folder-plus" />
    </button>
  </div>
</template>

<style lang="scss" module>
.folderGrid {
  composes: gridContainer from './drive-grid.module.scss';
}

.cellWrap {
  position: relative;
  /* グリッドアイテムの最小幅が内容に引っ張られてはみ出すのを防ぐ */
  min-width: 0;
}

/* メディアグリッドと同じ正方形セル。名前は outline フォルダアイコンの
   本体部分（タブの下）に重ねて表示する */
.folderCell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }
}

.folderIcon {
  font-size: 4rem;
  color: var(--nd-accent);
  opacity: 0.5;
}

.folderName {
  position: absolute;
  left: 14%;
  right: 14%;
  top: 56%;
  transform: translateY(-50%);
  text-align: center;
  font-size: 0.7em;
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* self-chain で WebView2 の _button 特異度衝突に備える。
   視覚アイコンは小さくても当たり判定は 40px 以上を確保する
   （タッチ常時表示時、セル本体タップ=ナビとの誤タップ防止）。 */
.cellMenuBtn.cellMenuBtn {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  color: var(--nd-fg);
  font-size: 14px;
  opacity: 0.7;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

/* hover 環境では hover 時のみ「…」を出す。タッチ環境ではフォルダは
   タップ=ナビで他のアクション到達手段が無いため常時表示。 */
@media (hover: hover) {
  .cellMenuBtn.cellMenuBtn {
    opacity: 0;
  }

  .cellWrap:hover .cellMenuBtn,
  .cellMenuBtn.cellMenuBtn:focus-visible {
    opacity: 0.7;

    &:hover {
      opacity: 1;
    }
  }
}

/* アップロードセルと対称の破線正方形（アイコンのみ、名前は tooltip） */
.createCell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  font-size: 1.75rem;
  color: var(--nd-accent);
  opacity: 0.6;
  border: 2px dashed var(--nd-accent);
  border-radius: var(--nd-radius-md);
  background: color-mix(in srgb, var(--nd-accent) 5%, transparent);
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  }
}
</style>
