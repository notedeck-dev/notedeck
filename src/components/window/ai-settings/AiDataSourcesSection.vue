<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  DATA_SOURCE_KEYS,
  type DataSourceKey,
  resolveDataSources,
  setDataSourcePreset,
  useAiConfig,
} from '@/composables/useAiConfig'
import { useClickOutside } from '@/composables/useClickOutside'
import { i18n } from '@/i18n'
import { FALLBACK_PRESET_OPTION, PRESET_OPTIONS } from '@/permissions/labels'
import type { PresetKey } from '@/permissions/schema'
import AiSettingsSection from './AiSettingsSection.vue'
import AiSwitchRow from './AiSwitchRow.vue'

const { config } = useAiConfig()

interface DataSourceLabel {
  label: string
  icon: string
  description: string
}

const DATA_SOURCE_LABELS: Record<DataSourceKey, DataSourceLabel> = {
  currentAccount: {
    get label() {
      return i18n.ts._aiDataSourcesSection.currentAccount
    },
    icon: 'ti-user',
    get description() {
      return i18n.ts._aiDataSourcesSection.currentAccountDescription
    },
  },
  currentColumn: {
    get label() {
      return i18n.ts._aiDataSourcesSection.currentColumn
    },
    icon: 'ti-columns',
    get description() {
      return i18n.ts._aiDataSourcesSection.currentColumnDescription
    },
  },
  visibleNotes: {
    get label() {
      return i18n.ts._aiDataSourcesSection.visibleNotes
    },
    icon: 'ti-list',
    get description() {
      return i18n.ts._aiDataSourcesSection.visibleNotesDescription
    },
  },
  recentConversation: {
    get label() {
      return i18n.ts._aiDataSourcesSection.recentConversation
    },
    icon: 'ti-messages',
    get description() {
      return i18n.ts._aiDataSourcesSection.recentConversationDescription
    },
  },
}

const showPresetDropdown = ref(false)
const presetRef = ref<HTMLElement | null>(null)

const currentPreset = computed(
  () =>
    PRESET_OPTIONS.find((p) => p.value === config.value.dataSources.preset) ??
    FALLBACK_PRESET_OPTION,
)

const resolvedDataSources = computed(() =>
  resolveDataSources(config.value.dataSources),
)

function selectPreset(preset: PresetKey) {
  config.value.dataSources = setDataSourcePreset(
    config.value.dataSources,
    preset,
  )
  showPresetDropdown.value = false
}

function toggleCustom(key: DataSourceKey) {
  config.value.dataSources.custom[key] = !config.value.dataSources.custom[key]
}

useClickOutside(presetRef, () => {
  showPresetDropdown.value = false
})
</script>

<template>
  <AiSettingsSection
    icon="ti-database-export"
    :title="i18n.ts._aiDataSourcesSection.title"
    :badge="currentPreset.label"
  >
    <div ref="presetRef" :class="$style.dropdown">
      <button
        class="_button"
        :class="$style.dropdownTrigger"
        @click="showPresetDropdown = !showPresetDropdown"
      >
        <i :class="'ti ' + currentPreset.icon" />
        <span>{{ currentPreset.label }}</span>
        <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
      </button>
      <div v-if="showPresetDropdown" :class="$style.dropdownPanel">
        <button
          v-for="opt in PRESET_OPTIONS"
          :key="opt.value"
          class="_button"
          :class="[$style.dropdownItem, { [$style.selected]: config.dataSources.preset === opt.value }]"
          @click="selectPreset(opt.value)"
        >
          <i :class="'ti ' + opt.icon" />
          <span>{{ opt.label }}</span>
          <i v-if="config.dataSources.preset === opt.value" class="ti ti-check" :class="$style.checkIcon" />
        </button>
      </div>
    </div>

    <div :class="$style.toggleList">
      <AiSwitchRow
        v-for="key in DATA_SOURCE_KEYS"
        :key="key"
        :icon="DATA_SOURCE_LABELS[key].icon"
        :label="DATA_SOURCE_LABELS[key].label"
        :sub-label="DATA_SOURCE_LABELS[key].description"
        :on="resolvedDataSources[key]"
        :disabled="config.dataSources.preset !== 'custom'"
        @toggle="toggleCustom(key)"
      />
    </div>
  </AiSettingsSection>
</template>

<style lang="scss" module>
.selected { /* modifier */ }

// Dropdown (reuse CssEditorContent pattern)
.dropdown {
  position: relative;
  width: 100%;
}

.dropdownTrigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
  text-align: left;
  transition: border-color var(--nd-duration-base), background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
}

.dropdownChevron {
  margin-left: auto;
  opacity: 0.4;
  font-size: 0.85em;
}

.dropdownPanel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 2px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.dropdownItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 0.8em;
  color: var(--nd-fg);
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
  &.selected { color: var(--nd-accent); }
  & + & { border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent); }
}

.checkIcon { margin-left: auto; opacity: 0.7; flex-shrink: 0; }

// DataSource toggle list
.toggleList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
}
</style>
