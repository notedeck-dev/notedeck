<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClickOutside } from '@/composables/useClickOutside'
import {
  FALLBACK_PRESET_OPTION,
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS,
  PRESET_OPTIONS,
} from '@/permissions/labels'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import {
  HIGH_RISK_PERMISSION_KEYS,
  type PermissionKey,
  type PermissionsConfig,
  type PresetKey,
  setPermissionPreset,
} from '@/permissions/schema'
import { resolveForProfiled, usePermissionsConfig } from '@/permissions/store'

/**
 * principal 1 つ分の権限プロファイル編集 (#712 §8.1)。
 * preset ピッカー + カテゴリ見出し付き 34 トグル。権限ウィンドウ
 * (PermissionsContent) が principal 行ごとに 1 個ずつ使う。
 *
 * `disabledKeys` は「変更できない下限 / 上限」を dead toggle にしないための
 * 機構 — disabled + 理由表示で「変更できない事実そのもの」を見せる。
 * 表示値は resolveForProfiled (= floor / clamp 適用済みの実効値) なので、
 * 権限ウィンドウに見えている状態と実効権限が食い違う瞬間が無い。
 */
const props = defineProps<{
  principalId: ProfiledPrincipalId
  /** 固定キー: disabled + 理由 chip 表示 (fixedValue は表示上の固定値) */
  disabledKeys?: readonly {
    keys: readonly PermissionKey[]
    reason: string
    fixedValue: boolean
  }[]
}>()

const { file: permissionsFile } = usePermissionsConfig()

function profile(): PermissionsConfig {
  return (
    permissionsFile.value.principals[props.principalId] ?? {
      preset: 'readonly',
      custom: {} as never,
    }
  )
}

const preset = computed(() => profile().preset)
const resolved = computed(() => {
  void permissionsFile.value
  return resolveForProfiled(props.principalId)
})

const currentPresetOption = computed(
  () =>
    PRESET_OPTIONS.find((p) => p.value === preset.value) ??
    FALLBACK_PRESET_OPTION,
)

const showDropdown = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
useClickOutside(dropdownRef, () => {
  showDropdown.value = false
})

function selectPreset(next: PresetKey) {
  permissionsFile.value.principals[props.principalId] = setPermissionPreset(
    profile(),
    next,
  )
  showDropdown.value = false
}

const disabledRuleByKey = computed(() => {
  const map = new Map<PermissionKey, { reason: string; fixedValue: boolean }>()
  for (const rule of props.disabledKeys ?? []) {
    for (const key of rule.keys) {
      map.set(key, { reason: rule.reason, fixedValue: rule.fixedValue })
    }
  }
  return map
})

const HIGH_RISK_SET = new Set<PermissionKey>(HIGH_RISK_PERMISSION_KEYS)

function isRowDisabled(key: PermissionKey): boolean {
  return preset.value !== 'custom' || disabledRuleByKey.value.has(key)
}

function toggle(key: PermissionKey) {
  if (isRowDisabled(key)) return
  const prof = profile()
  permissionsFile.value.principals[props.principalId] = {
    preset: 'custom',
    custom: { ...prof.custom, [key]: !prof.custom[key] },
  }
}
</script>

<template>
  <div>
    <div ref="dropdownRef" :class="$style.dropdown">
      <button
        class="_button"
        :class="$style.dropdownTrigger"
        @click="showDropdown = !showDropdown"
      >
        <i :class="'ti ' + currentPresetOption.icon" />
        <span>{{ currentPresetOption.label }}</span>
        <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
      </button>
      <div v-if="showDropdown" :class="$style.dropdownPanel">
        <button
          v-for="opt in PRESET_OPTIONS"
          :key="opt.value"
          class="_button"
          :class="[$style.dropdownItem, { [$style.selected]: preset === opt.value }]"
          @click="selectPreset(opt.value)"
        >
          <i :class="'ti ' + opt.icon" />
          <span>{{ opt.label }}</span>
          <i v-if="preset === opt.value" class="ti ti-check" :class="$style.checkIcon" />
        </button>
      </div>
    </div>

    <div v-for="category in PERMISSION_CATEGORIES" :key="category.label" :class="$style.category">
      <div :class="$style.categoryLabel">{{ category.label }}</div>
      <div :class="$style.toggleList">
        <div
          v-for="key in category.keys"
          :key="key"
          :class="[$style.switchRow, { [$style.switchRowDisabled]: isRowDisabled(key) }]"
          @click="toggle(key)"
        >
          <i :class="['ti ' + PERMISSION_LABELS[key].icon, $style.switchRowIcon]" />
          <span
            v-if="disabledRuleByKey.has(key)"
            :class="$style.switchRowLabelStack"
          >
            <span :class="$style.switchRowLabel">{{ PERMISSION_LABELS[key].label }}</span>
            <span :class="$style.switchRowSubLabel">{{ disabledRuleByKey.get(key)?.reason }}</span>
          </span>
          <span v-else :class="$style.switchRowLabel">{{ PERMISSION_LABELS[key].label }}</span>
          <i
            v-if="HIGH_RISK_SET.has(key)"
            class="ti ti-alert-triangle"
            :class="$style.warningIcon"
            title="高リスク操作"
          />
          <button
            class="nd-toggle-switch"
            :class="{ on: resolved[key] }"
            :aria-checked="resolved[key]"
            :disabled="isRowDisabled(key)"
            role="switch"
          >
            <span class="nd-toggle-switch-knob" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.dropdown {
  position: relative;
  width: 100%;
  margin-bottom: 8px;
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

.checkIcon {
  margin-left: auto;
  font-size: 0.9em;
}

.category {
  margin-top: 8px;
}

.categoryLabel {
  margin: 0 0 4px 2px;
  font-size: 0.7em;
  font-weight: bold;
  letter-spacing: 0.04em;
  color: var(--nd-fg);
  opacity: 0.55;
}

.toggleList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
}

.switchRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px 8px 8px;
  cursor: pointer;
  transition: background 0.1s;

  &:not(.switchRowDisabled):hover {
    background: var(--nd-buttonHoverBg);
  }
}

.switchRowDisabled {
  opacity: 0.5;
  cursor: default;
}

.switchRowIcon {
  font-size: 16px;
  color: var(--nd-fg);
  flex-shrink: 0;
}

.switchRowLabel {
  flex: 1;
  font-size: 13px;
  color: var(--nd-fg);
}

.switchRowLabelStack {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.switchRowSubLabel {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.6;
  line-height: 1.3;
}

.warningIcon {
  flex-shrink: 0;
  color: var(--nd-love);
  opacity: 0.85;
  font-size: 0.9em;
}
</style>
