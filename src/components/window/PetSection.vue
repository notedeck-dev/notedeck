<script setup lang="ts">
/**
 * アピアランス設定の「ペット」欄 (#1080)。
 *
 * slug か petdex.dev のペット URL を貼って使う。眺めて選びたいときは
 * petdex.dev を外部ブラウザで開く (#933 と同じ判断)。
 */
import { computed, ref } from 'vue'
import { i18n } from '@/i18n'
import {
  clampPetScale,
  PET_COLUMNS,
  PET_SCALE_MAX,
  PET_SCALE_MIN,
  petFrames,
  petStateRow,
} from '@/services/petSprite'
import { usePetStore } from '@/stores/pet'
import { useSettingsStore } from '@/stores/settings'
import { openSafeUrl } from '@/utils/url'

const PREVIEW_W = 48
const PREVIEW_H = 52

const pet = usePetStore()
const settings = useSettingsStore()
const input = ref('')

// ── 大きさ ──
const scale = computed(() => clampPetScale(settings.get('pet.scale')))
const scalePercent = computed(() => Math.round(scale.value * 100))
const scaleFill = computed(
  () =>
    `${((scale.value - PET_SCALE_MIN) / (PET_SCALE_MAX - PET_SCALE_MIN)) * 100}%`,
)

function onScaleInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value) / 100
  settings.set('pet.scale', clampPetScale(v))
}

const previewStyle = computed(() => {
  const info = pet.info
  if (!info || !pet.spriteUrl) return undefined
  const col = petFrames('idle')[0]?.col ?? 0
  return {
    width: `${PREVIEW_W}px`,
    height: `${PREVIEW_H}px`,
    backgroundImage: `url("${pet.spriteUrl}")`,
    backgroundSize: `${PET_COLUMNS * PREVIEW_W}px ${info.rows * PREVIEW_H}px`,
    backgroundPosition: `${-col * PREVIEW_W}px ${-petStateRow('idle') * PREVIEW_H}px`,
  }
})

async function apply() {
  if (!input.value.trim() || pet.loading) return
  if (await pet.select(input.value)) input.value = ''
}

function browse() {
  void openSafeUrl('https://petdex.dev')
}

function openPage() {
  if (pet.info) void openSafeUrl(`https://petdex.dev/pets/${pet.info.slug}`)
}
</script>

<template>
  <div :class="$style.root">
    <div :class="$style.heading">
      <i class="ti ti-paw" />
      <span>{{ i18n.ts._petSection.title }}</span>
    </div>

    <div v-if="pet.info" :class="$style.current">
      <div :class="$style.preview" :style="previewStyle" />
      <div :class="$style.currentText">
        <span :class="$style.name">{{ pet.info.displayName }}</span>
        <button type="button" :class="$style.link" @click="openPage">
          {{ i18n.ts._petSection.openPage }}
        </button>
      </div>
      <button
        type="button"
        :class="$style.removeBtn"
        :title="i18n.ts._petSection.remove"
        @click="pet.clear()"
      >
        <i class="ti ti-x" />
      </button>
    </div>

    <div v-if="pet.info" :class="$style.sliderRow">
      <i class="ti ti-zoom-in" :class="$style.sliderIcon" />
      <input
        type="range"
        :class="$style.slider"
        :value="scalePercent"
        :min="PET_SCALE_MIN * 100"
        :max="PET_SCALE_MAX * 100"
        step="5"
        :title="i18n.ts._petSection.size"
        :aria-label="i18n.ts._petSection.size"
        :style="{ '--fill': scaleFill }"
        @input="onScaleInput"
      />
      <span :class="$style.sliderValue">{{ scalePercent }}%</span>
    </div>

    <form :class="$style.row" @submit.prevent="apply">
      <input
        v-model="input"
        :class="$style.input"
        type="text"
        :placeholder="i18n.ts._petSection.inputPlaceholder"
        spellcheck="false"
        :disabled="pet.loading"
      />
      <button
        type="submit"
        :class="$style.applyBtn"
        :disabled="pet.loading || !input.trim()"
      >
        <i v-if="pet.loading" class="ti ti-loader-2" :class="$style.spin" />
        <span v-else>{{ pet.info ? i18n.ts._petSection.replace : i18n.ts._petSection.use }}</span>
      </button>
    </form>

    <div v-if="pet.error" :class="$style.error">
      <i class="ti ti-alert-triangle" />
      {{ pet.error }}
    </div>

    <button type="button" :class="$style.link" @click="browse">
      <i class="ti ti-external-link" />
      {{ i18n.ts._petSection.browse }}
    </button>
  </div>
</template>

<style module lang="scss">
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  color: var(--nd-fg);
}

.current {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
}

.preview {
  flex: none;
  background-repeat: no-repeat;
}

.currentText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.name {
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.removeBtn {
  flex: none;
  border: none;
  background: none;
  color: var(--nd-fgMuted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--nd-radius-sm);
  font-size: 1em;

  &:hover {
    background: var(--nd-accent-hover);
    color: var(--nd-fg);
  }
}

.row {
  display: flex;
  gap: 6px;
}

.sliderRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.sliderIcon {
  color: var(--nd-fgMuted);
  font-size: 0.9em;
}

.sliderValue {
  font-size: 0.75em;
  color: var(--nd-fgMuted);
  min-width: 3.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.slider {
  flex: 1;
  height: 4px;
  appearance: none;
  /* thumb より左を塗りつぶす (--fill は script 側で算出) */
  background: linear-gradient(
    to right,
    var(--nd-accent) var(--fill, 0%),
    var(--nd-divider) var(--fill, 0%)
  );
  border-radius: 2px;
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--nd-accent);
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 50%;
    background: var(--nd-accent);
    cursor: pointer;
  }
}

.input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font: inherit;
  font-size: 0.85em;
}

.applyBtn {
  flex: none;
  padding: 6px 12px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  font: inherit;
  font-size: 0.85em;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-love);
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.75em;
  color: var(--nd-fgMuted);
  cursor: pointer;

  &:hover {
    color: var(--nd-accent);
  }
}
</style>
