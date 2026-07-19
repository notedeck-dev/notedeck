<script setup lang="ts">
import type { DriveFolder } from '@/adapters/types'

const props = withDefaults(
  defineProps<{
    folders: readonly DriveFolder[]
    showItemMenu?: boolean
    selectMode?: boolean
    /** 親のグリッドに直接セルを流し込む（ファイルグリッドとの連続配置用） */
    flat?: boolean
  }>(),
  {
    showItemMenu: false,
    selectMode: false,
    flat: false,
  },
)

const emit = defineEmits<{
  'folder-click': [folder: DriveFolder]
  /** 右クリック / 「…」ボタン共通のメニュー要求 */
  'folder-menu': [folder: DriveFolder, event: MouseEvent]
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
  <div :class="flat ? $style.flatGrid : $style.folderGrid">
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
  </div>
</template>

<style lang="scss" module>
.folderGrid {
  composes: gridContainer from './drive-grid.module.scss';
}

/* flat: セルを親グリッドに直接参加させる（フォルダ末尾の空セルを作らない） */
.flatGrid {
  display: contents;
}

.cellWrap {
  position: relative;
  /* グリッドアイテムの最小幅が内容に引っ張られてはみ出すのを防ぐ */
  min-width: 0;
  /* アイコンをセル幅に追従させる (cqw) ための基準コンテナ */
  container-type: inline-size;
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
  /* セル幅の 7 割を基準に、狭いセル（ピッカー等）でもはみ出さない */
  font-size: clamp(2.5rem, 70cqw, 6rem);
  color: var(--nd-accent);
  opacity: 0.5;
}

/* outline フォルダアイコンの本体（タブの下）中央に重ねる */
.folderName {
  position: absolute;
  left: 12%;
  right: 12%;
  top: 48%;
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

</style>
