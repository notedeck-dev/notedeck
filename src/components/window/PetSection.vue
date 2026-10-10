<script setup lang="ts">
/**
 * アピアランス設定の「ペット」欄 (#1080)。
 *
 * slug か petdex.dev のペット URL を貼って使う。眺めて選びたいときは
 * petdex.dev を外部ブラウザで開く (#933 と同じ判断)。
 */
import { computed, nextTick, ref, watch } from 'vue'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import FormRange from '@/components/common/form/FormRange.vue'
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

const PREVIEW_W = 24
const PREVIEW_H = 26

const pet = usePetStore()
const settings = useSettingsStore()
const input = ref('')
/** 「＋ 替える」を押したときだけ slug の入力欄を出す */
const showInput = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
watch(showInput, (open) => {
  if (open) void nextTick(() => inputRef.value?.focus())
})

// ── 大きさ ──
const scale = computed(() => clampPetScale(settings.get('pet.scale')))
const scalePercent = computed(() => Math.round(scale.value * 100))

function onScaleInput(percent: number) {
  settings.set('pet.scale', clampPetScale(percent / 100))
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
  if (await pet.select(input.value)) {
    input.value = ''
    showInput.value = false
  }
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

    <!-- 候補カード: なし / 今のペット / ＋ 替える (接続やキャラクターと同じ形) -->
    <ChoiceCardGrid>
      <ChoiceCard
        icon="paw-off"
        :label="i18n.ts._petSection.none"
        :active="!pet.info"
        @click="pet.clear()"
      />
      <ChoiceCard
        v-if="pet.info"
        :label="pet.info.displayName"
        active
        :title="i18n.ts._petSection.openPage"
        @click="openPage"
      >
        <template #logo>
          <div :class="$style.preview" :style="previewStyle" />
        </template>
      </ChoiceCard>
      <ChoiceCard
        dashed
        icon="plus"
        :label="pet.info ? i18n.ts._petSection.replace : i18n.ts._petSection.use"
        :active="showInput"
        @click="showInput = !showInput"
      />
    </ChoiceCardGrid>

    <div v-if="pet.info" :class="$style.sliderRow">
      <i class="ti ti-zoom-in" :class="$style.sliderIcon" />
      <FormRange
        :model-value="scalePercent"
        :min="PET_SCALE_MIN * 100"
        :max="PET_SCALE_MAX * 100"
        :step="5"
        :title="i18n.ts._petSection.size"
        :aria-label="i18n.ts._petSection.size"
        @update:model-value="onScaleInput"
      />
      <span :class="$style.sliderValue">{{ scalePercent }}%</span>
    </div>

    <form v-if="showInput" :class="$style.row" @submit.prevent="apply">
      <input
        ref="inputRef"
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
        <span v-else>{{ i18n.ts._petSection.use }}</span>
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
@use '@/styles/buttons' as *;
@use '@/styles/inputs' as *;
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--nd-font-md);
  color: var(--nd-fg);
}

.preview {
  flex: none;
  background-repeat: no-repeat;
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
  font-size: var(--nd-font-body);
}

.sliderValue {
  font-size: var(--nd-font-xs);
  color: var(--nd-fgMuted);
  min-width: 3.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.input {
  @include input-base;
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
}

.applyBtn {
  flex: none;
  padding: 6px 12px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  font: inherit;
  font-size: var(--nd-font-md);
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
  font-size: var(--nd-font-xs);
  color: var(--nd-love);
}

.link {
  @include nd-interactive;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: var(--nd-font-xs);
  color: var(--nd-fgMuted);
  cursor: pointer;

  &:hover {
    color: var(--nd-accentText);
  }
}
</style>
