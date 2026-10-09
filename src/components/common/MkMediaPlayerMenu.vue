<script setup lang="ts">
import { ref } from 'vue'
import { i18n } from '@/i18n'
import { MEDIA_PLAYBACK_RATES } from '@/services/mediaTime'
import PopupMenu from './PopupMenu.vue'

// 動画・音声プレイヤー共通の設定メニュー (#1214)。本家の歯車メニューと同じく
// ループ再生 / 再生速度 / ピクチャーインピクチャー
defineProps<{
  loop: boolean
  rate: number
  /** ピクチャーインピクチャーを出すか (動画で、WebView が対応しているとき) */
  pip?: boolean
}>()

const emit = defineEmits<{
  toggleLoop: []
  setRate: [rate: number]
  pip: []
  /** 開閉 (動画はメニューを開いている間コントロールを隠さない) */
  openChange: [open: boolean]
}>()

const menuRef = ref<InstanceType<typeof PopupMenu>>()

function open(e: MouseEvent) {
  menuRef.value?.open(e)
  emit('openChange', true)
}

function pick(action: () => void) {
  action()
  menuRef.value?.close()
}

defineExpose({ open })
</script>

<template>
  <PopupMenu ref="menuRef" @close="emit('openChange', false)">
    <button
      class="_popupItem"
      role="menuitemcheckbox"
      :aria-checked="loop"
      @click="pick(() => emit('toggleLoop'))"
    >
      <i class="ti ti-repeat" />
      <span :class="$style.label">{{ i18n.ts._mkMediaPlayer.loop }}</span>
      <i v-if="loop" class="ti ti-check" />
    </button>
    <div class="_popupDivider" />
    <div :class="$style.heading">
      <i class="ti ti-clock-play" />
      {{ i18n.ts._mkMediaPlayer.playbackRate }}
    </div>
    <button
      v-for="r in MEDIA_PLAYBACK_RATES"
      :key="r"
      class="_popupItem"
      role="menuitemradio"
      :aria-checked="rate === r"
      @click="pick(() => emit('setRate', r))"
    >
      <i class="ti" />
      <span :class="$style.label">{{ r.toFixed(r * 100 % 10 === 0 ? 1 : 2) }}x</span>
      <i v-if="rate === r" class="ti ti-check" />
    </button>
    <template v-if="pip">
      <div class="_popupDivider" />
      <button class="_popupItem" @click="pick(() => emit('pip'))">
        <i class="ti ti-picture-in-picture" />
        <span :class="$style.label">{{ i18n.ts._mkMediaPlayer.pip }}</span>
      </button>
    </template>
  </PopupMenu>
</template>

<style lang="scss" module>
.label {
  flex: 1;
}

.heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 22px 2px;
  font-size: var(--nd-font-xs);
  opacity: 0.6;
}
</style>
