<script setup lang="ts">
/**
 * 未登録カラム種別の墓標 (#794 未決事項 1)。
 *
 * プラグイン起動 (useDeckInit の idle コールバック) はデッキ復元より後なので、
 * プラグイン定義カラムは正常起動でも必ず一度「未登録種別」を通る。したがって
 * 「未登録なら捨てる」実装は通常起動のたびにデッキ構成を削ってしまう。
 * 捨てずに墓標を出し、レジストリに登録された時点で実体へ差し替わるようにする。
 *
 * 起動途中の未登録と恒久的な欠落は区別しない — 区別すると起動順序に依存した
 * 特別扱いが生まれる。ユーザーから見れば「まだ出ていない」だけで同じ。
 */
import { useDeckStore } from '@/stores/deck'

const props = defineProps<{
  colId: string
  type: string
}>()

const deckStore = useDeckStore()

function remove() {
  deckStore.removeColumn(props.colId)
}
</script>

<template>
  <div :class="$style.tombstone">
    <i class="ti ti-puzzle-off" :class="$style.icon" />
    <div :class="$style.title">拡張カラム「{{ type }}」は読み込まれていません</div>
    <div :class="$style.body">
      提供元のプラグインが無効・削除されているか、まだ起動していません。
      プラグインが起動すると自動的に表示されます。
    </div>
    <button type="button" :class="$style.remove" @click="remove">
      このカラムを削除
    </button>
  </div>
</template>

<style lang="scss" module>
.tombstone {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  text-align: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--nd-panel) 92%, transparent);
  border: 1px dashed color-mix(in srgb, var(--nd-divider, currentColor) 45%, transparent);
}

.icon {
  font-size: 28px;
  opacity: 0.5;
}

.title {
  font-size: 0.9rem;
  font-weight: 600;
}

.body {
  font-size: 0.8rem;
  line-height: 1.6;
  opacity: 0.7;
  max-width: 28em;
}

.remove {
  margin-top: 8px;
  padding: 4px 14px;
  border: 1px solid color-mix(in srgb, var(--nd-divider, currentColor) 45%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
}
</style>
