<script setup lang="ts">
/**
 * 設定画面の「候補から 1 つ選ぶ / 開く」カード (接続 / AI プロバイダ / ACP /
 * キャラクター / ペットで共用)。縦並びのロゴ + ラベル、選択中はアクセントの枠と
 * 右上のチェック。ロゴは画像 / tabler アイコン / SVG を accent 色で塗る mask の
 * いずれか (`#logo` スロットで差し替えも可)。右上のバッジは `#badge` で差し替える。
 */
withDefaults(
  defineProps<{
    label: string
    active?: boolean
    /** 破線の「＋ 追加」カード */
    dashed?: boolean
    disabled?: boolean
    title?: string
    /** ロゴ画像。読めなければ `iconError` を出すので呼び出し側で null に落とす */
    iconUrl?: string | null
    /** SVG を currentColor (accent) で塗る mask の CSS 値 (`url(...)`)。iconUrl より優先 */
    iconMaskCss?: string | null
    /** 画像が無いときの tabler アイコン名 (`ti-` 無し) */
    icon?: string
  }>(),
  {
    active: false,
    dashed: false,
    disabled: false,
    title: undefined,
    iconUrl: null,
    iconMaskCss: null,
    icon: 'circle-dotted',
  },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
  iconError: []
}>()
</script>

<template>
  <button
    class="_button"
    :class="[$style.card, { [$style.cardActive]: active, [$style.cardDashed]: dashed }]"
    :disabled="disabled"
    :aria-pressed="active"
    :title="title"
    @click="emit('click', $event)"
  >
    <span :class="$style.badges">
      <slot name="badge">
        <i v-if="active" class="ti ti-circle-check" :class="$style.activeBadge" />
      </slot>
    </span>
    <slot name="logo">
      <span
        v-if="iconMaskCss"
        :class="$style.logoMask"
        :style="{ '--icon-url': iconMaskCss }"
        aria-hidden="true"
      />
      <img
        v-else-if="iconUrl"
        :src="iconUrl"
        :class="$style.logo"
        alt=""
        @error="emit('iconError')"
      />
      <i v-else class="ti" :class="[`ti-${icon}`, $style.logoFallback]" />
    </slot>
    <span :class="$style.label">{{ label }}</span>
  </button>
</template>

<style lang="scss" module>
// `_button` と特異度が同点だと WebView2 で display: inline-block に負けるため (0,2,0) に上げる
.card.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: var(--nd-font-sm);
  cursor: pointer;
  text-align: center;

  &:disabled {
    cursor: not-allowed;
  }
}

.cardActive.cardActive {
  background: color-mix(in srgb, var(--nd-accent) 12%, var(--nd-buttonBg));
  box-shadow: inset 0 0 0 1px var(--nd-accent);
}

.cardDashed.cardDashed {
  border: 1px dashed var(--nd-divider);
  background: transparent;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.badges {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;

  i {
    font-size: 12px;
  }
}

.activeBadge {
  color: var(--nd-accentText);
}

.logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: var(--nd-radius-xs);
}

// SVG mask + currentColor でテーマアクセント色化 (DeckAiColumn.personaIndicator と同じ)
.logoMask {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  background-color: currentColor;
  color: var(--nd-accentText);
  -webkit-mask: var(--icon-url) center / contain no-repeat;
  mask: var(--icon-url) center / contain no-repeat;
}

.logoFallback {
  font-size: 22px;
  color: var(--nd-fgMuted);
}
</style>
