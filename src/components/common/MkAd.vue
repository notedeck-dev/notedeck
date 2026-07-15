<script setup lang="ts">
import { ref } from 'vue'
import type { ServerAd } from '@/adapters/types'
import { openSafeUrl } from '@/utils/url'

const props = withDefaults(
  defineProps<{
    ad: ServerAd
    serverHost: string
    showMuteButton?: boolean
  }>(),
  { showMuteButton: true },
)

const emit = defineEmits<{
  mute: [adId: string]
}>()

const showMenu = ref(false)

function onClick() {
  openSafeUrl(props.ad.url)
}

function reduceFrequency() {
  emit('mute', props.ad.id)
  showMenu.value = false
}
</script>

<template>
  <div :class="$style.mkAd">
    <div :class="$style.adWrapper">
      <a :class="$style.adLink" @click.prevent="onClick">
        <img :src="ad.imageUrl" :class="$style.adImage" loading="lazy" />
        <button v-if="showMuteButton" :class="$style.adInfoBtn" @click.prevent.stop="showMenu = !showMenu">
          <i class="ti ti-info-circle" :class="$style.adInfoIcon" />
        </button>
      </a>
      <div v-if="showMenu" :class="$style.adMenuOverlay" @click.stop>
        <div :class="$style.adMenuSource">Ads by {{ serverHost }}</div>
        <button :class="$style.adMenuReduce" @click="reduceFrequency">
          この広告の表示頻度を下げる
        </button>
        <button :class="$style.adMenuBack" @click="showMenu = false">戻る</button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.mkAd {
  text-align: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--nd-divider);
}

.adWrapper {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.adLink {
  display: block;
  position: relative;
  cursor: pointer;

  &:hover > .adImage {
    filter: contrast(120%);
  }
}

.adImage {
  display: block;
  object-fit: contain;
  max-width: 100%;
  margin: auto;
  border-radius: 5px;
  transition: filter var(--nd-duration-base);
}

.adInfoBtn {
  position: absolute;
  top: 1px;
  right: 1px;
  display: grid;
  place-content: center;
  background: var(--nd-panel, var(--nd-bg));
  border: none;
  border-radius: 100%;
  padding: 2px;
  cursor: pointer;
}

.adInfoIcon {
  font-size: 14px;
  line-height: 17px;
  color: var(--nd-fg);
  opacity: 0.7;
}

.adMenuOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--nd-panel, var(--nd-bg));
  border: solid 1px var(--nd-divider);
  border-radius: 5px;
}

.adMenuSource {
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.7;
}

.adMenuReduce {
  display: inline-block;
  margin: 4px 0;
  padding: 8px 16px;
  border: none;
  border-radius: var(--nd-radius-full);
  background: var(--nd-accent);
  color: #fff;
  font-size: 0.85em;
  font-weight: bold;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
  }
}

.adMenuBack {
  padding: 4px 8px;
  border: none;
  background: none;
  color: var(--nd-accent);
  font-size: 0.85em;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}
</style>
