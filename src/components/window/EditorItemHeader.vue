<script setup lang="ts">
/**
 * ストア配布アイテム (プラグイン / テーマ / ウィジット / クエリ / スキル) の
 * 編集ウィンドウ共通ヘッダ (#955)。
 *
 * カラムのカード (PluginCard / QueryCard / WidgetCard / ThemeCard / スキル行) は
 * 「iconUrl を currentColor でマスク描画、無ければ種別の Tabler アイコン」で
 * アイテムを識別している。編集ウィンドウ側がこれと違う形式だと、同じ物が
 * 場所によって別の見え方になる。ここで形式を 1 つに固定する。
 *
 * icon スロットを使うとアイコン枠の中身を差し替えられる (テーマの配色プレビュー等)。
 */
import { proxyCssUrl } from '@/utils/mediaProxy'

defineProps<{
  /** MisStore registry の iconUrl。カードと同じく mask で currentColor 塗り */
  iconUrl?: string
  /** iconUrl が無いときの Tabler アイコン名 (`ti-` は除いた部分) */
  fallbackIcon: string
  name: string
}>()
</script>

<template>
  <div :class="$style.header">
    <div :class="$style.icon">
      <slot name="icon">
        <span
          v-if="iconUrl"
          :class="$style.iconImg"
          :style="{ '--icon-url': proxyCssUrl(iconUrl, 48) }"
          aria-hidden="true"
        />
        <i v-else :class="`ti ti-${fallbackIcon}`" />
      </slot>
    </div>
    <div :class="$style.meta">
      <div :class="$style.nameRow">
        <slot name="name">
          <span :class="$style.name">{{ name }}</span>
        </slot>
      </div>
      <div v-if="$slots.sub" :class="$style.sub">
        <slot name="sub" />
      </div>
      <div v-if="$slots.desc" :class="$style.desc">
        <slot name="desc" />
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.header {
  display: flex;
  gap: 12px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: var(--nd-radius-sm);
  overflow: clip;
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  color: var(--nd-accent);
  font-size: 24px;
}

.iconImg {
  width: 1em;
  height: 1em;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nameRow {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.name {
  font-size: 1.05em;
  font-weight: 700;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.desc {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
}
</style>
