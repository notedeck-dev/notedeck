<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    label: string
    subLabel?: string
    icon?: string
    on: boolean
    disabled?: boolean
  }>(),
  { subLabel: undefined, icon: undefined, disabled: false },
)

const emit = defineEmits<{ toggle: [] }>()

function onRowClick() {
  if (!props.disabled) emit('toggle')
}
</script>

<template>
  <div
    :class="[$style.switchRow, { [$style.switchRowDisabled]: disabled }]"
    @click="onRowClick"
  >
    <i v-if="icon" :class="['ti ' + icon, $style.switchRowIcon]" />
    <div v-if="subLabel" :class="$style.switchRowLabelStack">
      <span :class="$style.switchRowLabel">{{ label }}</span>
      <span :class="$style.switchRowSubLabel">{{ subLabel }}</span>
    </div>
    <span v-else :class="$style.switchRowLabel">{{ label }}</span>
    <button
      class="nd-toggle-switch"
      :class="{ on }"
      :aria-checked="on"
      :disabled="disabled"
      role="switch"
    >
      <span class="nd-toggle-switch-knob" />
    </button>
  </div>
</template>

<style lang="scss" module>
// nd-toggle-switch を右端に置く共通行レイアウト (左 icon / 中 label stack / 右 toggle)
.switchRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  cursor: pointer;
  border-radius: 6px;
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

  .switchRowLabel {
    flex: none;
  }
}

.switchRowSubLabel {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.6;
  line-height: 1.3;
}
</style>
